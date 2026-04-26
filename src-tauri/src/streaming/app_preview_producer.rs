use std::sync::Arc;
use std::time::{Duration, SystemTime};

use openh264::OpenH264API;
use openh264::encoder::{
    BitRate, Encoder, EncoderConfig, FrameRate, IntraFramePeriod, UsageType,
};
use openh264::formats::{RgbSliceU8, YUVBuffer};
use serde_json::json;
use screenshots::Screen;
use tauri::{AppHandle, Emitter, Manager, async_runtime};
use tokio::sync::Mutex;
use tokio::time::MissedTickBehavior;
use webrtc::media::Sample;

use super::manager::StreamManager;

const APP_PREVIEW_FPS: u64 = 2;
const APP_PREVIEW_WIDTH: usize = 640;
const APP_PREVIEW_HEIGHT: usize = 360;

pub fn start_app_preview_producer(state: Arc<Mutex<StreamManager>>) {
    async_runtime::spawn(async move {
        let mut encoder = match create_encoder() {
            Ok(encoder) => encoder,
            Err(error) => {
                emit_debug(
                    &state,
                    "app_preview_producer_init_error",
                    json!({ "reason": error }),
                )
                .await;
                return;
            }
        };

        let mut ticker = tokio::time::interval(Duration::from_millis(1000 / APP_PREVIEW_FPS));
        ticker.set_missed_tick_behavior(MissedTickBehavior::Skip);

        let mut frame_index: u64 = 0;
        let mut last_capture_error_ms: u128 = 0;

        loop {
            ticker.tick().await;

            let (track, has_subscribers, app) = {
                let manager = state.lock().await;
                (
                    manager.app_preview_track.clone(),
                    !manager.app_preview_peers.is_empty(),
                    manager.app.clone(),
                )
            };

            if !has_subscribers {
                continue;
            }

            let (rgb_frame, source_label, capture_meta) = match capture_preview_rgb(&app) {
                Ok((frame, meta)) => (frame, "screen", meta),
                Err(error) => {
                    let now_ms = now_ms();
                    if now_ms.saturating_sub(last_capture_error_ms) > 3000 {
                        last_capture_error_ms = now_ms;
                        emit_debug(
                            &state,
                            "app_preview_capture_error",
                            json!({ "reason": error }),
                        )
                        .await;
                    }
                    (
                        generate_synthetic_rgb(frame_index, APP_PREVIEW_WIDTH, APP_PREVIEW_HEIGHT),
                        "synthetic_fallback",
                        json!({}),
                    )
                }
            };

            let rgb_slice = RgbSliceU8::new(
                &rgb_frame,
                (
                    APP_PREVIEW_WIDTH,
                    APP_PREVIEW_HEIGHT,
                ),
            );
            let yuv = YUVBuffer::from_rgb8_source(rgb_slice);
            let encoded = match encode_h264_frame(&mut encoder, &yuv) {
                Ok(encoded) => encoded,
                Err(error) => {
                    emit_debug(
                        &state,
                        "app_preview_encode_error",
                        json!({ "reason": error }),
                    )
                    .await;
                    continue;
                }
            };
            if encoded.is_empty() {
                continue;
            }

            let sample = Sample {
                data: encoded.clone().into(),
                timestamp: SystemTime::now(),
                duration: Duration::from_millis(1000 / APP_PREVIEW_FPS),
                ..Default::default()
            };

            if let Err(error) = track.write_sample(&sample).await {
                emit_debug(
                    &state,
                    "app_preview_write_error",
                    json!({ "reason": error.to_string() }),
                )
                .await;
                continue;
            }

            if frame_index % 8 == 0 {
                emit_debug(
                    &state,
                    "app_preview_frame_sent",
                    json!({
                        "source": source_label,
                        "bytes": encoded.len(),
                        "frame_index": frame_index,
                        "size": format!("{}x{}", APP_PREVIEW_WIDTH, APP_PREVIEW_HEIGHT),
                        "capture": capture_meta,
                    }),
                )
                .await;
            }

            frame_index = frame_index.saturating_add(1);
        }
    });
}

