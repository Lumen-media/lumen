use std::path::Path;

use openh264::decoder::{Decoder, DecoderConfig};
use openh264::formats::YUVSource;
use openh264::OpenH264API;
use symphonia::core::codecs::CODEC_TYPE_NULL;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

pub fn generate(src: &Path, dest: &Path, size: u32) -> Result<(), String> {
    let file = std::fs::File::open(src).map_err(|e| format!("file open: {e}"))?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());

    let mut hint = Hint::new();
    if let Some(ext) = src.extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }

    let probed = symphonia::default::get_probe()
        .format(
            &hint,
            mss,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .map_err(|e| format!("probe error: {e}"))?;

    let mut format = probed.format;

    let track = format
        .tracks()
        .iter()
        .find(|t| t.codec_params.codec != CODEC_TYPE_NULL)
        .ok_or_else(|| "no video track found".to_string())?;

    let track_id = track.id;

    let sps_pps = track
        .codec_params
        .extra_data
        .as_ref()
        .map(|d| parse_avcc_extra(d))
        .unwrap_or_default();

    let api = OpenH264API::from_source();
    let mut decoder = Decoder::with_api_config(api, DecoderConfig::default())
        .map_err(|e| format!("decoder init: {e}"))?;

    if !sps_pps.is_empty() {
        let _ = decoder.decode(&sps_pps);
    }

    loop {
        let packet = match format.next_packet() {
            Ok(p) => p,
            Err(_) => return Err("no decodable video frame found".into()),
        };

        if packet.track_id() != track_id {
            continue;
        }

        let annexb = avcc_to_annexb(&packet.data);

        match decoder.decode(&annexb) {
            Ok(Some(yuv)) => {
                let (w, h) = yuv.dimensions();
                let mut rgb = vec![0u8; w * h * 3];
                yuv.write_rgb8(&mut rgb);

                let img = image::RgbImage::from_raw(w as u32, h as u32, rgb)
                    .ok_or("failed to build image buffer")?;

                let thumb = image::DynamicImage::ImageRgb8(img).thumbnail(size, size);
                thumb
                    .save_with_format(dest, image::ImageFormat::Jpeg)
                    .map_err(|e| format!("save thumbnail: {e}"))?;

                return Ok(());
            }
            Ok(None) => continue,
            Err(_) => continue,
        }
    }
}

fn parse_avcc_extra(data: &[u8]) -> Vec<u8> {
    if data.len() < 7 {
        return Vec::new();
    }

    let mut out = Vec::new();
    let mut i = 5usize;

    let num_sps = (data[i] & 0x1f) as usize;
    i += 1;
    for _ in 0..num_sps {
        if i + 2 > data.len() {
            break;
        }
        let len = u16::from_be_bytes([data[i], data[i + 1]]) as usize;
        i += 2;
        if i + len > data.len() {
            break;
        }
        out.extend_from_slice(&[0, 0, 0, 1]);
        out.extend_from_slice(&data[i..i + len]);
        i += len;
    }

    if i >= data.len() {
        return out;
    }
    let num_pps = data[i] as usize;
    i += 1;
    for _ in 0..num_pps {
        if i + 2 > data.len() {
            break;
        }
        let len = u16::from_be_bytes([data[i], data[i + 1]]) as usize;
        i += 2;
        if i + len > data.len() {
            break;
        }
        out.extend_from_slice(&[0, 0, 0, 1]);
        out.extend_from_slice(&data[i..i + len]);
        i += len;
    }

    out
}

fn avcc_to_annexb(data: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(data.len() + 16);
    let mut i = 0;
    while i + 4 <= data.len() {
        let len = u32::from_be_bytes([data[i], data[i + 1], data[i + 2], data[i + 3]]) as usize;
        i += 4;
        if i + len > data.len() {
            break;
        }
        out.extend_from_slice(&[0, 0, 0, 1]);
        out.extend_from_slice(&data[i..i + len]);
        i += len;
    }
    out
}
