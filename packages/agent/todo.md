# Lexera Kanban Todo

> Completed items moved to [todo-archive.md](todo-archive.md)

- [ ] there must be one update path if elements are changed in the structure of the kanban/canvas, and another one if content is changed within the boards. 
  - whats the flow of board element (row, stack, column, cards) to workspace and view hierarchy display update? we need one path that updates all views where a board is open or referenced (workspace, kanban/canvas views) after any type of change. 
  - **audit refresh 2026-04-05**
  - Resolved since the 2026-04-04 audit: polling delta, live-sync snapshot, rebase snapshot, and cross-board commit now all funnel hierarchy refresh through `commitLocalBoardChange(...)`; hierarchy projection invalidates the board-list fingerprint; embedded panes no longer run their own hierarchy cache.
  - Main board/canvas rendering is still mostly unified in `packages/lexera-kanban/src/app.js`: `updateDisplayFromFullBoard()` feeds `refreshTargetedElements()`, and the render path reuses `buildRowElement()` / `buildStackElement()` / `buildColumnElement()`.
  - The app still does not have one authoritative board-session store. There are three update channels in play: in-process render/mutation (`persistBoardMutation` / `refreshTargetedElements`), `LexeraRuntime` state, and iframe `postMessage` bridges (`lexera-board-mutated`, `lexera-workspace-catalog`, `lexera-pane-board-change`).
  - The previous `fullBoardData` load-path leak is fixed, but `packages/lexera-kanban/src/app.js` still bypasses the shared runtime store on board switch/load/error paths with direct `activeBoardData = ...` writes. Because `packages/lexera-kanban/src/board/boardList.js` and `packages/lexera-kanban/src/board/orderHelpers.js` prefer `LexeraRuntime.getState(...)`, runtime state is still not actually authoritative for board-session metadata.
  - Hierarchy rendering is still a separate projection path in `packages/lexera-kanban/src/board/boardList.js` + `packages/lexera-kanban/src/sidebar/sidebarTree.js`, so there is still no single render contract for rows/stacks/columns/cards across board view and hierarchy.
  - Sidebar tree rendering still diverges from board rendering: hidden cards are skipped as child nodes but still counted in row/stack/column badges, and row/stack labels still do not go through `stripLayoutTags()` while column labels do.
  - Sidebar identity is still index-based. `packages/lexera-kanban/src/sidebar/sidebarTree.js`, `packages/lexera-kanban/src/sidebar/sidebarSync.js`, and `packages/lexera-kanban/src/navigation/boardNavigation.js` rely on `data-col-index` / `data-card-index` and row/stack display indices instead of stable row/stack/column ids, so highlight/focus/expansion state can still drift after inserts or reorders.
  - Legacy-column conversion is still duplicated and already divergent: `packages/lexera-kanban/src/board/boardList.js::rowsFromLegacyColumns()` ignores `#rowN`, while `packages/lexera-kanban/src/board/orderHelpers.js::buildRowsFromLegacyColumns()` groups rows and stacks differently. Sidebar fallback projection and main board mutation code therefore do not share one legacy-normalization rule.
  - Repo-wide board schema is still split: runtime/core uses rows/stacks/columns with richer metadata, while `packages/shared/src/kanbanTypes.ts` and `packages/shared/src/markdownParser.ts` still model legacy flat columns only.
  - Missing regression coverage is now narrower but still real: no focused test protects `activeBoardData` runtime-state bypass on load/switch/error, hidden-count correctness, row/stack layout-tag stripping, or stable hierarchy identity/highlighting after reorder.

- [x] ~~workspace burger menu + context menu dispatches actions in iframe, hierarchy syncs live via postMessage~~ (b205371f, 6a758f02)

- [x] ~~cross-board drag: symmetric bridge, copy+trash source, both directions work~~ (ab772726, 2bbe995b)

- [x] ~~add-card now inserts empty card and opens editor directly, no Add/Cancel composer~~ (10aa3360)

