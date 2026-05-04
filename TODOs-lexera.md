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


- [x] (done) the log viewer is invisible in the folded state!

- [x] (done) ~~window's workspace must be fixed — board selection was hopping the window between workspaces (selecting a board whose `workspace_ids` didn't match the window's active id mutated `activeWorkspaceId`/`viewWorkspaceId` to the board's workspace).~~ Made `syncWorkspaceContextForBoard` and `reconcileActiveWorkspaceContext` pure resolvers — they compute context but never mutate workspace ids. Window stays on whatever workspace it was opened with (URL `?workspace=` lock or `pickDefaultWorkspaceId`). Tests in `boardHierarchyCache.test.js` rewritten to enforce the new invariant. (commit 29436b8c source + a8d291f9 tests)

- [ ] (in progress) the kanban boards in the workspace viewer must be unfoldable and show the title of each element. it the elements (row, stack, column, cards) must be re-orderable, can be dragged between boards in the workspace and also into kanban boards, it must also be possible to drag elements from kanban boards into the workspace hierarchy! Phases 1-4 (in-process drag within one webview) shipped; Phase 5 = cross-Tauri-webview drag forwarding via IPC. Primitives committed: `getWebviewLabelAtTopPoint` (commit 71f64222), `__lexeraExternalDnd` contract pin (commit f5c2f09c). Drop-target differentiation per kind shipped: ~~zone-aware sibling reorder~~ (commit 497be502), ~~`row → board` absorb~~ (commit e1253b67), ~~stack/column absorbs only into empty parents~~ (commit 58d5b266). Phase 5 plumbing: ~~`routeCrossViewDragPoint` pure helper~~ (commit 01c1d0c7), ~~shell-side install() forwards drag-move/drag-end-external to `external-dnd-hover`/`-drop`~~ (commit bebe9056), ~~sub-app emits drag-move/drag-end-external when no local target~~ (commit 6df28c29), ~~`multiviewClient.installHierarchyDragBridge` wrapper injects `getWebviewLabelAtTopPoint` + `getWebviewRect` to activate the cross-view forwarder on shell boot~~ (commit 1103f2be). End-to-end Phase 5 chain is wired; next: real-app verification of cross-webview drag (drag a card/column/row out of one board webview into another, and from the workspace hierarchy into a kanban board webview).

- [x] (done) analyze the whole application structure. detect the used architectural code structures and check if they fit the puprpose. analyze if the code strcture could be improved by restructuring and cleanup. keep the code as simple as needed while making sure it's fulfills all requirements! verify that we apply coding structure rules.

### Workspace Shell View Lifecycle (ghost views / "views all around" regression)

Root cause: the layout tree (`state.dockTree` / `state.sideDocks`) and the webview state (`state.frameCache` + `multiviewSpawnedTabs`) are dual stores that can drift. Multiple mutation paths splice tabs out of leaves without calling `removeFrame` / `multiview.destroy`, leaving native Tauri webviews painting on screen at their last position. Detailed phased plan in chat history.

#### Phase 0 — Instrument & reproduce
- [x] (done) ~~**0.1** Expose `LexeraMultiviewWebview._test_leakReport()` in `multiviewWebview.js` returning `{ spawnedTabs, spawnedDetail, geometryObservers, spawnLocks }`. Read-only diagnostic; no behavior change.~~ Pinned by `multiviewWebviewLeakReportContract.test.js` (4 assertions). (commit 2f9375f5)
- [x] (done) ~~**0.2** Add a tree-vs-spawn invariant audit at the bottom of `render()` in `workspaceShell.js:~3593`. Gated by `localStorage.LEXERA_VIEW_LEAK_AUDIT === '1'`. Logs orphans via `lexeraLog('warn', ...)`.~~ Added `collectAllTabIds` helper in layoutTree.js (pinned by `layoutTreeCollectAllTabIds.test.js`, 5 assertions) and `auditViewLifecycle()` at the bottom of `render()`. (commit fe4f1232)
- [x] (done) ~~**0.3** Wrap each `node.tabs.splice` site (workspaceShell.js:1405, 1778, 1966, 3609 + the `existingViews[existId].remove()` at 3468) with a guarded `console.trace` so the audit log shows which path leaked which tab.id. Same `LEXERA_VIEW_LEAK_AUDIT` flag.~~ Added `traceLeakSite()` helper and instrumented 5 sites (removePanelFromDocks, extractTab, removeTabFromEverywhereExcept, syncLeafDom.viewRemove, flattenToActiveLeaf). pruneMissingBoards already calls removeFrame so no marker needed there. (commit 99d4c371)
- [ ] (input required) **0.4** Run live repro with audit on; capture the orphan log to confirm which paths fire in real use.

