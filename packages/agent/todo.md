# Lexera Kanban V1 Parity Todo

## Open

- [ ] we need shortcuts to be defineable. for example meta+1 should do \n\n---:\n\n where the cursor is placed. i'd like a system as vscode has it, which is configurable.

- ~~the options what shows in the hierarchy should be in a burger menu on the top right of the hierarchy display. move the lock and the fold icons there as well!~~ (done: a7b9fe40)

- [x] if i alt click on a fold icon in the hierarchy, it should fold all children, but not the item itself (the same as in the view)! (done: ea066a8d)

- ~~when i disable elements that show in the sidebar (cound, users, darg icon) it should free up space for the titles!~~ (done: d898ec74)

- [ ] we want an open canvas board styling option. there is a ordered and a canvas board structure. for the canvas board option we add these functions:
  - Context — we are extending a VS Code extension that renders markdown files as Kanban boards. Currently the layout is flat: rows contain columns contain cards. We are adding a parameter system so users can define spatial layouts using {key:value} syntax in markdown headings. The hierarchy is: # rows → ## stacks (positioned containers) → ### columns (sequential lists) → * [ ] cards. Stacks can be freely positioned within a row, columns flow sequentially inside stacks, cards flow sequentially inside columns.
  - Add parameter parser — write a function that extracts {key:value, key:value} blocks from markdown heading lines and card lines. Return parsed key-value pairs as a typed object. Strip the param block from display text. Handle missing, empty, and malformed params gracefully.
  - Integrate params into data model — extend the existing markdown parser so stacks, columns, and cards carry their parsed params. Define typed interfaces: stacks get x, y, w, h, dir, columns get w (weight), cards get span. All params are optional with sensible defaults so existing files without params render unchanged.
  - Render the layout — use stack params to position stacks within their row (CSS grid or similar). Use column weight to size columns within a stack. Use card span to let cards occupy multiple units. Stacks without params fall back to current sequential flow.
  - Preserve params on edit — ensure drag-and-drop, inline editing, and reordering preserve {params} blocks correctly in the markdown source.
  - Write tests — cover param parsing, default fallbacks, layout rendering, and round-trip preservation through edits.

- [ ] i want the top menu bar have the following structure
  left aligned
  - filename
  - file header settings (marp, pandoc, etc settings that are file specific in one or multiple burger menus.)

  middle aligned:
  - empty card, column, stack, rows to drag into the board
  - template card, column, stack, rows to drag into the board
  - card, columns stacks, rows generated from clipboard content
  - predefined templates for cards, for example draw.io files, excalidraw files, other file formats that we coud later directly embed to edit
  - a separator
  - individual dropdowns for incoming, park, archive, trash

  right side aligned:
  - fold all cards, fold all columns
  - pin column headers (when they are outside the view they are stick to header footer of the view)
  - runnign processes
  - save system and change tracking
  - templates selection (maybe zoom)
  - export / pack
  - burger menu for extended settings
    - overlay editor enabled
    - wysiwyg edtior enabled
    - show special characters
    - show marp settings
    - html comment rendering
    - html content rendering 
    - tag visibility

- [ ] smaller problems
  - ~~the management window must have sharing as the first tab, and configuration as second!~~ (already done)
  - ~~it should open the small folded window! not the large one! but the folded app doesnt appear until i copy something!~~ (fixed: ea6215e0 — trust initial HTML strip-mode class instead of querying window.innerWidth on startup)
  - ~~the system beeps when i press escape while having the board open. why?~~ (fixed: 8abf6ee8)
  - ~~when i click outside the quick capture window it should get small immediately~~ (already done: Focused(false) handler)
  - ~~the quick capture should have written a short form of the clipbaord text in it when folded as well. vertical text!~~ (already done: strip-clip-label with writing-mode: vertical-rl and renderClipboardSummary() populates it; was invisible until L44 fix)
  - ~~also when searching the user should be able to go into elements, if the search finds a board, the user should be able to move into it's stacks/colums/cards~~ (already done: unfoldSearchTarget + focusSearchResultCard navigates through hierarchy)
  - fix the structure how we define workspaces. we can create workspaces, kanban boards can be part of one or many workspaces!
    - the lexera kanban view can have one or multiple windows open
    - find a solution for the management interface to solve this.
  - ~~it might be that the background of the application is not transparent? because on the right side the rounded border shows the background, but on the left side it shows some white parts~~ (fixed: 4c065526 — added transparent: true to tauri.conf.json)

