# Lexera Kanban V1 Parity Todo

## Open

- [ ] Add workspace file/media search and indexing so users can search for files across the workspace when embedding images, documents, and media into cards, with format-aware results and batch selection.

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
