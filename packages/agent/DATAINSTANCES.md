# Lexera v2 — Data Instances Reference

Last Updated: 2026-02-24

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  BACKEND (Rust — Axum HTTP server)                              │
│                                                                 │
│  LocalStorage (singleton)                                       │
│  ├── boards: HashMap<String, BoardState>  (all tracked boards)  │
│  ├── write_locks: per-board Mutex (serialized writes)           │
│  ├── self_write_tracker: fingerprints to suppress self-events   │
│  ├── include_map: maps include paths to board IDs               │
│  └── next_version: AtomicU64 (ETag versioning)                  │
│                                                                 │
│  AppState (shared via Axum Extension)                           │
│  ├── storage: Arc<LocalStorage>                                 │
│  ├── event_tx: broadcast::Sender<String>  (SSE events)          │
│  └── incoming_config: IncomingConfig (watched dirs + files)     │
└─────────────────────────────────────────────────────────────────┘
         │ HTTP REST + SSE
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  FRONTEND (JavaScript — LexeraDashboard IIFE)                   │
│                                                                 │
│  Module State:                                                  │
│  ├── boards          — Array of BoardInfo from list_boards()    │
│  ├── activeBoardId   — Currently selected board ID              │
│  ├── activeBoardData — Filtered display data (no archived)      │
│  │   ├── .title                                                 │
│  │   ├── .columns    — Flat array of {index, title, cards}      │
│  │   └── .rows       — Hierarchical [{stacks:[{columns:[]}]}]  │
│  ├── fullBoardData   — Complete KanbanBoard from server         │
│  │   ├── .columns    — Legacy format columns                    │
│  │   ├── .rows       — New format rows (empty for legacy)       │
│  │   ├── .yamlHeader                                            │
│  │   ├── .kanbanFooter                                          │
│  │   └── .boardSettings                                         │
│  ├── connected       — Boolean connection state                 │
│  ├── searchMode      — Boolean search active flag               │
│  ├── searchResults   — Array of SearchResult                    │
│  ├── addCardColumn   — Column index with open add-card form     │
│  ├── dragSource      — Current DnD source descriptor            │
│  ├── isEditing       — Boolean card edit mode flag              │
│  ├── pendingRefresh  — Suppressed refresh during edit           │
│  ├── undoStack       — Array of JSON-stringified board states   │
│  ├── redoStack       — Array of JSON-stringified board states   │
│  ├── cardDrag        — Pointer-based card DnD state             │
│  ├── focusedCardEl   — Currently focused card DOM element       │
│  ├── activeCardMenu  — Open card context menu element           │
│  ├── activeColMenu   — Open column context menu element         │
│  └── activeRowStackMenu — Open row/stack context menu element   │
│                                                                 │
│  DOM Refs:                                                      │
│  ├── $boardList        — #board-list                            │
│  ├── $boardHeader      — #board-header                          │
│  ├── $columnsContainer — #columns-container                     │
│  ├── $searchResults    — #search-results                        │
│  ├── $emptyState       — #empty-state                           │
│  ├── $searchInput      — #search-input                          │
│  └── $connectionDot    — #connection-dot                        │
└─────────────────────────────────────────────────────────────────┘
```

## Data Flow

### Board Load Flow
```
User clicks board in sidebar
  → selectBoard(boardId)
    → loadBoard(boardId)
      → LexeraApi.getBoardColumns(boardId)
        → GET /boards/{id}/columns
          → api.rs::get_board_columns()
            → storage.read_board() → KanbanBoard
            → Serialize with fullBoard field
      → Response: { columns, fullBoard: KanbanBoard }
      → fullBoardData = response.fullBoard
      → updateDisplayFromFullBoard()
        → getAllFullColumns() → flat column list
        → Filter archived/deleted
        → Build activeBoardData.columns (flat)
        → Build activeBoardData.rows (hierarchical, if new format)
      → renderMainView()
        → renderColumns()
          → isNewFormat() ? renderNewFormatBoard() : renderLegacyColumns()
```

### Board Save Flow
```
User modifies card/column/row/stack
  → pushUndo()
  → Modify fullBoardData directly
  → saveFullBoard()
    → LexeraApi.saveBoard(boardId, fullBoardData)
      → PUT /boards/{id}
        → api.rs::write_board()
          → storage.write_board()
            → Three-way merge if content hash mismatch
            → atomic_write() (temp file + fsync + rename)
            → Track self-write fingerprint
            → Broadcast SSE event
  → updateDisplayFromFullBoard()
  → renderColumns()
```

### SSE Event Flow
```
Backend detects file change (file watcher)
  → check_self_write() → skip if own write
  → reload_board() → re-parse from disk
  → broadcast SSE event { type: "board_changed", boardId }
  → Frontend handleSSEEvent()
    → If boardId matches active board
      → loadBoard(activeBoardId) (unless editing or recently saved)
