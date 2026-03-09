# Lexera Kanban V1 Parity Todo

## Done

- [x] Reworked the board header into left file controls, middle creation/incoming controls, and right board/runtime controls.
- [x] Moved removed top-row actions into the right burger menu and kept a single `Backend Settings` entry.
- [x] Made the header fold into the compact v1 icon mode based on actual overflow instead of only fixed breakpoints.
- [x] Switched quick capture to expose workspaces at the highest level instead of boards.
- [x] Merged draw.io and Excalidraw into the normal template flow and removed the duplicate template structure.
- [x] Kept `Incoming` clipboard-fed only instead of inventing a separate "new incoming card" flow.
- [x] Restored the main row, stack, column, and card context-menu actions for add, rename, duplicate, move, park, archive, delete, and move-to targets.
- [x] Restored parked, archived, and trash dropdown handling in the top row and the drag targets for hidden-item recovery.
- [x] Ported the richer tag-style layer so tags drive row, stack, column, and card borders, header/footer styling, badges, and numeric tag visuals.
- [x] Expanded v2 tag categories and tag menus toward the broader v1 category set.
- [x] Added rendered-tag click menus for current-board filtering, global search, rename-in-board, recoloring, and copy.
- [x] Stopped treating Markdown heading markers like `#`, `##`, and `###` as tags while still parsing real tags inside heading lines.
- [x] Verified that menu-triggered template inserts already prompt for template variables and copy companion files when templates include extra files.
- [x] Replaced the placeholder per-element Marp menu with real `Marp Classes`, `Marp Colors`, and `Marp Header & Footer` submenus.
- [x] Added local and scoped Marp class toggles for row, stack, column, and card menus.
- [x] Added local and scoped Marp directive editing for color, background color, background image, background position, background repeat, and background size.
- [x] Added local and scoped Marp directive editing for header, footer, and paginate.
- [x] Preserved Marp HTML comments in the underlying source while stripping them from visible row, stack, and column labels.
- [x] Added regression coverage for the new HTML-comment and Marp directive helper functions.
- [x] Restored board-level Marp enable/disable control in the left file-header settings menu.
- [x] Restored board-level Marp presentation frontmatter editing for theme, style, size, heading divider, and math.
- [x] Restored board-level Marp metadata frontmatter editing for title, author, description, keywords, URL, and image.
- [x] Restored board-level Marp slide-setting frontmatter editing for paginate, header, and footer.
- [x] Restored board-level Marp styling frontmatter editing for class, text color, background color, background image, background position, background repeat, and background size.
- [x] Restored a file-header YAML preview/copy submenu for the current board frontmatter.
- [x] Added regression coverage for board-level YAML frontmatter mutation helpers.
- [x] Restored file-header Pandoc status visibility in the left settings menu without requiring the export dialog first.
- [x] Restored file-header Pandoc quick actions for jumping straight into document export mode from the left settings menu.
- [x] Restored file-header Pandoc default output-format mutators for DOCX, ODT, and EPUB.
- [x] Restored file-header Pandoc default page-break mutators for continuous, per-task, and per-column document exports.
- [x] Restored export-dialog persistence for Pandoc default output format and page-break settings.
- [x] Restored export-dialog persistence for the v1 Marp theme and content-transform defaults that are still represented in the v2 dialog.
- [x] Restored export-dialog persistence for the exclude-tag filter text that v1 stored locally.
- [x] Added regression coverage for the export-dialog preference helper functions.
- [x] Restored archive dropdown per-item export actions so archived items can be written into the archive file instead of only being restored or hard-deleted.
- [x] Restored archive dropdown footer actions for exporting all archived items and opening the archive file from the header controls.
- [x] Restored archive-file generation beside the active board file using the `{board-name}-archive.md` naming pattern.
- [x] Restored archive-file appending that preserves an existing YAML frontmatter header and appends new archived content below it.
- [x] Extended archive export formatting to cover the v2 row, stack, column, and card hierarchy instead of only v1 cards and columns.
- [x] Allowed archive header controls to stay usable even when no archived items are currently listed but the archive file can still be opened.
- [x] Added regression coverage for archive filename, archive append, and archive markdown generation helpers.
- [x] Restored Marp class discovery parity so v2 loads available classes from workspace `.kanban/marp.json` config and discovered theme CSS files instead of only static fallback values.
- [x] Restored a file-header Marp class refresh action so discovered classes can be reloaded without reopening the board.
- [x] Restored element-level Marp class menus so they consume the same discovered class set as the file-header Marp class menu.
- [x] Verified that dragged template sources already route through the same template application flow as menu-triggered inserts, including variable prompts, companion file copies, and filename placeholder resolution.
- [x] Replaced the top-bar empty, template, clipboard, and incoming popups with draggable source-item lists and backed `Incoming` with stored quick-capture history entries.
- [x] Restored card drag/drop parity so dropping into a stack without columns creates an unnamed column automatically.
- [x] Restored card drag/drop parity so dropping into a row without stacks or columns creates unnamed stack and column containers automatically.
- [x] Restored card drag/drop parity so the last card moved out of an unnamed column removes that column and any now-empty unnamed parent stack automatically.
- [x] Verified that empty rows are already auto-removed after move operations, which satisfies the unnamed-row cleanup rule from the drag/drop spec.
- [x] Restored column drag/drop parity so dropping into a row body creates an unnamed stack in that row automatically.
- [x] Restored column drag/drop parity so dropping into a top-level row position creates a new unnamed row containing an unnamed stack automatically.
- [x] Restored stack drag/drop parity so dropping into a row body appends the stack into that row.
- [x] Restored stack drag/drop parity so dropping into a top-level row position creates a new unnamed row automatically.
- [x] Restored drag/drop feedback for the new row-level stack and column targets in both the board view and hierarchy.
- [x] Restored hidden row, stack, column, and card drag-out capture so recovery targets are preserved across board rerenders and work from both the board view and the hierarchy.
- [x] Kept inline card editing open when the app loses focus so external clicks or drag prep do not auto-save and close the editor.
- [x] Restored export scope selection so the dialog reflects the real board rows, stacks, and columns instead of a flat generic column list.
- [x] Restored export scope combinations so full-board, row, stack, and column selections can be mixed while still flattening correctly for the export pipeline.
- [x] Restored export entry-point parity so row, stack, and column context-menu exports open the dialog with the matching scope preselected.
- [x] Restored selection-aware export backend handling so keep, kanban, presentation, and document exports all honor the chosen board subset.
- [x] Added regression coverage for export-tree scope selection and backend subset export helpers.
- [x] Restored inline `Escape` cancel behavior so the inline card editor closes without saving.
- [x] Restored the export-preset dropdown and v1 preset application for the export settings that already exist in v2.
- [x] Restored preset reset-to-custom behavior when export settings are changed manually after a preset is chosen.
- [x] Restored the exclude-tags enable checkbox with default `#exclude` behavior when the filter is enabled.
- [x] Restored the merge-includes export checkbox and wired it to the existing `stripIncludes` export pipeline option.
- [x] Restored auto-export-on-save so a successful save export re-runs automatically after later board saves until it is stopped.
- [x] Restored auto-export-on-save save hooks so manual save, autosave, and forced overwrite saves all trigger the active re-export configuration.
- [x] Restored the export embed-handling dropdown and wired URL, fallback-image, remove, and Marp-HTML iframe behavior into the presentation export transforms.
- [x] Restored the Marp browser dropdown and passed the selected browser through to both preview/watch and one-shot Marp export launches.
- [x] Restored the link-and-asset handling dropdown with `rewrite-only`, `pack-linked`, `pack-all`, and `don't modify` export modes.
- [x] Restored link-and-asset packing suboptions for files, images, videos, other media, documents, and the file-size limit input with local persistence.
- [x] Added frontend export link rewriting so relative links are recalculated from the board file location to the exported markdown location.
- [x] Added Tauri-backed export asset copying so selected linked files can be packed into the `{export-name}-Media` folder without failing the whole export on one bad file.
- [x] Extended the `Share content` preset to select `pack-all`, enable all pack categories, and apply the 100 MB size limit default.
- [x] Kept active auto-export dialog restore in sync with the new browser, embed, and link-pack controls.
- [x] Added a shared file-format plugin registry in `packages/lexera-kanban` so renderable embed types are no longer hardcoded separately in preview and export code.
- [x] Moved draw.io, Excalidraw, spreadsheet, PDF, office document, and EPUB embed detection onto the new plugin registry.
- [x] Added export-time rendered embed replacement so supported local file embeds are converted into Marp/Pandoc-compatible image or SVG assets inside the export media folder.
- [x] Added a Tauri-backed embedded-file renderer for draw.io, spreadsheets, PDF pages, office documents, and EPUB pages, and wired board preview cache generation through it.
- [x] Added raw `.excalidraw` and `.excalidraw.json` SVG rendering through a local Playwright-based worker so Excalidraw files can participate in the same preview/export plugin pipeline.
- [x] Surfaced embedded renderer failures inside the board preview placeholders so missing tools and render errors are no longer hidden behind a generic "preview unavailable" message.
- [x] Added CSV table rendering to the shared plugin pipeline so CSV embeds preview as generated SVG tables in the board and export as Marp/Pandoc-compatible SVG assets instead of raw text.
- [x] Exposed embedded renderer availability in the file-header settings menu so missing toolchains like draw.io, LibreOffice, Poppler, MuPDF, Node.js, and Excalidraw worker assets are visible before preview or export fails.
- [x] Exposed per-embed renderer status and retry controls in the embed menu and file preview dialog so failed rendered previews can be diagnosed and rerun without reopening the board.
- [x] Added a direct raw `.excalidraw` / `.excalidraw.json` overlay editor with file-backed save and reload so embedded diagrams can be edited without leaving the kanban.

