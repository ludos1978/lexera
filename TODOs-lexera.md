Deep Analysis Summary (2026-03-01)

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

### CRDT Bridge Unwraps (lexera-core, 41+ instances)
- Location: crdt/bridge.rs - all Loro operations use .unwrap()
- Risk: silent panics if CRDT document is corrupted, no error context for debugging
- Fix: add Result propagation or at minimum log::error! before unwrap

### iOS Storage RwLock Poisoning (lexera-capture-ios, 12 instances)
- Location: ios_storage.rs - all .read().unwrap() and .write().unwrap() calls
- Risk: app crash if any thread panics while holding lock
- Fix: use unwrap_or_else(|p| p.into_inner()) or proper error handling

### Backend CORS Allow::Any (lexera-backend)
- Location: server.rs line 20
- Risk: any origin can make API requests
- Fix: restrict to specific origins or localhost

### Monolithic app.js (lexera-kanban, 14,700 lines)
- Single file handles cards, boards, UI, sync, drag-drop, export, search, settings
- 50+ global mutable variables, 273 DOM queries
- Impact: untestable, unmaintainable, high cognitive load
- Fix: split into 8+ modules (boardManager, cardManager, dragDrop, sync, ui, keyboard, sidebar, analytics)

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
- All collab services in-memory only (lost on restart)

### Path Traversal Incomplete (lexera-backend, api.rs)
- Line 1026: checks for ".." and "/" but misses "./" and URL encoding
- Media upload filename validation could be bypassed

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
1. 41+ unwrap() calls in crdt/bridge.rs - needs error handling
2. No include file cycle detection - could cause infinite recursion
3. Dual parser paths (legacy vs new format) - maintenance burden, 2x test cases
4. CRDT metadata limitation: YAML header, footer, settings stored outside CRDT (Phase 1 known limitation)
5. Merge ignores card reordering within columns - only tracks content/checked/column changes
6. Include files merged as atomic chunks, not card-level - concurrent edits cause full conflict
7. Search uses ASCII case sensitivity, no Unicode/accent normalization
8. has_structural_mismatch() may false-trigger on implicit Default rows/stacks
9. No CRDT corruption recovery tests
10. No concurrent access tests for storage

### lexera-backend
1. api.rs at 1,622 lines needs decomposition (board ops, media, templates)
2. Duplicate path resolution logic (resolve_board_file, serve_media, file_info)
3. All collab services volatile (auth, invites, public rooms lost on restart)
4. Mix of std::sync::Mutex and tokio::sync::Mutex - lock ordering not documented
5. Synchronous file I/O (std::fs) in async context instead of tokio::fs
6. No graceful shutdown - background tasks (watchers, services) never explicitly cancelled
7. SSE keep-alive hardcoded 30s, WebSocket timeout hardcoded 10s
8. Hardcoded discovery port (41820), broadcast only (no multicast for subnets)
9. capture.rs uses macOS-only AppleScript, no cross-platform alternative
10. Temp files in /tmp not cleaned up on error (capture.rs)
11. BoardSettings merge verbose - 17 manual field assignments
12. Frontend JS: global mutable state, fetch without timeout, poll-based updates (10s/5s)
13. No input validation on board IDs or column indices
14. Excessive cloning in auth.rs and invite.rs

### lexera-kanban
1. Monolithic app.js (14,700 lines) - needs modularization
2. WYSIWYG editor is a stub (58 lines, console.log noop)
3. No test coverage at all
4. Undo/redo serializes full board state (memory explosion risk)
5. 14 !important declarations in CSS (specificity issues)
6. 18+ console.error/console.log left as debug output
7. No error boundaries on event handlers - single error crashes entire feature
8. Memory leak: addEventListener without cleanup (e.g., resize handler in card editor)
9. Export tree re-renders entire tree on single node toggle
10. Implicit script load order dependency (no ES6 modules)
11. No input validation in export dialog (path traversal possible)
12. Template variable substitution has no type checking, fails silently
13. WebSocket reconnection: fixed 1.5s interval, no exponential backoff
14. 273 uncached DOM queries (querySelector/getElementById)
15. No virtual scrolling for large boards
16. Export pipeline has no rollback on partial failure

