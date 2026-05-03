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

- [ ] the log viewer is invisible in the folded state!

- [ ] the kanban boards in the workspace viewer must be unfoldable and show the title of each element. it the elements (row, stack, column, cards) must be re-orderable, can be dragged between boards in the workspace and also into kanban boards, it must also be possible to drag elements from kanban boards into the workspace hierarchy!
  - [x] (done) Phase 1 — workspaces sub-app: caret per board, lazy `getBoardHierarchy` fetch, nested row/stack/column/card titles. (commit a5c602f2)
  - [x] (done) Phase 1b — same caret + nested render in the hierarchy sub-app. (commit 4daff0fc)
  - [x] (done) Phase 1c — both sub-apps render the unfolded subtree through the shared TreeView (treeView.js) so the layout matches the dashboard / files panel / main board sidebar. (commit 14f0cfdb)
  - [x] (done) Phase 1d — boards are the TreeView roots; the `.board-item / .board-caret / .board-subtree` shim is gone, the workspace name lives in the panel header, and a single `data-tree-target="board"` node carries the toggle, click, and active highlight. (commit 7bd0e9f8)
  - [x] (done) Phase 1e — polish: drop "Workspace tree" section title, `(N)` count and connecting/connected pill from the panel chrome (commit 27086cea); wire row/stack/column toggles through `TreeView.toggleNode` so they fold in-place (commit ec100017); drop the phantom board-level indent guide on every descendant of a board (commit 2646d014).
  - [ ] Phase 2 — re-order rows / stacks / columns / cards within a single board via drag. — in progress
  - [ ] Phase 3 — drag elements between boards in the workspace tree.
  - [ ] Phase 4 — drag elements from a kanban board into the workspace tree (and back).

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
- [ ] Audit the usage of `Arc<std::sync::Mutex>` in `lexera-backend/src-tauri/src/lib.rs` and identify candidates for `RwLock` or actor-based state management to reduce lock contention.
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
- [ ] Add a `KeepAlive` heartbeat frame to the protocol to detect dead connections in the absence of active traffic.

### 2. Security & Platform Parity
- [ ] Run the `lexera-local-ipc` test suite on Windows to verify `SetFileSecurityW` and `GetNamedPipeClientProcessId` behavior.
- [x] (done) Implement `SO_PEERCRED` validation on Linux and `getpeereid` on macOS in `lexera-local-ipc` to enforce same-user-only connections. `transport/unix.rs::Listener::accept` calls `stream.peer_cred()` (tokio wraps SO_PEERCRED / getpeereid) and rejects mismatches as `IpcError::CrossUser`. Test `peer_uid_matches_own_uid_for_local_connection`.
- [x] (done) Audit the `ipc.json` descriptor file permissions on all platforms to ensure it is strictly `0600` (user-only). Unix already wrote with `mode(0o600)`; added a fail-closed post-rename verifier and tests for rename-over-existing + wide-umask. Windows DACL path remains best-effort (logs+continues) by design. (commit ad222388)
- [x] (done) Implement an OS-native "wait for file" watcher in `lexera-kanban` (using `notify`) to avoid polling for the backend descriptor. Implemented as Phase 7.5 gap #4 in `lexera-kanban/src-tauri/src/backend_status.rs` — `notify::RecommendedWatcher` on the descriptor parent dir, debounce + `same_status` dedupe, emits the `backend-status` Tauri event.

### 3. Migration & Integration
- [ ] Migrate the `/collab/me` endpoint to a sentinel local identity response in IPC mode (no bearer token needed).
- [ ] Complete the "Gap #7" Tauri capability audit: move from wildcard window permissions to explicit per-window permission lists in `default.json`.
- [ ] (in progess) Implement the `backend-status` Tauri event watcher in the frontend to show a native "Connecting to backend..." UI during startup. Bridge implemented at `lexera-kanban/src/shell/bridges/backendStatusBridge.js` (commit e89c06d0); awaits visual verification — kill the backend during kanban startup and confirm the top-right pill shows "Connecting to backend…" → disappears when backend reconnects.
- [ ] Finalize the "Phase 7" removal of the HTTP fallback path from the desktop production build.

## Open Tasks
