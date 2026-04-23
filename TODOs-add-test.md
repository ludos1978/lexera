# Frontend test coverage gaps — suggestions

All 154 existing tests in `lexera-kanban/src/test/frontendTests.js` live
in `scope: kanban` / `workspace` / `dashboard` / `export` / `global`.
The 6 buckets below have **zero coverage today**. Each proposal names
the user action and the observable assertion so tests stay
behavior-driven, not implementation-driven.

Test names follow the `'minor: description'` convention so
`SCOPE_BY_MINOR` can auto-bucket them — add each new minor prefix to
that map when you register the tests.

---

## scope: editor — card editor modal + inline + autocomplete

Today the tests only mutate `card.content` directly via `setTestBoard`.
The editor path is completely untested.

- [ ] **`editor open: double-click card opens modal with raw markdown`** — dispatch `dblclick` on a `.card`, assert modal open, assert `<textarea>` value equals `card.content` (including `#hidden-internal-*` and `!!!include(...)!!!` which the DOM strips).
- [ ] **`editor save: Ctrl+Enter persists content and closes modal`** — open editor, type appended text, fire `keydown Ctrl+Enter`, assert modal closed, assert `api().getFullBoardData()` card content matches, assert DOM card title reflects change.
- [ ] **`editor cancel: Escape reverts without mutating`** — open editor, type, fire `keydown Escape`, assert modal closed, assert card content **unchanged** in data and DOM.
- [ ] **`editor autocomplete: typing "#tod" pops suggestion containing #today`** — open editor, type `#tod` into textarea, fire `input`, poll for `.autocomplete-suggestion`, assert one entry is `#today`. Select with arrow + Enter, assert textarea value now contains `#today`.
- [ ] **`editor autocomplete: file search [[ triggers wiki-link picker`** — type `[[` in textarea, poll for search dialog, type a filename substring, assert matching board shown, click it, assert wiki-link `[[filename]]` inserted at cursor.
- [ ] **`editor wysiwyg: toggle mode preserves cursor position and content`** — open editor, place cursor mid-word, toggle markdown↔wysiwyg via button, assert content round-trips losslessly and selection survives the swap.
- [ ] **`inline editor: Tab from card title edit expands to full modal`** — single-click card title, type, press `Tab`, assert inline editor closed and full modal opened with typed content preserved.

---

## scope: canvas — canvas layout + drag / pan / zoom

Canvas mode is activated by changing board layout but no test exercises
the view.

- [ ] **`canvas enter: switch layout to canvas renders .columns-container.layout-canvas`** — set board layout via API, assert `.columns-container` has `layout-canvas` class, assert each stack has `--canvas-stack-x/--canvas-stack-y` CSS vars set from `stack.params`.
- [ ] **`canvas pan: pointer-drag on empty scene updates pan offset and preserves stack positions`** — dispatch `pointerdown`/`pointermove`/`pointerup` on `.canvas-scene`, assert `--canvas-pan-x/-y` CSS vars reflect drag delta, assert stacks' `getBoundingClientRect()` shifted by the same delta.
- [ ] **`canvas zoom: Ctrl+wheel changes zoom factor and clamps to min/max`** — fire `wheel` event with `ctrlKey` and `deltaY`, assert `--canvas-zoom` changed, assert repeated zoom-in stops at 3.0 and zoom-out at 0.25.
- [ ] **`canvas zoom: Ctrl+0 resets zoom and pan`** — manually set zoom/pan, fire `Ctrl+0`, assert `--canvas-zoom=1`, `--canvas-pan-x=0`, `--canvas-pan-y=0`.
- [ ] **`canvas drag: drop card on empty canvas creates stack at drop position with stored x/y`** — drag a card to an empty area, drop, assert new stack's `params.x/params.y` match drop point rounded; exit canvas mode and re-enter, assert position restored.
- [ ] **`canvas resize: drag stack resize handle updates stack width and persists to params.width`** — grab `.canvas-stack-resize-handle`, pointer-drag by 100px, assert stack width changed, assert `fullBoardData` stack.params.width saved.
- [ ] **`canvas grid: toggling grid off hides .canvas-grid overlay and data-canvas-grid="off"`** — toggle canvas grid via menu, assert `.columns-container[data-canvas-grid="off"]` and grid overlay hidden.

