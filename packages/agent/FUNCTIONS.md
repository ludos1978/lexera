# Lexera v2 — Functions Reference

Last Updated: 2026-02-24

Format: `path-module_functionname` — Description

---

## lexera-core/src/types.rs

- types-is_archived_or_deleted(text) — Check whether text block is archived or deleted; parked items NOT excluded
- types-KanbanBoard-all_columns(&self) — Get flat list of all columns from either legacy or row/stack/column hierarchy
- types-KanbanBoard-all_columns_mut(&mut self) — Get mutable references to all columns regardless of format
- types-BoardSettings-get_by_key(&self, key) — Get setting value by camelCase YAML key name
- types-BoardSettings-set_by_key(&mut self, key, value) — Set setting value by camelCase YAML key name

## lexera-core/src/parser.rs

### Public Functions

- parser-generate_id(prefix) — Generate unique ID with timestamp and sequence counter
- parser-parse_markdown(content) — Parse kanban markdown into KanbanBoard, auto-detects legacy vs new format
- parser-parse_markdown_with_includes(content, ctx) — Parse kanban markdown with include file resolution
- parser-generate_markdown(board) — Generate markdown string from KanbanBoard struct
- parser-parse_board_settings(yaml_header) — Parse BoardSettings from YAML header string
- parser-update_yaml_with_board_settings(yaml_header, settings) — Update or create YAML header with BoardSettings

### Private Functions

- parser-detect_new_format(lines) — Scan lines for h1 headings outside YAML/footer to detect new format
- parser-finalize_task(...) — Finalize current task buffer into current column's cards
- parser-parse_task_line(line) — Parse `- [ ]`/`- [x]` line into KanbanCard
- parser-is_description_boundary(line, next_line) — Check if blank line ends a card description
- parser-parse_legacy_format(lines, yaml_header, footer) — Parse `## Column` flat format
- parser-parse_new_format(lines, yaml_header, footer) — Parse `# Row`/`## Stack`/`### Column` hierarchy
- parser-write_column_cards(out, col) — Write cards for a single column to markdown output
- parser-clear_setting(settings, key) — Clear a setting field after writing to YAML

## lexera-core/src/storage/mod.rs

### BoardStorage Trait

- storage-BoardStorage-list_boards(&self) — List all tracked boards with summary info
- storage-BoardStorage-read_board(&self, board_id) — Read and parse a board by ID
- storage-BoardStorage-write_board(&self, board_id, board) — Write full board with merge on conflict
- storage-BoardStorage-add_card(&self, board_id, col_index, content) — Add card to specific column
- storage-BoardStorage-search(&self, query) — Search cards across all boards

## lexera-core/src/storage/local.rs

### LocalStorage Methods

- storage_local-LocalStorage-new() — Create new LocalStorage instance
- storage_local-LocalStorage-board_id_from_path(file_path) — Deterministic board ID from path (SHA-256 first 12 hex)
- storage_local-LocalStorage-add_board(file_path) — Add board file to tracking, read and parse it
- storage_local-LocalStorage-reload_board(board_id) — Reload board from disk after file watcher event
- storage_local-LocalStorage-check_self_write(path) — Check if file change is self-write via fingerprint
- storage_local-LocalStorage-cleanup_expired_fingerprints() — Periodic cleanup of expired write fingerprints
- storage_local-LocalStorage-get_board_path(board_id) — Get filesystem path for board ID
- storage_local-LocalStorage-get_board_version(board_id) — Get version number for ETag support
- storage_local-LocalStorage-get_board_content_hash(board_id) — Get content hash for conflict detection
- storage_local-LocalStorage-include_map() — Get include map read guard
- storage_local-LocalStorage-parse_with_includes(content, board_id, board_dir) — Parse markdown with include file support
- storage_local-LocalStorage-write_include_file(board_id, col_index) — Write cards to include file in slide format
- storage_local-LocalStorage-atomic_write(path, content) — Atomic write with fsync (temp file + rename)

### BoardStorage Impl for LocalStorage

- storage_local-LocalStorage-list_boards() — List all boards using all_columns() for flat summary
- storage_local-LocalStorage-read_board(board_id) — Clone board from internal state
- storage_local-LocalStorage-write_board(board_id, board) — Write board with three-way merge and conflict detection
- storage_local-LocalStorage-add_card(board_id, col_index, content) — Add card using all_columns_mut()
- storage_local-LocalStorage-search(query) — Search across all boards using all_columns()

