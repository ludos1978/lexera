# Lexera Kanban Todo

## Bugs
- [ ] Export: target folder default should be `{board-folder}/_Export/{board-name}-{columns}/`, verify browse folder works (export mechanism itself works)
- ~~ Dragging card into free canvas space ~~ — DONE: dragDropHandlers.js handles 'new-stack' kind, canvas drop creates stacks at drop position

## Features
- [ ] Add pptx rendering (needs esbuild bundle of @jvmr/pptx-to-html)
- [ ] Glaxnimate animation viewer — embed animated ![]() images with {export=keyframes} or {export=flatten} parameters
- [ ] Email + Filesystem data sources (RSS already done in web clipper)
- [ ] Mobile web clipper — lexera-capture-ios exists but incomplete

## Code Quality
- [ ] **Frontend modularization** — app.js currently 13,108 lines (down from 28K). Remaining: core rendering, canvas, event handling, live sync, state management

## Sync & Collaboration (Long Term)
- [ ] **Per-user change isolation** — needs Loro fork/branch API or manual snapshot logic. Revisit when Loro adds branching.
- [ ] **Content-addressed binary storage** — evaluate BLAKE3 + FastCDC if large file dedup needed. Not needed for typical media.
- ~~ CRDT + VCS ~~ — decision made: stay LAN-first with WebSocket + HTTP. Loro CRDT active in bridge.rs. Revisit P2P/WAN when requested.
- ~~ WAN collaboration ~~ — infrastructure exists (RemoteConnectionEntry, SyncClientManager, invite tokens, BoardSyncHub). Default is LAN-only, can be enabled via config. Not a todo — it's a config decision.

## Architecture (Long Term)
- [ ] **Repository promotion** — root package.json still has VS Code extension manifest (activationEvents, contributes, engines.vscode). Needs cleanup.
- [ ] **Frontend build pipeline** — no bundler, raw file serving via Tauri. Blocked by app.js split.
- [ ] **Typed API contract** — no shared DTO package exists
- [ ] **Backend service extraction** — AppState has 15+ fields but services are well-organized (AuthService, DiscoveryService, etc.). Partial progress.
- [ ] **Backend config transactions** — still raw Mutex<SyncConfig>, no ConfigService
- [ ] **Plugin architecture** — only fileFormatRegistry.js exists, no manifest system
- ~~ Board schema centralization ~~ — DONE: canonical schema in lexera-core/src/types.rs (KanbanBoard, Row, Stack, Column, Card)
- ~~ Storage abstraction ~~ — DONE: BoardStorage trait in storage/mod.rs, LocalStorage implementation, registry pattern
- [ ] **Parser source of truth** — both Rust (1,751 lines) and TS (337 lines) parsers exist. Rust is authoritative but TS not validated against shared fixtures.

## Frontend Architecture (Long Term)
- [ ] **Split frontend into explicit layers** — no state/, services/, views/ directories yet
- [ ] **Real frontend state model** — no store classes, state scattered across globals and localStorage
- [ ] **Settings service** — raw localStorage calls throughout app.js (80+)
- [ ] **Reduce app.js to orchestration** — still has 150+ DOM manipulation calls and rendering logic
- [ ] **Remove iframe view composition** — workspaceShell.js still uses createElement('iframe')
- [ ] **Universal view contract** — restoreState exists but no consistent interface
- [ ] **Separate shell state from board state** — still mixed in app.js
- [ ] **Replace copy-based lexera-shared** — sync-runtime-assets.mjs still runs on build
- [ ] **Merge or separate shared packages** — both packages/shared (TS) and packages/lexera-shared (JS/CSS) exist
- [ ] **Retire legacy vs shell UI paths** — both index.html fixed layout and sharedPanels.js dynamic panels coexist

## Style System (Long Term)
- [ ] **Define two style layers** — app style and board style not explicitly separated
- [ ] **Unify theme systems** — themes.js + visualThemes.js + workspace appearance = 3 separate systems
- [ ] **Typography scale** — sizes use --ui-scale but no semantic --font-size-xs/sm/md/lg tokens yet
- [ ] **Spacing scale** — --space-1 through --space-4 exist but no --app-space tokens
- [ ] **Component primitives** — 4+ button families still exist (.btn-icon, .sidebar-btn, .board-action-btn, .mgmt-btn)
- [ ] **Standardize panel anatomy** — no consistent panel structure across views
- [ ] **Board style contract** — scattered localStorage keys, no bounded BoardStyle object
- [ ] **Tag styling under board style** — tagColors.js (1000+ lines) has independent style engine
- [ ] **Style token file** — no dedicated token file, tokens scattered in app.css
- [ ] **Style regression checks** — no lint rules for font-size consistency
- [ ] **Consistent states** — .view-loading/.view-empty exist but not shared across all surfaces
- ~~ Focus/keyboard consistency ~~ — DONE: :focus-visible with outline: 2px solid var(--accent) across all button types
- [ ] **Consistent hit areas** — --btn-square-size exists but 30+ scattered size values remain
