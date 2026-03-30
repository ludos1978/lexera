# Lexera Kanban Todo

## Bugs
- [ ] Export is not working properly — uses "Save" instead of "Export", target folder defaults wrong, browse folder not working
- [ ] Dragging a card out of a column into free space in canvas mode removes the card — should create a new stack/column at the drop location

## Features
- [ ] Add pptx rendering (needs esbuild bundle of @jvmr/pptx-to-html)
- [ ] Glaxnimate animation viewer — embed animated ![]() images with {export=keyframes} or {export=flatten} parameters
- [ ] RSS, EMail, Filesystem data sources — integrate external data directly into kanban boards
- [ ] Mobile web clipper (iOS/Android)

## Code Quality
- [ ] **Frontend modularization** — app.js currently 13,108 lines (down from 28K). Remaining: core rendering, canvas, event handling, live sync, state management

## Sync & Collaboration (Long Term)
- [ ] **CRDT + VCS requirements** — git-like automatic commit + merge closer to needs than pure CRDT. Decision: stay LAN-first with WebSocket + HTTP. Revisit P2P/WAN when requested.
- [ ] **Per-user change isolation** — needs Loro fork/branch API or manual snapshot logic. Revisit when Loro adds branching.
- [ ] **Content-addressed binary storage** — evaluate BLAKE3 + FastCDC if large file dedup needed. Not needed for typical media.
- [ ] **WAN collaboration** — evaluate iroh, relay server, or VPN when internet collaboration is requested.

## Architecture (Long Term)
- [ ] **Repository promotion** — make packages/ the obvious root, archive legacy VS Code extension scaffolding
- [ ] **Frontend build pipeline** — replace script-tag loading with bundler (blocked by app.js split)
- [ ] **Typed API contract** — centralize backend/frontend DTOs so clients stop hand-coding assumptions
- [ ] **Backend service extraction** — split AppState into narrower services (config, auth, discovery, sync, board registry)
- [ ] **Backend config transactions** — ConfigService helper for lock/mutate/save/notify
- [ ] **Plugin architecture** — unify plugin registration (manifests, not hardcoded lists)
- [ ] **Board schema centralization** — single canonical schema for rows, stacks, columns, cards, settings
- [ ] **Storage abstraction** — split LocalStorage into smaller services (repository, persistence, includes, revisions, search)
- [ ] **Parser source of truth** — one canonical parser (Rust), validate JS implementation via shared fixtures

## Frontend Architecture (Long Term)
- [ ] **Split frontend into explicit layers** — state/, services/, views/, shell/, adapters/ — no module should mix DOM, localStorage, and API calls
- [ ] **Real frontend state model** — replace ad-hoc globals with DocumentSessionStore, ViewStateStore, WorkspaceShellStore, SettingsStore, SyncSessionStore
- [ ] **Settings service** — centralize 80+ localStorage reads/writes behind typed API with document/workspace/user/transient scopes
- [ ] **Reduce app.js to orchestration** — extract rendering helpers, mutation logic, canvas parsing, settings plumbing
- [ ] **Remove iframe view composition** — replace in-window iframes + postMessage with native in-process view instances
- [ ] **Universal view contract** — all views implement serializeState/restoreState/focus/close/getTitle/getKind/getDirtyState
- [ ] **Separate shell state from board state** — kanban/canvas choice, splits, tabs, docks must not mix with board data
- [ ] **Replace copy-based lexera-shared** — build as real package instead of copying files via sync-runtime-assets.mjs
- [ ] **Merge or separate shared packages** — define one strategy for packages/shared (TS types) vs packages/lexera-shared (browser JS/CSS)
- [ ] **Retire legacy vs shell UI paths** — keep one view composition model, demote the other

## Style System (Long Term)
- [ ] **Define two style layers** — Application Style (shell, menus, logs, settings) + Board Style (kanban/canvas content). No third overlapping layer.
- [ ] **Unify theme systems** — merge themes.js, visualThemes.js, and workspace appearance into one app theme + one board style system
- [ ] **Typography scale** — replace 15+ font sizes with --font-size-xs/sm/md/lg tokens. One UI font, one code font. All sizes use --ui-scale.
- [ ] **Spacing scale** — replace 20+ ad-hoc spacing values with --app-space-1 through --app-space-5 tokens
- [ ] **Component primitives** — unify button/select/input/header variants across app.css, workspaceShell.css, management.css
- [ ] **Standardize panel anatomy** — all dockable views share same header/tabs/actions/body/footer structure
- [ ] **Board style contract** — one bounded board style object (styleId, density, surface, separatorMode) instead of scattered localStorage keys
- [ ] **Tag styling under board style** — chip sizing, typography, borders from board tokens, not separate tagColors.js engine
- [ ] **Style token file** — central canonical source for all application + board tokens
- [ ] **Style regression checks** — lint/test that flags new direct font-size/font-family outside token files
- [ ] **Consistent states** — one shared model for connected/loading/empty/error/selected across all surfaces
- [ ] **Focus/keyboard consistency** — same focus rings and keyboard interaction on all controls, not just board
- [ ] **Consistent hit areas** — standardize minimum target sizes, icon sizes, button heights across all surfaces