---

## scope: settings — frontend / board / controls settings panels

The shared-management UI and settings store are entirely untested from
the user side.

- [ ] **`settings open: burger menu → Settings opens management panel with frontend tab active`** — click burger, click Settings, assert `.mgmt-panel` visible, assert tab `frontend` active.
- [ ] **`settings theme: changing theme dropdown applies [data-theme] and persists in LexeraSettings`** — change theme selector, fire `change`, assert `<html>` `[data-theme]` attr updated, assert `LexeraSettings.get('theme')` matches.
- [ ] **`settings font: changing board font size updates --board-font-size immediately`** — change font-size slider, assert computed `--board-font-size` reflects new value, assert one card's rendered font-size changed.
- [ ] **`settings board: enabling "sticky stack headers" toggles class on .columns-container`** — toggle checkbox, assert `.columns-container` gains/loses `sticky-stacks` class and `LexeraSettings.get('stickyStackMode')` matches.
- [ ] **`settings reset: "reset to defaults" restores default values and persists`** — change 3 settings, click reset, assert all three reverted to tokens.css defaults and `LexeraSettings` storage cleared.
- [ ] **`settings live: changes applied while management panel is open reflect in open board without reload`** — dual state: change cardMinHeight setting, assert card element's computed min-height updated without closing the panel.

---

## scope: menu — card / column / row / stack / embed context menus

Menu builders have exhaustive `contextMenuBuilders` code but no tests
exercise the menus as a user would.

- [ ] **`card menu: right-click card opens menu with expected items`** — dispatch `contextmenu` on `.card`, assert menu visible, assert items include: Edit, Duplicate, Park, Archive, Trash, Tags, Move to, Copy as markdown.
- [ ] **`card menu: "Duplicate" clones the card with a new id and inserts below`** — open menu, click Duplicate, assert visible card count +1 in column, assert new card content matches original, assert new card has a different id (no duplicate ID).
- [ ] **`card menu: "Trash" moves card to deleted bucket and updates btn-trash count`** — open menu, click Trash, assert card hidden from DOM, assert `btn-trash` has `has-items` class and trash count +1.
- [ ] **`column menu: right-click column header opens menu with include actions conditional`** — contextmenu on non-include column, assert "Enable include" present and "Edit include" absent; same on include column → opposite.
- [ ] **`column menu: sort by title reorders cards alphabetically in DOM`** — column with 5 cards, open menu → Sort → by title, assert card order is alphabetical by title.
- [ ] **`column menu: delete column prompts confirm then removes column from DOM + data`** — mock confirm → yes, assert col count -1 in DOM and data, assert undo restores.
- [ ] **`row menu: rename via double-click row title opens inline input seeded with raw title`** — double-click row title, assert `<input>` appears with raw title incl. `!!!include(...)!!!`, type new title, Enter, assert row title updated.
- [ ] **`stack menu: "New stack before/after" creates an empty stack and row structure is preserved`** — contextmenu stack, Insert before, assert +1 stack and stacks[N-1] is newly inserted with default title.
- [ ] **`embed menu: right-click embed image opens embed-specific menu`** — contextmenu on `.embed-container`, assert menu contains "Replace", "Open in editor", "Remove", "Copy path".
- [ ] **`menu close: clicking outside closes menu and stops event propagation correctly`** — open any menu, click on a different card, assert original menu closed and the click didn't open a second menu.

---

## scope: logs — log panel, filtering, logging contract

The logging system has filters, level indicators, and dedup — none of
which are tested end-to-end.