- [x] make the management interface being shared between the backend and the frontend kanban (collaboration)

- [x] make the board zoomable by scrolling. (already done: Cmd/Ctrl+Scroll zoom via nudgeUiScale)

- [ ] the clipboard should only show the current level within the search and not a hierarchical display. it lists the items and if i press left it goes higher, right it goes into the objects. it should show immediately if a new item is added by cmd+v

- [ ] the clipboard should only be a vertical line with the title of the last copy-paste value. can we somehow detect/hide passwords? it should fold similar to the columns. when unfolded it displays the same way we have right now. the user can define a default workspace which is used as board search area, if he presses left it switches to workspace selection. we must have a hierarchy stored "workspaces > kanban boards" (with the subitems > rows > stacks > columns > cards shown when going right with the cursor). the backend must store the workspaces and boards, the frontend and the clipboard accesses these settings and uses the backend to navigate the contents of the boards. 

- [ ] make sure the clipboard and the backend also use light / dark styles. templates that should be applied to all parts of the application. for that the backend should have a separate "configuration" which doesnt do regular maintenence and sharing aspects. the server bind address and port, as well as the identity should be there as well as the theme selection. theme should be shared among front and backend. the settings should be stored.

in the sharing settings workspaces are defined, workspaces can contain one or more boards. boards can be defined and invitations as well as connecting to peers and joining, fix the details in the invitations, there are options that dont work. invitations should work for full workspaces, or individual boards!

- [ ] we hide the clipboard history for now, we might use it later, but currently it's disabled. we show the current clipboard entry, for example if an image has been copyied (binary) we decode and show it. or if it's a link we try to open the page, whatever document it is we try to generate a preview. this is shown at the top with the cursor in the search field below. by searching we search within the activated workspaces & boards. by default downward clicks show the boards or workspaces. right clicking opens each element until we see the cards.
if the clipboard is pasted:
- into a board : its placed in the incomding (same as park)
- into a row, stack, column : it's placed at the end as a card, if needed stack or columns are created to accomodate the card.
- into a card : its appended to the cards content.

- [x] integrate this https://sidemark.org/guide/examples.html or https://github.com/TheGesturalist/gest-critic-markup-kit (i actually prefer critic-markdown) (done: ea6215e0 — CriticMarkup inline rendering: {++add++}, {--del--}, {~~sub~>new~~}, {>>comment<<}, {==highlight==})

- [x] add a theme that allows setting these style settings:
  - the stack title and frame only is a line of text, as if it's on the top of the row. content below should not be indented. If it's empty we show an empty line. we show a 2 pixel dashed line below it and no other styling, except if it's defined by tags that style content.
  - stacks are separated by a vertical line of 1px solid it's at least the height of the view.
  - the columns are separated by a 2 pixel solid line.
  - the cards are separated by a 1 pixel solid line.
  - rows are sre separated by a horizontal line of 3px solid, it's at least the width of the view.
  what values do we need to make configurable for this to work.
  (done: ad8387eb — 'Lines' visual theme with line separators, no boxes)

- [x] restore the layout settings from the old version. there should be a default value settable for the stack width (which changes columns and cards as well.) but an value that can be asssigned to the stack directly to override it. we could use #width{integer} to define it using a tag. The rows could also use a similar setting where it defines a max-height for example using #height{integer}. (done: ad8387eb — #width{N} on stacks overrides column width, #height{N} on rows overrides row height, values in px)

