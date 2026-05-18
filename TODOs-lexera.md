## Workflow

Work on the tasks below. For each implementation task: fix, add tests, verify with `run-lexera-tests.sh` or the narrower runner named in the task. Move completed items to [todo-archive.md](todo-archive.md). Check general architecture and improve it when the change would reduce risk or complexity.

Keep this file structured and clean:
- Only open and in-progress items live here. Completed items go to [todo-archive.md](todo-archive.md).
- Group tasks under the appropriate `###` section. Do not add loose items outside a section.
- One task per line. Keep descriptions concise; implementation details belong in code comments, commits, or the archive.
- Update the test status line below after each test run.

To mark a task in progress add `(in progress)` just after `- [ ]`.
To mark a task done, mark the checkbox and add `(done)`, then move it to [todo-archive.md](todo-archive.md).
To mark a task blocked on user input add `(input required)` just after `- [ ]`.

Generally do the most time-consuming tasks first. If a task will take a long time, start it early.

## Test Status

**Last recorded run (2026-05-18):** focused storage-mode checks passed for `lexera-backend` default markdown-only mode and `--features crdt`, plus focused `lexera-core` markdown-only and CRDT tests. Full frontend run last recorded 3071 passed, 2 skipped, with 3 pre-existing failures in the stream/drag/window-scope refactor area. Update this line after the next verification run.

## OPEN TODOS (DO NOT REMOVE THIS TITLE)

### Storage Mode Compatibility
- [ ] Expose a single authoritative storage-mode value in `/status` such as `storageMode: "markdown" | "crdt"` and keep `capabilities` derived from it.
- [ ] Extend `/status.capabilities` with explicit direct-markdown, CRDT sync, live-sync, remote-sync, and disabled-reason fields so every client can gate behavior without probing failing endpoints.
- [ ] Document that only one backend runs at a time; markdown-only and CRDT are build variants sharing the same app identity, port, config, and frontend contract.
- [ ] Keep both backend variants buildable from the same workspace: default backend is direct markdown storage, `lexera-backend --features crdt` is the CRDT-enabled backend.
- [ ] Stop markdown-only backend logs from mentioning CRDT-specific behavior; rename or cfg-gate messages like "Returning CRDT-aligned board" so logs reflect the active storage mode.
- [ ] Audit backend read/write paths so markdown-only mode never creates, hydrates, mutates, or depends on `.md.crdt` artifacts.
- [ ] Audit CRDT mode so it remains an optional layer over the same canonical markdown persistence path, not a separate backend API shape.
- [ ] Split remaining storage code behind explicit persistence, index, artifact, and sync capability interfaces so `LocalStorage` is not a CRDT-aware monolith.
- [ ] Add a compatibility contract that the same board can be opened, edited, searched, and exported in both storage modes without changing frontend code.
- [ ] Expand `check-storage-modes.sh` from compile-only coverage to focused tests for `lexera-core --no-default-features`, `lexera-core --features crdt`, backend default, backend `--features crdt`, and the kanban shell.
- [ ] Add a sequential integration runner: start markdown backend, run shared frontend/backend smoke tests, stop it, then start CRDT backend and run the same suite plus CRDT-specific checks.
- [ ] Add fixture tests proving markdown-only mode ignores pre-existing `.md.crdt` files and CRDT mode can hydrate them without changing the markdown result unexpectedly.
- [ ] Update release/dev docs with exact commands for running each backend variant and state clearly that they are alternatives, not side-by-side services.

### Frontend Storage Capability Gating
- [ ] Make `api.js` the only frontend source of backend storage capabilities; remove duplicated CRDT/live-sync feature checks from callers.
- [ ] Skip `/remote-boards`, live-sync session, presence, invite, and reconnect calls when `/status.capabilities` marks them unavailable.
- [ ] Hide or disable collaboration/live-sync controls in markdown-only mode with targeted disabled copy instead of backend `501` discovery.
- [ ] Ensure board list, dashboard, workspace hierarchy, search, focus, edit, export, and drag/drop flows use storage-neutral board/card identity rules.
- [ ] Add frontend contract tests that run the same API and UI gates with markdown-only and CRDT capability payloads.
- [ ] Confirm no warning spam appears in markdown-only mode when CRDT-only UI or background jobs are disabled by capability.

