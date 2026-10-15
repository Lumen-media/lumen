//! Community module store: catalog, releases, READMEs, downloads and installs.
//!
//! The store is driven by a static JSON catalog published on GitHub
//! (`CATALOG_URL`). From a catalog entry the store can resolve the module's
//! latest GitHub release, download its `.lumenpack` asset, and hand it to
//! [`Installer`] to produce an [`InstalledModule`].
//!
//! Two on-disk, best-effort caches live under `<app_data_dir>/lumen`:
//!
//! * `catalog.json` — the last successfully fetched catalog, served with
//!   `stale = true` when the network is unavailable;
//! * `store-cache/releases/{repo}.json` — the latest release per repository,
//!   reused for `RELEASE_TTL` (one hour) and as a fallback on rate limiting.
//!
//! Downloads are streamed with progress emitted on the
//! `store:download-progress` event and are hard-capped at `MAX_PACK_BYTES`.
//! All functions here are Tauri commands exposed to the frontend.

use std::fs;
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime};

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use super::install::Installer;
use super::manifest::ModuleManifest;
use super::registry::ModuleEntry;
use super::{InstalledModule, ModuleRuntime};

/// URL of the remote community module catalog.
const CATALOG_URL: &str =
    "https://raw.githubusercontent.com/Lumen-media/community-modules/main/modules.json";
/// Catalog schema version this client understands.
const CATALOG_SCHEMA_VERSION: i64 = 1;
/// Hard cap for a downloaded `.lumenpack` (100 MB).
const MAX_PACK_BYTES: u64 = 100 * 1024 * 1024;
/// Hard cap for a fetched README or manifest (2 MB).
const MAX_README_BYTES: u64 = 2 * 1024 * 1024;
/// How long a cached release is considered fresh (one hour).
const RELEASE_TTL: Duration = Duration::from_secs(60 * 60);

/// Branches probed, in order, when raw GitHub files are fetched.
const DEFAULT_BRANCHES: [&str; 2] = ["main", "master"];

/// Author information for a catalog entry.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoreAuthor {
    /// Display name of the author.
    pub name: String,
    /// URL for the author.
    pub url: String,
}

/// A single module entry in the community catalog.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoreCatalogModule {
    /// Module id (reverse-DNS).
    pub id: String,
    /// Display name.
    pub name: String,
    /// Short one-line summary shown in listings.
    #[serde(default)]
    pub tagline: Option<String>,
    /// Longer description.
    #[serde(default)]
    pub description: Option<String>,
    /// Free-form tags for filtering.
    #[serde(default)]
    pub tags: Vec<String>,
    /// Catalog author.
    pub author: StoreAuthor,
    /// SPDX license identifier.
    #[serde(default)]
    pub license: Option<String>,
    /// `owner/repo` GitHub repository identifier used to resolve releases.
    pub repo: String,
    /// Icon URL or path.
    #[serde(default)]
    pub icon: Option<String>,
    /// Cover image URL or path.
    #[serde(default)]
    pub cover: Option<String>,
    /// Whether the module is verified by Lumen.
    #[serde(rename = "lumenVerified", default)]
    pub lumen_verified: Option<bool>,
    /// Review status; only `"approved"` entries are installable.
    #[serde(default)]
    pub status: String,
    /// ISO-8601 timestamp of when the entry was approved.
    #[serde(default)]
    pub approved_at: Option<String>,
}

/// The full community catalog document.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoreCatalog {
    /// Schema version; must equal `CATALOG_SCHEMA_VERSION` to be accepted.
    #[serde(default)]
    pub schema_version: i64,
    /// ISO-8601 timestamp of when the catalog was generated.
    #[serde(default)]
    pub generated_at: Option<String>,
    /// The catalogued modules.
    #[serde(default)]
    pub modules: Vec<StoreCatalogModule>,
}

/// Result of a catalog fetch, indicating whether the data is fresh or cached.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoreCatalogResponse {
    /// The catalog contents.
    pub catalog: StoreCatalog,
    /// `true` when served from cache because the network fetch failed.
    pub stale: bool,
    /// `true` when served from the on-disk cache.
    pub cached: bool,
}

/// A downloadable asset attached to a GitHub release.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseAsset {
    /// Asset file name (expected to end in `.lumenpack`).
    pub name: String,
    /// Direct download URL.
    #[serde(rename = "browser_download_url")]
    pub browser_download_url: String,
    /// Size in bytes, as reported by GitHub.
    pub size: u64,
}

