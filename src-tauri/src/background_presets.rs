//! Generator presets owned by Rust.
//!
//! One pretty-printed `<id>.json` file per user preset lives under
//! `<base>/config/background-presets/`; built-ins are defined in code and
//! merged with the user list. Every parameter is validated and clamped
//! against the catalog before it is persisted, so the webview can never
//! introduce an effect or a value the engine does not understand.

use std::collections::BTreeMap;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use lumen_lib::backgrounds_spike::catalog;
use lumen_lib::backgrounds_spike::schema::{ParamKind, ParamValue};

/// A saved generator configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratorPreset {
    /// Stable identifier; also the file name for user presets.
    pub id: String,
    /// Display name chosen by the user.
    pub name: String,
    /// Effect id from the Rust catalog.
    pub effect: String,
    /// Parameter overrides keyed by catalog key.
    #[serde(default)]
    pub params: BTreeMap<String, Value>,
    /// Reproducible variation seed.
    #[serde(default)]
    pub seed: u32,
    /// Creation time in Unix milliseconds, used to order listings.
    #[serde(default)]
    pub created_at: i64,
    /// Catalog version the preset was authored against.
    #[serde(default = "default_version")]
    pub version: u32,
    /// Built-ins ship with the app and cannot be edited or deleted.
    #[serde(default)]
    pub built_in: bool,
}

fn default_version() -> u32 {
    1
}

fn presets_dir() -> Result<PathBuf, String> {
    let dir = crate::remote::app_base_dir()?
        .join("config")
        .join("background-presets");
    std::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir)
}

fn params(entries: &[(&str, f64)]) -> BTreeMap<String, Value> {
    entries
        .iter()
        .map(|(key, value)| ((*key).to_string(), serde_json::json!(value)))
        .collect()
}

fn builtin_presets() -> Vec<GeneratorPreset> {
    vec![
        GeneratorPreset {
            id: "builtin-calm-aurora".to_string(),
            name: "Calm aurora".to_string(),
            effect: "aurora".to_string(),
            params: params(&[
                ("bands", 4.0),
                ("flow", 0.35),
                ("glow", 0.6),
                ("hueShift", 0.1),
                ("speed", 0.6),
                ("intensity", 0.7),
            ]),
            seed: 42,
            created_at: 0,
            version: 1,
            built_in: true,
        },
        GeneratorPreset {
            id: "builtin-deep-space".to_string(),
            name: "Deep space".to_string(),
            effect: "starfield".to_string(),
            params: params(&[
                ("density", 0.45),
                ("twinkle", 0.7),
                ("warp", 0.15),
                ("depth", 0.7),
                ("speed", 0.4),
                ("intensity", 0.9),
            ]),
            seed: 7,
            created_at: 0,
            version: 1,
            built_in: true,
        },
        GeneratorPreset {
            id: "builtin-stage-smoke".to_string(),
            name: "Stage smoke".to_string(),
            effect: "smoke".to_string(),
            params: params(&[
                ("viscosity", 0.35),
                ("buoyancy", 0.55),
                ("dissipation", 0.35),
                ("detail", 4.0),
                ("speed", 0.8),
                ("intensity", 0.9),
            ]),
            seed: 21,
            created_at: 0,
            version: 1,
            built_in: true,
        },
    ]
}

fn is_hex_color(value: &str) -> bool {
    value.len() == 7
        && value.starts_with('#')
        && value[1..].chars().all(|c| c.is_ascii_hexdigit())
}

fn safe_id(id: &str) -> Result<&str, String> {
    if id.is_empty()
        || !id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err("invalid preset id".to_string());
    }
    Ok(id)
}

