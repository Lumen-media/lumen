mod module_runtime;

use tauri::Manager;
use module_runtime::{
    ModuleRuntime,
    dev_server::start_dev_server,
    module_data_json_delete, module_data_json_load, module_data_json_save,
    module_data_json_set, module_disable, module_enable, module_fs_exists, module_fs_list,
    module_fs_read, module_fs_remove, module_fs_write, module_get, module_install,
    module_list_installed, module_uninstall,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_websocket::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_deep_link::init())
        .invoke_handler(tauri::generate_handler![
            open_folder,
            module_list_installed,
            module_install,
            module_get,
            module_enable,
            module_disable,
            module_uninstall,
            module_data_json_load,
            module_data_json_save,
            module_data_json_set,
            module_data_json_delete,
            module_fs_read,
            module_fs_write,
            module_fs_exists,
            module_fs_list,
            module_fs_remove,
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            let runtime = ModuleRuntime::init(app.handle())
                .expect("failed to initialize module runtime");
            app.manage(runtime);

            if cfg!(debug_assertions) {
                let app_handle = app.handle().clone();
                tokio::spawn(async move {
                    start_dev_server(app_handle).await;
                });
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
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
