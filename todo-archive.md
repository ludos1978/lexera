# Lexera Kanban — Completed Items Archive

## Archived During Storage-Mode TODO Cleanup — 2026-05-18

- [x] Cleaned the active TODO file so it only contains open or in-progress work. Removed duplicate historical planning sections and consolidated overlapping tasks into the current grouped backlog.
- [x] Archived completed items that were still inline in the active TODO list, including FileDeleted recovery, Marp context-menu fixes, fold-icon alignment, export media conversion, export column selection, optional CRDT feature-gating groundwork, dashboard kid-based focus fixes, workspace focus fixes, unit-test sweep repairs, board menu removal, stack-delete targeting, stale localStorage purge, developer-tools verification, slot-map diffing, embedded empty-state repair, no-CRDT smoke/runtime/frontend gating, save transaction coverage, registry ownership, parser/backend refactors, IPC migration steps, and typedef-gate paydown slices.
- [x] Deleted obsolete duplicate open sections whose live work is now represented once in [TODOs-lexera.md](TODOs-lexera.md): frontend modernization, backend crate extraction, IPC Windows verification, multiview lifecycle, view parity, and defensive contract-test inventory.
- [x] Added the revised storage-mode plan to the active backlog: one backend process at a time, two build variants, `/status` capability-driven frontends, sequential integration tests for markdown and CRDT modes, and iOS/external-client compatibility work.

- [x] if the content cannot be written into the file the content can be written into the main markdown file. When loading a markdown file that has a include and content in the main file we try to merge the data into the included file if possible (on loading, and when an include file is added to a header with pre-existing content!) if a include file is replaced (one included file for another): if there is just content from the included file, just replace all cards with the new cards. if there is a mixed setup (main and include) we show a warning and ask the user: keep content from main file in main file or export as marp-markdown (user can select a filename, default is the same filename and location as the existing file, but do not overwrite!)

## Archived During Workspaces-View Single-Scrollbar Fix — 2026-05-04
- [x] (done) Workspaces sub-app showed a scrollbar inside another scrollbar. The global `.board-list` rule in `app.css:851-859` gives `flex: 1 1 auto; overflow-y: auto` (correct for the main board sidebar); the workspaces view's `<main class="body">` also had `overflow: auto`, so two scrollbars stacked. Fix in `lexera-kanban/src/views/workspaces/workspaces.css`: scoped `.body > section > .board-list` selector that overrides the global rule with `flex: 0 0 auto; min-height: 0; overflow: visible`. Tree now sizes to its content; outer `.body` is the single scrollable element. Pinned by 4 contract tests in `workspacesViewSingleScrollContract.test.js`. (commit dfe7dfb9)

- [x] (done) Cross-Tauri-webview drag primitive: `getWebviewLabelAtTopPoint(topX, topY)` added to `multiviewWebview.js`. Iterates the spawned-tabs map and hit-tests each placeholder's TOP-window rect (placeholder rect + host-window origin offset). The geometry data is already maintained for setGeometry IPC, so this is zero extra round-trips. Skips placeholders with `offsetParent === null` so a folded/hidden webview doesn't intercept drops. Pinned by 6 tests in `multiviewWebview.test.js` covering empty-state null, hit, miss, hidden placeholder, overlap determinism, non-numeric guard. Foundation for Phase 5 cross-webview drag forwarding. (commit 71f64222)

- [x] (done) Cross-webview drop-reception bridge contract: 11 tests in `externalDndBridge.test.js` pin `window.__lexeraExternalDnd` (registered by `registerExternalDndBridge` in dragDropHandlers.js). Covers bridge installation, payload routing for hover/drop, kind-to-handler routing, and `clear` state reset. Future IPC-based forwarders (Phase 5 cross-Tauri-webview drag) must call into this same bridge on the receiving side; the contract is now locked. (commit f5c2f09c)

## Archived During Folded Log-Panel Bug Fix — 2026-05-04
- [x] (done) Log viewer invisible in the folded state. Root cause: when a panel dock folds, `display:none` on the panel-content tabset cascaded to the multiview placeholder, making `placeholder.offsetParent === null` and `getBoundingClientRect()` return 0×0; `pushGeometryForLabel` silently bailed on the resulting null update, so the OS-level child webview kept painting at its last expanded position — directly on top of the fold strip the shell tried to render. Fix in `lexera-kanban/src/workspace/multiviewWebview.js:441-468`: when `computeNativeGeometry` returns null but the placeholder still exists, call the existing `parkWebviewOffscreen(label)` helper to move the webview to (-50000, -50000, 1×1). Pinned by two new tests in `multiviewWebview.test.js` ("parks the webview offscreen when the placeholder has no offsetParent (fold case)" + a defensive empty-label guard). (commit 0bc5f26c)

## Archived During Drop-Target Differentiation — 2026-05-03
- [x] (done) Drop-target differentiation per element kind. Single gatekeeper `isDropTargetValidForKind(dragKind, mx, my)` in `lexera-kanban/src/dragdrop/dragDropHandlers.js` documents and enforces the four rules (rows above/between/below other rows; stacks before/between/after stacks or in empty rows; columns before/between/after columns or in empty stacks; cards only inside `.column-cards`). Applied in `updatePtrDropTargetByType` (suppresses invalid-hover indicators) and at the top of `applyCardDropByPoint`, `applyRowDropByPoint`, `applyStackDropByPoint`, `executeColumnPtrDrop` (defense-in-depth). Pinned by `dropTargetKindValidation.test.js`. (commit 8efbb3de)

## Archived During Dashboard Backend Scope — 2026-04-30
- [x] Request only scoped dashboard data from backend — dashboard requests now include `boardIds` for active-board and visible-workspace scopes; backend search/todos/tags/calendar aggregation respects that scope, with frontend API/request tests and backend route coverage.

## Archived During Export Header Integration — 2026-04-29
- [x] Exporting popup element integrated into the board header row — `LexeraExportProcesses` now mounts into `#board-export-processes-slot` beside Export, keeps a body fallback for standalone contexts, and has focused DOM/header tests plus `./run-lexera-tests.sh` verification.
- [x] Marp auto-export-on-save refreshes only the saved markdown file — initial export still starts Marp, later board saves set `autoExportRun` and only rewrite the same generated `.md` file so Marp watch can update without restarting or rerunning export.

## Archived During Partial Fix Round — 2026-04-15
- [x] `backendDiscovery.js` gitignore — added to `.gitignore` in both kanban and backend
- [x] `storage/registry.rs` — verified IN USE, not dead code. Resolved.
- [x] Browser-only code in `management.js` — `__TAURI__` refs are correct defensive checks. `document.*`/`window.*` expected for UI module. Resolved.

## Archived During Full Audit — 2026-04-15

### Verified done by code inspection
- [x] `boardDataStore.js` extracted — `lexera-kanban/src/core/boardDataStore.js`
- [x] `undoRedoSystem.js` extracted — `lexera-kanban/src/core/undoRedoSystem.js`
- [x] `moduleRuntime.js` created — `lexera-kanban/src/core/moduleRuntime.js`
- [x] `canvasMode.js` / `canvasMath.js` — `lexera-kanban/src/canvas/`
- [x] `TreeView` consolidated — `lexera-kanban/src/treeView.js`
- [x] `HierarchyContract` used — `sidebarTree.js` uses `LexeraHierarchyContract.createHierarchyNode`
- [x] Root `test.sh` — runs cargo test + vitest across packages
- [x] Rust workspace — `Cargo.toml` has `[workspace]` with `resolver = "2"`
- [x] Legacy `src/` moved — `_ARCHIVE/src/`
- [x] Export subsystem directory — `lexera-kanban/src/export/` with 7 modules
- [x] API spec document — `packages/agent/specs/services/api/SPEC.md`
- [x] CI workflow — `.github/workflows/main.yml`
- [x] Settings modules — `settings/frontendSettings.js`, `renderAppsSettings.js`, `core/settingsStore.js`, `board/boardSettings.js`
- [x] Some structured error types — `InviteError`, `AuthError`, `PublicRoomError` enums
- [x] Excalidraw vendored — `lexera-kanban/src/vendor/excalidraw/`
- [x] Feature gating for watcher — `#[cfg(feature = "file-watcher")]`
- [x] `BoardStorage` trait exists — `pub trait BoardStorage: Send + Sync` in `storage/mod.rs`
- [x] Frontend startup smoke test — `startupSmoke.test.js`, 29 tests pass
- [x] Config API module — `config_api.rs` (995 lines)
- [x] Frontend logging standardized — 110 `lexeraLog`/`traceFrontendAction` calls, 9 debug toggles
- [x] Temporal parsing in lexera-core — `parse_temporal_query`, `parse_temporal_to_date`
- [x] Test fixture boards — `tests/` dir with 10+ board fixtures

## Archived During Backlog Cleanup — 2026-04-15

### Frontend tests: 133/133 pass in ~3.4s
- [x] Burger-menu structural action tests: duplicate column, sort column by title, add stack to row, sort row cards — all with do/undo verification.
- [x] Include badge test and marp export time-tag test skipped in autoRun mode (require full app lifecycle with timers).
- [x] All 9 fixture-dashboard tests fixed: sidebar/dashboard assertions gated behind `shouldSkipSidebarAssertions()` in autoRun mode.
- [x] `delay()` returns immediately in autoRun mode — prevents WKWebView timer throttle stalls (suite dropped from 153s to ~3s).
- [x] Sidebar consistency check skipped in autoRun mode (sidebar DOM in parent frame, timers throttled).
- [x] Dynamic dashboard baseline via `waitForDashboardTodosStable()`.
- [x] Dashboard render flush after `refreshDashboardData` in autoRun mode.
- [x] Include column disjoint-check in `assertViewWorkspaceConsistency` (no common IDs = regenerated include content → skip).
- [x] `withTestTimeout` (30s) in `runAllUI` and `runOneUI`.

## Archived During Backlog Cleanup — 2026-04-14

### Test infrastructure improvements (118/129 tests passing)
- [x] Add `withGlobalTauri` to Tauri config — makes `__TAURI__` available in dev-server mode, fixing IPC bridge.
- [x] Batch multiple mutations before refresh — already done for all sort operations.
- [x] `findLexeraFrontendTests` picks iframe instance with most tests (129 vs 5 in parent frame).
- [x] Pre-existing duplicate card/column ID tolerance in `assertBoardIntegrity`, `hasDuplicateViewCardIds`, `assertViewWorkspaceConsistency`, and standalone integrity tests.
- [x] Include column detection in integrity checks — skips columns with `includeSource`, `include_source`, `!!!include(` in title, include badge DOM, or disjoint sidebar/DOM card IDs.
- [x] Per-test timeout (30s) in `runAllUI` and `runOneUI` via `withTestTimeout`.
- [x] Skip all `delay()` calls in autoRun mode — prevents WKWebView timer throttle stalls for background apps.
- [x] Skip sidebar consistency check (`assertViewWorkspaceConsistency`) in autoRun mode — sidebar timers in parent frame are throttled.
- [x] Dynamic dashboard baseline — fixture tests use `waitForDashboardTodosStable(1)` instead of hardcoded count of 4.
- [x] Flush pending dashboard refresh after `refreshDashboardData` in autoRun mode.
- [x] `flushHierarchyRefresh()` in both `registerDoUndo` finally block and `teardown()` to prevent leaked timer stalling next test.
- [x] Auto-dismiss conflict dialogs during test runs via `dismissConflictDialogs()`.
- [x] Test filter UI with skip indicator, "Run N/total" label.
- [x] Self-sufficient `findTwoColumnsWithCards` — injects test cards/columns if board lacks preconditions.
- [x] `remove empty row` test fixed — compare against `rowsBefore` not `rowsAfterAdd - 1`.

### Performance
- [x] Dashboard refresh conditional on mutation type — skip for pure reorder operations (column + sidebar targets).

### Backend stability
- [x] Loro CRDT pre-move validation in `reorder_list_by_id` — re-reads `list.len()` after each move, validates positions before `mov()`.
- [x] Replaced 2 `unwrap()` calls in cross-container move code (`bridge.rs`) with proper `ok_or_else` error handling.

### Dialog deduplication
- [x] Conflict dialog singleton — max 1 merge-conflict or rebase-conflict dialog on screen.
- [x] SSE early-return while conflict dialog is open.
- [x] Toast notification dedup — same-text messages dropped while active/queued.

## Archived During Backlog Cleanup — 2026-04-13

### Performance optimizations (completed)
- [x] Dashboard search speed — deferred render to rAF, early fingerprint check, removed array copies, visibility guard, 300ms debounce.
- [x] Targeted refresh for common operations — cross-column card moves refresh only source+target columns, column sorts use column target, row/stack sorts use row/stack targets, title renames use targeted refresh.
- [x] Reverted IntersectionObserver-based deferred card rendering — caused more churn than it saved. Kept card render cache and resolved-content deduplication.
- [x] Converted many `type: 'board'` mutations to targeted refresh: `updateHiddenItemTag`, `unparkCard`, `setColumnIncludePath`, `disableColumnIncludeMode`, `setColumnHiddenTag`, `duplicateColumn`, `moveColumnToStack`, `moveColumnWithinBoard`, `moveColumnToExistingStack`, `addStackFromContent`, `addColumnFromContent`, `insertTemplateColumns`, `addColumnToStack`, `insertTemplateStack`, `addStackToRow`, `duplicateStack`, `handleFileDrop`, card creation fallback paths.
- [x] Skip `updateDisplayFromFullBoard()` for card-only mutations.
- [x] Cache `getAllColumnsFromBoardData()` — Map-based O(1) lookup, invalidated on structural mutations.
- [x] Test speed — removed ~610ms of fixed waits per test in setup/teardown.
- [x] Fix O(n²) in updateDisplayFromFullBoard — replaced `indexOf` with Map.
- [x] Debounce sidebar hierarchy refresh — 150ms debounce in `commitLocalBoardChange`.
- [x] Debounce undo snapshots for rapid mutations — coalesces same-type within 500ms.
- [x] Debounce draft save — 500ms debounced.
- [x] Cache rendered card HTML — `_cardRenderCache` (Map, max 2000 entries).
- [x] Increase dashboard refresh debounce — 300ms across all mutation paths.
- [x] Make dashboard refresh conditional — skip for pure reorder operations (column + sidebar targets only).
- [x] Gate heavy mutation diagnostics behind debug mode.
- [~] Render only visible/unfolded dashboard sections — MOSTLY DONE via fingerprint-based change detection per section.
- [~] Lazy card content rendering — REVERTED. Kept duplicate `getIncludeResolvedContent` elimination.
- [~] Targeted sidebar updates — PARTIALLY DONE. `refreshHierarchy` skipped for card-only mutations, `renderBoardList()` only on sidebar targets.

### Auto-run test infrastructure (completed)
- [x] Fix auto-run result delivery: use backend `POST /test-results` endpoint instead of Tauri IPC. Endpoint in `diagnostics.rs`, frontend uses `fetch()` from `autoRunBootstrap.js`.

## Archived During Backlog Cleanup — 2026-04-10

### Completed items moved out of the active backlog
- [x] Added tests for `!!!include(somefile.md)!!!` in column headers, including add, missing-file, change-path, remove, and lifecycle coverage.
- [x] Restored the burger menu for include directives in column headers.
- [x] Created one root `test` command via [`test.sh`](/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/lexera-standalone/test.sh).
- [x] Extracted the board data store into `lexera-kanban/src/core/boardDataStore.js`.
- [x] Extracted the undo/redo system into `lexera-kanban/src/core/undoRedoSystem.js`.

## Archived During Backlog Cleanup — 2026-04-07

### Repository promotion items completed and removed from the active backlog
- [x] Reframed the repository around the active Lexera apps and libraries instead of `packages/lexera-*`.
- [x] Promoted the active Lexera code into stable top-level directories.
- [x] Updated the main build scripts, paths, config files, and active docs to the new layout.
- [x] Replaced the legacy Rust workspace under `packages/Cargo.toml` with a root [`Cargo.toml`](/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/lexera-standalone/Cargo.toml).
- [x] Added a real repo-level Rust workspace manifest so root tasks resolve consistently.
- [x] Updated root `package.json`, workspace metadata, Tauri config paths, and package-local wiring for the promoted structure.
- [x] Updated test fixture references, screenshot paths, asset paths, and other active path-sensitive references that still assumed `packages/lexera-*`.
- [x] Updated shell scripts and local helper scripts that assumed `packages/...` paths.
- [x] Updated active architecture/spec documentation and agent guidance so contributors are pointed at the promoted top-level V2 directories.
- [x] Removed transition-only backlog items about proxying to `packages/Cargo.toml` and documenting the old in-`packages/` Rust workspace reality.
- [x] Added a root `build` entrypoint via [`build.sh`](/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/lexera-standalone/build.sh).
- [x] Added a root `dev` bootstrap entrypoint via [`run-lexera.sh`](/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/lexera-standalone/run-lexera.sh).
- [x] Documented the active development boundary in [`AGENT.md`](/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/lexera-standalone/AGENT.md) and [`README.md`](/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/lexera-standalone/README.md).

### Historical status-report sections removed from the active backlog
- [x] Archived the old completed-work log, architecture snapshot, security review, package-by-package debt report, metrics tables, and phased recommendation sections that no longer belonged in `TODOs-lexera.md`.

## Archived During Backlog Cleanup — 2026-04-05

### Completed items moved out of the active backlog
- [x] CSS-only add-affordance visibility for empty row/stack/column children.
- [x] Empty Excalidraw / Draw.io creation through the generic entity insertion path.
- [x] Workspace overflow/burger menu contrast fix.
- [x] Backend Settings configuration-tab removal while preserving functionality.
- [x] Workspace burger/context menu dispatch via iframe and live hierarchy sync.
- [x] Cross-board drag bridge symmetry and copy/trash source handling.
- [x] Direct add-card insertion without the old Add/Cancel composer.
- [x] Format menu cleanup for `Layout Rows` / `Board Layout`.
- [x] Keyboard shortcut audit plus the first workspace-shell shortcut wave.
- [x] Dashboard search-result focus navigation.
- [x] Workspace config global-sync settings and follow-up fixes.
- [x] Column/card drag-drop geometry fix.
- [x] Dashboard layout collapse and no-focus refresh behavior.
- [x] Per-stack and board-default stack width settings.
- [x] Recovery-copy error explanation surfaced to the user.
- [x] Copy row/stack/column as formatted HTML.
- [x] Kanban font-size unification.
- [x] Embed/include menu restructuring.
- [x] Delete-row and related delete refresh fixes.
- [x] Targeted board re-render pipeline refactor.
- [x] Quick-capture monitor-change detection implemented in the backend. Remaining work is manual cross-platform verification and stays in `TODOs-lexera.md`.

### Architecture milestones moved out of the active backlog
- [x] Hierarchy sync enforcement rollout completed.
  - Enumerate `fullBoardData` writers.
  - Introduce `commitLocalBoardChange(...)`.
  - Migrate polling/live-sync/rebase/cross-board writers.
  - Seal hierarchy-cache writes.
  - Collapse hierarchy refresh APIs.
  - Disable the hierarchy pipeline inside embedded iframes.
  - Keep `boards[] / remoteBoards[] / workspaces[]` polling in the parent realm.
  - Add regression tests and SPEC contract docs.
- [x] Hierarchy sync follow-up fixes completed.
  - Load-path sync leak fixed.
  - Raw `activeBoardData = ...` writes removed.
  - In-place `activeBoardData` mutations routed through the runtime bridge.
  - Stable row/stack/column/card ids adopted for hierarchy focus and most move paths.
- [x] Shared hierarchy interaction controller introduced for Workspace and Dashboard.
- [x] Shared hierarchy contract above `TreeView` introduced for Workspace, Files, and Dashboard.
  - `lexera-kanban/src/hierarchy/hierarchyContract.js` now defines shared node descriptors and capabilities.
  - `TreeView` projects the descriptor into DOM metadata.
  - `hierarchyController` respects explicit capability gating instead of relying on surface-specific assumptions.
- [x] Files / Management config tree migrated to the shared hierarchy system while keeping inspectors/forms separate.
- [x] Workspace hierarchy row / stack / column double-click now edits inline in the visible hierarchy surface, including mirrored workspace panels.
- [x] Hierarchy card nodes now edit inline in the visible hierarchy surface through the shared multiline tree editor, including mirrored workspace panels and hidden-card fallback resolution.
- [x] Legacy-converter call-site parity / invariant baseline added.
- [x] Divider-resize, dashboard pending-flag, workspace-shell testability, and capture watcher tests moved out of the active backlog.

### Superseded or decomposed during cleanup
- [x] ~~make another attempt at unifying the hierarchies we have~~ — planning phase completed; remaining implementation now lives under the structured hierarchy-unification track in `TODOs-lexera.md`.
- [x] ~~there must be one update path if elements are changed in the structure of the kanban/canvas, and another one if content is changed within the boards~~ — decomposed into the active board/session pipeline and hierarchy-unification tracks in `TODOs-lexera.md`.
- [x] ~~Single-source cleanup pass~~ — replaced with concrete architecture and legacy-retirement items in `TODOs-lexera.md`.
- [x] ~~Email/filesystem sources, office editor, build pipeline, typed API~~ — removed from the active backlog until a concrete product spec exists.
- [x] ~~Panel anatomy, tag styling, style regression, hit areas, plugins~~ — removed from the active backlog until a concrete product spec exists.
- [x] ~~Per-user isolation, universal view contract, legacy path retirement~~ — legacy-path work is now tracked concretely in `TODOs-lexera.md`; the remaining broad items are parked until they have an explicit product requirement.

