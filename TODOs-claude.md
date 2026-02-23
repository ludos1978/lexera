# Next-Gen Lexera: lexera-core + lexera-backend + lexera-kanban

## Context

The current stack (ludos-sync Node.js server, Python menubar, VSCode extension) is being superseded by two new Tauri apps. The v2 backend is the single source of truth for board data — it handles file I/O, file watching, WebDAV (later), and exposes a REST API. The visual editor (lexera-kanban) and any future clients only talk to the backend via API. This enables swapping storage backends (local files, iCloud, Dropbox) without changing clients.

**No existing code is modified.** All work is in new `packages/` directories.

## Architecture

```
                         ┌──────────────────┐
                         │   lexera-core    │  Shared Rust library
                         │   (lib crate)    │  Types, parser, storage trait
                         └────────┬─────────┘
                                  │
                    ┌─────────────┴─────────────┐
                    │                           │
           ┌────────┴────────┐         ┌────────┴────────┐
           │  lexera-backend │         │  lexera-kanban  │
           │  (Tauri app)    │         │  (Tauri app)    │
           │                 │         │  [scaffold only]│
           │ System tray     │         │                 │
           │ HTTP server     │         │ Visual editor   │
           │ File watcher    │         │ (future)        │
           │ Quick-access UI │         │                 │
           └─────────────────┘         └─────────────────┘
                    │
        ┌───────────┼───────────┐
        │           │           │
   REST API    WebDAV(later)  CalDAV(later)
        │
   Tauri Kanban / Browser / etc.
```

## Packages

### 1. `packages/lexera-core/` — Shared Rust library

| File | What |
|------|------|
| `Cargo.toml` | Lib crate. Deps: serde, sha2, hex, notify 7, thiserror, log |
| `src/lib.rs` | Re-exports modules |
| `src/types.rs` | `KanbanBoard`, `KanbanColumn`, `KanbanCard`, `BoardSettings`, `BoardInfo`, `SearchResult`, hidden tag constants + `is_archived_or_deleted()` |
| `src/parser.rs` | `parse_markdown()`, `generate_markdown()`, `parse_board_settings()`, `update_yaml_with_board_settings()` — line-by-line port of `packages/shared/src/markdownParser.ts` |
| `src/storage/mod.rs` | `BoardStorage` trait: `list_boards`, `read_board`, `write_board`, `add_card`, `search` |
| `src/storage/local.rs` | `LocalStorage` impl: filesystem read/write/watch, atomic writes, board ID hashing (SHA-256 first 12 hex), self-write suppression |

**Key porting notes for parser.rs:**
- Port from `packages/shared/src/markdownParser.ts` (328 lines)
- YAML header: `---` delimiters, must contain `kanban-plugin: board`
- Columns: `## Title`
- Tasks: `- [ ] content` / `- [x] content`, content starts at char 6
- Description: 2-space indented continuation, with structural boundary lookahead for blank lines
- Footer: `%%` markers
- ID generation: `{prefix}-{counter}-{timestamp_hex}`

### 2. `packages/lexera-backend/` — v2 Backend (Tauri 2 tray app)

| File | What |
|------|------|
| `package.json` | Scripts: `cargo tauri dev`, `cargo tauri build` |
| `src-tauri/Cargo.toml` | Deps: lexera-core (path), tauri 2 (tray-icon), axum 0.8, tokio, tower-http (cors), serde, dirs, log, env_logger |
| `src-tauri/tauri.conf.json` | Product "Lexera Backend", window hidden by default, tray icon, CSP for localhost |
| `src-tauri/capabilities/default.json` | core:default, shell:allow-open |
| `src-tauri/src/main.rs` | Entry point, calls `lexera_backend::run()` |
| `src-tauri/src/lib.rs` | Tauri setup: load config, init storage, setup tray, spawn HTTP server |
| `src-tauri/src/config.rs` | `SyncConfig` struct (matches existing `sync.json` format), `load_config()`, `default_config_path()` (~/.config/lexera/sync.json) |
| `src-tauri/src/state.rs` | `AppState`: `Arc<RwLock<LocalStorage>>` + config + server port |
| `src-tauri/src/api.rs` | Axum routes — port of `apiMiddleware.ts`: GET /api/boards, GET /api/boards/{id}/columns, POST /api/boards/{id}/columns/{idx}/cards, GET /api/search, GET /status |
| `src-tauri/src/server.rs` | Spawns axum on background tokio task, binds 127.0.0.1:{port} |
| `src-tauri/src/tray.rs` | System tray: status, "Open Dashboard", "Open Config...", "Quit" |
| `src/index.html` | Adapted from `ludos-dashboard/src/index.html` — remove settings dialog |
| `src/app.js` | Adapted from `ludos-dashboard/src/app.js` — remove settings code |
| `src/app.css` | Copy from `ludos-dashboard/src/app.css` |
| `src/api.js` | Adapted from `ludos-dashboard/src/api.js` — hardcode localhost base URL |

