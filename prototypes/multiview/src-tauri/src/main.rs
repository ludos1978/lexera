#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod webview_mgr;
mod drag_coordinator;
mod ghost_window;

use tauri::Manager;

fn main() {
    env_logger::init();

    tauri::Builder::default()
        .manage(webview_mgr::WebviewRegistry::default())
        .manage(drag_coordinator::DragState::default())
        .invoke_handler(tauri::generate_handler![
            webview_mgr::spawn_board,
            webview_mgr::set_webview_geometry,
            webview_mgr::list_webviews,
            drag_coordinator::drag_start,
            drag_coordinator::drag_pointer_move,
            drag_coordinator::drag_pointer_up,
            drag_coordinator::drag_cancel,
            drag_coordinator::drop_ack,
        ])
        .setup(|app| {
            let main_window = app.get_window("main").expect("main window must exist");
            // Spawn the three child board webviews after the shell loads.
            // The shell drives geometry via set_webview_geometry once it
            // knows its own client area dimensions.
            let app_handle = app.handle().clone();
            let win = main_window.clone();
            tauri::async_runtime::spawn(async move {
                // Wait briefly for the shell to be ready before spawning
                // children. In production this trigger comes from the
                // shell calling spawn_board() once it's mounted.
                tokio::time::sleep(std::time::Duration::from_millis(200)).await;
                // 500 cards per board × 3 boards = 1500 total — meaningful
                // density to stress the resize/drag perf hypothesis.
                let url = "board/index.html?cards=500";
                for label in ["board-a", "board-b", "board-c"] {
                    if let Err(err) = webview_mgr::spawn_board_internal(
                        &app_handle,
                        &win,
                        label,
                        url,
                        (0.0, 0.0),
                        (400.0, 800.0),
                    ) {
                        log::error!("failed to spawn {}: {}", label, err);
                    }
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
