use image::{DynamicImage, Rgba, RgbaImage};
use quick_xml::Reader;
use quick_xml::events::Event;
use std::collections::HashMap;
use super::pptx_extractor::{SlideData, ImageData};

pub struct SlideRenderer {
    width: u32,
    height: u32,
}

#[derive(Debug, Clone)]
struct TextElement {
    text: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    font_size: f64,
    color: [u8; 4],
    bold: bool,
}

#[derive(Debug, Clone)]
struct ImageElement {
    image_id: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[derive(Debug, Clone)]
struct ShapeElement {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    fill_color: [u8; 4],
}

impl SlideRenderer {
    /// Create a new slide renderer with specified dimensions
    pub fn new(width: f64, height: f64) -> Self {
        Self {
            width: width as u32,
            height: height as u32,
        }
    }

    /// Render a slide to an image
    pub fn render_slide(&self, slide: &SlideData) -> Result<DynamicImage, String> {
        // Create a white background image
        let mut img = RgbaImage::from_pixel(
            self.width,
            self.height,
            Rgba([255, 255, 255, 255])
        );

        // Parse the slide XML to extract elements
        let (text_elements, image_elements, shape_elements) = self.parse_slide_elements(&slide.xml_content)?;

        // Create image lookup map
        let image_map: HashMap<String, &ImageData> = slide.images
            .iter()
            .map(|img| (img.id.clone(), img))
            .collect();

        // Render shapes first (background layer)
        for shape in &shape_elements {
            self.render_shape(&mut img, shape);
        }

        // Render images
        for img_elem in &image_elements {
            if let Some(image_data) = image_map.get(&img_elem.image_id) {
                self.render_image(&mut img, img_elem, image_data)?;
            }
        }

        // Render text elements (foreground layer)
        for text_elem in &text_elements {
            self.render_text(&mut img, text_elem);
        }

        Ok(DynamicImage::ImageRgba8(img))
    }

    /// Parse slide XML to extract renderable elements
    fn parse_slide_elements(&self, xml_content: &str) -> Result<(Vec<TextElement>, Vec<ImageElement>, Vec<ShapeElement>), String> {
        let mut text_elements = Vec::new();
        let mut image_elements = Vec::new();
        let shape_elements = Vec::new();

        let mut reader = Reader::from_str(xml_content);
        reader.config_mut().trim_text(true);
        
        let mut buf = Vec::new();
        let mut current_text = String::new();
        let mut in_text = false;
        let mut current_transform = Transform::default();

        loop {
            match reader.read_event_into(&mut buf) {
                Ok(Event::Start(e)) => {
                    match e.name().as_ref() {
                        b"p:sp" => {
                            // Shape element - reset transform
                            current_transform = Transform::default();
                        }
                        b"p:pic" => {
                            // Picture element - reset transform
                            current_transform = Transform::default();
                        }
                        b"a:t" => {
                            // Text content
                            in_text = true;
                            current_text.clear();
                        }
                        b"a:xfrm" => {
                            // Transform element - will contain position and size
                        }
                        _ => {}
                    }
                }
                Ok(Event::Empty(e)) => {
                    match e.name().as_ref() {
                        b"a:off" => {
                            // Offset (position)
                            current_transform.x = self.parse_attr(&e, b"x").unwrap_or(0.0);
                            current_transform.y = self.parse_attr(&e, b"y").unwrap_or(0.0);
                        }
                        b"a:ext" => {
                            // Extent (size)
                            current_transform.width = self.parse_attr(&e, b"cx").unwrap_or(0.0);
                            current_transform.height = self.parse_attr(&e, b"cy").unwrap_or(0.0);
                        }
                        b"a:blip" => {
                            // Image reference
                            for attr in e.attributes() {
                                if let Ok(attr) = attr {
                                    if attr.key.as_ref() == b"r:embed" {
                                        if let Ok(id) = std::str::from_utf8(&attr.value) {
                                            image_elements.push(ImageElement {
                                                image_id: id.to_string(),
                                                x: self.emu_to_pixels(current_transform.x),
                                                y: self.emu_to_pixels(current_transform.y),
                                                width: self.emu_to_pixels(current_transform.width),
                                                height: self.emu_to_pixels(current_transform.height),
                                            });
                                        }
                                    }
                                }
                            }
                        }
                        b"a:solidFill" => {
                            // Solid fill for shapes - we'll use a default color
                        }
                        _ => {}
                    }
                }
                Ok(Event::Text(e)) if in_text => {
                    if let Ok(text) = e.unescape() {
                        current_text.push_str(&text);
                    }
                }
                Ok(Event::End(e)) => {
                    match e.name().as_ref() {
                        b"a:t" => {
                            in_text = false;
                        }
                        b"p:sp" => {
                            // End of shape - if we have text, create a text element
                            if !current_text.is_empty() {
                                text_elements.push(TextElement {
                                    text: current_text.clone(),
                                    x: self.emu_to_pixels(current_transform.x),
                                    y: self.emu_to_pixels(current_transform.y),
                                    width: self.emu_to_pixels(current_transform.width),
                                    height: self.emu_to_pixels(current_transform.height),
                                    font_size: 24.0, // Default font size
                                    color: [0, 0, 0, 255], // Black text
                                    bold: false,
                                });
                                current_text.clear();
                            }
                        }
                        _ => {}
                    }
                }
                Ok(Event::Eof) => break,
                Err(e) => return Err(format!("XML parsing error: {}", e)),
                _ => {}
            }
            buf.clear();
        }

        Ok((text_elements, image_elements, shape_elements))
    }

