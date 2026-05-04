use tauri::menu::{CheckMenuItemBuilder, MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::{Manager, Runtime};

/// One entry for the dynamic "File > Open Workspace ▶" submenu.
#[derive(serde::Deserialize, Clone, Debug)]
pub struct WorkspaceMenuEntry {
    pub id: String,
    pub name: String,
}

/// Prefix used on dynamically-generated submenu items so the shared
/// menu-id → action mapper can recognize them and emit
/// `open-workspace:<id>` to the frontend ActionRegistry.
pub const OPEN_WORKSPACE_ITEM_PREFIX: &str = "file-open-workspace::";

pub fn create_app_menu<R: Runtime, M: Manager<R>>(
    app: &M,
    workspaces: &[WorkspaceMenuEntry],
) -> Result<tauri::menu::Menu<R>, Box<dyn std::error::Error>> {
    // ── App menu (macOS only, first submenu = app name) ──
    let app_menu = SubmenuBuilder::new(app, "Lexera Kanban")
        .item(&PredefinedMenuItem::about(app, Some("About Lexera Kanban"), Default::default())?)
        .separator()
        .item(&PredefinedMenuItem::services(app, Some("Services"))?)
        .separator()
        .item(&PredefinedMenuItem::hide(app, Some("Hide Lexera Kanban"))?)
        .item(&PredefinedMenuItem::hide_others(app, Some("Hide Others"))?)
        .item(&PredefinedMenuItem::show_all(app, Some("Show All"))?)
        .separator()
        .item(&MenuItemBuilder::with_id("app-quit", "Quit Lexera Kanban").accelerator("CmdOrCtrl+Q").build(app)?)
        .build()?;

    // ── File > Open Workspace submenu (dynamic) ──
    // Hover-triggered list of every configured workspace. Each entry
    // spawns a fresh window pinned to that workspace via the URL lock.
    // The list is rebuilt every time the workspace catalog changes —
    // see `set_workspaces_submenu` Tauri command.
    let mut open_workspace_builder = SubmenuBuilder::new(app, "Open Workspace");
    if workspaces.is_empty() {
        let placeholder = MenuItemBuilder::with_id("file-open-workspace::__none__", "(no workspaces — create one in Workspace Settings)")
            .enabled(false)
            .build(app)?;
        open_workspace_builder = open_workspace_builder.item(&placeholder);
    } else {
        for ws in workspaces {
            let id = format!("{}{}", OPEN_WORKSPACE_ITEM_PREFIX, ws.id);
            let label = if ws.name.is_empty() { "(untitled)" } else { ws.name.as_str() };
            let item = MenuItemBuilder::with_id(id, label).build(app)?;
            open_workspace_builder = open_workspace_builder.item(&item);
        }
    }
    let open_workspace_submenu = open_workspace_builder.build()?;

    // ── File menu ──
    let file_menu = SubmenuBuilder::new(app, "File")
        .item(&MenuItemBuilder::with_id("file-new-window", "New Window").accelerator("CmdOrCtrl+N").build(app)?)
        .item(&open_workspace_submenu)
        .separator()
        .item(&MenuItemBuilder::with_id("file-save", "Save").accelerator("CmdOrCtrl+S").build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("file-rename", "Rename Board File").build(app)?)
        .item(&MenuItemBuilder::with_id("file-reveal", "Reveal in Finder").build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("file-export", "Export / Pack…").build(app)?)
        .item(&MenuItemBuilder::with_id("file-copy-markdown", "Copy Board as Markdown").build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("file-board-settings", "Board Settings…").build(app)?)
        .item(&MenuItemBuilder::with_id("file-backend-settings", "Backend Settings…").build(app)?)
        .build()?;

    // ── Edit menu ──
    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .item(&MenuItemBuilder::with_id("edit-undo", "Undo").accelerator("CmdOrCtrl+Z").build(app)?)
        .item(&MenuItemBuilder::with_id("edit-redo", "Redo").accelerator("CmdOrCtrl+Shift+Z").build(app)?)
        .separator()
        .item(&PredefinedMenuItem::cut(app, Some("Cut"))?)
        .item(&PredefinedMenuItem::copy(app, Some("Copy"))?)
        .item(&PredefinedMenuItem::paste(app, Some("Paste"))?)
        .item(&PredefinedMenuItem::select_all(app, Some("Select All"))?)
        .separator()
        .item(&MenuItemBuilder::with_id("edit-find", "Find…").accelerator("CmdOrCtrl+F").build(app)?)
        .item(&MenuItemBuilder::with_id("edit-find-replace", "Find & Replace…").accelerator("CmdOrCtrl+Shift+H").build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("edit-paste-as-card", "Paste as Card").build(app)?)
        .item(&MenuItemBuilder::with_id("edit-smart-paste", "Smart Paste").build(app)?)
        .build()?;

    // ── View menu ──
    let pin_headers_sub = SubmenuBuilder::new(app, "Pin Column Headers")
        .item(&MenuItemBuilder::with_id("view-pin-headers-off", "Off").build(app)?)
        .item(&MenuItemBuilder::with_id("view-pin-headers-top", "Top Edge").build(app)?)
        .item(&MenuItemBuilder::with_id("view-pin-headers-bottom", "Bottom Edge").build(app)?)
        .build()?;

    let split_view_sub = SubmenuBuilder::new(app, "Split View")
        .item(&MenuItemBuilder::with_id("view-split-single", "Single Pane").build(app)?)
        .item(&MenuItemBuilder::with_id("view-split-vertical", "Vertical Split").build(app)?)
        .item(&MenuItemBuilder::with_id("view-split-horizontal", "Horizontal Split").build(app)?)
        .build()?;

    let tag_visibility_sub = SubmenuBuilder::new(app, "Tag Visibility")
        .item(&MenuItemBuilder::with_id("view-tags-all", "All Tags").build(app)?)
        .item(&MenuItemBuilder::with_id("view-tags-no-layout", "All Except Layout Tags").build(app)?)
        .item(&MenuItemBuilder::with_id("view-tags-custom", "Custom Tags Only").build(app)?)
        .item(&MenuItemBuilder::with_id("view-tags-mentions", "Mentions Only").build(app)?)
        .item(&MenuItemBuilder::with_id("view-tags-dim", "Dim Tags").build(app)?)
        .item(&MenuItemBuilder::with_id("view-tags-hide", "Hide Tags").build(app)?)
        .build()?;

    let html_comments_sub = SubmenuBuilder::new(app, "HTML Comments")
        .item(&MenuItemBuilder::with_id("view-html-comments-render", "Render HTML").build(app)?)
        .item(&MenuItemBuilder::with_id("view-html-comments-text", "Show as Text").build(app)?)
        .item(&MenuItemBuilder::with_id("view-html-comments-dim", "Dim Comments").build(app)?)
        .build()?;

    let html_content_sub = SubmenuBuilder::new(app, "HTML Content")
        .item(&MenuItemBuilder::with_id("view-html-content-render", "Render HTML").build(app)?)
        .item(&MenuItemBuilder::with_id("view-html-content-text", "Show as Text").build(app)?)
        .build()?;

    let zoom_sub = SubmenuBuilder::new(app, "Zoom")
        .item(&MenuItemBuilder::with_id("view-zoom-in", "Zoom In").accelerator("CmdOrCtrl+=").build(app)?)
        .item(&MenuItemBuilder::with_id("view-zoom-out", "Zoom Out").accelerator("CmdOrCtrl+-").build(app)?)
        .item(&MenuItemBuilder::with_id("view-zoom-reset", "Reset Zoom (100%)").accelerator("CmdOrCtrl+0").build(app)?)
        .build()?;

    let panels_sub = SubmenuBuilder::new(app, "Panels")
        .item(&MenuItemBuilder::with_id("view-panel-hierarchy", "Workspaces").build(app)?)
        .item(&MenuItemBuilder::with_id("view-panel-dashboard", "Dashboard").build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("view-panel-week-calendar", "Week Calendar").build(app)?)
        .item(&MenuItemBuilder::with_id("view-panel-month-calendar", "Month Calendar").build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("view-panel-files", "Workspace Settings").build(app)?)
        .item(&MenuItemBuilder::with_id("view-panel-logs", "Logs").build(app)?)
        .item(&MenuItemBuilder::with_id("view-panel-backend-settings", "Backend Settings").build(app)?)
        .item(&MenuItemBuilder::with_id("view-panel-frontend-settings", "Frontend Settings").build(app)?)
        .item(&MenuItemBuilder::with_id("view-panel-render-apps", "Plugin Settings").build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("view-panel-frontend-tests", "Frontend Tests").build(app)?)
        .build()?;

    let view_menu = SubmenuBuilder::new(app, "View")
        .item(&panels_sub)
        .separator()
        .item(&MenuItemBuilder::with_id("view-fold-cards", "Fold All Cards").build(app)?)
        .item(&MenuItemBuilder::with_id("view-fold-columns", "Fold All Columns").build(app)?)
        .separator()
        .item(&pin_headers_sub)
        .item(&split_view_sub)
        .separator()
        .item(&tag_visibility_sub)
        .item(&html_comments_sub)
        .item(&html_content_sub)
        .separator()
        .item(&CheckMenuItemBuilder::with_id("view-special-chars", "Show Special Characters").build(app)?)
        .item(&CheckMenuItemBuilder::with_id("view-overlay-editor", "Overlay Editor").build(app)?)
        .separator()
        .item(&zoom_sub)
        .separator()
        .item(&MenuItemBuilder::with_id("view-inspector", "Developer Tools").accelerator("F12").build(app)?)
        .item(&MenuItemBuilder::with_id("view-inspector-all", "Developer Tools (All Views)").accelerator("Shift+F12").build(app)?)
        .build()?;

    // ── Format menu ──
    let visual_style_sub = SubmenuBuilder::new(app, "Visual Style")
        .item(&MenuItemBuilder::with_id("fmt-theme-classic", "Classic").build(app)?)
        .item(&MenuItemBuilder::with_id("fmt-theme-sleek-uniform", "Sleek Uniform").build(app)?)
        .build()?;

    let tag_style_sub = SubmenuBuilder::new(app, "Tag Style Preset")
        .item(&MenuItemBuilder::with_id("fmt-tag-style-default", "Default").build(app)?)
        .item(&MenuItemBuilder::with_id("fmt-tag-style-minimal", "Minimal").build(app)?)
        .item(&MenuItemBuilder::with_id("fmt-tag-style-full", "Full").build(app)?)
        .item(&MenuItemBuilder::with_id("fmt-tag-style-badges", "Badges Only").build(app)?)
        .build()?;

    let column_width_sub = SubmenuBuilder::new(app, "Column Width")
        .item(&MenuItemBuilder::with_id("fmt-col-width-250", "250px").build(app)?)
        .item(&MenuItemBuilder::with_id("fmt-col-width-350", "350px").build(app)?)
        .item(&MenuItemBuilder::with_id("fmt-col-width-450", "450px").build(app)?)
        .item(&MenuItemBuilder::with_id("fmt-col-width-550", "550px").build(app)?)
        .item(&MenuItemBuilder::with_id("fmt-col-width-650", "650px").build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("fmt-col-width-third", "1/3 Screen").build(app)?)
        .item(&MenuItemBuilder::with_id("fmt-col-width-half", "1/2 Screen").build(app)?)
        .item(&MenuItemBuilder::with_id("fmt-col-width-twothird", "2/3 Screen").build(app)?)
        .item(&MenuItemBuilder::with_id("fmt-col-width-full", "Full Width").build(app)?)
        .build()?;

    let card_height_sub = SubmenuBuilder::new(app, "Card Height")
        .item(&MenuItemBuilder::with_id("fmt-card-height-auto", "Auto").build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("fmt-card-height-200", "Small").build(app)?)
        .item(&MenuItemBuilder::with_id("fmt-card-height-400", "Medium").build(app)?)
        .item(&MenuItemBuilder::with_id("fmt-card-height-600", "Large").build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("fmt-card-height-third", "1/3 Screen").build(app)?)
        .item(&MenuItemBuilder::with_id("fmt-card-height-half", "1/2 Screen").build(app)?)
        .item(&MenuItemBuilder::with_id("fmt-card-height-twothird", "2/3 Screen").build(app)?)
        .item(&MenuItemBuilder::with_id("fmt-card-height-fullscreen", "Full Screen").build(app)?)
        .build()?;

    let whitespace_sub = SubmenuBuilder::new(app, "Whitespace")
        .item(&MenuItemBuilder::with_id("fmt-whitespace-compact", "Compact").build(app)?)
        .item(&MenuItemBuilder::with_id("fmt-whitespace-default", "Default").build(app)?)
        .item(&MenuItemBuilder::with_id("fmt-whitespace-spacious", "Spacious").build(app)?)
        .build()?;

    let font_size_sub = SubmenuBuilder::new(app, "Font Size")
        .item(&MenuItemBuilder::with_id("fmt-font-size-05x", "0.5x").build(app)?)
        .item(&MenuItemBuilder::with_id("fmt-font-size-075x", "0.75x").build(app)?)
        .item(&MenuItemBuilder::with_id("fmt-font-size-1x", "1x").build(app)?)
        .item(&MenuItemBuilder::with_id("fmt-font-size-125x", "1.25x").build(app)?)
        .item(&MenuItemBuilder::with_id("fmt-font-size-15x", "1.5x").build(app)?)
        .item(&MenuItemBuilder::with_id("fmt-font-size-2x", "2x").build(app)?)
        .build()?;

    let font_family_sub = SubmenuBuilder::new(app, "Font Family")
        .item(&MenuItemBuilder::with_id("fmt-font-system", "System Default").build(app)?)
        .item(&MenuItemBuilder::with_id("fmt-font-roboto", "Roboto").build(app)?)
        .item(&MenuItemBuilder::with_id("fmt-font-opensans", "Open Sans").build(app)?)
        .item(&MenuItemBuilder::with_id("fmt-font-lato", "Lato").build(app)?)
        .item(&MenuItemBuilder::with_id("fmt-font-inter", "Inter").build(app)?)
        .item(&MenuItemBuilder::with_id("fmt-font-poppins", "Poppins").build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("fmt-font-helvetica", "Helvetica").build(app)?)
        .item(&MenuItemBuilder::with_id("fmt-font-arial", "Arial").build(app)?)
        .item(&MenuItemBuilder::with_id("fmt-font-georgia", "Georgia").build(app)?)
        .item(&MenuItemBuilder::with_id("fmt-font-times", "Times New Roman").build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("fmt-font-firacode", "Fira Code").build(app)?)
        .item(&MenuItemBuilder::with_id("fmt-font-jetbrains", "JetBrains Mono").build(app)?)
        .item(&MenuItemBuilder::with_id("fmt-font-sourcecodepro", "Source Code Pro").build(app)?)
        .item(&MenuItemBuilder::with_id("fmt-font-consolas", "Consolas").build(app)?)
        .build()?;

    let row_height_sub = SubmenuBuilder::new(app, "Row Height")
        .item(&MenuItemBuilder::with_id("fmt-row-height-auto", "Auto").build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("fmt-row-height-300", "Small").build(app)?)
        .item(&MenuItemBuilder::with_id("fmt-row-height-500", "Medium").build(app)?)
        .item(&MenuItemBuilder::with_id("fmt-row-height-700", "Large").build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("fmt-row-height-third", "1/3 Screen").build(app)?)
        .item(&MenuItemBuilder::with_id("fmt-row-height-half", "1/2 Screen").build(app)?)
        .item(&MenuItemBuilder::with_id("fmt-row-height-twothird", "2/3 Screen").build(app)?)
        .item(&MenuItemBuilder::with_id("fmt-row-height-fullscreen", "Full Screen").build(app)?)
        .build()?;

    let board_layout_sub = SubmenuBuilder::new(app, "Board Layout")
        .item(&MenuItemBuilder::with_id("fmt-layout-kanban", "Kanban").build(app)?)
        .item(&MenuItemBuilder::with_id("fmt-layout-canvas", "Canvas").build(app)?)
        .build()?;

    let layout_preset_sub = SubmenuBuilder::new(app, "Layout Preset")
        .item(&MenuItemBuilder::with_id("fmt-preset-normal", "Normal").build(app)?)
        .item(&MenuItemBuilder::with_id("fmt-preset-spacious", "Spacious").build(app)?)
        .build()?;

    let format_menu = SubmenuBuilder::new(app, "Format")
        .item(&visual_style_sub)
        .item(&tag_style_sub)
        .separator()
        .item(&column_width_sub)
        .item(&card_height_sub)
        .item(&whitespace_sub)
        .separator()
        .item(&font_size_sub)
        .item(&font_family_sub)
        .separator()
        .item(&board_layout_sub)
        .separator()
        .item(&row_height_sub)
        .item(&layout_preset_sub)
        .build()?;

    // ── Go menu ──
    let go_menu = SubmenuBuilder::new(app, "Go")
        .item(&MenuItemBuilder::with_id("go-recent-boards", "Recent Boards…").build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("go-next-card", "Next Card").build(app)?)
        .item(&MenuItemBuilder::with_id("go-prev-card", "Previous Card").build(app)?)
        .item(&MenuItemBuilder::with_id("go-next-column", "Next Column").build(app)?)
        .item(&MenuItemBuilder::with_id("go-prev-column", "Previous Column").build(app)?)
        .build()?;

    // ── Board menu ──
    let sort_sub = SubmenuBuilder::new(app, "Sort All Cards")
        .item(&MenuItemBuilder::with_id("board-sort-title", "By Title").build(app)?)
        .item(&MenuItemBuilder::with_id("board-sort-tag", "By Tag Value").build(app)?)
        .item(&MenuItemBuilder::with_id("board-sort-due", "By Due Date").build(app)?)
        .build()?;

    let board_menu = SubmenuBuilder::new(app, "Board")
        .item(&MenuItemBuilder::with_id("board-new-row", "New Row").build(app)?)
        .item(&MenuItemBuilder::with_id("board-new-stack", "New Stack").build(app)?)
        .item(&MenuItemBuilder::with_id("board-new-column", "New Column").build(app)?)
        .item(&MenuItemBuilder::with_id("board-new-card", "New Card").build(app)?)
        .separator()
        .item(&sort_sub)
        .separator()
        .item(&MenuItemBuilder::with_id("board-show-parked", "Show Parked Items").build(app)?)
        .item(&MenuItemBuilder::with_id("board-show-archived", "Show Archived Items").build(app)?)
        .item(&MenuItemBuilder::with_id("board-show-trash", "Show Trash").build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("board-statistics", "Board Statistics").build(app)?)
        .item(&MenuItemBuilder::with_id("board-processes", "Running Processes").build(app)?)
        .build()?;

    // ── Help menu ──
    let help_menu = SubmenuBuilder::new(app, "Help")
        .item(&MenuItemBuilder::with_id("help-keyboard-shortcuts", "Keyboard Shortcuts…").accelerator("Shift+?").build(app)?)
        .build()?;

    // ── Assemble ──
    let menu = MenuBuilder::new(app)
        .item(&app_menu)
        .item(&file_menu)
        .item(&edit_menu)
        .item(&view_menu)
        .item(&format_menu)
        .item(&go_menu)
        .item(&board_menu)
        .item(&help_menu)
        .build()?;

    Ok(menu)
}

/// Update the checked state of a CheckMenuItem by its ID.
pub fn set_check_menu_state(app: &tauri::AppHandle, id: &str, checked: bool) {
    if let Some(menu) = app.menu() {
        if let Some(item) = menu.get(id) {
            if let Some(check_item) = item.as_check_menuitem() {
                let _ = check_item.set_checked(checked);
            }
        }
    }
}

/// Menu ID → frontend action string mapping table.
/// Each entry is (menu_id, action_string). Add new entries here to wire native menu items.
const MENU_ACTION_MAP: &[(&str, &str)] = &[
    // App
    ("app-quit", "quit-app"),
    // File
    ("file-new-window", "new-window"),
    // file-open-workspace::<id> entries are handled dynamically in
    // menu_id_to_action — they map to `open-workspace:<id>` actions.
    ("file-save", "save-now"),
    ("file-rename", "rename-file"),
    ("file-reveal", "open-folder"),
    ("file-export", "file-open-export-settings"),
    ("file-copy-markdown", "copy-board-markdown"),
    ("file-board-settings", "file-open-board-settings"),
    ("file-backend-settings", "backend-settings"),
    // Edit
    ("edit-undo", "undo"),
    ("edit-redo", "redo"),
    ("edit-find", "open-search"),
    ("edit-find-replace", "open-search-replace"),
    ("edit-paste-as-card", "paste-as-card"),
    ("edit-smart-paste", "smart-paste"),
    // View – panels
    ("view-panel-hierarchy", "reveal-panel:hierarchy"),
    ("view-panel-dashboard", "reveal-panel:dashboard"),
    ("view-panel-logs", "reveal-panel:logs"),
    ("view-panel-backend-settings", "reveal-panel:backendSettings"),
    ("view-panel-frontend-settings", "reveal-panel:frontendSettings"),
    ("view-panel-render-apps", "reveal-panel:renderApps"),
    ("view-panel-frontend-tests", "reveal-panel:frontendTests"),
    ("view-panel-week-calendar", "reveal-panel:weekCalendar"),
    ("view-panel-month-calendar", "reveal-panel:monthCalendar"),
    ("view-panel-files", "reveal-panel:files"),
    // View – fold
    ("view-fold-cards", "toggle-fold-cards"),
    ("view-fold-columns", "toggle-fold-columns"),
    // View – pin headers
    ("view-pin-headers-off", "set-sticky-headers:"),
    ("view-pin-headers-top", "set-sticky-headers:top"),
    ("view-pin-headers-bottom", "set-sticky-headers:bottom"),
    // View – split
    ("view-split-single", "split-disable"),
    ("view-split-vertical", "split-enable-vertical"),
    ("view-split-horizontal", "split-enable-horizontal"),
    // View – tag visibility
    ("view-tags-all", "set-tag-visibility:all"),
    ("view-tags-no-layout", "set-tag-visibility:allexcludinglayout"),
    ("view-tags-custom", "set-tag-visibility:custom"),
    ("view-tags-mentions", "set-tag-visibility:mentions"),
    ("view-tags-dim", "set-tag-visibility:dim"),
    ("view-tags-hide", "set-tag-visibility:none"),
    // View – HTML rendering
    ("view-html-comments-render", "set-html-comments:html"),
    ("view-html-comments-text", "set-html-comments:text"),
    ("view-html-comments-dim", "set-html-comments:dim"),
    ("view-html-content-render", "set-html-content:html"),
    ("view-html-content-text", "set-html-content:text"),
    // View – toggles
    ("view-special-chars", "toggle-special-chars"),
    ("view-overlay-editor", "toggle-overlay-editor"),
    // View – zoom
    ("view-zoom-in", "zoom-in"),
    ("view-zoom-out", "zoom-out"),
    ("view-zoom-reset", "zoom-reset"),
    // View – inspector
    ("view-inspector", "toggle-inspector"),
    ("view-inspector-all", "open-all-inspectors"),
    // Format – visual style
    ("fmt-theme-classic", "set-board-theme:classic"),
    ("fmt-theme-sleek-uniform", "set-board-theme:sleek-uniform"),
    // Format – tag style
    ("fmt-tag-style-default", "set-tag-style-preset:default"),
    ("fmt-tag-style-minimal", "set-tag-style-preset:minimal"),
    ("fmt-tag-style-full", "set-tag-style-preset:full"),
    ("fmt-tag-style-badges", "set-tag-style-preset:badges"),
    // Format – column width
    ("fmt-col-width-250", "set-column-width:250px"),
    ("fmt-col-width-350", "set-column-width:350px"),
    ("fmt-col-width-450", "set-column-width:450px"),
    ("fmt-col-width-550", "set-column-width:550px"),
    ("fmt-col-width-650", "set-column-width:650px"),
    ("fmt-col-width-third", "set-column-width:31.5vw"),
    ("fmt-col-width-half", "set-column-width:48vw"),
    ("fmt-col-width-twothird", "set-column-width:63vw"),
    ("fmt-col-width-full", "set-column-width:95vw"),
    // Format – card height
    ("fmt-card-height-auto", "set-card-height:auto"),
    ("fmt-card-height-200", "set-card-height:200px"),
    ("fmt-card-height-400", "set-card-height:400px"),
    ("fmt-card-height-600", "set-card-height:600px"),
    ("fmt-card-height-third", "set-card-height:26.5vh"),
    ("fmt-card-height-half", "set-card-height:43.5vh"),
    ("fmt-card-height-twothird", "set-card-height:59vh"),
    ("fmt-card-height-fullscreen", "set-card-height:92vh"),
    // Format – whitespace
    ("fmt-whitespace-compact", "set-whitespace:8px"),
    ("fmt-whitespace-default", "set-whitespace:16px"),
    ("fmt-whitespace-spacious", "set-whitespace:32px"),
    // Format – font size
    ("fmt-font-size-05x", "set-font-size:6.5px"),
    ("fmt-font-size-075x", "set-font-size:9.75px"),
    ("fmt-font-size-1x", "set-font-size:13px"),
    ("fmt-font-size-125x", "set-font-size:16.25px"),
    ("fmt-font-size-15x", "set-font-size:19.5px"),
    ("fmt-font-size-2x", "set-font-size:26px"),
    // Format – font family
    ("fmt-font-system", "set-font-family:system"),
    ("fmt-font-roboto", "set-font-family:roboto"),
    ("fmt-font-opensans", "set-font-family:opensans"),
    ("fmt-font-lato", "set-font-family:lato"),
    ("fmt-font-inter", "set-font-family:inter"),
    ("fmt-font-poppins", "set-font-family:poppins"),
    ("fmt-font-helvetica", "set-font-family:helvetica"),
    ("fmt-font-arial", "set-font-family:arial"),
    ("fmt-font-georgia", "set-font-family:georgia"),
    ("fmt-font-times", "set-font-family:times"),
    ("fmt-font-firacode", "set-font-family:firacode"),
    ("fmt-font-jetbrains", "set-font-family:jetbrains"),
    ("fmt-font-sourcecodepro", "set-font-family:sourcecodepro"),
    ("fmt-font-consolas", "set-font-family:consolas"),
    // Format – layout rows
    // Format – row height
    ("fmt-row-height-auto", "set-row-height:auto"),
    ("fmt-row-height-300", "set-row-height:300px"),
    ("fmt-row-height-500", "set-row-height:500px"),
    ("fmt-row-height-700", "set-row-height:700px"),
    ("fmt-row-height-third", "set-row-height:31.5vh"),
    ("fmt-row-height-half", "set-row-height:48vh"),
    ("fmt-row-height-twothird", "set-row-height:63vh"),
    ("fmt-row-height-fullscreen", "set-row-height:95vh"),
    // Format – board layout
    ("fmt-layout-kanban", "set-board-layout:kanban"),
    ("fmt-layout-canvas", "set-board-layout:canvas"),
    // Format – layout preset
    ("fmt-preset-normal", "set-layout-preset:normal"),
    ("fmt-preset-spacious", "set-layout-preset:spacious"),
    // Go
    ("go-recent-boards", "show-recent-boards"),
    ("go-next-card", "focus-next-card"),
    ("go-prev-card", "focus-prev-card"),
    ("go-next-column", "focus-next-column"),
    ("go-prev-column", "focus-prev-column"),
    // Board
    ("board-new-row", "add-row"),
    ("board-new-stack", "add-stack"),
    ("board-new-column", "add-column"),
    ("board-new-card", "add-card"),
    ("board-sort-title", "sort-all-cards:title"),
    ("board-sort-tag", "sort-all-cards:tag"),
    ("board-sort-due", "sort-all-cards:duedate"),
    ("board-show-parked", "show-parked"),
    ("board-show-archived", "show-archived"),
    ("board-show-trash", "show-trash"),
    ("board-statistics", "toggle-board-stats"),
    ("board-processes", "show-processes"),
    // Help
    ("help-keyboard-shortcuts", "show-keyboard-shortcuts"),
];

/// Look up the frontend action string for a native menu item ID.
///
/// Static menu items resolve through `MENU_ACTION_MAP`. Dynamic items
/// generated by `set_workspaces_submenu` (one per workspace) carry the
/// `OPEN_WORKSPACE_ITEM_PREFIX` and resolve to the per-workspace
/// `open-workspace:<id>` action that the frontend ActionRegistry
/// dispatches to `LexeraWorkspaceShell.openWorkspaceWindow(id)`.
pub fn menu_id_to_action(id: &str) -> Option<String> {
    if let Some(workspace_id) = id.strip_prefix(OPEN_WORKSPACE_ITEM_PREFIX) {
        if workspace_id == "__none__" { return None; }
        return Some(format!("open-workspace:{}", workspace_id));
    }
    MENU_ACTION_MAP.iter()
        .find(|(menu_id, _)| *menu_id == id)
        .map(|(_, action)| (*action).to_string())
}