```

---

## CSS Custom Properties (Board Settings)

| CSS Variable | BoardSettings Key | Default | Applied To |
|---|---|---|---|
| `--board-column-width` | `columnWidth` | `280px` | `.column-group`, `.board-stack` |
| `--board-font-size` | `fontSize` | `13px` | `.columns-container` |
| `--board-font-family` | `fontFamily` | `inherit` | `.columns-container` |
| `--board-color` | `boardColor` | — | `.columns-container` |
| `--board-color-dark` | `boardColorDark` | — | `.columns-container` |
| `--board-color-light` | `boardColorLight` | — | `.columns-container` |
| `--board-row-height` | `rowHeight` | `auto` | `.board-row-content` |
| `--board-max-row-height` | `maxRowHeight` | `none` | `.board-row-content` |
| `--board-card-min-height` | `cardMinHeight` | `auto` | `.card` |
| `--board-whitespace` | `whitespace` | `pre-wrap` | `.card` |

## CSS Classes (Board Settings)

| Class | BoardSettings Key | Value | Effect |
|---|---|---|---|
| `tag-visibility-hide` | `tagVisibility` | `hide` | Tags hidden |
| `tag-visibility-dim` | `tagVisibility` | `dim` | Tags at 30% opacity |
| `sticky-headers` | `stickyStackMode` | `column` | Sticky column headers |
| `html-comments-hide` | `htmlCommentRenderMode` | `hide` | HTML comments hidden |
| `html-comments-dim` | `htmlCommentRenderMode` | `dim` | HTML comments at 30% opacity |
| `focus-scroll-mode` | `arrowKeyFocusScroll` | `enabled` | Focused cards have scroll margin |

---

## localStorage Keys

| Key Pattern | Value | Description |
|---|---|---|
| `lexera-col-order:{boardId}` | JSON array of column titles | Column display order (legacy format) |
| `lexera-col-fold:{boardId}` | JSON array of column titles | Folded column titles |
| `lexera-row-fold:{boardId}` | JSON array of row titles | Folded row titles (new format) |
| `lexera-stack-fold:{boardId}` | JSON array of stack titles | Folded stack titles (new format) |
| `lexera-board-order` | JSON array of board IDs | Board sidebar order |
| `lexera-card-collapse:{boardId}` | JSON array of card IDs | Collapsed card IDs |

---

## Backend State Details

### BoardState (per board)
```
File: lexera-core/src/storage/local.rs

One instance per tracked board file:
- file_path: PathBuf            — Absolute path to .md file
- board: KanbanBoard            — Parsed board data (in-memory cache)
- last_modified: SystemTime     — File modification time at last read
- content_hash: String          — SHA-256 of raw file content
- version: u64                  — Incrementing version for ETag/cache
```

### AppState (Axum shared state)
```
File: lexera-backend/src-tauri/src/api.rs

Single instance shared across all request handlers:
- storage: Arc<LocalStorage>                    — Board storage singleton
- event_tx: broadcast::Sender<String>           — SSE event broadcaster
- incoming_config: IncomingConfig               — Watched directories and files
```

---

## Frontend State Details

### fullBoardData
Complete KanbanBoard as returned by server. Mutations happen directly on this object.
```javascript
{
  valid: true,
  title: "Board Name",
  columns: [...],        // Legacy format: populated. New format: empty
  rows: [                // New format: populated. Legacy format: empty
    {
      id: "row-xxx",
      title: "Row Name",
      stacks: [
        {
          id: "stack-xxx",
          title: "Stack Name",
          columns: [
            { id: "col-xxx", title: "Column Name", cards: [...] }
          ]
        }
      ]
    }
  ],
  yamlHeader: "---\nkanban-plugin: board\n---",
  kanbanFooter: null,
  boardSettings: { columnWidth: "280px", ... }
}
```

### activeBoardData
Filtered view for rendering. Built by `updateDisplayFromFullBoard()`.
```javascript
{
  title: "Board Name",
  columns: [                    // Always flat, both formats
    { index: 0, title: "Todo", cards: [...] },
    { index: 1, title: "Done", cards: [...] }
  ],
  rows: [                       // Only populated for new format
    {
      id: "row-xxx",
      title: "Row Name",
      stacks: [
        {
          id: "stack-xxx",
          title: "Stack Name",
          columns: [
            { index: 0, title: "Todo", cards: [...] }
          ]
        }
      ]
    }
  ]
}
```

### cardDrag
Pointer-based card drag state.
```javascript
{
  el: HTMLElement,       // Source card DOM element
  ghost: HTMLElement,    // Floating ghost element
  colIndex: number,      // Source column flat index
  cardIndex: number,     // Source card visible index
  startX: number,        // Mouse start position
  startY: number,
  started: boolean       // Whether drag threshold was reached
}
```

### dragSource
HTML5 DnD source descriptor for column-group, row, and stack dragging.
```javascript
// Column group (legacy)
{ type: 'column-group', index: number }

// Row (new format)
{ type: 'board-row', index: number }

// Stack (new format)
{ type: 'board-stack', rowIndex: number, stackIndex: number }
```