## lexera-core/src/merge/diff.rs

- merge_diff-snapshot_board(board) — Build map of kid -> CardSnapshot from board for comparison
- merge_diff-diff_boards(old_board, new_board) — Compute card-level changes between two board versions

## lexera-core/src/merge/merge.rs

- merge_merge-three_way_merge(base, theirs, ours) — Three-way merge between base, disk, and incoming board
- merge_merge-add_card_to_column(columns, column_title, card) — Helper: add card to named column

## lexera-backend/src-tauri/src/api.rs

### Route Handlers

- api-api_router() — Create Axum router with all API routes
- api-list_boards() — GET /boards — list all boards with summary info
- api-get_board_columns(board_id) — GET /boards/{id}/columns — full column data + fullBoard + ETag
- api-add_card(board_id, col_index, content) — POST /boards/{id}/columns/{idx}/cards — add card
- api-write_board(board_id, body) — PUT /boards/{id} — write full board with merge
- api-upload_media(board_id, multipart) — POST /boards/{id}/media — upload media file
- api-serve_media(board_id, filename) — GET /boards/{id}/media/{file} — serve media
- api-serve_file(board_id, path) — GET /boards/{id}/file?path= — serve file relative to board
- api-file_info(board_id, path) — GET /boards/{id}/file-info?path= — file metadata
- api-find_file(board_id, filename) — POST /boards/{id}/find-file — recursive file search
- api-convert_path(board_id, body) — POST /boards/{id}/convert-path — path conversion
- api-search(query) — GET /search?q= — search cards across all boards
- api-sse_events() — GET /events — SSE stream with 30s keep-alive
- api-status() — GET /status — health check

### Private Helpers

- api-resolve_board_file(state, board_id, file_path) — Resolve file path relative to board
- api-content_type_for_ext(ext) — Map file extension to MIME type
- api-media_category(ext) — Categorize file by extension
- api-is_previewable(ext) — Check if file type is previewable
- api-dedup_filename(dir, filename) — Generate unique filename if exists

## lexera-kanban/src-tauri/src/commands.rs

- commands-open_in_system(path) — Tauri command: open file in system default app
- commands-open_url(url) — Tauri command: open URL in system default app

---

## Frontend: lexera-kanban/src/api.js — LexeraApi

- api_js-discover() — Auto-discover backend by trying common ports
- api_js-request(path, options) — Generic HTTP request wrapper
- api_js-getBoards() — GET /boards
- api_js-getBoardColumns(boardId) — GET /boards/{id}/columns
- api_js-addCard(boardId, colIndex, content) — POST add card
- api_js-search(query) — GET /search
- api_js-checkStatus() — GET /status
- api_js-mediaUrl(boardId, filename) — Construct media URL
- api_js-fileUrl(boardId, path) — Construct file URL
- api_js-fileInfo(boardId, path) — GET file metadata
- api_js-saveBoard(boardId, boardData) — PUT full board
- api_js-uploadMedia(boardId, file) — POST multipart file upload to board media folder, returns { filename }
- api_js-connectSSE(onEvent) — Establish SSE connection

## Frontend: lexera-kanban/src/app.js — LexeraDashboard

### Column Grouping & Order (Legacy)

- app-hasStackTag(title) — Test if column title contains #stack tag
- app-stripStackTag(title) — Remove #stack tag from title
- app-buildColumnGroups(columns) — Group columns into stacks based on #stack tags
- app-getOrderedItems(items, storageKey, idFn) — Retrieve items in saved localStorage order
- app-saveOrder(items, storageKey, idFn) — Persist item order to localStorage
- app-getFoldedColumns(boardId) — Get folded column titles from localStorage
- app-getFoldedItems(boardId, kind) — Get folded row/stack titles from localStorage
- app-saveFoldState(boardId) — Persist fold state of columns, rows, stacks to localStorage
- app-reorderItems(items, sourceIdx, targetIdx, insertBefore) — Reorder array by moving element
- app-reorderColumnGroups(sourceIdx, targetIdx, insertBefore) — Reorder column groups (DnD)
- app-reorderBoards(sourceIdx, targetIdx, insertBefore) — Reorder boards in sidebar (DnD)

### Init & Keyboard

- app-init() — Initialize event listeners and start polling
- app-handleKeyNavigation(e) — Arrow keys, Enter, Escape for card navigation
- app-navigateCards(key) — Move focus between cards
- app-focusCard(cardEl) — Highlight and scroll card into view
- app-unfocusCard() — Remove focus highlight

