# Lexera Kanban Todo

> Completed items moved to [todo-archive.md](todo-archive.md)

- [x] ~~global sync settings in workspace config~~ (01be1d01) — Global Settings node with (?) tooltips, calendar slug noted as unused
- [x] ~~drag/drop column + card fix~~ (07712fc2) — geometry cache after drop zones, hide source card during async move
- [x] ~~workspace config fixes~~ (75e99ecd) — calendar slug removed, responsive layout, Enter-key save

## Code Quality
- [ ] **App.js modularization** — ~11,183 lines. Board header, board settings, management wiring, sidebar resize dedup extracted. Next: canvas ops.

## Architecture
- [ ] **Remove iframe view composition** — replace iframes + postMessage with in-process views

## Active Features
- [ ] Mobile web clipper — finish lexera-capture-ios

## Performance
- [x] **Divider drag hot path** — cache dock/split container bounds at `pointerdown` and stop calling `getBoundingClientRect()` on every move in `workspaceShell.js`
- [x] **Dock resize fast path** — split `applyDockLayout()` into a drag-safe path so divider dragging does not rebuild fold strips, rebind hover handlers, and retoggle dock classes on every move
- [x] **Sidebar resize layout thrash** — remove repeated `clientHeight`/`offsetHeight`/`getComputedStyle()` reads from live divider dragging and batch sidebar section/width updates with `requestAnimationFrame`
- [x] ~~**Sidebar resize unified + canvas resize deferred**~~ (d9ec64f2) — removed 310 lines of duplicated resize code, canvas bounds recompute moved to drag end
- [x] **Resize transition lag** — disable `.board-stack` width/flex transitions during live resize so stack borders track the pointer instead of animating 150ms behind it

## Deferred
- [ ] Email/filesystem sources, office editor, build pipeline, typed API
- [ ] Per-user isolation, universal view contract, legacy path retirement
- [ ] Panel anatomy, tag styling, style regression, hit areas, plugins
- [ ] Stack width grid (1-12) + column fractional widths (1/1..1/12)
