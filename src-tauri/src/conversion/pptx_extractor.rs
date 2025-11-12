use std::fs::File;
use std::io::{BufReader, Read};
use std::path::Path;
use zip::ZipArchive;
use quick_xml::Reader;
use quick_xml::events::Event;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PptxMetadata {
    pub slide_count: usize,
    pub slide_width: f64,
    pub slide_height: f64,
    pub title: Option<String>,
}

#[derive(Debug, Clone)]
pub struct SlideData {
    pub index: usize,
    pub xml_content: String,
    pub images: Vec<ImageData>,
}

#[derive(Debug, Clone)]
pub struct ImageData {
    pub id: String,
    pub data: Vec<u8>,
    pub extension: String,
}

pub struct PptxExtractor {
    archive: ZipArchive<BufReader<File>>,
}

impl PptxExtractor {
    /// Create a new PPTX extractor from a file path
    pub fn new(file_path: &str) -> Result<Self, String> {
        let path = Path::new(file_path);
        
        // Check if file exists
        if !path.exists() {
            return Err(format!("File not found: {}", file_path));
        }

        // Check if file has .pptx extension
        if let Some(ext) = path.extension() {
            if ext != "pptx" && ext != "ppt" {
                return Err("Invalid file format. Only .pptx files are supported.".to_string());
            }
        } else {
            return Err("File has no extension".to_string());
        }

        // Open the file
        let file = File::open(path)
            .map_err(|e| format!("Failed to open file: {}", e))?;
        
        let reader = BufReader::new(file);
        
        // Try to open as ZIP archive
        let archive = ZipArchive::new(reader)
            .map_err(|e| format!("Corrupted PPTX file: Unable to read ZIP structure. {}", e))?;

        Ok(Self { archive })
    }

    /// Extract basic metadata from the PPTX file
    pub fn extract_metadata(&mut self) -> Result<PptxMetadata, String> {
        // Get slide count by counting slide files
        let slide_count = self.count_slides()?;
        
        // Extract slide dimensions from presentation.xml
        let (width, height) = self.extract_slide_dimensions()?;
        
        // Try to extract title from core properties
        let title = self.extract_title().ok();

        Ok(PptxMetadata {
            slide_count,
            slide_width: width,
            slide_height: height,
            title,
        })
    }

    /// Count the number of slides in the presentation
    fn count_slides(&mut self) -> Result<usize, String> {
        let mut count = 0;
        
        for i in 0..self.archive.len() {
            let file = self.archive.by_index(i)
                .map_err(|e| format!("Failed to read archive entry: {}", e))?;
            
            let name = file.name().to_string();
            
            // Slides are in ppt/slides/ directory with pattern slide1.xml, slide2.xml, etc.
            if name.starts_with("ppt/slides/slide") && name.ends_with(".xml") {
                count += 1;
            }
        }

        if count == 0 {
            return Err("No slides found in PPTX file. File may be corrupted.".to_string());
        }

        Ok(count)
    }

    /// Extract slide dimensions from presentation.xml
    fn extract_slide_dimensions(&mut self) -> Result<(f64, f64), String> {
        // Default PowerPoint slide dimensions in EMUs (English Metric Units)
        // Standard 16:9 slide: 9144000 x 5143500 EMUs
        let mut width = 9144000.0;
        let mut height = 5143500.0;

        // Try to read presentation.xml
        if let Ok(mut file) = self.archive.by_name("ppt/presentation.xml") {
            let mut content = String::new();
            if file.read_to_string(&mut content).is_ok() {
                // Parse XML to find sldSz element
                let mut reader = Reader::from_str(&content);
                reader.config_mut().trim_text(true);
                
                let mut buf = Vec::new();
                loop {
                    match reader.read_event_into(&mut buf) {
                        Ok(Event::Empty(e)) if e.name().as_ref() == b"p:sldSz" => {
                            // Extract cx (width) and cy (height) attributes
                            for attr in e.attributes() {
                                if let Ok(attr) = attr {
                                    match attr.key.as_ref() {
                                        b"cx" => {
                                            if let Ok(val) = std::str::from_utf8(&attr.value) {
                                                width = val.parse().unwrap_or(width);
                                            }
                                        }
                                        b"cy" => {
                                            if let Ok(val) = std::str::from_utf8(&attr.value) {
                                                height = val.parse().unwrap_or(height);
                                            }
                                        }
                                        _ => {}
                                    }
                                }
                            }
                            break;
                        }
                        Ok(Event::Eof) => break,
                        Err(_) => break,
                        _ => {}
                    }
                    buf.clear();
                }
            }
        }

        // Convert EMUs to pixels (1 EMU = 1/914400 inches, 96 DPI)
        let width_px = (width / 914400.0) * 96.0;
        let height_px = (height / 914400.0) * 96.0;

        Ok((width_px, height_px))
    }

