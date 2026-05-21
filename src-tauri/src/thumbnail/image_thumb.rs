use std::path::Path;

pub fn generate(src: &Path, dest: &Path, size: u32) -> Result<(), String> {
    let img = image::open(src).map_err(|e| format!("image decode: {e}"))?;
    let thumb = img.thumbnail(size, size);
    thumb
        .save_with_format(dest, image::ImageFormat::Jpeg)
        .map_err(|e| format!("save thumbnail: {e}"))
}
