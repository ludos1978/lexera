# Lexera Kanban Todo

- [x] ~~workspace config icons removed~~ (59ae86bf) — plain hierarchy, no folder/file icons
- [x] ~~hierarchy tree lines improved~~ (b75a9edc) — consistent connectors and indentation
- [x] ~~broken elements focus fixed~~ (342df375) — KID-based lookup instead of positional DOM queries
- [x] ~~hierarchy embed/include context menu~~ (cab7dfe4) — right-click shows same options as board burger menu

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