/// The subset of a GitHub release used by the store.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubRelease {
    /// Git tag of the release (e.g. `v1.2.3`).
    #[serde(rename = "tag_name")]
    pub tag_name: String,
    /// ISO-8601 publication timestamp.
    #[serde(default)]
    pub published_at: Option<String>,
    /// Attached downloadable assets.
    #[serde(default)]
    pub assets: Vec<ReleaseAsset>,
}

/// Result of a release lookup, indicating cache and missing-release state.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoreReleaseResponse {
    /// The release, when one was found (fresh or cached).
    pub release: Option<GithubRelease>,
    /// `true` when the cached release was served because the fetch failed or
    /// was rate-limited.
    pub stale: bool,
    /// `true` when the value came from the on-disk cache.
    pub cached: bool,
    /// `true` when the repository has no releases.
    pub not_found: bool,
}

/// A module README fetched from GitHub, with locale and cache metadata.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoreReadmeResponse {
    /// Raw Markdown contents of the README.
    pub content: String,
    /// The locale that matched (`""` for the base `README.md`).
    pub resolved_locale: String,
    /// `true` when served from cache after a network failure.
    pub stale: bool,
    /// `true` when served from the on-disk cache.
    pub cached: bool,
}

/// Payload of the `store:download-progress` event.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoreDownloadProgress {
    /// Module id the download belongs to.
    pub key: String,
    /// Current phase (currently only `"download"`).
    pub phase: String,
    /// Completion ratio in `0.0..=1.0` (`0.0` if the total size is unknown).
    pub progress: f64,
}

/// Returns the store data directory (`<app_data_dir>/lumen`).
fn store_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| e.to_string())
        .map(|d| d.join("lumen"))
}

/// Returns (and creates) a named subdirectory of `store-cache`.
fn store_cache_subdir(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    let dir = store_dir(app)?.join("store-cache").join(name);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Returns (and creates) the on-disk catalog cache path.
fn catalog_cache_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = store_dir(app)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("catalog.json"))
}

/// Returns the cache path for a repository's latest release.
fn release_cache_path(app: &AppHandle, repo: &str) -> Result<PathBuf, String> {
    let dir = store_cache_subdir(app, "releases")?;
    Ok(dir.join(format!("{}.json", sanitize_repo(repo))))
}

/// Returns (and creates) the directory holding downloaded `.lumenpack` files.
fn store_packs_dir(app: &AppHandle) -> Result<PathBuf, String> {
    store_cache_subdir(app, "packs")
}

/// Converts a `owner/repo` identifier into a filesystem-safe cache file name.
fn sanitize_repo(repo: &str) -> String {
    repo.replace('/', "__")
}

/// Validates a `owner/repo` GitHub identifier.
///
/// # Errors
///
/// Returns an error unless the input is exactly two non-empty path segments
/// made only of ASCII alphanumerics, `.`, `_` or `-`.
fn validate_repo(repo: &str) -> Result<(), String> {
    let parts: Vec<&str> = repo.split('/').collect();
    let ok = parts.len() == 2
        && parts.iter().all(|p| {
            !p.is_empty()
                && p.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
        });
    if !ok {
        return Err(format!("invalid repository identifier: {repo}"));
    }
    Ok(())
}

/// Returns how long ago `mtime` was, or [`Duration::ZERO`] if in the future.
fn age(mtime: SystemTime) -> Duration {
    SystemTime::now()
        .duration_since(mtime)
        .unwrap_or(Duration::ZERO)
}

