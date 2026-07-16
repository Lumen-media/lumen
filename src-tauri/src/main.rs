#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod devices;
mod module_runtime;
mod streaming;
mod thumbnail;
mod websocket;

use module_runtime::{ModuleRuntime, dev_server::start_dev_server, protocol::handle_module_request};

use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{Emitter, Manager, State, async_runtime};
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
use tauri_plugin_window_state::{AppHandleExt, StateFlags};
use tokio::net::TcpListener;

struct WindowState {
    positions: Mutex<HashMap<String, (i32, i32)>>,
}

const MEDIA_WINDOW_LABEL: &str = "media-window";
const MEDIA_WINDOW_MIN_WIDTH: f64 = 1050.0;
const MEDIA_WINDOW_MIN_HEIGHT: f64 = 650.0;
const MEDIA_WINDOW_INITIAL_WIDTH: f64 = 1280.0;
const MEDIA_WINDOW_INITIAL_HEIGHT: f64 = 720.0;

#[tauri::command]
fn get_exe_dir() -> Result<String, String> {
    std::env::current_exe()
        .map_err(|e| e.to_string())
        .and_then(|path| {
            path.parent()
                .map(|p| p.to_string_lossy().to_string())
                .ok_or_else(|| "Could not get executable parent directory".to_string())
        })
}

