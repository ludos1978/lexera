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


- [ ] the log viewer is invisible in the folded state!

- [ ] (in progress) the kanban boards in the workspace viewer must be unfoldable and show the title of each element. it the elements (row, stack, column, cards) must be re-orderable, can be dragged between boards in the workspace and also into kanban boards, it must also be possible to drag elements from kanban boards into the workspace hierarchy! Phases 1-4 (in-process drag within one webview) shipped; Phase 5 = cross-Tauri-webview drag forwarding via IPC. Primitives committed: `getWebviewLabelAtTopPoint` (commit 71f64222), `__lexeraExternalDnd` contract pin (commit f5c2f09c). Drop-target differentiation per kind shipped: ~~zone-aware sibling reorder~~ (commit 497be502), ~~`row → board` absorb~~ (commit e1253b67), ~~stack/column absorbs only into empty parents~~ (commit 58d5b266). Next: wire the cursor-to-webview hit-test into the cross-view bridge so drags from the workspace tree forward to other webviews.

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
- [x] (done) Extract the `ManagementUI` field definitions from `lexera-shared/management.js`. Hoisted `BOARD_SETTINGS_FIELDS` out of the IIFE to module scope (data separated from the 2800-line rendering body). Pinned by `managementBoardFieldsContract.test.js`. Kept the schema in the same file rather than spinning up a new sync-script asset; if a separate `config/fields.js` is desired later, the hoist makes that move trivial. (commit 80c95d89)
- [ ] Decompose `lexera-shared/management.js` by moving the log viewer logic into `src/management/logViewer.js`.
- [ ] (input required) Split `lexera-kanban/src/wysiwyg-editor.js` into `src/editor/markdownEngine.js` and `src/editor/uiHandlers.js`. — `wysiwyg-editor.js` is a 432 KB prebuilt minified bundle (one IIFE wrapping multiple esbuild chunks). The original ProseMirror sources are in `_ARCHIVE/src/wysiwyg/*.ts`, marked OBSOLETE in CLAUDE.md. Splitting the bundle isn't possible without re-establishing a build pipeline. Need decision: (a) revive the build chain and split at source, (b) reauthor a slimmer editor in lexera-kanban directly, or (c) defer until the broader esbuild migration (line 32) lands.

### 3. Structural & Workspace Improvements
- [ ] Move `lexera-shared/` into `packages/shared-ui` and define it as a proper internal NPM package.
- [ ] Extract the geometry observation logic from `lexera-kanban/src/workspace/workspaceShell.js` into a dedicated `src/workspace/geometryObserver.js`.
- [ ] Refactor `lexera-kanban/src/shell/multiviewClient.js` to use the new `lexera-local-ipc` protocol exclusively, removing legacy HTTP fallback logic.
- [x] (done) Move the `ThemeBridge` and `CatalogBridge` from `multiviewClient.js` into their own files under `src/shell/bridges/`. Already shipped: `lexera-kanban/src/shell/bridges/themeBridge.js` and `catalogBridge.js` exist (alongside backendStatusBridge, embeddedBoardBridge, hierarchyDragBridge, managementBridge, navigationBridge, requestBridge); `multiviewClient.js:591` retains a thin wrapper that delegates to `window.LexeraThemeBridge`. (commit 3bb6afae)

### 4. Cleanup & Technical Debt
- [ ] Remove `lexera-shared/backendDiscovery.js` once the IPC migration (Phase 7) is fully verified as the default transport.
- [ ] Replace all direct `window` property assignments in `src/plugins/` with explicit ESM exports.
- [ ] Standardize the IIFE-to-ESM conversion for all files in `lexera-kanban/src/plugins/formats/`.
- [x] (done) Audit and remove unused CSS variables in `lexera-kanban/src/tokens.css` that were deprecated during the multiview migration. Audit found zero orphans: 12 of 13 declared tokens have direct `var()` consumers, and `--font-size-l` (zero direct uses) is intentionally broadcast via `shell/bridges/themeBridge.js` for sub-app webviews. No deprecation residue. Pinned by `tokensCssNoOrphansContract.test.js` — generates one assertion per declared token, fails closed on any orphan unless explicitly allowlisted with a reason. (commit 20e39b93)

## Rust Backend Refactoring

### 1. Crate & Workspace Refinement
- [ ] Move the export logic from `lexera-backend/src-tauri/src/export_api.rs` into a new `lexera-export` workspace crate to decouple it from the Tauri app.
- [ ] Move the collaboration logic from `lexera-backend/src-tauri/src/collab_api.rs` and `sync_ws.rs` into a new `lexera-collab` workspace crate.
- [ ] Refactor `lexera-core/src/parser.rs` to reduce its size (70k bytes) by extracting list and table parsing into sub-modules.
- [ ] Standardize error types across the workspace using `thiserror`, creating a shared `lexera-error` crate if necessary for consistent IPC propagation.

### 2. IPC & Protocol Completion
- [x] (done) Implement the `Cancel` frame propagation in `lexera-local-ipc` to allow the frontend to abort long-running backend tasks. (commit 63435218)
- [x] (done) Complete Phase 4 of the IPC migration by migrating all remaining file/media reads and preview renders to the `lexera-asset` protocol. Verified `api.js` helpers and `LexeraEmbedMenu` use `lexera-asset://`.
- [ ] (input required) Verify the Windows-specific peer-credential and ACL implementation in `lexera-local-ipc/src/windows_security.rs` on a real Windows host.
- [x] (done) Replace the manual SSE/WebSocket bridging in `lexera-backend` with the native `lexera-local-ipc` stream adapters. `ipc_stream.rs` and `ipc_sync.rs` now bridge broadcasts directly to IPC frames.