### iOS And External Client Compatibility
- [ ] Add an iOS storage-capability fetch from `/status` before any board sync or capture workflow starts.
- [ ] Introduce a storage-neutral iOS client facade for capture, list, read, search, edit, delete, and attachment flows.
- [ ] Ensure iOS never assumes CRDT/live-sync endpoints exist; route unavailable sync features through the direct markdown-compatible path.
- [ ] Define iOS remote edit/delete semantics for markdown-only mode using stable board/card IDs or full-board save transactions.
- [ ] Queue iOS share-extension captures until the configured single backend is reachable and its storage mode is known.
- [ ] Add iOS/backend smoke tests against both backend variants, run sequentially with only one backend process active at a time.
- [ ] Check web clipper, quick capture, and other external clients for direct CRDT assumptions; normalize them through `/status.capabilities`.

### Data Safety And Merge UX
- [ ] Update cached and displayed embedded file content when the embedded file changes on disk.
- [ ] Finish include-file divergence UX through the existing merge stack: conflict detail from core, backend event/resolve endpoint, `LexeraMergeView` resolution, and conflict-backup restore action.
- [ ] Route include/media file deletion through recovery or explicit user intervention instead of only handling deleted main board files.
- [ ] Add user-choice handling for external board changes: keep internal, keep external, merge, or write a timestamped conflict file.
- [ ] Reduce backend write-path cost for small mutations by extracting remaining `LocalStorage` persistence and index responsibilities.
- [ ] Review whether soft-delete/tag-only mutations can skip unnecessary pre-write backup work while preserving recovery guarantees.

### Backend And IPC
- [ ] Remove the logs panel from the backend settings view and expose log viewing as an optional standalone view shared with the frontend log UI.
- [ ] Decide whether `lexera-shared/backendDiscovery.js` is removed after IPC verification or kept as a backend-only discovery utility.
- [ ] Move export logic into a `lexera-export` workspace crate.
- [ ] Move collaboration logic into a `lexera-collab` workspace crate.
- [ ] Verify Windows peer-credential and ACL behavior for `lexera-local-ipc` on a real Windows host.
- [ ] Run the `lexera-local-ipc` Windows test suite for `SetFileSecurityW` and `GetNamedPipeClientProcessId`.

### Cross-Window And Cross-View Drag Drop
- [ ] (in progress) Verify workspace burger actions, especially insert stack before/after, execute on the correct entity after the retry fix.
- [ ] Verify all cross-window and cross-view drag paths in the real app: rows, stacks, columns, cards, workspace tree to kanban, kanban to workspace tree, kanban to kanban, workspace board to workspace board.
- [ ] Confirm empty columns are draggable from kanban views and can be dropped into any kanban in the workspace.
- [ ] Confirm dropping a card on a column header or empty column area appends the card at the end of that column.
- [ ] (in progress) Profile cross-view drag hover/drop latency in the running app and remove any remaining expensive reload, duplicate subscription, or full-workspace-refresh path.
- [ ] Confirm workspace drop indicators appear on first hover without needing a release and second click.
- [ ] Add an end-to-end/manual cross-window drag/drop checklist covering rows, stacks, columns, cards, cancel, cold target, same-board, cross-board, and multi-window cases.

### Theme And Frontend Settings
- [ ] Visually verify the default theme is the no-overwrite style and that the warm theme is a separate selectable theme.
- [ ] Visually verify the hierarchy/frontend settings cleanup: drag handles always visible, burger menus always active, removed settings no longer shown, stale count/presence toggles handled correctly.
- [ ] Visually verify the row, stack, column, and include-indicator icon alignment fixes in the real app.
- [ ] Re-test the card edit scroll-left latch and confirm cards no longer jump horizontally after edit save/cancel.

