# Lexera v2 Implementation Plan — Steps 0-15

## Context

Rewrite the v1 stack (ludos-sync Node.js + Python menubar + VSCode extension) as native Rust/Tauri apps. Three new packages, 28 new files, zero modifications to existing code. The parser, storage, API, and config are ported line-by-line from the TypeScript reference to maintain file format and API compatibility.

## File Manifest (28 files)

```
packages/
  Cargo.toml                                    ← workspace root
  lexera-core/
    Cargo.toml
    src/lib.rs
    src/types.rs
    src/parser.rs
    src/storage/mod.rs
    src/storage/local.rs
  lexera-backend/
    package.json
    src/index.html
    src/app.js
    src/app.css
    src/api.js
    src-tauri/Cargo.toml
    src-tauri/tauri.conf.json
    src-tauri/build.rs
    src-tauri/capabilities/default.json
    src-tauri/icons/icon.png                     ← copy from ludos-dashboard
    src-tauri/src/main.rs
    src-tauri/src/lib.rs
    src-tauri/src/config.rs
    src-tauri/src/state.rs
    src-tauri/src/api.rs
    src-tauri/src/server.rs
    src-tauri/src/tray.rs
  lexera-kanban/
    package.json
    src/index.html
    src-tauri/Cargo.toml
    src-tauri/tauri.conf.json
    src-tauri/build.rs
    src-tauri/icons/icon.png                     ← copy from ludos-dashboard
    src-tauri/src/main.rs
```

## Dependencies

| Crate | Version | Package | Purpose |
|-------|---------|---------|---------|
| serde (+derive) | 1 | core, backend | Serialization |
| serde_json | 1 | core, backend | JSON |
| sha2 | 0.10 | core | Board ID hashing |
| hex | 0.4 | core | Hex encoding |
| notify | 7 | core | File watching |
| thiserror | 2 | core | Error types |
| log | 0.4 | core, backend | Logging |
| rand | 0.9 | core | Card ID generation |
| chrono (+serde) | 0.4 | core, backend | Timestamps |
| tempfile | 3 | core (dev) | Test temp dirs |
| tauri (+tray-icon) | 2 | backend | App framework + tray |
| tauri-build | 2 | backend, kanban | Build scripts |
| axum | 0.8 | backend | HTTP routes |
| tokio (full) | 1 | backend | Async runtime |
| tower-http (+cors) | 0.6 | backend | CORS |
| dirs | 6 | backend | Config paths |
| env_logger | 0.11 | backend | Log output |
| open | 5 | backend | Open config in OS editor |
| tauri | 2 | kanban | App framework |

## Step-by-Step Implementation

### Step 0: Cargo workspace

**File:** `packages/Cargo.toml`
- `[workspace]` with `resolver = "2"`
- Members: `lexera-core`, `lexera-backend/src-tauri`, `lexera-kanban/src-tauri`
- Excludes existing `ludos-dashboard/src-tauri` (stays independent)

### Step 1: lexera-core crate scaffold

**Files:** `packages/lexera-core/Cargo.toml`, `src/lib.rs`
- Lib crate (no main.rs)
- `lib.rs` re-exports: `pub mod types; pub mod parser; pub mod storage;`
- Convenience re-exports: `pub use types::*; pub use parser::SharedMarkdownParser;`

### Step 2: types.rs

**Port from:** `packages/shared/src/kanbanTypes.ts` (69 lines)

Types to define:
- `HIDDEN_TAG_PARKED`, `HIDDEN_TAG_DELETED`, `HIDDEN_TAG_ARCHIVED` constants
- `fn is_archived_or_deleted(text: &str) -> bool` — checks DELETED or ARCHIVED (not PARKED)
- `KanbanCard { id, content, checked: Option<bool> }`
- `KanbanColumn { id, title, cards: Vec<KanbanCard> }`
- `BoardSettings` — 17 optional fields, `#[serde(rename_all = "camelCase")]` for YAML compat
- `KanbanBoard { valid, title, columns, yaml_header, kanban_footer, board_settings }`
- API response types: `BoardInfo`, `ColumnSummary`, `ColumnDetail`, `CardDetail`, `SearchResult`

**Critical:** `BoardSettings` must use `rename_all = "camelCase"` so serde maps `column_width` ↔ `columnWidth` in YAML.

### Step 3: parser.rs + tests

**Port from:** `packages/shared/src/markdownParser.ts` (329 lines)

