# Lexera Kanban Todo

> Active backlog only. Completed, superseded, and parked items moved to [todo-archive.md](todo-archive.md).

## Immediate UX / Product
- [ ] Workspace hierarchy double-click should edit in the hierarchy surface, not jump into board-view editing.
- [ ] Redo the font/style unification pass.
  - Keep only: light/normal/bold, italic/underlined, uppercase, and high-contrast background tags with the version-1 contrast and bloom behavior.
- [ ] Remove the workspace dropdown once the hierarchy/catalog tree can express the same workspace filtering and navigation directly.

## Architecture
### Hierarchy unification
- [ ] Define one shared hierarchy contract above `TreeView`.
  - Use one node/capability/intent model for Workspace, Files, and Dashboard.
  - Already done: `packages/lexera-kanban/src/hierarchy/hierarchyController.js` now handles generic tree interactions for Workspace and Dashboard.
- [ ] Migrate Files / Management (`packages/lexera-shared/management.js`) to the shared hierarchy system.
  - Share the catalog tree.
  - Keep management inspectors/forms separate.
- [ ] Collapse workspace hierarchy projection onto the same row/stack/column/card view model as main board rendering.
  - Remove duplicated label/count/visibility logic.
- [ ] Finish the hierarchy cutover by surface.
  - Workspace = catalog + structure.
  - Files = catalog only.
  - Dashboard = results only.

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
