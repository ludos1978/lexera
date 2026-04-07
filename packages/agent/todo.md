# Lexera Kanban Todo

> Active backlog only. Completed items moved to [todo-archive.md](todo-archive.md).

- [ ] i think the tree-children-guide must be removed, it adds a double line where there shoudnt be one!

- [ ] when auto-fixing a include link it doesnt update it afterwards, it doesnt include the new content.



## Immediate UX / Product
- [ ] Unify visual styles by removing complexity — buttons, fonts, icons should use consistent sizing. Remove redundant CSS rather than adding overrides.
- [ ] Unify icon sizes — some are very small, others much bigger. Standardize on `--icon-glyph-size`.
- [ ] Remove the workspace dropdown once the hierarchy tree can express workspace filtering directly.

## Hierarchy Unification
> All three surfaces (workspace, dashboard, files) share `TreeView` + `HierarchyContract`. The work is collapsing the three node-builder + interaction-wiring layers into one pipeline.

### Phase 1: Consolidate shared code
- [ ] Consolidate `createHierarchyNode()` — identical 6-line wrapper in sidebarTree.js, dashboardTree.js, management.js. Move to shared module.
- [ ] Consolidate title helpers — `stripHtmlComments()`, `extractHtmlComments()`, `stripLayoutTags()` duplicated in 3-4 files. Create shared `TitleHelpers` module.
- [ ] Standardize navigation-target extraction — unify `buildHierarchyFocusTargetFromTreeNode` (workspace), `buildDashboardNavResultFromTreeNode` (dashboard), inline reads (management) into one `extractActivationTarget(node, surface)`.

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

## CSS Simplification (analysis 2026-04-07)
> app.css is 9,565 lines (75% of all CSS). Font-size chaos, sleek theme bloat, hardcoded px values.

- [ ] Fix font-size dual-variable problem — set `font-size` once on containers (`.board-list`, `.sidebar`), remove ~20 per-element declarations, let inheritance work.
- [ ] Replace 86 hardcoded px font-sizes with variables — `12px` (58×) → `var(--font-size-sm)`, `13px` (28×) → `var(--font-size-base)`.
- [ ] Remove unused CSS variables from tokens.css.
- [ ] Merge duplicate selectors in app.css.
- [ ] Shrink sleek theme (1,322 lines) — consolidate redundant declarations, estimated 40-50% reduction.
- [ ] Split app.css into logical modules — sidebar, board, cards, dialogs, tags.

## JS Simplification (analysis 2026-04-07)
> app.js is 11,560 lines with 1,049 functions. 66 localStorage keys with no schema. DI pattern adds boilerplate.

### Break up app.js
- [ ] Extract board data store (~2,300 lines) — `fullBoardData`/`activeBoardData` mutations, loading, saving, diffing.
- [ ] Extract undo/redo system (~1,150 lines) — `undoStack`, `pushUndo()`, delta computation.
- [ ] Extract action registry config (~1,700 lines) — 200+ `ActionRegistry.register()` calls.
- [ ] Extract state initialization (~580 lines) — 48 state variables + `_rt.defineState()` calls.

### Centralize state management
- [ ] Create state key registry — document all 66 `lexera-*` localStorage keys in one file.
- [ ] Create `StateManager` facade — wrap `Settings ? Settings.get() : localStorage.getItem()` pattern.

### Reduce large modules
| File | Lines | Action |
|------|-------|--------|
| workspaceShell.js | 4,877 | Split UI from iframe bridge |
| embedMenu.js | 4,768 | Split by embed domain, audit 63 `_callDep()` calls |
| orderHelpers.js | 3,138 | Extract TitleHelpers, LayoutHelpers, DashboardState |
| management.js | 2,855 | Extract tree node builders |
| boardList.js | 2,844 | Move draft storage to BoardDraftStore |

### Event listener hygiene
- [ ] Audit event listener lifecycle — identify listeners that leak across board switches (407 total across 40 files).

## Board / Session Pipeline
- [ ] Introduce one authoritative board-session store with separate structure/content update paths.
- [ ] Finish stable-id cross-view entity move contract.
- [ ] Remove iframe workspace-shell after in-process state pipeline is ready.

## Legacy Retirement
- [ ] Freeze canonical board contract: `rows → stacks → columns → cards`.
- [ ] Make legacy loading one-way and boundary-only, then delete frontend converters, flat-column schema, format branching.

## Feature Backlog
- [ ] Structure map view (mindmap-style, cf. inklink).
- [ ] Mobile web clipper (`lexera-capture-ios`).
- [ ] Keyboard Phase 2: entity context menu, rename, creation shortcuts.
- [ ] Keyboard Phase 3: command palette, board history, multi-select.
- [ ] Stack width grid (1-12) and column fractional widths.

## Parked Until Explicit Spec
- [ ] Per-user isolation beyond local-user model.
- [ ] Additional sources/editors/pipeline: email, filesystem, office editor, build pipeline, typed API.

## Manual Verification
- [ ] Quick capture: screen resolution change on macOS, Windows, Linux.
- [ ] Quick capture: monitor disconnect migration.
- [ ] Quick capture: watcher deduplication across repeated open/close cycles.

## Feature Backlog
- [ ] Mobile web clipper (`lexera-capture-ios`).
- [ ] Keyboard Phase 2: entity context menu, rename, creation shortcuts, column focus navigation, board search shortcut.
- [ ] Keyboard Phase 3: command palette, board history navigation, multi-select cards.
- [ ] Stack width grid (1-12) and column fractional widths (1/1 .. 1/12).

## Parked Until Explicit Spec
- [ ] Per-user isolation beyond the current local-user model.
- [ ] Additional source/editor/pipeline work: email/filesystem sources, office editor, build pipeline, typed API.
- [ ] Panel anatomy, tag styling, style regression, hit areas, and plugin backlog.
