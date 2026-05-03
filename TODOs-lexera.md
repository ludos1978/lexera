## Workflow

Work on the tasks below. For each: fix, add tests, verify with `run-lexera-tests.sh`. Move completed items to [todo-archive.md](todo-archive.md). Check general architecture and improve it. If performance drops, prioritize performance work.

Keep this file structured and clean:
- Only open and in-progress items live here. Completed items go to [todo-archive.md](todo-archive.md).
- Group tasks under the appropriate `###` section. Don't add tasks as loose items outside a section.
- One task per line. Keep descriptions concise — details belong in code comments or commit messages.
- Update the test status line below after each test run.

To mark a task in progress add (in progess) at the start of the task (just after the - [ ])
To mark a task done add (done) at the start of the task and mark the task done (- [x])
To mark a task with input required add (input required) at the start of the task!

Generally do the most time consuming tasks first. If a task takes very long to complete, start it early to finish early, DO NOT DELAY LONG TASKS!

## Open Tasks

### Multi-Window Structural Improvements


- [x] (done) board title MUST be the same on every surface (board pane, workspace tabs, workspaces sub-app, hierarchy sub-app). Single canonical resolver in `LexeraTitleHelpers.resolveBoardLabel`; priority: parsed H1 → filename basename sans `.md` → legacy `name` → `Untitled`. (commit fc094e72)

- [ ] (input required) the log viewer is invisible in the folded state! — what does "invisible" look like? The fold strip is rendered with status badges (`renderFoldStrip` in `lexera-kanban/src/workspace/workspaceShell.js:891`), and the panel's tabset/split/node content is intentionally hidden by `.workspace-shell-panel-dock.is-folded > .workspace-shell-tabset` (workspaceShell.css:404-409). Need a screenshot or repro to know if the strip is missing, the dock collapses to 0px, or something else.

- [x] (done) the kanban boards in the workspace viewer must be unfoldable and show the title of each element. it the elements (row, stack, column, cards) must be re-orderable, can be dragged between boards in the workspace and also into kanban boards, it must also be possible to drag elements from kanban boards into the workspace hierarchy! (Phases 1-4 below; cross-webview drag between the kanban-board iframe and the workspace tree still needs a separate IPC drag protocol — see follow-up sub-item.)
  - [x] (done) Phase 1 — workspaces sub-app: caret per board, lazy `getBoardHierarchy` fetch, nested row/stack/column/card titles. (commit a5c602f2)
  - [x] (done) Phase 1b — same caret + nested render in the hierarchy sub-app. (commit 4daff0fc)
  - [x] (done) Phase 1c — both sub-apps render the unfolded subtree through the shared TreeView (treeView.js) so the layout matches the dashboard / files panel / main board sidebar. (commit 14f0cfdb)
  - [x] (done) Phase 1d — boards are the TreeView roots; the `.board-item / .board-caret / .board-subtree` shim is gone, the workspace name lives in the panel header, and a single `data-tree-target="board"` node carries the toggle, click, and active highlight. (commit 7bd0e9f8)
  - [x] (done) Phase 1e — polish: drop "Workspace tree" section title, `(N)` count and connecting/connected pill from the panel chrome (commit 27086cea); wire row/stack/column toggles through `TreeView.toggleNode` so they fold in-place (commit ec100017); drop the phantom board-level indent guide on every descendant of a board (commit 2646d014).
  - [x] (done) Phase 2 — re-order rows / stacks / columns / cards within a single board via drag. (sub-phases 2a/2b-1/2b-2-a..d all shipped)
    - [x] (done) Phase 2a — visual: row/stack/column/card nodes carry the canonical TreeView drag grip + per-type `gripTitle`. (commit 376826c6)
    - [x] (done) Phase 2b-1 — entity nodes carry `draggable="true"` + `data-drag-kind` + `data-drag-board-id`; browser fires native dragstart events. Drop side still TODO. (commit a4838b3b)
    - [x] (done) Phase 2b-2-a — dragstart listener stamps `{ boardId, kind, entityId }` into DataTransfer + broadcasts `hierarchy-entity-drag-start` for shell-side handlers. (commit d2d4d8a4)
    - [x] (done) Phase 2b-2-b — dragover marks same-board same-kind sibling as `.is-drop-target`; drop fires `hierarchy-entity-drop` broadcast with `{ source, target }`. Cross-kind/cross-board drops silently rejected (deferred to Phases 3 & 4). (commit df879111)
    - [x] (done) Phase 2b-2-c — `hierarchyDragBridge.js`: pure `applyEntityReorder(board, source, target)` helper + dependency-injected `install()` IPC consumer that subscribes to `hierarchy-entity-drop`, loads the board, applies the reorder, persists via `saveBoard`. (commit 005917f8)
    - [x] (done) Phase 2b-2-d — bridge wired into `index.html` + multiviewClient bootstrap; `loadBoard = api.getBoardColumns(id).fullBoard`, `saveBoard = api.saveBoard`, and `onApplied` rebroadcasts the catalog. Source-level contract test pins the wiring. (commit 1ca1a2ef)
  - [x] (done) Phase 3 — cross-board same-kind drops accepted in both sub-apps; shell bridge gains `applyCrossBoardEntityReorder` + cross-board install path that loads + saves both boards. (commit e7fe6352)
  - [x] (done) Phase 4 — cross-kind absorb drops within the workspace tree (card → column, column → stack, stack → row); same-board path wired in install. (commit b756c259)
  - [ ] Phase 5 — cross-webview drag between the kanban-board iframe and the workspace tree. Native HTML5 drag does not cross document boundaries; needs an IPC drag protocol (e.g. source webview emits pointer-track events; shell coordinates which webview the cursor is over and dispatches a synthetic drop on release).