### Connection & Polling

- app-connectSSEIfReady() — Establish SSE connection if available
- app-handleSSEEvent(event) — Process real-time board change events
- app-poll() — Periodic sync: status check, board list, reload active board
- app-setConnected(state) — Update connection status and UI indicator

### Board List & Selection

- app-renderBoardList() — Render sidebar board list with DnD support
- app-selectBoard(boardId) — Select board and load data
- app-loadBoard(boardId) — Fetch board data from backend

### Format Detection & Data Access

- app-isNewFormat() — Check if board uses row/stack/column hierarchy
- app-getAllFullColumns() — Flatten rows->stacks->columns to flat array
- app-getFullColumn(flatIndex) — Get column at flat index from fullBoardData
- app-updateDisplayFromFullBoard() — Filter archived/deleted, build activeBoardData
- app-is_archived_or_deleted(text) — Check for archived/deleted markers
- app-findColumnTitleByIndex(index) — Lookup column title by flat index

### Main View Rendering

- app-renderMainView() — Main render: board, search results, or empty state
- app-renderBoardHeader() — Render header with title, parked count, fold-all
- app-getParkedCount() — Count cards with #hidden-internal-parked tag
- app-toggleFoldAll() — Toggle fold state of all columns/rows/stacks
- app-showParkedItems() — Collect parked cards and display modal
- app-showParkedDialog(parkedItems) — Create modal dialog for parked items
- app-unparkCard(colIndex, fullCardIndex) — Remove parked tag from card
- app-showBoardSettingsDialog() — Show modal dialog for editing all board settings (YAML header values)

### Save & Undo

- app-showSaving() — Show "Saving..." indicator
- app-hideSaving() — Hide saving indicator with delay
- app-saveFullBoard() — Send full board to backend
- app-pushUndo() — Push current board state to undo stack
- app-undo() — Revert to previous state
- app-redo() — Re-apply undone change
- app-applyBoardSettings() — Apply CSS custom properties from board settings

### Column Rendering

- app-buildColumnElement(col, foldedCols, collapsedCards, parentDragEl) — Build single column DOM element (shared by both formats)
- app-renderColumns() — Dispatch to legacy or new-format rendering
- app-renderLegacyColumns() — Render flat column layout with column-groups
- app-renderNewFormatBoard() — Render rows -> stacks -> columns hierarchy

### New-Format DnD Mutations

- app-reorderRows(sourceIdx, targetIdx, insertBefore) — Reorder rows (DnD)
- app-moveStack(fromRowIdx, fromStackIdx, toRowIdx, toStackIdx, insertBefore) — Move stack between rows (DnD)
- app-findFullDataRow(displayRowIdx) — Map display row index to fullBoardData row
- app-findFullDataStack(displayRowIdx, displayStackIdx) — Map display stack index to fullBoardData stack

### Row & Stack Context Menus

- app-closeRowStackMenu() — Remove row/stack context menu
- app-positionMenu(menu, x, y) — Position context menu with viewport bounds
- app-showRowContextMenu(x, y, rowIdx) — Show row context menu (rename, add stack/row, delete)
- app-showStackContextMenu(x, y, rowIdx, stackIdx) — Show stack context menu (rename, add column, delete)
- app-handleRowAction(action, rowIdx) — Process row context menu actions
- app-handleStackAction(action, rowIdx, stackIdx) — Process stack context menu actions
- app-renameRowOrStack(type, rowIdx, stackIdx) — Inline editor for row/stack title
- app-addRow(atIndex) — Create new row with default stack and column
- app-deleteRow(rowIdx) — Delete row with confirmation
- app-addStackToRow(rowIdx) — Add new stack to row
- app-deleteStack(rowIdx, stackIdx) — Delete stack with confirmation
- app-addColumnToStack(rowIdx, stackIdx) — Add new column to stack

### Card Operations

- app-submitCard(colIndex, content) — Create new card via API
- app-moveCard(fromColIdx, fromCardIdx, toColIdx, toInsertIdx) — Move card between columns
- app-getFullCardIndex(col, visibleIdx) — Map visible card index to full index (skipping hidden)
- app-enterCardEditMode(cardEl, colIndex, cardIndex) — Switch card to edit mode
- app-saveCardEdit(cardEl, colIndex, fullCardIdx, newContent) — Save edited card
- app-toggleCheckbox(colIndex, cardIndex, lineIndex, checked) — Toggle checkbox in card