    /// Extract presentation title from core properties
    fn extract_title(&mut self) -> Result<String, String> {
        let mut file = self.archive.by_name("docProps/core.xml")
            .map_err(|_| "Core properties not found".to_string())?;
        
        let mut content = String::new();
        file.read_to_string(&mut content)
            .map_err(|e| format!("Failed to read core properties: {}", e))?;

        // Parse XML to find title element
        let mut reader = Reader::from_str(&content);
        reader.config_mut().trim_text(true);
        
        let mut buf = Vec::new();
        let mut in_title = false;
        let mut title = String::new();

        loop {
            match reader.read_event_into(&mut buf) {
                Ok(Event::Start(e)) if e.name().as_ref() == b"dc:title" => {
                    in_title = true;
                }
                Ok(Event::Text(e)) if in_title => {
                    title = e.unescape()
                        .map_err(|e| format!("Failed to parse title: {}", e))?
                        .to_string();
                }
                Ok(Event::End(e)) if e.name().as_ref() == b"dc:title" => {
                    break;
                }
                Ok(Event::Eof) => break,
                Err(e) => return Err(format!("XML parsing error: {}", e)),
                _ => {}
            }
            buf.clear();
        }

        if title.is_empty() {
            Err("Title not found".to_string())
        } else {
            Ok(title)
        }
    }

    /// Extract a specific slide's XML content and associated images
    pub fn extract_slide(&mut self, slide_index: usize) -> Result<SlideData, String> {
        // Slide files are 1-indexed: slide1.xml, slide2.xml, etc.
        let slide_name = format!("ppt/slides/slide{}.xml", slide_index + 1);
        
        // Read the XML content first
        let xml_content = {
            let mut file = self.archive.by_name(&slide_name)
                .map_err(|_| format!("Slide {} not found", slide_index + 1))?;
            
            let mut content = String::new();
            file.read_to_string(&mut content)
                .map_err(|e| format!("Failed to read slide content: {}", e))?;
            content
        };

        // Extract image references from the slide
        let image_ids = self.extract_image_references(&xml_content)?;
        
        // Load the actual image data
        let images = self.load_slide_images(slide_index, &image_ids)?;

        Ok(SlideData {
            index: slide_index,
            xml_content,
            images,
        })
    }

    /// Extract image reference IDs from slide XML
    fn extract_image_references(&self, xml_content: &str) -> Result<Vec<String>, String> {
        let mut image_ids = Vec::new();
        let mut reader = Reader::from_str(xml_content);
        reader.config_mut().trim_text(true);
        
        let mut buf = Vec::new();

        loop {
            match reader.read_event_into(&mut buf) {
                Ok(Event::Empty(e)) | Ok(Event::Start(e)) => {
                    // Look for a:blip elements which reference images
                    if e.name().as_ref() == b"a:blip" {
                        for attr in e.attributes() {
                            if let Ok(attr) = attr {
                                // The r:embed attribute contains the relationship ID
                                if attr.key.as_ref() == b"r:embed" {
                                    if let Ok(id) = std::str::from_utf8(&attr.value) {
                                        image_ids.push(id.to_string());
                                    }
                                }
                            }
                        }
                    }
                }
                Ok(Event::Eof) => break,
                Err(e) => return Err(format!("XML parsing error: {}", e)),
                _ => {}
            }
            buf.clear();
        }

        Ok(image_ids)
    }

