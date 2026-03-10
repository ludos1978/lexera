use tauri::menu::{CheckMenuItemBuilder, MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::App;

pub fn create_app_menu(app: &App) -> Result<tauri::menu::Menu<tauri::Wry>, Box<dyn std::error::Error>> {
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
        .item(&PredefinedMenuItem::quit(app, Some("Quit Lexera Kanban"))?)
        .build()?;

    // ── File menu ──
    let file_menu = SubmenuBuilder::new(app, "File")
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

    let view_menu = SubmenuBuilder::new(app, "View")
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
        .item(&CheckMenuItemBuilder::with_id("view-marp-settings", "Show Marp Settings").build(app)?)
        .item(&CheckMenuItemBuilder::with_id("view-overlay-editor", "Overlay Editor").build(app)?)
        .item(&CheckMenuItemBuilder::with_id("view-wysiwyg-editor", "WYSIWYG Editor").build(app)?)
        .separator()
        .item(&zoom_sub)
        .separator()
        .item(&MenuItemBuilder::with_id("view-inspector", "Developer Tools").accelerator("F12").build(app)?)
        .build()?;

    // ── Format menu ──
    let visual_style_sub = SubmenuBuilder::new(app, "Visual Style")
        .item(&MenuItemBuilder::with_id("fmt-theme-bordered", "Bordered").build(app)?)
        .item(&MenuItemBuilder::with_id("fmt-theme-gap-highlight", "Gap Highlight").build(app)?)
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

    let layout_rows_sub = SubmenuBuilder::new(app, "Layout Rows")
        .item(&MenuItemBuilder::with_id("fmt-rows-1", "1 Row").build(app)?)
        .item(&MenuItemBuilder::with_id("fmt-rows-2", "2 Rows").build(app)?)
        .item(&MenuItemBuilder::with_id("fmt-rows-3", "3 Rows").build(app)?)
        .item(&MenuItemBuilder::with_id("fmt-rows-4", "4 Rows").build(app)?)
        .item(&MenuItemBuilder::with_id("fmt-rows-5", "5 Rows").build(app)?)
        .item(&MenuItemBuilder::with_id("fmt-rows-6", "6 Rows").build(app)?)
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
        .item(&layout_rows_sub)
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

/// Map native menu item IDs to frontend action strings for handleBoardAction().
pub fn menu_id_to_action(id: &str) -> Option<&'static str> {
    match id {
        // File
        "file-save" => Some("save-now"),
        "file-rename" => Some("rename-file"),
        "file-reveal" => Some("open-folder"),
        "file-export" => Some("file-open-export-settings"),
        "file-copy-markdown" => Some("copy-board-markdown"),
        "file-board-settings" => Some("file-open-board-settings"),
        "file-backend-settings" => Some("backend-settings"),
        // Edit
        "edit-undo" => Some("undo"),
        "edit-redo" => Some("redo"),
        "edit-find" => Some("open-search"),
        "edit-find-replace" => Some("open-search-replace"),
        "edit-paste-as-card" => Some("paste-as-card"),
        // View – fold
        "view-fold-cards" => Some("toggle-fold-cards"),
        "view-fold-columns" => Some("toggle-fold-columns"),
        // View – pin headers
        "view-pin-headers-off" => Some("set-sticky-headers:"),
        "view-pin-headers-top" => Some("set-sticky-headers:top"),
        "view-pin-headers-bottom" => Some("set-sticky-headers:bottom"),
        // View – split
        "view-split-single" => Some("split-disable"),
        "view-split-vertical" => Some("split-enable-vertical"),
        "view-split-horizontal" => Some("split-enable-horizontal"),
        // View – tag visibility
        "view-tags-all" => Some("set-tag-visibility:all"),
        "view-tags-no-layout" => Some("set-tag-visibility:allexcludinglayout"),
        "view-tags-custom" => Some("set-tag-visibility:custom"),
        "view-tags-mentions" => Some("set-tag-visibility:mentions"),
        "view-tags-dim" => Some("set-tag-visibility:dim"),
        "view-tags-hide" => Some("set-tag-visibility:none"),
        // View – HTML rendering
        "view-html-comments-render" => Some("set-html-comments:html"),
        "view-html-comments-text" => Some("set-html-comments:text"),
        "view-html-comments-dim" => Some("set-html-comments:dim"),
        "view-html-content-render" => Some("set-html-content:html"),
        "view-html-content-text" => Some("set-html-content:text"),
        // View – toggles
        "view-special-chars" => Some("toggle-special-chars"),
        "view-marp-settings" => Some("toggle-marp-settings"),
        "view-overlay-editor" => Some("toggle-overlay-editor"),
        "view-wysiwyg-editor" => Some("toggle-wysiwyg-editor"),
        // View – zoom
        "view-zoom-in" => Some("zoom-in"),
        "view-zoom-out" => Some("zoom-out"),
        "view-zoom-reset" => Some("zoom-reset"),
        // View – inspector
        "view-inspector" => Some("toggle-inspector"),
        // Format – visual style
        "fmt-theme-bordered" => Some("set-board-theme:bordered"),
        "fmt-theme-gap-highlight" => Some("set-board-theme:gap-highlight"),
        // Format – tag style
        "fmt-tag-style-default" => Some("set-tag-style-preset:default"),
        "fmt-tag-style-minimal" => Some("set-tag-style-preset:minimal"),
        "fmt-tag-style-full" => Some("set-tag-style-preset:full"),
        "fmt-tag-style-badges" => Some("set-tag-style-preset:badges"),
        // Format – column width
        "fmt-col-width-250" => Some("set-column-width:250px"),
        "fmt-col-width-350" => Some("set-column-width:350px"),
        "fmt-col-width-450" => Some("set-column-width:450px"),
        "fmt-col-width-550" => Some("set-column-width:550px"),
        "fmt-col-width-650" => Some("set-column-width:650px"),
        "fmt-col-width-third" => Some("set-column-width:31.5vw"),
        "fmt-col-width-half" => Some("set-column-width:48vw"),
        "fmt-col-width-twothird" => Some("set-column-width:63vw"),
        "fmt-col-width-full" => Some("set-column-width:95vw"),
        // Format – card height
        "fmt-card-height-auto" => Some("set-card-height:auto"),
        "fmt-card-height-200" => Some("set-card-height:200px"),
        "fmt-card-height-400" => Some("set-card-height:400px"),
        "fmt-card-height-600" => Some("set-card-height:600px"),
        "fmt-card-height-third" => Some("set-card-height:26.5vh"),
        "fmt-card-height-half" => Some("set-card-height:43.5vh"),
        "fmt-card-height-twothird" => Some("set-card-height:59vh"),
        "fmt-card-height-fullscreen" => Some("set-card-height:92vh"),
        // Format – whitespace
        "fmt-whitespace-compact" => Some("set-whitespace:8px"),
        "fmt-whitespace-default" => Some("set-whitespace:16px"),
        "fmt-whitespace-spacious" => Some("set-whitespace:32px"),
        // Format – font size
        "fmt-font-size-05x" => Some("set-font-size:6.5px"),
        "fmt-font-size-075x" => Some("set-font-size:9.75px"),
        "fmt-font-size-1x" => Some("set-font-size:13px"),
        "fmt-font-size-125x" => Some("set-font-size:16.25px"),
        "fmt-font-size-15x" => Some("set-font-size:19.5px"),
        "fmt-font-size-2x" => Some("set-font-size:26px"),
        // Format – font family
        "fmt-font-system" => Some("set-font-family:system"),
        "fmt-font-roboto" => Some("set-font-family:roboto"),
        "fmt-font-opensans" => Some("set-font-family:opensans"),
        "fmt-font-lato" => Some("set-font-family:lato"),
        "fmt-font-inter" => Some("set-font-family:inter"),
        "fmt-font-poppins" => Some("set-font-family:poppins"),
        "fmt-font-helvetica" => Some("set-font-family:helvetica"),
        "fmt-font-arial" => Some("set-font-family:arial"),
        "fmt-font-georgia" => Some("set-font-family:georgia"),
        "fmt-font-times" => Some("set-font-family:times"),
        "fmt-font-firacode" => Some("set-font-family:firacode"),
        "fmt-font-jetbrains" => Some("set-font-family:jetbrains"),
        "fmt-font-sourcecodepro" => Some("set-font-family:sourcecodepro"),
        "fmt-font-consolas" => Some("set-font-family:consolas"),
        // Format – layout rows
        "fmt-rows-1" => Some("set-layout-rows:1"),
        "fmt-rows-2" => Some("set-layout-rows:2"),
        "fmt-rows-3" => Some("set-layout-rows:3"),
        "fmt-rows-4" => Some("set-layout-rows:4"),
        "fmt-rows-5" => Some("set-layout-rows:5"),
        "fmt-rows-6" => Some("set-layout-rows:6"),
        // Format – row height
        "fmt-row-height-auto" => Some("set-row-height:auto"),
        "fmt-row-height-300" => Some("set-row-height:300px"),
        "fmt-row-height-500" => Some("set-row-height:500px"),
        "fmt-row-height-700" => Some("set-row-height:700px"),
        "fmt-row-height-third" => Some("set-row-height:31.5vh"),
        "fmt-row-height-half" => Some("set-row-height:48vh"),
        "fmt-row-height-twothird" => Some("set-row-height:63vh"),
        "fmt-row-height-fullscreen" => Some("set-row-height:95vh"),
        // Format – layout preset
        "fmt-preset-normal" => Some("set-layout-preset:normal"),
        "fmt-preset-spacious" => Some("set-layout-preset:spacious"),
        // Go
        "go-recent-boards" => Some("show-recent-boards"),
        "go-next-card" => Some("focus-next-card"),
        "go-prev-card" => Some("focus-prev-card"),
        "go-next-column" => Some("focus-next-column"),
        "go-prev-column" => Some("focus-prev-column"),
        // Board
        "board-new-row" => Some("add-row"),
        "board-new-stack" => Some("add-stack"),
        "board-new-column" => Some("add-column"),
        "board-new-card" => Some("add-card"),
        "board-sort-title" => Some("sort-all-cards:title"),
        "board-sort-tag" => Some("sort-all-cards:tag"),
        "board-sort-due" => Some("sort-all-cards:duedate"),
        "board-show-parked" => Some("show-parked"),
        "board-show-archived" => Some("show-archived"),
        "board-show-trash" => Some("show-trash"),
        "board-statistics" => Some("toggle-board-stats"),
        "board-processes" => Some("show-processes"),
        // Help
        "help-keyboard-shortcuts" => Some("show-keyboard-shortcuts"),
        _ => None,
    }
}