### 3. Concurrency & Performance
- [x] (done) Audit the usage of `Arc<std::sync::Mutex>` in `lexera-backend/src-tauri/src/lib.rs` and identify candidates for `RwLock` or actor-based state management to reduce lock contention. Audit + both viable conversions shipped: `auth_service` and `config` now `Arc<RwLock<…>>` with `read_arc`/`write_arc` helpers in `collab_api.rs`. discovery/live_port/server_shutdown stay on Mutex (small surface). (commits fbf70fb2 + 1e517342)
- [x] (done) Optimize the board loading process in `init_storage_and_boards` to use a more granular batching strategy if the number of boards exceeds 100. `LOAD_BATCH_SIZE=100` cap: small workspaces stay on the single-scope parallel path; larger ones process boards in serialized chunks so we never have more than ~100 concurrent file-I/O / CRDT-loading threads. Three new lib.rs unit tests cover under-threshold, chunked >100 with input-set sanity, and partial-failure skip. (commit 7301889d)
- [x] (done) Implement a background task for periodic `loro` CRDT compaction to prevent state growth over time. `CrdtStore::compact_change_store` exposes the loro 1.10 method; `LocalStorage::compact_loaded_crdts` walks every loaded board; backend spawns `spawn_crdt_compaction_task` running every 600s. Two unit tests: zero-board no-op + 2-board round-trip preserves all column titles. (commit b5d6ab1e)

### 4. Modularization & Cleanup
- [ ] Split `lexera-backend/src-tauri/src/sync_client.rs` (48k bytes) into focused modules: `connection_mgr.rs`, `replication.rs`, and `conflict_resolver.rs`.
- [ ] Decompose `lexera-backend/src-tauri/src/config.rs` (34k bytes) by extracting identity and workspace management into separate files.
- [x] (done) Remove unused dependencies from `lexera-core/Cargo.toml` and `lexera-backend/src-tauri/Cargo.toml` after the ESM/IPC migrations are complete. Audit found zero orphans: 17 lexera-core deps + 28 lexera-backend deps (incl. dev/build) all have at least one usage site (some via short paths like `hex::encode`, `thiserror::Error`, `uuid::Uuid::new_v4`). Pinned by `cargoNoOrphanDepsContract.test.js` — 47 assertions, fails closed on any future orphan. (commit d137a2fd)

## IPC Refactoring & Migration

### 1. Protocol Enhancements
- [x] (done) Implement `ClientFrame::Cancel` propagation in `lexera-backend/src-tauri/src/ipc_asset.rs` to stop file streaming when the webview aborts a request.
- [x] (done) Add `If-None-Match` support to `AssetRequestPayload` and implement ETag-based 304 short-circuiting in `handle_asset_request`.
- [x] (done) Implement multi-range support in `parse_range` to match full HTTP spec parity for media seeking. Implemented `multipart/byteranges` support in `ipc_asset.rs`.
- [x] (done) Add a `KeepAlive` heartbeat frame to the protocol to detect dead connections in the absence of active traffic. Implemented server-originated `Heartbeat` frame and 30s idle interval.

### 2. Security & Platform Parity
- [ ] (input required) Run the `lexera-local-ipc` test suite on Windows to verify `SetFileSecurityW` and `GetNamedPipeClientProcessId` behavior. — requires a Windows host; cannot run from macOS.
- [x] (done) Implement `SO_PEERCRED` validation on Linux and `getpeereid` on macOS in `lexera-local-ipc` to enforce same-user-only connections. `transport/unix.rs::Listener::accept` calls `stream.peer_cred()` (tokio wraps SO_PEERCRED / getpeereid) and rejects mismatches as `IpcError::CrossUser`. Test `peer_uid_matches_own_uid_for_local_connection`.
- [x] (done) Audit the `ipc.json` descriptor file permissions on all platforms to ensure it is strictly `0600` (user-only). Unix already wrote with `mode(0o600)`; added a fail-closed post-rename verifier and tests for rename-over-existing + wide-umask. Windows DACL path remains best-effort by design. (commit ad222388)
- [x] (done) Implement an OS-native "wait for file" watcher in `lexera-kanban` (using `notify`) to avoid polling for the backend descriptor. `lexera-kanban/src-tauri/src/backend_status.rs` uses `notify::RecommendedWatcher` on the descriptor parent dir, debounces and dedupes, and emits the `backend-status` Tauri event.

### 3. Migration & Integration
- [x] (done) Migrate the `/collab/me` endpoint to a sentinel local identity response in IPC mode (no bearer token needed). Wired `x-lexera-transport: ipc` header in `ipc_dispatch.rs` + `auth_middleware.rs:69` (transport-marker bypass) + `server.rs` (strip-incoming-header middleware).
- [x] (done) Complete the "Gap #7" Tauri capability audit: move from wildcard window permissions to explicit per-window permission lists in `default.json`. Replaced `["*"]` with `["main", "kanban-*", "drag-ghost", "board-tab-*", "panel-tab-*"]`. Pinned by `tauriCapabilityWindowAllowlistContract.test.js`. (commit 3fa51695)
- [x] (done) Implement the `backend-status` Tauri event watcher in the frontend to show a native "Connecting to backend..." UI during startup. Bridge at `lexera-kanban/src/shell/bridges/backendStatusBridge.js` with 12 Vitest assertions. (commit e89c06d0)
- [x] (done) Finalize the "Phase 7" removal of the HTTP fallback path from the desktop production build. `api.js` now pins `local-ipc` when Tauri internals are detected; `index.html` has removed the discovery probe script.

## Open Tasks
