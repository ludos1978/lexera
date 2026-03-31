# Lexera Kanban Todo

## Bugs
- [ ] The dashboard doesnt properly show all the setup elements from the open or selected boards — filterDashboardResultsByScope exists but may filter incorrectly
- [ ] reorderBoards drag error at orderHelpers.js:439 — map() on orderedBoards may fail if array is undefined

## Active Features
- [ ] Add pptx rendering (needs esbuild bundle of @jvmr/pptx-to-html)
- [ ] Mobile web clipper — finish lexera-capture-ios

## Code Quality
- [ ] **App.js modularization** — 13,108 lines. Extract into state/, services/, views/, shell/ layers. No module should mix DOM rendering, localStorage, and API calls. Includes: reduce to orchestration, split frontend layers, settings service behind typed API.

## Misc
- [x] ~~Color theme integrated into visual theme~~ (7c212e7c)
- [x] ~~Overlay editor always available~~ (709cdae2) — setting controls default only, never blocks
- [x] ~~Overlay editor activation from settings~~ (709cdae2) — double-click + Enter respect setting
- [ ] if something has the tag #exclude it should get a "schräg schraffiert ausgegraut zu 20%" style applied! #exclude is also a tag that is by default added to the ta

## Disk / IO Audit — Do Next
- [x] ~~**Log rotation + retention**~~ (7c614dcb) — 10MB size limit, 2 rotated files, startup rotation
- [x] ~~**Lower log volume**~~ (7c614dcb) — noisy targets (tracing::span, loro_internal, storage) filtered to warn
- [x] ~~**Buffered writes**~~ (7c614dcb) — BufWriter, flush every 100 lines or 2s periodic
- [x] ~~**Measure + clean draft storage**~~ (56485a2c) — WebKit localStorage at ~/Library/WebKit/lexera-kanban/ = 2.1MB. Added pruneOrphanedDrafts to clean drafts for removed boards.
- [ ] **Instrument write amplification per save** — add counters/metrics for bytes written across backups, include files, main markdown, `.md.crdt`, crashsaves, and config/auth/invite/public saves so disk cost is visible per operation.
- [x] ~~**Reduce board-save amplification**~~ (ed9cdfec) — main file, include files, and CRDT now skip writes if content unchanged (hash compare before write)
- [ ] **Verify there is no write-loop under active editing** — idle sampling showed no ongoing board rewrites, but active edit sessions still need a timed probe to confirm there is no watcher reload / CRDT rewrite / autosave loop causing repeated disk bursts.
- [x] ~~**Crashsave retention**~~ (ed9cdfec) — rotate_crashsaves keeps max 5 per board, list_crashsaves + 2 new tests
- [ ] **Add a disk-usage diagnostics view or command** — expose current log size, backup size, crashsave count, `.md.crdt` totals, and draft-storage footprint so disk growth is visible without manual filesystem inspection.

## Architecture — Do Next
- [ ] **Real frontend state model** — replace ad-hoc globals + 80+ raw localStorage calls with DocumentSessionStore, ViewStateStore, SettingsStore. Separate shell state from board state.
- [ ] **Unify shared packages** — merge or clearly separate packages/shared (TS types) vs packages/lexera-shared (browser JS/CSS). Replace copy-based sync-runtime-assets.mjs with real package.
- [ ] **Remove iframe view composition** — replace in-window iframes + postMessage with native in-process view instances
- [ ] **Backend config + service cleanup** — extract ConfigService (lock/mutate/save/notify) from raw Mutex<SyncConfig>. Continue AppState decomposition into narrower services.
- [ ] **Parser shared fixtures** — Rust parser is authoritative (1,751 lines). Add shared test fixtures to validate TS parser (337 lines) against it instead of hand-maintained parity.

## Style System — Do Next
- [ ] **Define two style layers** — Application Style (shell, menus, logs, settings) + Board Style (kanban/canvas content). No third overlapping layer.
- [ ] **Unify component primitives** — consolidate 4+ button families (.btn-icon, .sidebar-btn, .board-action-btn, .mgmt-btn) into shared variants (icon, primary, secondary, quiet). Same for selects/inputs.
- [ ] **Extend consistent states** — .view-loading/.view-empty exist for some views. Apply to all surfaces with shared model for connected/loading/empty/error/selected.

## Deferred (revisit when needed)
- [ ] Glaxnimate animation viewer — niche format, no user demand yet
- [ ] Email + Filesystem data sources — filesystem watcher exists, email is large scope
- [ ] Office doc editor (OfficeIMO etc.) — no mature open-source browser editor exists yet
- [ ] Frontend build pipeline — raw serving works fine in Tauri, blocked by app.js split
- [ ] Typed API contract — nice-to-have, frontend/backend tightly coupled in one repo
- [ ] Per-user change isolation — needs Loro fork/branch API, no user demand
- [ ] Universal view contract — views work fine with current approach
- [ ] Retire legacy vs shell UI paths — both work, removing one is large effort
- [ ] Standardize panel anatomy — works fine, just inconsistent
- [ ] Tag styling under board style — tagColors.js works well independently
- [ ] Style regression checks — premature until tokens exist
- [ ] Consistent hit areas — low user impact
- [ ] Plugin architecture — only one plugin type exists, manifest system is over-engineering
