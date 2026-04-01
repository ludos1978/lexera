# Lexera Kanban Todo

> Completed items moved to [todo-archive.md](todo-archive.md)

- [x] ~~global sync settings in workspace config~~ (01be1d01) — Global Settings node with (?) tooltips, calendar slug noted as unused
- [ ] the columns cannot be moved to stacks anymore, it doesnt even show a drop highlight! also when dropping cards on other elements they disappear, it might revert in position, but it's not visible until re-rendered. check the source and drop location to re-render the these elements!

## Code Quality
- [ ] **App.js modularization** — ~11,160 lines. Board header (891), board settings (226), management wiring extracted. Next: canvas ops.

## Architecture
- [ ] **Remove iframe view composition** — replace iframes + postMessage with in-process views

## Active Features
- [ ] Mobile web clipper — finish lexera-capture-ios

## Deferred
- [ ] Email/filesystem sources, office editor, build pipeline, typed API
- [ ] Per-user isolation, universal view contract, legacy path retirement
- [ ] Panel anatomy, tag styling, style regression, hit areas, plugins
- [ ] Stack width grid (1-12) + column fractional widths (1/1..1/12)
