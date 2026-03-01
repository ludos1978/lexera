Deep Analysis Summary (2026-03-01, updated 2026-03-01)

────────────────────────────────────────────────────────────────────────────────

## Completed Work

### P1: Persistence Layer (commit dd760315)
- auth.json, invites.json, public_rooms.json in ~/.config/lexera/collab/
- Atomic writes (tmp + rename), load on startup, 60s periodic save
- All 3 collab services (auth, invite, public rooms) now survive restarts

### P2 partial: CORS + Path Traversal (commit f41165c8)
- CORS restricted from Allow::Any to localhost-only predicate
- Path traversal prevention with percent-decoding (handles .., ./, URL encoding)

### P3: CRDT Error Hardening (commit f41165c8)
- Replaced 41+ unwrap() calls in crdt/bridge.rs with proper Result propagation
- Added `loro_err` helper for error conversion
- Updated all callers in local.rs and live_sync.rs

### P4: WebSocket Sync Hardening (commit 39f0efe6)
- Exponential backoff for reconnection (1s→30s cap + 30% jitter)
- 30s server-side WebSocket Ping keepalive for dead client detection

### P5 partial: Frontend Cleanup (commit 73dc9c93)
- Replaced 9 stray console.error/warn calls with lexeraLog() in app.js

### P10 partial: iOS Capture Hardening (commit 4f67f5ce)
- Replaced 12 RwLock .unwrap() with poisoning recovery
- Added error logging for silent I/O failures in scan_boards/process_pending
- Removed unused base64 dependency from Cargo.toml

### Include File Cycle Detection (commit e84fb78f)
- HashSet<PathBuf> tracking prevents infinite recursion in nested includes
- 2 new unit tests (direct cycle, indirect cycle)

### api.rs Decomposition (commit 29dd0730)
- Split 1,642-line monolithic api.rs into 7 focused modules:
  mod.rs, board.rs, media.rs, template.rs, search.rs, events.rs, file_ops.rs

### Real-Time Editing Presence (commit 8eb60846)
- Extended WebSocket sync protocol with ClientEditingPresence/ServerEditingPresence
- Per-card colored initials badges showing who is editing which card
- Cursor position sharing with 250ms throttle
- Typing indicator (pulse animation) and soft-lock dimming
- Automatic cleanup on disconnect and board switch
- 12-color deterministic palette from user name hash

### Backend Board ID Input Validation (commit 8fb26d1e)
- validate_board_id() checks empty, overlength (>256), path traversal
- Applied to 7 board handlers (get, write, add_card, remove, settings)
- Reuses existing has_path_traversal() for consistency

### Frontend Error Boundaries (commit 903a40a3)
- 15 try/catch wrappers on critical event handlers in app.js
- Covers SSE, renderColumns, card drag (mousedown/move/up), ptr drag, Escape key, editor input/keydown
- Drag error handlers call cleanup (cancelCardDrag/cleanupPtrDrag) to prevent stuck state

### iOS Startup Graceful Error Handling (commit ee3dd8a2)
- Replaced .expect() on IosStorage::new with match + log::error + return Err
- Replaced .expect() on Tauri run() with unwrap_or_else + log::error

────────────────────────────────────────────────────────────────────────────────

## Architecture Overview