### lexera-capture-ios
1. 12 RwLock .unwrap() calls - poisoning risk
2. Silent file I/O failures in scan_boards() and process_pending()
3. Startup panics with .expect() - no graceful fallback
4. write_board() returns Ok(None) - merge infrastructure unused
5. No board deletion/card editing commands
6. No data encryption in App Group container
7. Base64 images in JSON could exhaust memory for large images
8. Race condition window between lock releases in write_board_file()
9. Unused `base64` dependency in Cargo.toml
10. Monolithic 880-line index.html with inline JS
11. No search result navigation (can't click to go to result)
12. No schema versioning for board format

────────────────────────────────────────────────────────────────────────────────

## Recommendations - What to Work On Next

### Priority 1: Phase 1 - Persistence Layer

Why: All collaboration features are currently in-memory and lost on restart. This is the foundation for everything else.

Tasks:
1. Create ~/.config/lexera/collab/auth.json for user/membership persistence
2. Create ~/.config/lexera/collab/invites.json for invite tracking
3. Create ~/.config/lexera/collab/rooms.json for public room settings
4. Add collab config to sync.json: collab.enabled, collab.listen_address, collab.discovery, collab.shared_boards

Impact: Enables real multi-user testing, prerequisite for all other phases

────────────────────────────────────────────────────────────────────────────────

### Priority 2: Phase 2 - Authentication & Security

Why: Currently uses ?user= query param - completely insecure. Must fix before any network exposure.

Tasks:
1. Implement JWT or opaque session token system
2. Add Authorization: Bearer <token> header requirement to all API routes
3. Generate self-signed TLS cert on first run (or accept user-provided)
4. Convert invite tokens to one-time auth bootstrap tokens
5. Fix CORS to specific origins (not Allow::Any)
6. Complete path traversal prevention (handle ./ and URL encoding)
7. Add rate limiting on expensive operations

Impact: Security foundation, enables safe network testing

────────────────────────────────────────────────────────────────────────────────

### Priority 3: CRDT Error Handling Hardening

Why: 41+ unwrap() calls in crdt/bridge.rs and 12 in ios_storage.rs can cause silent crashes. This is a stability risk for all platforms.

Tasks:
1. Replace unwrap() in crdt/bridge.rs with proper Result propagation or logged fallbacks
2. Replace RwLock unwrap() in ios_storage.rs with poisoning recovery
3. Add CRDT corruption recovery (rebuild from .md if .crdt is invalid)
4. Add include file cycle detection to prevent infinite recursion
5. Add concurrent access tests for storage

Impact: Stability across all platforms, prevents data loss from silent panics

────────────────────────────────────────────────────────────────────────────────

### Priority 4: Phase 3 - WebSocket Sync Protocol

Why: SSE is one-way only. Real collaboration needs bidirectional communication. WebSocket exists but needs hardening.

Tasks:
1. Add exponential backoff to WebSocket reconnection (currently fixed 1.5s)
2. Add idle timeout detection for WebSocket connections
3. Add backpressure handling to sync channels
4. Implement per-board subscriptions properly
5. Add version catch-up on reconnect (client sends last known VV)

Impact: Core value proposition - real-time collaboration

────────────────────────────────────────────────────────────────────────────────

### Priority 5: Frontend Modularization (lexera-kanban)

Why: 14,700-line app.js is untestable and unmaintainable. This blocks all frontend quality improvements.

Tasks:
1. Split app.js into modules: boardManager, cardManager, dragDrop, sync, ui, keyboard, sidebar
2. Encapsulate 50+ global variables into classes/closures
3. Implement ES6 modules or bundler (replace implicit script load order)
4. Add error boundaries to all event handlers
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

### Priority 8: UI - Drag-and-Drop Stability Fix

Why: Affects UX significantly.

Tasks:
1. Lock container dimensions during drag operations
2. Add fixed-size drop zones (left, right, between stacks)
3. Prevent flex reflow during drag
4. Visual-only feedback (opacity, box-shadow)
5. Add error boundaries to drag event handlers

Impact: Better user experience, fewer accidental layout changes

────────────────────────────────────────────────────────────────────────────────

### Priority 9: Complete WYSIWYG Editor

Why: Currently a 58-line stub (console.log noop) but exposed in UI. Users see a non-functional feature.

Tasks:
1. Implement actual rich text editing for card content
2. Support markdown rendering and editing toggle
3. Integrate with card save flow

Impact: Core editing experience improvement

────────────────────────────────────────────────────────────────────────────────

### Priority 10: iOS Capture Hardening

Why: Functional MVP but has stability and data integrity risks.

Tasks:
1. Fix RwLock poisoning handling (12 instances)
2. Add file I/O error propagation (not silent failures)
3. Implement card editing/deletion
4. Enable merge infrastructure (currently returns Ok(None))
5. Add search result navigation
6. Remove unused base64 dependency

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

## Code Metrics Summary

| Package | Rust LOC | JS LOC | CSS LOC | Tests | Rating |
|---------|----------|--------|---------|-------|--------|
| lexera-core | ~9,925 | - | - | 93+ | Good |
| lexera-backend | ~5,887 | ~1,330 | ~200 | 0 | Medium |
| lexera-kanban | ~700 | ~17,000 | ~4,100 | 0 | Needs Work |
| lexera-capture-ios | ~609 | ~320 | ~200 | 6 | Medium |
| **Total** | **~17,121** | **~18,650** | **~4,500** | **99+** | - |

## Quality Ratings

| Aspect | Core | Backend | Kanban | iOS |
|--------|------|---------|--------|-----|
| Architecture | 4/5 | 3/5 | 2/5 | 3/5 |
| Code Quality | 4/5 | 3/5 | 2/5 | 3/5 |
| Testing | 4/5 | 1/5 | 1/5 | 2/5 |
| Error Handling | 3/5 | 2/5 | 2/5 | 2/5 |
| Security | 3/5 | 1/5 | 2/5 | 2/5 |
| Maintainability | 3/5 | 2/5 | 1/5 | 3/5 |
| API Design | 4/5 | 3/5 | 3/5 | 3/5 |