- [x] (done) analyze the whole application structure. detect the used architectural code structures and check if they fit the puprpose. analyze if the code strcture could be improved by restructuring and cleanup. keep the code as simple as needed while making sure it's fulfills all requirements! verify that we apply coding structure rules.

## Architectural Analysis and Recommendations

### 1. Frontend Modernization & Tooling
- [ ] Initialize NPM workspaces in the root `package.json` to include `lexera-kanban`, `lexera-backend`, and `lexera-shared`.
- [ ] Configure `esbuild` in `lexera-kanban` to bundle the application, starting with an entry point that replaces the 100+ script tags in `index.html`.
- [ ] Convert `lexera-kanban/src/core/moduleRuntime.js` to an ES Module and remove its dependency on `window.LexeraRuntime`.
- [ ] Convert `lexera-kanban/src/api.js` to an ES Module, exporting a singleton `LexeraApi` instance.
- [ ] Convert `lexera-kanban/src/utils/pathUtils.js` to an ES Module.
- [ ] Port all `lexera-kanban/src/vendor/` libraries to be managed via `npm` dependencies in `package.json` where possible.

### 2. Large File Decomposition
- [ ] Split the 12,000-line `lexera-kanban/src/app.js` into focused modules: `src/board/boardController.js`, `src/shell/uiEvents.js`, and `src/core/appState.js`.
- [ ] Extract the `ManagementUI` field definitions from `lexera-shared/management.js` (lines 20-55) into a separate `config/fields.js` file.
- [ ] Decompose `lexera-shared/management.js` by moving the log viewer logic into `src/management/logViewer.js`.
- [ ] Split `lexera-kanban/src/wysiwyg-editor.js` into `src/editor/markdownEngine.js` and `src/editor/uiHandlers.js`.

### 3. Structural & Workspace Improvements
- [ ] Move `lexera-shared/` into `packages/shared-ui` and define it as a proper internal NPM package.
- [ ] Extract the geometry observation logic from `lexera-kanban/src/workspace/workspaceShell.js` into a dedicated `src/workspace/geometryObserver.js`.
- [ ] Refactor `lexera-kanban/src/shell/multiviewClient.js` to use the new `lexera-local-ipc` protocol exclusively, removing legacy HTTP fallback logic.
- [x] (done) Move the bridge modules (theme, catalog, management, navigation, embeddedBoard, request) into `src/shell/bridges/`. (commit 3bb6afae)

