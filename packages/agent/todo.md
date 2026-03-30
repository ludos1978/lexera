# Lexera Kanban Todo

## Bugs
- [ ] The dashboard doesnt properly show all the setup elements from the open or selected boards!
- [ ] make "[data-visual-theme="gap"] .columns-container" padding 8px
- [ ] the backend settings are not showing any of the settings — management init hardened with retry + error logging (c1ba4713), needs frontend log to diagnose further
- [ ] changing the appearance in the workspaces isnt modifying the theme of the kanban view!
- [ ] delete row isnt working (or it's just not updating immediately)
- [ ] make a proper hierarchical structure in the dashboard, which indents every sub-item by an block (which can show hierarchical helper lines)
- [ ] the hierarchy in the workspaces isnt showing the kanban/canvas contents anymore. i cant re-order the items in the list. and it's not a unified hierarchy!
- [ ] ERROR
  FRONTEND
  drag.ptr
  Error in ptr mouseup handler: @http://127.0.0.1:1431/board/orderHelpers.js:439:70
  map@[native code]
  saveOrder@http://127.0.0.1:1431/board/orderHelpers.js:290:62
  reorderBoards@http://127.0.0.1:1431/board/orderHelpers.js:439:14
  @http://127.0.0.1:1431/app.js:1097:74
  reorderBoards@http://127.0.0.1:1431/app.js:1162:97
  reorderBoards@http://127.0.0.1:1431/app.js:129:71
  executePtrDrop@http://127.0.0.1:1431/dragdrop/dragDropHandlers.js:1652:57
  executePtrDrop@http://127.0.0.1:1431/app.js:9952:90
  @http://127.0.0.1:1431/app.js:10452:19

## Active Features
- [ ] Add pptx rendering (needs esbuild bundle of @jvmr/pptx-to-html)
- [ ] Mobile web clipper — finish lexera-capture-ios

## Code Quality
- [ ] **App.js modularization** — 13,108 lines. Extract into state/, services/, views/, shell/ layers. No module should mix DOM rendering, localStorage, and API calls. Includes: reduce to orchestration, split frontend layers, settings service behind typed API.

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