/// Tauri command: fetches the community module catalog.
///
/// # Frontend API
///
/// ```text
/// invoke("store_fetch_catalog")
/// ```
///
/// Fetches the remote catalog and writes it to the on-disk cache. If the fetch
/// fails but a cached catalog with a supported schema exists, that cache is
/// returned with [`StoreCatalogResponse::stale`] and
/// [`StoreCatalogResponse::cached`] set to `true`.
///
/// # Errors
///
/// Returns an error when the fetch fails and no valid cache is available, or
/// when the catalog's schema version is not supported.
#[tauri::command]
pub async fn store_fetch_catalog(app: AppHandle) -> Result<StoreCatalogResponse, String> {
    let runtime = app.state::<ModuleRuntime>();
    let cache_path = catalog_cache_path(&app)?;

    let fetch = async {
        let response = runtime
            .http_client
            .get(CATALOG_URL)
            .send()
            .await
            .map_err(|e| format!("catalog fetch failed: {e}"))?;
        if !response.status().is_success() {
            return Err(format!("catalog fetch failed: HTTP {}", response.status()));
        }
        response.text().await.map_err(|e| format!("catalog read failed: {e}"))
    };

    match fetch.await {
        Ok(raw) => {
            let catalog: StoreCatalog = serde_json::from_str(&raw)
                .map_err(|e| format!("invalid catalog JSON: {e}"))?;
            if catalog.schema_version != CATALOG_SCHEMA_VERSION {
                return Err(format!(
                    "unsupported catalog schema v{}",
                    catalog.schema_version
                ));
            }
            let _ = fs::write(
                &cache_path,
                serde_json::to_string(&catalog).map_err(|e| e.to_string())?,
            );
            Ok(StoreCatalogResponse { catalog, stale: false, cached: false })
        }
        Err(net_error) => {
            if let Ok(raw) = fs::read_to_string(&cache_path) {
                if let Ok(catalog) = serde_json::from_str::<StoreCatalog>(&raw) {
                    if catalog.schema_version == CATALOG_SCHEMA_VERSION {
                        return Ok(StoreCatalogResponse {
                            catalog,
                            stale: true,
                            cached: true,
                        });
                    }
                }
            }
            Err(net_error)
        }
    }
}

/// Returns the catalog, preferring the on-disk cache and fetching on miss.
async fn load_catalog(app: &AppHandle) -> Result<StoreCatalog, String> {
    let cache_path = catalog_cache_path(app)?;
    if let Ok(raw) = fs::read_to_string(&cache_path) {
        if let Ok(catalog) = serde_json::from_str::<StoreCatalog>(&raw) {
            if catalog.schema_version == CATALOG_SCHEMA_VERSION {
                return Ok(catalog);
            }
        }
    }
    let response = store_fetch_catalog(app.clone()).await?;
    Ok(response.catalog)
}

/// Loads the catalog entry for `repo`, requiring it to be `approved`.
///
/// # Errors
///
/// Returns an error when `repo` is invalid, absent from the catalog, or not
/// approved for store install.
async fn load_entry(app: &AppHandle, repo: &str) -> Result<StoreCatalogModule, String> {
    validate_repo(repo)?;
    let catalog = load_catalog(app).await?;
    let entry = catalog
        .modules
        .into_iter()
        .find(|m| m.repo == repo)
        .ok_or_else(|| format!("repository {repo} is not in the catalog"))?;
    if entry.status != "approved" {
        return Err(format!("module {} is not approved for store install", entry.id));
    }
    Ok(entry)
}

/// Reads a cached release and its modification time, if both are available.
fn read_cached_release(path: &Path) -> Option<(GithubRelease, SystemTime)> {
    let meta = fs::metadata(path).ok()?;
    let mtime = meta.modified().ok()?;
    let raw = fs::read_to_string(path).ok()?;
    let release = serde_json::from_str(&raw).ok()?;
    Some((release, mtime))
}

