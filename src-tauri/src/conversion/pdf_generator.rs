use image::DynamicImage;
use printpdf::{PdfDocument, PdfDocumentReference, PdfPageIndex, PdfLayerIndex, Mm, ImageTransform};
use std::io::BufWriter;

pub struct PdfGenerator {
    width_mm: f32,
    height_mm: f32,
}

impl PdfGenerator {
    /// Create a new PDF generator with specified dimensions in pixels
    pub fn new(width_px: f64, height_px: f64) -> Self {
        // Convert pixels to millimeters (96 DPI)
        // 1 inch = 25.4 mm, 96 pixels = 1 inch
        let width_mm = (width_px / 96.0) * 25.4;
        let height_mm = (height_px / 96.0) * 25.4;

        Self {
            width_mm: width_mm as f32,
            height_mm: height_mm as f32,
        }
    }

    /// Generate a PDF from a collection of slide images
    pub fn generate_pdf(&self, slides: Vec<DynamicImage>, title: &str) -> Result<Vec<u8>, String> {
        if slides.is_empty() {
            return Err("No slides to generate PDF".to_string());
        }

        // Create a new PDF document
        let (doc, mut page_indices, mut layer_indices) = self.create_document(title, slides.len());

        // Add each slide as a page
        for (i, slide_image) in slides.iter().enumerate() {
            // Get or create page
            let (page_idx, layer_idx) = if i == 0 {
                // Use the first page created with the document
                (page_indices[0], layer_indices[0])
            } else {
                // Add a new page
                let (page, layer) = doc.add_page(
                    Mm(self.width_mm),
                    Mm(self.height_mm),
                    format!("Slide {}", i + 1)
                );
                page_indices.push(page);
                layer_indices.push(layer);
                (page, layer)
            };

            // Add the slide image to the page
            self.add_image_to_page(&doc, page_idx, layer_idx, slide_image)?;
        }

        // Save PDF to bytes
        let buffer = Vec::new();
        let mut writer = BufWriter::new(buffer);
        doc.save(&mut writer)
            .map_err(|e| format!("Failed to save PDF: {}", e))?;

        Ok(writer.into_inner().map_err(|e| format!("Failed to get PDF bytes: {}", e))?)
    }

    /// Create a new PDF document with initial page
    fn create_document(&self, title: &str, _page_count: usize) -> (PdfDocumentReference, Vec<PdfPageIndex>, Vec<PdfLayerIndex>) {
        let (doc, page1, layer1) = PdfDocument::new(
            title,
            Mm(self.width_mm),
            Mm(self.height_mm),
            "Slide 1"
        );

        (doc, vec![page1], vec![layer1])
    }

    /// Add an image to a PDF page
    fn add_image_to_page(
        &self,
        doc: &PdfDocumentReference,
        page_idx: PdfPageIndex,
        layer_idx: PdfLayerIndex,
        image: &DynamicImage
    ) -> Result<(), String> {
        // Convert image to RGB8 format for PDF
        let rgb_image = image.to_rgb8();
        let (width, height) = rgb_image.dimensions();

        // Get the layer
        let layer = doc.get_page(page_idx).get_layer(layer_idx);

        // For MVP: Create a simple image using printpdf's Image API
        // Note: printpdf 0.7 has limited image support, we'll use a simplified approach
        // In production, consider using a newer version or alternative PDF library
        
        // Create image from raw RGB data
        use printpdf::image_crate::ColorType;
        let image_obj = printpdf::Image::from_dynamic_image(image);

        // Add image to the layer at full page size
        image_obj.add_to_layer(
            layer.clone(),
            ImageTransform {
                translate_x: Some(Mm(0.0)),
                translate_y: Some(Mm(0.0)),
                rotate: None,
                scale_x: Some(self.width_mm / width as f32 * 72.0 / 25.4),
                scale_y: Some(self.height_mm / height as f32 * 72.0 / 25.4),
                dpi: Some(96.0),
                ..Default::default()
            }
        );

        Ok(())
    }

    /// Generate a PDF from slide images with quality settings
    pub fn generate_pdf_with_quality(
        &self,
        slides: Vec<DynamicImage>,
        title: &str,
        _quality: ImageQuality
    ) -> Result<Vec<u8>, String> {
        // For MVP, we'll use the standard generation
        // Quality settings can be implemented by adjusting image compression
        self.generate_pdf(slides, title)
    }
}

#[derive(Debug, Clone, Copy)]
pub enum ImageQuality {
    Low,
    Medium,
    High,
}

impl Default for ImageQuality {
    fn default() -> Self {
        ImageQuality::High
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{RgbaImage, Rgba};

    #[test]
    fn test_pdf_generator_creation() {
        let generator = PdfGenerator::new(1920.0, 1080.0);
        // Standard 16:9 slide at 96 DPI
        // 1920px / 96 * 25.4 = 508mm
        assert!((generator.width_mm - 508.0).abs() < 1.0);
    }

    #[test]
    fn test_generate_empty_pdf() {
        let generator = PdfGenerator::new(1920.0, 1080.0);
        let result = generator.generate_pdf(vec![], "Test");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("No slides"));
    }

    #[test]
    fn test_generate_pdf_with_single_slide() {
        let generator = PdfGenerator::new(800.0, 600.0);
        
        // Create a simple test image
        let img = RgbaImage::from_pixel(800, 600, Rgba([255, 255, 255, 255]));
        let dynamic_img = DynamicImage::ImageRgba8(img);
        
        let result = generator.generate_pdf(vec![dynamic_img], "Test Presentation");
        assert!(result.is_ok());
        
        let pdf_bytes = result.unwrap();
        assert!(!pdf_bytes.is_empty());
        
        // Check PDF header
        assert_eq!(&pdf_bytes[0..4], b"%PDF");
    }
}