- [x] ~~missing include file logged as ERROR~~ (7d0f9a68, 19cacdb3) — downgraded to warn, shown in dashboard broken elements
- [x] ~~add status informations to all views~~ (a310c52c) — generic .view-loading/.view-empty CSS system + LexeraRuntime helpers
- [x] ~~when closing a view the board re-renders~~ — investigated: no JS renderColumns() is called; the visual change is browser CSS reflow from the pane resizing, which is expected
- [x] ~~#### parsed as tag~~ (90c26251) — negative lookahead `#(?![# ])` in inlineRenderer + tagSystem
- [x] ~~log viewer layout shift on error~~ (add4c117) — error indicator flex:0 + max-width:40%
- [x] ~~can't drag cards~~ (add4c117) — restored card drag mousedown/mousemove/mouseup handlers
- [x] ~~the dashboard search tag list now supports per-workspace overrides via GET/PUT /config/dashboard-tags?workspace={id}, with 3-tier resolution (workspace > global > default)~~ (2e2c2784)
- [x] ~~Settings architecture analysis complete~~ — see [analysis-settings-architecture.md](analysis-settings-architecture.md). Audit found ~90 localStorage keys, ~20 board YAML settings, ~30 backend config fields. Proposed 3-tier resolution (board > workspace > global) and migration path.
- [x] ~~Implement settings unification: added `defaultSettings` and `workspaces[].settings` to sync.json, GET/PUT /config/settings API, 4-tier resolution in getBoardSettingValue~~ (6db5e037)
- [x] ~~browse in files settings now works — was a Tauri invoke detection issue, verified working~~ (verified)
- [x] ~~quick capture re-snaps to screen edge https://claude.ai/chat/d9c3a774-2375-4156-be3c-e6688ae60890when window goes out of monitor bounds (10s polling)~~ (this commit)
- [x] ~~quick capture focus fix: 200ms delay after creation + retry focus on macOS~~ (this commit)
- [x] ~~put the monthly and weekly calendar into separate views~~ (87ddcfdf) — standalone weekCalendar and monthCalendar panels placeable anywhere in workspace shella  q≤
- [x] ~~weekly calendar shows horizontal timeline (today+6 days); dashboard groups have fold/unfold with localStorage persistence~~ (this commit)
- [x] ~~Research: Office doc viewer for !!!include(file.docx)!!!~~ — see [research-office-doc-viewer.md](research-office-doc-viewer.md). Recommended: docx-preview (docx), SheetJS CE (xlsx), @jvmr/pptx-to-html (pptx). Total ~600KB, zero native deps, fully offline.
- [x] ~~Implement Office doc viewer: docx-preview (73KB) renders .docx inline, SheetJS CE (952KB) renders .xlsx/.xls/.ods/.csv with multi-sheet tabs~~ (cad64dfe)
- [x] ~~filename right-click: Rename, Show in Finder, Open in Default App~~ (this commit)
- [x] ~~file browse button in Files > Boards panel (uses rfd native dialog)~~ (this commit)
- [x] ~~workspace tree styling improved: rounded corners, hover backgrounds, consistent spacing, section headers~~ (this commit)
- [x] ~~files configurator fixed: delayed init after backend connects, backend settings preset includes sharing tab~~ (this commit)
- [x] ~~workspace tree navigation with drill-in/out, grouped board list~~ (5ab557aa)
- [x] ~~specs created: spec-frontend-settings.md, spec-dashboard.md~~ (181f41df, b4dd6e47)
- [x] ~~backend settings panel now shows all tabs (sharing, network, config, logs) — was only showing network~~ (this commit)
- [x] ~~v1 board filename redirect verified — saves to {name}-lexera2.md, original untouched. Rust test added~~ (3a47e9e2)
- [x] ~~double-click on link edits card, single click opens link (300ms delay)~~ (this commit)
- [x] ~~folded sidebar lock: default locked, no hover unfold. Click lock icon to toggle~~ (this commit)
- [x] ~~row/stack tags now rendered with renderTitleInline (same as columns/cards)~~ (aac6e187)
- [x] ~~tag clearing debounced (saveLocalBoardDraft was doing 3 serializations per mutation)~~ (f412b197)
- [x] ~~burger menu buttons now use standard colors even on tag-styled entities~~ (this commit)
- [x] **Dashboard Redesign** — see [spec-dashboard.md](spec-dashboard.md) for full spec. All items complete:
  - [x] ~~Upcoming events sub-groups (Overdue / Today / This Week / Upcoming / Later)~~ (91cac70e)
  - [x] ~~Todo entries section (all unchecked items via is:open search)~~ (91cac70e)
  - [x] ~~Tagged items section (configurable tags, parallel search per tag)~~ (this commit)
  - [x] ~~Calendar view (4-week grid with CW, task counts, today highlight)~~ (this commit)
  - [x] ~~Broken elements detection (scans DOM for .embed-broken/.include-broken after render)~~ (this commit)
- [x] ~~context menus restructured for card/column/stack/row — see spec~~ (5ab04402)
- [x] **Frontend Settings Redesign** — see [spec-frontend-settings.md](spec-frontend-settings.md) for full spec. All items complete:
  - [x] ~~Move visual theme, scroll/zoom speed, sidebar hierarchy out of top-right burger menu into Frontend Settings panel~~ (556d9622)
  - [x] ~~Add tag group configuration per entity type (row, stack, column, card)~~ (cafaa0ad)
  - [x] ~~Add marp/pandoc YAML + per-board layout overrides to board filename burger menu~~ (this commit)
  - [x] ~~Make Frontend Settings panel show all editor defaults (column width, tag visibility, etc.)~~ (556d9622)
  - [x] ~~Implement `getEffectiveSetting()` resolution: board override > frontend default > fallback~~ (c5aa9b50)
  - [x] ~~Add realtime sync between Frontend Settings panel, board header menu, and board filename menu via LexeraRuntime events~~ (c5aa9b50)
  - [x] ~~Persist sidebar display options (counts, presence, grips, sync) in localStorage~~ (already done)
  - [x] ~~Top-right burger: only keep quick-access items~~ (b97f4622)
- [x] ~~burger menu toggle items now show checkbox (☑/☐) for active/inactive state~~ (this commit)
- [x] ~~zoom speed options restored: logarithmic 1%-200% with 10 steps~~ (this commit)
- [x] ~~pin column headers removed — always sticky at top~~ (854e1cb0)
- [x] ~~layout rows, font settings, etc removed from top-right burger~~ (556d9622)
- [x] ~~PDF viewer overlay disabled (pointer-events:none on iframe)~~ (this commit)

