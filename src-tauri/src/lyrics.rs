//! Parser and serializer for Lumen's plain-text lyric format.
//!
//! A lyric file is markdown-like: a `---` frontmatter block holds display
//! metadata (name, author, font, animation, ...) and the body holds one
//! slide per paragraph, with slides separated by two empty lines. A slide
//! may start with an `<!-- bg: path -->` comment that overrides the
//! background for that slide only.
//!
//! Parsing is tolerant by design: missing frontmatter, unknown keys and
//! unparsable numbers simply fall back to defaults, so a hand-written file
//! always opens.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

/// Display and playback settings stored in the file's frontmatter.
#[derive(Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LyricMetadata {
    /// Song or presentation name shown in the library.
    pub name: String,
    /// Author or credit line.
    pub author: String,
    /// Free-form notes, also indexed for library search.
    pub notes: String,
    /// Font family requested from the frontend.
    pub font: String,
    /// CSS font size, e.g. `"48px"`.
    pub font_size: String,
    /// Text alignment used by the renderer, a CSS `text-align` value
    /// (`"center"` by default).
    pub alignment: String,
    /// Background applied to every slide unless a slide overrides it.
    pub global_background: String,
    /// Whether slides advance automatically.
    pub auto_play: Option<bool>,
    /// Delay between automatic slide changes, in seconds; zero is dropped.
    pub interval_seconds: Option<f64>,
    /// Whether playback loops back to the first slide.
    pub repeat: Option<bool>,
    /// Animation identifier chosen by the frontend.
    pub animation: Option<String>,
}

/// One on-screen page of lyrics.
#[derive(Deserialize, Serialize, Clone)]
pub struct LyricSlide {
    /// Lines rendered as separate rows, empty lines already removed.
    pub lines: Vec<String>,
    /// Per-slide background override, when the file sets one.
    pub background: Option<String>,
}

/// Complete in-memory representation of a lyric file.
#[derive(Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LyricData {
    /// Frontmatter metadata with defaults applied.
    pub metadata: LyricMetadata,
    /// Slides in presentation order.
    pub slides: Vec<LyricSlide>,
}

/// Splits a leading `---` block into key/value pairs and returns the body.
///
/// Content without a well-formed block is returned untouched together with
/// an empty pair list.
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

/// Pulls the background path out of an `<!-- bg: ... -->` comment, if any.
fn extract_background(line: &str) -> Option<String> {
    let rest = line.strip_prefix("<!-- bg:")?;
    let end = rest.find("-->")?;
    Some(rest[..end].trim().to_string())
}

/// Splits the body into slides on two blank lines, capturing a leading
/// background comment per slide and dropping empty blocks.
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

/// Parses a lyric file into structured metadata and slides for the frontend.
///
/// Frontmatter keys are read as written in the format (`fontSize`,
/// `intervalSeconds`, `autoPlay`, ...); anything missing or unparsable falls
/// back to the defaults of [`LyricMetadata`]. The parser never fails: input
/// without frontmatter or slides yields empty defaults.
///
/// # Examples
///
/// ```rust
/// let raw = "---\nname: Amazing Grace\nauthor: Newton\n---\n\nAmazing grace\n\n\nhow sweet the sound";
/// let data = lyric_parse(raw.to_string()).unwrap();
/// assert_eq!(data.metadata.name, "Amazing Grace");
/// assert_eq!(data.slides.len(), 2);
/// assert_eq!(data.slides[0].lines.join(" "), "Amazing grace");
/// assert_eq!(data.slides[1].lines.join(" "), "how sweet the sound");
/// ```
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
    let animation = value("animation");

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
            animation,
        },
        slides,
    })
}

/// Renders [`LyricData`] back into the on-disk lyric format.
///
/// Optional metadata is written only when set, the body always ends with a
/// trailing newline, and slides are separated by two empty lines exactly as
/// the parser expects. Serialization is pure string building and cannot fail.
///
/// # Examples
///
/// ```rust
/// let raw = "---\nname: Amazing Grace\n---\n\nAmazing grace";
/// let data = lyric_parse(raw.to_string()).unwrap();
/// let text = lyric_serialize(data).unwrap();
/// assert!(text.starts_with("---\nname: Amazing Grace"));
/// assert!(text.trim_end().ends_with("Amazing grace"));
/// ```
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
    if let Some(v) = &metadata.animation {
        if !v.is_empty() {
            lines.push(format!("animation: {}", v));
        }
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

/// Flattens a lyric file into the plain text indexed by library search.
///
/// The notes come first, followed by every non-empty slide line in order;
/// blank lines are skipped so the index stays compact.
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