`SharedMarkdownParser` with static methods:
- `parse_markdown(content: &str) -> KanbanBoard` — line-by-line state machine
- `generate_markdown(board: &KanbanBoard) -> String` — reconstruct markdown
- `parse_board_settings(yaml_header: &str) -> BoardSettings` — YAML key-value extraction
- `update_yaml_with_board_settings(yaml_header: Option<&str>, settings: &BoardSettings) -> String`

**State machine flags:** `yaml_start_found`, `in_yaml_header`, `in_kanban_footer`, `collecting_description`

**ID generation:** `{prefix}-{atomic_counter}-{timestamp_hex}` using `AtomicU64`

**Parser rules (must match TS exactly):**
1. YAML: `---` open/close, validate `kanban-plugin: board`, return early if invalid
2. Footer: `%%` starts footer, finalize pending task first
3. Column: `## ` prefix, title = `line[3..]`
4. Task: `- ` prefix, check `- [x] `/`- [X] ` for checked, content = `line[6..]`
5. Description: 2-space indented lines; blank lines preserved unless at structural boundary (lookahead for `## `, `- `, `%%`, `---`, or EOF)

**Settings keys (17):** `columnWidth`, `layoutRows`, `maxRowHeight`, `rowHeight`, `layoutPreset`, `stickyStackMode`, `tagVisibility`, `cardMinHeight`, `fontSize`, `fontFamily`, `whitespace`, `htmlCommentRenderMode`, `htmlContentRenderMode`, `arrowKeyFocusScroll`, `boardColor`, `boardColorDark`, `boardColorLight`

**Tests:**
- `test_parse_valid_board` — columns, cards, descriptions, checked state
- `test_parse_invalid_board` — missing `kanban-plugin: board`
- `test_roundtrip` — parse → generate → reparse, verify structural equality
- `test_parse_board_settings` — numeric and string settings
- `test_description_with_blank_lines` — blank lines within descriptions
- `test_generate_markdown_checked` — `- [x] ` output

### Step 4: storage trait

**File:** `packages/lexera-core/src/storage/mod.rs`

```rust
pub trait BoardStorage: Send + Sync {
    fn list_boards(&self) -> Vec<BoardInfo>;
    fn get_columns(&self, board_id: &str) -> Option<(String, Vec<ColumnDetail>)>;
    fn add_card(&self, board_id: &str, col_index: usize, content: &str) -> Result<(), StorageError>;
    fn search(&self, query: &str) -> Vec<SearchResult>;
}
```

`StorageError` enum: `BoardNotFound`, `ColumnOutOfRange`, `InvalidBoard`, `Io`

`BoardState` struct: `file_path`, `board: KanbanBoard`, `last_modified: DateTime<Utc>`

All synchronous — API layer uses `spawn_blocking` if needed.

### Step 5: local.rs + tests

**Port from:** `packages/ludos-sync/src/fileWatcher.ts`

`LocalStorage` struct with:
- `boards: RwLock<HashMap<String, BoardState>>` — in-memory cache
- `suppress_paths: Mutex<HashSet<String>>` — self-write suppression
- `watcher: Mutex<Option<RecommendedWatcher>>` — notify file watcher
- `write_locks: Mutex<HashMap<String, Arc<Mutex<()>>>>` — per-file write serialization

Key methods:
- `add_board(file_path)` — load file, parse, cache
- `init_watcher()` — start notify watcher for all tracked files
- `board_id_from_path(path) -> String` — SHA-256 first 12 hex (matches `apiMiddleware.ts`)
- `add_card()` — acquire write lock, read fresh from disk, parse, append card, atomic write (.tmp + rename), suppress watcher, update cache

**Tests:** `test_board_id_from_path` (deterministic, 12 chars), `test_add_and_list_board`, `test_add_card`, `test_search`

### Step 6: lexera-backend scaffold