#[tauri::command]
fn open_folder(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn create_window(
    app_handle: tauri::AppHandle,
    label: String,
    title: String,
    route: Option<String>,
    window_state: State<'_, WindowState>,
) -> Result<(), String> {
    let main_window = app_handle
        .get_webview_window("main")
        .ok_or_else(|| "Main window not found".to_string())?;

    let saved_position = {
        let positions = window_state.positions.lock().unwrap();
        positions.get(&label).cloned()
    };

    let target_position = if let Some((saved_x, saved_y)) = saved_position {
        tauri::PhysicalPosition {
            x: saved_x,
            y: saved_y,
        }
    } else {
        let current_monitor = main_window
            .current_monitor()
            .map_err(|e| format!("Failed to get current monitor: {}", e))?
            .ok_or_else(|| "Current monitor not found".to_string())?;

        let monitors = main_window
            .available_monitors()
            .map_err(|e| format!("Failed to get monitors: {}", e))?;

        let target_monitor = if monitors.len() > 1 {
            monitors
                .into_iter()
                .find(|m| {
                    let pos1 = m.position();
                    let pos2 = current_monitor.position();
                    pos1.x != pos2.x || pos1.y != pos2.y
                })
                .unwrap_or(current_monitor)
        } else {
            current_monitor
        };

        let monitor_position = target_monitor.position();

        tauri::PhysicalPosition {
            x: monitor_position.x,
            y: monitor_position.y,
        }
    };

    let mut builder = tauri::WebviewWindowBuilder::new(
        &app_handle,
        &label,
        tauri::WebviewUrl::App(route.unwrap_or_else(|| "/media-window".to_string()).into()),
    )
    .title(&title)
    .decorations(false)
    .visible(false);

    if label == MEDIA_WINDOW_LABEL {
        builder = builder
            .inner_size(MEDIA_WINDOW_INITIAL_WIDTH, MEDIA_WINDOW_INITIAL_HEIGHT)
            .min_inner_size(MEDIA_WINDOW_MIN_WIDTH, MEDIA_WINDOW_MIN_HEIGHT);
    }

    let window = builder
        .build()
        .map_err(|e| format!("Failed to create window: {}", e))?;

    window
        .set_position(tauri::Position::Physical(target_position))
        .map_err(|e| format!("Failed to set window position: {}", e))?;

    {
        let mut positions = window_state.positions.lock().unwrap();
        positions.insert(label.clone(), (target_position.x, target_position.y));
    }

    Ok(())
}

#[tauri::command]
async fn create_overlay_window(
    app_handle: tauri::AppHandle,
    label: String,
    title: String,
    route: Option<String>,
) -> Result<(), String> {
    let main_window = app_handle
        .get_webview_window("main")
        .ok_or_else(|| "Main window not found".to_string())?;

    let main_position = main_window
        .outer_position()
        .map_err(|e| format!("Failed to get main window position: {}", e))?;

    let window = tauri::WebviewWindowBuilder::new(
        &app_handle,
        &label,
        tauri::WebviewUrl::App(route.unwrap_or_else(|| "/module-overlay-window".to_string()).into()),
    )
    .title(&title)
    .decorations(true)
    .fullscreen(false)
    .inner_size(960.0, 540.0)
    .min_inner_size(720.0, 405.0)
    .visible(false)
    .build()
    .map_err(|e| format!("Failed to create overlay window: {}", e))?;

    window
        .set_position(tauri::Position::Physical(tauri::PhysicalPosition {
            x: main_position.x + 80,
            y: main_position.y + 80,
        }))
        .map_err(|e| format!("Failed to set overlay window position: {}", e))?;

    Ok(())
}

#[tauri::command]
async fn save_window_position(
    label: String,
    x: i32,
    y: i32,
    window_state: State<'_, WindowState>,
) -> Result<(), String> {
    let mut positions = window_state.positions.lock().unwrap();
    positions.insert(label, (x, y));
    Ok(())
}

#[tauri::command]
fn get_system_fonts() -> Vec<String> {
    let mut families: Vec<String> = font_loader::system_fonts::query_all();
    families.sort_unstable();
    families.dedup();
    families
}

#[derive(serde::Serialize)]
struct SystemHardwareInfo {
    total_memory_gb: f64,
    gpu_name: String,
}

#[tauri::command]
fn get_system_info() -> SystemHardwareInfo {
    use sysinfo::System;

    let mut sys = System::new();
    sys.refresh_memory();

    let total_memory_gb = sys.total_memory() as f64 / 1024.0 / 1024.0 / 1024.0;

    SystemHardwareInfo {
        total_memory_gb: (total_memory_gb * 10.0).round() / 10.0,
        gpu_name: get_gpu_name(),
    }
}

fn get_gpu_name() -> String {
    #[cfg(target_os = "windows")]
    {
        if let Ok(out) = std::process::Command::new("powershell")
            .args([
                "-NoProfile",
                "-Command",
                "(Get-WmiObject Win32_VideoController | Select-Object -First 1).Name",
            ])
            .output()
        {
            let name = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !name.is_empty() {
                return name;
            }
        }
    }
    #[cfg(target_os = "macos")]
    {
        if let Ok(out) = std::process::Command::new("system_profiler")
            .args(["SPDisplaysDataType"])
            .output()
        {
            let text = String::from_utf8_lossy(&out.stdout);
            for line in text.lines() {
                let trimmed = line.trim();
                if trimmed.starts_with("Chipset Model:") {
                    if let Some(name) = trimmed.strip_prefix("Chipset Model:") {
                        return name.trim().to_string();
                    }
                }
            }
        }
    }
    #[cfg(target_os = "linux")]
    {
        if let Ok(out) = std::process::Command::new("lspci").output() {
            let text = String::from_utf8_lossy(&out.stdout);
            for line in text.lines() {
                let lower = line.to_lowercase();
                if lower.contains("vga")
                    || lower.contains("3d controller")
                    || lower.contains("display")
                {
                    if let Some(pos) = line.find(": ") {
                        return line[pos + 2..].trim().to_string();
                    }
                }
            }
        }
    }
    "Unknown".to_string()
}

#[derive(serde::Serialize, Clone)]
struct StreamOverlayPayload {
    active: bool,
}

#[tauri::command]
async fn set_stream_overlay(app: tauri::AppHandle, active: bool) -> Result<(), String> {
    app.emit("stream-overlay-toggle", StreamOverlayPayload { active })
        .map_err(|e| e.to_string())
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    rayon::ThreadPoolBuilder::new()
        .num_threads(2)
        .build_global()
        .ok();

    tauri::Builder::default()
        .register_uri_scheme_protocol("lumen-module", handle_module_request)
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_sql::Builder::new().build())
        .manage(WindowState {
            positions: Mutex::new(HashMap::new()),
        })
        .manage(devices::default_device_state())
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            println!("Single instance callback:");
            println!("  args: {:?}", args);
            println!("  cwd: {:?}", cwd);

            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
                let _ = window.unminimize();
                let _ = window.show();
            }

            let _ = app.emit("single-instance", args);
        }))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(StateFlags::all() & !StateFlags::DECORATIONS & !StateFlags::VISIBLE)
                .build(),
        )
        .plugin(tauri_plugin_log::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_websocket::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let runtime = ModuleRuntime::init(app.handle())
                .expect("failed to initialize module runtime");
            app.manage(runtime);

            let app_handle = app.handle().clone();
            async_runtime::spawn(async move {
                start_dev_server(app_handle).await;
            });

            devices::ensure_remote_access_ready(&app.handle()).map_err(|e| e.to_string())?;
            let streaming_state = streaming::initialize_streaming_state(&app.handle())?;
            app.manage(streaming_state);
            let app_handle = app.handle();
            let app_handle_clone = app_handle.clone();
            async_runtime::spawn(async move {
                let listener = TcpListener::bind("0.0.0.0:8080").await.unwrap();
                while let Ok((stream, _)) = listener.accept().await {
                    let peer = stream
                        .peer_addr()
                        .expect("connected streams should have a peer address");

                    async_runtime::spawn(websocket::accept_connection(
                        peer,
                        stream,
                        app_handle_clone.clone(),
                    ));
                }
            });

            let show = MenuItemBuilder::with_id("show", "Show Lumen").build(app)?;
            let quit = MenuItemBuilder::with_id("quit", "Quit").build(app)?;
            let menu = MenuBuilder::new(app)
                .item(&show)
                .separator()
                .item(&quit)
                .build()?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .tooltip("Lumen")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            if let Some(window) = app.get_webview_window("main") {
                let app_handle = app.handle().clone();
                let window_clone = window.clone();

                let locale = tauri_plugin_os::locale().unwrap_or_default();
                let is_portuguese = locale.starts_with("pt");

                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();

                        let (message, keep_btn, close_btn) = if is_portuguese {
                            ("Deseja manter o Lumen em segundo plano?", "Manter em segundo plano", "Fechar")
                        } else {
                            ("Keep Lumen running in the background?", "Keep in background", "Close")
                        };

                        let app = app_handle.clone();
                        let win = window_clone.clone();

                        app_handle
                            .dialog()
                            .message(message)
                            .buttons(MessageDialogButtons::OkCancelCustom(
                                keep_btn.into(),
                                close_btn.into(),
                            ))
                            .title("Lumen")
                            .show(move |keep_in_background| {
                                if keep_in_background {
                                    let _ = app.save_window_state(
                                        StateFlags::all() & !StateFlags::DECORATIONS & !StateFlags::VISIBLE,
                                    );
                                    let _ = win.hide();
                                } else {
                                    app.exit(0);
                                }
                            });
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_exe_dir,
            open_folder,
            create_window,
            create_overlay_window,
            save_window_position,
            get_system_fonts,
            get_system_info,
            devices::get_local_ip,
            devices::gen_reg_token,
            devices::get_devices,
            devices::get_remote_access_settings,
            devices::update_remote_access_settings,
            devices::toggle_device,
            devices::update_device_permissions,
            devices::remove_device,
            devices::broadcast_remote_event,
            streaming::manager::get_streaming_config,
            streaming::manager::update_streaming_config,
            streaming::manager::get_streaming_status,
            streaming::manager::set_stream_content_protected,
            streaming::manager::set_mobile_preview_device,
            streaming::manager::push_stream_slide,
            streaming::manager::push_stream_blank,
            set_stream_overlay,
            thumbnail::get_thumbnail,
            module_runtime::module_list_installed,
            module_runtime::module_install,
            module_runtime::module_get,
            module_runtime::module_enable,
            module_runtime::module_disable,
            module_runtime::module_uninstall,
            module_runtime::module_data_json_load,
            module_runtime::module_data_json_save,
            module_runtime::module_data_json_set,
            module_runtime::module_data_json_delete,
            module_runtime::module_fs_read,
            module_runtime::module_fs_write,
            module_runtime::module_fs_exists,
            module_runtime::module_fs_list,
            module_runtime::module_fs_remove,
            module_runtime::net::module_net_request,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");

    Ok(())
}