/// Fills defaults, drops unknown keys and clamps values to the catalog.
fn normalize(
    effect_id: &str,
    values: &BTreeMap<String, Value>,
    seed: u32,
) -> Result<(BTreeMap<String, Value>, u32), String> {
    let effect = catalog::catalog()
        .into_iter()
        .find(|effect| effect.id == effect_id)
        .ok_or_else(|| format!("unknown generator effect `{effect_id}`"))?;

    let seed = seed.min(9999);
    let mut normalized = BTreeMap::new();

    for spec in &effect.params {
        let raw = values.get(spec.key);
        let value = match spec.kind {
            ParamKind::Color => {
                let fallback = match &spec.default {
                    ParamValue::Text(text) => text.clone(),
                    _ => "#000000".to_string(),
                };
                let color = raw
                    .and_then(Value::as_str)
                    .filter(|value| is_hex_color(value))
                    .map(str::to_string)
                    .unwrap_or(fallback);
                Value::String(color)
            }
            ParamKind::Bool => {
                let fallback = matches!(spec.default, ParamValue::Bool(true));
                Value::Bool(raw.and_then(Value::as_bool).unwrap_or(fallback))
            }
            ParamKind::Seed => serde_json::json!(seed),
            _ => {
                let fallback = match spec.default {
                    ParamValue::Number(number) => number,
                    _ => 0.0,
                };
                let mut number = raw.and_then(Value::as_f64).unwrap_or(fallback);
                if let Some(min) = spec.min {
                    number = number.max(min);
                }
                if let Some(max) = spec.max {
                    number = number.min(max);
                }
                if matches!(spec.kind, ParamKind::Int) {
                    number = number.round();
                }
                serde_json::json!(number)
            }
        };
        normalized.insert(spec.key.to_string(), value);
    }

    Ok((normalized, seed))
}

/// Returns built-ins plus every valid user preset, newest first.
#[tauri::command]
pub fn bg_preset_list() -> Result<Vec<GeneratorPreset>, String> {
    let mut presets = builtin_presets();

    for entry in std::fs::read_dir(presets_dir()?)
        .map_err(|error| error.to_string())?
        .flatten()
    {
        if !entry.file_name().to_string_lossy().ends_with(".json") {
            continue;
        }
        let Ok(raw) = std::fs::read_to_string(entry.path()) else {
            continue;
        };
        let Ok(preset) = serde_json::from_str::<GeneratorPreset>(&raw) else {
            continue;
        };
        // A hand-written file must not take over a built-in's id.
        if preset.id.starts_with("builtin-") {
            continue;
        }
        presets.retain(|candidate| candidate.id != preset.id);
        presets.push(preset);
    }

    presets.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(presets)
}

/// Creates or overwrites a user preset after validating it against the catalog.
#[tauri::command]
pub fn bg_preset_save(mut preset: GeneratorPreset) -> Result<GeneratorPreset, String> {
    if preset.built_in {
        return Err("built-in presets cannot be overwritten".to_string());
    }
    if preset.name.trim().is_empty() {
        return Err("preset name is required".to_string());
    }
    if preset.id.trim().is_empty() {
        preset.id = uuid::Uuid::new_v4().to_string();
    }
    safe_id(&preset.id)?;
    if preset.id.starts_with("builtin-") {
        return Err("built-in presets cannot be overwritten".to_string());
    }

    let (params, seed) = normalize(&preset.effect, &preset.params, preset.seed)?;
    preset.params = params;
    preset.seed = seed;
    preset.version = 1;
    if preset.created_at == 0 {
        preset.created_at = crate::remote::now_ms();
    }

    let path = presets_dir()?.join(format!("{}.json", preset.id));
    let raw = serde_json::to_string_pretty(&preset).map_err(|error| error.to_string())?;
    std::fs::write(path, raw).map_err(|error| error.to_string())?;
    Ok(preset)
}

/// Deletes a user preset. Missing files and built-ins are left untouched.
#[tauri::command]
pub fn bg_preset_delete(id: String) -> Result<(), String> {
    if id.starts_with("builtin-") {
        return Ok(());
    }
    safe_id(&id)?;
    let path = presets_dir()?.join(format!("{id}.json"));
    if path.exists() {
        std::fs::remove_file(path).map_err(|error| error.to_string())?;
    }
    Ok(())
}
