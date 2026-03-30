# Lexera Kanban Todo

## Bugs
- [x] ~~stack delete not removing until re-render~~ (c6d98022) — wrong variable names in DOM selector
- [x] ~~dropdown menus broken~~ (0938d5cb) — restored missing HiddenItemsDropdown.init() call
- [x] ~~tab too wide when single board~~ (69e0c590) — .ws-view-title flex:0 1 auto instead of 1 1 auto
- [x] ~~Export: target folder, browse button, Save→Export~~ (b0b8de9c) — default to {board-folder}/_Export, browse_folder Tauri command, label fixed
- [x] ~~canvas drag logging spam~~ (69e0c590) — ResizeObserver debounced timer now also checks for active drag
- [ ] The dashboard doesnt properly show all the setup elements from the open or selected boards!
- [x] ~~board switch lockup~~ (ce4201a0, dcbfeb1f) — dashboard refresh deferred after loadBoard, iframe cascade prevented
- [x] ~~dashboard tag tree indentation~~ (ce4201a0) — section header padding aligned with tree nodes
- [x] ~~unified hierarchical display style~~ (04733655) — hierarchical.css with shared base classes, dashboard tree aligned to tokens

- [x] ~~visual theme not propagating to board iframes~~ (c1ba4713) — broadcasts data-visual-theme to all iframes
- [x] ~~stats tab empty in logs~~ (c6d98022) — removed from index.html + sharedPanels.js
- [ ] the backend settings are not showing any of the settings — management init hardened with retry + error logging (c1ba4713), needs frontend log to diagnose further

## Active Features
- [ ] Add pptx rendering (needs esbuild bundle of @jvmr/pptx-to-html)
- [ ] Mobile web clipper — finish lexera-capture-ios

## Code Quality
- [ ] **App.js modularization** — 13,108 lines. Extract into state/, services/, views/, shell/ layers. No module should mix DOM rendering, localStorage, and API calls. Includes: reduce to orchestration, split frontend layers, settings service behind typed API.

## Architecture — Do Next
- [x] ~~**Repository promotion**~~ (a681e184) — root package.json cleaned (211KB → 370B), VS Code extension manifest removed
- [ ] **Real frontend state model** — replace ad-hoc globals + 80+ raw localStorage calls with DocumentSessionStore, ViewStateStore, SettingsStore. Separate shell state from board state.
- [ ] **Unify shared packages** — merge or clearly separate packages/shared (TS types) vs packages/lexera-shared (browser JS/CSS). Replace copy-based sync-runtime-assets.mjs with real package.
- [ ] **Remove iframe view composition** — replace in-window iframes + postMessage with native in-process view instances
- [ ] **Backend config + service cleanup** — extract ConfigService (lock/mutate/save/notify) from raw Mutex<SyncConfig>. Continue AppState decomposition into narrower services.
- [ ] **Parser shared fixtures** — Rust parser is authoritative (1,751 lines). Add shared test fixtures to validate TS parser (337 lines) against it instead of hand-maintained parity.

## Style System — Do Next
- [x] ~~**Style token file**~~ (2917651e) — tokens.css with typography, spacing, control size tokens. 112 font-size declarations migrated.
- [ ] **Define two style layers** — Application Style (shell, menus, logs, settings) + Board Style (kanban/canvas content). No third overlapping layer.
- [x] ~~**Unify theme systems**~~ (7b79ca3d) — themes.js colors only, visualThemes.js board style only, workspace appearance maps to board style IDs, --font-ui from tokens.css
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
