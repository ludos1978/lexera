# Lexera Kanban Todo

> Completed items moved to [todo-archive.md](todo-archive.md)

## Active Features
- [ ] Add pptx rendering (needs esbuild bundle of @jvmr/pptx-to-html)
- [ ] Mobile web clipper — finish lexera-capture-ios

## Code Quality
- [ ] **App.js modularization** — ~11,500 lines. Main View (~6200 lines) remaining. Board settings extracted. Next: board header, canvas ops, management UI wiring.

## Architecture
- [ ] **Remove iframe view composition** — replace iframes + postMessage with in-process views

## Deferred
- [ ] Email/filesystem sources, office editor, build pipeline, typed API
- [ ] Per-user isolation, universal view contract, legacy path retirement
- [ ] Panel anatomy, tag styling, style regression, hit areas, plugins
- [ ] Stack width grid (1-12) + column fractional widths (1/1..1/12)
