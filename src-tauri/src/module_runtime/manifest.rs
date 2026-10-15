//! Manifest schema and loading for Lumen modules.
//!
//! Every Lumen module ships a `manifest.json` file at its root. This module
//! defines the on-disk shape of that file ([`ModuleManifest`]) together with
//! its optional sub-objects ([`ModuleAuthor`], [`ModulePermissions`]), and
//! provides the loading/validation entry point [`load_manifest`].
//!
//! The manifest is the single source of truth used by the installer, the
//! registry, the network permission checker and the module store, so the
//! validation rules implemented here are security-relevant: they reject empty
//! or non reverse-DNS identifiers before any path derived from the manifest id
//! is created on disk.
//!
//! # Examples
//!
//! ```
//! # use crate::module_runtime::manifest::ModuleManifest;
//! let json = r#"{
//!     "id": "com.example.hello",
//!     "name": "Hello",
//!     "version": "1.0.0",
//!     "api": "1"
//! }"#;
//! let manifest: ModuleManifest = serde_json::from_str(json).unwrap();
//! manifest.validate().unwrap();
//! assert_eq!(manifest.entry_file(), "main.js");
//! ```

use serde::{Deserialize, Serialize};

/// Deserialized contents of a module's `manifest.json`.
///
/// The struct mirrors the JSON object exactly; unknown fields are ignored and
/// optional metadata is represented as [`Option`]. The four fields without an
/// `Option` wrapper (`id`, `name`, `version`, `api`) are the minimum required
/// by [`ModuleManifest::validate`].
///
/// # Examples
///
/// ```
/// # use crate::module_runtime::manifest::ModuleManifest;
/// let manifest: ModuleManifest = serde_json::from_str(r#"{
///     "id": "com.acme.tools",
///     "name": "Acme Tools",
///     "version": "2.1.0",
///     "api": "1",
///     "minLumenVersion": "0.4.0",
///     "entry": "dist/index.js",
///     "permissions": { "network": ["https://api.example.com/*"] }
/// }"#).unwrap();
///
/// assert_eq!(manifest.entry_file(), "dist/index.js");
/// assert_eq!(manifest.permissions.unwrap().network.len(), 1);
/// ```
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModuleManifest {
    /// Unique reverse-DNS identifier of the module (e.g. `com.example.my-module`).
    ///
    /// Used as the directory name under the modules root, as the registry
    /// primary key and as the `{id}` segment of `lumen-module://{id}/...` URIs.
    pub id: String,
    /// Human-readable display name shown in the module store and settings UI.
    pub name: String,
    /// Module version string (recommended [semantic versioning](https://semver.org)).
    pub version: String,
    /// Version of the Lumen module API the module was built against.
    pub api: String,
    /// Minimum Lumen application version required by the module (`minLumenVersion`).
    ///
    /// When present, the frontend can refuse to enable the module on older
    /// hosts. Not enforced by the backend loader itself.
    #[serde(rename = "minLumenVersion")]
    pub min_lumen_version: Option<String>,
    /// Short description of what the module does.
    pub description: Option<String>,
    /// Author metadata (name and optional homepage URL).
    pub author: Option<ModuleAuthor>,
    /// Path of the module's entry script, relative to the module root.
    ///
    /// Defaults to `main.js`; see [`ModuleManifest::entry_file`].
    pub entry: Option<String>,
    /// Path or URL of the module icon, relative to the module root.
    pub icon: Option<String>,
    /// URL of the module's homepage.
    pub homepage: Option<String>,
    /// URL of the module's source repository.
    pub repository: Option<String>,
    /// SPDX license identifier of the module.
    pub license: Option<String>,
    /// Declared capabilities, currently only network host allow-listing.
    ///
    /// Absent permissions are treated as an empty allow-list by
    /// [`crate::module_runtime::net::check_url_allowed`], which still permits
    /// any public HTTPS host (private hosts are always blocked).
    #[serde(default)]
    pub permissions: Option<ModulePermissions>,
}