### 3. `packages/lexera-kanban/` — Visual Editor (scaffold only)

| File | What |
|------|------|
| `package.json` | Scripts: `cargo tauri dev`, `cargo tauri build` |
| `src-tauri/Cargo.toml` | Deps: lexera-core (path), tauri 2 |
| `src-tauri/tauri.conf.json` | Product "Lexera Kanban", 1200x800 window |
| `src-tauri/src/main.rs` | Minimal Tauri app |
| `src/index.html` | Placeholder: "Lexera Kanban — coming soon" |

### Cargo Workspace

`packages/Cargo.toml`:
```toml
[workspace]
resolver = "2"
members = ["lexera-core", "lexera-backend/src-tauri", "lexera-kanban/src-tauri"]
```

Separate from the existing `ludos-dashboard` — no coupling to old code.

## Implementation Order

| Step | What | Depends on |
|------|------|-----------|
| 0 | Create `packages/Cargo.toml` workspace | — |
| 1 | `lexera-core/Cargo.toml` + `src/lib.rs` | Step 0 |
| 2 | `lexera-core/src/types.rs` | Step 1 |
| 3 | `lexera-core/src/parser.rs` + tests | Step 2 |
| 4 | `lexera-core/src/storage/mod.rs` (trait) | Step 2 |
| 5 | `lexera-core/src/storage/local.rs` + tests | Steps 3, 4 |
| 6 | `lexera-backend/` scaffold (Cargo.toml, tauri.conf.json, build.rs, icons, capabilities) | Step 0 |
| 7 | `lexera-backend/src-tauri/src/config.rs` | Step 6 |
| 8 | `lexera-backend/src-tauri/src/state.rs` | Steps 5, 7 |
| 9 | `lexera-backend/src-tauri/src/api.rs` | Step 8 |
| 10 | `lexera-backend/src-tauri/src/server.rs` | Step 9 |
| 11 | `lexera-backend/src-tauri/src/tray.rs` | Step 6 |
| 12 | `lexera-backend/src-tauri/src/lib.rs` + `main.rs` | Steps 10, 11 |
| 13 | Frontend files (adapt from ludos-dashboard) | Step 6 |
| 14 | `lexera-kanban/` scaffold (all files) | Step 0 |
| 15 | Workspace build + test | All |

## Verification

1. `cd packages && cargo test -p lexera-core` — parser roundtrips, type tests, storage tests
2. `cd packages && cargo build` — full workspace compiles
3. `cd packages/lexera-backend && cargo tauri dev` — tray icon appears, dashboard window opens
4. `curl http://localhost:8080/status` — returns JSON
5. `curl http://localhost:8080/api/boards` — returns board list (if config has boards)
6. Dashboard: boards visible, add card works, search works
7. `cd packages/lexera-kanban && cargo tauri dev` — placeholder window opens

## Deferred (NOT in this plan)

- WebDAV server (Floccus bookmark sync)
- CalDAV server (calendar app sync)
- XBEL mapper
- iCal mapper
- Temporal tag parser (@dates, @weeks, etc.)
- Multiple sync backends (iCloud, Dropbox, direct sync)
- Full visual editor in lexera-kanban
- Authentication middleware
