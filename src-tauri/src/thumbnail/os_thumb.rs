//! Operating-system thumbnail providers.
//!
//! Requests a native thumbnail from the platform instead of decoding the file
//! ourselves, which is dramatically cheaper for videos and large images:
//!
//! - **Windows**: `IShellItemImageFactory` (Shell thumbnail cache) converted
//!   from `HBITMAP` to BGRA pixels.
//! - **Linux**: the FreeDesktop thumbnail cache spec
//!   (`~/.cache/thumbnails/{normal,large}/<md5 of file:// URI>.png`).
//! - **macOS / other**: not supported, always returns `None` so callers fall
//!   back to [`super::image_thumb`] or [`super::video_thumb`].
//!
//! This module is the first resolution step of [`super::get_thumbnail`] and of
//! the fast path in [`super::protocol`].

use std::path::Path;

/// Tries to save an OS-provided thumbnail of `src` into `dest` as JPEG.
///
/// The image returned by the platform is fitted into a `size` x `size` box
/// before encoding. Returns `true` only when the thumbnail was produced and
/// written successfully; any missing provider, decode failure, or I/O error
/// results in `false`.
pub fn try_get(src: &Path, dest: &Path, size: u32) -> bool {
    if let Some(img) = get_thumbnail(src, size) {
        let img = img.thumbnail(size, size);
        img.save_with_format(dest, image::ImageFormat::Jpeg).is_ok()
    } else {
        false
    }
}

/// Returns the platform's native thumbnail for `src`, if one is available.
///
/// The image is returned unscaled beyond what the provider itself produced
/// (`size` is only a hint passed to the OS). Returns `None` when the platform
/// has no thumbnail for the file, when the provider is unsupported (macOS and
/// other targets), or when reading the cached thumbnail fails.
pub fn get_thumbnail(src: &Path, size: u32) -> Option<image::DynamicImage> {
    platform::get_thumbnail(src, size)
}

// ── Windows: IShellItemImageFactory → HBITMAP → BGRA pixels ──────────────────

#[cfg(target_os = "windows")]
mod platform {
    use std::path::Path;

    /// Windows provider backed by the Shell thumbnail cache.
    pub fn get_thumbnail(src: &Path, size: u32) -> Option<image::DynamicImage> {
        unsafe { via_shell(src, size) }
    }

    /// Requests a `size` x `size` thumbnail through
    /// `IShellItemImageFactory::GetImage` with `SIIGBF_THUMBNAILONLY`, reads the
    /// resulting `HBITMAP` into a top-down 32-bit DIB, swaps the BGRA channels
    /// into RGBA, and wraps the pixels in a [`image::DynamicImage`].
    ///
    /// All GDI objects created here (compatible DC, selected bitmap) are
    /// released on every path, including early returns.
    ///
    /// # Safety
    ///
    /// Calls Win32 GDI/COM APIs with raw handles and pointers. The caller must
    /// ensure the current thread can initialize COM (best effort here via
    /// `CoInitializeEx`) and that `src` is a path that can be lossily converted
    /// to a wide string; the returned image is only produced when every GDI
    /// call succeeds, otherwise `None` is returned.
    unsafe fn via_shell(src: &Path, size: u32) -> Option<image::DynamicImage> {
        use windows::Win32::Foundation::SIZE;
        use windows::Win32::Graphics::Gdi::{
            CreateCompatibleDC, DeleteDC, GetDC, GetDIBits, GetObjectW, ReleaseDC, SelectObject,
            BITMAP, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HGDIOBJ,
        };
        use windows::Win32::System::Com::{CoInitializeEx, COINIT};
        use windows::Win32::UI::Shell::{IShellItemImageFactory, SHCreateItemFromParsingName, SIIGBF};
        use windows::core::PCWSTR;

        const FLAGS: SIIGBF = SIIGBF(0x01);

        let _ = CoInitializeEx(None, COINIT(0x2));

        let normalized = src.to_string_lossy().replace('/', "\\");
        let wide: Vec<u16> = normalized
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();

        let factory: IShellItemImageFactory =
            SHCreateItemFromParsingName(PCWSTR(wide.as_ptr()), None).ok()?;

        let sz = SIZE { cx: size as i32, cy: size as i32 };
        let hbitmap = factory.GetImage(sz, FLAGS).ok()?;

        let mut bm = BITMAP::default();
        GetObjectW(
            HGDIOBJ(hbitmap.0),
            std::mem::size_of::<BITMAP>() as i32,
            Some(&mut bm as *mut BITMAP as *mut _),
        );

        let w = bm.bmWidth;
        let h = bm.bmHeight.abs();

        if w == 0 || h == 0 {
            windows::Win32::Graphics::Gdi::DeleteObject(HGDIOBJ(hbitmap.0));
            return None;
        }

        let mut bmi = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: w,
                biHeight: -h, // negative = top-down scanlines
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };

        let mut pixels = vec![0u8; (w * h * 4) as usize];
        let hdc_screen = GetDC(None);
        let hdc_mem = CreateCompatibleDC(hdc_screen);
        let old_bmp = SelectObject(hdc_mem, HGDIOBJ(hbitmap.0));

        let lines = GetDIBits(
            hdc_mem,
            hbitmap,
            0,
            h as u32,
            Some(pixels.as_mut_ptr() as *mut _),
            &mut bmi,
            DIB_RGB_COLORS,
        );

        SelectObject(hdc_mem, old_bmp);
        DeleteDC(hdc_mem);
        ReleaseDC(None, hdc_screen);
        windows::Win32::Graphics::Gdi::DeleteObject(HGDIOBJ(hbitmap.0));

        if lines == 0 {
            return None;
        }

        for chunk in pixels.chunks_exact_mut(4) {
            chunk.swap(0, 2);
        }

        let img = image::RgbaImage::from_raw(w as u32, h as u32, pixels)?;
        Some(image::DynamicImage::ImageRgba8(img))
    }
}

// ── Linux: Freedesktop thumbnail spec (md5 of file:// URI) ───────────────────

/// Linux provider reading the FreeDesktop thumbnail cache.
///
/// Looks up `<md5("file://" + path)>.png` under `~/.cache/thumbnails/normal`
/// (requests up to 128 px) or `.../large` (above 128 px) and opens it if it
/// exists; `None` means the cache has no entry yet (no thumbnail daemon ran,
/// or the file was never indexed).
#[cfg(target_os = "linux")]
mod platform {
    use std::path::Path;

    /// Returns the cached FreeDesktop thumbnail for `src`, if present.
    pub fn get_thumbnail(src: &Path, size: u32) -> Option<image::DynamicImage> {
        // filename = md5(file://path).png; normal/ = 128px max, large/ = 256px max
        let uri = format!("file://{}", src.to_string_lossy());
        let hash = format!("{:x}", md5::compute(uri.as_bytes()));

        let subdir = if size <= 128 { "normal" } else { "large" };

        let cache = std::env::var("HOME")
            .map(|h| std::path::PathBuf::from(h).join(".cache").join("thumbnails"))
            .ok()?;

        let thumb = cache.join(subdir).join(format!("{hash}.png"));

        if !thumb.exists() {
            return None;
        }

        image::open(&thumb).ok()
    }
}

// ── macOS: not supported (QuickLook cache is proprietary) ────────────────────

/// macOS provider stub.
///
/// QuickLook's thumbnail cache is a proprietary format with no public API, so
/// there is nothing to read here; callers always fall back to decoding.
#[cfg(target_os = "macos")]
mod platform {
    use std::path::Path;

    /// Always returns `None` (no supported OS thumbnail source on macOS).
    pub fn get_thumbnail(_src: &Path, _size: u32) -> Option<image::DynamicImage> {
        None
    }
}

// ── Other platforms: no OS thumbnail source ──────────────────────────────────

/// Fallback provider for platforms without an OS thumbnail source.
#[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
mod platform {
    use std::path::Path;

    /// Always returns `None` (no supported OS thumbnail source).
    pub fn get_thumbnail(_src: &Path, _size: u32) -> Option<image::DynamicImage> {
        None
    }
}