fn encode_h264_frame(encoder: &mut Encoder, yuv: &YUVBuffer) -> Result<Vec<u8>, String> {
    let bitstream = encoder.encode(yuv).map_err(|error| error.to_string())?;
    Ok(bitstream.to_vec())
}

fn create_encoder() -> Result<Encoder, String> {
    let api = OpenH264API::from_source();
    let config = EncoderConfig::new()
        .usage_type(UsageType::ScreenContentRealTime)
        .bitrate(BitRate::from_bps(350_000))
        .max_frame_rate(FrameRate::from_hz(APP_PREVIEW_FPS as f32))
        .intra_frame_period(IntraFramePeriod::from_num_frames(2));

    Encoder::with_api_config(api, config).map_err(|error| error.to_string())
}

fn capture_preview_rgb(app: &AppHandle) -> Result<(Vec<u8>, serde_json::Value), String> {
    let (anchor_x, anchor_y, monitor_label) = capture_anchor(app);
    let screen = Screen::from_point(anchor_x, anchor_y).map_err(|error| error.to_string())?;
    let image = screen.capture().map_err(|error| error.to_string())?;

    let src_width = image.width() as usize;
    let src_height = image.height() as usize;
    let src = image.as_raw();

    let rgb = resize_rgba_to_rgb_nearest(
        src,
        src_width,
        src_height,
        APP_PREVIEW_WIDTH,
        APP_PREVIEW_HEIGHT,
    );

    Ok((
        rgb,
        json!({
            "anchor_x": anchor_x,
            "anchor_y": anchor_y,
            "monitor": monitor_label,
            "source_size": format!("{}x{}", src_width, src_height),
        }),
    ))
}

fn capture_anchor(app: &AppHandle) -> (i32, i32, String) {
    if let Some(window) = app.get_webview_window("media-window") {
        if let Ok(position) = window.outer_position() {
            return (position.x + 8, position.y + 8, "media-window".to_string());
        }
    }

    if let Some(window) = app.get_webview_window("main") {
        if let Ok(position) = window.outer_position() {
            return (position.x + 8, position.y + 8, "main-window".to_string());
        }
    }

    (0, 0, "origin-fallback".to_string())
}

fn resize_rgba_to_rgb_nearest(
    src_rgba: &[u8],
    src_width: usize,
    src_height: usize,
    dst_width: usize,
    dst_height: usize,
) -> Vec<u8> {
    let mut out = vec![0u8; dst_width * dst_height * 3];

    for dst_y in 0..dst_height {
        let src_y = dst_y * src_height / dst_height;
        for dst_x in 0..dst_width {
            let src_x = dst_x * src_width / dst_width;
            let src_index = (src_y * src_width + src_x) * 4;
            let dst_index = (dst_y * dst_width + dst_x) * 3;

            out[dst_index] = src_rgba[src_index];
            out[dst_index + 1] = src_rgba[src_index + 1];
            out[dst_index + 2] = src_rgba[src_index + 2];
        }
    }

    out
}

fn generate_synthetic_rgb(frame_index: u64, width: usize, height: usize) -> Vec<u8> {
    let mut rgb = vec![0u8; width * height * 3];
    let phase = (frame_index % 120) as usize;

    for y in 0..height {
        for x in 0..width {
            let i = (y * width + x) * 3;

            let r = ((x + phase * 3) % 256) as u8;
            let g = ((y + phase * 2) % 256) as u8;
            let b = (((x + y) / 2 + phase * 4) % 256) as u8;

            rgb[i] = r;
            rgb[i + 1] = g;
            rgb[i + 2] = b;
        }
    }

    rgb
}

async fn emit_debug(state: &Arc<Mutex<StreamManager>>, event: &str, payload: serde_json::Value) {
    let app = {
        let manager = state.lock().await;
        manager.app.clone()
    };

    let _ = app.emit(
        "streaming_debug_log",
        json!({
            "ts_ms": now_ms(),
            "session_id": "desktop-producer",
            "device_id": "desktop-producer",
            "event": event,
            "payload": payload,
        }),
    );
}

fn now_ms() -> u128 {
    std::time::UNIX_EPOCH
        .elapsed()
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}