### 4. Cleanup & Technical Debt
- [ ] Remove `lexera-shared/backendDiscovery.js` once the IPC migration (Phase 7) is fully verified as the default transport.
- [ ] Replace all direct `window` property assignments in `src/plugins/` with explicit ESM exports.
- [ ] Standardize the IIFE-to-ESM conversion for all files in `lexera-kanban/src/plugins/formats/`.
- [x] (done) Audit `tokens.css` for unused vars. Only `--font-size-l` has zero direct `var(--font-size-l)` consumers, but it is still broadcast via `shell/bridges/themeBridge.js` as part of the documented v2 type scale and kept intentionally. No deprecation residue found.

## Rust Backend Refactoring

### 1. Crate & Workspace Refinement
- [ ] Move the export logic from `lexera-backend/src-tauri/src/export_api.rs` into a new `lexera-export` workspace crate to decouple it from the Tauri app.
- [ ] Move the collaboration logic from `lexera-backend/src-tauri/src/collab_api.rs` and `sync_ws.rs` into a new `lexera-collab` workspace crate.
- [ ] Refactor `lexera-core/src/parser.rs` to reduce its size (70k bytes) by extracting list and table parsing into sub-modules.
- [ ] Standardize error types across the workspace using `thiserror`, creating a shared `lexera-error` crate if necessary for consistent IPC propagation.

### 2. IPC & Protocol Completion
- [ ] Implement the `Cancel` frame propagation in `lexera-local-ipc` to allow the frontend to abort long-running backend tasks (e.g., large exports or uploads).
- [ ] Complete Phase 4 of the IPC migration by migrating all remaining file/media reads and preview renders to the `lexera-asset` protocol.
- [ ] Verify the Windows-specific peer-credential and ACL implementation in `lexera-local-ipc/src/windows_security.rs` on a real Windows host.
- [ ] Replace the manual SSE/WebSocket bridging in `lexera-backend` with the native `lexera-local-ipc` stream adapters.

### 3. Concurrency & Performance
- [x] (done) Audit the usage of `Arc<std::sync::Mutex>` in `lexera-backend/src-tauri/src/lib.rs` and identify candidates for `RwLock` or actor-based state management to reduce lock contention. Inventory (lock sites / write sites): `auth_service` 32/~10 (validate_token + get_user dominate, registers + updates rare), `invite_service` 10/few, `public_service` 6/low, `config` 35/~10, `discovery` 2, `live_port` 5, `server_shutdown` 2. Strongest **RwLock candidates**: `auth_service` and `config` — both read-dominant and hot on the request path. `discovery` / `live_port` / `server_shutdown` are tiny surfaces and stay on Mutex. Conversion is mechanical (8 files for `auth_service`, similar for `config`) but wide enough to warrant its own atomic commits — broken out as follow-ups below.
  - [x] (done) Convert `Arc<Mutex<AuthService>>` → `Arc<RwLock<AuthService>>`. Reused the `read_arc` / `write_arc` helpers from the SyncConfig conversion. Touched 8 files: `collab_api.rs`, `ipc_stream.rs`, `sync_ws.rs`, `ipc_sync.rs`, `api/auth_middleware.rs`, `lib.rs`, `state.rs`, `test_helpers.rs`. Read/write classified by method called (validate_token / get_user / is_member / save_to_file → read; register_user / update_user / add_to_room / remove_from_room → write). 281 backend tests green. (commit 1e517342)
  - [x] (done) Convert `Arc<Mutex<SyncConfig>>` → `Arc<RwLock<SyncConfig>>` with the same read/write split. Added `read_arc` / `write_arc` helpers in `collab_api.rs` parallel to `lock_arc`; classified all 35 sites by `let cfg` vs `let mut cfg`; touched 11 files. 281 backend tests green. (commit fbf70fb2)
- [ ] Optimize the board loading process in `init_storage_and_boards` to use a more granular batching strategy if the number of boards exceeds 100.
- [ ] Implement a background task for periodic `loro` CRDT compaction to prevent state growth over time.

### 4. Modularization & Cleanup
- [ ] Split `lexera-backend/src-tauri/src/sync_client.rs` (48k bytes) into focused modules: `connection_mgr.rs`, `replication.rs`, and `conflict_resolver.rs`.
- [ ] Decompose `lexera-backend/src-tauri/src/config.rs` (34k bytes) by extracting identity and workspace management into separate files.
- [ ] Remove unused dependencies from `lexera-core/Cargo.toml` and `lexera-backend/src-tauri/Cargo.toml` after the ESM/IPC migrations are complete.

