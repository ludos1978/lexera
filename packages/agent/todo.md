# Lexera Kanban Todo

> Completed items moved to [todo-archive.md](todo-archive.md)

## Active Features
- [ ] Add pptx rendering (needs esbuild bundle of @jvmr/pptx-to-html)
- [ ] Mobile web clipper — finish lexera-capture-ios
- [ ] Dashboard populate speed — massively improve load time
- [ ] Parallel requests/processing — identify bottlenecks for 10x improvement
- [ ] Function catalog — list all functions with descriptions, callers, callees; find refactoring opportunities

## Code Quality
- [ ] **App.js modularization** — 11,927 lines. Main View (~6600 lines) is the last major section.

## Performance
- [x] ~~**Targeted board patching**~~ (efb021c3, 4023fb42) — settings/add-card use DOM ops, live sync uses incremental card updates
- [ ] **Virtual-scroll incremental activation** — avoid full card measurement when only part changed
- [ ] **Reduce shell panel/iframe overhead** — cut DOM shuffling on tab activation

## Architecture
- [ ] **ViewStateStore** — replace ad-hoc closure vars with observable store
- [ ] **Unify shared packages** — merge/separate packages/shared vs lexera-shared
- [ ] **Remove iframe view composition** — replace iframes + postMessage
- [ ] **Backend config service** — extract ConfigService from raw Mutex<SyncConfig>

## Style System
- [ ] **Define two style layers** — Application Style + Board Style

## Deferred
- [ ] Email/filesystem sources, office editor, build pipeline, typed API
- [ ] Per-user isolation, universal view contract, legacy path retirement
- [ ] Panel anatomy, tag styling, style regression, hit areas, plugins
- [ ] Stack width grid (1-12) + column fractional widths (1/1..1/12)