#### Phase 1 — Surgical leak fixes
- [x] (done) ~~**1.1** Route `removePanelFromDocks` (workspaceShell.js:1392-1417) splice through `removeFrame(removedTab.id)`.~~ Pinned by `workspaceShellPanelDockLifecycle.test.js`. (commit 0848030c)
- [x] (done) ~~**1.2** Replace `extractTab(found.tab.id)` with `closeTab(found.tab.id)` in the base-panel branch of `closePanelView` (workspaceShell.js:838-840).~~ Used `extractTab + removeFrame` instead — `closeTab` re-adds the panel via `handleRemovedPanelTab` which `render()` then forces visible again. (commit 0848030c)
- [x] (done) ~~**1.3** Iterate the OLD tree before `state.dockTree = replacement` in `flattenToActiveLeaf` (workspaceShell.js:1947-1958) and call `removeFrame` for each tab.id ≠ active.~~ Uses `LexeraLayoutTree.collectAllTabIds` to snapshot the OLD center tree, computes `discardedTabIds = ids \ {keepId}`, then calls `removeFrame` per discarded id after the wholesale replacement. Pinned by `workspaceShellPanelDockLifecycle.test.js` (Phase 1.3 case). (commit c64b665a)
- [x] (done) ~~**1.4** Add an orphan reaper before `state.dockEl.innerHTML = ''` at workspaceShell.js:3567: diff `Object.keys(state.frameCache)` against tab.ids in next render and `removeFrame` any not present. Skip while `state.dragTabId` is set.~~ `reapOrphanFrames()` runs in the !patched branch only (syncDomState's incremental path handles its own removals); skipped while `state.dragTabId` is set. Test seams `_test_seedOrphanFrame` + `_test_forceFullRebuild` exposed; pinned by `workspaceShellPanelDockLifecycle.test.js` (no-regression + positive). (commit bd2b6a59)
- [x] (done) ~~**1.5** Decide on transparent-bg commit f76f959f. Recommendation: revert just `.workspace-shell-multiview-placeholder` to opaque (workspaceShell.css:1220-1223 original intent); leave the other transparent containers.~~ Reverted only the multiview placeholder back to opaque; other transparent layout containers retained. (commit 48e87ccf)

#### Phase 2 — Structural unification (reconciler)
- [x] (done) ~~**2.1** Create [lexera-kanban/src/workspace/lifecycleReconciler.js](lexera-kanban/src/workspace/lifecycleReconciler.js) with `LexeraLifecycleReconciler.create({collectAllTabIds, removeFrame, prepareTab})` exposing `reconcile(state)` that diffs `lastSnapshot` vs all-tab-ids in current state and destroys removed tabs.~~ Module created with `create() → { reconcile(state), reset() }`; tracks `lastSnapshot` (Object map of tab.ids), destroys exactly the ids absent from the new trees, walks center + 3 side docks, walks nested splits via injected `collectAllTabIds`. (commit 8f26cddd)
- [x] (done) ~~**2.2** Wire `reconciler.reconcile(state)` as the first call in `render()` (workspaceShell.js:~3540). Skip while `state.dragTabId` is set. Phase 1 individual fixes stay in place as belt-and-braces.~~ Resolved `LexeraLifecycleReconciler` global at load (throws on missing dep), lazy-instantiated on first render with closure-captured `removeFrame`, called `reconcile(state)` as the very first statement in `render()` gated by `!state.dragTabId`. Phase 1 fixes retained. (commit 0f44ca6c)
- [x] (done) ~~**2.3** Unit-test the reconciler in isolation: `lexera-kanban/tests/lifecycleReconcilerContract.test.js` — add tab → no destroy; remove 2 of 5 → exactly 2 destroys; add 1 → no extra destroys.~~ `lifecycleReconcilerContract.test.js` (10 assertions) covers all three scenarios plus side-dock walk, nested splits, double-destroy guard, reset(), missing deps no-op, and prepareTab capture. Shipped alongside the module. (commit 8f26cddd)
- [x] (done) ~~**2.4** Property-based invariant test: `lexera-kanban/tests/viewLifecycleInvariantContract.test.js` — random sequences of tree ops, assert `tabIdsInTree === Object.keys(spawnedTabs)` after each op.~~ Six deterministic seeds × 50 ops covering add/remove/move/replace-root/drop-side-dock/promote-to-split + a manual worst-case scenario (replace center then drop side dock). Failing seeds annotate the error with seed+step+trace for reproduction. (commit b0bc282f)

#### Phase 3 — Encapsulated tree mutations
- [x] (done) ~~**3.1** Add `LexeraLayoutTree.{removeTabById, moveTab, insertTabIntoLeaf, replaceTreeRoot}` API to [lexera-kanban/src/workspace/layoutTree.js](lexera-kanban/src/workspace/layoutTree.js).~~ Four wrappers shipped: `removeTabById` (walks tree, fixes activeTabId), `insertTabIntoLeaf` (clamps index, seeds activeTabId), `moveTab` (cross-leaf + same-leaf with the established "original-index" convention from workspaceShell:1846), `replaceTreeRoot(holder, key, next)` (assigns + returns symmetric tab.id diff). 20 new assertions in layoutTree.test.js. (commit 60b893ad)
- [ ] (in progress) **3.2** Migrate every `node.tabs.splice(` and `state.dockTree =` / `state.sideDocks[…] =` in workspaceShell.js to the new wrapper API (~12-15 sites). One site per slice.
- [ ] **3.3** Lint contract test: `lexera-kanban/tests/layoutTreeMutationContract.test.js` — greps for direct splice / direct assignment outside an allowlist (layoutTree.js + workspaceShell.js mount/render path).

#### Phase 4 — Defense in depth
- [ ] **4.1** Single shell-level `MutationObserver` in `multiviewWebview.js` watching for `[data-multiview="1"]` removals on the workspace root. Two-rAF debounce so move/extract reattach is not treated as removal. If still detached, call `destroy(tabId)`.
- [x] (done) ~~**4.2** (optional) Periodic 30s audit in dev mode that calls the §0 invariant check; logs slow leaks.~~ `startPeriodicViewAudit()` in workspaceShell.js called from end of `mount()`, defensive on `typeof setInterval`, idempotent. Audit body itself gates on the LEXERA_VIEW_LEAK_AUDIT flag so toggling mid-session works without remount. 4 new assertions in workspaceShellPanelDockLifecycle.test.js. (commit 4512d340)

#### Phase 5 — OS-level pinning (defer until 1-4 stable)
- [ ] **5a** Extend Rust `multiview` plugin so each spawn carries `placeholder_dom_id`. Add `multiview_report_live_placeholders(ids)` IPC. Frontend reports live placeholder ids per render; Rust auto-destroys webviews whose placeholder id is missing.
- [ ] **5b** Alternative: shell pushes `setGeometry({width:0, height:0})` per render for any spawned label whose placeholder isn't in DOM. Cheaper but webview process stays alive.

#### Phase 6 — Long-term hardening
- [ ] **6.1** Convert `state` and `tabRecords` to JSDoc-typed objects; run `tsc --noEmit` in CI.
- [ ] **6.2** Phase out `window.Lexera*` globals once the esbuild migration (Architectural Analysis §1) lands.
- [ ] **6.3** Encode tab lifecycle as an explicit FSM (`created → spawning → ready → destroying → destroyed`) replacing the cross-map state in `multiviewSpawnedTabs[id].state` + `multiviewLabelSpawnLocks` + `multiviewSpawnRetryWatchers`.

#### Verification
- [ ] (input required) Real-app verify the ghost-view regression is gone after Phase 1 + 2 land: open multiple boards across docks, move panels, close panels, switch workspaces — confirm no stale webview is left painting on screen and no skeleton text bleeds through.

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
- [ ] (in progess) Decompose `lexera-shared/management.js` by moving the log viewer logic into `src/management/logViewer.js`. **Step 1 done (commit bebe9056):** pure helpers hoisted out of the IIFE to module-scope `LEXERA_MGMT_LOG_HELPERS` / `window.LexeraManagementLogHelpers` — `MAX_RENDERED_LOG_ENTRIES`, `normalizeLogEntry`, `logSourceForEntry`, `formatLogTimestamp`, `logMatchesFilter` (now state-free, takes filter as 1st arg). The IIFE re-binds them locally so all existing call sites stay byte-identical. Pinned by `managementLogHelpersContract.test.js` (14 assertions). **Step 2 remaining:** physically move the helpers (and eventually the stateful render/stream logic) into a new `lexera-shared/managementLogViewer.js` file — needs `sync-runtime-assets.mjs` update + `<script>` tag in each app's `index.html` + .gitignore entries + decision on whether to split the stateful rendering or keep it in management.js for now.
- [ ] (input required) Split `lexera-kanban/src/wysiwyg-editor.js` into `src/editor/markdownEngine.js` and `src/editor/uiHandlers.js`. — `wysiwyg-editor.js` is a 432 KB prebuilt minified bundle (one IIFE wrapping multiple esbuild chunks). The original ProseMirror sources are in `_ARCHIVE/src/wysiwyg/*.ts`, marked OBSOLETE in CLAUDE.md. Splitting the bundle isn't possible without re-establishing a build pipeline. Need decision: (a) revive the build chain and split at source, (b) reauthor a slimmer editor in lexera-kanban directly, or (c) defer until the broader esbuild migration (line 32) lands.

### 3. Structural & Workspace Improvements
- [ ] Move `lexera-shared/` into `packages/shared-ui` and define it as a proper internal NPM package.
- [ ] Extract the geometry observation logic from `lexera-kanban/src/workspace/workspaceShell.js` into a dedicated `src/workspace/geometryObserver.js`.
- [ ] Refactor `lexera-kanban/src/shell/multiviewClient.js` to use the new `lexera-local-ipc` protocol exclusively, removing legacy HTTP fallback logic.
- [x] (done) Move the `ThemeBridge` and `CatalogBridge` from `multiviewClient.js` into their own files under `src/shell/bridges/`. Already shipped: `lexera-kanban/src/shell/bridges/themeBridge.js` and `catalogBridge.js` exist (alongside backendStatusBridge, embeddedBoardBridge, hierarchyDragBridge, managementBridge, navigationBridge, requestBridge); `multiviewClient.js:591` retains a thin wrapper that delegates to `window.LexeraThemeBridge`. (commit 3bb6afae)

### 4. Cleanup & Technical Debt
- [ ] (input required) Remove `lexera-shared/backendDiscovery.js` once the IPC migration (Phase 7) is fully verified as the default transport. Audit: lexera-kanban already removed the script tag (see `index.html:448` comment) and pins `local-ipc`, but the backend's standalone webviews still load it: `lexera-backend/src/connection-settings.html:24` and `lexera-backend/src/quick-capture.html:43`. Removing the file requires either (a) migrating those two HTMLs to the IPC transport too, or (b) keeping `backendDiscovery.js` as a backend-only utility and shrinking it down to just the discovery helpers those windows actually use. Need direction before deleting.
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

## Pending User Verification

These changes have full automated coverage but need a real-app run before
they can be marked truly done:

- [ ] (input required) Visually verify the backend-status pill (`backendStatusBridge.js`, commit e89c06d0). Kill the backend during kanban startup and confirm the top-right pill shows "Connecting to backend…" → disappears when the backend reconnects.
- [ ] (input required) Visually verify Gap #7 capability tightening (`default.json`, commit 3fa51695). After the wildcard removal, confirm board/panel webviews still receive `core:default` (open a board, dispatch a panel — nothing should fail with a permission error).
- [ ] (input required) Smoke-test the `Arc<Mutex>→RwLock` swaps for `auth_service` + `config` (commits fbf70fb2 + 1e517342) under realistic load — request validation + settings PUTs both exercise the read/write paths.
- [ ] (input required) Smoke-test the periodic loro CRDT compaction loop (commit b5d6ab1e). Run a long-lived board for >10 min and observe memory stays flat after the first compaction tick.
- [ ] (input required) Provide a screenshot or step-by-step repro for the folded log viewer issue (line 22). Code-path inspection didn't isolate the root cause; need a visual reference.
- [ ] (input required) Decide path forward for `wysiwyg-editor.js` split (line 42): (a) revive build chain + restore archived TS sources, (b) reauthor a slimmer editor in lexera-kanban, or (c) defer until esbuild migration (line 32) lands.

## Defensive Contract Tests

Locked down by `lexera-kanban/tests/*.test.js` so future drift fails at test time rather than at runtime:

- `tokensCssNoOrphansContract.test.js` (14 assertions) — every `--token` in `tokens.css` has a consumer or explicit allowlist
- `managementBoardFieldsContract.test.js` (5 assertions) — `BOARD_SETTINGS_FIELDS` schema + load-bearing keys
- `tauriCapabilityWindowAllowlistContract.test.js` (3 assertions) — capability windows list stays explicit, no wildcard
- `cargoNoOrphanDepsContract.test.js` (47 assertions) — every Cargo.toml dep has a usage site
- `backendStatusBridge.test.js` (12 assertions) — backend-status bridge describe/render/install
- `indexHtmlScriptTagsContract.test.js` (4 assertions) — every `<script src>` resolves, non-empty, non-duplicated

## Open Tasks