/// Resolves the latest release for `repo`, using the cache when fresh.
///
/// Returns the cached release for up to `RELEASE_TTL` unless `force` is set.
/// On GitHub rate-limiting or a non-success status a cached release is served
/// as stale; a genuine 404 with no cache yields a `not_found` response.
async fn resolve_release_response(
    app: &AppHandle,
    repo: &str,
    force: bool,
) -> Result<StoreReleaseResponse, String> {
    validate_repo(repo)?;
    let cache_path = release_cache_path(app, repo)?;
    let cached = read_cached_release(&cache_path);

    if let Some((release, mtime)) = &cached {
        if !force && age(*mtime) <= RELEASE_TTL {
            return Ok(StoreReleaseResponse {
                release: Some(release.clone()),
                stale: false,
                cached: true,
                not_found: false,
            });
        }
    }

    let url = format!("https://api.github.com/repos/{repo}/releases/latest");
    let runtime = app.state::<ModuleRuntime>();
    let response = runtime
        .http_client
        .get(&url)
        .header(reqwest::header::ACCEPT, "application/vnd.github.v3+json")
        .send()
        .await
        .map_err(|e| format!("GitHub API request failed: {e}"))?;

    let status = response.status();

    if status == reqwest::StatusCode::FORBIDDEN
        || status == reqwest::StatusCode::TOO_MANY_REQUESTS
    {
        if let Some((release, _)) = cached {
            return Ok(StoreReleaseResponse {
                release: Some(release),
                stale: true,
                cached: true,
                not_found: false,
            });
        }
        return Err("GitHub API rate limit exceeded".into());
    }

    if status == reqwest::StatusCode::NOT_FOUND {
        if let Some((release, _)) = cached {
            return Ok(StoreReleaseResponse {
                release: Some(release),
                stale: true,
                cached: true,
                not_found: false,
            });
        }
        return Ok(StoreReleaseResponse {
            release: None,
            stale: false,
            cached: false,
            not_found: true,
        });
    }

    if !status.is_success() {
        if let Some((release, _)) = cached {
            return Ok(StoreReleaseResponse {
                release: Some(release),
                stale: true,
                cached: true,
                not_found: false,
            });
        }
        return Err(format!("GitHub API returned status {status}"));
    }

    let release: GithubRelease = response
        .json()
        .await
        .map_err(|e| format!("failed to parse release JSON: {e}"))?;

    if let Some(parent) = cache_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let _ = fs::write(
        &cache_path,
        serde_json::to_string(&release).map_err(|e| e.to_string())?,
    );

    Ok(StoreReleaseResponse {
        release: Some(release),
        stale: false,
        cached: false,
        not_found: false,
    })
}

/// Tauri command: resolves the latest GitHub release for a repository.
///
/// # Frontend API
///
/// ```text
/// invoke("store_get_release", { repo, force })
/// ```
///
/// `repo` is an `owner/repo` identifier. Pass `force = true` to bypass the
/// one-hour release cache.
///
/// # Errors
///
/// Returns an error for an invalid repository, a rate-limited GitHub API with
/// no cached fallback, or a non-success API status.
#[tauri::command]
pub async fn store_get_release(
    app: AppHandle,
    repo: String,
    force: Option<bool>,
) -> Result<StoreReleaseResponse, String> {
    resolve_release_response(&app, &repo, force.unwrap_or(false)).await
}

/// Selects the `.lumenpack` asset for `entry_id` from a release's assets.
///
/// Prefers `{entry_id}.lumenpack` or `{entry_id}-{version}.lumenpack`, then
/// falls back to the first asset that starts with the id and ends in
/// `.lumenpack`.
fn resolve_pack_asset<'a>(
    entry_id: &str,
    tag: &str,
    assets: &'a [ReleaseAsset],
) -> Option<&'a ReleaseAsset> {
    let version = tag.trim_start_matches('v');
    let exact = format!("{entry_id}.lumenpack");
    let alt = format!("{entry_id}-{version}.lumenpack");

    assets
        .iter()
        .find(|a| a.name == exact || a.name == alt)
        .or_else(|| {
            assets
                .iter()
                .find(|a| a.name.starts_with(entry_id) && a.name.ends_with(".lumenpack"))
        })
}

/// Streams a release asset into the packs cache directory.
///
/// Requires an `https` asset URL and enforces `MAX_PACK_BYTES`. Progress is
/// emitted on the `store:download-progress` event at most every 200 ms.
///
/// # Errors
///
/// Returns an error for a non-https URL, an oversized asset (declared or
/// actual), a failed download, or a write failure.
async fn download_pack(
    app: &AppHandle,
    entry: &StoreCatalogModule,
    tag: &str,
    asset: &ReleaseAsset,
) -> Result<PathBuf, String> {
    let parsed = url::Url::parse(&asset.browser_download_url)
        .map_err(|e| format!("invalid asset URL: {e}"))?;
    if parsed.scheme() != "https" {
        return Err("only https asset downloads are allowed".into());
    }
    if asset.size > MAX_PACK_BYTES {
        return Err(format!(
            "{} exceeds the 100 MB size cap",
            asset.name
        ));
    }

    let packs_dir = store_packs_dir(app)?;
    let dest = packs_dir.join(format!("{}-{}.lumenpack", entry.id, tag.trim_start_matches('v')));

    let runtime = app.state::<ModuleRuntime>();
    let response = runtime
        .http_client
        .get(&asset.browser_download_url)
        .send()
        .await
        .map_err(|e| format!("download failed: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("download failed: HTTP {}", response.status()));
    }

    let total = response.content_length().unwrap_or(0);
    if total > MAX_PACK_BYTES {
        return Err("asset exceeds the 100 MB size cap".into());
    }

    let mut file = fs::File::create(&dest).map_err(|e| e.to_string())?;
    let mut stream = response.bytes_stream();
    let mut written: u64 = 0;
    let mut last_emit = Instant::now();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        written += chunk.len() as u64;
        if written > MAX_PACK_BYTES {
            drop(file);
            let _ = fs::remove_file(&dest);
            return Err("pack exceeds the 100 MB size cap".into());
        }
        file.write_all(&chunk).map_err(|e| e.to_string())?;

        if last_emit.elapsed() >= Duration::from_millis(200) {
            let progress = if total > 0 {
                (written as f64 / total as f64).min(1.0)
            } else {
                0.0
            };
            app.emit(
                "store:download-progress",
                StoreDownloadProgress {
                    key: entry.id.clone(),
                    phase: "download".into(),
                    progress,
                },
            )
            .ok();
            last_emit = Instant::now();
        }
    }

    Ok(dest)
}

