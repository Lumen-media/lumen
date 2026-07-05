use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModuleManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    pub api: String,
    #[serde(rename = "minLumenVersion")]
    pub min_lumen_version: Option<String>,
    pub description: Option<String>,
    pub author: Option<ModuleAuthor>,
    pub entry: Option<String>,
    pub icon: Option<String>,
    pub homepage: Option<String>,
    pub repository: Option<String>,
    pub license: Option<String>,
    #[serde(default)]
    pub permissions: Option<ModulePermissions>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModulePermissions {
    pub network: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModuleAuthor {
    pub name: String,
    pub url: Option<String>,
}

impl ModuleManifest {
    pub fn entry_file(&self) -> &str {
        self.entry.as_deref().unwrap_or("main.js")
    }

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

pub fn load_manifest(dir: &std::path::Path) -> Result<ModuleManifest, String> {
    let path = dir.join("manifest.json");
    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("failed to read manifest at {}: {e}", path.display()))?;
    let manifest: ModuleManifest = serde_json::from_str(&content)
        .map_err(|e| format!("failed to parse manifest at {}: {e}", path.display()))?;
    manifest.validate()?;
    Ok(manifest)
}
