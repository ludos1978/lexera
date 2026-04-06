# Lexera Kanban Todo

> Active backlog only. Completed, superseded, and parked items moved to [todo-archive.md](todo-archive.md).

- [ ] remove the default search suggestions below the "active board, all boards" dropdown.
  - instead the user can search and pin the searches, these should be placed below, similar to the default results we have in there already (tasks, tags, embeds, broken includes/embeds)

- [x] pressing a url link should open it in the browser by default.
  - `packages/lexera-kanban/src/dragdrop/dndListeners.js` link-click handler now routes through `openUrlInSystem()` (Tauri `open_url` command → default browser) instead of `window.open()` (which tried to navigate the webview).
  - `openUrlInSystem` injected into the DndListeners dep bag from `app.js:296`.

- [ ] make a structure map view using a similar system as https://www.reddit.com/r/Markdown/comments/1sdm1a2/inklink_markdown_to_mindmap_converter/  https://github.com/lalulali/inklink  

- [ ] unify the hierarchy in workspace, dashboard and in files > workspaces!
  - it needs to feature a top element that can be repeated nicely.
  - it needs to have a hierarchy below that can be folded.
  - each row can have one or more buttons or texts aligned at the right.
  - clicking on each row can focus an element.
  - **analysis 2026-04-06**: all three surfaces already share the same `TreeView` renderer (`packages/lexera-kanban/src/treeView.js`) and the same `HierarchyContract` metadata system (`packages/lexera-kanban/src/hierarchy/hierarchyContract.js`). The divergence is in the three separate **node-builder + interaction-wiring** layers above them. Unification does NOT require a new tree component — it requires collapsing the three builder/wiring layers into one shared pipeline.
  - **Current state per surface**:
    - **Workspace** (`sidebarTree.js` + `boardList.js` + `sidebarSync.js`): 5-level tree (board→row→stack→column→card), full drag-drop via `data-tree-drag`, context menus via `.tree-menu-btn`, sync-highlight, persisted expand/collapse, double-click-to-edit. Node builder: `buildSidebarTreeNodes()`.
    - **Dashboard** (`dashboardTree.js` + `orderHelpers.js`): 2-level tree (group→result), click-to-navigate, no drag/menu/persist. Node builders: `buildDashboardResultTreeNodes()`, `buildDashboardInventoryTreeNodes()`, `buildDashboardBrokenTreeNodes()`, `buildDashboardTaggedTreeNodes()`.
    - **Management** (`management.js`): 2-3 level tree (root/workspace→board), single-select with inspector panel, no drag/menu/persist. Node builder: `buildConfigTreeNodes()`.
  - **Already-shared infrastructure**:
    - TreeView renders all three using the same DOM structure (`.tree-entry`, `.tree-node`, `.tree-children`, `.tree-toggle`, `.tree-label`, `.tree-meta`, `.tree-grip`, `.tree-menu-btn`, `.tree-count`).
    - HierarchyContract stamps `data-hierarchy-surface`, `data-hierarchy-kind`, `data-hierarchy-entity-id`, `data-hierarchy-capabilities` on every node in all three surfaces.
    - HierarchyController provides event delegation and capability-based action routing.
  - **Concrete divergences to resolve**:
    1. **Node builders**: three separate functions that each produce node objects in slightly different ways (different `type` strings, different `attrs` maps, different `hierarchy.capabilities` arrays). Need one `buildTreeNodes(source, surface)` entry point that delegates to surface-specific data adapters.
    2. **Interaction wiring**: three separate `bind*Interactions()` functions. HierarchyController is supposed to replace all three but workspace still has direct event handlers in `boardList.js:1732-1804`.
    3. **Style tokens**: workspace uses `data-tree-drag`, dashboard uses `data-dashboard-*`, management uses `data-mgmt-config-*`. The hierarchy-contract attributes ALREADY exist on every node — the surface-specific `data-*` attributes are a legacy parallel channel that should be eliminated.
    4. **Right-side actions**: workspace renders grip+menu+count, dashboard renders count only, management renders count+star. Need a unified "slot" model where the node definition declares what goes in the right-side meta area and TreeView renders it.
    5. **Selection model**: workspace = focus-highlight, dashboard = navigate-away, management = select-for-inspector. These are three different "activate" semantics that should be handled by capability tokens (`activate-focus`, `activate-navigate`, `activate-select`), not three separate event handlers.
    6. **Expand/collapse persistence**: only workspace persists; dashboard and management don't. Should be a per-surface option on the tree host, not hardcoded into the builder.
  - **Implementation plan** (tasks below in Architecture section).

## Immediate UX / Product
- [ ] Redo the font/style unification pass.
  - Keep only: light/normal/bold, italic/underlined, uppercase, and high-contrast background tags with the version-1 contrast and bloom behavior.
- [ ] Remove the workspace dropdown once the hierarchy/catalog tree can express the same workspace filtering and navigation directly.

## Architecture
### Hierarchy unification — concrete tasks (analysis 2026-04-06)
> All three surfaces already share `TreeView` (renderer) and `HierarchyContract` (metadata). The work is to collapse the three separate node-builder + interaction-wiring layers into one shared pipeline.

**Phase 1: One node-builder interface** (re-audited 2026-04-06)
> Re-audit finding: all three surfaces already stamp `data-hierarchy-*` attributes via HierarchyContract, BUT: `data-hierarchy-entity-id` alone is not sufficient for navigation — dashboard and workspace activation code needs `boardId`, `rowIndex`, `stackIndex`, `colLocalIndex`, `cardIndex`, `columnTitle`, `brokenSrc` to build a navigation target. The hierarchy contract only carries `surface/kind/entityId/capabilities/selectable`. The surface-specific `data-*` attributes carry the positional navigation data that the hierarchy contract was never designed to hold. Eliminating them requires either (a) extending the hierarchy contract with a generic `data: {}` bag, or (b) having each surface provide an `extractNavigationTarget(node)` adapter function. Approach (b) is minimal and already partially exists (`buildDashboardNavResultFromTreeNode`, `buildHierarchyFocusTargetFromTreeNode`).