- [x] Added TSV (`.tsv`, `.tab`) file format plugin backed by the same auto-detecting delimiter renderer used for CSV, with a separate `tsv` plugin id, `tsv-cache` folder, and backend routing.
- [x] Added RTF (`.rtf`) support by extending the existing `document` plugin match pattern so LibreOffice renders RTF files through the same PDF-to-PNG pipeline.
- [x] Added plain-text file (`.txt`, `.text`, `.log`, `.cfg`, `.ini`, `.conf`) plugin with a new `plaintext` backend SVG renderer that displays paginated text with line numbers, monospace font, and truncation for long lines.
- [x] Added regression coverage for TSV, plain-text, and RTF plugin detection and render config generation.

- [x] Integrated a draw.io external-edit bridge that opens `.drawio`/`.dio` files in the system's draw.io application and shows a floating control dialog with Refresh Preview, Reopen in App, and Done actions. Preview cache is cleared and board embeds are refreshed on both explicit refresh and dialog close.
- [x] Replaced the `window.prompt` text input for tag recoloring with a visual color picker popover showing the 12-color `TAG_PALETTE` as clickable swatches with active-state highlight, plus a custom hex/CSS color input with validation and Enter/Escape key support.
- [x] Column sort UI already exists: context menu has "Sort by" submenu with "Title", "Tag Value", and "Due Date" options backed by `sortColumnCards` and `compareCardsForSort` functions. Due Date sort extracts temporal tags (`!date(...)`, `!today`, etc.) and sorts cards with dates before cards without.
- [x] Added board-level tag filtering: clicking "Filter Current Board By" on a rendered tag now toggles a CSS-based card visibility filter instead of switching to search mode. Multiple tags can be active simultaneously (AND logic). A filter bar below the header shows active filter chips with remove buttons and a "Clear all" action. Filters are cleared automatically on board switch.
- [x] Added a keyboard shortcuts help overlay toggled by pressing `?` (when not editing). Shows all board, card editor, and navigation shortcuts with platform-aware modifier keys (⌘ on Mac, Ctrl elsewhere).
- [x] Added visible undo/redo buttons (↩/↪) in the board header right zone next to the Processes and Changes buttons, providing mouse-accessible undo/redo alongside the existing Cmd/Ctrl+Z/Y shortcuts.
- [x] Added sort direction toggle: clicking the same sort mode again reverses the direction (ascending ↔ descending). Menu labels show ↑/↓ arrows for the current direction per column. State resets on board load.
- [x] Added board-level search-and-replace panel (Cmd/Ctrl+Shift+H) with find input, match counter, prev/next navigation, replace, and replace-all. Case-insensitive matching across all card content in the current board. Highlighted card scrolls into view. Undo-supported via pushUndo. Panel closes on Escape or board switch.
- [x] Added "Duplicate to Column" submenu in card context menu listing all other columns as targets. Uses the same clone pattern as in-place duplicate (new id, null kid) and appends to the target column.
- [x] Added a board statistics summary bar toggled by "Stats" button in header. Shows card count, column count, row count, and top 10 tags with counts. Excludes hidden/parked/archived cards. Bar renders below filter bar, hides on print, resets on board switch.
- [x] Added "Sort all cards" submenu to row and stack context menus with Title, Tag Value, and Due Date modes. Sorts cards across all columns within the row or stack. Uses shared `sortColumnsCards` helper and `pushUndo` for undo support.
- [x] Enhanced print-friendly CSS: added `display: none` for tag filter bar, color picker, undo/redo buttons, export dialog/overlay; added `break-inside: avoid` for cards; styled board header for print.
- [x] Added card checklist progress badge (e.g., "3/5") in card header for cards containing markdown checkboxes. Badge turns green when all tasks are complete.
- [x] Added visual due date badge on card headers showing resolved temporal tag dates (e.g., `!date(2025-03-15)`, `!today`). Badges show yellow for due today and red for overdue.
- [x] Replaced column width toggle with a "Width" submenu showing Span 1-4 presets with checkmark on current selection. Added `setColumnSpan()` for direct span setting.
- [x] Enhanced board statistics bar with word count across all visible cards and checklist task completion count (checked/total).
- [x] Added empty column placeholder text ("No cards yet") in columns with no cards.
- [x] Added recently opened boards tracking (last 10) with "Recent Boards" submenu in the board context menu for quick navigation. Persisted in localStorage.
- [x] Added column WIP limit support via `#wip-N` tag in column title. Column header shows count/limit (e.g., "5/3"), header gets red border and bold red count when limit is exceeded. Tag is preserved through renames and stripped from display title.
- [x] Added "Move to top" and "Move to bottom" card actions in context menu for quick repositioning within a column.
- [x] Added "By Due Date" option to board-level "Sort All Cards" submenu for consistency with column/row/stack sort menus.
- [x] Added "Add card at top" action in column context menu for inserting empty cards at position 0 instead of only at the bottom.
- [x] Added "Copy Board as Markdown" action in board context menu. Copies all visible cards (excluding hidden/parked/archived) as structured markdown with row and column headings.
- [x] Added "Paste as card" action in column context menu. Reads clipboard text and creates a new card at the bottom of the column with the pasted content.
- [x] Added "Move to top" and "Move to bottom" card context menu actions for quick card repositioning within a column.
- [x] Added a plain-text overlay editor using a monospace textarea for `.txt`/`.text`/`.log`/`.cfg`/`.ini`/`.conf`/`.csv`/`.tsv`/`.tab` files with Cmd/Ctrl+S save shortcut, file reload, dirty tracking, system app fallback, and automatic preview cache refresh on save.
- [x] CSV/TSV overlay editing is covered by the plain-text editor since delimited files are plain text; the preview SVG re-renders on save via the existing cache invalidation pipeline.
- [x] Audited file format overlay editing candidates and documented integration strategies below.