/// Tauri command: downloads a module's `.lumenpack` without installing it.
///
/// # Frontend API
///
/// ```text
/// invoke("store_download_module", { repo, tag })
/// ```
///
/// Returns the absolute path of the downloaded pack. `tag` is currently
/// informational; the latest release is always used.
///
/// # Errors
///
/// Returns an error when the entry or release cannot be resolved, the release
/// has no `.lumenpack` asset, or the download fails.
#[tauri::command]
pub async fn store_download_module(
    app: AppHandle,
    repo: String,
    tag: String,
) -> Result<String, String> {
    let entry = load_entry(&app, &repo).await?;
    let release = resolve_release_response(&app, &repo, false)
        .await?
        .release
        .ok_or_else(|| format!("no release found for {repo}"))?;
    let asset = resolve_pack_asset(&entry.id, &release.tag_name, &release.assets)
        .ok_or_else(|| format!("no .lumenpack asset in the latest release of {}", entry.name))?;
    let path = download_pack(&app, &entry, &release.tag_name, asset).await?;
    Ok(path.to_string_lossy().to_string())
}

/// Tauri command: downloads and installs a module from the community store.
///
/// # Frontend API
///
/// ```text
/// invoke("store_install", { repo, tag })
/// ```
///
/// Resolves the latest release, downloads and verifies the `.lumenpack`,
/// installs it, and records it in the registry with `source = "store"`. The
/// pack's manifest id must match the catalog entry id. Emits `module:installed`
/// on success.
///
/// # Errors
///
/// Returns an error when the entry/release/asset cannot be resolved, the
/// identity check fails (in which case the partial install is rolled back), or
/// the install itself fails.
#[tauri::command]
pub async fn store_install(
    app: AppHandle,
    repo: String,
    tag: String,
) -> Result<InstalledModule, String> {
    let entry = load_entry(&app, &repo).await?;
    let release = resolve_release_response(&app, &repo, false)
        .await?
        .release
        .ok_or_else(|| format!("no release found for {repo}"))?;

    if !tag.is_empty() && tag != "latest" && tag != release.tag_name {
        return Err(format!(
            "requested tag {tag} is not the latest release ({})",
            release.tag_name
        ));
    }

    let asset = resolve_pack_asset(&entry.id, &release.tag_name, &release.assets)
        .ok_or_else(|| format!("no .lumenpack asset in the latest release of {}", entry.name))?;
    let pack = download_pack(&app, &entry, &release.tag_name, asset).await?;

    let runtime = app.state::<ModuleRuntime>();
    let reg = runtime.registry.lock().map_err(|e| e.to_string())?;
    let installer = Installer::new(&runtime.modules_dir, &reg);
    let manifest = installer.install_from_path(&pack, false)?;

    if manifest.id != entry.id {
        let _ = fs::remove_dir_all(runtime.modules_dir.join(&manifest.id));
        let _ = reg.remove(&manifest.id);
        return Err(format!(
            "module identity mismatch: pack manifests as '{}', catalog declares '{}'",
            manifest.id, entry.id
        ));
    }

    reg.insert(&ModuleEntry {
        id: manifest.id.clone(),
        version: manifest.version.clone(),
        source: "store".into(),
        enabled: true,
        path: runtime.modules_dir.join(&manifest.id),
    })
    .map_err(|e| e.to_string())?;
    drop(reg);

    runtime.invalidate_manifest_cache(&manifest.id);
    let _ = fs::remove_file(&pack);

    let installed = InstalledModule {
        manifest,
        source: "store".into(),
        enabled: true,
    };
    let _ = app.emit("module:installed", &installed);

    Ok(installed)
}