/// Capability grants requested by a module in its manifest.
///
/// Used by the network proxy to decide which URLs a module may contact.
///
/// # Examples
///
/// ```
/// # use crate::module_runtime::manifest::ModulePermissions;
/// let permissions: ModulePermissions =
///     serde_json::from_str(r#"{ "network": ["https://*.example.com/*"] }"#).unwrap();
/// assert_eq!(permissions.network, vec!["https://*.example.com/*"]);
/// ```
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModulePermissions {
    /// URL patterns the module may request, matched by
    /// [`crate::module_runtime::net::check_url_allowed`].
    ///
    /// Patterns are full URLs supporting a `*.` host wildcard (e.g.
    /// `https://*.example.com/*`) and a trailing `*` in the path (e.g.
    /// `https://api.example.com/v1/*`). An empty list places no
    /// host-specific restriction on top of the built-in HTTPS-only and
    /// private-network rules.
    pub network: Vec<String>,
}

/// Author metadata embedded in a module manifest.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModuleAuthor {
    /// Display name of the author or publishing organization.
    pub name: String,
    /// Optional URL pointing to the author's homepage or profile.
    pub url: Option<String>,
}

impl ModuleManifest {
    /// Returns the module's entry script path relative to the module root.
    ///
    /// Falls back to `"main.js"` when the manifest does not declare an
    /// `entry` field.
    ///
    /// # Examples
    ///
    /// ```
    /// # use crate::module_runtime::manifest::ModuleManifest;
    /// # let m: ModuleManifest = serde_json::from_str(
    /// #     r#"{"id":"a.b","name":"n","version":"1","api":"1"}"#).unwrap();
    /// assert_eq!(m.entry_file(), "main.js");
    /// ```
    pub fn entry_file(&self) -> &str {
        self.entry.as_deref().unwrap_or("main.js")
    }

    /// Validates the required fields of the manifest.
    ///
    /// Checks that `id`, `name`, `version` and `api` are non-empty and that
    /// `id` is reverse-DNS shaped (contains at least one `.`), which is also
    /// the guard that keeps the id usable as a single path segment.
    ///
    /// # Returns
    ///
    /// * `Ok(())` when the manifest satisfies every rule.
    /// * `Err(String)` with a human-readable message naming the offending
    ///   field when a rule fails.
    ///
    /// # Examples
    ///
    /// ```
    /// # use crate::module_runtime::manifest::ModuleManifest;
    /// let mut manifest: ModuleManifest = serde_json::from_str(r#"{
    ///     "id": "com.example.mod",
    ///     "name": "Example",
    ///     "version": "1.0.0",
    ///     "api": "1"
    /// }"#).unwrap();
    /// assert!(manifest.validate().is_ok());
    ///
    /// manifest.id = "nodots".into();
    /// let err = manifest.validate().unwrap_err();
    /// assert!(err.contains("reverse-DNS"));
    /// ```
    pub fn validate(&self) -> Result<(), String> {
        if self.id.is_empty() {
            return Err("manifest.id is required".into());
        }
        if !self.id.contains('.') {
            return Err("manifest.id must be reverse-DNS (e.g. com.example.my-module)".into());
        }
        if self.name.is_empty() {
            return Err("manifest.name is required".into());
        }
        if self.version.is_empty() {
            return Err("manifest.version is required".into());
        }
        if self.api.is_empty() {
            return Err("manifest.api is required".into());
        }
        Ok(())
    }
}

/// Reads, parses and validates `manifest.json` inside `dir`.
///
/// The manifest must sit directly in `dir`; the file name is fixed to
/// `manifest.json`. After parsing, [`ModuleManifest::validate`] is applied, so
/// a returned manifest is guaranteed to satisfy the validation rules.
///
/// # Examples
///
/// ```no_run
/// # use std::path::Path;
/// # use crate::module_runtime::manifest::load_manifest;
/// let manifest = load_manifest(Path::new("/path/to/module"))?;
/// println!("module {} v{}", manifest.name, manifest.version);
/// # Ok::<(), String>(())
/// ```
///
/// # Errors
///
/// Returns an error that includes the manifest path when:
///
/// * the file cannot be read (missing file, permissions),
/// * the file is not valid JSON,
/// * the parsed manifest fails [`ModuleManifest::validate`].
pub fn load_manifest(dir: &std::path::Path) -> Result<ModuleManifest, String> {
    let path = dir.join("manifest.json");
    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("failed to read manifest at {}: {e}", path.display()))?;
    let manifest: ModuleManifest = serde_json::from_str(&content)
        .map_err(|e| format!("failed to parse manifest at {}: {e}", path.display()))?;
    manifest.validate()?;
    Ok(manifest)
}