- [ ] **`logs open: clicking log pill in status bar opens log-panel at bottom`** — click log status indicator, assert `.log-panel` visible, assert latest N entries rendered.
- [ ] **`logs filter: typing in filter input narrows visible entries`** — type `"render.fullBoard"` in filter, assert only entries with that tag visible, clear filter, assert all entries back.
- [ ] **`logs level: clicking "errors" button shows only level=error rows`** — toggle level filter, assert `.log-entry[data-level="warn"]` hidden and `[data-level="error"]` visible.
- [ ] **`logs dedup: same message within 3s only appears once in the panel`** — call `lexeraLog('warn', 'test.dedup', 'same message')` 5× in a row, assert exactly 1 rendered entry with a repeat counter showing "5×".
- [ ] **`logs entry: calling lexeraLog writes to panel with level, tag, ISO timestamp`** — call logger, assert new `.log-entry` exists with expected `data-level`, `data-target`, and timestamp within 1s of now.
- [ ] **`logs contract: console.log / alert / prompt are NOT used anywhere in rendered DOM output`** — scan window-scope for any `.native-alert-dialog` after a failing action to enforce the "never use native popups" rule documented in `CLAUDE.md`.
- [ ] **`logs copy: "copy logs" action places filtered entries on clipboard in text format`** — open panel, filter to 3 entries, click copy, assert `navigator.clipboard.readText()` matches the rendered text.

---

## scope: calendar — week / month calendar panels

Calendar is populated from dashboard search results but no test opens
the panel or interacts with it.

- [ ] **`calendar open: View menu → Calendar opens .calendar-panel with current week`** — open calendar panel, assert visible, assert header shows this week's date range, assert 7 day columns present.
- [ ] **`calendar task: card with #today appears in today's column of week view`** — fixture card `#today`, open calendar, assert `.calendar-task[data-card-id]` for that card appears under today's column.
- [ ] **`calendar task: card with #tomorrow appears only under tomorrow's column`** — same pattern, assert task in tomorrow's column and NOT in today's.
- [ ] **`calendar nav: clicking "next week" advances range and repositions tasks`** — capture current range text, click next-week button, assert new range is +7 days, assert today's task moved to the proper relative column.
- [ ] **`calendar click: clicking a calendar task opens the card editor modal`** — click `.calendar-task`, assert editor modal opens with that card's content.
- [ ] **`calendar drag: dragging a task to a different day updates its temporal tag`** — drag task from today → Friday, drop, assert card content tag `#today` replaced by `#date(2026-MM-DD)` matching the drop day, assert calendar re-renders task under Friday.
- [ ] **`calendar month: switching to month view preserves selected date and renders overflow "+N more"`** — select a date, switch view, assert selection highlighted, assert cells with >3 tasks show "+N more" link.
- [ ] **`calendar sync: creating a new card with #today via Quick Capture shows up live in calendar`** — use `api().addCardToActiveBoard(0, 'new task #today')`, assert calendar panel gets a new `.calendar-task` within 500ms without explicit refresh.

---

## Cross-cutting tests worth adding regardless

These don't fit a single bucket but plug coverage gaps surfaced during
the render-optimization / delta-targeting work:

- [ ] **`render.fullBoard: counter is zero at end of each kanban-scope test`** — read `window.__lexeraRenderColumnsCount` delta during test body; if >0, fail with the caller stack that was logged. Makes the full-render tracer actionable automatically — any regression that reintroduces a full render fails this canary.
- [ ] **`refreshTargeted: moveCard same-column emits exactly [column, sidebar] targets`** — instrument `persistBoardMutation`, perform a move, assert targets `[column, sidebar]` — catches the "4 stacks undo" regression at its source.
- [ ] **`undo: delta for same-column card reorder contains only cards.oldOrder/newOrder`** — after a reorder, inspect the undo stack's top entry and assert the delta has exactly `rows.modified[X].stacks.modified[Y].columns.modified[Z].cards` with no stack/column shape changes.

---

## Suggested implementation order

1. **`render.fullBoard` counter canary** + **`refreshTargeted: moveCard same-column` target assertion** — cheap, and would have caught the 4-stack undo regression automatically.
2. **`menu` scope (8 tests)** — builds on existing context-menu test helpers in `rowStackMenu` tests; high user-value, low implementation cost.
3. **`editor` scope (7 tests)** — editor modal exercises a lot of production code that's currently only covered indirectly via `setTestBoard`.
4. **`settings` scope (6 tests)** — cheap DOM-observable tests, catches theme/font regressions.
5. **`calendar` scope (8 tests)** — needs `#today` / `#tomorrow` tag flow to work; pairs well with the existing temporal-tag infra.
6. **`logs` scope (7 tests)** — lowest priority since logging is itself infra; still useful to lock in dedup and filter contracts.
7. **`canvas` scope (7 tests)** — most complex (pointer events, CSS vars, stack positioning); tackle last.
