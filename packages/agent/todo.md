# Lexera Kanban Todo

- [ ] dont use any icons in the files configuration > workspaces. it's not a folder and its not a file icon we use. it should use the same hierarchy structure we use everywhere!
- [ ] improve the hierarchy structure we re-use in several places. the lines and etc are not consistant and dont look good yet.
- [ ] the items in broken elements in the dashboard are not focussing on the correct place in the board when clicking them!
- [ ] when right clicking elements in the hierarchy that are embeds or includes, show the same options as in the burger menu on the item in the board.

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
