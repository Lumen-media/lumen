use quick_xml::events::Event;
use quick_xml::Reader;
use serde::Serialize;
use std::io::Read;
use zip::ZipArchive;

#[derive(Serialize)]
pub struct SlideText {
    pub index: u32,
    pub text: String,
}

#[derive(Serialize)]
pub struct PresentationMeta {
    pub slide_count: u32,
    pub slides: Vec<SlideText>,
    pub title: Option<String>,
}

fn extract_text_from_xml(xml: &[u8]) -> String {
    let mut reader = Reader::from_reader(xml);
    reader.config_mut().trim_text(true);
    let mut buf = Vec::new();
    let mut text = String::new();
    let mut in_text_tag = false;

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(ref e)) | Ok(Event::Empty(ref e)) => {
                if e.name().as_ref() == b"a:t" {
                    in_text_tag = true;
                }
            }
            Ok(Event::Text(ref e)) if in_text_tag => {
                if let Ok(t) = e.unescape() {
                    text.push_str(&t);
                    text.push(' ');
                }
            }
            Ok(Event::End(ref e)) => {
                if e.name().as_ref() == b"a:t" {
                    in_text_tag = false;
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => {
                eprintln!("XML parse error: {e}");
                break;
            }
            _ => {}
        }
        buf.clear();
    }

    text.trim().to_string()
}

fn extract_title(xml: &[u8]) -> Option<String> {
    let mut reader = Reader::from_reader(xml);
    reader.config_mut().trim_text(true);
    let mut buf = Vec::new();
    let mut depth = 0;

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(ref e)) => {
                let name = e.name();
                if name.as_ref() == b"p:presentation" || name.as_ref() == b"presentation" {
                    depth += 1;
                }
            }
            Ok(Event::End(ref e)) => {
                let name = e.name();
                if name.as_ref() == b"p:presentation" || name.as_ref() == b"presentation" {
                    depth -= 1;
                }
            }
            Ok(Event::Text(ref e)) if depth > 0 => {
                if let Ok(t) = e.unescape() {
                    let trimmed = t.trim();
                    if !trimmed.is_empty() {
                        return Some(trimmed.to_string());
                    }
                }
            }
            Ok(Event::Eof) => break,
            Err(_) => break,
            _ => {}
        }
        buf.clear();
    }

    None
}

#[tauri::command]
pub fn extract_presentation_metadata(path: String) -> Result<PresentationMeta, String> {
    let file = std::fs::File::open(&path)
        .map_err(|e| format!("Failed to open file: {e}"))?;

    let mut archive = ZipArchive::new(file)
        .map_err(|e| format!("Failed to read ZIP archive: {e}"))?;

    let mut slides: Vec<SlideText> = Vec::new();

    // Sort slide entries by index
    let mut slide_indices: Vec<u32> = Vec::new();
    for i in 0..archive.len() {
        let entry = archive.by_index(i).map_err(|e| format!("ZIP read error: {e}"))?;
        let name = entry.name().to_string();
        if let Some(idx) = parse_slide_index(&name) {
            slide_indices.push(idx);
        }
    }
    slide_indices.sort();

    for idx in &slide_indices {
        let entry_name = format!("ppt/slides/slide{}.xml", idx);
        match archive.by_name(&entry_name) {
            Ok(mut entry) => {
                let mut xml = Vec::new();
                entry.read_to_end(&mut xml).map_err(|e| format!("Failed to read slide XML: {e}"))?;
                let text = extract_text_from_xml(&xml);
                slides.push(SlideText {
                    index: *idx,
                    text,
                });
            }
            Err(e) => {
                eprintln!("Warning: could not read {entry_name}: {e}");
            }
        }
    }

    let slide_count = slide_indices.len() as u32;

    let title = archive
        .by_name("ppt/presentation.xml")
        .ok()
        .and_then(|mut entry| {
            let mut xml = Vec::new();
            entry.read_to_end(&mut xml).ok()?;
            Some(extract_title(&xml))
        })
        .flatten()
        // Fallback to file name without extension
        .or_else(|| {
            std::path::Path::new(&path)
                .file_stem()
                .and_then(|s| s.to_str())
                .map(|s| s.to_string())
        });

    Ok(PresentationMeta {
        slide_count,
        slides,
        title,
    })
}

fn parse_slide_index(name: &str) -> Option<u32> {
    // Match patterns like: ppt/slides/slide1.xml or ppt/slides/slide01.xml
    let name = name.replace('\\', "/");
    let stem = std::path::Path::new(&name).file_stem()?.to_str()?;
    if !stem.starts_with("slide") {
        return None;
    }
    stem.trim_start_matches("slide").parse::<u32>().ok()
}
