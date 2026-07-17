mod commands;
mod import;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::import_csv,
            commands::export_csv,
            commands::export_json,
            commands::export_bytes,
            commands::save_session,
            commands::load_session,
        ])
        .run(tauri::generate_context!())
        .expect("error while running ArtifactGrid");
}
