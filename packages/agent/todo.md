# Lexera Kanban Todo

## Bugs
- [x] ~~Dashboard scope~~ (35db71de)
- [x] ~~reorderBoards crash~~ (cd849d0a)
- [x] ~~board reorder not working~~ (16494248) — fingerprint cache invalidation

## Active Features
- [ ] Add pptx rendering (needs esbuild bundle of @jvmr/pptx-to-html)
- [ ] Mobile web clipper — finish lexera-capture-ios
- [ ] Dashboard populate speed — can we massively improve load time?
- [ ] Parallel requests/processing — identify bottlenecks for 10x improvement
- [ ] Function catalog — list all functions with descriptions, callers, callees; find refactoring opportunities

## Code Quality
- [ ] **App.js modularization** — 11,927 lines. Main View (~6600 lines) is the last major section.

## Performance
### Done
- [x] ~~Fold hover + cached sizing~~ (ee6be11a)
- [x] ~~Dashboard list rebuild cache~~ (b79f437a)
- [x] ~~Mirror cloning skip invisible~~ (944ddb3e)
- [x] ~~Broken scan deferred + inventory cached~~ (92606536)
- [x] ~~Polling UI churn~~ (e18b429a)
- [x] ~~Embedded iframe interval~~ (6208eb5d)
- [x] ~~Post-render passes batched~~ (be73e721)
- [x] ~~Board-load payload trimmed~~ (d05652c7)
- [x] ~~File search cache~~ (c7591137)
- [x] ~~Include-watch incremental~~ (ea004b74)

### Open
- [ ] **Replace full board rerenders with targeted patching** — renderColumns() clears and rebuilds entire board DOM for small mutations
- [ ] **Sidebar tree incremental updates** — renderBoardList() clears and rebuilds entire hierarchy on polling
- [ ] **Lightweight folded dashboard preview** — hovering reattaches large live DOM subtree
- [ ] **Drag/drop geometry caching** — cache hit-test geometry per drag instead of per-mousemove
- [ ] **Virtual-scroll incremental activation** — avoid full card measurement when only part changed
- [ ] **Reduce shell panel/iframe overhead** — cut DOM shuffling on tab activation

## Misc
### Done
- [x] ~~Color theme~~ (7c212e7c), ~~overlay editor~~ (709cdae2), ~~#exclude hatching~~ (fd8ee2e9)
- [x] ~~Special characters~~ (77f416a2), ~~marp toggle removed~~ (5054580d)
- [x] ~~Config dialog~~ (5fdd8c8a), ~~board clipping~~, ~~log status bar~~ (e4d95166)

## Disk / IO Audit — All Done
- [x] ~~Log rotation~~ (7c614dcb), ~~buffered writes~~ (7c614dcb), ~~draft cleanup~~ (56485a2c)
- [x] ~~Write counters~~ (b975861f), ~~save amplification~~ (ed9cdfec), ~~crashsave retention~~ (ed9cdfec)
- [x] ~~Disk diagnostics~~ (b975861f)

## Architecture
### Done
- [x] ~~SettingsStore~~ (ac3103cb) — 32+ keys, 15 modules migrated
- [x] ~~Parser shared fixtures~~ (69946a76) — 7 fixtures validated against Rust parser

### Open
- [ ] **ViewStateStore** — replace ad-hoc closure vars with observable store
- [ ] **Unify shared packages** — merge/separate packages/shared vs lexera-shared
- [ ] **Remove iframe view composition** — replace iframes + postMessage
- [ ] **Backend config service** — extract ConfigService from raw Mutex<SyncConfig>

## Style System
- [x] ~~Button primitives~~ (1aea8ea1), ~~view states~~ (1b2b5d95)
- [ ] **Define two style layers** — Application Style + Board Style

## Deferred
- [ ] Email/filesystem sources, office editor, build pipeline, typed API
- [ ] Per-user isolation, universal view contract, legacy path retirement
- [ ] Panel anatomy, tag styling, style regression, hit areas, plugins
- [ ] Stack width grid (1-12) + column fractional widths (1/1..1/12)
