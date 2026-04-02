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

- [x] ~~why could this happen? "Save failed. Recovery copy written"~~ (eaef84db) — notification now shows the actual error reason. Most likely causes: HTTP 409 conflict (external file changes), network timeout (10s), temporary backend unavailability

- [x] ~~it should be possible to copy stacks formatted (same method and functions as with the cards)~~ (dc065f21) — added 'Copy as formatted' (HTML clipboard) to stack, column, and row context menus

## Code Quality
- [ ] **App.js modularization** — **10,832 lines** (down from 25K+). All major sections extracted. Remaining is core board rendering + event wiring.

- [ ] the text size isnt unified over all the styles and all the fonts in and outside the kanvan. for our default style all fonts have the same size in the kanban mode. in canvas mode the board view might zoom smaller or bigger then the rest of the application. but in kanban mode all fonts have exactly the same size.. ALL FONTS!

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