**Files:** `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, `src-tauri/build.rs`, `src-tauri/capabilities/default.json`, icon files

Key config:
- `identifier: "com.lexera.backend"`
- Window: `visible: false` (tray app), `label: "dashboard"`, 1000x700
- `trayIcon: { iconPath: "icons/icon.png", iconAsTemplate: true }`
- CSP allows `connect-src` to `localhost:*`
- Capabilities: `core:default`

### Step 7: config.rs

**Port from:** `packages/ludos-sync/src/config.ts` (200 lines)

- `default_config_path()` → `~/.config/lexera/sync.json`
- `SyncConfig { port, auth, bookmarks, calendar, workspaces }` — serde `rename_all = "camelCase"`
- `WorkspaceConfig { boards, bookmark_sync, calendar_sync, ... }`
- `BoardConfig { file, name, xbel_name, ... }`
- `load_config(path)`, `save_config(path, config)`, `get_all_board_files(config)`

**Must be byte-compatible** with existing `sync.json` files (same field names via camelCase serde).

### Step 8: state.rs

`AppState { storage: Arc<LocalStorage>, config: Arc<RwLock<SyncConfig>>, config_path, server_port }`

### Step 9: api.rs

**Port from:** `packages/ludos-sync/src/middleware/apiMiddleware.ts` (185 lines)

Axum routes:
- `GET /api/boards` → `BoardsResponse { boards }`
- `GET /api/boards/{board_id}/columns` → `ColumnsResponse { board_id, title, columns }` | 404
- `POST /api/boards/{board_id}/columns/{col_index}/cards` → 201 `{ success: true }` | 400/404/500
- `GET /api/search?q=term` → `SearchResponse { query, results }`
- `GET /status` → `StatusResponse { status, port, boards }`

Filters archived/deleted via `is_archived_or_deleted()` — same as TS.

### Step 10: server.rs

- Bind `127.0.0.1:{port}` (port 0 = auto-select)
- `CorsLayer`: `allow_origin(Any)`, `allow_methods([GET, POST, OPTIONS])`, `allow_headers(Any)`
- `tokio::spawn` the axum server
- Store actual port in `AppState.server_port`

### Step 11: tray.rs

Tray menu items:
- "Show Dashboard" → show/focus the `"dashboard"` webview window
- "Open Config..." → `open::that(config_path)` to open in OS editor
- "Quit" → `app.exit(0)`

Left-click on tray icon also shows dashboard (macOS convention).

### Step 12: lib.rs + main.rs

`main.rs`: calls `lexera_backend::run()`

`lib.rs` (`run()` function):
1. `env_logger::init()` with default `info` level
2. Load config from `default_config_path()`
3. Create `LocalStorage`, `add_board()` for each file in config, `init_watcher()`
4. Create `AppState`
5. Tauri `Builder::default().setup(|app| { setup_tray(); spawn(start_server()); })`

### Step 13: Frontend files

**Adapt from:** `packages/ludos-dashboard/src/`

`index.html`: Change title to "Lexera Dashboard", remove settings dialog + settings button
`api.js`: Rename to `LexeraApi`, hardcode `localhost:8080` base URL, add `setPort(port)` method
`app.js`: Rename to `LexeraDashboard`, use `LexeraApi`, remove all settings dialog code
`app.css`: Direct copy (unchanged)

### Step 14: lexera-kanban scaffold

Minimal Tauri 2 app:
- `package.json` with `dev`/`build` scripts
- `Cargo.toml` with `lexera-core` (path) + `tauri` deps
- `tauri.conf.json`: "Lexera Kanban", 1200x800, `com.lexera.kanban`
- `main.rs`: minimal `tauri::Builder::default().run()`
- `index.html`: placeholder "Lexera Kanban — coming soon"

### Step 15: Build + test

```bash
cd packages && cargo build                          # workspace compiles
cd packages && cargo test -p lexera-core            # parser + storage tests
cd packages/lexera-backend && cargo tauri dev       # tray icon + dashboard
curl http://localhost:8080/status                    # health check
curl http://localhost:8080/api/boards                # board list
cd packages/lexera-kanban && cargo tauri dev         # placeholder window
```

## Reference Files (TypeScript sources to port from)

| Source | Lines | Target |
|--------|-------|--------|
| `packages/shared/src/kanbanTypes.ts` | 69 | `lexera-core/src/types.rs` |
| `packages/shared/src/markdownParser.ts` | 329 | `lexera-core/src/parser.rs` |
| `packages/ludos-sync/src/fileWatcher.ts` | ~400 | `lexera-core/src/storage/local.rs` |
| `packages/ludos-sync/src/config.ts` | 200 | `lexera-backend/.../config.rs` |
| `packages/ludos-sync/src/middleware/apiMiddleware.ts` | 185 | `lexera-backend/.../api.rs` |
| `packages/ludos-dashboard/src/` | 3 files | `lexera-backend/src/` |
| `packages/ludos-dashboard/src-tauri/tauri.conf.json` | 29 | reference for Tauri 2 config |

## Deferred (NOT in this plan)

- WebDAV/CalDAV servers, XBEL/iCal mappers
- Temporal tag parser (@dates, @weeks)
- Multiple sync backends (iCloud, Dropbox)
- Full visual editor in lexera-kanban
- Authentication middleware
