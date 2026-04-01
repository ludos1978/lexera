# Lexera Kanban Todo

> Completed items moved to [todo-archive.md](todo-archive.md)

- [x] ~~clicking on items found by the dashboard must focus on them. Even if they are a broken include file, just show where it's included!~~ (d491dd5e) — cardIndex passed through navigation chain; Priority-2 col+card index lookup in focusSearchResultCard

- [x] ~~global sync settings in workspace config~~ (01be1d01) — Global Settings node with (?) tooltips, calendar slug noted as unused
- [x] ~~drag/drop column + card fix~~ (07712fc2) — geometry cache after drop zones, hide source card during async move
- [x] ~~workspace config fixes~~ (75e99ecd) — calendar slug removed, responsive layout, Enter-key save

- [x] ~~dashboard layout collapse fixed~~ (edd8cf2b) — dashboard always flex:1 1 auto, never fixed pixel height
- [x] ~~**Audit all views for unnecessary fixed-pixel sizing**~~ — audited sidebar (sidebarResize.js), workspace shell docks, canvas layout, app.css, workspaceShell.css. All inline `flex: 0 0 Npx` instances are user-initiated resize values. No problematic fixed-pixel layout overrides found.

- [ ]  the width of stacks must be configurable for each stack. there should also be a board wide setting that is the default for all stacks. what is the way to define configuration values for stacks?

- [ ] the quick clipboard doesnt detect screen changes which makes it not stick to borders when something changes in the OS setup. can you detect that and update the position on screen resolution changes? it must work on osx, windows and linux!

- [ ] why could this happen? "Save failed. Recovery copy written: World_n_Level_Design-Topics_Kanban-crashsave-20260401-205911.md" there is no given reason for this to be needed!

- [ ] it should be possible to copy stacks formatted (same method and functions as with the cards)

## Code Quality
- [ ] **App.js modularization** — **10,832 lines** (down from 25K+). All major sections extracted. Remaining is core board rendering + event wiring.



## Architecture
- [ ] **Remove iframe view composition** — replace iframes + postMessage with in-process views

- [ ] the menu for embeds and includes should be as this:
  - Open in System App
  - Show in Finder
  - Copy Path
  - separator
  - Replace document (displays an overlay to fix embed/include files, it searches for files with the same filename with it previews of the currently selected file, it also allows browsing for an alternative document using a file browser, lastly it allows pasting or dropping alternative documents into the view to directly replace the document, it can also open a browser that is prefilled with the original filename and or alt text)
  - separator
  - Convert to Relative Path
  - Force Refresh
  - Info
  - Delete Embed/Include

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
