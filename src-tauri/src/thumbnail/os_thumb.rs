use std::path::Path;

pub fn try_get(src: &Path, dest: &Path, size: u32) -> bool {
    if let Some(img) = platform::get_thumbnail(src, size) {
        img.save_with_format(dest, image::ImageFormat::Jpeg).is_ok()
    } else {
        false
    }
}

// ── Windows ──────────────────────────────────────────────────────────────────

#[cfg(target_os = "windows")]
mod platform {
    use std::path::Path;

    pub fn get_thumbnail(src: &Path, size: u32) -> Option<image::DynamicImage> {
        unsafe { via_shell(src, size) }
    }

    unsafe fn via_shell(src: &Path, size: u32) -> Option<image::DynamicImage> {
        use windows::Win32::Foundation::SIZE;
        use windows::Win32::Graphics::Gdi::{
            CreateCompatibleDC, DeleteDC, GetDC, GetDIBits, GetObjectW, ReleaseDC, SelectObject,
            BITMAP, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HGDIOBJ,
        };
        use windows::Win32::System::Com::{CoInitializeEx, COINIT};
        use windows::Win32::UI::Shell::{IShellItemImageFactory, SHCreateItemFromParsingName, SIIGBF};
        use windows::core::PCWSTR;

        // SIIGBF_BIGGERSIZEOK (0x01) — return closest available size, use Shell cache or generate
        const FLAGS: SIIGBF = SIIGBF(0x01);

        // Shell COM objects require STA
        let _ = CoInitializeEx(None, COINIT(0x2)); // COINIT_APARTMENTTHREADED

        let wide: Vec<u16> = src
            .to_string_lossy()
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();

        let factory: IShellItemImageFactory =
            SHCreateItemFromParsingName(PCWSTR(wide.as_ptr()), None).ok()?;

        let sz = SIZE { cx: size as i32, cy: size as i32 };
        let hbitmap = factory.GetImage(sz, FLAGS).ok()?;

        // Get actual bitmap dimensions
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

        // Windows returns BGRA — convert to RGBA
        for chunk in pixels.chunks_exact_mut(4) {
            chunk.swap(0, 2);
        }

        let img = image::RgbaImage::from_raw(w as u32, h as u32, pixels)?;
        Some(image::DynamicImage::ImageRgba8(img))
    }
}

// ── Linux (Freedesktop thumbnail spec) ───────────────────────────────────────

#[cfg(target_os = "linux")]
mod platform {
    use std::path::Path;

    pub fn get_thumbnail(src: &Path, size: u32) -> Option<image::DynamicImage> {
        // Freedesktop spec: filename = md5(file://path).png
        // normal/ = 128px max, large/ = 256px max
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

// ── macOS — not supported (QuickLook cache is proprietary) ───────────────────

#[cfg(target_os = "macos")]
mod platform {
    use std::path::Path;

    pub fn get_thumbnail(_src: &Path, _size: u32) -> Option<image::DynamicImage> {
        None
    }
}

// ── Other platforms ───────────────────────────────────────────────────────────

#[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
mod platform {
    use std::path::Path;

    pub fn get_thumbnail(_src: &Path, _size: u32) -> Option<image::DynamicImage> {
        None
    }
}
