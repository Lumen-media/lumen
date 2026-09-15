use std::collections::HashMap;

use serde::{Deserialize, Serialize};

#[derive(Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LyricMetadata {
    pub name: String,
    pub author: String,
    pub notes: String,
    pub font: String,
    pub font_size: String,
    pub alignment: String,
    pub global_background: String,
    pub auto_play: Option<bool>,
    pub interval_seconds: Option<f64>,
    pub repeat: Option<bool>,
}

#[derive(Deserialize, Serialize, Clone)]
pub struct LyricSlide {
    pub lines: Vec<String>,
    pub background: Option<String>,
}

#[derive(Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LyricData {
    pub metadata: LyricMetadata,
    pub slides: Vec<LyricSlide>,
}

fn parse_frontmatter(content: &str) -> (Vec<(String, String)>, &str) {
    let Some(rest) = content.strip_prefix("---\n") else {
        return (Vec::new(), content);
    };
    let Some(end) = rest.find("\n---") else {
        return (Vec::new(), content);
    };

    let raw = &rest[..end];
    let mut after = &rest[end + 4..];
    if let Some(next) = after.strip_prefix('\n') {
        after = next;
    }

    let mut pairs = Vec::new();
    for line in raw.split('\n') {
        let Some(idx) = line.find(':') else {
            continue;
        };
        let key = line[..idx].trim().to_string();
        let value = line[idx + 1..].trim().to_string();
        pairs.push((key, value));
    }

    (pairs, after)
}

fn extract_background(line: &str) -> Option<String> {
    let rest = line.strip_prefix("<!-- bg:")?;
    let end = rest.find("-->")?;
    Some(rest[..end].trim().to_string())
}

fn parse_slides(body: &str) -> Vec<LyricSlide> {
    let normalized = body.replace("\r\n", "\n");
    if normalized.trim().is_empty() {
        return Vec::new();
    }

    let mut slides = Vec::new();
    for block in normalized.split("\n\n\n") {
        let trimmed = block.trim();
        if trimmed.is_empty() {
            continue;
        }

        let mut lines: Vec<&str> = trimmed.split('\n').collect();
        let mut background: Option<String> = None;

        if let Some(first) = lines.first() {
            if first.starts_with("<!-- bg:") {
                let bg_line = lines.remove(0);
                background = extract_background(bg_line);
            }
        }

        let content_lines: Vec<String> = lines
            .iter()
            .filter(|line| !line.is_empty())
            .map(|line| line.to_string())
            .collect();

        if !content_lines.is_empty() {
            slides.push(LyricSlide {
                lines: content_lines,
                background,
            });
        }
    }

    slides
}

#[tauri::command]
pub fn lyric_parse(content: String) -> Result<LyricData, String> {
    let (pairs, body) = parse_frontmatter(&content);
    let slides = parse_slides(body);

    let mut map: HashMap<String, String> = HashMap::new();
    for (key, value) in pairs {
        map.insert(key, value);
    }

    let value = |key: &str| map.get(key).cloned();

    let auto_play = value("autoPlay").map(|v| v == "true");
    let interval_seconds = value("intervalSeconds")
        .and_then(|v| v.parse::<f64>().ok())
        .filter(|n| *n != 0.0);
    let repeat = value("repeat").map(|v| v == "true");

    Ok(LyricData {
        metadata: LyricMetadata {
            name: value("name").unwrap_or_default(),
            author: value("author").unwrap_or_default(),
            notes: value("notes").unwrap_or_default(),
            font: value("font").unwrap_or_default(),
            font_size: value("fontSize").unwrap_or_else(|| "48px".to_string()),
            alignment: value("alignment").unwrap_or_else(|| "center".to_string()),
            global_background: value("globalBackground").unwrap_or_default(),
            auto_play,
            interval_seconds,
            repeat,
        },
        slides,
    })
}

#[tauri::command]
pub fn lyric_serialize(data: LyricData) -> Result<String, String> {
    let metadata = &data.metadata;
    let mut lines = vec![
        "---".to_string(),
        format!("name: {}", metadata.name),
        format!("author: {}", metadata.author),
        format!("notes: {}", metadata.notes),
        format!("font: {}", metadata.font),
        format!("fontSize: {}", metadata.font_size),
        format!("alignment: {}", metadata.alignment),
    ];

    if !metadata.global_background.is_empty() {
        lines.push(format!("globalBackground: {}", metadata.global_background));
    }
    if let Some(v) = metadata.auto_play {
        lines.push(format!("autoPlay: {}", v));
    }
    if let Some(v) = metadata.interval_seconds {
        lines.push(format!("intervalSeconds: {}", v));
    }
    if let Some(v) = metadata.repeat {
        lines.push(format!("repeat: {}", v));
    }
    lines.push("---".to_string());

    for slide in &data.slides {
        lines.push(String::new());
        lines.push(String::new());
        if let Some(background) = &slide.background {
            lines.push(format!("<!-- bg: {} -->", background));
        }
        for line in &slide.lines {
            lines.push(line.clone());
        }
    }

    let joined = lines.join("\n");
    Ok(format!("{}\n", joined.trim()))
}

#[tauri::command]
pub fn lyric_build_search_content(data: LyricData) -> Result<String, String> {
    let mut parts: Vec<String> = Vec::new();
    if !data.metadata.notes.is_empty() {
        parts.push(data.metadata.notes.clone());
    }
    for slide in &data.slides {
        for line in &slide.lines {
            if !line.trim().is_empty() {
                parts.push(line.clone());
            }
        }
    }
    Ok(parts.join("\n"))
}