### packages/lexera-core (Rust library, ~9,925 LOC, 28 source files)
- Parser: Dual format support - legacy (## columns) and new hierarchical (# rows, ## stacks, ### columns) with auto-detection
- Types: KanbanBoard, KanbanCard, KanbanColumn, KanbanRow, KanbanStack with card identity tracking via kid field
- Merge System: 3-way merge at card level using kid markers, conflict detection, auto-merge for non-conflicting changes, conservative approach (keeps user work when externally deleted)
- CRDT Bridge: Loro-based CRDT (v1.10) with diff-based minimal operations, undo/redo via UndoManager, .md.crdt file persistence
- Storage: BoardStorage trait with LocalStorage impl - atomic writes (tmp+fsync+rename), SHA-256 based self-write suppression, include file tracking via bidirectional IncludeMap
- Search: Advanced query language with hash tags (#), temporal tags (@), metadata (is:open), due filters, regex (/pattern/), negation, quoted phrases, German date names
- Watcher: notify-debouncer-full with 500ms debounce, parent directory watching, self-write tracker with 10s TTL
- Include: !!!include(path)!!! syntax, URL-encoded paths, slide format parser (--- separator), nested include support
- Export: Content transforms (speaker notes, HTML removal, code block preservation), presentation/document format generation
- 93+ unit tests with good coverage

### packages/lexera-backend (Tauri + Axum, ~5,887 Rust LOC + 1,330 JS LOC)
- REST API: boards, columns, cards, media upload, search, templates, export with ETag caching
- WebSocket sync: CRDT-based per-board sync with version vectors, presence tracking
- Collaboration: auth service (in-memory), invite tokens (in-memory), public rooms (in-memory), UDP LAN discovery
- SSE: events for local change notifications + log streaming
- Capture: clipboard watcher, quick capture popup with file drop
- Tray: system tray with board shortcuts, quick capture, connection settings
- Server: Axum with port fallback (5 ports), restart capability, CORS

### packages/lexera-kanban (Tauri frontend, ~14,700 JS LOC + 4,100 CSS LOC + ~700 Rust LOC)
- Kanban board UI with drag-and-drop (pointer events), card editing, WYSIWYG editor (stub), tree view
- Export pipeline: 3-phase (Extract, Transform, Output) with Marp/Pandoc integration
- Templates: frontmatter parsing, variable substitution, template management
- Live sync: WebSocket CRDT sync with reconnection, undo/redo (JSON-based full state copy)
- API client: HTTP discovery, REST client, WebSocket sync, SSE events/logs

### packages/lexera-capture-ios (Tauri iOS, ~609 Rust LOC + 880 HTML LOC + 130 Swift LOC)
- iOS Share Sheet extension for text, URL, and image capture (JPEG base64)
- App Group container for data sharing between main app and extension
- IosStorage: BoardStorage trait impl with RwLock<HashMap> cache, atomic file writes
- Default Inbox board auto-creation, pending share queue processing
- 4-page SPA: Capture, Search, Boards, Settings
- 6 unit tests

────────────────────────────────────────────────────────────────────────────────

## Critical Code Quality Issues

### ~~CRDT Bridge Unwraps (lexera-core, 41+ instances)~~ FIXED
- ~~Location: crdt/bridge.rs - all Loro operations use .unwrap()~~
- Fixed: Result propagation with loro_err helper (commit f41165c8)

### ~~iOS Storage RwLock Poisoning (lexera-capture-ios, 12 instances)~~ FIXED
- ~~Location: ios_storage.rs - all .read().unwrap() and .write().unwrap() calls~~
- Fixed: unwrap_or_else(|p| p.into_inner()) with log::warn (commit 4f67f5ce)

### ~~Backend CORS Allow::Any (lexera-backend)~~ FIXED
- ~~Location: server.rs line 20~~
- Fixed: Localhost-only CORS predicate (commit f41165c8)

### Monolithic app.js (lexera-kanban, ~15,000 lines)
- Single file handles cards, boards, UI, sync, drag-drop, export, search, settings
- 50+ global mutable variables, 273 DOM queries
- Impact: untestable, unmaintainable, high cognitive load
- Fix: split into 8+ modules (boardManager, cardManager, dragDrop, sync, ui, keyboard, sidebar, analytics)
- Note: api.rs backend equivalent was split into 7 modules (commit 29dd0730)

### No Test Coverage in Frontend (lexera-kanban)
- Zero test files for any JavaScript code
- No test framework configured
- All testing is manual

### Undo/Redo Memory Issue (lexera-kanban)
- Uses JSON.stringify of full board state per action (MAX 100 entries)
- With 1000 cards: ~500KB per entry = up to 50MB memory
- Fix: implement delta-based undo or leverage CRDT undo

────────────────────────────────────────────────────────────────────────────────

## Security Issues

### No Authentication (lexera-backend)
- Only authorization (role checks), no actual authentication mechanism
- Uses ?user= query param for identity
- ~~All collab services in-memory only (lost on restart)~~ FIXED: JSON persistence (commit dd760315)

### ~~Path Traversal Incomplete (lexera-backend, api.rs)~~ FIXED
- ~~Line 1026: checks for ".." and "/" but misses "./" and URL encoding~~
- Fixed: has_path_traversal() with percent-decoding (commit f41165c8)

### CSP Too Permissive
- Both kanban and capture-ios allow 'unsafe-inline' for scripts
- Backend tauri.conf.json also uses unsafe-inline

### No TLS
- All connections unencrypted
- WebSocket sync sends CRDT updates in plaintext
- Discovery broadcasts on UDP without authentication

### No Rate Limiting (lexera-backend)
- Expensive operations (search, find-file, export) have no throttling
- WebSocket channels have no backpressure handling

────────────────────────────────────────────────────────────────────────────────

## Technical Debt by Package

### lexera-core
1. ~~41+ unwrap() calls in crdt/bridge.rs~~ FIXED (commit f41165c8)
2. ~~No include file cycle detection~~ FIXED (commit e84fb78f)
3. Dual parser paths (legacy vs new format) - maintenance burden, 2x test cases
4. CRDT metadata limitation: YAML header, footer, settings stored outside CRDT (Phase 1 known limitation)
5. Merge ignores card reordering within columns - only tracks content/checked/column changes
6. Include files merged as atomic chunks, not card-level - concurrent edits cause full conflict
7. ~~Search uses ASCII case sensitivity, no Unicode/accent normalization~~ FIXED: unicode-normalization crate (commit a984c536)
8. ~~has_structural_mismatch() may false-trigger on implicit Default rows/stacks~~ FIXED: normalize defaults (commit 70813a75)
9. No CRDT corruption recovery tests
10. No concurrent access tests for storage

### lexera-backend
1. ~~api.rs at 1,622 lines needs decomposition~~ FIXED: split into 7 modules (commit 29dd0730)
2. ~~Duplicate path resolution logic (resolve_board_file, serve_media, file_info)~~ FIXED: centralized in api/mod.rs
3. ~~All collab services volatile~~ FIXED: JSON persistence (commit dd760315)
4. ~~Mix of std::sync::Mutex and tokio::sync::Mutex - lock ordering not documented~~ FIXED: documented in state.rs (commit f2ae0c78)
5. ~~Synchronous file I/O (std::fs) in async context instead of tokio::fs~~ FIXED: tokio::fs + spawn_blocking (commit 5a3afcec)
6. ~~No graceful shutdown - background tasks never explicitly cancelled~~ FIXED: watch shutdown signal (commit 44ee5951)
7. SSE keep-alive hardcoded 30s, WebSocket timeout hardcoded 10s
8. Hardcoded discovery port (41820), broadcast only (no multicast for subnets)
9. capture.rs uses macOS-only AppleScript, no cross-platform alternative
10. ~~Temp files in /tmp not cleaned up on error (capture.rs)~~ FIXED: all error paths clean up
11. ~~BoardSettings merge verbose - 17 manual field assignments~~ FIXED: merge_from() with macro (commit afae724d)
12. Frontend JS: global mutable state, fetch without timeout, poll-based updates (10s/5s)
13. ~~No input validation on board IDs or column indices~~ FIXED: validate_board_id() (commit 8fb26d1e)
14. Excessive cloning in auth.rs and invite.rs

### lexera-kanban
1. Monolithic app.js (14,700 lines) - needs modularization
2. WYSIWYG editor is a stub (58 lines, console.log noop)
3. No test coverage at all
4. Undo/redo serializes full board state (memory explosion risk)
5. ~~14 !important declarations in CSS (specificity issues)~~ FIXED: reduced to 7, all override JS inline drag styles
6. ~~18+ console.error/console.log left as debug output~~ FIXED in app.js+api.js+exportUI.js (commits 73dc9c93, 1d1cad78)
7. ~~No error boundaries on event handlers - single error crashes entire feature~~ FIXED: 15 try/catch wrappers (commit 903a40a3)
8. ~~Memory leak: addEventListener without cleanup~~ FIXED: showHtmlMenu click-outside leak (commit 9553c202); card editors use DOM replacement for cleanup
9. Export tree re-renders entire tree on single node toggle
10. Implicit script load order dependency (no ES6 modules)
11. ~~No input validation in export dialog (path traversal possible)~~ FIXED: whitelist sanitization in exportUI.js
12. Template variable substitution has no type checking, fails silently
13. ~~WebSocket reconnection: fixed 1.5s interval~~ FIXED: exponential backoff (commit 39f0efe6)
14. 273 uncached DOM queries (querySelector/getElementById)
15. No virtual scrolling for large boards
16. Export pipeline has no rollback on partial failure

### lexera-capture-ios
1. ~~12 RwLock .unwrap() calls~~ FIXED: poisoning recovery (commit 4f67f5ce)
2. ~~Silent file I/O failures in scan_boards() and process_pending()~~ FIXED: error logging (commit 4f67f5ce)
3. ~~Startup panics with .expect() - no graceful fallback~~ FIXED: graceful error handling (commit ee3dd8a2)
4. write_board() returns Ok(None) - merge infrastructure unused
5. No board deletion/card editing commands
6. No data encryption in App Group container
7. Base64 images in JSON could exhaust memory for large images
8. ~~Race condition window between lock releases in write_board_file()~~ FIXED: single write lock scope (commit fe63b8fa)
9. ~~Unused `base64` dependency in Cargo.toml~~ FIXED (commit 4f67f5ce)
10. Monolithic 880-line index.html with inline JS
11. No search result navigation (can't click to go to result)
12. No schema versioning for board format

────────────────────────────────────────────────────────────────────────────────

## Recommendations - What to Work On Next

### ~~Priority 1: Phase 1 - Persistence Layer~~ DONE (commit dd760315)

~~Why: All collaboration features are currently in-memory and lost on restart.~~

Completed:
1. ~~auth.json for user/membership persistence~~
2. ~~invites.json for invite tracking~~
3. ~~public_rooms.json for public room settings~~
4. ~~60s periodic auto-save + atomic writes~~

Remaining: Add collab config to sync.json (collab.enabled, collab.listen_address, etc.)

────────────────────────────────────────────────────────────────────────────────

### Priority 2: Phase 2 - Authentication & Security (partially done)

Why: Currently uses ?user= query param - completely insecure. Must fix before any network exposure.

Tasks:
1. Implement JWT or opaque session token system
2. Add Authorization: Bearer <token> header requirement to all API routes
3. Generate self-signed TLS cert on first run (or accept user-provided)
4. Convert invite tokens to one-time auth bootstrap tokens
5. ~~Fix CORS to specific origins (not Allow::Any)~~ DONE (commit f41165c8)
6. ~~Complete path traversal prevention (handle ./ and URL encoding)~~ DONE (commit f41165c8)
7. ~~Add rate limiting on expensive operations~~ DONE: sliding-window limiter (commit 72f073a4)

Impact: Security foundation, enables safe network testing

────────────────────────────────────────────────────────────────────────────────

### ~~Priority 3: CRDT Error Handling Hardening~~ MOSTLY DONE

~~Why: 41+ unwrap() calls in crdt/bridge.rs and 12 in ios_storage.rs can cause silent crashes.~~

Completed:
1. ~~Replace unwrap() in crdt/bridge.rs~~ DONE (commit f41165c8)
2. ~~Replace RwLock unwrap() in ios_storage.rs~~ DONE (commit 4f67f5ce)
4. ~~Add include file cycle detection~~ DONE (commit e84fb78f)

Remaining:
3. CRDT corruption recovery already implemented (LocalStorage::import_crdt_updates rebuilds from .md on error)
5. Add concurrent access tests for storage

────────────────────────────────────────────────────────────────────────────────

### Priority 4: Phase 3 - WebSocket Sync Protocol (partially done)

Why: Real collaboration needs robust bidirectional communication.

Completed:
1. ~~Add exponential backoff to WebSocket reconnection~~ DONE (commit 39f0efe6)
2. ~~Add idle timeout detection~~ DONE: 30s server-side Ping keepalive (commit 39f0efe6)
- ~~Per-card editing presence via WebSocket~~ DONE (commit 8eb60846)

Remaining:
3. ~~Add backpressure handling to sync channels~~ DONE: bounded channels with try_send (commit 7c6cd2ae)
4. Implement per-board subscriptions properly
5. ~~Add version catch-up on reconnect (client sends last known VV)~~ DONE: VV protocol in ClientHello/ServerHello

Impact: Core value proposition - real-time collaboration

────────────────────────────────────────────────────────────────────────────────

### Priority 5: Frontend Modularization (lexera-kanban)

Why: 14,700-line app.js is untestable and unmaintainable. This blocks all frontend quality improvements.

Tasks:
1. Split app.js into modules: boardManager, cardManager, dragDrop, sync, ui, keyboard, sidebar
2. Encapsulate 50+ global variables into classes/closures
3. Implement ES6 modules or bundler (replace implicit script load order)
4. ~~Add error boundaries to all event handlers~~ DONE: 15 try/catch wrappers (commit 903a40a3)
5. Replace JSON.stringify undo/redo with delta-based approach
6. Cache frequently used DOM queries

Impact: Enables testing, reduces bugs, improves maintainability

────────────────────────────────────────────────────────────────────────────────

### Priority 6: CRDT Integration Enhancement

Why: CRDT exists but could be more robust for edge cases.

Tasks:
1. Add vector clock support (currently uses monotonic counter)
2. Improve structural change handling in sync_column_structure
3. Add conflict resolution strategies beyond last-write-wins
4. Test concurrent edits from multiple peers
5. Move YAML/settings into CRDT for collaborative consistency

Impact: Better merge quality, fewer conflicts

────────────────────────────────────────────────────────────────────────────────

### Priority 7: Include File Sync

Why: Include files are tracked but not synced between peers.

Tasks:
1. Extend WebSocket protocol to include slide file updates
2. Add hash-based dedup for include content (like media)
3. Implement on-demand pull for missing includes
4. Implement card-level merge for include files (not atomic chunks)

Impact: Complete board sync experience

────────────────────────────────────────────────────────────────────────────────

### Priority 8: UI - Drag-and-Drop Stability Fix (analysis complete)

Why: Affects UX significantly. User confirmed DnD is a core functionality.

Analysis: Deep review revealed that layout locking (`dragLayoutLocks`, `lockBoardLayoutForDrag`/`unlockBoardLayoutForDrag`) and flex reflow prevention are already implemented. The existing pointer-based DnD system has two parallel systems (cardDrag for cards, ptrDrag for rows/stacks/columns) with safety nets (blur, visibility change handlers).

Remaining:
1. ~~Lock container dimensions during drag~~ Already implemented via dragLayoutLocks
2. Add fixed-size drop zones (left, right, between stacks)
3. ~~Prevent flex reflow during drag~~ Already implemented
4. ~~Visual-only feedback (opacity, box-shadow)~~ Already implemented
5. Add error boundaries to drag event handlers
6. Fix event listener memory leaks (addEventListener without cleanup)

Impact: Better user experience, fewer accidental layout changes

────────────────────────────────────────────────────────────────────────────────

### Priority 9: Complete WYSIWYG Editor (DEFERRED)

Why: Currently a 58-line stub (console.log noop) but exposed in UI. Users see a non-functional feature.
Status: User decided to defer this feature for later.

Tasks:
1. Implement actual rich text editing for card content
2. Support markdown rendering and editing toggle
3. Integrate with card save flow

Impact: Core editing experience improvement

────────────────────────────────────────────────────────────────────────────────

### Priority 10: iOS Capture Hardening (partially done)

Why: Functional MVP but has stability and data integrity risks.

Completed:
1. ~~Fix RwLock poisoning handling (12 instances)~~ DONE (commit 4f67f5ce)
2. ~~Add file I/O error propagation~~ DONE (commit 4f67f5ce)
6. ~~Remove unused base64 dependency~~ DONE (commit 4f67f5ce)

Remaining:
3. Implement card editing/deletion
4. Enable merge infrastructure (currently returns Ok(None))
5. Add search result navigation

Impact: Production-ready iOS capture

────────────────────────────────────────────────────────────────────────────────

### Priority 11: Split View Feature

Why: Nice-to-have productivity feature for comparing boards.

Tasks:
1. Add vertical/horizontal split pane UI
2. Each pane has independent board selection
3. Sync state per-pane (not shared)

Impact: Enhanced productivity, multi-board workflows

────────────────────────────────────────────────────────────────────────────────

### Priority 12: Plugin Architecture (from GLM5 analysis)

Why: Export is hardcoded to Marp/Pandoc, API endpoints require modifying api/mod.rs, and markdown rendering has hardcoded handlers. Plugin interfaces enable extensibility without core changes.

Tasks:
1. Export Plugin Registry - ExporterPlugin interface with name, formats[], export(), preview(), checkAvailable() methods; refactor ExportService to use registry; built-in plugins: MarpPlugin, PandocPlugin, MarkdownPlugin
2. Backend API Extension Points - ApiPlugin trait with name(), routes(), on_load() methods; ApiPluginRegistry to compose routers; refactor existing endpoints into built-in plugins (BoardApiPlugin, MediaApiPlugin, SearchApiPlugin, CollabApiPlugin)
3. Content Renderer Plugins - ContentRendererPlugin interface with canRender(), render(), priority; RendererRegistry with priority-based dispatch; built-in: ImageRenderer, LinkRenderer, EmbedRenderer, MermaidRenderer, PlantUmlRenderer, CodeRenderer
4. Plugin configuration file (~/.config/lexera/plugins.json) for discovery and enable/disable

Impact: Enables third-party exporters, integrations, and custom content types without core changes

────────────────────────────────────────────────────────────────────────────────

### Priority 13: Testing Infrastructure (from GLM5 analysis)

Why: Zero frontend test coverage and zero backend integration tests. Need concrete framework setup, not just identification of the gap.

Tasks:
1. Frontend: add Jest or Vitest + happy-dom/jsdom for DOM testing; create test utilities for mocking Tauri APIs; target api.js 80%, exportService.js 70%, utility modules 80%
2. Backend: add axum_test for integration tests; test board CRUD, collaboration flows, WebSocket sync; create test state helpers (create_test_state pattern)

Impact: Enables safe refactoring and regression prevention across both frontend and backend

────────────────────────────────────────────────────────────────────────────────

## Code Metrics Summary

| Package | Rust LOC | JS LOC | CSS LOC | Tests | Rating |
|---------|----------|--------|---------|-------|--------|
| lexera-core | ~9,925 | - | - | 93+ | Good |
| lexera-backend | ~5,887 | ~1,330 | ~200 | 0 | Medium |
| lexera-kanban | ~700 | ~17,000 | ~4,100 | 0 | Needs Work |
| lexera-capture-ios | ~609 | ~320 | ~200 | 6 | Medium |
| **Total** | **~17,121** | **~18,650** | **~4,500** | **99+** | - |

## Quality Ratings (updated after fixes)

| Aspect | Core | Backend | Kanban | iOS |
|--------|------|---------|--------|-----|
| Architecture | 4/5 | 4/5 (+1: api split, persistence) | 2/5 | 3/5 |
| Code Quality | 4/5 (+: Result propagation) | 3/5 | 2/5 | 3/5 (+: RwLock fix) |
| Testing | 4/5 (+: cycle detection tests) | 1/5 | 1/5 | 2/5 |
| Error Handling | 4/5 (+1: CRDT bridge) | 2/5 | 2/5 | 3/5 (+1: I/O logging) |
| Security | 3/5 | 2/5 (+1: CORS, path traversal) | 2/5 | 2/5 |
| Maintainability | 3/5 | 3/5 (+1: api modules) | 1/5 | 3/5 |
| API Design | 4/5 | 3/5 | 3/5 | 3/5 |
| Collaboration | 4/5 (CRDT) | 4/5 (presence, persistence) | 3/5 (presence UI) | - |