## Open

### V1 Parity Gaps
- [ ] Add workspace file/media search and indexing so users can search for files across the workspace when embedding images, documents, and media into cards, with format-aware results and batch selection.

### UI Improvements
- [x] Added keyboard shortcuts for focused card actions: Ctrl/Cmd+D to duplicate, Delete/Backspace to trash, Home/End to jump to first/last card in column, N to add a new card when no card is focused. Updated keyboard shortcuts help overlay with Card Navigation section.
- [x] Added Alt+Arrow keyboard shortcuts for moving focused cards: Alt+Up/Down to reorder within column, Alt+Left/Right to move to adjacent column. Card focus follows the moved card.
- [x] Added Space key to open context menu for the focused card, enabling fully keyboard-driven card operations.
- [x] Added P key to park focused card, E key to edit (overlay if enabled, inline otherwise), and C key to copy focused card as markdown to clipboard.
- [x] Added R key to reveal/collapse focused card content, I key to insert a new card after the focused card, and 1-9 number keys to jump to a column by position.

## File Format Overlay Editing Audit

### Diagrams
| Format | Strategy | Feasibility | Notes |
|--------|----------|-------------|-------|
| `.excalidraw` / `.excalidraw.json` | **Overlay iframe editor** | Done | Uses bundled Excalidraw React app via postMessage. Full save/reload/dirty tracking. |
| `.drawio` / `.dio` | **External-edit bridge** | High | draw.io desktop or VS Code extension opens the file; Tauri file-watcher detects save and re-renders preview. No embeddable JS editor exists for draw.io. |

