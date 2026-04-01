# Lexera Kanban Todo

> Completed items moved to [todo-archive.md](todo-archive.md)

- [x] ~~global sync settings in workspace config~~ (01be1d01) — Global Settings node with (?) tooltips, calendar slug noted as unused
- [x] ~~drag/drop column + card fix~~ (07712fc2) — geometry cache after drop zones, hide source card during async move
- [ ] remove the calendar slug in files > workspaces 
- [ ] make the layout of files > workspaces different. when there isnt enough space it should make both sides (hierarchy & values inspector) scrollable together. but the left side should at max use 50% of the view 
- [ ] changing values in files > workspaces isnt applied. the workspace name is not saved, but check all values how they are applied and used in other areas!

## Code Quality
- [ ] **App.js modularization** — ~11,160 lines. Board header (891), board settings (226), management wiring extracted. Next: canvas ops.

## Architecture
- [ ] **Remove iframe view composition** — replace iframes + postMessage with in-process views

## Active Features
- [ ] Mobile web clipper — finish lexera-capture-ios

## Performance
- [x] **Divider drag hot path** — cache dock/split container bounds at `pointerdown` and stop calling `getBoundingClientRect()` on every move in `workspaceShell.js`
- [x] **Dock resize fast path** — split `applyDockLayout()` into a drag-safe path so divider dragging does not rebuild fold strips, rebind hover handlers, and retoggle dock classes on every move
- [x] **Sidebar resize layout thrash** — remove repeated `clientHeight`/`offsetHeight`/`getComputedStyle()` reads from live divider dragging and batch sidebar section/width updates with `requestAnimationFrame`
- [ ] **Sidebar resize duplication** — unify the duplicated resize hot path in `orderHelpers.js` and `sidebar/sidebarResize.js` so performance fixes land once and stay aligned across frontend/backend-shared views
- [ ] **Canvas stack resize churn** — keep live stack resize responsive without running full canvas bounds/connection recompute on every drag frame; observer duplication is fixed, per-frame bounds sync still needs a lighter path
- [x] **Resize transition lag** — disable `.board-stack` width/flex transitions during live resize so stack borders track the pointer instead of animating 150ms behind it

## Deferred
- [ ] Email/filesystem sources, office editor, build pipeline, typed API
- [ ] Per-user isolation, universal view contract, legacy path retirement
- [ ] Panel anatomy, tag styling, style regression, hit areas, plugins
- [ ] Stack width grid (1-12) + column fractional widths (1/1..1/12)