    /// Load actual image data for a slide
    fn load_slide_images(&mut self, slide_index: usize, image_ids: &[String]) -> Result<Vec<ImageData>, String> {
        let mut images = Vec::new();

        // First, we need to read the slide relationships file to map IDs to file paths
        let rels_name = format!("ppt/slides/_rels/slide{}.xml.rels", slide_index + 1);
        
        // Read relationships content first
        let content = {
            match self.archive.by_name(&rels_name) {
                Ok(mut file) => {
                    let mut content = String::new();
                    file.read_to_string(&mut content)
                        .map_err(|e| format!("Failed to read relationships: {}", e))?;
                    Some(content)
                }
                Err(_) => None
            }
        };
        
        let image_paths = if let Some(content) = content {
            self.parse_image_relationships(&content, image_ids)?
        } else {
            // No relationships file means no images
            return Ok(images);
        };

        // Load each image
        for (id, rel_path) in image_paths {
            // Resolve relative path
            let image_path = format!("ppt/slides/{}", rel_path);
            
            if let Ok(mut file) = self.archive.by_name(&image_path) {
                let mut data = Vec::new();
                file.read_to_end(&mut data)
                    .map_err(|e| format!("Failed to read image data: {}", e))?;
                
                // Determine extension from path
                let extension = Path::new(&image_path)
                    .extension()
                    .and_then(|s| s.to_str())
                    .unwrap_or("png")
                    .to_string();

                images.push(ImageData {
                    id,
                    data,
                    extension,
                });
            }
        }

        Ok(images)
    }

    /// Parse relationships XML to map image IDs to file paths
    fn parse_image_relationships(&self, xml_content: &str, image_ids: &[String]) -> Result<Vec<(String, String)>, String> {
        let mut mappings = Vec::new();
        let mut reader = Reader::from_str(xml_content);
        reader.config_mut().trim_text(true);
        
        let mut buf = Vec::new();

        loop {
            match reader.read_event_into(&mut buf) {
                Ok(Event::Empty(e)) if e.name().as_ref() == b"Relationship" => {
                    let mut id = None;
                    let mut target = None;
                    let mut rel_type = None;

                    for attr in e.attributes() {
                        if let Ok(attr) = attr {
                            match attr.key.as_ref() {
                                b"Id" => {
                                    if let Ok(val) = std::str::from_utf8(&attr.value) {
                                        id = Some(val.to_string());
                                    }
                                }
                                b"Target" => {
                                    if let Ok(val) = std::str::from_utf8(&attr.value) {
                                        target = Some(val.to_string());
                                    }
                                }
                                b"Type" => {
                                    if let Ok(val) = std::str::from_utf8(&attr.value) {
                                        rel_type = Some(val.to_string());
                                    }
                                }
                                _ => {}
                            }
                        }
                    }

                    // Check if this is an image relationship
                    if let (Some(id), Some(target), Some(rel_type)) = (id, target, rel_type) {
                        if rel_type.contains("image") && image_ids.contains(&id) {
                            mappings.push((id, target));
                        }
                    }
                }
                Ok(Event::Eof) => break,
                Err(e) => return Err(format!("XML parsing error: {}", e)),
                _ => {}
            }
            buf.clear();
        }

        Ok(mappings)
    }

    /// Extract all slides from the presentation
    pub fn extract_all_slides(&mut self) -> Result<Vec<SlideData>, String> {
        let metadata = self.extract_metadata()?;
        let mut slides = Vec::new();

        for i in 0..metadata.slide_count {
            let slide = self.extract_slide(i)?;
            slides.push(slide);
        }

        Ok(slides)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_invalid_file_path() {
        let result = PptxExtractor::new("nonexistent.pptx");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("File not found"));
    }

    #[test]
    fn test_invalid_extension() {
        // This test would need a real file to work properly
        // Just testing the error message format
        let result = PptxExtractor::new("test.txt");
        assert!(result.is_err());
    }
}