### Card Context Menu

- app-closeCardContextMenu() — Remove card context menu
- app-showCardContextMenu(x, y, colIndex, cardIndex) — Show card context menu (edit, move, archive, delete)
- app-handleCardMenuAction(action, colIndex, cardIndex) — Process card menu actions
- app-duplicateCard(colIndex, cardIndex) — Clone card in same column
- app-tagCard(colIndex, cardIndex, tag) — Append tag to card (archive, park)
- app-deleteCard(colIndex, cardIndex) — Remove card from board

### Column Context Menu & Operations

- app-closeColumnContextMenu() — Remove column context menu
- app-showColumnContextMenu(x, y, colIndex) — Show column context menu (rename, add, fold, sort, delete)
- app-handleColumnAction(action, colIndex) — Process column menu actions (rename, add, fold, sort, delete)
- app-sortColumnCards(colIndex, mode) — Sort cards in column by 'title' (alphabetical) or 'tag' (numeric tag value)
- app-extractNumericTag(content) — Extract first numeric hashtag value from card header lines
- app-escapeAttr(str) — Escape string for HTML attributes
- app-enterColumnRename(colEl, colIndex) — Inline editor for column title
- app-findColumnContainer(flatIndex) — Find parent array and local index for flat column index
- app-addColumn(atIndex) — Create new column at index
- app-deleteColumn(colIndex) — Remove column with confirmation
- app-toggleColCards(colIndex, collapse) — Collapse/expand all cards in column

### Card DnD (Pointer-based)

- app-startCardDrag(e) — Create ghost element, start visual drag
- app-updateCardDropTarget(mx, my) — Find column under mouse, show drop indicator
- app-finishCardDrag(mx, my) — Complete drag, move card to target
- app-cancelCardDrag() — Abort drag, cleanup
- app-cleanupCardDrag() — Remove ghost element and reset state
- app-findCardInsertIndex(mouseY, cardsEl) — Determine insert position by mouse Y
- app-showCardDropIndicator(cardsEl, insertIdx) — Show visual drop indicator
- app-clearCardDropIndicators() — Remove all drop indicators

### Search

- app-onSearchInput() — Debounced search input handler
- app-performSearch(query) — Execute search via API
- app-exitSearchMode() — Close search results, return to board
- app-renderSearchResults() — Render search results grouped by board

### Embed Menu & Media

- app-closeEmbedMenu() — Remove embed context menu
- app-showEmbedMenu(container, btn) — Show embed context menu (refresh, info, path fix, delete)
- app-handleEmbedAction(action, container) — Process embed menu actions
- app-handleFileDrop(files, targetEl) — Upload dropped/pasted files as media, create embed cards
- app-openInSystem(path) — Open file in system app
- app-showPathFixResults(container, matches) — Display path fix results
- app-formatFileSize(bytes) — Format bytes as human-readable size
- app-getMediaCategory(ext) — Categorize file by extension
- app-getFileExtension(path) — Extract file extension

### Card Collapse & Tags

- app-getCollapsedCards(boardId) — Get collapsed card IDs from localStorage
- app-saveCardCollapseState(boardId) — Persist collapsed card state
- app-getTagColor(tagName) — Get hex color for tag (predefined or hash-based)
- app-getFirstTag(content) — Extract first tag from card content

### Card Content Rendering

- app-renderTable(lines, startIdx, boardId) — Parse markdown table lines into HTML table with alignment
- app-renderCardContent(content, boardId) — Convert card markdown to HTML (headings, lists, code blocks, tables, embeds, etc.)
- app-renderInline(text, boardId) — Render inline markdown (links, bold, italic, code, tags, temporal tags)
- app-resolveTemporalTag(tag) — Resolve @today, @tomorrow, @days+N, @weekday, @date(YYYY-MM-DD) to date string
- app-formatDate(d) — Format Date object as YYYY-MM-DD string
- app-escapeHtml(str) — Escape text for HTML output

### Conflict Resolution & Notifications

- app-showConflictDialog(conflictCount, autoMerged) — Show merge conflict dialog with Keep/Reload options
- app-showNotification(message) — Show toast notification at bottom-right with auto-dismiss

### Card Edit Formatting

- app-insertFormatting(textarea, fmt) — Insert markdown formatting (bold/italic/code/link) around selection in textarea
