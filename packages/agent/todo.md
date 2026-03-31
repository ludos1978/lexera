# Lexera Kanban Todo

## Bugs
- [ ] The dashboard doesnt properly show all the setup elements from the open or selected boards — filterDashboardResultsByScope exists but may filter incorrectly
- [ ] reorderBoards drag error at orderHelpers.js:439 — map() on orderedBoards may fail if array is undefined

## Active Features
- [ ] Add pptx rendering (needs esbuild bundle of @jvmr/pptx-to-html)
- [ ] Mobile web clipper — finish lexera-capture-ios

## Code Quality
- [ ] **App.js modularization** — 13,108 lines. Extract into state/, services/, views/, shell/ layers. No module should mix DOM rendering, localStorage, and API calls. Includes: reduce to orchestration, split frontend layers, settings service behind typed API.

## Disk / IO Audit — Do Next
- [ ] **Add backend log rotation + retention** — `~/Library/Application Support/lexera/logs/backend.log` reached about 215 MB / 912k lines during local use. Add size-based rotation, retention, and optional truncation on startup.
- [ ] **Lower default backend log volume** — current logger defaults to `info` and writes very chatty targets (`lexera.storage.read_board`, `tracing::span`, `loro_internal::*`, watcher include logs) into `backend.log`. Move those targets to debug/trace or filter them out by default.
- [ ] **Stop flushing backend.log on every line** — `log_bridge.rs` appends and `flush()`es every entry. Batch or buffered writes are needed to reduce constant small-write pressure.
- [ ] **Measure real on-disk WebView draft storage** — local-board edits persist a full `board` snapshot plus `baseBoard` into `localStorage` every 500 ms debounce. Find the actual Tauri/WebKit storage path on macOS, measure its growth, and cap/clean old drafts.
- [ ] **Instrument write amplification per save** — add counters/metrics for bytes written across backups, include files, main markdown, `.md.crdt`, crashsaves, and config/auth/invite/public saves so disk cost is visible per operation.
- [ ] **Reduce board-save amplification** — one local save can copy the existing board into `.lexera-backups`, rewrite include files, atomically rewrite the main markdown with fsync, and rewrite `.md.crdt`. Check whether backups can be rate-limited or content-hash gated and whether unchanged include files can skip writes.
- [ ] **Verify there is no write-loop under active editing** — idle sampling showed no ongoing board rewrites, but active edit sessions still need a timed probe to confirm there is no watcher reload / CRDT rewrite / autosave loop causing repeated disk bursts.
- [ ] **Audit crashsave retention** — crashsave creation exists, but retention/cleanup needs explicit verification so failed save storms cannot fill disk over time.
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
