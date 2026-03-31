# Lexera Kanban Todo

> Completed items moved to [todo-archive.md](todo-archive.md)

## Active Features
- [ ] Add pptx rendering (needs esbuild bundle of @jvmr/pptx-to-html)
- [ ] Mobile web clipper — finish lexera-capture-ios
- [ ] Parallel requests/processing — identify remaining bottlenecks

## Code Quality
- [ ] **App.js modularization** — 11,927 lines. Main View (~6600 lines) is the last major section.

## Architecture
- [ ] **Unify shared packages** — packages/shared (TS types) vs lexera-shared (runtime JS). No code overlap but backend discovery is duplicated. Recommendation: clarify boundaries + deduplicate.
- [ ] **Remove iframe view composition** — replace iframes + postMessage with in-process views

## Deferred
- [ ] Email/filesystem sources, office editor, build pipeline, typed API
- [ ] Per-user isolation, universal view contract, legacy path retirement
- [ ] Panel anatomy, tag styling, style regression, hit areas, plugins
- [ ] Stack width grid (1-12) + column fractional widths (1/1..1/12)