/// Tauri command: fetches a module's README from its repository.
///
/// # Frontend API
///
/// ```text
/// invoke("store_get_readme", { repo, branch, locale })
/// ```
///
/// Probes `README.{locale}.md` then `README.md` on the requested branch, or on
/// `main`/`master` when `branch` is omitted. Returns `Ok(None)` when no README
/// is found.
///
/// # Errors
///
/// Returns an error only for an invalid repository identifier; individual
/// fetch failures are treated as "not found".
#[tauri::command]
pub async fn store_get_readme(
    app: AppHandle,
    repo: String,
    branch: Option<String>,
    locale: Option<String>,
) -> Result<Option<StoreReadmeResponse>, String> {
    validate_repo(&repo)?;
    let runtime = app.state::<ModuleRuntime>();

    let branches: Vec<String> = branch
        .filter(|b| !b.is_empty())
        .map(|b| vec![b])
        .unwrap_or_else(|| DEFAULT_BRANCHES.iter().map(|s| s.to_string()).collect());

    let locale = locale.filter(|l| !l.is_empty());
    let files: Vec<String> = match &locale {
        Some(loc) => vec![format!("README.{loc}.md"), "README.md".into()],
        None => vec!["README.md".into()],
    };

    for branch in &branches {
        for file in &files {
            let url = format!("https://raw.githubusercontent.com/{repo}/{branch}/{file}");
            let response = match runtime.http_client.get(&url).send().await {
                Ok(r) => r,
                Err(_) => continue,
            };
            if response.status() == reqwest::StatusCode::NOT_FOUND {
                continue;
            }
            if !response.status().is_success() {
                continue;
            }
            if let Some(len) = response.content_length() {
                if len > MAX_README_BYTES {
                    continue;
                }
            }
            let text = match response.text().await {
                Ok(t) => t,
                Err(_) => continue,
            };
            let resolved_locale = if file == "README.md" {
                String::new()
            } else {
                locale.clone().unwrap_or_default()
            };
            return Ok(Some(StoreReadmeResponse {
                content: text,
                resolved_locale,
                stale: false,
                cached: false,
            }));
        }
    }

    Ok(None)
}

/// Tauri command: fetches and validates a module's `manifest.json` from GitHub.
///
/// # Frontend API
///
/// ```text
/// invoke("store_get_manifest", { repo, branch })
/// ```
///
/// Probes the requested branch, or `main`/`master` when omitted, and validates
/// the fetched manifest. Returns `Ok(None)` when none is found.
///
/// # Errors
///
/// Returns an error for an invalid repository identifier, an invalid
/// `manifest.json` (parse or validation failure); individual fetch failures are
/// treated as "not found".
#[tauri::command]
pub async fn store_get_manifest(
    app: AppHandle,
    repo: String,
    branch: Option<String>,
) -> Result<Option<ModuleManifest>, String> {
    validate_repo(&repo)?;
    let runtime = app.state::<ModuleRuntime>();

    let branches: Vec<String> = branch
        .filter(|b| !b.is_empty())
        .map(|b| vec![b])
        .unwrap_or_else(|| DEFAULT_BRANCHES.iter().map(|s| s.to_string()).collect());

    for branch in &branches {
        let url = format!("https://raw.githubusercontent.com/{repo}/{branch}/manifest.json");
        let response = match runtime.http_client.get(&url).send().await {
            Ok(r) => r,
            Err(_) => continue,
        };
        if response.status() == reqwest::StatusCode::NOT_FOUND {
            continue;
        }
        if !response.status().is_success() {
            continue;
        }
        if let Some(len) = response.content_length() {
            if len > MAX_README_BYTES {
                continue;
            }
        }
        let text = match response.text().await {
            Ok(t) => t,
            Err(_) => continue,
        };
        let manifest: ModuleManifest = serde_json::from_str(&text)
            .map_err(|e| format!("invalid manifest.json: {e}"))?;
        manifest.validate().map_err(|e| e.to_string())?;
        return Ok(Some(manifest));
    }

    Ok(None)
}