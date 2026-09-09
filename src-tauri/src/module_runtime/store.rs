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

const CATALOG_URL: &str =
    "https://raw.githubusercontent.com/Lumen-media/community-modules/main/modules.json";
const CATALOG_SCHEMA_VERSION: i64 = 1;
const MAX_PACK_BYTES: u64 = 100 * 1024 * 1024;
const MAX_README_BYTES: u64 = 2 * 1024 * 1024;
const RELEASE_TTL: Duration = Duration::from_secs(60 * 60);

const DEFAULT_BRANCHES: [&str; 2] = ["main", "master"];

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoreAuthor {
    pub name: String,
    pub url: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoreCatalogModule {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub tagline: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    pub author: StoreAuthor,
    #[serde(default)]
    pub license: Option<String>,
    pub repo: String,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub cover: Option<String>,
    #[serde(rename = "lumenVerified", default)]
    pub lumen_verified: Option<bool>,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub approved_at: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoreCatalog {
    #[serde(default)]
    pub schema_version: i64,
    #[serde(default)]
    pub generated_at: Option<String>,
    #[serde(default)]
    pub modules: Vec<StoreCatalogModule>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoreCatalogResponse {
    pub catalog: StoreCatalog,
    pub stale: bool,
    pub cached: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseAsset {
    pub name: String,
    #[serde(rename = "browser_download_url")]
    pub browser_download_url: String,
    pub size: u64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubRelease {
    #[serde(rename = "tag_name")]
    pub tag_name: String,
    #[serde(default)]
    pub published_at: Option<String>,
    #[serde(default)]
    pub assets: Vec<ReleaseAsset>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoreReleaseResponse {
    pub release: Option<GithubRelease>,
    pub stale: bool,
    pub cached: bool,
    pub not_found: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoreReadmeResponse {
    pub content: String,
    pub resolved_locale: String,
    pub stale: bool,
    pub cached: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoreDownloadProgress {
    pub key: String,
    pub phase: String,
    pub progress: f64,
}

fn store_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| e.to_string())
        .map(|d| d.join("lumen"))
}

fn store_cache_subdir(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    let dir = store_dir(app)?.join("store-cache").join(name);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn catalog_cache_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = store_dir(app)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("catalog.json"))
}

fn release_cache_path(app: &AppHandle, repo: &str) -> Result<PathBuf, String> {
    let dir = store_cache_subdir(app, "releases")?;
    Ok(dir.join(format!("{}.json", sanitize_repo(repo))))
}

fn store_packs_dir(app: &AppHandle) -> Result<PathBuf, String> {
    store_cache_subdir(app, "packs")
}

fn sanitize_repo(repo: &str) -> String {
    repo.replace('/', "__")
}

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

fn age(mtime: SystemTime) -> Duration {
    SystemTime::now()
        .duration_since(mtime)
        .unwrap_or(Duration::ZERO)
}

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

fn read_cached_release(path: &Path) -> Option<(GithubRelease, SystemTime)> {
    let meta = fs::metadata(path).ok()?;
    let mtime = meta.modified().ok()?;
    let raw = fs::read_to_string(path).ok()?;
    let release = serde_json::from_str(&raw).ok()?;
    Some((release, mtime))
}

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

#[tauri::command]
pub async fn store_get_release(
    app: AppHandle,
    repo: String,
    force: Option<bool>,
) -> Result<StoreReleaseResponse, String> {
    resolve_release_response(&app, &repo, force.unwrap_or(false)).await
}

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