- [x] ~~**Define `HierarchyNodeAdapter` interface**~~ — **ALREADY EXISTS**: `HierarchyController.bindTreeInteractions(el, options)` takes an options bag with `onNodeActivate`, `onNodeMenu`, `onNodeEdit`, `onGripClick`, `onNodeToggle`, `onNodeContextMenu`. All three surfaces already pass these callbacks. A separate adapter class would be a wrapper over something that already works.
- [x] ~~**Route all tree interactions through HierarchyController**~~ — **ALREADY DONE**: workspace (`boardList.js:2059`), dashboard (`orderHelpers.js:2104`), and management (`management.js:2333`) all call `bindTreeInteractions`. The direct event handlers in `boardList.js:1732-1804` were replaced by `_bindBoardTreeInteractions`.
- [ ] **Standardize the navigation-target extraction** — each surface currently has its own function to extract a navigation target from a DOM node: workspace uses `buildHierarchyFocusTargetFromTreeNode` (reads `data-row-id`, `data-card-id`, etc.), dashboard uses `buildDashboardNavResultFromTreeNode` (reads `data-dashboard-board-id`, `data-dashboard-card-id`, etc.), management reads `data-mgmt-config-type` + `data-mgmt-config-id` inline. Unify to one `extractActivationTarget(node, surface)` that delegates to the surface-appropriate parser.
- [ ] **Migrate workspace node builder** — `buildSidebarTreeNodes()` in `sidebarTree.js` still carries domain-specific `data-board-id` / `data-row-index` / etc. alongside the hierarchy-contract attributes. These positional attributes are consumed by `_extractTreeNodeScopeCtx`, `buildHierarchyFocusTargetFromTreeNode`, and the DnD system. Migration: switch consumers to read from the hierarchy descriptor + a surface-specific `extractActivationTarget`, then remove the duplicate `data-*` attributes from the builder.
- [ ] **Migrate dashboard node builders** — `dashboardTree.js` still stamps `data-dashboard-*` on every node alongside the hierarchy descriptor. Migration: switch `activateDashboardTreeNode` and `buildDashboardNavResultFromTreeNode` to read from the hierarchy descriptor where possible, keep a minimal surface-specific payload only for fields the descriptor can't carry (boardId, positional indices), then consolidate the extraction into one function.
- [ ] **Migrate management node builder** — `management.js::buildConfigTreeNodes` stamps `data-mgmt-config-type` and `data-mgmt-config-id` alongside the hierarchy descriptor. Migration: switch the selection handler to read from `data-hierarchy-kind` + `data-hierarchy-entity-id`, then remove the parallel attributes.

**Phase 3: One style contract**
- [ ] **Unify the right-side "meta slot" model** — TreeView already renders `.tree-meta` with count + grip + menu-btn. Extend the node definition with a `metaSlots: [{ type: 'count'|'badge'|'button'|'label', … }]` array so each surface can declare what goes there without forking the renderer.
- [ ] **Collapse workspace hierarchy projection onto the same row/stack/column/card view model as main board rendering** — remove duplicated label/count/visibility logic between `sidebarTree.js` and `app.js::buildColumnElement`.
- [ ] **Write one shared CSS rule set for tree surfaces** — currently app.css has separate rule blocks for sidebar tree, dashboard tree, and management tree. Consolidate into one `.tree-view-host .tree-*` rule set that all three surfaces inherit.

**Phase 4: Cutover and cleanup**
- [ ] **Finish the hierarchy cutover by surface**: workspace = catalog + structure, files = catalog only, dashboard = results only.
- [ ] **Delete `sidebarTree.js`** after the workspace adapter handles all its node building.
- [ ] **Delete `dashboardTree.js`** after the dashboard adapter handles all its node building.
- [ ] **Delete the `buildConfigTreeNodes` / `bindConfigTreeInteractions` functions from `management.js`** after the management adapter handles them.
- [ ] **Add regression tests** — one test per surface verifying the adapter produces the same node tree as the old builder, and that interactions (click, dblclick, contextmenu, drag) dispatch the right actions via HierarchyController.

### Board / session update pipeline
- [ ] Introduce one authoritative board-session store.
  - Separate structure updates from content updates.
  - Remove overlapping ownership across `app.js`, `LexeraRuntime`, hierarchy cache, and iframe bridges.
- [ ] Finish the stable-id cross-view entity move contract.
  - One normalized move command path for workspace, kanban, canvas, and multi-pane moves.
  - Correct highlighting/focus before, during, and after moves.
- [ ] Close the remaining reorder/focus/cross-view-move regression gaps.
- [ ] Remove iframe workspace-shell composition after the in-process state and move pipeline is ready.

### Legacy retirement — one canonical codepath
- [ ] Freeze the canonical board contract: `rows -> stacks -> columns -> cards`.
- [ ] Make legacy board loading one-way and boundary-only.
- [ ] Delete frontend legacy converters and fallback readers.
- [ ] Delete shared legacy flat-column schema/types.
- [ ] Collapse backend parsing onto the canonical model.
- [ ] Remove dual runtime structures (`rows` plus derived legacy `columns`).
- [ ] Delete format branching from normal runtime flow.
- [ ] Extend invariant coverage beyond converter call-site counts.
- [ ] Document the cutover order in the board/core specs.

## Code Health
- [ ] Break `app.js` into smaller modules.
  - Highest-value slices: board rendering, board event wiring, workspace-shell bridge, dashboard wiring.

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
