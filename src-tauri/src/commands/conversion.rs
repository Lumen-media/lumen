use crate::conversion::{PptxExtractor, SlideRenderer, PdfGenerator};
use serde::{Deserialize, Serialize};
use tauri::Emitter;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PptxMetadataResponse {
    pub slide_count: usize,
    pub slide_width: f64,
    pub slide_height: f64,
    pub title: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversionProgress {
    pub stage: String,
    pub current: usize,
    pub total: usize,
    pub percentage: f32,
}

/// Extract metadata from a PPTX file without full conversion
#[tauri::command]
pub async fn get_pptx_metadata(file_path: String) -> Result<PptxMetadataResponse, String> {
    // Create extractor
    let mut extractor = PptxExtractor::new(&file_path)?;
    
    // Extract metadata
    let metadata = extractor.extract_metadata()?;
    
    Ok(PptxMetadataResponse {
        slide_count: metadata.slide_count,
        slide_width: metadata.slide_width,
        slide_height: metadata.slide_height,
        title: metadata.title,
    })
}

/// Convert a PPTX file to PDF format
#[tauri::command]
pub async fn convert_pptx_to_pdf(
    app: tauri::AppHandle,
    file_path: String,
) -> Result<Vec<u8>, String> {
    // Emit progress: Starting extraction
    let _ = app.emit("conversion-progress", ConversionProgress {
        stage: "Extracting PPTX".to_string(),
        current: 0,
        total: 100,
        percentage: 0.0,
    });

    // Step 1: Extract PPTX content
    let mut extractor = PptxExtractor::new(&file_path)
        .map_err(|e| format!("Extraction failed: {}", e))?;
    
    let metadata = extractor.extract_metadata()
        .map_err(|e| format!("Failed to read PPTX metadata: {}", e))?;
    
    let slide_count = metadata.slide_count;
    let title = metadata.title.clone().unwrap_or_else(|| "Presentation".to_string());

    // Emit progress: Extraction complete
    let _ = app.emit("conversion-progress", ConversionProgress {
        stage: "Extracting slides".to_string(),
        current: 1,
        total: slide_count + 2,
        percentage: (1.0 / (slide_count + 2) as f32) * 100.0,
    });

    // Step 2: Extract all slides
    let slides = extractor.extract_all_slides()
        .map_err(|e| format!("Failed to extract slides: {}", e))?;

    // Emit progress: Slides extracted
    let _ = app.emit("conversion-progress", ConversionProgress {
        stage: "Rendering slides".to_string(),
        current: 2,
        total: slide_count + 2,
        percentage: (2.0 / (slide_count + 2) as f32) * 100.0,
    });

    // Step 3: Render each slide to an image
    let renderer = SlideRenderer::new(metadata.slide_width, metadata.slide_height);
    let mut rendered_slides = Vec::new();

    for (i, slide) in slides.iter().enumerate() {
        let rendered = renderer.render_slide(slide)
            .map_err(|e| format!("Failed to render slide {}: {}", i + 1, e))?;
        
        rendered_slides.push(rendered);

        // Emit progress for each slide rendered
        let _ = app.emit("conversion-progress", ConversionProgress {
            stage: format!("Rendering slide {}/{}", i + 1, slide_count),
            current: i + 3,
            total: slide_count + 2,
            percentage: ((i + 3) as f32 / (slide_count + 2) as f32) * 100.0,
        });
    }

    // Emit progress: Generating PDF
    let _ = app.emit("conversion-progress", ConversionProgress {
        stage: "Generating PDF".to_string(),
        current: slide_count + 2,
        total: slide_count + 2,
        percentage: 95.0,
    });

    // Step 4: Generate PDF from rendered slides
    let pdf_generator = PdfGenerator::new(metadata.slide_width, metadata.slide_height);
    let pdf_bytes = pdf_generator.generate_pdf(rendered_slides, &title)
        .map_err(|e| format!("Failed to generate PDF: {}", e))?;

    // Emit progress: Complete
    let _ = app.emit("conversion-progress", ConversionProgress {
        stage: "Complete".to_string(),
        current: slide_count + 2,
        total: slide_count + 2,
        percentage: 100.0,
    });

    Ok(pdf_bytes)
}

/// Convert a PPTX file to PDF with error recovery
#[tauri::command]
pub async fn convert_pptx_to_pdf_with_retry(
    app: tauri::AppHandle,
    file_path: String,
    max_retries: u32,
) -> Result<Vec<u8>, String> {
    let mut last_error = String::new();
    
    for attempt in 0..=max_retries {
        if attempt > 0 {
            let _ = app.emit("conversion-progress", ConversionProgress {
                stage: format!("Retry attempt {}/{}", attempt, max_retries),
                current: 0,
                total: 100,
                percentage: 0.0,
            });
        }

        match convert_pptx_to_pdf(app.clone(), file_path.clone()).await {
            Ok(pdf_bytes) => return Ok(pdf_bytes),
            Err(e) => {
                last_error = e;
                if attempt < max_retries {
                    // Wait a bit before retrying
                    tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
                }
            }
        }
    }

    Err(format!("Conversion failed after {} attempts: {}", max_retries + 1, last_error))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_conversion_progress_serialization() {
        let progress = ConversionProgress {
            stage: "Testing".to_string(),
            current: 5,
            total: 10,
            percentage: 50.0,
        };

        let json = serde_json::to_string(&progress).unwrap();
        assert!(json.contains("Testing"));
        assert!(json.contains("50"));
    }

    #[test]
    fn test_metadata_response_serialization() {
        let metadata = PptxMetadataResponse {
            slide_count: 10,
            slide_width: 1920.0,
            slide_height: 1080.0,
            title: Some("Test".to_string()),
        };

        let json = serde_json::to_string(&metadata).unwrap();
        assert!(json.contains("Test"));
        assert!(json.contains("1920"));
    }
}