- [ ] in the packages/lexera folders work on feature parity with the code in the src folder. there is some difference as we added row, stack structures in lexera. also the splitting of features are different and a backend data realtime syncing. but for the user perspective the features must be equal.  there is a lot of features that are missing or not functioning well. do an state analysis first

- [ ] the backend needs a small interface that allows adding and removing kanban boards from/to it and of course list the ones that are currently included. it must show if users are working on them and if this machine is autoritative for the board (maybe other network relevant informations). it must communicate with the frontend when it changes this. 

- [ ] i want to be able to setup multiple workspaces. 
  - each workspace has specific boards open
  - it can have specific layouts
  - it can have a specific theme
  - maybe more...

- [ ] the file format should be changed to \                                                                
  ---\                                                                                                  
  yaml-header\                                                                                          
  ---\                                                                                                  
  # row name\                                                                                           
  ## stack name\                                                                                        
  ### column name\                                                                                      
  - [ ] card name\                                                                                      
    ...\                                                                                                
  - [ ] ...\                                                                                            
  \                                                                                                     
  all of the elements should be moveable and foldable individuall. so a row can be folded, a stack can  
  be folded and columns as well and cards. they can be dragged around and placed as needed. we will     
  think about layout options for the groups later. currently rows are horizontally listed items,        
  stacks are vertically listed items, column contain verticall listed items (the cards).

- [ ] file watcher, but we need a strong change handling from eigther user changes and file system (data storage backend) changes. plan with a multi-user system in mind and a system that is save to never loose any data. it uses the known system of main file, included file we have in the version 1 syste