### Real-App Verification
- [ ] Fold the bottom log panel via the view-header fold button and verify the folded strip shows the expected status badges.
- [ ] Open two windows on different workspaces, select boards in each, and confirm neither window hops to the other workspace.
- [ ] Verify the shell boots once in `cargo tauri dev` and no ghost webviews remain after reload.
- [ ] Verify the ghost-view regression is gone after moving, closing, and switching multiple boards/panels across docks.
- [ ] Verify backend-status pill behavior during backend startup/reconnect.
- [ ] Verify tightened Tauri capability allowlist does not break board/panel webviews.
- [ ] Smoke-test `auth_service` and `config` RwLock changes under realistic load.
- [ ] Smoke-test periodic Loro CRDT compaction during a long-lived CRDT-mode board session.

### Multiview And Shell Lifecycle
- [ ] Add OS-level placeholder pinning: either Rust `placeholder_dom_id` reporting or frontend zero-geometry parking for missing placeholders.
- [ ] Encode tab/webview lifecycle as an explicit FSM (`created -> spawning -> ready -> destroying -> destroyed`).
- [ ] (in progress) Finish the workspaceShell narrow-by-kind typedef paydown so remaining `LexeraLayoutTreeApi` loose returns can become real tab unions.
- [ ] Finish board-host extraction work: move frame-cache ownership, spawn/destroy, geometry push, visibility handling, and host lookup APIs into the host layer.
- [ ] Finish panel lifecycle adoption so production code consumes `panel-ready` and `panel-teardown` instead of DOM discovery.
- [ ] Retire remaining `LexeraSharedPanels` and `lexera-shared-panel-created` consumers after every panel view is fully hydrated.
- [ ] (input required) Run live view-leak repro with `LEXERA_VIEW_LEAK_AUDIT=1` and capture orphan logs.

### View Feature Parity
- [ ] Restore docked dashboard parity: search, all/active scope, pinned queries, and grouped result sections.
- [ ] Restore docked log parity: source filter, level dropdown, text search, reload/copy actions, connection status, and mirrored log state.
- [ ] Port the frontend test runner implementation out of the shell-owned harness.
- [ ] (in progress) Stabilize the frontend auto-run harness so readiness and `pre-test-paint` stalls are actionable; remaining slice is script-level reporting for force-launch after `readyDeadline`.
- [ ] Extract a dedicated `src/views/board/` entry and retire the current `index.html?embedded=1...` board boot path.
- [ ] Continue rich hierarchy view parity: stacks, columns, cards, drag/drop, inline rename, hierarchy-focus parity, and context menus.

### Frontend Architecture
- [ ] Initialize root NPM workspaces for `lexera-kanban`, `lexera-backend`, and `lexera-shared`.
- [ ] Configure `esbuild` for `lexera-kanban` and replace the long `index.html` script chain with a bundled/module entry.
- [ ] Convert core frontend runtime files (`moduleRuntime.js`, `api.js`, `pathUtils.js`) to ES modules.
- [ ] Move vendor libraries into NPM dependencies where possible.
- [ ] Split the large `lexera-kanban/src/app.js` into focused board, shell event, and app state modules.
- [ ] (input required) Decide the path for `wysiwyg-editor.js`: revive archived source/build chain, reauthor a smaller editor, or defer until the esbuild migration.
- [ ] Move `lexera-shared/` into a proper internal package such as `packages/shared-ui`.
- [ ] Replace direct `window` assignments in plugin code with explicit module exports.
- [ ] Standardize the IIFE-to-ESM conversion for plugin format files.

### Defensive Contract Test Inventory
- [ ] Keep source contracts for storage-mode capability gating, disabled endpoint suppression, and no-CRDT artifact isolation.
- [ ] Keep source contracts for cross-view drag/drop shell-only apply, destination reload, self-drop guards, and kid-vs-runtime-id matching.
- [ ] Keep lifecycle contracts for layout tree mutation wrappers, orphan reaping, reconciler behavior, and multiview geometry parking.
- [ ] Keep frontend harness contracts for preflight abort reporting, stall reporting, and script-level force-launch reporting.
- [ ] Keep backend data-safety contracts for include divergence, file-deleted recovery, atomic markdown writes, and CRDT artifact best-effort behavior.
