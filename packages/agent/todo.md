# Lexera Kanban Todo

> Completed items moved to [todo-archive.md](todo-archive.md)

## Active Features
- [ ] Add pptx rendering (needs esbuild bundle of @jvmr/pptx-to-html)
- [ ] Mobile web clipper — finish lexera-capture-ios
- [ ] Parallel requests/processing — identify remaining bottlenecks
- [ ] Function catalog — list all functions with descriptions, callers, callees; find refactoring opportunities

## Code Quality
- [ ] **App.js modularization** — 11,927 lines. Main View (~6600 lines) is the last major section.

## Architecture
- [ ] **ViewStateStore** — replace ad-hoc closure vars with observable store
- [ ] **Unify shared packages** — packages/shared (TS types) vs lexera-shared (runtime JS). Recommendation: consolidate into proper npm package or clarify boundaries + deduplicate backend discovery.
- [ ] **Remove iframe view composition** — replace iframes + postMessage

## Deferred
- [ ] Email/filesystem sources, office editor, build pipeline, typed API
- [ ] Per-user isolation, universal view contract, legacy path retirement
- [ ] Panel anatomy, tag styling, style regression, hit areas, plugins
- [ ] Stack width grid (1-12) + column fractional widths (1/1..1/12)