    /// Parse an attribute value as f64
    fn parse_attr(&self, element: &quick_xml::events::BytesStart, attr_name: &[u8]) -> Option<f64> {
        for attr in element.attributes() {
            if let Ok(attr) = attr {
                if attr.key.as_ref() == attr_name {
                    if let Ok(val) = std::str::from_utf8(&attr.value) {
                        return val.parse().ok();
                    }
                }
            }
        }
        None
    }

    /// Convert EMUs (English Metric Units) to pixels
    fn emu_to_pixels(&self, emu: f64) -> f64 {
        // 1 EMU = 1/914400 inches, 96 DPI
        (emu / 914400.0) * 96.0
    }

    /// Render a shape element
    fn render_shape(&self, img: &mut RgbaImage, shape: &ShapeElement) {
        let x = shape.x as u32;
        let y = shape.y as u32;
        let width = shape.width as u32;
        let height = shape.height as u32;

        // Draw a filled rectangle
        for py in y..y.saturating_add(height).min(self.height) {
            for px in x..x.saturating_add(width).min(self.width) {
                if px < self.width && py < self.height {
                    img.put_pixel(px, py, Rgba(shape.fill_color));
                }
            }
        }
    }

    /// Render an image element
    fn render_image(&self, img: &mut RgbaImage, img_elem: &ImageElement, image_data: &ImageData) -> Result<(), String> {
        // Load the image from bytes
        let loaded_img = image::load_from_memory(&image_data.data)
            .map_err(|e| format!("Failed to load image: {}", e))?;

        // Resize to fit the specified dimensions while maintaining aspect ratio
        let resized = loaded_img.resize_exact(
            img_elem.width as u32,
            img_elem.height as u32,
            image::imageops::FilterType::Lanczos3
        );

        // Convert to RGBA
        let rgba_img = resized.to_rgba8();

        // Composite onto the slide
        let x = img_elem.x as u32;
        let y = img_elem.y as u32;

        for (px, py, pixel) in rgba_img.enumerate_pixels() {
            let target_x = x + px;
            let target_y = y + py;
            
            if target_x < self.width && target_y < self.height {
                // Alpha blending
                let bg = img.get_pixel(target_x, target_y);
                let alpha = pixel[3] as f32 / 255.0;
                let inv_alpha = 1.0 - alpha;

                let blended = Rgba([
                    ((pixel[0] as f32 * alpha) + (bg[0] as f32 * inv_alpha)) as u8,
                    ((pixel[1] as f32 * alpha) + (bg[1] as f32 * inv_alpha)) as u8,
                    ((pixel[2] as f32 * alpha) + (bg[2] as f32 * inv_alpha)) as u8,
                    255,
                ]);

                img.put_pixel(target_x, target_y, blended);
            }
        }

        Ok(())
    }

    /// Render a text element (simplified - no actual font rendering)
    fn render_text(&self, img: &mut RgbaImage, text_elem: &TextElement) {
        // For MVP, we'll render a simple text box indicator
        // In a production system, you would use a library like rusttype or ab_glyph
        // to render actual text with proper fonts
        
        let x = text_elem.x as u32;
        let y = text_elem.y as u32;
        let width = text_elem.width as u32;
        let height = text_elem.height as u32;

        // Draw a border to indicate text area (for debugging/MVP)
        let border_color = Rgba([200, 200, 200, 255]);
        
        // Top and bottom borders
        for px in x..x.saturating_add(width).min(self.width) {
            if px < self.width {
                if y < self.height {
                    img.put_pixel(px, y, border_color);
                }
                let bottom = y.saturating_add(height).min(self.height - 1);
                if bottom < self.height {
                    img.put_pixel(px, bottom, border_color);
                }
            }
        }
        
        // Left and right borders
        for py in y..y.saturating_add(height).min(self.height) {
            if py < self.height {
                if x < self.width {
                    img.put_pixel(x, py, border_color);
                }
                let right = x.saturating_add(width).min(self.width - 1);
                if right < self.width {
                    img.put_pixel(right, py, border_color);
                }
            }
        }

        // Note: For production, integrate a text rendering library
        // Example with rusttype (not included in this MVP):
        // - Load font from system or embed font file
        // - Render glyphs at specified position
        // - Apply font size, color, and styling
    }
}

#[derive(Debug, Default, Clone)]
struct Transform {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_renderer_creation() {
        let renderer = SlideRenderer::new(1920.0, 1080.0);
        assert_eq!(renderer.width, 1920);
        assert_eq!(renderer.height, 1080);
    }

    #[test]
    fn test_emu_to_pixels() {
        let renderer = SlideRenderer::new(1920.0, 1080.0);
        // 914400 EMUs = 1 inch = 96 pixels at 96 DPI
        let pixels = renderer.emu_to_pixels(914400.0);
        assert!((pixels - 96.0).abs() < 0.01);
    }
}