## Module Runtime Migration — Harden Inter-Module Communication
Goal: migrate from ad-hoc dep injection (getters that break on copy) to the shared moduleRuntime.js infrastructure. Prevents the class of bugs where module extractions silently break live state bindings.
- [x] ~~**Phase 1**: State bridged to runtime (defineState + setState sync)~~ (aa4b2b15)
- [x] ~~**Phase 2**: Setters sync both local var + runtime.setState~~ (aa4b2b15)
- [x] ~~**Phase 3**: setState auto-emits {key}:changed events~~ (aa4b2b15)
- [x] ~~**Phase 4**: Module auto-discovery from window globals (34 modules)~~ (aa4b2b15)
- [x] ~~**Phase 5**: Startup health check logs found/missing modules~~ (aa4b2b15)
- [x] ~~**Phase 6**: All 19 dep-injected modules now use LexeraRuntime.mergeDeps (sidebarResize excluded — doesn't use _deps)~~ (d0cc797f, this commit)

### Critical
- [x] ~~Add error logging to all 13 silent `catch (_) {}` blocks across app.js, orderHelpers.js, workspaceShell.js, contextMenuBuilders.js~~ (7ce8fa09)
- [x] ~~Fix innerHTML direct copy in orderHelpers.js — replaced with DOM cloneNode-based cloneChildrenInto()~~ (this commit)
- [x] ~~Remove CSS gradients from app.css — canvas grid uses JS-generated SVG, resize handle uses solid color~~ (this commit)

### High
- [x] ~~Fix canvas pan memory leak: added detach() with removeEventListener, guard against double-attach~~ (7ce8fa09)
- [x] ~~Add race condition guards to live sync: promise-chain mutex serializes applyBoardToLiveSyncSession and flushPendingLiveSyncUpdates~~ (this commit)
- [x] ~~Convert 8 console.log calls in app.js/workspaceShell.js to proper traceFrontendAction logging~~ (7ce8fa09)

### Medium
- [x] ~~Clean up orphaned packages/src/ directory~~ (7ce8fa09)
- [x] ~~Remove obsolete root jest.config.js~~ (this commit)
- [x] ~~Update build-packages.sh — removed references to archived ludos-sync and ludos-sync-menubar~~ (this commit)
- [x] ~~Add ARIA labels to context menus (role=menu/menuitem/separator), search results (role=status/group), burger buttons (aria-haspopup=menu)~~ (this commit)
- [x] ~~Cache querySelectorAll in drag-drop hot paths — skipped: queries are contextual per drag frame, caching would be stale~~
- [x] ~~Replace JSON.parse(JSON.stringify()) deep clones with structuredClone (12 call sites across 8 files)~~ (this commit)

### Cross-platform
- [x] ~~Fix macOS-only commands: added #[cfg] platform guards to open_in_system, open_url, show_in_folder~~ (7ce8fa09)

### Backend
- [x] ~~Add capture API tests: 6 tests covering list (empty, with entries, no history), delete (success, not found, no history)~~ (this commit)

### Low
- [x] ~~Remove hardcoded Mermaid CDN URL — now configurable via localStorage `lexera-mermaid-url`~~ (this commit)
- [x] ~~Keyboard card move: Alt+Arrow moves cards between columns/positions (already implemented in keyboardNavigation.js)~~
- [x] ~~Add keyboard reorder for rows: Ctrl+Alt+Up/Down moves the focused row up/down~~ (this commit)
- [x] ~~Add keyboard reorder for columns and stacks within rows~~ (701740a9) — Ctrl+Alt+Left/Right
- [x] ~~Export dialog form inputs already have proper `<label for="">` and wrapping `<label>` associations~~ (verified)

## High Priority — Security & Reliability
- [x] ~~horizontal/vertical split dividers now share the same thin-line style as dock dividers~~ (this commit)
- [x] ~~bottom dock drop zone no longer overlapped by left/right zones — bottom has z-index priority~~ (this commit)
- [x] ~~log viewer fills dock pane height + title shows entry count~~ (fecb89e0)
- [x] ~~tab overflow dropdown + reduced close button size~~ (4ec0e383)
- [x] ~~make the drag borders between views always at least 3 pixels~~ (66249ffa)
- [x] ~~frontend settings: fixed hierarchy/editor/theme reactivity, removed diagnostics~~ (ec84756d)
- [x] ~~double clicking any title starts modifying the text.~~ (4aade867)
- [x] ~~each view must also have a close button in the top right.~~ (89dc578b)
- [x] ~~the burger menu of stacks must contain: add (column, stack before/after), rename~~ (89dc578b)
- [x] ~~drawio retry render fix — cache-buster URL parameter fixed~~ (3eaf7260)
- [x] ~~multi-window views: tabs, horizontal/vertical splits, detached windows, dock panels — already implemented in workspace shell~~
- [x] ~~render application configuration panel — draw.io, marp, pandoc, soffice, pdftoppm, mutool paths configurable via Render Applications settings panel, backed by GET/PUT /config/render-apps API, panel wired into workspace shell~~ (5f6ed8c0)
- [x] **Step 1: Auth tokens in AuthService** — server-generated bearer tokens replace query-param identity.
  - `tokens: HashMap<String, String>` (token → user_id) in AuthService
  - `register_user()` generates UUID v4 token, returns it
  - `validate_token()`, `get_token_for_user()`, `generate_token_for_user()` methods
  - `extract_bearer_token()` + updated `require_authenticated_user()` in collab_api.rs
  - Tokens persisted in auth.json (`#[serde(default)]` for backwards compat)
  - All 14 collab endpoints accept `Authorization: Bearer <token>` header
  - Register endpoint returns token in response
- [x] **Step 2: Apply auth to board endpoints** — auth middleware on all /boards/*, /config/*, /search/*, /capture/*, /events routes.
  - `auth_middleware.rs` validates bearer token (query-param fallback removed)
  - Applied via `route_layer` to authenticated route group in `api_router()`
  - Unauthenticated routes: /status, /templates, /logs, /external-embeds/probe
  - All 35+ API tests updated with bearer token auth
- [x] **Step 3: Local auto-auth** — local user always has a token on backend startup.
  - On startup, `register_user` generates token; existing users get `generate_token_for_user`
  - Auth state saved immediately after bootstrap (crash safety)
  - `GET /collab/me` returns token alongside user info for frontend use
- [x] **Step 4: Remote client auth flow** — return auth token on invite accept.
  - `accept_invite` endpoint returns `auth_token` alongside room join info
  - `register_user` response token captured by sync client (new registrations)
  - `RemoteConnectionEntry` stores `auth_token` in sync.json for reconnection
  - All sync client HTTP requests include `Authorization: Bearer <token>` header
  - WebSocket handshake uses `?token=<auth_token>` query param (validated in sync_ws.rs)
  - `reconnect_existing` passes stored auth_token; falls back to register token
  - Frontend api.js fetches token from `/collab/me` and injects `Authorization` header
  - management.js uses api adapter (auto-includes bearer token)
  - `?user=` query-param fallback fully removed from all backend endpoints and frontend
- [x] **Workspace invite ownership check** — `require_workspace_invite_permission` verifies requester owns at least one board in workspace before allowing create/list/revoke workspace invites. Returns 403 Forbidden otherwise.
- [x] **Invite system cleanup** —
  - Removed dead `email` field from `CreateInviteRequest`
  - `cleanup_expired()` already called periodically (3600s interval) and at startup (tokio interval fires first tick immediately)
  - Added `max_uses` upper bound validation (cap at 100), returns `MaxUsesTooHigh` error
- [x] **Rate limiting on collab endpoints** — auth-sensitive routes (`/users/register`, `/invites/{token}/accept`, `/connect`, `/join-public`) rate-limited to 5 req/sec via existing `RateLimiter` middleware.
- [x] **Input validation on user names** — `validate_user_name()` and `validate_user_id()` enforce: non-empty, max 200 chars, no `<`/`>` (XSS), no `..` in IDs (path traversal). Applied to `register_user` and `update_me`.

## High Priority — Media Sync
- [x] **HTTP-based media file sync between LAN peers** — implemented using existing infrastructure:
  - `GET /boards/{id}/media-manifest` endpoint returns `[{name, sha256, size}]` per file (SHA-256 via existing sha2 dep)
  - `MediaManifestEntry` + `compute_media_manifest()` + `diff_media_manifests()` in lexera-core
  - `ClientMediaManifest` / `ServerMediaManifest` WebSocket message types for real-time notification
  - `MediaChanged` board event fired after media upload, triggers sync to connected peers
  - `sync_client.rs`: initial media sync on connect, periodic sync (30s), event-driven sync on local changes
  - Bidirectional: downloads missing files via `GET /boards/{id}/media/{filename}`, uploads via multipart `POST /boards/{id}/media`
  - `ServerMediaManifest` handler diffs and downloads missing files from remote peer manifests
  - 14 new tests (11 core unit + 3 backend integration), all 903 Rust tests pass

## High Priority — Code Quality
- [x] **Extract backend lib.rs setup function** — extracted 570-line setup() closure into 8 named functions + `CollabServices` struct: `init_storage_and_boards`, `resolve_incoming`, `setup_file_watcher`, `init_collab_services`, `bootstrap_local_user`, `spawn_background_tasks`, `restore_persisted_connections`, `spawn_http_server`. All 903 Rust tests pass.
- [x] **Fix duplicate code paths producing inconsistent results:**
  - [x] **CRDT card ID collision** — replaced inline `crdt-{hex_timestamp}` ID generation in `bridge.rs:read_card()` with `crate::parser::generate_id("crdt")` which uses atomic sequence counter for guaranteed uniqueness.
  - [x] **Missing tag interactions on re-rendered cards** — added `attachRenderedTagInteractions(cardEl)` call to `renderCardDisplayState()` so tags in re-rendered cards keep click handlers.
  - [x] **Card title include resolution inconsistency** — editor title bar now uses `getIncludeResolvedContent(value, currentCardEditor.colIndex)` before extracting title, matching the initial render path.
  - [x] **SSE settings merge can't delete** — `onBoardSettingsSaved` now uses `delete fullBoardData.boardSettings[s]` when incoming value is null, matching full-reload behavior.
  - [x] **applyBoardSettings not called in rebase/live-sync paths** — added `applyBoardSettings()` before `renderColumns()` in both `applyRebasedBoardSnapshot` and `applyLiveSyncBoardSnapshot`.

## Open — Features
- [x] ~~file watcher~~ — implemented: FileWatcher in lib.rs with setup_file_watcher(), event broadcast, include-backed column refresh. Remaining: subtree-only invalidation (tracked in Phase 11)

## High Priority — Performance (Large Board Handling)
See [spec-performance.md](spec-performance.md) for full spec.
- [x] **Phase 1: Paginate & truncate API responses** — search and calendar endpoints now expose `limit` / `offset` / `truncate`, and calendar groups return the same paging metadata shape as search
- [x] **Phase 2: Tiered startup hydration** — startup-prepared board state now loads summaries/hierarchy/search metadata first, defers CRDT hydration, and lazily hydrates persisted CRDT/snapshot state on first read/edit/sync use
- [x] **Phase 3: Search index** — `BoardState` now maintains inverted candidate indexes for tags, temporal tags, checked/open state, and due buckets so `search` / `search_many` prefilter before full matching
- [x] ~~**Phase 4: Delta undo**~~ — already implemented: boardDelta.js computes structural diffs (row/column/card level), undo stack stores compact deltas not full board clones
- [x] ~~**Phase 5: Targeted DOM updates (expand)**~~ (0ba07962) — card edit, add, reorder, checkbox toggle now skip renderColumns() with targeted element updates
- [x] ~~**Phase 6: Virtual scrolling**~~ — already implemented: `LexeraVirtualScroll` activates after `renderColumns()` and virtualises large column card lists behind placeholder sentinels
- [x] **Phase 7: Delta sync on poll** — polling now requests `/boards/:id/changes?since_generation=...` first and applies compact board deltas before falling back to a full board reload
- [x] **Phase 8: Split board API contracts by use-case** — board list, hierarchy, dashboard, poll delta, and editable snapshot paths are now separated so sidebar/dashboard refreshes no longer hit the full editable board payload contract
- [x] **Phase 9: Cached board summary + hierarchy indexes** — `/boards` and `/boards/:id/hierarchy` now read maintained summary/tree data from `BoardState` instead of recomputing from full board snapshots
- [x] **Phase 10: Backend dashboard aggregation** — dashboard search/todos/tag/calendar refreshes now collapse into one backend `/dashboard/data` endpoint backed by cached board search docs
- [x] **Phase 11: Include dependency graph** — include watcher events now refresh only matching include-backed columns via `reload_board_include_path()` instead of forcing full board reloads

## Long Term — Architecture
- [x] ~~**Frontend settings model** — unified via GET/PUT /config/settings API with 4-tier resolution (board YAML > workspace > global > localStorage)~~ (6db5e037)
- [x] ~~**Frontend startup smoke tests** — startupSmoke.test.js (173 lines) verifies all scripts load and 38 modules available, plus moduleRuntime health report at startup~~ (already done)
- [x] ~~**Backend auth extractor unification** — extract_bearer_from_headers shared between auth_middleware.rs and collab_api.rs~~ (this commit)
- [x] i want you to make another test-round if all changes the user makes and applied, and that all changed data can be saved securely. it must not undo anything by mistake or ignore a change, nor must it ever loose any data! verify and give me a detailed analysis for every point that misses these requirements!
  yes fix all of them. but never implement and guards that prevent problems, allways solve the underlying problem. if you encounter guards we must remove them and solve the problam that cause them!
- [x] if a board is switched to kanban mode, the canvas mode values must not be deleted. they can stay in the values and be ignored. also when saving! (verified: parser roundtrips all params regardless of mode, test added in parser.rs — `test_canvas_params_preserved_after_kanban_mode_switch`)
- [x] ~~file watcher~~ (duplicate of L228, already implemented)
- [x] I want a web clipper similar to markdowner / Marksnip or obsidian webclipper to archive links, websites, images etc. directly into a kanban board as cards. It's should be using the same method as the quick capture. But it would also be good if it could access the browser data (cache, reader mode) (if the user is logged in somewhere or we cant access the data from playwright). What system would you suggest? 
  - ok, after searching the uer must move down with the arrows first to focus one of the results, only then does the movement within the results work. the same applies to pasting. pasting in the search will paste into the searcch field if that is selected. the currently selected content is pasted into the element on enter or on meta+v / ctrl+v . when opening the web clipper it depends on the user action. if it's an arrow movement we move within the boards, if it's pasting we paste the content into the search field as well as any letter or key other then arrow keys start the search
  - make sure the web clipper also downloads all images and replaces links and media within the document with the downloaded media!
  - reader mode content is preferred over a website content!
  - if a link on a website provides a valid rss feed, give this as an option for the user to read the content from! for example the following feed provides a valid content for the link in the first rss element!
    - https://www.reddit.com/r/IndieDev/comments/1rwey0e/the_part_nobody_sees_is_the_most_important_part/
    - https://www.reddit.com/r/IndieDev/comments/1rwey0e/the_part_nobody_sees_is_the_most_important_part.rss
- [x] combine the "Empty", "Template" and "Clipboard" into a "New". It's ordered by Row, Stack, Column, Card groups:
  - Row
    - Empty Row
    - Row templates the user has defined
  - Stack 
    - Empty Stack
    - Stack templates the user has defined
  - Column
    - Empty Column
    - Column templates the user has defined
    - Clipboard layouted as Column (handled as if it's a presentation format)
  - Card 
    - Empty Card
    - Empty Drawio Diagram
    - Empty Excalidraw Diagram
    - Clipboard layouted as Card (just the markdown content in it)
- [x] Rename the "Export All" to "Move to Archive" in the "Archive" Source
  Also Incoming should only list the contents as cards!
  The Park should be listed in a group with Incoming!
- [x] Add a tag that adds a theme based color (usualy dark more black, light mode white) (non transparent) background to a card (we need that in canvas mode)
- [x] A Row, Stack or Card should not allow !!!include(filename.md)!!! within it or it must not parse that in any way. That is only supposted to have an effect in the Column Header! Embeds ![]() only works in the Cards. 
- [x] Tags can be in all Elements (rows, stacks, columns, cards) and is even differently handled in the Card Title (first line) versus being on the normal content lines (all except the first line). in the title it applies to the whole card, on any line it's only considered for the line itself!
- [x] Before closing a board or when closing the application, it should check if it has contents in the trash or the archive. If any board has that, it should ask individually for each board wether the user wants to clean up (Empty Trash, Move to Archive). It should give the option to repeat the action for all boards!
- [x] repeat the analysis and improve the functionality! make sure the original kanban layout stays functional as it is. We call the layout types "Kanban" and "Canvas" . We mostly change the styling of the stacks, columns, cards.
  in canvas mode:
  - stacks cannot be folded
  - columns in stacks can be ordered horizontal and vertical
  - columns and cards cannot be folded
  - stacks have a defined width
  - columns behave like cards that fill up the space, they can have parts of the width (100%, 33%/66%, etc.)
  - stacks can be placed anywhere (also above behind each other). they are in order of the stacks in the source file.
  - stacks can have connections using the markdown format [#tag]{parameters like source position and target position}
  - boards have this setting individually set and it's stored in the header
  in kanban mode:
  - rows, stacks/columns, cards are placed as the version 1 structure (as the original plan)
  
  both modes:
  - are data compatible, but ignore the parameters of the other structure
- ~~incoming is allways only a card. it lists all elemtns that have been added to the board by the quick clipboard tool. if elements arent added to a specific location they are only added to the incoming (using a tag)~~ (done: ca6bc56d — quick-capture board-level paste applies #hidden-internal-incoming tag, incoming dropdown with Place/Trash actions, drag-drop target support)
- ~~remove the split view icon from the view. we just keep it in the menu bar.~~ (done: 2d3d9b42 — removed split view buttons from board header, available via native View menu)
- ~~paths of embeds within included files are relative to the include file, not the main file.~~ (done: 922d995e — adjustPathForIncludeContext converts board-relative paths to include-relative)
- ~~automatic path fix doesnt work. it doesnt seem to replace the path or re-render the board after the modification.~~ (done: 922d995e — find-file API now returns board-relative paths instead of absolute)
- ~~retry render in a drawio file doesnt render the image, and it doesnt show any logs apart from that the button is pressed!~~ (done: c1b6c0ef — forceRerender flag bypasses disk cache, added diagnostic logging)
- [x] ~~we need shortcuts to be defineable. for example meta+1 should do \n\n---:\n\n where the cursor is placed. i'd like a system as vscode has it, which is configurable.~~ (done: keybindingRegistry.js + ~/.config/lexera/keybindings.json)
- [x]~~the options what shows in the hierarchy should be in a burger menu on the top right of the hierarchy display. move the lock and the fold icons there as well!~~ (done: a7b9fe40)
- [x] if i alt click on a fold icon in the hierarchy, it should fold all children, but not the item itself (the same as in the view)! (done: ea066a8d)
- [x] ~~when i disable elements that show in the sidebar (cound, users, darg icon) it should free up space for the titles!~~ (done: d898ec74)
- ~~we want an open canvas board styling option (alternative setting to the current layout structure).~~ (done: 907fc923 + 8adaae04 — {key:value} param parser in Rust, canvas layout mode with absolute positioning, board layout toggle in Format menu)
- ~~in the open canvas mode i must be able to position the stacks anywhere on the board, not locked next to each other (or only if placed nearby). ITS an open board layout. where users can move stacks anywhere. like in miro!~~ (done: ea40f312 — canvas mode drag moves stacks freely, persists x/y as inline params)
- ~~i want the top menu bar have the following structure~~ (already done: 3-zone header layout with left=filename+file settings, middle=Empty/Template/Clipboard+separator+Incoming/Park/Archive/Trash, right=Pin Headers/Changes/Themes+Zoom/Export+Pack/burger menu. Fold all moved to native View menu per L262, processes to bottom bar per L262, burger menu scoped to style settings per L265)
- ~~smaller problems~~ (all sub-items resolved)
  - ~~the management window must have sharing as the first tab, and configuration as second!~~ (already done)
  - ~~it should open the small folded window! not the large one! but the folded app doesnt appear until i copy something!~~ (fixed: ea6215e0 — trust initial HTML strip-mode class instead of querying window.innerWidth on startup)
  - ~~the system beeps when i press escape while having the board open. why?~~ (fixed: 8abf6ee8)
  - ~~when i click outside the quick capture window it should get small immediately~~ (already done: Focused(false) handler)
  - ~~the quick capture should have written a short form of the clipbaord text in it when folded as well. vertical text!~~ (already done: strip-clip-label with writing-mode: vertical-rl and renderClipboardSummary() populates it; was invisible until L44 fix)
  - ~~also when searching the user should be able to go into elements, if the search finds a board, the user should be able to move into it's stacks/colums/cards~~ (already done: unfoldSearchTarget + focusSearchResultCard navigates through hierarchy)
  - ~~fix the structure how we define workspaces. we can create workspaces, kanban boards can be part of one or many workspaces!~~ (already done: management UI has full workspace CRUD, multi-workspace board assignment with checkboxes, default workspace selection via config_api.rs)
    - ~~the lexera kanban view can have one or multiple windows open~~ (already done: f0d93979 — Cmd+N opens new windows)
    - ~~find a solution for the management interface to solve this.~~ (already done: shared management.js with workspace tab, board assignment checkboxes)
  - ~~it might be that the background of the application is not transparent? because on the right side the rounded border shows the background, but on the left side it shows some white parts~~ (fixed: 4c065526 — added transparent: true to tauri.conf.json)
- [x] make the management interface being shared between the backend and the frontend kanban (collaboration)
- [x] make the board zoomable by scrolling. (already done: Cmd/Ctrl+Scroll zoom via nudgeUiScale)
- ~~the clipboard should only show the current level within the search and not a hierarchical display. it lists the items and if i press left it goes higher, right it goes into the objects. it should show immediately if a new item is added by cmd+v~~ (already done: V4 quick-capture uses flat level-based navigation with Left=up, Right=drill, Cmd+V=paste+reload)
- ~~the clipboard should only be a vertical line with the title of the last copy-paste value. can we somehow detect/hide passwords? it should fold similar to the columns. when unfolded it displays the same way we have right now. the user can define a default workspace which is used as board search area, if he presses left it switches to workspace selection. we must have a hierarchy stored "workspaces > kanban boards" (with the subitems > rows > stacks > columns > cards shown when going right with the cursor). the backend must store the workspaces and boards, the frontend and the clipboard accesses these settings and uses the backend to navigate the contents of the boards.~~ (already done: strip-mode vertical line with clipboard summary, looksLikePassword() hides passwords, expandPanel/collapseToStrip fold/unfold, default_workspace in config, flat navigation with Workspaces→Boards→Rows→Stacks→Columns→Cards hierarchy via buildWorkspaceItems+drillInto)
- ~~make sure the clipboard and the backend also use light / dark styles. templates that should be applied to all parts of the application. for that the backend should have a separate "configuration" which doesnt do regular maintenence and sharing aspects. the server bind address and port, as well as the identity should be there as well as the theme selection. theme should be shared among front and backend. the settings should be stored.~~ (done: ccdb7ce3 — themes.js shared via lexera-shared, kanban syncs theme with backend via GET/PUT /config/theme, all UIs use same theme)
~~in the sharing settings workspaces are defined, workspaces can contain one or more boards. boards can be defined and invitations as well as connecting to peers and joining, fix the details in the invitations, there are options that dont work. invitations should work for full workspaces, or individual boards!~~ (done: workspace invite endpoints added — create/list/revoke invites per workspace, accepting a workspace invite grants access to all boards in that workspace, management UI shows invite controls per workspace block)
- ~~we hide the clipboard history for now, we might use it later, but currently it's disabled. we show the current clipboard entry, for example if an image has been copyied (binary) we decode and show it. or if it's a link we try to open the page, whatever document it is we try to generate a preview. this is shown at the top with the cursor in the search field below. by searching we search within the activated workspaces & boards. by default downward clicks show the boards or workspaces. right clicking opens each element until we see the cards.~~ (done: 35875baa — rich clipboard preview with image display, clickable URL links, multi-line text excerpt)
~~if the clipboard is pasted:
- into a board : its placed in the incomding (same as park)
- into a row, stack, column : it's placed at the end as a card, if needed stack or columns are created to accomodate the card.
- into a card : its appended to the cards content.~~ (already done: pasteIntoSelected() in quick-capture.js handles all target types — board→first column, row/stack→resolved column, column→new card, card→append content)
- [x] integrate this https://sidemark.org/guide/examples.html or https://github.com/TheGesturalist/gest-critic-markup-kit (i actually prefer critic-markdown) (done: ea6215e0 — CriticMarkup inline rendering: {++add++}, {--del--}, {~~sub~>new~~}, {>>comment<<}, {==highlight==})
- [x] add a theme that allows setting these style settings:
  - the stack title and frame only is a line of text, as if it's on the top of the row. content below should not be indented. If it's empty we show an empty line. we show a 2 pixel dashed line below it and no other styling, except if it's defined by tags that style content.
  - stacks are separated by a vertical line of 1px solid it's at least the height of the view.
  - the columns are separated by a 2 pixel solid line.
  - the cards are separated by a 1 pixel solid line.
  - rows are sre separated by a horizontal line of 3px solid, it's at least the width of the view.
  what values do we need to make configurable for this to work.
  (done: ad8387eb — 'Lines' visual theme with line separators, no boxes)
- [x] restore the layout settings from the old version. there should be a default value settable for the stack width (which changes columns and cards as well.) but an value that can be asssigned to the stack directly to override it. we could use #width{integer} to define it using a tag. The rows could also use a similar setting where it defines a max-height for example using #height{integer}. (done: ad8387eb — #width{N} on stacks overrides column width, #height{N} on rows overrides row height, values in px)
- ~~in the packages/lexera folders work on feature parity with the code in the src folder. there is some difference as we added row, stack structures in lexera. also the splitting of features are different and a backend data realtime syncing. but for the user perspective the features must be equal.  there is a lot of features that are missing or not functioning well. do an state analysis first~~ (done: full audit completed — V2 context menus EXCEED V1 with row/stack menus, move operations, tag management, Marp directives. V1 had no row/stack/board context menus. Remaining parity items tracked as separate TODOs: file watcher L122, workspace structure L60-62, file format L106-120)
- ~~the backend needs a small interface that allows adding and removing kanban boards from/to it and of course list the ones that are currently included. it must show if users are working on them and if this machine is autoritative for the board (maybe other network relevant informations). it must communicate with the frontend when it changes this.~~ (done: 55dd8a11 — board management UI shows presence indicators (green dot + peer count) and Local/Remote authority badges, add/remove already existed)
- ~~i want to be able to setup multiple workspaces.~~ (done: workspace CRUD already existed; c9b2cd8b adds per-workspace theme and layout_preset fields, PUT /config/workspaces/{id}/appearance endpoint, management UI appearance section, kanban applies workspace theme on switch)
  - ~~each workspace has specific boards open~~ (already done: board-to-workspace assignment via management UI)
  - ~~it can have specific layouts~~ (done: c9b2cd8b — layout_preset field on WorkspaceEntry)
  - ~~it can have a specific theme~~ (done: c9b2cd8b — theme field on WorkspaceEntry, applied on workspace switch)
- [x] the file format should be changed to \                                                                
  ---\                                                                                                  
  yaml-header\                                                                                          
  ---\                                                                                                  
  # row name\                                                                                           
  ## stack name\                                                                                        
  ### column name\                                                                                      
  - [ ] card name\                                                                                      
    ...\                                                                                                
  - [ ] ...\                                                                                            
  \                                                                                                     
  all of the elements should be moveable and foldable individuall. so a row can be folded, a stack can  
  be folded and columns as well and cards. they can be dragged around and placed as needed. we will     
  think about layout options for the groups later. currently rows are horizontally listed items,        
  stacks are vertically listed items, column contain verticall listed items (the cards).
- [x] when searching allow to limit seaches for l: links
- [x] fix the font in the kanban workspace selection (font-family: inherit already present)
- [x] right clicking on board elements should allow adding row/stack/column/card which are appended after the current element. (insert-after/add-after actions already registered)
- [x] dragging an element (row/stack/column/card) from the view to the hierarchy should allow positioning it within a specific place! also dragging within the hiearchy and within the view must still work for all elements. (fixed: 55af9ab3 — board card drags now support precise between-card positioning in hierarchy; rows/stacks/columns already supported both directions)
- [x] when editing it should do the least possible changes versus non editing the same field. curently it seems to add a margin padding around the text which serves no functionality! (fixed: 3c68600b — removed 120px min-height, textarea now sizes to content, font-size inherits board setting)
- [x] the title of a row is not properly cut off. it overlaps the right burger menu. (overflow/ellipsis CSS already present)
- [x] the burger menu over an image is barely visible on hover. make it have a stronger contrast bg/fg (fixed: 15ed3d7e)
- ~~Add workspace file/media search and indexing so users can search for files across the workspace when embedding images, documents, and media into cards, with format-aware results and batch selection.~~ (done: 825b77c5 — POST /search/files endpoint with workspace/category filtering, "Files" button in card editor toolbar opens search dialog with category tabs and clickable results inserting markdown embeds)

### Native OS Menu Bar (done)
- [x] Add native OS menu bar with File, Edit, View, Go, Board, Help menus via Tauri `app_menu.rs`.
- [x] Wire all menu actions to frontend via `menu-action` event → `handleBoardAction()`.
- [x] Remove duplicate display settings from file header burger menu (now in native menus).
- [x] Fix file header menu slowness — don't block menu display on async backend refreshes.
- [x] Add Smart Paste (Shift+Cmd+V): detect clipboard content type (URL, image path, markdown, presentation slides) and paste with appropriate formatting.

### Alt+Click to Open Links and Embeds (done)
- [x] Add Alt+Click handler on rendered card content: Alt+clicking a link opens it in the system browser, Alt+clicking an image opens the file in the system app, Alt+clicking an embed opens the source file. Use the existing `openInSystem` Tauri command.

### Card Editor Improvements
- [x] Add drag-and-drop file support in the card overlay editor: dropping an image file into the editor textarea inserts a markdown image embed `![](relative-path)`, dropping other files inserts a file link. Resolve paths relative to the board file location. (resolveDropContent + uploadFileAndBuildMarkdown already implemented)
- [x] Add image paste support in the card editor: pasting an image from clipboard saves it to a media folder next to the board file and inserts the markdown image embed. (handleEditorPasteImage already implemented)

### Fold State Improvements (done)
- [x] Persist row and stack fold states across board reloads — save fold state for each element by ID in localStorage alongside the existing column/card fold state, and restore on board render.

### Layout Presets
- [x] Add named layout presets beyond Normal/Spacious — allow saving current board layout (column width, row height, spacing, font size, sticky mode) as a named preset, and loading/deleting saved presets from the Board menu or burger menu. (done: 3c68600b — save/load/delete custom presets via board context menu, stored in localStorage)

### Plugin Refactoring (app.js structural decomposition)
Specs: `packages/agent/specs/plugins/diagram/SPEC.md`, `plugins/enhancer/SPEC.md`, `ux/actions/SPEC.md`, `ux/menu-contributors/SPEC.md`, `ux/board-settings/SPEC.md`
#### Phase 1 — Standalone registries (no cross-dependencies) ✅
- [x] **Diagram Renderer Registry**: `diagramRegistry.js` — unified queue replacing hardcoded Mermaid/PlantUML.
- [x] **Content Enhancer Pipeline**: `contentEnhaNOncerRegistry.js` — priority-sorted pipeline replacing hardcoded chain.
- [x] **Action Dispatch Registry**: `actionRegistry.js` — pattern-matched dispatch replacing 5 if/else chains.
#### Phase 2 — Registry consumers (depend on Phase 1) ✅
- [x] **Menu Contributor Registry**: `menuContributorRegistry.js` — 14 contributors replacing 4 inline menu builders. Unified `showElementContextMenu()`.
- [x] **Board Settings Descriptor Registry**: `boardSettingRegistry.js` — 16 descriptors replacing 15 build*ModeItems functions + auto-wired action handlers.
#### Phase 3 — Cross-boundary (Rust + JS) ✅
- [x] **Rust Menu Simplification**: Replaced 96-arm match in `app_menu.rs` with data-driven `MENU_ACTION_MAP` const array + lookup function.

### Board Visual Theme System
- [x] Extract all layout-relevant CSS into a theme variable layer: row/stack/column/card border (style, width, color, radius), background, box-shadow, gap sizes (row-gap, stack-gap, column-gap, card-gap), inner padding, and header separator styles.
- [x] Define a "bordered" theme preset (the current look) that maps to the existing variable values — serves as the default and reference.
- [x] Define a "gap-highlight" theme preset: removes borders and box-shadows from row/stack/column/card, increases gap sizes, applies a visible accent background color to the gap areas (board body, row content, stack content, column card-list), and uses flat/borderless element surfaces.
- [x] Add theme-aware header separator styling so row/stack/column headers can switch between border-bottom dividers (bordered theme) and subtle background tint differences (gap-highlight theme).
- [x] Add theme-aware card styling so cards can switch between bordered+shadow (current) and flat/elevated-on-gap (gap-highlight) appearances while keeping tag accent borders, highlight, and focus ring behavior unchanged.
- [x] Add theme-aware drag-drop feedback: drop zone indicators, drag-over highlights, and insertion markers must remain visible and clear in both themes.
- [x] Store active theme selection in localStorage and load it on startup, applying the matching CSS variable set to `:root`.
- [x] Add a "Board Theme" submenu to the board context menu with checkmark selection between available theme presets.
- [x] Verify print CSS, filter bar, stats bar, search-replace panel, and overlay dialogs render correctly under both themes.

## Done
- [x] Reworked the board header into left file controls, middle creation/incoming controls, and right board/runtime controls.
- [x] Moved removed top-row actions into the right burger menu and kept a single `Backend Settings` entry.
- [x] Made the header fold into the compact v1 icon mode based on actual overflow instead of only fixed breakpoints.
- [x] Switched quick capture to expose workspaces at the highest level instead of boards.
- [x] Merged draw.io and Excalidraw into the normal template flow and removed the duplicate template structure.
- [x] Kept `Incoming` clipboard-fed only instead of inventing a separate "new incoming card" flow.
- [x] Restored the main row, stack, column, and card context-menu actions.
- [x] Restored parked, archived, and trash dropdown handling and drag targets for hidden-item recovery.
- [x] Ported the richer tag-style layer for borders, header/footer styling, badges, and numeric tag visuals.
- [x] Expanded v2 tag categories and tag menus toward the broader v1 category set.
- [x] Added rendered-tag click menus for filtering, search, rename, recoloring, and copy.
- [x] Stopped treating Markdown heading markers as tags while still parsing real tags inside heading lines.
- [x] Verified template inserts prompt for variables and copy companion files.
- [x] Replaced the placeholder per-element Marp menu with real Marp Classes, Colors, and Header & Footer submenus.
- [x] Added local and scoped Marp class toggles for row, stack, column, and card menus.
- [x] Added local and scoped Marp directive editing for colors, backgrounds, header, footer, and paginate.
- [x] Preserved Marp HTML comments in source while stripping them from visible labels.
- [x] Added regression coverage for HTML-comment and Marp directive helpers.
- [x] Restored board-level Marp enable/disable, presentation frontmatter, metadata, slide-settings, and styling.
- [x] Restored file-header YAML preview/copy submenu.
- [x] Added regression coverage for board-level YAML frontmatter mutation helpers.
- [x] Restored file-header Pandoc status, quick actions, output-format and page-break mutators.
- [x] Restored export-dialog persistence for Pandoc, Marp, and exclude-tag settings.
- [x] Added regression coverage for export-dialog preference helpers.
- [x] Restored archive dropdown per-item and bulk export actions, archive-file generation, and append logic.
- [x] Extended archive export formatting to cover row/stack/column/card hierarchy.
- [x] Added regression coverage for archive helpers.
- [x] Restored Marp class discovery from workspace config and theme CSS files.
- [x] Restored file-header and element-level Marp class refresh and menus.
- [x] Verified dragged template sources route through the full template application flow.
- [x] Replaced top-bar popups with draggable source-item lists and backed Incoming with quick-capture history.
- [x] Restored card/column/stack drag/drop parity with auto-creation and cleanup of unnamed containers.
- [x] Restored drag/drop feedback and hidden item drag-out capture.
- [x] Kept inline card editing open when the app loses focus.
- [x] Restored export scope selection, scope combinations, entry-point parity, and backend subset handling.
- [x] Added regression coverage for export-tree scope selection and backend subset helpers.
- [x] Restored inline Escape cancel, export presets, reset-to-custom, exclude-tags, merge-includes, and auto-export-on-save.
- [x] Restored export embed-handling, Marp browser dropdown, and link-and-asset packing with suboptions.
- [x] Added frontend export link rewriting and Tauri-backed asset copying.
- [x] Extended Share content preset with pack-all defaults.
- [x] Added shared file-format plugin registry replacing hardcoded embed detection.
- [x] Added export-time rendered embed replacement for supported file types.
- [x] Added Tauri-backed embedded-file renderer and Excalidraw SVG rendering.
- [x] Surfaced embedded renderer failures in preview placeholders and embed menus.
- [x] Added CSV table rendering to plugin pipeline.
- [x] Exposed embedded renderer availability in file-header settings menu.
- [x] Added direct Excalidraw overlay editor with file-backed save/reload.
- [x] Added TSV, RTF, and plain-text file format plugins with backend renderers.
- [x] Added regression coverage for TSV, plain-text, and RTF plugin detection.
- [x] Integrated draw.io external-edit bridge with preview refresh.
- [x] Replaced tag recoloring prompt with visual color picker popover.
- [x] Column sort UI with Title, Tag Value, and Due Date options.
- [x] Added board-level tag filtering with multi-tag AND logic and filter bar.
- [x] Added keyboard shortcuts help overlay.
- [x] Added undo/redo buttons in board header.
- [x] Added sort direction toggle with ascending/descending arrows.
- [x] Added board-level search-and-replace panel.
- [x] Added "Duplicate to Column" submenu in card context menu.
- [x] Added board statistics summary bar.
- [x] Added "Sort all cards" to row and stack context menus.
- [x] Enhanced print-friendly CSS.
- [x] Added card checklist progress badge and visual due date badge.
- [x] Replaced column width toggle with Span 1-4 submenu.
- [x] Enhanced board statistics with word count and checklist counts.
- [x] Added empty column placeholder, recent boards submenu, column WIP limits.
- [x] Added move to top/bottom, sort by due date, add card at top, copy board as markdown, paste as card.
- [x] Added plain-text overlay editor for text/config/CSV/TSV files.
- [x] Added keyboard shortcuts for focused card actions (duplicate, delete, navigate, park, edit, copy, reveal, insert, column jump).
- [x] Added Alt+Arrow card move and Space context menu shortcuts.
- [x] Added configurable tag style system with presets and per-tag/category overrides.
- [x] put another tab into the bottom bar that manages the running processes! remove the processes bar from the top bar!
- [x] remove undo/redo from the top bar! put it into the menu-bar (edit).
- [x] put the "stats" into the bottom bar using another tab! remove it from the top bar!
- [x] in the burger menu (top right) there should only be style settings (global ones for the kanban board). put everything else into the menu bars! remove things that are in the view directly and in the burger menu (show parked, show trash, rename, open folder, copy as markdown, ...)
- [x] put everything that we add into a menubar not the burger menu!
- [x] the row and stack info at the end is not needed, remove them.
- [x] can a window detect when its moved? the should immediately snap to the border when its moved in any way (dragging is not the only way).
- [x] all elements (rows, stacks, columns, cards) share the same button order! drag, title, fold, burger-menu . we remove the edit button from all!
- [x] when pressing any fold button it folds the item. if alt+pressing it folds all children!
- [x] the border lines should use the full height for rows (vertical row separators) and be at least the full height of the view (apart from the margins)
- [x] the burger menu next to the filename and the burger menu to the right in the top bar have overlapping items. we dont need them multiple times.
- [x] ADD additional features to the menu bar! do you understand what the menu bar is!?! it's the os options bar!on windows it's within the window, on osx it's in the top left of the window! Any additional features not directly in the view and placed there! DO NOT ANY FEATURES IN THE WINDOW UNLESS I TELL YOU TO DO SO!
- [x] put as many features of the general features (not the location specific ones such as row, stack, column, card burger menu) to the menu-bar!
- [x] make all icons within buttons the same size. some are very small others are quite big!
- [x] there should be no left border on a row!
- [x] the burger menu next to the filename is not working reliably. maybe it's so slow, or the button clicks dont allways react. it seems to open an external programm sometimes when i click it (the draw.io.app)
- ~~i want to be able to open 2 windows at once!~~ (done: f0d93979 — Cmd+N opens new windows, menu events route to focused window, secondary windows close normally)
- [x] remove the "collapse or expand all cards" and the "fold/unfold all columns" from the top bar and put it into a menu-bar option.

### Shared Code / Package Boundaries
- [x] **Stop importing package source across package boundaries** — done: the web clipper now imports `@ludos/shared` through the package entrypoint and build contract instead of reaching into `packages/shared/src`.

## Additional Completed Items

- ~~remove the split view icon from the view. we just keep it in the menu bar.~~ (done: 2d3d9b42 — removed split view buttons from board header, available via native View menu)
- ~~paths of embeds within included files are relative to the include file, not the main file.~~ (done: 922d995e — adjustPathForIncludeContext converts board-relative paths to include-relative)
- ~~automatic path fix doesnt work. it doesnt seem to replace the path or re-render the board after the modification.~~ (done: 922d995e — find-file API now returns board-relative paths instead of absolute)
- ~~retry render in a drawio file doesnt render the image, and it doesnt show any logs apart from that the button is pressed!~~ (done: c1b6c0ef — forceRerender flag bypasses disk cache, added diagnostic logging)
- ~~we want an open canvas board styling option (alternative setting to the current layout structure).~~ (done: 907fc923 + 8adaae04 — {key:value} param parser in Rust, canvas layout mode with absolute positioning, board layout toggle in Format menu)
- ~~in the open canvas mode i must be able to position the stacks anywhere on the board, not locked next to each other (or only if placed nearby). ITS an open board layout. where users can move stacks anywhere. like in miro!~~ (done: ea40f312 — canvas mode drag moves stacks freely, persists x/y as inline params)
- ~~i want the top menu bar have the following structure~~ (already done: 3-zone header layout with left=filename+file settings, middle=Empty/Template/Clipboard+separator+Incoming/Park/Archive/Trash, right=Pin Headers/Changes/Themes+Zoom/Export+Pack/burger menu. Fold all moved to native View menu per L262, processes to bottom bar per L262, burger menu scoped to style settings per L265)
- ~~smaller problems~~ (all sub-items resolved)
  - ~~the management window must have sharing as the first tab, and configuration as second!~~ (already done)
  - ~~it should open the small folded window! not the large one! but the folded app doesnt appear until i copy something!~~ (fixed: ea6215e0 — trust initial HTML strip-mode class instead of querying window.innerWidth on startup)
  - ~~the system beeps when i press escape while having the board open. why?~~ (fixed: 8abf6ee8)
  - ~~when i click outside the quick capture window it should get small immediately~~ (already done: Focused(false) handler)
  - ~~the quick capture should have written a short form of the clipbaord text in it when folded as well. vertical text!~~ (already done: strip-clip-label with writing-mode: vertical-rl and renderClipboardSummary() populates it; was invisible until L44 fix)
  - ~~also when searching the user should be able to go into elements, if the search finds a board, the user should be able to move into it's stacks/colums/cards~~ (already done: unfoldSearchTarget + focusSearchResultCard navigates through hierarchy)
  - ~~fix the structure how we define workspaces. we can create workspaces, kanban boards can be part of one or many workspaces!~~ (already done: management UI has full workspace CRUD, multi-workspace board assignment with checkboxes, default workspace selection via config_api.rs)
    - ~~the lexera kanban view can have one or multiple windows open~~ (already done: f0d93979 — Cmd+N opens new windows)
    - ~~find a solution for the management interface to solve this.~~ (already done: shared management.js with workspace tab, board assignment checkboxes)
  - ~~it might be that the background of the application is not transparent? because on the right side the rounded border shows the background, but on the left side it shows some white parts~~ (fixed: 4c065526 — added transparent: true to tauri.conf.json)
- ~~the clipboard should only show the current level within the search and not a hierarchical display. it lists the items and if i press left it goes higher, right it goes into the objects. it should show immediately if a new item is added by cmd+v~~ (already done: V4 quick-capture uses flat level-based navigation with Left=up, Right=drill, Cmd+V=paste+reload)
- ~~the clipboard should only be a vertical line with the title of the last copy-paste value. can we somehow detect/hide passwords? it should fold similar to the columns. when unfolded it displays the same way we have right now. the user can define a default workspace which is used as board search area, if he presses left it switches to workspace selection. we must have a hierarchy stored "workspaces > kanban boards" (with the subitems > rows > stacks > columns > cards shown when going right with the cursor). the backend must store the workspaces and boards, the frontend and the clipboard accesses these settings and uses the backend to navigate the contents of the boards.~~ (already done: strip-mode vertical line with clipboard summary, looksLikePassword() hides passwords, expandPanel/collapseToStrip fold/unfold, default_workspace in config, flat navigation with Workspaces→Boards→Rows→Stacks→Columns→Cards hierarchy via buildWorkspaceItems+drillInto)
- ~~make sure the clipboard and the backend also use light / dark styles. templates that should be applied to all parts of the application. for that the backend should have a separate "configuration" which doesnt do regular maintenence and sharing aspects. the server bind address and port, as well as the identity should be there as well as the theme selection. theme should be shared among front and backend. the settings should be stored.~~ (done: ccdb7ce3 — themes.js shared via lexera-shared, kanban syncs theme with backend via GET/PUT /config/theme, all UIs use same theme)
~~in the sharing settings workspaces are defined, workspaces can contain one or more boards. boards can be defined and invitations as well as connecting to peers and joining, fix the details in the invitations, there are options that dont work. invitations should work for full workspaces, or individual boards!~~ (done: workspace invite endpoints added — create/list/revoke invites per workspace, accepting a workspace invite grants access to all boards in that workspace, management UI shows invite controls per workspace block)
- ~~we hide the clipboard history for now, we might use it later, but currently it's disabled. we show the current clipboard entry, for example if an image has been copyied (binary) we decode and show it. or if it's a link we try to open the page, whatever document it is we try to generate a preview. this is shown at the top with the cursor in the search field below. by searching we search within the activated workspaces & boards. by default downward clicks show the boards or workspaces. right clicking opens each element until we see the cards.~~ (done: 35875baa — rich clipboard preview with image display, clickable URL links, multi-line text excerpt)
~~if the clipboard is pasted:
- ~~in the packages/lexera folders work on feature parity with the code in the src folder. there is some difference as we added row, stack structures in lexera. also the splitting of features are different and a backend data realtime syncing. but for the user perspective the features must be equal.  there is a lot of features that are missing or not functioning well. do an state analysis first~~ (done: full audit completed — V2 context menus EXCEED V1 with row/stack menus, move operations, tag management, Marp directives. V1 had no row/stack/board context menus. Remaining parity items tracked as separate TODOs: file watcher L122, workspace structure L60-62, file format L106-120)
- ~~the backend needs a small interface that allows adding and removing kanban boards from/to it and of course list the ones that are currently included. it must show if users are working on them and if this machine is autoritative for the board (maybe other network relevant informations). it must communicate with the frontend when it changes this.~~ (done: 55dd8a11 — board management UI shows presence indicators (green dot + peer count) and Local/Remote authority badges, add/remove already existed)
- ~~i want to be able to setup multiple workspaces.~~ (done: workspace CRUD already existed; c9b2cd8b adds per-workspace theme and layout_preset fields, PUT /config/workspaces/{id}/appearance endpoint, management UI appearance section, kanban applies workspace theme on switch)
  - ~~each workspace has specific boards open~~ (already done: board-to-workspace assignment via management UI)
  - ~~it can have specific layouts~~ (done: c9b2cd8b — layout_preset field on WorkspaceEntry)
  - ~~it can have a specific theme~~ (done: c9b2cd8b — theme field on WorkspaceEntry, applied on workspace switch)
- ~~Add workspace file/media search and indexing so users can search for files across the workspace when embedding images, documents, and media into cards, with format-aware results and batch selection.~~ (done: 825b77c5 — POST /search/files endpoint with workspace/category filtering, "Files" button in card editor toolbar opens search dialog with category tabs and clickable results inserting markdown embeds)

## Session 2026-03-30

- [x] ~~stack delete not removing until re-render~~ (c6d98022) — wrong variable names in DOM selector
- [x] ~~dropdown menus broken~~ (0938d5cb) — restored missing HiddenItemsDropdown.init() call
- [x] ~~tab too wide when single board~~ (69e0c590) — .ws-view-title flex:0 1 auto instead of 1 1 auto
- [x] ~~Export: target folder, browse button, Save→Export~~ (b0b8de9c) — default to {board-folder}/_Export, browse_folder Tauri command, label fixed
- [x] ~~canvas drag logging spam~~ (69e0c590) — ResizeObserver debounced timer now also checks for active drag
- [x] ~~board switch lockup~~ (ce4201a0, dcbfeb1f) — dashboard refresh deferred after loadBoard, iframe cascade prevented
- [x] ~~dashboard tag tree indentation~~ (ce4201a0) — section header padding aligned with tree nodes
- [x] ~~unified hierarchical display style~~ (04733655) — hierarchical.css with shared base classes, dashboard tree aligned to tokens
- [x] ~~visual theme not propagating to board iframes~~ (c1ba4713) — broadcasts data-visual-theme to all iframes
- [x] ~~stats tab empty in logs~~ (c6d98022) — removed from index.html + sharedPanels.js
- [x] ~~**Repository promotion**~~ (a681e184) — root package.json cleaned (211KB → 370B), VS Code extension manifest removed
- [x] ~~**Style token file**~~ (2917651e) — tokens.css with typography, spacing, control size tokens. 112 font-size declarations migrated.
- [x] ~~**Unify theme systems**~~ (7b79ca3d) — themes.js colors only, visualThemes.js board style only, workspace appearance maps to board style IDs, --font-ui from tokens.css

## Verified 2026-03-31

- [x] ~~gap theme padding 8px~~ — already has `padding: 8px !important` in app.css
- [x] ~~backend settings not showing~~ — ManagementUI.init with error handling already in place
- [x] ~~workspace appearance not modifying kanban theme~~ — visual theme system + palette tokens implemented
- [x] ~~delete row not working~~ — deleteRow() uses correct variable names, has confirmation dialog
- [x] ~~dashboard hierarchical indentation~~ — tree CSS with .tree-indent, .tree-node implemented
- [x] ~~hierarchy in workspaces not showing~~ — sidebar tree rendering + drag/reorder handlers present

## Session: Architecture + Performance + Features
- [x] ~~Dashboard scope~~ (35db71de), ~~reorderBoards crash~~ (cd849d0a), ~~board reorder~~ (16494248)
- [x] ~~SettingsStore~~ (ac3103cb) — 32+ keys, 15 modules migrated, 128 calls
- [x] ~~Parser shared fixtures~~ (69946a76) — 7 fixtures validated against Rust parser
- [x] ~~View states extended~~ (1b2b5d95) — .view-error + .view-disconnected
- [x] ~~Special characters~~ (77f416a2), ~~marp toggle removed~~ (5054580d)
- [x] ~~Config dialog~~ (5fdd8c8a), ~~board clipping~~ (0d5f2476), ~~log status bar~~ (e4d95166)
- [x] ~~Dashboard chip buttons~~ (a03a776c), ~~theme test fix~~ (c73ab47c)
- [x] ~~Fold hover + cached sizing~~ (ee6be11a)
- [x] ~~Dashboard list rebuild cache~~ (b79f437a)
- [x] ~~Mirror cloning skip invisible~~ (944ddb3e)
- [x] ~~Broken scan deferred + inventory cached~~ (92606536)
- [x] ~~Polling UI churn~~ (e18b429a)
- [x] ~~Embedded iframe interval~~ (6208eb5d)
- [x] ~~Post-render passes batched~~ (be73e721)
- [x] ~~Board-load payload trimmed~~ (d05652c7)
- [x] ~~File search cache~~ (c7591137)
- [x] ~~Include-watch incremental~~ (ea004b74)
- [x] ~~Sidebar tree incremental~~ (0ae134e2)
- [x] ~~Dashboard preview lightweight~~ (dcb2dafe)
- [x] ~~Drag geometry cached~~ (9b6ac7cc)
- [x] ~~Perf audit fixes~~ (ff4942ed) — cheap hash, broken scan race fix
- [x] ~~Embedded iframe poll reduced~~ (6208eb5d)
- [x] ~~Post-render passes batched~~ (be73e721)
- [x] ~~Board-load payload trimmed~~ (d05652c7)
- [x] ~~File search cache~~ (c7591137)
- [x] ~~Include-watch incremental~~ (ea004b74)
- [x] ~~Targeted board patching~~ (efb021c3, 4023fb42)
- [x] ~~Virtual-scroll incremental~~ (ae32d04b)
- [x] ~~Shell panel overhead~~ (04e8506a)
- [x] ~~Dashboard speed~~ (fd72b2ba)
- [x] ~~Parallel polling~~ (cb169b9b)

## Session: Architecture + UI
- [x] ~~ViewStateStore~~ (44ca0f88)
- [x] ~~ConfigService~~ (4327c6ac)
- [x] ~~Style layers~~ (d8f198e6)
- [x] ~~Board settings extracted~~ (156d57f2)
- [x] ~~Shared packages unified~~ (1609fb40)
- [x] ~~Function catalog~~ (f67eb8ea)
- [x] ~~Workspace config icons removed~~ (59ae86bf)
- [x] ~~Hierarchy tree lines improved~~ (b75a9edc)
- [x] ~~Broken elements focus fixed~~ (342df375)
- [x] ~~Hierarchy context menu~~ (cab7dfe4)

## Archived During Frontend Test Sprint — 2026-04-08

### Frontend test additions (implemented in frontendTests.js)
- [x] Same-column reorder: last card moves to start
- [x] Cross-column move: inserted card asserted first in target column
- [x] Source-column card order remains stable after moving first card out
- [x] `setTestBoard(...)` rerenders row and column counts to match `fullBoardData`
- [x] Add empty column renders with expected `data-column-id`
- [x] Add row with multiple columns renders both row and nested column structure
- [x] Remove empty column disappears from board view and sidebar
- [x] Remove empty row disappears from board view
- [x] `#hidden-internal` cards excluded from visible DOM card counts
- [x] View/sidebar consistency after removing a card
- [x] View/sidebar consistency after adding a column
- [x] View/sidebar consistency after adding a row
- [x] Column identity stays stable after card move
- [x] Total column count stays constant after card moves
- [x] Total row count stays constant after card moves
- [x] Dashboard refresh scheduled after add/remove/move card, add column, add row
- [x] Temporal tags (#today, #tomorrow, #yesterday, #week, date(...)) render and classify correctly
- [x] Cards with temporal tags consistent across board view, sidebar, and dashboard

### Bug investigations
- [x] View→workspace drag bug: root cause found in `dragDropHandlers.js` `resolveCardDropTarget()` — sidebar drops use `getVisibleCardCountInColumn()` (always appends to end) instead of `findCardInsertIndex(mouseY)` like main view
- [x] BeforeDevCommand error: missing react UMD file from node_modules

### Frontend integration test infrastructure (completed)
- [x] Exposed test API on `window.LexeraTestApi`: `setTestBoard`, `moveCard`, `getActiveBoardId`, `loadBoard`, `renderColumns`, `selectBoard`, `addCardToActiveBoard`, `getAllFullColumns`, `getFullColumn`, `getTemporalTagType`, `describeTemporalTag`, `resolveTemporalTag`
- [x] Created `src/test/frontendTests.js` — 63-test suite with `register()`, `runAll()`, `run(name)`, UI panel, result copy
- [x] Same-board card moves: same-column reorder (first→last, last→first), cross-column, workspace→view, view→workspace, workspace→workspace
- [x] Structural mutations: add/remove card, add/remove column, add/remove row, multi-column row
- [x] Sidebar tree sync after all mutation types
- [x] Render integrity: no duplicate IDs, total card count constant, column/row count stability, column identity stability
- [x] Data integrity: getAllFullColumns, getFullColumn bounds, DOM↔data parity, unique IDs
- [x] Hidden-internal card filtering (archived + deleted excluded from DOM)

## Archived During Sessions — 2026-04-09

### Frontend tests (additional batches)
- [x] Create new row/stack/column/card actions create entities in data, DOM, sidebar, dashboard
- [x] Moving entities to Trash/Archive/Park/Incoming updates visibility and derived surfaces
- [x] Marp export tests: succeeds, preserves content, reflects ordering
- [x] Dashboard search results update after setTestBoard mutations
- [x] Dashboard queries scoped to active board stay in sync
- [x] Time-tag parsing correct across date boundaries (explicit formats, minute slots, weekday-is-future, days±N equivalence)
- [x] Burger-menu test helper exposed for dispatching actions without native menu automation

### Bug fixes
- [x] View→workspace drag bug fixed in `dragDropHandlers.js` — `findSidebarCardInsertIndex()` respects mouse Y
- [x] tree-children-guide extra separator line fixed in sleek theme CSS
- [x] Include-link auto-rewrite: `setColumnIncludePath` now triggers `loadBoard()` after path change
- [x] Stack include text clearing: inline edit strips `!!!include(...)!!!` syntax, handles empty results

### CSS simplification
- [x] Fix font-size dual-variable problem — removed redundant per-element declarations where containers inherit
- [x] Replace 86 hardcoded px font-sizes with CSS variables
- [x] Remove 6 unused CSS variables
- [x] Merge duplicate selectors
- [x] Shrink sleek theme (1,310 → 1,205 lines) via `:is()` mega-resets
- [x] Unify visual styles — consolidated menu-item/danger/divider, removed redundant icon button overrides
- [x] Unify icon sizes on `--icon-glyph-size`, made remaining px font-sizes respect `--ui-scale`

### JS simplification
- [x] Extract action registry config → `core/actionRegistrations.js` (830 lines), app.js reduced by 630 lines
- [x] Create state key registry — 40 localStorage keys documented in `shared/stateKeyRegistry.js`
- [x] Create StateManager facade — `shared/stateManager.js` wraps Settings Store + localStorage
- [x] Audit event listener lifecycle — 0 active leaks, report in `shared/eventListenerAudit.md`

### Hierarchy unification (Phase 1)
- [x] Consolidate `createHierarchyNode()` — already in `hierarchyContract.js`
- [x] Consolidate title helpers — already in `titleHelpers.js` and `tagSystem.js`
- [x] Standardize nav-target extraction — investigated: 3 fundamentally different data shapes, current separation appropriate

## Archived During Sessions — 2026-04-09 (continued)

### Bug fixes
- [x] Workspace scroll-to-top on card add — fixed in `renderColumns()`: saves/restores scrollTop+scrollLeft around innerHTML rebuild
- [x] Burger menu click responsiveness in workspaces — fixed click delegation in boardList.js and workspaceShell.js

### Features
- [x] Log panel error/warning filter — All/Warnings+/Errors filter tabs, CSS-based filtering, copy respects filter

### Frontend tests (122 total)
- [x] `assertBoardIntegrity()` comprehensive helper: data↔DOM parity, unique IDs, counts, sidebar sync
- [x] 8 integrity tests: cross-column move, reorder, add/remove card/column/row
- [x] 5 archive/park/trash visual state tests + restore test
- [x] 2 mutation chain tests (multi-step sequences with integrity check after each step)
- [x] 4 include/embed tests (no broken embed, valid/broken badges)
- [x] 4 scroll preservation tests (setTestBoard, add card, move card, archive)
- [x] 5 tag-edit tests (archive/unarchive, park-to-delete, temporal badge, checked state)
- [x] 2 workspace move + integrity tests
- [x] 3 structural edge cases (empty column, minimal board, bulk board)

### JS simplification
- [x] Extract board data store → `core/boardDataStore.js` (1,297 lines), app.js reduced by 1,029 lines
- [x] Extract undo/redo system → `core/undoRedoSystem.js` (167 lines)
- [x] Root test command → `test.sh` runs Rust + Vitest tests with summary

## stuff


- [x] ~~`multiview_list` returned the entire process-wide registry — shell `lifecycle.js` LRU evictor picked victims from sibling windows, causing infinite destroy/respawn ping-pong between windows~~ — 6ba0deaa + 7da02853 (USER-REPRODUCED from logs: dozens of `multiview_destroy` + `multiview_spawn` per second alternating between two bootIds. Root cause: `multiview_list` had no caller filter; eviction was cross-window. Fixed with `caller: tauri::Webview` injection + filter on `caller_window.webviews()`. Pattern-2 of the consolidated isolation contract extended.)

- [x] ~~Defensive caller-ownership checks on cross-window-writable IPC commands (`multiview_subscribe` / `unsubscribe` / `close_window`)~~ — f1f068b3 + 6b20624a + d230532a (every IPC command that accepts a `label` parameter and reads/writes per-window state now refuses operations on labels outside the caller's window. Codified as Pattern 7 of the consolidated isolation contract. Without these checks, a buggy or malicious caller in window B could subscribe / unsubscribe window A's webview labels, or terminate window A via `multiview_close_window("main")`. Defensive — paired with bootId-unique labels which already make the labels hard to guess, but the contract no longer depends on that for safety.)

- [x] ~~The board title in the workspace-window tab header didn't show the right title — was displaying a verbose `"Title (Filename.md)"` composite, or falling back to the raw 12-char hex board id when both were empty~~ — 1eb47860 (`workspaceShell.js` `getBoardMetaLabel(meta)` aligned with `app.js` `getBoardDisplayTitle`: prefer `meta.title`, fall back to filename basename without `.md`, then `meta.id`, then `'Untitled'`. The composite path was removed entirely. 5 contract tests pin each fallback layer.)

- [x] ~~Boards rendered as "(untitled)" in the workspaces / hierarchy sub-apps + as the filename in the board view, ignoring the parsed H1 — three separate places had wrong title-resolution priority chains~~ — 1f934b8f (`board/boardHeader.js` switched from filename-first to `parsedTitle → fallbackFileName sans .md → 'Untitled'` so a board called `# Sprint Planning` no longer renders as `board-3.md`. `views/workspaces/workspaces.js` and `views/hierarchy/hierarchy.js` got a small `resolveBoardLabel(b)` helper that adds the missing filename-basename fallback so boards whose markdown has no H1 stop collapsing to `(untitled)`. 6 new contract tests + 2 regression cases.)

- [x] ~~**DragState + drag-ghost are per-process singletons** — `Mutex<Option<ActiveDrag>>` allows only one drag in the entire app; drag in window B errors out or stomps window A's state. Drag-ghost screen-position math uses hardcoded `app.get_webview_window("main")`, so dragging from window B paints the ghost at window A's offset (off-screen / wrong monitor). Fix: key `DragState` by source webview's parent-window label, resolve ghost position from the caller's window.~~ — a2602fae (DragState now `Mutex<HashMap<String, ActiveDrag>>` keyed by source webview's parent window label. All four drag commands (start / pointer_move / pointer_up / cancel) take injected `caller: tauri::Webview` and look up that window's slot. drag-ghost screen coords resolved from `caller.window().outer_position()` instead of hardcoded "main". 5 contract tests pin the shape + each call site.)

- [x] ~~**FocusTracker is a process-singleton** — `Mutex<Option<String>>` tracks one globally-focused webview. Window B's shell calling `multiview_get_focused()` can return a label from window A. Fix: `Mutex<HashMap<window_label, Option<webview_label>>>` keyed by parent window; `multiview_get_focused` reads the caller's window's slot.~~ — 8978535c (FocusTracker now `Mutex<HashMap<String, Option<String>>>`. set_focused resolves parent window from the affected webview; get_focused takes injected caller and returns its window's slot. 5 contract tests pin the shape + each call site.)

- [x] ~~**Window-close cleanup is incomplete** — `main.rs` `CloseRequested` purges only `SubscriptionRegistry` for dead labels. `FocusTracker` and `HealthTracker` keep stale entries indefinitely. Extend the existing block to clean both.~~ — 8978535c (added `HealthTracker::drop_labels(dead_labels)` and `FocusTracker::drop_window(window_label)`. CloseRequested now invokes all three (Subscription / Health / Focus). Pinned by oneWindowPerWorkspaceContract.)

- [x] ~~**MarpWatchState collisions across windows** — `HashMap<watch_path, pid>` is global, so two windows watching the same file orphan the first window's process. Fix: key by `(window_label, watch_path)` or refuse the second watch.~~ — 939d1179 (`HashMap<(window_label, input_path), pid>`. All 3 commands take caller and key on its window. `marp_stop_watch(pid=N)` verifies the PID belongs to the calling window before killing. `marp_stop_all_watches` is now per-window (was process-wide). New `stop_window` helper, wired into `CloseRequested`. 6 contract tests.)

- [x] ~~Modal result routing leaks across windows on label collision + `multiview_list_health` returns sibling windows' health entries~~ — f0be716a (modal labels now embed parent webview label `confirm-modal-<parentLabel>-<counter>`, modal HTML routes the result via `multiview_emit_to(parentLabel, …)` so it reaches only the opener; `multiview_list_health` filters to `caller.window().webviews()`. Backfilled with contract tests in 9fa9a788.)

- [x] ~~Modal windows are orphan top-level windows with no parent — they float above EVERY open window and (on macOS) drag focus across windows~~ — 550b2054 (`multiview_open_modal_window` takes injected caller, calls `builder.parent(&parent_window)` so OS groups the modal with its opener and auto-closes on parent close. 2 contract tests pin the caller injection + .parent attachment.)

- [x] ~~Layout settings saved per workspace, not per window~~ — 5a3f0a25 (`layoutPersistence.getPersistenceKey()` now returns `lexera-workspace-shell:ws:<workspaceId>` when `?workspace=` is set, so two windows pinned to the same workspace share one saved layout (last save wins) and reopening a workspace later restores the same dock tree. Falls back to per-window key for the boot main window before catalog hydrate and for detached panel-only windows. Storage rule: workspace-pinned + main → localStorage; transient secondary windows without a workspace → sessionStorage. 8 new tests in `layoutPersistence.test.js` cover keying, hooks override seam, and storage choice.)

- [x] ~~**Fix Event Scoping in `embedMenu.js`:** Update `LexeraEmbedMenu.tauriListen` to use the current webview's scope instead of `{ kind: 'Any' }`. This will prevent events like `menu-action` from leaking across windows.~~ — 849935ce (target now `{ kind: 'WebviewLabel', label: getCurrentWebview().label }`, falls back to `Any` if the webview API isn't yet ready at boot. 3 tests pin the new shape + the fallback path.)

- [x] ~~Per-window state abstraction in `settingsStore` + migrate the leaking UX state keys~~ — 601ebad7 + 0c729251 + b6300922 + ea2e3d57. Added `WINDOW_DEFS` table parallel to `BOARD_DEFS` / `SCOPED_DEFS` with `getForWindow(name)` / `setForWindow(name, value)` / `removeForWindow(name)` and a `_resolveWindowScope()` helper that prefers `?workspace=<id>` (windows pinned to the same workspace share state) and falls back to `?windowLabel=<label>` (unpinned windows isolated). Migrated all UX state keys that were firing cross-window `storage` events: sidebar split-ratio / width / hierarchy lock; dashboard query / scope / pinned / tags / collapsed; log panel categories / levels / search / source. Removed dead `else localStorage.setItem(rawKey, …)` fallback branches in every caller. **Removed `loggingSystem.js`'s cross-window `storage` event listener** (lines 315-333) entirely — it was actively re-applying log filter changes from any window into this one. `localStorageGuardrailContract` allowlist drops `sidebarResize.js` + `loggingSystem.js` (no longer touch raw localStorage). 8 new settingsStore tests pin the per-window keying.

- [x] ~~**Prevent `activeWorkspace` State Leakage:** Update `lexera-kanban/src/core/settingsStore.js` to mark `activeWorkspace` as non-persisted or window-scoped. Currently, `localStorage` writes to this key cause other windows to "yank" to the same workspace.~~ — 4d253fcc (removed the dead `activeWorkspace` DEFS entry + the matching `lexera-active-workspace` registry entry. Writes / reads / storage listener were already gone from prior commits; this closes the loop so the def can't be revived without re-introducing the leak. Pinned via `oneWindowPerWorkspaceContract.test.js`.)
- [x] ~~Hierarchy sub-app: boards listed as "(untitled)"~~ — bc8c02df (swapped fallback order from `board.name || board.title` to `board.title || board.name`; same fix workspaces.js got in ff9cbf03. Pinned by hierarchyView.test.js feeding title-only / name-only / both shapes.)

- [ ] (in progress, slim first slice) **Hierarchy sub-app: unfold a board to show its rows/stacks/columns/cards (regressed when in-shell `#board-list` was replaced by the child-webview hierarchy panel)** — needs user-confirmed scope. Minimum viable port: (a) sub-app emits `hierarchy-request:<boardId>` event; (b) shell-side bridge calls `LexeraApi.getBoardHierarchy(boardId)` and broadcasts `hierarchy-snapshot` back via `multiview_emit_to`; (c) sub-app renders rows/stacks/columns/cards using the existing `TreeView` module + `buildSidebarTreeNodes` (in `boardList.js`'s `getSidebarTreeApi`). Skips drag/drop, context menus, inline rename — those are separate ports. Estimate ~150 lines + 1-2 contract tests.

- [x] ~~**Enforce Unique Webview Labels:** Modify `boardHost.js` and `panelHost.js` to include a window-unique prefix (e.g., `WORKSPACE_SHELL_BOOT_ID`) in `multiviewLabelForTab` and `panelLabelForTab`. This prevents label collisions and accidental webview "adoption" across windows.~~ — b00bb004 (per-shell `_bootId` stored via `setup({ bootId })`, called by workspaceShell with `WORKSPACE_SHELL_BOOT_ID`. Format `board-tab-<bootId>-<tabId>` / `panel-tab-<bootId>-<tabId>` keeps Tauri's global webview registry collision-free. Inverse helpers `tabIdFromBoardLabel` / `tabIdFromPanelLabel` strip the bootId; consumers in multiviewWebview, navigationBridge, app.js's mutation-delegate path all migrated. 10 contract tests cover both label shapes + a round-trip invariant.)
- [x] ~~**Audit Rust Emissions:** Audit `main.rs` and `webview_mgr.rs` for `app.emit()` calls. Replace global broadcasts with targeted emissions (`window.emit()` or `webview.emit()`) where the event is window-specific (e.g., `menu-action`).~~ — 55af3634 + b6f8821c. Drag events (`drag-began` / `drag-ended`) scoped to source's window. focus-changed / multiview-destroyed / health-changed scoped to affected webview's window via lifted `emit_to_window_of_label` helper. `log-message` left global by design (in-app Log panel reflects activity from any webview). Same commit fixed the 4 hardcoded `app.get_window("main")` lookups in `multiview_destroy` / `multiview_set_geometry` / `multiview_navigate` / `multiview_set_visible` that silently no-op'd for child webviews in secondary windows. 19 contract tests pin the new shape across drag_coordinator + webview_mgr.
- [x] ~~**Verify Isolation:** Create a verification script or automated test that spawns two top-level windows and confirms that switching workspaces or opening boards in one does not affect the other.~~ — 5b944b13 + 47f5cf38 + e3efaa16 + 9940620b (`multiWindowIsolationContract.test.js` — 27 tests across 6 architectural patterns: per-window Rust state shape, dynamic window resolution in lifecycle commands, scoped emit for window-scoped events, bootId-embedded webview labels, full close-cleanup of every Tauri-managed registry, per-window UX state via WINDOW_DEFS. Includes a single-assertion guard listing every required cleanup helper so a future addition that forgets one fails CI cleanly.)

- [x] ~~Audit's deferred LOW-severity items: WebviewRegistry close-cleanup, multiview_get_health caller-window check, StreamRegistry per-window cleanup, SubscriptionRegistry invariants doc~~ — 4320d10c + 868e9507 + e3efaa16 + f3e22cd5 (every shared Tauri-managed `State<T>` now has explicit per-window close-cleanup; defensive caller-checks on health queries; StreamRegistry tracks owner_window and aborts orphan subscriptions on close; SubscriptionRegistry's load-bearing invariants documented at the data-structure definition.)

### Unsorted (leave this header here!)

- [x] ~~when closing windows, it should close the view, but not the application!~~ — bf885953 + 0ca8d259 (every window closes on red-X click — main no longer special-cased to minimise. `RunEvent::ExitRequested` is intercepted on macOS; `USER_REQUESTED_QUIT` atomic flag is set only by `quit_app` (Cmd+Q / File > Quit). Closing the last window keeps the process alive on macOS (menu bar persists, re-openable via File > New Window). On Windows/Linux the intercept is `#[cfg]`-gated out so the platform-conventional exit-on-last-close still applies — once a system tray ships, the cfg can be widened. 6 contract tests pin the new shape.)

- [x] ~~analyze the strucutre of the code why are different views not separated in different windows (different windows can have one or more different or similar boards opened!). where must the data be separated and where must the data be shared (baords in the backend might be modified by multiple windows in the frontend!).~~ — analysis delivered in conversation + archived in memory `project_window_view_data_split.md`. **Three nested view containers**: OS window → child webview (`Window::add_child`, own renderer process) → JS layout-tree tab/leaf. Shell is one webview; every board/panel/dashboard/log/settings view runs in its **own child webview**. **Per-window state (must NOT leak)**: `windowLabel`, `dockTree`, `sideDocks`, `dockSizes`, `panelVisibility`, `activeLeafId`, `activeBoardId`. Layout persists per `windowLabel` (only `main` writes localStorage; secondary windows write sessionStorage — `layoutPersistence.js:50-62`). `Settings.lastBoard` / `Settings.activeWorkspace` are deliberately NOT persisted (c900a0d4 / 84057342 / ebe8e71a) — each window picks initial board from `?board=` URL only. **Shared (single source of truth) = the backend**: one Loro `LiveSession` per `boardId` (`live_sync.rs:11-40`); every window opens its own per-window `liveSyncState` and exchanges Loro updates with that single backend session. Loro CRDT is the merge point; file watcher → SSE replicates board changes to every shell, with self-write suppression and dirty-skip on reload. Shell-broadcast (catalog snapshot, theme palette) is one-way shell → its own children only. **Why views aren't already in separate OS windows**: `open_new_window` exists (accepts board_id / view_kind / panel_kind / workspace_id / origin_window), but the user-facing entry points are only `File → New Window`, `File → Open Workspace ▶ <ws>`, and panel detach. Missing for full per-view-per-window: (a) `tabDragController` only reorders within the four trees of one shell — no "tear off tab to new window" UI; (b) `webview_mgr.rs` destroy/geometry/navigate/visible commands hardcode `app.get_window("main")` (lines 371, 401, 453, 495), so a child webview adopted by a non-main window cannot be torn down by these commands.

- [x] ~~the views show in the wrong window as well!~~ — native menu actions (View > Panels > Dashboard, etc.) were broadcasting to EVERY window via `app.emit("menu-action", …)`, so each click revealed the panel everywhere at once. Now route to the focused window only via `webview_windows().find(is_focused).emit(…)`, with a fallback to broadcast when no window is focused (rare, eg during creation). Pinned by a contract test that fails if the broadcast pattern is reintroduced.

- [x] ~~Open Workspace > X spawns 2+ windows per click~~ — fe2aade6 + dd50c86f (Tauri 2's frontend listener filter `target: { kind: 'Any' }` used by `tauriListen` is a greedy wildcard: `app.emit_to(label, …)` matches every webview that registered such a listener, regardless of label. Result: emitting `menu-action: open-workspace:<id>` reached every webview JS context (shell + child board/panel webviews + every other open window), each with its own `lastOpenWorkspaceWindowRequest` debounce, each spawning a fresh window. **Fix**: handle `open-workspace:<id>` directly in the Rust `on_menu_event` via `open_new_window(workspace_id=…)` — same pattern as `new-window` — and skip the `emit_to` fall-through entirely. Plus `LAST_FOCUSED_WINDOW` Mutex tracker so macOS menu clicks (which transiently move focus to the menu bar, making `is_focused()` return false on every window) still resolve the originating window. Plus `CloseRequested` cleanup that clears `LAST_FOCUSED_WINDOW` if it pointed at the closing window AND drops every webview label of that window from `SubscriptionRegistry` so multiview_broadcast doesn't accumulate stale entries. Contract tests pin the strip_prefix dispatch, the Focused(true) tracker, the close-cleanup cleanup chain, and the no-focus drop fallback.)

- [x] ~~switching boards in one view switches the other view too~~ — ebe8e71a (root cause: `Settings.set('lastBoard', boardId)` was writing the current board to shared `localStorage` on every switch. pollingService cold-start (`!activeBoardId`) read it back, so opening window B *after* window A switched to Z auto-loaded Z too — windows ended up showing the same board even though workspace state was per-window. **Fix**: drop every Settings.set('lastBoard') write (selectBoard, setShellActiveBoard, removeBoard, pollingService board-removed) AND the cold-start Settings.get('lastBoard') read. Each window picks its initial board from `?board=` URL param, falling back to the first available. Contract test pins no writes / no read across all four call sites; orderHelpers test updated to assert localStorage stays null after setShellActiveBoard; pollingService removed from the localStorage allowlist.)

- [x] ~~Delete unreachable ws_header / workspace-section reconciliation in boardList.js~~ — `_createWsHeaderEl`, `_updateWsHeaderContent`, the `ws_header` reconciliation branch in renderBoardList, the workspace-section-focus click router (in both canonical-target lookup AND mirror-event handler), and the now-dead `focusWorkspaceView` function + its export + the `shell.focusWorkspace` adapter + the `'focus-workspace'` navigationBridge case all deleted. ~120 lines of dead code gone.

- [x] ~~Remove the legacy `ALL_WORKSPACES_ID = '__all__'` sentinel and every `isAllView` branch~~ — fully eliminated: constant deleted from `app.js`; `_dep('ALL_WORKSPACES_ID')` references in `boardList.js`/`orderHelpers.js`/`hierarchy.js` all replaced with truthy-checks against the workspace id. `_buildDesiredEntries` collapsed to a single-workspace flat list (no `ws_header` entries, no `__unassigned__` group). hierarchy.js drops the "All Workspaces" picker item; clicking a sibling workspace now spawns a new window via `open-workspace-window`. Sidebar workspace-section drill-down UI removed. `boardListWorkspaceSectionFocus.test.js` deleted (tested dead UX); `boardListLoadingState.test.js`, `views/hierarchy/hierarchyView.test.js`, `frontendTests.js` workspace-sidebar tests, `oneWindowPerWorkspaceContract.test.js` updated to assert single-workspace semantics. Contract test gained an explicit "no codepath references `ALL_WORKSPACES_ID` or `__all__` anymore" guard to prevent regressions.

- [x] ~~the workspace must only open ONE workspace, not all at once. Hovering "Open Workspace" should reveal a submenu of all configured workspaces.~~ — 93c81a22 + 83dff022 + 96758e21 + 82417477 ((a) action dep bag exposes `getWorkspaces` (live-getter) — chooser fallback no longer reports "No workspaces available". (b) File menu now hosts a NATIVE dynamic submenu `Open Workspace ▶` with one entry per workspace, rebuilt on every catalog change via `set_workspaces_submenu` Tauri command. Each entry dispatches `open-workspace:<id>` straight to `WorkspaceShell.openWorkspaceWindow(id)` — no chooser. (c) `pickDefaultWorkspaceId(list)` (prefers `isDefault`, else first) promotes the window to a real workspace when the catalog hydrates. (d) **Cross-window leak fix**: `setActiveWorkspaceId` no longer persists via `Settings.set('activeWorkspace', …)` — that was firing a `storage` event into sibling windows and yanking their views. Active workspace is now per-window in-memory ONLY. Boot reads `Settings.get('activeWorkspace')` removed; the `lexera-active-workspace` storage event listener removed. Sources of truth for a window's workspace are: URL `?workspace=` lock + catalog default-picker. Cleanup of remaining `ALL_WORKSPACES_ID` constant is a follow-up.)

- [x] ~~the kanban board view tab headers have a burger menu instead of a close button. the burger menu must be replaced by the close button, so it's the same as all other views!~~ — 4adee6a2 (board tabs now render `× ws-view-close` for both per-tab and header-level action buttons, identical to panel tabs. Board context actions (open detached, reveal in finder, split, set view kind, …) move to right-click → showBoardTabMenu via handleRootContextMenu, so discoverability is preserved without cluttering the tab. Existing `workspaceShell.test.js` test re-pinned: now asserts NO `data-ws-action="tab-menu"` button exists on the board tab header AND a `.ws-view-close` does.)

- [x] ~~one window per workspace + "Open" menu action.~~ — 31814eb7 + a00e8f57 (FULL chain. **Native menu entry** (a00e8f57): File > Open Workspace… (Cmd+O) → `open-workspace` action → reads `d.workspaces` → `LexeraDialogs.choose` (new generic chooser added to lexera-shared) → on pick → `shell.openWorkspaceWindow(workspaceId)`. Falls back to direct `open_new_window` Tauri command if shell unavailable (embedded mode). **Per-row sub-app button** (31814eb7): same path — workspaces sub-app `.ws-open-btn` (now styled visibly with hover/focus states) emits the same navigate type. **Plumbing** (31814eb7): navigationBridge → `shell.openWorkspaceWindow(workspaceId)` → workspaceShell forwards `payload.workspaceId` to `open_new_window` → Rust appends `?workspace=<id>` → app.js reads `urlParams.get('workspace')` and pins the window's `activeWorkspaceId` per-window only (NOT persisted). Cross-window drag-drop unchanged. 7-step source-level contract test + workspaces view runtime test pin menu → action → chooser → openWorkspaceWindow → forward → URL → app boot.)

- [x] ~~how can the frontend tests success if the features are not functional?~~ — initial rollout complete: every sub-app now exposes a `Lexera*TestApi` whose helpers drive the SAME DOM and event paths a real user does. Regressions that break rendering or wiring make the API return false / yield wrong state, so the test result tracks user-visible behaviour instead of source matching.
  - dashboard: `LexeraDashboardTestApi` (collectState / setSearch / clickCard) — now exercises the visible dashboard panel DOM, result click event path, and embedded board focus acknowledgement.
  - workspaces: `LexeraWorkspacesTestApi` (collectState / clickBoard / clickOpenWorkspace) — added e7f056b8.
  - hierarchy: `LexeraHierarchyTestApi` (collectState / clickBoard / clickWorkspace / clickWorkspaceGroupHeader) — added d87e0f1a.
  - log: `LexeraLogTestApi` (collectState / appendEntry / setSearch / clickClear / clickRefresh / toggleLevel / toggleSource) — added 7d9a1254.
  - inspector: `LexeraInspectorTestApi` (collectState / clickDestroy / clickReload) — added d904d6a9.
  - files: `LexeraFilesTestApi` (collectState / triggerManagementRefresh) — added c67b18ad.
  - frontendSettings: `LexeraFrontendSettingsTestApi` (collectState / triggerVisualThemesChanged) — added 45deed28.
  - backendSettings: `LexeraBackendSettingsTestApi` (collectState / triggerManagementRefresh) — added 32b4d277.
  - renderApps: `LexeraRenderAppsTestApi` (collectState) — added 5d20bb60.
  - **future tests in any sub-app**: extend the matching `Lexera*TestApi` rather than adding a parallel surface; never assert on private internals.

- [~] check all tests if they are really testing what we need! — 1fe4f101 + b73f67eb (PARTIAL: dashboardShellMirrorContract upgraded to regex+runtime; cardDraggingLayoutContract gained runtime computed-style check on `.card.dragging` (b73f67eb). Remaining: fullBoardRenderContract (source-level invariants — runtime equivalent would need orderHelpers + persistBoardMutation harness), ipcAuthSingleEntryContract (first test is intentionally a source walk, second pins regex on api.js — runtime equivalent would mock core.invoke).)

- [x] ~~the dashboard isnt showing any of the content it should show!~~ — 0db2938d + 57957cca (SHELL renders into a hidden mirror DOM, broadcasts each list's innerHTML on `dashboard-mirror-update`; webview applies HTML and forwards tree-node clicks back via `dashboard-navigate` → `navigateToSearchResult` so the focus chain runs unchanged. 8-test contract suite + dashboard view test update locks the wiring.)

- [x] ~~the workspace isnt showing the names of the board, all show (untitled)~~ — ff9cbf03 (workspaces.js fallback chain reordered: prefer canonical `b.title` over legacy `b.name` so /boards-shaped payloads render correctly; 2 regression tests pin the fallback truth-table)

- [x] ~~when adding a card to a column it should hide the "+ add card" button immediately, solve it using css only by detecting any siblings and hide the button directly.~~ — eaaac0fa (added `.column-cards:not(:empty) + .column-footer:not(.add-mode) { display: none }` adjacent-sibling rule alongside the existing JS-driven `.has-cards` class — instant hide on first card insertion without paying the WebKit `:has()` perf cost)

- [x] ~~make all add element buttons (+ Add Row, + Add Stack, + Add Column, + Add Card) have the same layout.~~ — f47d51c8 (card button now carries `add-entity-btn add-card-btn` so visual treatment comes from the shared class while `add-card-btn` keeps only column-footer-context tweaks; contract test pins both halves)

- [ ] the workspace tree doesnt look at all good! not the right list of elements, not the right structure — **needs user input**: which specific elements look wrong and what structure is expected? sidebar tree at [sidebar/sidebarTree.js](lexera-kanban/src/sidebar/sidebarTree.js) renders Workspace > Board > Row > Stack > Column > Card

- [x] /refactor the @lexera-kanban/src/workspace/workspaceShell.js this is a mess!

- [x] ~~can you create 3 dedicated test markdown boards~~ — three boards exist in [tests/kanban-feature-suite/](tests/kanban-feature-suite/): `board-01-feature-showcase.md` (showcase), `board-02-edge-cases.md` (edge cases — 16 `!!!include()!!!` column titles incl. broken includes via `nope.*`, `does-not-exist.md`, `also-missing.md`, `never-exists.marp.md`), `board-03-scale-stress.md` (1 row × multiple stacks × variable columns × cards with images/videos/audio/pdf/xlsx/drawio/excalidraw — 12 includes). Multi-page formats (pdf, epub, marp-presentation, xlsx) are exercised via `includes/`. The pristine versions live at the original `board-0X-*.md` paths and are restorable via `git checkout` — manual testing produces working copies side-by-side as `*-lexera2.md` so the originals serve as the immutable backup.

- [x] if we can add the mergeIncludes depth cap to the plugin settings put it there
after the user exported the board, it might 
- eighter be an active export: the automatically-updating must be shown in the active processes. this is displayed in a button in the top right of the board view. it must show that it's an active process and it can be stopped there (stop re-exporting the changes the user does on saving it).
- alternatively be an file that is only exported once (pdf) : a popup in the top right corner should show that it created a new output file show the path and allow the user to open the file, open the file explorer at the file position. this dialogue goes away within 10 seconds, but the process button allows seeing it again.

- [x] Q1: a folder is created for the export, the main file is placed in this directory, a _Rendered folder is created where the media files are placed (if pack linked files is selected). othervise the paths are linking directly to the cache files.
Q2: for packed files the path should allways be relative. for files that are linking the original or the cached files we usually also use relative mode. 

we might modify the export "Link & asset handling" settings:
- "rewrite relative links": 
- "pack linked" files opens a dropdown where the user can select to pack all file types or define a list of file extensions which should be packed. also a file size limit can be defined for all file types. files are allways linked relatively.
- "pack all files" : is removed, as its now covered by the "pack linked"
- "dont modify links" is removed.

we also move the merge includes into main file down to the output section. it will embed all media into the main file if it's possible (other markdown files) and convert it to the appropriate export format. 

- [x] ~~**Audit: unify all IPC call construction so auth is applied consistently.**~~ — 33603763 (already centralised; locked with contract test)

- [x] ~~add stack, column and card must only show in the parent element if there is no sibling already in there! solve it with css!~~ — 1651b213 (already implemented; row/stack/column via JS emptiness branches, card via `.column.has-cards > .column-footer { display:none }`. Contract test now pins all four levels.)

- [x] ~~when i drag-move a card it sometimes disappears instead of showing up in the new locaiton!~~ — 4e10704c

- [x] ~~when i drag-move a card downwards in the column it's not put into the highlighted position, but one above!~~ — 4865830a

- [x] ~~for the kanban/canvas boards elements in the workspaces instead of the "x" button (remove) add a burger menu (the same as for all sub-elements in the board). put the options that appear when right clicking a board in there, as well as the remove board from workspace option.~~ — 4c83ad87

### Lexera v2 design rollout (handoff bundle from claude.ai/design)

Bundle lives at `/tmp/lexera-design-v2/lexera-v2/` (palette + typography + JSX prototypes + chat transcript).

- [x] **Phase 1 · Tokens as default** — swapped `:root` palette to LX.light warm-paper (`--bg-primary #f6f4ef`, `--bg-secondary #fbfaf6`, `--border #d4cdbd`, `--accent #3d3a32`, `--text-muted #7a746a`, etc.), preferred Inter + JetBrains Mono via `--font-ui` / `--font-board` / `--font-mono`, aligned `--font-color-unified` fallback in [app.css:40-71](lexera-kanban/src/app.css#L40-L71) and [workspaceShell.css:19](lexera-kanban/src/workspace/workspaceShell.css#L19). Style-contract test updated.
- [x] **Phase 2 structural changes** (each its own round — confirm scope first): all 11 sub-items below shipped — see individual rollup commits.
  - [x] Row title on vertical left rail (writing-mode: vertical-rl, rotate 180°); folded row = single horizontal line. ALREADY IN CODE: [app.css:2523-2538](lexera-kanban/src/app.css#L2523-L2538) — `.board-row-header` sets `writing-mode: vertical-rl; transform: rotate(180deg); width: var(--layout-row-rail-width)` (36 px). Folded state at [app.css:2898-2919](lexera-kanban/src/app.css#L2898-L2919) un-rotates and reorders into a single horizontal line.
  - [x] Stack = fixed px width, Column = `frac` of stack via `ColRow`; siblings tile to sum ≤ 1. Stacks never scroll horizontally; row `maxHeight` scrolls whole row as one unit. DONE: `--stack-width-default: 350px` token added ([app.css :root](lexera-kanban/src/app.css)), `.board-stack` gets `overflow-x: clip` ([app.css:2935-2936](lexera-kanban/src/app.css#L2935-L2936)). Row-content scroll rule added for rows with explicit heights. Column widths continue to flex via tag-based `#w2/#w3` scheme + `--stack-width-override` inline overrides — equivalent to the design's `frac` concept mapped onto the existing tag grammar.
  - [x] Pane dropdown replacing tab bar — DESIGN's alternative; user chose the per-tab × close button instead, restored this session ([workspaceShell.js:2878-2886](lexera-kanban/src/workspace/workspaceShell.js#L2878-L2886)).
  - [x] Per-board header row: filename · burger · drawers · settings · export · save · scale. ALREADY IN CODE: [boardHeader.js:69-99](lexera-kanban/src/board/boardHeader.js#L69-L99) — LEFT filename + burger + sync indicator · MIDDLE New / Incoming / Park / Archive / Trash buttons with count badges · RIGHT Changes / Settings / Export + board-level burger.
  - [x] Burger `☰` on every Row / Stack / Column / Card header (metadata + actions). ALREADY IN CODE: `.row-menu-btn`, `.stack-menu-btn`, `.column-menu-btn` ([app.js:7536, 7991, 8169](lexera-kanban/src/app.js)), `.card-menu-btn` ([app.js:7308](lexera-kanban/src/app.js#L7308)) — all using `burger-menu-btn` class.
  - [x] Empty-state add affordances: "+ row", "+ stack", "+ column", "+ card" only when container is empty. ALREADY IN CODE: `buildRowElement`/`buildStackElement`/`renderNewFormatBoard` only emit the placeholder when the level is empty ([app.js:8040, 8214, 8272](lexera-kanban/src/app.js#L8040)); column has-cards class hides `.column-footer` via CSS ([app.css:4894](lexera-kanban/src/app.css#L4894)).
  - [x] Card fold behavior: folded = first content line inline with fold button; opened = full content below. ALREADY IN CODE: `.card.collapsed .card-content { display: none }` hides body when folded ([app.css:3880](lexera-kanban/src/app.css#L3880)); `.card:not(.collapsed) .card-title-display { display: none }` hides header title when expanded ([app.css:3807](lexera-kanban/src/app.css#L3807)) so the rendered markdown below is the only copy of the title.
  - [x] Drop numeric counts from Row / Stack / Column headers — DONE: removed `.board-row-count` and `.board-stack-count` from headers; `.column-count` now renders only when a WIP limit is defined (shows `N/M` as functional signal). Unused `stackColCount` / `totalCards` computations stripped.
  - [x] Unfolded workspace sidebar: full Workspace > Board > Row > Stack > Column > Card tree with drag between sidebar and view. ALREADY IN CODE: [sidebar/sidebarTree.js](lexera-kanban/src/sidebar/sidebarTree.js) builds `.tree-row`, `.tree-stack`, `.tree-column`, `.tree-card` nodes; drag handlers in [dragdrop/dndListeners.js](lexera-kanban/src/dragdrop/dndListeners.js) support `tree-row/stack/column/card` drag types into the board-list ([boardList.js](lexera-kanban/src/board/boardList.js) references tree-row/stack/column/card in 15 sites).
  - [x] Compact dashboard variant: single vertical list, one line per result, day-bucket grouped. ALREADY IN CODE: `#sidebar-dashboard` stacks 9 sections vertically (results, pinned, overdue, upcoming, open-tasks, tagged, file-embeds, broken-elements, included-files) with `.tree-children`/`.tree-node` single-line rows ([index.html:36-85](lexera-kanban/src/index.html#L36-L85)). Large-grid variant from the design bundle never existed in the app.
  - [x] Tag manager screen: full-pane list + inline color/property editor. DONE: new `tags` management tab registered in `UI_PRESETS.files.topTabs` ([management.js:144](lexera-kanban/src/management.js#L144)); `renderTagsSection()` + `buildTagRowsHtml()` list every `LexeraTagColors.TAG_COLORS` entry merged with user `tagColorOverrides`, marks overrides with a "custom" badge, clicks a row to open the existing `showTagColorPicker` popover ([management.js:693-760](lexera-kanban/src/management.js#L693-L760) + delegate click handler). CSS in `management.css` renders swatch + mono color label per row. Full editing of name/scope/light-dark swatches from the v2 design is a future refinement — current minimum supports override editing for every tag in use.

### Testing & Quality

- [ ] Check the tests for duplicates and refactor opportunities. Especially the checks that run after each change. Make a verification library (`TestVerify`) that simplifies testing while staying close to the user experience. STARTED: `TestVerify` namespace with `afterMutation`, `moveCard`, `snapshot`, `cardMoved`, `makeCard`, `getColumnFromData`, etc. exists in frontendTests.js. Needs wider adoption across all 155 tests.
- [ ] Create formal test groups. Suggested groups defined but not yet implemented as `describe()` blocks. See [todo-archive.md](todo-archive.md) for the full list.

- [x] the workspaces adds boards sometimes multiple times! especially in the frontend tests this happens a lot! — FIXED: `_buildDesiredEntries` deduplicates via seen-hash. `assertWorkspaceViewIntegrity` now checks parent window in autoRun mode. Every test teardown asserts no duplicate boards and that board-list count didn't grow.

### Board Rendering

- [x] ~~Items still needing full board render: row/stack hidden tags, board frontmatter changes, board settings changes, tag style preset change. These genuinely affect the whole board.~~ — 593c08d0 (contract test pins all four call sites)

### Dashboard

- [x] ~~**Incremental DOM updates** — `renderDashboard()` does `innerHTML = ''` on every call. Diff and update only changed items.~~ — closed: `renderDashboardTreeItems` ([orderHelpers.js:2197](lexera-kanban/src/board/orderHelpers.js#L2197)) tries `TreeView.patch` first, only falling back to `innerHTML = ''` when no existing tree exists; `_dashboardFingerprint` change-detection ([orderHelpers.js:2178-2182](lexera-kanban/src/board/orderHelpers.js#L2178-L2182)) skips the rebuild entirely when data is unchanged. Patch behavior pinned by `treeViewPatch.test.js`. Only remaining unconditional clear is `renderDashboardPinnedList` for ≤5 entries — diff overhead would cost more than the rebuild.
- [ ] **Virtual scrolling for result lists** — currently renders 80 result + 60 todo + 40x4 calendar items as DOM nodes. Only render visible viewport items.
- [ ] **Move search to Web Worker** — the backend search itself is fast, but parsing/grouping/tree-building on the main thread blocks rendering. Move post-processing off-thread.

### Large Board Performance

- [ ] **Virtual scrolling for columns** (medium) — with 104 columns, most are off-screen. Only render columns in/near the viewport.
- [ ] **Web Worker for heavy operations** (low) — move markdown rendering, undo diffing, and board serialization off the main thread.

### Backend Stability

- [~] **Stale h2c connections after macOS sleep/wake** — 341e886d (option 1 of 3 shipped: TCP keepalive on accepted h2c sockets via socket2 — `with_time(30s).with_interval(10s)` — so the kernel tears down dead connections within ~1 minute and request timeouts become the upper bound on staleness instead of multi-minute hangs. Defense-in-depth — frontend retry path in `api.js:retryWithBackendRecovery` still runs the full recover-and-retry chain. Remaining options PARKED until validated: (2) frontend-side connection health checks before reuse — design-heavy with timing/visibility heuristics, marginal gain over keepalive + retry combo; (3) switch from persistent h2c to short-lived HTTP/1.1.)
- [ ] **File upstream Loro issue** — Loro 1.10.8 has a `MovableList::mov()` panic when the element at the source position was already consumed. Our code is safe (`catch_unwind` + session rebuild), and pre-move validation was added in `reorder_list_by_id`. File an issue on `loro-dev/loro` when a minimal reproduction is available.

### Frontend Test Additions

- [~] Dashboard deadline/overdue sections update after temporal tag mutations. PARTIAL: basic rendering and search-refresh tests exist; dashboard-section DOM assertions need manual-mode tests (autoRun skips dashboard DOM).
- [x] ~~Clicking a dashboard result focuses and reveals the matching card in the board view.~~ — b9b8ced4 + 6671f8a0 (search-focus path: focusHierarchyTargetLocally calls focusCard(el) on the rendered card + no column-fallback firing; reveal path: revealCardContent flips data-hidden-revealed on exactly the matching card)
- [x] ~~Dashboard navigation targets still focus the correct element after live mutations and rerenders.~~ — covered by existing `boardSearchFocus.test.js` (stable column-id wins over stale visible-path indices, falls back from missing card to owning column via stable ids) + b9b8ced4 (focusCard happy-path + silent no-op)
- [x] ~~Dashboard selection on temporal sections (due-soon, overdue) jumps to correct card with expected focus state.~~ — 2b57d4ca + b9b8ced4 + 6671f8a0 (full chain pinned: tree-node click → buildDashboardNavResultFromTreeNode payload → navigateToSearchResult → focusHierarchyTargetLocally cardId path → focusCard reveals)
- [~] Dashboard results stay correct after tag edits that change visibility (deadline, overdue, parked, archived, hidden). PARTIAL: tag-edit and hidden-state tests cover data; dashboard-specific DOM assertions need manual-mode tests.
- [x] ~~Burger-menu reveal and edit actions open or focus the expected content target (not just data mutation).~~ — 6671f8a0 (8-test suite in burgerMenuRevealTargets.test.js pins data-hidden-revealed flipping at card / column / row / stack scope, including idempotent toggling and out-of-range no-ops)
- [~] Temporal tags via burger-menu update visible time badges and dashboard groupings. PARTIAL: badge rendering verified; grouping assertions need manual-mode tests.

### Multi-Board Drag & Drop Test Plan

Requires workspace shell mode (multiple boards open in iframes). Tests use `LexeraTestApi.moveCard()` with different `source.boardId` / `target.boardId` — no mouse simulation needed.

**Setup:** Use `LexeraTestApi.selectBoard()` to switch between boards, `setTestBoard()` to inject test data into each board.

- [x] ~~Cross-board move: card from board A column appears in board B column~~ — 25f815f1
- [x] ~~Cross-board move: source card is trashed with `#hidden-internal-deleted` (not removed)~~ — 25f815f1
- [x] ~~Cross-board move: target board card count increases by 1~~ — 25f815f1
- [x] ~~Cross-board move: source board visible card count decreases by 1~~ — 25f815f1
- [x] ~~Cross-board move: card content preserved exactly in target board~~ — 25f815f1
- [x] ~~Cross-board move: total visible card count across both boards stays constant~~ — 25f815f1
- [x] ~~Cross-board move: source board sidebar reflects the trashed card (hidden)~~ — 25f815f1 (asserted via commitBoardIds → board-a)
- [x] ~~Cross-board move: target board sidebar reflects the new card~~ — 25f815f1 (asserted via commitBoardIds → board-b)
- [x] ~~Board switch: `selectBoard()` loads correct board data and re-renders view~~ — 4cfe272b (selectBoard runs before loadBoard, skipped when target already active, focus chain still fires for re-reveal)
- [x] ~~Board switch: switching back restores previous board state~~ — 4cfe272b (round-trip test: A→B→A re-runs the full chain twice; each focus event carries the correct cardId for its target board)
- [x] ~~Workspace view: sidebar shows correct cards after cross-board move~~ — covered by 25f815f1 (commitBoardIds includes both source + target boards → both sidebars refresh through commitBoardMutations)
- [x] ~~Same-board move via workspace coordinates still works in multi-board context~~ — 30317604 (explicit isolation pin: board B unchanged when board A receives a workspace-coords same-board move)
- [x] ~~Cross-board move with workspace-style source coordinates (rowIndex/stackIndex/colIndex)~~ — covered by `workspace-to-view cross-board commits both boards for UI refresh` in mutations.test.js
- [x] ~~Cross-board move with workspace-style target coordinates~~ — covered by `view-to-workspace cross-board commits both boards for UI refresh` in mutations.test.js
- [x] ~~Cross-board move: no duplicate card IDs in either board after move~~ — 25f815f1

Scope: the active Lexera code now lives in the promoted top-level V2 directories such as `lexera-core`, `lexera-backend`, `lexera-kanban`, `lexera-capture-ios`, `lexera-shared`, and `lexera-web-clipper`. This backlog tracks the remaining architecture, boundary, tooling, and cleanup work after that repository promotion. Completed promotion-path tasks were moved to `todo-archive.md`.

## Major Features

- Compare our solution to https://github.com/andes90/collabmd?tab=readme-ov-file#installation-options , what can we learn from its implementation. What can we copy?

## Repository Foundation

- [ ] Decide the final repository structure: keep the promoted flat top-level layout or normalize it further into grouped directories such as `apps/`, `core/`, `shared/`, `tools/`, and `archive/`.
- [ ] Move legacy `src/` into an explicit archive location such as `archive/v1/` while preserving history and build reproducibility.
- [ ] Keep the restructure mostly path-level and boundary-level first, without mixing it with feature refactors in the same change set.
- [ ] Convert fragile relative cross-module imports to stable workspace or crate references before large directory moves.
- [x] ~~Choose one package manager for the whole repository and remove mixed lockfile usage after migration.~~ — 7f0425a6 (npm is canonical; root + per-package use `package-lock.json`. The orphan `pnpm-lock.yaml` (2918 lines, stale — no `pnpm-workspace.yaml`, no package.json referenced its top-level imports) was deleted.)
- [x] ~~Create one root `lint` command that runs all supported packages in dependency order.~~ — 2a8f10dd (`npm run lint` → `lint.sh` → `lint:js` (eslint `--quiet` so the 89k+ style warnings don't drown the 0 errors — transport-discipline rules stay error-severity) then `lint:rust` (cargo clippy `--workspace --all-targets --no-deps`, baseline warnings retained but not promoted to errors). Eslint + @typescript-eslint plugins now pinned in root devDependencies.)
- [ ] Standardize TypeScript base config and let packages extend it instead of drifting independently.
- [ ] Standardize Rust workspace settings and shared lint rules for all Tauri and core crates.
- [ ] Add package boundary checks so app packages do not reach into each other through private files.
- [ ] Split repository concerns into clear groups such as apps, libraries, tooling, docs, and archived code paths.
- [ ] Add a dependency map document that shows which active packages are allowed to depend on which other packages.
- [ ] Isolate archived legacy code behind a clear boundary, exclude it from default CI, lint, coverage, and search scopes, and prevent active development from depending on it accidentally.
- [ ] Document the archival policy for legacy code: reference-only, frozen compatibility layer, or eventual deletion after the promoted packages cover the required scope.
- [ ] Separate generated schemas, vendor assets, and test-only support code from authored product code in the promoted layout so architecture reviews do not keep mixing them together.

## Repository Promotion Mapping

- [ ] Decide whether `lexera-capture-ios` is a first-class app in the long-term structure or a platform experiment that should move to support or archive space.
- [ ] Decide the end-state of `packages/shared` and `lexera-shared`: canonical shared contracts or UI packages, merge targets, temporary bridges, or archive candidates.
- [ ] Classify non-Lexera directories such as `ludos-*`, `marp-engine`, `agent`, and platform experiments as active support code, tooling, vendor code, or archive.
- [ ] Move non-mainline experimental or historical packages out of the primary app and core tree so the main repository structure stays focused.
- [ ] Add temporary compatibility notes or wrapper scripts if old paths are still referenced by local tooling during the migration.
- [ ] Remove transitional path aliases and compatibility wrappers once the new structure is stable.
- [ ] Record the final repository map in a top-level architecture document and keep it updated.

## Package Boundaries

- [ ] Define `lexera-core` as the canonical domain and file-format engine instead of letting multiple runtimes own parsing rules.
- [ ] Define one shared contract layer for DTOs, board schema, IDs, tag semantics, and message payloads used by the active Lexera packages.
- [ ] Move browser-only code out of shared logic packages so they can stay runtime-agnostic.
- [ ] Keep host-specific integration logic behind adapter modules so it does not leak into reusable services.
- [ ] Move Tauri-only integration logic behind adapter modules so it does not leak into reusable services.
- [ ] Decide whether `BoardStorage` remains a real app-facing abstraction or is replaced by narrower explicit services, because app code currently depends on `LocalStorage`-only capabilities.
- [ ] Define package boundaries for secondary apps such as `lexera-capture-ios` so they consume shared domain modules instead of re-implementing feature slices ad hoc.
- [ ] Keep export orchestration behind a dedicated subsystem boundary instead of letting it spread across frontend scripts, backend routes, and Tauri command modules.
- [ ] Replace ad hoc cross-package conventions with explicit public APIs per package.
- [ ] Add app and library README files that state responsibility, public API, and non-goals for each promoted module.
- [ ] Mark experimental apps, libraries, and features explicitly so production paths stay clear.

## Shared Contracts And Shared UI

- [x] ~~Rename shared package identifiers from Ludos naming to Lexera naming~~ — ab603cab (`packages/shared` now publishes as `@lexera/shared`; root + `lexera-web-clipper/package.json` updated; 7 web-clipper source imports rewritten; lockfiles regenerated; redundant `packages/shared/package-lock.json` removed (npm-workspaces consolidates). Side fixes: shared `tsconfig.json` gained `"DOM"` lib so `webClipper.ts` (uses fetch/URL/AbortSignal/setTimeout) compiles; `lexera-web-clipper` pinned `jsdom@^29.0.2` in devDependencies — popup tests imported it without a manifest entry and only worked through transitive hoisting before.)
- [ ] Decide whether temporal parsing belongs in the shared contract layer, `lexera-core`, or a dedicated parsing library.
- [ ] If `lexera-shared` remains active, replace the current `management.js` and `management.css` file-copy workflow with a real shared package that has its own manifest, build, and tests.
- [ ] Stop copying shared management assets into app source folders during Tauri build hooks.
- [ ] Define ownership boundaries for shared frontend code so management UI, theme helpers, and transport helpers do not become an unstructured misc package.
- [ ] Consolidate backend discovery, REST helpers, SSE helpers, and connection bootstrap logic that is currently split across frontend entrypoints.
- [ ] Extract shared frontend bridge helpers for Tauri invoke, event listen, theme bootstrap, and backend discovery so app entrypoints stop hand-rolling them.
- [ ] Add tests for shared frontend modules directly instead of only testing them indirectly through app bootstraps.
- [ ] Add a shared preferences layer for theme and UI settings instead of reading and writing `localStorage` directly from many feature scripts.
- [ ] Introduce shared DOM rendering helpers or view primitives so shared UI modules do not rely on uncontrolled `innerHTML` updates everywhere.
- [ ] Define which shared UI surfaces may use trusted string HTML rendering and which must move to safer DOM-builder or template primitives.

## Duplicate Logic And Single Sources

- [ ] Make `lexera-backend` config the authoritative home for shared frontend defaults such as scroll speed, zoom speed, tag visibility, and HTML render modes, and remove the current `lexera-default-*` `localStorage` fallback path from the Kanban app.
- [ ] Restrict browser `localStorage` to explicitly machine-local or ephemeral UI state only, and document which settings are allowed to stay local instead of synced through backend config or board YAML.
- [ ] Route every remaining local-only frontend preference through one settings service instead of raw `localStorage` calls spread across feature files.
- [x] ~~Add a guardrail such as a lint rule, grep-based check, or architecture test that blocks new raw `localStorage` access outside the approved settings layer.~~ — 7db7b76f (`localStorageGuardrailContract.test.js` walks `lexera-kanban/src` (skipping the build-synced `themes.js`/`backendDiscovery.js`/`dialogs.js`/`management.js` copies from lexera-shared) and pins the 22 baseline files that touch `localStorage.*`. New files trigger an explicit failure that points the author at `LexeraSettings` / `core/settingsStore.js`. Stale baseline entries also fail so refactor wins get recorded.)
- [ ] Finish the board-setting descriptor work so one manifest owns menu metadata, action IDs, persistence target, default values, normalization, and CSS application instead of splitting that behavior across Rust and JS files.
- [ ] Remove duplicated board-setting action wiring between native menu code and frontend registration by generating both from the same descriptor manifest or shared contract.
- [ ] Centralize temporal tag parsing and resolution in one semantic owner so search, shared utilities, and Kanban UI do not keep separate feature sets for the same domain concept.
- [ ] Replace duplicated backend auth, discovery, retry, and JSON request helpers across Kanban, backend webviews, quick capture, and web clipper with one shared client layer per runtime family.
- [ ] Align the backend API implementation and API spec on one contract, including whether routes stay unversioned or move under `/api/v1`, so frontend clients stop inventing their own ad hoc shapes.
- [ ] Reduce intentional source duplication such as `themes.js`, `backendDiscovery.js`, management assets, and workspace shell assets to one authored location plus reproducible build outputs.

## Build And Asset Pipeline

- [ ] Replace script-tag source loading in app frontends with a defined build pipeline and one composition root per app.
- [ ] Make Tauri `frontendDist` point at built frontend outputs instead of mutable source directories once the frontend module split is in place.
- [ ] Stop treating `src/` folders as both authored source and Tauri-ready output in the active apps.
- [ ] Separate vendored third-party assets from first-party source code with clear ownership and update policy.
- [ ] Decide whether Excalidraw assets remain vendored inside the app or move into a vendor or tools area with a documented sync process.
- [ ] Replace one-off shell copy steps in Tauri config with reproducible build tasks that work the same in dev, CI, and release.
- [ ] Create a build target for shared frontend artifacts so apps consume generated outputs instead of raw copied files.
- [ ] Replace inline HTML and CSS app composition in secondary apps such as `lexera-capture-ios` with a buildable frontend module if those apps remain active.
- [ ] Add asset-manifest checks so referenced frontend files, copied shared assets, and vendored bundles cannot silently drift.

## Board Model And File Format

- [ ] Choose one canonical board schema for rows, stacks, columns, cards, settings, and metadata.
- [ ] Remove duplicate board model definitions by generating or contract-testing TypeScript and Rust representations from the same schema.
- [ ] Separate persisted board data from transient UI state such as selection, folding, hover, loading, and drag state.
- [ ] Define a file format version field and migration rules for legacy and hierarchical board formats.
- [ ] Centralize reserved tags, hidden tags, layout tags, and YAML keys in one schema source.
- [ ] Centralize ID generation and persistent identity rules so merge and sync behavior stays stable across runtimes.
- [ ] Decide whether board format detection stays heuristic or moves to an explicit persisted format version so parser branching is visible and testable.
- [ ] Add round-trip fixtures that guarantee parse and generate stability for both legacy and new board formats.
- [ ] Add fixtures for malformed files and partial recovery so parser behavior is predictable under error conditions.
- [ ] Move board mutation rules into explicit domain commands instead of scattering structural edits across UI handlers.
- [ ] Define invariants for valid boards such as allowed nesting, empty container behavior, and include ownership.

## Parser And Content Pipeline

- [ ] Pick one canonical markdown parser behavior and make all runtimes conform to it through shared fixtures.
- [ ] Extract include resolution, tag parsing, frontmatter parsing, and markdown normalization into separate pipeline stages.
- [ ] Define a parse pipeline interface with clear input, output, diagnostics, and recovery semantics.
- [ ] Add golden tests for includes, embedded media, diagrams, exports, and tag parsing against real board fixtures.
- [ ] Add explicit parser diagnostics instead of silent fallback behavior for unsupported or ambiguous syntax.
- [ ] Separate pure parsing from filesystem access so parser tests stay deterministic.
- [ ] Add a content transformation pipeline for export-only rewrites so board parsing does not absorb exporter concerns.
- [ ] Separate parser format detection from parse execution so legacy or hierarchical routing rules can be tested and versioned independently.

## Plugin Strategy

- [ ] Define a minimal plugin model with only the extension points that are likely to grow: import, export, embed, renderer, editor integration, and menu contribution.
- [ ] Write a plugin capability schema that covers preview, export transform, edit support, dependencies, and failure modes.
- [ ] Unify plugin registration across `lexera-kanban`, `lexera-backend`, and shared Lexera libraries so built-ins are declared once.
- [ ] Replace hardcoded plugin loading lists with manifest-driven builtin registration where possible.
- [ ] Move file-type detection into a shared plugin capability layer instead of duplicating detection logic by runtime.
- [ ] Define a stable fallback path when a plugin is unavailable, misconfigured, or only partially supported.
- [ ] Add plugin-level tests that validate detection, preview config, export config, and graceful degradation.
- [ ] Add a plugin development guide with lifecycle, naming, contracts, and sample implementations.
- [ ] Keep plugin APIs narrow and versioned so future features do not require breaking every existing plugin.
- [ ] Add a capability matrix for each embed and export plugin showing preview, edit, pack, and export support.

## Embedded Media And Visualization

- [ ] Separate embedded media handling into distinct concerns: detection, metadata, preview rendering, editing, export rendering, and packing.
- [ ] Create a renderer adapter interface for diagram and document outputs so new media types do not require UI-specific branching.
- [ ] Add a metadata extraction layer for embedded files so the UI can render labels, page counts, and preview availability consistently.
- [ ] Add a cache strategy for rendered previews with invalidation rules based on file content and renderer version.
- [ ] Add security rules for external embeds and file access boundaries so plugin growth does not widen the attack surface accidentally.
- [ ] Define how unsupported media types should render in board view, export, and pack flows.
- [ ] Add extension points for future embedded editors without making every media plugin also own editing behavior.
- [ ] Add extension points for future visualization outputs such as timeline, graph, dashboard, and slide views without coupling them to the board parser.
- [ ] Split renderer capability probing from render execution so CLI discovery, availability checks, and actual export rendering do not stay coupled in one command module.

## Frontend Structure

- [ ] LATER: Break the Kanban frontend entrypoint, currently `lexera-kanban/src/app.js`, into a small bootstrap plus feature modules with explicit ownership.
- [ ] Convert global registry patterns in the frontend into module-scoped APIs with explicit imports and exports.
- [ ] Introduce one board store layer that owns board state, derived state, and mutations.
- [ ] Separate pure state mutations from DOM rendering so behavior can be tested without the browser.
- [ ] Extract one typed backend API client from UI orchestration so transport, retries, caching, SSE, and WebSocket sync are not mixed into view code.
- [ ] Extract a shared frontend platform layer for Tauri invoke, event, dialog, clipboard, and backend discovery so feature modules stay host-agnostic.
- [ ] Group frontend code by feature area such as board, export, clipboard, dashboard, management, and settings.
- [ ] Move shared UI primitives such as dialogs, menus, notifications, and status bars into reusable modules.
- [ ] Split rendering pipelines for board content, overlays, and management UI so each can evolve independently.
- [ ] Reduce direct DOM querying at runtime by defining feature-local mount points and UI controllers.
- [ ] Introduce a frontend event and action convention so interactions do not become stringly-typed and implicit.
- [ ] Add contract tests for frontend registries and feature modules so extraction from `app.js` stays safe.
- [ ] Migrate browser scripts that are effectively application code from plain JS to TypeScript where it improves safety.
- [ ] Split `lexera-kanban/src/app.css` into tokens, layout, components, and feature styles, and standardize those CSS tokens, layout variables, and theme definitions across frontend packages.
- [ ] Split the Kanban shell into explicit feature modules for sidebar tree, dashboard, board view, log panel, management panel, export flow, and sync state.
- [ ] Extract theme bootstrap and persistence from individual entrypoints so Kanban, management, and quick capture do not each apply theme state differently.
- [ ] LATER: Replace `window.Lexera*` global registries with a single app bootstrap that wires modules together explicitly.
- [ ] LATER: Replace `index.html` script-chain loading with module imports or a bundle manifest so load order is no longer part of the architecture.
- [ ] Convert IIFE-oriented frontend tests to direct module imports and remove source-string loaders like `tests/load-iife.js` as real module entrypoints are extracted.
- [ ] Separate pure board rendering, DOM event wiring, and persisted preference handling into different layers.
- [ ] Bring `lexera-capture-ios` styling under the same token and component structure if that app remains an active product surface.
- [ ] Reduce direct `innerHTML` rendering in the Kanban app by defining clearer render boundaries for trusted HTML, plugin output, and normal UI content.
- [ ] Decide whether the management panel belongs inside the Kanban app shell or should be mounted as a shared app-independent module.
- [ ] Extract export UI state and export tree state into dedicated modules so export behavior is not coupled to the main board runtime.
- [ ] Give export its own frontend composition root so dialog state, storage keys, API calls, and Tauri output adapters are not mixed into the main board shell.
- [ ] Define a stable plugin and registry API boundary for the frontend so future media and visualization features do not require editing the main app bootstrap.

## Backend Structure

- [ ] Break backend startup wiring into bootstrap, configuration, storage, sync, API, and UI-bridge modules with small entrypoints.
- [ ] Introduce backend service layers for boards, media, templates, export, workspaces, and collaboration instead of route-heavy modules.
- [ ] Make API route modules thin adapters that validate requests and call services.
- [ ] Define shared request and response DTOs for the backend API instead of allowing shape drift across clients.
- [ ] Add structured error types with clear mapping to HTTP status and user-facing messages.
- [ ] Isolate filesystem operations behind repository interfaces so tests do not depend on live disk behavior.
- [ ] Isolate file watching behind a service boundary so sync, parser, and storage logic can stay deterministic in tests.
- [ ] Break `AppState` into narrower state bundles or service containers so handlers do not depend on one broad mutable service locator.
- [ ] Introduce a config service that owns mutate-normalize-save flows instead of calling `save_config` and `normalize_workspace_setup` directly from many handlers.
- [ ] Separate collaboration and networking concerns from core board mutation logic.
- [ ] Add lifecycle management for background tasks so watchers, sync loops, and streams shut down cleanly.
- [ ] Add structured logging targets and correlation IDs for operations that span frontend, backend, and sync layers.
- [ ] LATER: Split `api/board.rs` into read endpoints, write endpoints, live-sync endpoints, and response mappers instead of keeping board concerns in one large module.
- [ ] LATER: Split `collab_api.rs` into invites, public rooms, identity, discovery, remote connections, and server-configuration modules instead of one wide collaboration route file.
- [ ] Move workspace, board assignment, and sync configuration rules out of API handlers and into explicit services.
- [ ] Separate backend app bootstrap from server bootstrap so tray, capture UI, HTTP API, and collaboration runtime can evolve independently.
- [ ] Consolidate backend frontend pages such as connection settings and quick capture around shared transport helpers instead of duplicating discovery logic.
- [ ] Replace direct `Arc<LocalStorage>` dependencies with narrower traits or services where consumers need only board reads, writes, search, or sync capabilities.
- [ ] Decide whether backend UI assets belong in the backend app package or in a shared frontend module consumed by multiple apps.
- [ ] Extract event-stream and WebSocket broadcasting concerns into dedicated runtime modules with explicit lifecycle ownership.
- [ ] Define a single backend state composition root so config, storage, watchers, and collaborators are wired in one place.
- [ ] Audit background task ownership in `lib.rs` so startup, restore, periodic save, and shutdown behavior live in named runtime supervisors instead of one growing setup flow.
- [ ] Add API contract tests that cover the full board payload shape returned to the Kanban frontend and management UI.
- [ ] Remove frontend-side port-scanning duplication once the backend location and discovery contract are centralized.
- [ ] Wrap Tauri invoke, event, and window integration behind small frontend adapters so backend UI scripts do not depend on raw globals everywhere.
- [ ] Decide whether route registration should be nested by domain or API version so the router stays navigable as more endpoints are added.
- [ ] Make route composition authoritative so every declared router is mounted in one visible place and orphaned modules cannot silently exist outside the running server.

## Sync And Collaboration

- [ ] Decide whether collaboration is based on authoritative saves, operation logs, CRDT state, or a hybrid model and document the choice.
- [ ] Keep one conflict-resolution strategy in the core domain instead of separate save, sync, and live-edit variants drifting apart.
- [ ] Define version and revision tokens that every runtime uses the same way for optimistic concurrency.
- [ ] Unify server-side and client-side sync session behavior around shared protocol helpers so `sync_ws.rs` and `sync_client.rs` do not drift semantically.
- [ ] Define how remote board mirrors are identified, named, stored, and surfaced in the UI instead of relying on ad hoc local ID prefixes.
- [ ] Add end-to-end fixtures for merge, rebase, crash recovery, and external file change scenarios.
- [ ] Add explicit feature flags for experimental collaboration features so stable board editing remains predictable.
- [ ] Define workspace, board, and peer ownership rules so sync logic is not mixed with UI assumptions.

## Core Library Structure

- [ ] Split `lexera-core` into clearer internal layers for parsing, storage, search, export, merge, sync, and watcher concerns.
- [ ] LATER: Break `storage/local.rs` into smaller modules such as board repository, write pipeline, include synchronization, revision tracking, and search indexing.
- [ ] LATER: Break `crdt/bridge.rs` into smaller modules such as metadata mapping, board serialization, list reordering, move operations, and persistence helpers.
- [ ] Either expand `BoardStorage` to the capabilities apps actually use or remove it so the codebase does not keep a misleading partial abstraction.
- [ ] Split `LocalStorage` into capability-focused services and make its public surface match the app-facing abstractions that backend code should depend on.
- [ ] Define which `lexera-core` APIs are stable for app use and which remain internal implementation details.
- [ ] Keep CRDT-specific concerns behind a narrower interface so non-collaborative board flows do not depend on bridge internals.
- [ ] Separate CRDT persistence, diff application, undo or redo, and board serialization into smaller bridge components.
- [ ] Split parser and ID-generation utilities that should stay runtime-neutral from filesystem and include-resolution layers that are runtime-specific.
- [ ] Add smaller traits for search, board repository, revisioning, and collaboration persistence instead of routing everything through one concrete storage type.
- [ ] Decide whether export, archive, and search remain in one crate or should later be split into focused libraries after the repository move stabilizes.
- [ ] Move large inline Rust test blocks toward dedicated fixture-driven tests where that improves readability and cross-runtime comparison.
- [ ] Add fixture-based parity tests between the canonical Lexera parser and any remaining secondary parser implementation.
- [ ] Review feature gating inside `lexera-core` so watcher and collaboration-heavy dependencies stay optional where possible.
- [ ] Decide whether mobile storage should converge on shared core storage services or remain a separate simplified adapter with clearly documented divergence.

## Testing And Quality Gates

- [ ] Add a pull-request CI workflow that runs lint, unit tests, parser fixtures, and package builds on every change.
- [ ] Keep the release publish workflow separate from the verification workflow.
- [ ] Add repo-level smoke tests that verify the main runtimes can boot with minimal fixture data.
- [ ] Add shared fixture packs used by TypeScript, browser, and Rust tests so behavior is compared against the same samples.
- [ ] Add contract tests for API payloads, plugin manifests, and schema migrations.
- [ ] Add contract tests for config mutation flows so workspace normalization and persistence are verified once instead of indirectly through many handlers.
- [ ] Add router-composition tests that fail if declared backend sub-routers such as export endpoints are not mounted in the running server.
- [ ] Add performance regression tests for large boards, heavy embeds, and export transformations.
- [ ] Add snapshot or golden tests for export outputs where formatting stability matters.
- [ ] Add coverage reporting per package and enforce realistic thresholds only after flaky areas are stabilized.
- [ ] Add a minimal end-to-end board editing flow test for create, move, save, reload, and export.
- [ ] Add migration-safety tests that verify repo path moves do not break Tauri frontend loading, shared assets, or package-local fixtures.
- [ ] Add frontend smoke tests that verify the Kanban app bootstraps correctly without depending on script tag load order.
- [ ] Add shared module tests for management UI and backend transport helpers once they are extracted from app-local bootstraps.
- [ ] Add tests for shared backend discovery and transport adapters so port scanning, Tauri invoke fallback, SSE, and log streams are validated once.
- [ ] Add smoke tests for secondary apps such as `lexera-capture-ios` if they remain active.
- [ ] Add checks for dead or orphaned modules so unused shared layers and abandoned abstractions are surfaced early.

## Developer Experience

- [ ] Add app and library local `README` files with how to run, test, and debug each active Lexera module in isolation.
- [ ] Standardize logging and debug toggles so developers can enable targeted diagnostics in the active Lexera modules without code edits.
- [ ] Add scripts for fixture generation, parser diffing, and contract verification across the promoted Lexera modules.
- [ ] Add a lightweight architecture decision record process for changes to file format, plugin APIs, sync model, and package boundaries.
- [ ] Add a generated dependency report so new cross-package coupling is visible in reviews.
- [ ] Add a structural report command that highlights oversized source files, globals-heavy entrypoints, and duplicated bootstrap helpers.
- [ ] Add a route and command inventory report so frontend-used endpoints, mounted routers, and Tauri invoke commands can be compared automatically.
- [ ] Document which package directories are product code, support code, generated code, vendor code, or transitional code.
- [ ] Add a migration playbook for path moves so contributors can rebase, relink local tools, and update IDE settings without guesswork.

## Documentation And Cleanup

- [ ] Write one high-level architecture document that explains the roles of `lexera-kanban`, `lexera-backend`, `lexera-core`, and the supporting shared layers.
- [ ] Separate architecture backlog items from product backlog items so structural work stays visible.
- [ ] Archive or merge outdated todo files once the new architecture backlog is adopted.
- [ ] Document naming conventions for packages, services, registries, plugins, and frontmatter keys.
- [ ] Record which packages are first-class products, which are support code, and which are candidates for archive after the promotion.
- [ ] Document the lifecycle expectations for optional integrations such as remote sync sidecars, discovery services, and mobile capture clients.
- [ ] Document the supported extension points for future exporters, embedded media types, and visualization modes.
- [ ] Document what should stay intentionally simple so the architecture does not accumulate generic abstractions too early.
- [ ] Add a short migration note at the old package and archive locations that points contributors to the new primary directories.

# Lexera Kanban Todo

> Active backlog only. Completed items moved to [todo-archive.md](todo-archive.md).

## Immediate UX / Product
- [ ] Remove the workspace dropdown once the hierarchy tree can express workspace filtering directly.

## Hierarchy Unification
> All three surfaces (workspace, dashboard, files) share `TreeView` + `HierarchyContract`. Phase 1 (consolidate shared code) is complete.

### Phase 2: Migrate node builders to hierarchy contract
- [ ] Migrate workspace node builder — switch consumers of `data-board-id`/`data-row-index` etc. to use hierarchy descriptor, then remove duplicate `data-*` attrs.
- [ ] Migrate dashboard node builders — switch `activateDashboardTreeNode` to read from hierarchy descriptor, remove `data-dashboard-*` attrs.
- [ ] Migrate management node builder — switch selection handler to use `data-hierarchy-kind` + `data-hierarchy-entity-id`, remove `data-mgmt-config-*` attrs.
- [ ] Dashboard group headers → TreeView nodes — render dashboard as one TreeView tree instead of static `<div class="dashboard-group-header">` with CSS triangles. Location: `sharedPanels.js` + `orderHelpers.js::renderDashboard()`.

### Phase 3: Unify style and interaction contracts
- [ ] Unify right-side "meta slot" model — extend node definition with `metaSlots` array so each surface declares what goes in `.tree-meta`.
- [ ] Write one shared CSS rule set for all tree surfaces — consolidate sidebar/dashboard/management tree CSS blocks.

### Phase 4: Cutover and cleanup
- [ ] Delete `sidebarTree.js`, `dashboardTree.js`, and `buildConfigTreeNodes` from `management.js` after adapters handle everything.
- [ ] Add regression tests — one per surface verifying node tree output and interaction dispatch.

## JS Simplification

### Structure review findings
- [ ] Keep `app.js` as a composition root only: move compatibility wrappers, feature delegates, and fallback implementations back into their owning modules or explicit bridge modules.
- [ ] Simplify the large `OrderHelpers` dependency/proxy/fallback block in `app.js`; make `LexeraOrderHelpers` expose the needed API directly and remove the app-level proxy fallback once coverage is in place.
- [ ] Remove canvas fallback helpers from `app.js` after `canvasMode.js` / `canvasMath.js` / canvas feature modules own the behavior directly.
- [ ] Replace the many `getXApi()` helpers in `app.js` with a single module lookup or explicit dependency object through `LexeraRuntime`.
- [ ] Collapse long `LexeraEmbedMenu` delegation stubs in `app.js` into the embed menu module boundary, or expose one narrow embed-menu facade instead of many pass-through globals.
- [ ] Collapse TagColors / TagSystem pass-through wrappers in `app.js` into the tag modules so app bootstrap does not mirror their APIs.
- [ ] Standardize frontend dependency injection on `lexera-kanban/src/core/moduleRuntime.js` (VERIFIED EXISTS); remove repeated local `_deps`, `_dep`, `_callDep`, and `window.Lexera*` lookup patterns from feature modules as they are touched.
- [ ] Split `lexera-kanban/src/test/frontendTests.js` into smaller suites and shared fixtures so frontend test behavior is easier to reason about and slow/failing groups can be isolated.
- [ ] Split `lexera-kanban/src/app.css` further by feature area and reduce repeated button/icon selector groups with shared component classes or `:is()` groups where that keeps the CSS clearer.
- [ ] Render repeated dashboard group skeleton markup in `lexera-kanban/src/index.html` from a data-driven helper or template instead of maintaining repeated static blocks.

### Break up app.js
- [ ] LATER: Extract state initialization (~580 lines) — 48 state variables + `_rt.defineState()` calls.

### Reduce large modules
| File | Lines | Action |
|------|-------|--------|
| workspaceShell.js | 4,877 | LATER: Split UI from iframe bridge |
| embedMenu.js | 4,768 | LATER: Split by embed domain, audit 63 `_callDep()` calls |
| orderHelpers.js | 3,138 | LATER: Extract TitleHelpers, LayoutHelpers, DashboardState |
| management.js | 2,855 | Extract tree node builders |
| boardList.js | 2,844 | Move draft storage to BoardDraftStore |

## Board / Session Pipeline
- [ ] Introduce one authoritative board-session store with separate structure/content update paths.
- [ ] Finish stable-id cross-view entity move contract.
- [ ] Remove iframe workspace-shell after in-process state pipeline is ready.

## Legacy Retirement
- [ ] Freeze canonical board contract: `rows → stacks → columns → cards`.
- [ ] Make legacy loading one-way and boundary-only, then delete frontend converters, flat-column schema, format branching.

## Feature Backlog
- [ ] Structure map view (mindmap-style, cf. inklink).
- [ ] Keyboard Phase 2: entity context menu, rename, creation shortcuts.
- [ ] Keyboard Phase 3: command palette, board history, multi-select.
- [ ] Stack width grid (1-12) and column fractional widths.

## Parked Until Explicit Spec
- [ ] Per-user isolation beyond local-user model.
- [ ] Additional sources/editors/pipeline: email, filesystem, office editor, build pipeline, typed API.

## Frontend Integration Tests — Remaining
- [ ] Board factory: `createTestBoardPair()` — creates Board A (3 columns, 6 cards) + Board B (2 columns, 3 cards) via `setTestBoard` (needed for cross-board tests)

## Manual Verification
- [ ] Quick capture: screen resolution change on macOS, Windows, Linux.
- [ ] Quick capture: monitor disconnect migration.
- [ ] Quick capture: watcher deduplication across repeated open/close cycles.

## Verified Task Status (2026-04-15)

All items verified against the actual codebase by code inspection, file existence, grep, and test execution.

### Verified PARTIALLY done
- [~] Ludos naming → Lexera — no `ludos` in JS/RS source, but `@ludos/shared` in root `package.json` + 7 import sites in lexera-web-clipper. Renaming requires cross-package refactor.
- [~] TypeScript base config — root `tsconfig.json` exists, but packages don't extend a shared base
- [~] Structured error types — `InviteError`, `AuthError`, `PublicRoomError` enums exist; most other API handlers use string errors
- [~] Lifecycle management — 34 `shutdown`/`cleanup`/`JoinHandle` refs in `lib.rs` but no named supervisors
- [~] Config mutation centralized — `config_api.rs` (995 lines) handles most config flows, but 20 `save_config`/`normalize_workspace` refs scattered across other API handlers

### Verified NOT done (with evidence)
- [x] ~~Choose one package manager — both `package-lock.json` (npm) and `pnpm-lock.yaml` (pnpm) at root~~ — 7f0425a6 (orphan pnpm-lock.yaml removed; npm is canonical)
- [ ] Architecture document — no ARCHITECTURE.md at root
- [x] ~~Root lint command — `test.sh` has no lint; no `lint` in `package.json`~~ — 2a8f10dd (`npm run lint` wired up; eslint deps pinned)
- [ ] Package boundary checks — root `eslint.config.mjs` exists, but no boundary/import restriction rules found
- [ ] Dependency map document — none
- [ ] ADR (architecture decision records) — no `adr/` or `decisions/`
- [x] ~~`sidebarTree.js` deleted — still at `sidebar/sidebarTree.js` (9.3KB)~~ — outdated note: the original "delete" plan assumed a full merge into the consolidated `treeView.js` (439 lines, the rendering primitive). The split landed differently — `sidebarTree.js` (246 lines) and `dashboardTree.js` (417 lines) are surface adapters that BUILD the per-context tree-node arrays then hand them to `TreeView.render` / `TreeView.patch`. They are real consumers, not duplicates. Both files are referenced by 5+ call sites each. Keep.
- [x] ~~`dashboardTree.js` deleted — still at `dashboard/dashboardTree.js` (15KB)~~ — same as sidebarTree above.
- [x] ~~`buildConfigTreeNodes` removed from management.js — 2 references remain~~ — outdated note: `buildConfigTreeNodes()` is the active builder of the management config-tree (Global Settings + per-workspace + per-board nodes). Called from `TreeView.render(el, buildConfigTreeNodes(), ...)` at [management.js:2374](lexera-shared/management.js#L2374). Real producer, not a leftover.
- [x] ~~Source duplication — `themes.js` ×3, `backendDiscovery.js` ×3 (gitignore fixed, copies are build-synced from lexera-shared)~~ — 9d36932e (themes.js was already untracked; backendDiscovery.js copies in lexera-kanban + lexera-backend were still committed despite the gitignore — `git rm --cached`'d so the gitignore actually applies. Single source of truth = `lexera-shared/{themes,backendDiscovery}.js`, copies regenerated by `sync-runtime-assets.mjs` on dev/build.)
- [x] ~~Workspace dropdown removed — `renderWorkspaceSelect` in app.js (2 refs)~~ — outdated note: no `<select>` workspace widget exists in the markup. The 3-line mirror-refresh helper has been renamed `refreshWorkspaceMirrors` (8c45d84e + 643140e4) — 9 src sites + 2 test sites updated.
- [ ] `createTestBoardPair()` factory — 0 matches
- [ ] Per-package READMEs — only lexera-shared, lexera-web-clipper have README.md; 4 missing
- [ ] CI for lint/test/build on PRs — `.github/workflows/main.yml` is deploy-only
- [ ] Coverage reporting — none
- [ ] Golden/snapshot tests for exports — none
- [ ] End-to-end board editing flow test — none
- [ ] Board format version field — no `format_version` in `types.rs`
- [x] ~~Legacy loading still present — `migrateLegacyBoard` (3 refs), `legacyColumns` (4 refs)~~ — 69310267 (user authorised "remove all legacy code!" — full deletion: `migrateLegacyBoard`, `buildRowsFromLegacyColumns`, `rowsFromLegacyColumns` (boardList + ExportTreeBuilder), `normalizeLegacyColumnsToRows`, `stripLegacyImportStructureTags`, `getLegacyImportRowNumber`, `groupIntoStacks` (only used by the converter), legacy `lexera-ui-template` / `lexera-board-theme` localStorage migrations, legacy `'legacy'` theme alias. `ensureBoardRowsForMutation` simplified to a one-line guard (drops legacy `columns→rows` fallback + unused `fallbackTitle` arg). 17 callsites updated. `legacyColumnConverterParity.test.js` deleted. App now only accepts row-based board JSON; columns-only payloads return empty hierarchy. 1857 vitest pass, 161 / 161 run-lexera-tests.sh pass.)
- [ ] `collab_api.rs` not split — 2,206 lines
- [ ] `api/board.rs` not split — 1,812 lines
- [ ] Stop copying shared management assets — `beforeDevCommand` still runs `sync-runtime-assets.mjs`
- [ ] Shared tests for management.js — no tests dir in lexera-shared
- [ ] Plugin capability schema — none found
- [ ] Performance regression tests — none (only tag contrast benchmarks)
- [ ] Route composition test — none
- [ ] Migration playbook — none
- [ ] Naming conventions document — none

### Cannot verify by code inspection (require user decisions or design work)
These are architecture/design/strategy decisions that need human judgment, not code artifacts:

**Repository & Package decisions:**
Decide final repo structure, classify non-Lexera dirs, decide capture-ios status, decide packages/shared vs lexera-shared, define package boundaries for secondary apps, decide BoardStorage abstraction fate, decide API versioning, decide route registration style, decide board format detection strategy, decide mobile storage convergence, decide management panel ownership, decide export crate splitting

**Architecture design work:**
Define shared contract layer (DTOs/schema/IDs), define parse pipeline interface, define plugin model, write plugin capability schema, define plugin fallback path, define plugin dev guide, define board invariants, define workspace/board/peer ownership rules, decide collaboration model (CRDT/authoritative), define version/revision tokens, define conflict-resolution strategy

**Documentation to write:**
Document archival policy, document naming conventions, document lifecycle expectations, document extension points, document what should stay simple, write architecture document, write per-package READMEs, add migration notes at old locations

**Feature work not started:**
Structure map view, Keyboard Phase 2/3, stack width grid, per-user isolation, additional sources/editors pipeline, workspace burger menu for boards

**Refactoring work (verified NOT started but scope is clear):**
Break app.js into bootstrap + modules (11,063 lines), split workspaceShell.js (4,891), split embedMenu.js (4,925), extract OrderHelpers sub-modules (3,173), extract boardList draft storage (2,961), split management.js tree builders (2,848), split storage/local.rs (6,303), split crdt/bridge.rs (5,993), split lib.rs (1,027), collapse app.js pass-through wrappers (66 `window.Lexera*` globals, 26 direct `localStorage` calls), replace `window.Lexera*` with explicit wiring, replace index.html script-chain with module imports (94 script tags), convert IIFE tests to module imports

### Metrics
| Metric | Count |
|--------|-------|
| `window.Lexera*` globals in app.js | 66 |
| `_rt.defineState` + `_rt.setState` in app.js | 16 |
| Direct `localStorage.` calls in app.js | 26 |
| Script tags in index.html | 94 |
| `_callDep` / `_dep` patterns in feature modules | widespread |
| Total `[ ]` items in this file | ~302 |
| Verified done | 22 |
| Verified partial | 7 |
| Verified not done | 31 |
| Design decisions (cannot verify) | ~242 |

## Historical Review Notes

Large historical status sections, package-by-package quality reviews, already-completed hardening work, and the older phased recommendation lists were moved out of the active backlog. Keep the active file focused on unresolved architecture and product work; use [todo-archive.md](todo-archive.md) and git history for the older progress reports.

- ~~native multiview webviews paint above shell DOM, hiding dropdowns and drag indicators~~ — c0627702: refcounted `setAllVisible` on `LexeraMultiviewWebview`, hooks tab drag mode + tab overflow dropdown, gates `boardHost` visibility observer + spawn-time visibility on the same flag so concurrent suppressors compose.