- [ ] any type of element (row, stack, column, card) must be moveable between the workspace and kanban/canvas views, also directly inbetween multiple kanban/canvas views. it must allways show the right highlights.
  - **audit 2026-04-05**
  - Cross-view DnD support exists for rows, stacks, columns, and cards in `packages/lexera-kanban/src/dragdrop/dragDropHandlers.js` + `packages/lexera-kanban/src/dragdrop/dndListeners.js`, including cross-board mutation helpers.
  - It is still not a universal move contract. Drag payloads and drop targets are mostly `{ rowIndex, stackIndex, colIndex, cardIndex, indexMode }` rather than stable entity ids, and hit-testing decides whether to invoke same-board vs cross-board helpers before the mutation layer sees a normalized command.
  - Workspace hierarchy focus/highlight still uses the same index-based model (`sidebarSync.js`, `sidebarTree.js`, `boardNavigation.js`), so move correctness and highlight correctness are still coupled to transient display indices.
  - Because workspace-shell board panes are still iframes, cross-view drag/focus/menu behavior still depends on bridge logic instead of one in-process view model.

- [x] ~~remove Layout Rows from format menu, add separator before Board Layout~~ (871938ad)

- [x] add common shortcuts such as meta+w (close tab) etc. i want a keyboard control first application. create a list of already existing shortcuts, and create a list of suggested shortcuts we should have, it should allow the user to do most things that are done by mouse, also by keyboard.
  - Cmd/Ctrl+W, Cmd/Ctrl+Shift+]/[, Cmd/Ctrl+PageDown/PageUp, and panel toggles are wired in `app.js` + `workspaceShell.js`.
  - Comprehensive audited lists of existing shortcuts and suggested keyboard-first gaps now live in `packages/agent/specs/services/keybinding/SPEC.md`.
  - Remaining implementation work stays tracked below in `Keyboard-First Roadmap`.

- [x] ~~clicking on items found by the dashboard must focus on them. Even if they are a broken include file, just show where it's included!~~ (d491dd5e) — cardIndex passed through navigation chain; Priority-2 col+card index lookup in focusSearchResultCard

- [x] ~~global sync settings in workspace config~~ (01be1d01) — Global Settings node with (?) tooltips, calendar slug noted as unused
- [x] ~~drag/drop column + card fix~~ (07712fc2) — geometry cache after drop zones, hide source card during async move
- [x] ~~workspace config fixes~~ (75e99ecd) — calendar slug removed, responsive layout, Enter-key save

- [x] ~~dashboard layout collapse fixed~~ (edd8cf2b) — dashboard always flex:1 1 auto, never fixed pixel height
- [x] ~~**Audit all views for unnecessary fixed-pixel sizing**~~ — audited sidebar (sidebarResize.js), workspace shell docks, canvas layout, app.css, workspaceShell.css. All inline `flex: 0 0 Npx` instances are user-initiated resize values. No problematic fixed-pixel layout overrides found.

- [x] values in the dashboard only display if i focus the dashboard view!
  - `dashboardRefreshPending` / `dashboardRenderPending` reconnect behavior is covered in `dashboardPendingFlags.test.js`.

- [x]  the width of stacks must be configurable for each stack. there should also be a board wide setting that is the default for all stacks. what is the way to define configuration values for stacks?
  - Board-wide via `stackWidth` in YAML/frontmatter-backed board settings → CSS `--board-stack-width`.
  - Per-stack override via `#width{N}` tag in stack title → CSS `--stack-width-override`.
  - Context-menu controls and board/default resolution are covered by `stackWidthControls.test.js`.
  - UX documentation lives in `packages/agent/specs/ux/board-settings/SPEC.md`.

- [ ] the quick clipboard doesnt detect screen changes which makes it not stick to borders when something changes in the OS setup. can you detect that and update the position on screen resolution changes? it must work on osx, windows and linux!
  - **fix applied**: ScaleFactorChanged event handler in lib.rs + periodic monitor watcher (3s) in capture.rs tracks monitor rect changes. Needs user testing.

- [x] ~~why could this happen? "Save failed. Recovery copy written"~~ (eaef84db) — notification now shows the actual error reason. Most likely causes: HTTP 409 conflict (external file changes), network timeout (10s), temporary backend unavailability

- [x] ~~it should be possible to copy stacks formatted (same method and functions as with the cards)~~ (dc065f21) — added 'Copy as formatted' (HTML clipboard) to stack, column, and row context menus

## Code Quality
- [ ] **App.js modularization** — **11,280 lines**. Main shortcuts are now extracted into `keyboard/appShellShortcuts.js`, but core board rendering + event wiring still dominate the file.

- [x] the text size isnt unified over all the styles and all the fonts in and outside the kanvan. for our default style all fonts have the same size in the kanban mode. in canvas mode the board view might zoom smaller or bigger then the rest of the application. but in kanban mode all fonts have exactly the same size.. ALL FONTS!
  - `.columns-container:not(.layout-canvas)` override block in `app.css` normalizes major kanban selectors to `var(--board-font-size, var(--font-size-base))`.
  - Regression coverage lives in `kanbanFontUnification.test.js`.

- [x] ~~i still often get "Save failed. Recovery copy written"~~ — same fix as above (eaef84db), error reason now visible in notification

- [x] ~~the menu for embeds and includes~~ (eaef84db, c7eeaf16) — menu reordered to spec, separator before Info/Delete added, relative/absolute path mode toggle added to Replace Document overlay, uploaded files route through path mode, specs updated in menus/SPEC.md

- [x] ~~delete row doesnt work or doesnt update the view! check all other delete functions as well!~~ (4539a9dd) — rowIdx variable bug fixed, setRowHiddenTag/setStackHiddenTag/setColumnHiddenTag converted to targets pipeline

- [x] ~~refactor the board update (re-render) functionality~~ (2d697e50) — unified targeted re-render pipeline via `persistBoardMutation({ targets })`. See `packages/agent/specs/core/board/SPEC.md` for full documentation.
  - `enhanceRenderedElement()` = single source of truth for post-render hooks
  - `refreshTargetedElements()` = dispatch for card/column/stack/row/board targets
  - `buildStackElement()` and `buildRowElement()` extracted as standalone functions
  - `enhancePreviewElement()` = unified preview enhancement in embedMenu.js
  - ~~**Migration complete** (60cf793e)~~: all ~60 callers migrated to `targets`, legacy `skipRender`/`refreshMainView`/`refreshSidebar` branch removed from `persistBoardMutation`
  - ~~**Helper APIs migrated** (eefe496e)~~: `commitBoardMutations`, `applyLiveSyncBoardSnapshot`, `applyRebasedBoardSnapshot`, `persistCleanedBoard` now use `refreshTargetedElements`. `flushDeferredBoardRefresh` delegates to these, so it's covered transitively.

## Architecture
- [ ] **Remove iframe view composition** — replace iframes + postMessage with in-process views
  - **audit 2026-04-05**
  - The parent window owns workspace catalog + hierarchy projection; each embedded pane still owns live board DOM, most board mutations, and board-scoped action dispatch.
  - Parent/child coordination still depends on `postMessage` and `contentWindow` access for mutation propagation, focus delivery, context-menu dispatch, and catalog fan-out.
  - As long as this split remains, board updates and cross-view moves will continue to need bridge-specific fixes instead of one in-process state/render pipeline.
- [ ] **Single-source cleanup pass** — execute the duplicate functions, duplicate data structures, duplicate persisted data, and shared asset consolidation backlog in `packages/todo.md` so each data class has one authoritative home.
  - **audit 2026-04-05**
  - Board session state currently has overlapping owners: local vars in `app.js`, `LexeraRuntime` state, hierarchy projection cache in `boardList.js`, and iframe message payloads.
  - Legacy board normalization is still duplicated across `boardList.js`, `orderHelpers.js`, and `lexera-core/src/parser.rs`.
  - Shared package types/parsers are still on the legacy flat-column contract, so the repo does not yet have one canonical board schema across frontend/shared/core.

### Legacy retirement — one canonical codepath
> Target architecture: exactly one valid board model, one render/update pipeline, and one persistence contract. Legacy compatibility, if it remains at all, must be a narrow import/migration boundary, never an everyday runtime branch.

- [ ] **Freeze the canonical board contract** — `rows[] -> stacks[] -> columns[] -> cards[]` must be the only authoritative runtime and persisted structure across frontend, shared, backend, and tests. Flat top-level `columns[]` can no longer be treated as an equal schema.
- [ ] **Make legacy support one-way and boundary-only** — if old flat-column boards still need to load, convert them once at import/load time, persist back immediately in canonical form, and never keep both shapes alive in normal runtime state.
- [ ] **Delete frontend legacy converters and fallback readers** — remove `rowsFromLegacyColumns()` from `packages/lexera-kanban/src/board/boardList.js`, `buildRowsFromLegacyColumns()` from `packages/lexera-kanban/src/board/orderHelpers.js` / `packages/lexera-kanban/src/app.js`, *and* the third self-contained copy `ExportTreeBuilder.rowsFromLegacyColumns()` in `packages/lexera-kanban/src/export/exportTreeBuilder.js`. `tests/legacyColumnConverterParity.test.js` documents the current behavioural divergence across all three (row-number handling, stack titling, hidden-item filtering, single-row fallback) and pins the current call-site counts so the deletion is mechanical. When the last converter is removed, delete that test file too.
- [ ] **Delete shared legacy schema/types** — replace the flat-column-only contracts in `packages/shared/src/kanbanTypes.ts` and `packages/shared/src/markdownParser.ts` with the canonical row/stack/column/card schema so shared code stops reintroducing the obsolete structure.
- [ ] **Collapse backend parsing onto the same canonical model** — `packages/lexera-core/src/parser.rs` must produce and serialize the same canonical structure as the frontend/shared codepath. If legacy import parsing remains, isolate it behind a dedicated migration adapter instead of branching through the main parser pipeline.
- [ ] **Remove dual-structure payloads from runtime/state** — stop carrying both `board.rows` and legacy-derived `board.columns` as active application structures. Define one source of truth and make any compatibility/export representation explicitly derived and non-authoritative.
- [ ] **Delete format-branching from normal app flow** — remove "new vs legacy" behavioral branches from load, render, navigation, mutation, hierarchy, and DnD paths so the app no longer has to ask which board shape it is dealing with once data is inside the runtime.
- [x] **Add hard invariants that block legacy reintroduction (frontend call-site count)** — `tests/legacyColumnConverterParity.test.js` locks the current number of references to each of the three legacy converters: boardList.js=4, orderHelpers.js=3, app.js×2=(4 + 2), exportTreeBuilder.js=2. Any new caller, new export, or accidental re-addition bumps a count and fails fast with a precise per-file message. The test also pins the current behavioural output of each converter so the deletion work has a verifiable baseline. Remaining invariant work (parser/render branches, flat-column runtime reads) is deferred to the next sub-tasks.
- [ ] **Extend the invariant coverage beyond call-site counts** — block flat-column runtime reads in the frontend (new `board.columns.length > 0` branches outside the migration boundary), block new legacy `rowsFromLegacyColumns`-style helpers from being added, and block parser/render branches that test board shape at runtime. The current parity test is a per-function count; the fuller invariant set needs a per-pattern source scan.
- [ ] **Document the removal order and cutover point** — write the exact migration sequence in the board/core SPECs: data migration boundary, shared type switch, parser switch, frontend cleanup, and final deletion of compatibility shims.

### Hierarchy sync — single-source enforcement (analysis 2026-04-05)
> Root cause: only `persistBoardMutation` posts `lexera-board-mutated` from the iframe to the parent. Four other iframe-side paths that mutate `fullBoardData` update their own state silently, so the workspace sidebar shows the last user-edit state while the open board view shows the latest data. Symptom: hierarchy lags behind the main view after polling refresh, live-sync snapshot, rebase, or cross-board mutation.

- [x] **Enumerate every `fullBoardData` writer in the iframe** — confirmed leak set: `applyPollingBoardDelta`, `applyLiveSyncBoardSnapshot`, `applyRebasedBoardSnapshot`, `commitBoardMutations`. Any new writer must be added to this list and to the migration task below.
- [x] **Introduce `commitLocalBoardChange(fullBoard, options)`** — single choke point that (a) writes `fullBoardData`, (b) refreshes the local hierarchy projection, (c) posts `lexera-board-mutated` to parent when `embeddedMode`. All mutation paths MUST call it. Delete the direct `fullBoardData = ...` style assignments inside mutation helpers.
- [x] **Migrate the four leak paths** to `commitLocalBoardChange` so polling delta, live-sync snapshot, rebase, and cross-board commit all reach the parent sidebar.
- [x] **Seal `boardHierarchyCache` writes** — raw cache writes now flow through internal projection setters in `boardList.js`; `refreshBoardHierarchyProjection()` remains the only public projection API and cache updates invalidate the board-list fingerprint before notifying subscribers.
- [x] **Collapse the two hierarchy APIs into one** — workspace-shell hierarchy refresh now goes through the single `refreshBoardHierarchyProjection` path; the parent message bridge consumes `lexera-board-mutated.fullBoard` and no longer depends on ad hoc sidebar refresh sequences.
- [x] **Disable the hierarchy pipeline inside embedded iframes** — `boardList.js` now skips hierarchy cache writes and board-list rerenders in embedded mode. The iframe contract is `getFullBoardData()` + `lexera-board-mutated`.
- [x] **Single `boards[]` polling realm** — embedded polling already skips `/boards` and `/workspaces`; parent `boards[]` / `remoteBoards[]` / `workspaces[]` now fan out to workspace-shell iframes via `lexera-workspace-catalog`, so the parent remains the sole owner of that metadata realm.
- [x] **Regression tests** — covered end-to-end for workspace-shell mutation payload handling, embedded hierarchy no-op, live-sync snapshot, rebase snapshot, polling delta, and cross-board commit updating the parent hierarchy cache.
- [x] **Document the contract** in `packages/agent/specs/core/board/SPEC.md`: one rule — *"any change to `fullBoardData` inside an embedded iframe flows through `commitLocalBoardChange()` — there is no other way"*. Include a bulleted list of every place the contract is enforced (writer function, parent message handler, cache setter) so a future refactor can't accidentally introduce a new bypass.

### Hierarchy sync — repeat audit 2026-04-05 (current remaining gaps)
> Rechecked the current tree after the load-path fixes. The missing `lexera-board-mutated` post on board load is fixed. The remaining work is structural: ownership, identity, and schema are still split, so this class of bug can reappear in different forms unless those seams are removed.

- [x] **Load-path sync leak is fixed** — `loadBoard(...)` now routes successful loads through `commitLocalBoardChange(...)`, and `fullBoardData` load/draft/error writes now go through `setFullBoardDataState(...)`. The earlier "hierarchy only updates after the next poll or a later mutation" path is no longer the live issue.
- [x] **Eliminate raw `activeBoardData = ...` writes on load/switch/error paths** — the three remaining raw assignments (`selectBoard` clear, `loadBoard` success, `loadBoard` error cleanup) in `packages/lexera-kanban/src/app.js` now route through `setActiveBoardDataState(...)` so `LexeraRuntime.getState('activeBoardData')` stays in sync with every transition. Source-level invariant tests in `tests/boardSessionStateInvariants.test.js` enforce that the ONLY raw assignments of `activeBoardData` and `fullBoardData` live inside their respective setter bodies, so future refactors fail fast with precise line numbers if someone reintroduces a bypass. In-place field mutations (`activeBoardData.version = ...` etc.) remain a separate concern — see the next task.
- [ ] **In-place field mutations on `activeBoardData` still bypass the runtime bridge** — `packages/lexera-kanban/src/board/boardList.js:690-742` mutates `activeBoardDataRef.version`, `.revision`, and `.fullBoard` directly after resolving via `_dep('activeBoardData')`. `LexeraRuntime.onStateChange('activeBoardData', ...)` listeners only fire on rebind, not on field writes, so downstream subscribers (and the `fullBoardData:changed` observers that piggyback through it) still miss revision/version updates from live-sync and rebase flows. Decide: (a) model these as separate runtime keys (`activeBoardRevision`, `activeBoardVersion`, `activeBoardFullBoard`) that get their own setters, OR (b) re-assign the whole object via `setActiveBoardDataState({ ...activeBoardData, version, revision, fullBoard })` and stop in-place mutation entirely.
- [ ] **Replace index-addressed hierarchy identity with stable entity ids** — `packages/lexera-kanban/src/sidebar/sidebarTree.js`, `packages/lexera-kanban/src/sidebar/sidebarSync.js`, `packages/lexera-kanban/src/navigation/boardNavigation.js`, `packages/lexera-kanban/src/dragdrop/dndListeners.js`, and `packages/lexera-kanban/src/dragdrop/dragDropHandlers.js` still coordinate by `data-col-index` / `data-card-index` plus row/stack display indices. Reorder, hidden-card, and cross-view move behavior therefore still depends on remapping transient display positions.
- [ ] **Unify legacy-column normalization behind one shared converter** — `packages/lexera-kanban/src/board/boardList.js::rowsFromLegacyColumns()` still groups by `#stack` only and ignores `#rowN`, while `packages/lexera-kanban/src/board/orderHelpers.js::buildRowsFromLegacyColumns()` honors both row and stack tags. `packages/lexera-core/src/parser.rs::convert_legacy_columns_to_rows()` is closer to `orderHelpers.js` than to `boardList.js`, so frontend sidebar fallback and backend parse are still not guaranteed to agree.
- [ ] **Collapse hierarchy projection onto the same board-session/view-model contract as main rendering** — `packages/lexera-kanban/src/board/boardList.js` still maintains a separate projection/cache layer for sidebar consumption instead of reusing the same row/stack/column/card view model as the main board render path. Count, label, and visibility rules therefore remain duplicated.
- [ ] **Retire iframe bridge ownership from workspace shell** — `packages/lexera-kanban/src/workspace/workspaceShell.js` still coordinates board panes through `iframe`, `contentWindow`, and `postMessage` for focus, context menus, catalog fan-out, and mutation propagation. This is still the root blocker for a single in-process update path.
- [ ] **Update regression coverage to match the remaining gaps** — add focused tests for `activeBoardData` runtime notifications on load/switch/error, stable hierarchy identity after reorder/hidden-card scenarios, and parity between legacy-column conversion in frontend/sidebar/backend parsers.

## Active Features
- [ ] Mobile web clipper — finish lexera-capture-ios

## Performance
- [x] **Divider drag hot path** — cache dock/split container bounds at `pointerdown` and stop calling `getBoundingClientRect()` on every move in `workspaceShell.js`
- [x] **Dock resize fast path** — split `applyDockLayout()` into a drag-safe path so divider dragging does not rebuild fold strips, rebind hover handlers, and retoggle dock classes on every move
- [x] **Sidebar resize layout thrash** — remove repeated `clientHeight`/`offsetHeight`/`getComputedStyle()` reads from live divider dragging and batch sidebar section/width updates with `requestAnimationFrame`
- [x] ~~**Sidebar resize unified + canvas resize deferred**~~ (d9ec64f2) — removed 310 lines of duplicated resize code, canvas bounds recompute moved to drag end
- [x] **Resize transition lag** — disable `.board-stack` width/flex transitions during live resize so stack borders track the pointer instead of animating 150ms behind it

## Needs User Testing (fixes applied 2026-04-04, unverified in running app)
- [x] **Dashboard refresh on panel activation** — pending-flag reconnect behavior covered in `dashboardPendingFlags.test.js`
- [x] **Dashboard calendar-only scenario** — no-refresh/render-pending behavior covered in `dashboardPendingFlags.test.js`
- [x] **Keyboard shortcut: Cmd+W** — covered in `appShellShortcuts.test.js`
- [x] **Keyboard shortcut: Cmd+Shift+]/[** — `e.code` path covered in `appShellShortcuts.test.js`
- [x] **Keyboard shortcut: Cmd+PageDown/PageUp** — covered in `appShellShortcuts.test.js`
- [x] **Keyboard shortcut: Cmd+B / Cmd+Shift+D / Cmd+Shift+E** — shortcut dispatch covered in `appShellShortcuts.test.js`, panel show/hide behavior covered in `workspaceShell.test.js`
- [ ] **Quick capture: screen resolution change** — verify on macOS, Windows, Linux: change display resolution while quick-capture strip is visible, it should re-snap within 3s. Change while expanded, it should stay expanded and re-snap to the correct edge.
- [ ] **Quick capture: monitor disconnect** — verify: connect external monitor, open quick capture on it, disconnect the monitor. The capture window should migrate to the remaining display.
- [ ] **Quick capture: no duplicate watcher threads** — verify: close and reopen quick capture multiple times, check logs for exactly one "Monitor watcher stopping" message per close cycle (not accumulating).
- [x] **Kanban mode font unification** — selector coverage and canvas exclusion are checked in `kanbanFontUnification.test.js`
- [x] **Stack width configuration UI discovery** — menu/default behavior covered in `stackWidthControls.test.js`, documented in `packages/agent/specs/ux/board-settings/SPEC.md`

## Architecture
- [ ] **Remove iframe view composition** — replace iframes + postMessage with in-process views
  - See the 2026-04-05 audit above: parent/iframe ownership split is still the core blocker.
- [ ] **Single-source cleanup pass** — execute the duplicate functions, duplicate data structures, duplicate persisted data, and shared asset consolidation backlog in `packages/todo.md` so each data class has one authoritative home.
  - See the 2026-04-05 audit above: runtime/local/cache/message ownership overlap and legacy schema duplication are still open.

## Active Features
- [ ] Mobile web clipper — finish lexera-capture-ios

## Keyboard-First Roadmap (from 2026-04-04 audit)
- [ ] **Phase 2: entity context menu via keyboard** — Shift+Space or Cmd+Shift+M to open the context menu of the currently focused column/stack/row (card already supports Space).
- [ ] **Phase 2: rename focused entity** — Cmd+Shift+N renames the currently focused row/stack/column (cards already support E for edit).
- [ ] **Phase 2: creation shortcuts** — Cmd+Shift+R/S/C for new row/stack/column; currently only cards can be created via keyboard (N).
- [ ] **Phase 2: column focus navigation** — Ctrl+Left/Right to move focus between columns (not cards). Enables tab-like column navigation.
- [ ] **Phase 2: search shortcut** — Cmd+F for simple board text search (Cmd+Shift+H is already search/replace).
- [ ] **Phase 3: command palette** — Cmd+Shift+P for fuzzy-searchable action dispatch (VS Code convention). All ActionRegistry actions should be discoverable.
- [ ] **Phase 3: board history navigation** — Alt+Left/Right for back/forward through recently opened boards (browser convention).
- [ ] **Phase 3: multi-select cards** — Shift+Arrow for range selection, batch delete/archive/park/move operations.

## Performance
- [x] **Divider drag hot path** — cache dock/split container bounds at `pointerdown` and stop calling `getBoundingClientRect()` on every move in `workspaceShell.js`
- [x] **Dock resize fast path** — split `applyDockLayout()` into a drag-safe path so divider dragging does not rebuild fold strips, rebind hover handlers, and retoggle dock classes on every move
- [x] **Sidebar resize layout thrash** — remove repeated `clientHeight`/`offsetHeight`/`getComputedStyle()` reads from live divider dragging and batch sidebar section/width updates with `requestAnimationFrame`
- [x] ~~**Sidebar resize unified + canvas resize deferred**~~ (d9ec64f2) — removed 310 lines of duplicated resize code, canvas bounds recompute moved to drag end
- [x] **Resize transition lag** — disable `.board-stack` width/flex transitions during live resize so stack borders track the pointer instead of animating 150ms behind it

## Testability
- [x] **Frontend test for dashboard pending-flag logic** — `dashboardPendingFlags.test.js`
- [x] **Frontend test for workspaceShell.cycleTab** — direction, wrap-around, single-tab, and unknown-active-tab cases covered in `workspaceShell.test.js`
- [x] **Frontend test for toggle-panel action** — unknown panel IDs and visible→hidden→visible cycle covered in `workspaceShell.test.js`
- [x] **Rust test for capture::validate_capture_position** — monitor-change detection, bounds logic, and strip vs expanded resnap planning covered in `capture.rs`
- [x] **Rust test for MONITOR_WATCHER_RUNNING guard** — duplicate-spawn guard covered in `capture.rs`

## Deferred
- [ ] Email/filesystem sources, office editor, build pipeline, typed API
- [ ] Per-user isolation, universal view contract, legacy path retirement
- [ ] Panel anatomy, tag styling, style regression, hit areas, plugins
- [ ] Stack width grid (1-12) + column fractional widths (1/1..1/12)