- [ ] I want a web clipper similar to markdowner / Marksnip or obsidian webclipper to archive links, websites, images etc. directly into a kanban board. For that we define an Inbox. I would like it to be a separate application that can be used as drop source. But it would also be good if it could access the browser data (if the ushttps://www.heise.de/news/Klage-wegen-Social-Media-Sucht-Mark-Zuckerberg-wollte-mit-Apple-kooperieren-11185998.htmler is logged in somewhere or we cant access the data from playwright). What system would you suggest? I am planning on adding other sources that could be used to integrate into the system directly. Ideas that pop up are RSS, EMail, Filesystem. An mobile web clipper (something that can run on an ios and or android) would be best as well. It should sync using a kanban board that is shared using icloud or dropbox. the external tool could also be used to search the boards and display results we have within the kanban boards.

- [x] when searching allow to limit seaches for l: links


- [x] fix the font in the kanban workspace selection (font-family: inherit already present)
- [x] right clicking on board elements should allow adding row/stack/column/card which are appended after the current element. (insert-after/add-after actions already registered)
- [x] dragging an element (row/stack/column/card) from the view to the hierarchy should allow positioning it within a specific place! also dragging within the hiearchy and within the view must still work for all elements. (fixed: 55af9ab3 — board card drags now support precise between-card positioning in hierarchy; rows/stacks/columns already supported both directions)
- [x] when editing it should do the least possible changes versus non editing the same field. curently it seems to add a margin padding around the text which serves no functionality! (fixed: 3c68600b — removed 120px min-height, textarea now sizes to content, font-size inherits board setting)
- [x] the title of a row is not properly cut off. it overlaps the right burger menu. (overflow/ellipsis CSS already present)
- [x] the burger menu over an image is barely visible on hover. make it have a stronger contrast bg/fg (fixed: 15ed3d7e)
- [ ] Add workspace file/media search and indexing so users can search for files across the workspace when embedding images, documents, and media into cards, with format-aware results and batch selection.

### Native OS Menu Bar (done)
- [x] Add native OS menu bar with File, Edit, View, Go, Board, Help menus via Tauri `app_menu.rs`.
- [x] Wire all menu actions to frontend via `menu-action` event → `handleBoardAction()`.
- [x] Remove duplicate display settings from file header burger menu (now in native menus).
- [x] Fix file header menu slowness — don't block menu display on async backend refreshes.
- [x] Add Smart Paste (Shift+Cmd+V): detect clipboard content type (URL, image path, markdown, presentation slides) and paste with appropriate formatting.

### Alt+Click to Open Links and Embeds (done)
- [x] Add Alt+Click handler on rendered card content: Alt+clicking a link opens it in the system browser, Alt+clicking an image opens the file in the system app, Alt+clicking an embed opens the source file. Use the existing `openInSystem` Tauri command.

### Card Editor Improvements
- [x] Add drag-and-drop file support in the card overlay editor: dropping an image file into the editor textarea inserts a markdown image embed `![](relative-path)`, dropping other files inserts a file link. Resolve paths relative to the board file location. (resolveDropContent + uploadFileAndBuildMarkdown already implemented)
- [x] Add image paste support in the card editor: pasting an image from clipboard saves it to a media folder next to the board file and inserts the markdown image embed. (handleEditorPasteImage already implemented)

### Fold State Improvements (done)
- [x] Persist row and stack fold states across board reloads — save fold state for each element by ID in localStorage alongside the existing column/card fold state, and restore on board render.

### Layout Presets
- [x] Add named layout presets beyond Normal/Spacious — allow saving current board layout (column width, row height, spacing, font size, sticky mode) as a named preset, and loading/deleting saved presets from the Board menu or burger menu. (done: 3c68600b — save/load/delete custom presets via board context menu, stored in localStorage)

### Plugin Refactoring (app.js structural decomposition)

Specs: `packages/agent/specs/plugins/diagram/SPEC.md`, `plugins/enhancer/SPEC.md`, `ux/actions/SPEC.md`, `ux/menu-contributors/SPEC.md`, `ux/board-settings/SPEC.md`

#### Phase 1 — Standalone registries (no cross-dependencies) ✅
- [x] **Diagram Renderer Registry**: `diagramRegistry.js` — unified queue replacing hardcoded Mermaid/PlantUML.
- [x] **Content Enhancer Pipeline**: `contentEnhancerRegistry.js` — priority-sorted pipeline replacing hardcoded chain.
- [x] **Action Dispatch Registry**: `actionRegistry.js` — pattern-matched dispatch replacing 5 if/else chains.

#### Phase 2 — Registry consumers (depend on Phase 1) ✅
- [x] **Menu Contributor Registry**: `menuContributorRegistry.js` — 14 contributors replacing 4 inline menu builders. Unified `showElementContextMenu()`.
- [x] **Board Settings Descriptor Registry**: `boardSettingRegistry.js` — 16 descriptors replacing 15 build*ModeItems functions + auto-wired action handlers.

#### Phase 3 — Cross-boundary (Rust + JS) ✅
- [x] **Rust Menu Simplification**: Replaced 96-arm match in `app_menu.rs` with data-driven `MENU_ACTION_MAP` const array + lookup function.

### Board Visual Theme System
- [x] Extract all layout-relevant CSS into a theme variable layer: row/stack/column/card border (style, width, color, radius), background, box-shadow, gap sizes (row-gap, stack-gap, column-gap, card-gap), inner padding, and header separator styles.
- [x] Define a "bordered" theme preset (the current look) that maps to the existing variable values — serves as the default and reference.
- [x] Define a "gap-highlight" theme preset: removes borders and box-shadows from row/stack/column/card, increases gap sizes, applies a visible accent background color to the gap areas (board body, row content, stack content, column card-list), and uses flat/borderless element surfaces.
- [x] Add theme-aware header separator styling so row/stack/column headers can switch between border-bottom dividers (bordered theme) and subtle background tint differences (gap-highlight theme).
- [x] Add theme-aware card styling so cards can switch between bordered+shadow (current) and flat/elevated-on-gap (gap-highlight) appearances while keeping tag accent borders, highlight, and focus ring behavior unchanged.
- [x] Add theme-aware drag-drop feedback: drop zone indicators, drag-over highlights, and insertion markers must remain visible and clear in both themes.
- [x] Store active theme selection in localStorage and load it on startup, applying the matching CSS variable set to `:root`.
- [x] Add a "Board Theme" submenu to the board context menu with checkmark selection between available theme presets.
- [x] Verify print CSS, filter bar, stats bar, search-replace panel, and overlay dialogs render correctly under both themes.

## Done

- [x] Reworked the board header into left file controls, middle creation/incoming controls, and right board/runtime controls.
- [x] Moved removed top-row actions into the right burger menu and kept a single `Backend Settings` entry.
- [x] Made the header fold into the compact v1 icon mode based on actual overflow instead of only fixed breakpoints.
- [x] Switched quick capture to expose workspaces at the highest level instead of boards.
- [x] Merged draw.io and Excalidraw into the normal template flow and removed the duplicate template structure.
- [x] Kept `Incoming` clipboard-fed only instead of inventing a separate "new incoming card" flow.
- [x] Restored the main row, stack, column, and card context-menu actions.
- [x] Restored parked, archived, and trash dropdown handling and drag targets for hidden-item recovery.
- [x] Ported the richer tag-style layer for borders, header/footer styling, badges, and numeric tag visuals.
- [x] Expanded v2 tag categories and tag menus toward the broader v1 category set.
- [x] Added rendered-tag click menus for filtering, search, rename, recoloring, and copy.
- [x] Stopped treating Markdown heading markers as tags while still parsing real tags inside heading lines.
- [x] Verified template inserts prompt for variables and copy companion files.
- [x] Replaced the placeholder per-element Marp menu with real Marp Classes, Colors, and Header & Footer submenus.
- [x] Added local and scoped Marp class toggles for row, stack, column, and card menus.
- [x] Added local and scoped Marp directive editing for colors, backgrounds, header, footer, and paginate.
- [x] Preserved Marp HTML comments in source while stripping them from visible labels.
- [x] Added regression coverage for HTML-comment and Marp directive helpers.
- [x] Restored board-level Marp enable/disable, presentation frontmatter, metadata, slide-settings, and styling.
- [x] Restored file-header YAML preview/copy submenu.
- [x] Added regression coverage for board-level YAML frontmatter mutation helpers.
- [x] Restored file-header Pandoc status, quick actions, output-format and page-break mutators.
- [x] Restored export-dialog persistence for Pandoc, Marp, and exclude-tag settings.
- [x] Added regression coverage for export-dialog preference helpers.
- [x] Restored archive dropdown per-item and bulk export actions, archive-file generation, and append logic.
- [x] Extended archive export formatting to cover row/stack/column/card hierarchy.
- [x] Added regression coverage for archive helpers.
- [x] Restored Marp class discovery from workspace config and theme CSS files.
- [x] Restored file-header and element-level Marp class refresh and menus.
- [x] Verified dragged template sources route through the full template application flow.
- [x] Replaced top-bar popups with draggable source-item lists and backed Incoming with quick-capture history.
- [x] Restored card/column/stack drag/drop parity with auto-creation and cleanup of unnamed containers.
- [x] Restored drag/drop feedback and hidden item drag-out capture.
- [x] Kept inline card editing open when the app loses focus.
- [x] Restored export scope selection, scope combinations, entry-point parity, and backend subset handling.
- [x] Added regression coverage for export-tree scope selection and backend subset helpers.
- [x] Restored inline Escape cancel, export presets, reset-to-custom, exclude-tags, merge-includes, and auto-export-on-save.
- [x] Restored export embed-handling, Marp browser dropdown, and link-and-asset packing with suboptions.
- [x] Added frontend export link rewriting and Tauri-backed asset copying.
- [x] Extended Share content preset with pack-all defaults.
- [x] Added shared file-format plugin registry replacing hardcoded embed detection.
- [x] Added export-time rendered embed replacement for supported file types.
- [x] Added Tauri-backed embedded-file renderer and Excalidraw SVG rendering.
- [x] Surfaced embedded renderer failures in preview placeholders and embed menus.
- [x] Added CSV table rendering to plugin pipeline.
- [x] Exposed embedded renderer availability in file-header settings menu.
- [x] Added direct Excalidraw overlay editor with file-backed save/reload.
- [x] Added TSV, RTF, and plain-text file format plugins with backend renderers.
- [x] Added regression coverage for TSV, plain-text, and RTF plugin detection.
- [x] Integrated draw.io external-edit bridge with preview refresh.
- [x] Replaced tag recoloring prompt with visual color picker popover.
- [x] Column sort UI with Title, Tag Value, and Due Date options.
- [x] Added board-level tag filtering with multi-tag AND logic and filter bar.
- [x] Added keyboard shortcuts help overlay.
- [x] Added undo/redo buttons in board header.
- [x] Added sort direction toggle with ascending/descending arrows.
- [x] Added board-level search-and-replace panel.
- [x] Added "Duplicate to Column" submenu in card context menu.
- [x] Added board statistics summary bar.
- [x] Added "Sort all cards" to row and stack context menus.
- [x] Enhanced print-friendly CSS.
- [x] Added card checklist progress badge and visual due date badge.
- [x] Replaced column width toggle with Span 1-4 submenu.
- [x] Enhanced board statistics with word count and checklist counts.
- [x] Added empty column placeholder, recent boards submenu, column WIP limits.
- [x] Added move to top/bottom, sort by due date, add card at top, copy board as markdown, paste as card.
- [x] Added plain-text overlay editor for text/config/CSV/TSV files.
- [x] Added keyboard shortcuts for focused card actions (duplicate, delete, navigate, park, edit, copy, reveal, insert, column jump).
- [x] Added Alt+Arrow card move and Space context menu shortcuts.
- [x] Added configurable tag style system with presets and per-tag/category overrides.


- [x] put another tab into the bottom bar that manages the running processes! remove the processes bar from the top bar!
- [x] remove undo/redo from the top bar! put it into the menu-bar (edit).
- [x] put the "stats" into the bottom bar using another tab! remove it from the top bar!
- [x] in the burger menu (top right) there should only be style settings (global ones for the kanban board). put everything else into the menu bars! remove things that are in the view directly and in the burger menu (show parked, show trash, rename, open folder, copy as markdown, ...)
- [x] put everything that we add into a menubar not the burger menu!
- [x] the row and stack info at the end is not needed, remove them.
- [x] can a window detect when its moved? the should immediately snap to the border when its moved in any way (dragging is not the only way).
- [x] all elements (rows, stacks, columns, cards) share the same button order! drag, title, fold, burger-menu . we remove the edit button from all!
- [x] when pressing any fold button it folds the item. if alt+pressing it folds all children!
- [x] the border lines should use the full height for rows (vertical row separators) and be at least the full height of the view (apart from the margins)

- [x] the burger menu next to the filename and the burger menu to the right in the top bar have overlapping items. we dont need them multiple times.
- [x] ADD additional features to the menu bar! do you understand what the menu bar is!?! it's the os options bar!on windows it's within the window, on osx it's in the top left of the window! Any additional features not directly in the view and placed there! DO NOT ANY FEATURES IN THE WINDOW UNLESS I TELL YOU TO DO SO!
- [x] put as many features of the general features (not the location specific ones such as row, stack, column, card burger menu) to the menu-bar!
- [x] make all icons within buttons the same size. some are very small others are quite big!
- [x] there should be no left border on a row!
- [x] the burger menu next to the filename is not working reliably. maybe it's so slow, or the button clicks dont allways react. it seems to open an external programm sometimes when i click it (the draw.io.app)

- ~~i want to be able to open 2 windows at once!~~ (done: f0d93979 — Cmd+N opens new windows, menu events route to focused window, secondary windows close normally)
- [x] remove the "collapse or expand all cards" and the "fold/unfold all columns" from the top bar and put it into a menu-bar option.