use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use zip::ZipArchive;

use crate::module_runtime::manifest::{load_manifest, ModuleManifest};
use crate::module_runtime::registry::{ModuleEntry, Registry};

pub struct Installer<'a> {
    modules_dir: &'a Path,
    registry: &'a Registry,
}

impl<'a> Installer<'a> {
    pub fn new(modules_dir: &'a Path, registry: &'a Registry) -> Self {
        Self { modules_dir, registry }
    }

    pub fn install_from_path(
        &self,
        source_path: &Path,
        dev_mode: bool,
    ) -> Result<ModuleManifest, String> {
        let ext = source_path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("");

        if ext == "lumenpack" {
            self.install_from_pack(source_path)
        } else if source_path.is_dir() {
            self.install_from_dir(source_path, dev_mode)
        } else {
            Err(format!(
                "unsupported source: {}. Expected a .lumenpack file or a directory.",
                source_path.display()
            ))
        }
    }

    fn install_from_pack(&self, pack_path: &Path) -> Result<ModuleManifest, String> {
        let file = fs::File::open(pack_path)
            .map_err(|e| format!("cannot open pack: {e}"))?;
        let mut archive =
            ZipArchive::new(file).map_err(|e| format!("invalid zip archive: {e}"))?;

        let manifest = extract_manifest_from_archive(&mut archive)?;
        manifest.validate()?;

        let dest = self.modules_dir.join(&manifest.id);
        if dest.exists() {
            fs::remove_dir_all(&dest).map_err(|e| format!("cannot remove existing dir: {e}"))?;
        }
        fs::create_dir_all(&dest).map_err(|e| format!("cannot create module dir: {e}"))?;

        for i in 0..archive.len() {
            let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
            let out_path = dest.join(file.name());

            if file.name().ends_with('/') {
                fs::create_dir_all(&out_path).map_err(|e| e.to_string())?;
            } else {
                if let Some(parent) = out_path.parent() {
                    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
                }
                let mut out =
                    fs::File::create(&out_path).map_err(|e| e.to_string())?;
                std::io::copy(&mut file, &mut out).map_err(|e| e.to_string())?;
            }
        }

        self.registry
            .insert(&ModuleEntry {
                id: manifest.id.clone(),
                version: manifest.version.clone(),
                source: "sideload".into(),
                enabled: true,
                path: dest,
            })
            .map_err(|e| e.to_string())?;

        Ok(manifest)
    }

    fn install_from_dir(&self, dir: &Path, dev_mode: bool) -> Result<ModuleManifest, String> {
        let manifest = load_manifest(dir)?;

        let dest: PathBuf = if dev_mode {
            dir.to_path_buf()
        } else {
            let d = self.modules_dir.join(&manifest.id);
            if d.exists() {
                fs::remove_dir_all(&d).map_err(|e| format!("cannot remove existing dir: {e}"))?;
            }
            copy_dir_all(dir, &d)?;
            d
        };

        self.registry
            .insert(&ModuleEntry {
                id: manifest.id.clone(),
                version: manifest.version.clone(),
                source: if dev_mode { "dev" } else { "sideload" }.into(),
                enabled: true,
                path: dest,
            })
            .map_err(|e| e.to_string())?;

        Ok(manifest)
    }
}

fn extract_manifest_from_archive(
    archive: &mut ZipArchive<fs::File>,
) -> Result<ModuleManifest, String> {
    let mut file = archive
        .by_name("manifest.json")
        .map_err(|_| "manifest.json not found in archive")?;
    let mut content = String::new();
    file.read_to_string(&mut content)
        .map_err(|e| format!("cannot read manifest.json: {e}"))?;
    serde_json::from_str(&content).map_err(|e| format!("invalid manifest.json: {e}"))
}

fn copy_dir_all(src: &Path, dst: &Path) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|e| e.to_string())?;
    for entry in fs::read_dir(src).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let dst_path = dst.join(entry.file_name());
        if entry.file_type().map_err(|e| e.to_string())?.is_dir() {
            copy_dir_all(&entry.path(), &dst_path)?;
        } else {
            fs::copy(entry.path(), &dst_path).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}