## IPC Refactoring & Migration

### 1. Protocol Enhancements
- [x] (done) Implement `ClientFrame::Cancel` propagation in `lexera-backend/src-tauri/src/ipc_asset.rs` to stop file streaming when the webview aborts a request. Phase 7.5 gap #8 — `tokio::select!` over file I/O + Cancel; covered by `request_cancellation_stops_stream`.
- [x] (done) Add `If-None-Match` support to `AssetRequestPayload` and implement ETag-based 304 short-circuiting in `handle_asset_request`. Backend short-circuits matching weak/strong ETags; kanban asset_protocol forwards the header. (commit 83c77122)
- [ ] Implement multi-range support in `parse_range` to match full HTTP spec parity for media seeking.
- [x] (done) Add a `KeepAlive` heartbeat frame to the protocol to detect dead connections in the absence of active traffic. Audit found `ClientFrame::Ping` / `ServerFrame::Pong` already present (server-side handling in `ipc_server.rs:112` and inside the asset stream multiplex). Added `Client::ping(timeout)` helper so callers can probe liveness with a one-shot timed roundtrip; covers the silent-server case via `IpcError::Timeout`. (commit 13bbed9b)

### 2. Security & Platform Parity
- [ ] Run the `lexera-local-ipc` test suite on Windows to verify `SetFileSecurityW` and `GetNamedPipeClientProcessId` behavior.
- [x] (done) Implement `SO_PEERCRED` validation on Linux and `getpeereid` on macOS in `lexera-local-ipc` to enforce same-user-only connections. `transport/unix.rs::Listener::accept` calls `stream.peer_cred()` (tokio wraps SO_PEERCRED / getpeereid) and rejects mismatches as `IpcError::CrossUser`. Test `peer_uid_matches_own_uid_for_local_connection`.
- [x] (done) Audit the `ipc.json` descriptor file permissions on all platforms to ensure it is strictly `0600` (user-only). Unix already wrote with `mode(0o600)`; added a fail-closed post-rename verifier and tests for rename-over-existing + wide-umask. Windows DACL path remains best-effort (logs+continues) by design. (commit ad222388)
- [x] (done) Implement an OS-native "wait for file" watcher in `lexera-kanban` (using `notify`) to avoid polling for the backend descriptor. Implemented as Phase 7.5 gap #4 in `lexera-kanban/src-tauri/src/backend_status.rs` — `notify::RecommendedWatcher` on the descriptor parent dir, debounce + `same_status` dedupe, emits the `backend-status` Tauri event.

### 3. Migration & Integration
- [ ] (input required) Migrate the `/collab/me` endpoint to a sentinel local identity response in IPC mode (no bearer token needed). — design decision needed: the cleanest split is (1) inject a transport marker (`x-lexera-transport: ipc`) into the dispatch path, (2) have `require_authenticated_user` accept the marker as proof-of-identity, (3) update `/collab/me` to omit the bearer in the response, (4) update the frontend to skip the Authorization header when the marker is present. That's 4 atomic commits across `ipc_dispatch.rs`, `collab_api.rs`, the auth middleware, and `lexera-shared/management.js`. Should I proceed with that split, or do you have a different shape in mind?
- [x] (done) Complete the "Gap #7" Tauri capability audit: move from wildcard window permissions to explicit per-window permission lists in `default.json`. Replaced `["*"]` with `["main", "kanban-*", "drag-ghost", "board-tab-*", "panel-tab-*"]`. Pinned by `tauriCapabilityWindowAllowlistContract.test.js`. Backend + capture apps were already explicit; `lexera-ipc-bridge.json` was already scoped to `["main"]`. Smoke-test next launch to confirm board/panel webviews still receive `core:default` after the wildcard removal. (commit 3fa51695)
- [ ] (in progess) Implement the `backend-status` Tauri event watcher in the frontend to show a native "Connecting to backend..." UI during startup. Bridge implemented at `lexera-kanban/src/shell/bridges/backendStatusBridge.js` (commit e89c06d0); awaits visual verification — kill the backend during kanban startup and confirm the top-right pill shows "Connecting to backend…" → disappears when backend reconnects.
- [ ] Finalize the "Phase 7" removal of the HTTP fallback path from the desktop production build.

## Open Tasks
