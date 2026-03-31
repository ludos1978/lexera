# Lexera Kanban Todo

## Bugs
- [x] ~~Dashboard scope~~ (35db71de) — defaults to all in workspace shell mode
- [x] ~~reorderBoards crash~~ (cd849d0a) — guard against non-array boards dep

## Active Features
- [ ] Add pptx rendering (needs esbuild bundle of @jvmr/pptx-to-html)
- [ ] Mobile web clipper — finish lexera-capture-ios

## Code Quality
- [ ] **App.js modularization** — 11,927 lines (down from 25K+). Remaining: Main View (~6600 lines core rendering) is the only major section left. All small sections extracted.

## Misc
- [x] ~~Color theme integrated into visual theme~~ (7c212e7c)
- [x] ~~Overlay editor always available~~ (709cdae2) — setting controls default only, never blocks
- [x] ~~Overlay editor activation from settings~~ (709cdae2) — double-click + Enter respect setting
- [x] ~~#exclude diagonal hatching~~ (fd8ee2e9) — SVG hatch pattern at 20% opacity

## Disk / IO Audit — Do Next
- [x] ~~**Log rotation + retention**~~ (7c614dcb) — 10MB size limit, 2 rotated files, startup rotation
- [x] ~~**Lower log volume**~~ (7c614dcb) — noisy targets (tracing::span, loro_internal, storage) filtered to warn
- [x] ~~**Buffered writes**~~ (7c614dcb) — BufWriter, flush every 100 lines or 2s periodic
- [x] ~~**Measure + clean draft storage**~~ (56485a2c) — WebKit localStorage at ~/Library/WebKit/lexera-kanban/ = 2.1MB. Added pruneOrphanedDrafts to clean drafts for removed boards.
- [x] ~~**Write counters**~~ (b975861f) — write_count, skipped_write_count, last_write_time exposed via /diagnostics/disk
- [x] ~~**Reduce board-save amplification**~~ (ed9cdfec) — main file, include files, and CRDT now skip writes if content unchanged (hash compare before write)
- [x] ~~**Write-loop detection**~~ (b975861f) — write counters visible in diagnostics endpoint
- [x] ~~**Crashsave retention**~~ (ed9cdfec) — rotate_crashsaves keeps max 5 per board, list_crashsaves + 2 new tests
- [x] ~~**Disk diagnostics endpoint**~~ (b975861f) — GET /diagnostics/disk returns log, backup, crashsave, CRDT sizes

## Architecture — Do Next
- [ ] **Real frontend state model** — replace ad-hoc globals + 80+ raw localStorage calls with DocumentSessionStore, ViewStateStore, SettingsStore. Separate shell state from board state.
- [ ] **Unify shared packages** — merge or clearly separate packages/shared (TS types) vs packages/lexera-shared (browser JS/CSS). Replace copy-based sync-runtime-assets.mjs with real package.
- [ ] **Remove iframe view composition** — replace in-window iframes + postMessage with native in-process view instances
- [ ] **Backend config + service cleanup** — extract ConfigService (lock/mutate/save/notify) from raw Mutex<SyncConfig>. Continue AppState decomposition into narrower services.
- [ ] **Parser shared fixtures** — Rust parser is authoritative (1,751 lines). Add shared test fixtures to validate TS parser (337 lines) against it instead of hand-maintained parity.

## Style System — Do Next
- [ ] **Define two style layers** — Application Style (shell, menus, logs, settings) + Board Style (kanban/canvas content). No third overlapping layer.
- [x] ~~**Unify component primitives**~~ (1aea8ea1) — shared .btn base + primary/secondary/quiet/danger variants, existing classes inherit
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
