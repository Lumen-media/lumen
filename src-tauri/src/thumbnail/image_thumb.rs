//! In-process raster image thumbnail generation.
//!
//! Decodes a source image with the `image` crate and writes a JPEG thumbnail,
//! used by [`super::get_thumbnail`] for `png`, `jpg`, `jpeg`, `webp`, `bmp`,
//! and `gif` files after the OS thumbnail provider has been tried.

use std::path::Path;

/// Generates a square-bounded JPEG thumbnail of `src` at `dest`.
///
/// The thumbnail keeps the source aspect ratio and fits within a
/// `size` x `size` box (it may be smaller than `size` on one axis).
///
/// # Errors
///
/// Returns an error string when the source cannot be opened or decoded
/// (`image decode: ...`) or the JPEG cannot be written to `dest`
/// (`save thumbnail: ...`).
pub fn generate(src: &Path, dest: &Path, size: u32) -> Result<(), String> {
    generate_box(src, dest, size, size)
}

/// Generates a JPEG thumbnail of `src` constrained to a `w` x `h` box.
///
/// Equivalent to [`generate`] with independent width and height bounds; the
/// source aspect ratio is preserved and the result fits inside the box.
///
/// # Errors
///
/// Returns an error string when the source cannot be opened or decoded
/// (`image decode: ...`) or the JPEG cannot be written to `dest`
/// (`save thumbnail: ...`).
pub fn generate_box(src: &Path, dest: &Path, w: u32, h: u32) -> Result<(), String> {
    let img = image::open(src).map_err(|e| format!("image decode: {e}"))?;
    let thumb = img.thumbnail(w, h);
    thumb
        .save_with_format(dest, image::ImageFormat::Jpeg)
        .map_err(|e| format!("save thumbnail: {e}"))
}
