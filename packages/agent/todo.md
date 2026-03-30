# Lexera Kanban Todo

## Bugs
- [ ] when i deleted a stack it wasnt removed, only after moving a card it disappeared after a full re-render (which is also not good that it does a full re-render).
- [ ] the new, incoming, park, acrhive, trash dropdown menus dont work anymore!
- [ ] when a board is the only one on the screen have the tab-part (where the drag icon, the filename and the close icon are) only as wide as needed. the close button should not move to the right as far out as it does currently!
- [x] ~~Export: target folder, browse button, Save→Export~~ (b0b8de9c) — default to {board-folder}/_Export, browse_folder Tauri command, label fixed
- [ ] maybe it's the backend communication or the logs, but i can barely move an stack in the canvas mode. it keeps interrupting or doing weird things. it also gives about 20 log outputs per drag.
- [ ] The dashboard doesnt properly show all the setup elements from the open or selected boards!
- [ ] switching boards sometimes doesnt show the board, it locks up and it doesnt show a result! the dashboard shows a busy icon, but the view stays empty!
- [ ] the tree structure in the dashboard isnt nicely setup. some items (for example tags) show more left then the title of the "tagged items"! it must be nicely hierarchical!
- [ ] we want a unified hierarchical display style! we currently have different styles in the worspace, dashboard, maybe also within the files config dialogue. it's a mess of styles. run a ux expert over this issue and analyze how we can unify it. if we need two systems thats fine, but currently we have to many different styles in use!

- [ ] changing the visual theme is editing the frontend, but not the board that is rendered! also in the workspace setting it should say Default (inherit from frontend)
- [ ] the logs has a stats view, but it's empty. remove it from the logs. 
- [ ] the backend settings are not showing any of the settings.

## Active Features
- [ ] Add pptx rendering (needs esbuild bundle of @jvmr/pptx-to-html)
- [ ] Mobile web clipper — finish lexera-capture-ios

## Code Quality
- [ ] **App.js modularization** — 13,108 lines. Extract into state/, services/, views/, shell/ layers. No module should mix DOM rendering, localStorage, and API calls. Includes: reduce to orchestration, split frontend layers, settings service behind typed API.

## Architecture — Do Next
- [ ] **Repository promotion** — clean root package.json (remove VS Code extension manifest), make packages/ the obvious product root
- [ ] **Real frontend state model** — replace ad-hoc globals + 80+ raw localStorage calls with DocumentSessionStore, ViewStateStore, SettingsStore. Separate shell state from board state.
- [ ] **Unify shared packages** — merge or clearly separate packages/shared (TS types) vs packages/lexera-shared (browser JS/CSS). Replace copy-based sync-runtime-assets.mjs with real package.
- [ ] **Remove iframe view composition** — replace in-window iframes + postMessage with native in-process view instances
- [ ] **Backend config + service cleanup** — extract ConfigService (lock/mutate/save/notify) from raw Mutex<SyncConfig>. Continue AppState decomposition into narrower services.
- [ ] **Parser shared fixtures** — Rust parser is authoritative (1,751 lines). Add shared test fixtures to validate TS parser (337 lines) against it instead of hand-maintained parity.

## Style System — Do Next
- [x] ~~**Style token file**~~ (2917651e) — tokens.css with typography, spacing, control size tokens. 112 font-size declarations migrated.
- [ ] **Define two style layers** — Application Style (shell, menus, logs, settings) + Board Style (kanban/canvas content). No third overlapping layer.
- [ ] **Unify theme systems** — merge themes.js + visualThemes.js + workspace appearance into one app theme + one board style system. One bounded board style object instead of scattered localStorage keys.
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
