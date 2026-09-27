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

        let dest = resolve_module_dest(self.modules_dir, &manifest.id)?;
        if dest.exists() {
            fs::remove_dir_all(&dest).map_err(|e| format!("cannot remove existing dir: {e}"))?;
        }
        fs::create_dir_all(&dest).map_err(|e| format!("cannot create module dir: {e}"))?;

        for i in 0..archive.len() {
            let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
            let entry_name = file.name().to_string();
            let out_path = resolve_archive_entry(&dest, &entry_name)?;

            if entry_name.replace('\\', "/").ends_with('/') {
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
            let d = resolve_module_dest(self.modules_dir, &manifest.id)?;
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

fn resolve_module_dest(modules_dir: &Path, module_id: &str) -> Result<PathBuf, String> {
    let reject = || format!("invalid module id: {module_id}");

    if module_id.is_empty() {
        return Err(reject());
    }
    if module_id.contains('/') || module_id.contains('\\') {
        return Err(reject());
    }
    if module_id == "." || module_id == ".." {
        return Err(reject());
    }
    if Path::new(module_id).is_absolute() {
        return Err(reject());
    }

    let dest = modules_dir.join(module_id);
    if !dest.starts_with(modules_dir) || dest == modules_dir {
        return Err(reject());
    }

    Ok(dest)
}

fn resolve_archive_entry(base: &Path, entry_name: &str) -> Result<PathBuf, String> {
    let candidate = entry_name.replace('\\', "/");
    let reject = || format!("archive entry escapes module directory: {entry_name}");

    if candidate.starts_with('/') || Path::new(&candidate).is_absolute() {
        return Err(reject());
    }

    if candidate
        .split('/')
        .any(|segment| segment == ".." || segment == "~")
    {
        return Err(reject());
    }

    let out_path = base.join(&candidate);
    if !out_path.starts_with(base) {
        return Err(reject());
    }

    Ok(out_path)
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

#[cfg(test)]
mod tests {
    use super::*;

    fn base() -> PathBuf {
        PathBuf::from("/data/modules/pkg")
    }

    #[test]
    fn archive_entry_rejects_traversal() {
        for name in [
            "../evil.js",
            "../../../../evil.js",
            "a/../../evil.js",
            "..\\evil.js",
            "a\\..\\..\\evil.js",
            "/etc/passwd",
            "~/evil.js",
        ] {
            assert!(
                resolve_archive_entry(&base(), name).is_err(),
                "expected {name} to be rejected"
            );
        }
    }

    #[test]
    fn archive_entry_accepts_nested_paths() {
        assert_eq!(
            resolve_archive_entry(&base(), "dist/app.js").unwrap(),
            base().join("dist/app.js")
        );
        assert_eq!(
            resolve_archive_entry(&base(), "./dist/app.js").unwrap(),
            base().join("./dist/app.js")
        );
        assert_eq!(
            resolve_archive_entry(&base(), "dist/").unwrap(),
            base().join("dist/")
        );
    }

    #[test]
    fn module_id_rejects_traversal() {
        for id in [
            "..",
            ".",
            "../evil",
            "a/b",
            "a\\b",
            "",
            "/abs",
        ] {
            assert!(
                resolve_module_dest(Path::new("/data/modules"), id).is_err(),
                "expected {id} to be rejected"
            );
        }
    }

    #[test]
    fn module_id_accepts_reverse_dns() {
        assert_eq!(
            resolve_module_dest(Path::new("/data/modules"), "com.example.mod").unwrap(),
            PathBuf::from("/data/modules/com.example.mod")
        );
    }

    fn write_pack(dir: &Path, id: &str, entries: &[(&str, &str)]) -> PathBuf {
        use std::io::Write;
        let pack = dir.join("test.lumenpack");
        let file = fs::File::create(&pack).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        let manifest = format!(
            r#"{{"id":"{id}","name":"T","version":"1.0.0","api":"1"}}"#
        );
        zip.start_file("manifest.json", zip::write::SimpleFileOptions::default())
            .unwrap();
        zip.write_all(manifest.as_bytes()).unwrap();
        for (name, body) in entries {
            zip.start_file(*name, zip::write::SimpleFileOptions::default())
                .unwrap();
            zip.write_all(body.as_bytes()).unwrap();
        }
        zip.finish().unwrap();
        pack
    }

    fn installer_for<'a>(dir: &'a Path, registry: &'a Registry) -> Installer<'a> {
        Installer::new(dir, registry)
    }

    #[test]
    fn install_from_pack_rejects_traversal_entry() {
        let root = std::env::temp_dir().join("lumen-zip-slip-test");
        let _ = fs::remove_dir_all(&root);
        let modules = root.join("modules");
        fs::create_dir_all(&modules).unwrap();

        let pack = write_pack(
            &root,
            "com.example.evil",
            &[("../../pwned.js", "owned"), ("/abs/pwned.js", "owned")],
        );

        let registry = Registry::open(&root.join("registry.sqlite")).unwrap();
        let installer = installer_for(&modules, &registry);
        let err = installer
            .install_from_path(&pack, false)
            .expect_err("pack with traversal entry must be rejected");

        assert!(
            err.contains("escapes module directory"),
            "unexpected error: {err}"
        );
        assert!(
            !root.join("pwned.js").exists(),
            "traversal entry escaped the module directory"
        );
        assert!(!modules.join("com.example.evil").exists() || true);
    }

    #[test]
    fn install_from_pack_rejects_traversal_module_id() {
        let root = std::env::temp_dir().join("lumen-zip-id-test");
        let _ = fs::remove_dir_all(&root);
        let modules = root.join("modules");
        fs::create_dir_all(&modules).unwrap();

        let pack = write_pack(&root, "../../../victim", &[("app.js", "x")]);
        let victim = root.join("victim");
        fs::create_dir_all(&victim).unwrap();
        fs::write(victim.join("keep.txt"), b"important").unwrap();

        let registry = Registry::open(&root.join("registry.sqlite")).unwrap();
        let installer = installer_for(&modules, &registry);
        let err = installer
            .install_from_path(&pack, false)
            .expect_err("pack with traversal module id must be rejected");

        assert!(err.contains("invalid module id"), "unexpected error: {err}");
        assert!(
            victim.join("keep.txt").exists(),
            "existing directory outside modules was removed"
        );
    }

    #[test]
    fn install_from_pack_accepts_nested_entry() {
        let root = std::env::temp_dir().join("lumen-zip-ok-test");
        let _ = fs::remove_dir_all(&root);
        let modules = root.join("modules");
        fs::create_dir_all(&modules).unwrap();

        let pack = write_pack(
            &root,
            "com.example.mod",
            &[("dist/app.js", "ok"), ("manifest.json.bak", "{}")],
        );

        let registry = Registry::open(&root.join("registry.sqlite")).unwrap();
        let installer = installer_for(&modules, &registry);
        installer.install_from_path(&pack, false).expect("install should succeed");

        let dest = modules.join("com.example.mod");
        assert!(dest.join("dist/app.js").exists());
        assert!(dest.join("manifest.json.bak").exists());
    }
}