### Tables / Data
| Format | Strategy | Feasibility | Notes |
|--------|----------|-------------|-------|
| `.csv` | **Overlay textarea editor** | Medium | Simple multi-line text editor with CSV-aware validation. Write back to file on save. Re-render SVG preview. |
| `.tsv` / `.tab` | **Same as CSV** | Medium | Identical approach, delimiter auto-detected. |
| `.xlsx` / `.xls` / `.ods` | **External app only** | Low | No viable in-browser spreadsheet editor that handles native formats. Open in system app. |

### Text / Documents
| Format | Strategy | Feasibility | Notes |
|--------|----------|-------------|-------|
| `.txt` / `.log` / `.cfg` / `.ini` / `.conf` | **Overlay textarea editor** | High | Simple monospace textarea with save-back. Re-render SVG preview on save. Low complexity. |
| `.md` / `.markdown` | **Overlay WYSIWYG or CodeMirror** | Medium | Could reuse existing inline editor or embed a lightweight markdown editor. |
| `.rtf` | **External app only** | Low | No viable in-browser RTF editor. Open in system app. |
| `.doc` / `.docx` / `.odt` | **External app only** | Low | Complex formats. Open in LibreOffice/Word. |
| `.ppt` / `.pptx` / `.odp` | **External app only** | Low | Complex formats. Open in system app. |

### Images
| Format | Strategy | Feasibility | Notes |
|--------|----------|-------------|-------|
| `.svg` | **Overlay code editor** | Medium | SVG is XML text — a code editor with syntax highlighting could work. |
| `.png` / `.jpg` / `.gif` / `.webp` | **External app only** | Low | Bitmap editing requires full image editor. Open in system app. |

### Other
| Format | Strategy | Feasibility | Notes |
|--------|----------|-------------|-------|
| `.pdf` | **External app only** | Low | PDF editing is complex. Open in system app. |
| `.epub` | **External app only** | Low | EPUB editing is complex. Open in Calibre or similar. |

### Recommended implementation order
1. **Draw.io external-edit bridge** — high impact, uses file-watcher pattern already available in Tauri
2. **Plain-text overlay editor** — simple textarea, low complexity, high utility for `.txt`/`.log`/`.cfg`/`.ini`
3. **CSV/TSV overlay editor** — textarea with delimiter-aware preview refresh
4. **Markdown overlay editor** — reuse existing inline editor infrastructure
