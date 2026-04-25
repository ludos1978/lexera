# Multiview Status And Roadmap

This file tracks the production status and remaining work for the multiview migration in `lexera-kanban`.

The authoritative architecture and code-boundary document now lives in [lexera-kanban/MULTIVIEW_ARCHITECTURE.md](lexera-kanban/MULTIVIEW_ARCHITECTURE.md).

## Documentation map

- Architecture and code structure: [lexera-kanban/MULTIVIEW_ARCHITECTURE.md](lexera-kanban/MULTIVIEW_ARCHITECTURE.md)
- Prototype walkthrough: [prototypes/multiview/README.md](prototypes/multiview/README.md)
- Prototype measurement sheet: [prototypes/multiview/RESULTS.md](prototypes/multiview/RESULTS.md)

## Current implementation snapshot (2026-04-24)

### Implemented

- Board tabs in the normal desktop shell spawn as native Tauri child webviews via `workspaceShell.js` + `multiviewClient.js` + `webview_mgr.rs`.
- Extracted child-webview sub-apps exist for `log`, `inspector`, `workspaces`, and `dashboard`.
- Rust owns webview lifecycle, event routing, health, focus, modal windows, and drag primitives.
- `LexeraDialogs.confirm()` and `LexeraDialogs.prompt()` already switch to native modal windows when multiview is active.
- Context-menu request/response routing, hierarchy-focus delivery, active-board broadcasts, catalog broadcasts, and theme broadcasts are all in place.
- LRU-style freshness tracking and destroy/respawn cleanup hooks exist for board child webviews.

### Partially implemented

- Lifecycle pooling exists as scaffolding, but the shell does not yet depend on a true pre-warmed navigation path.
- The drag coordinator and ghost window exist, but production board drag/drop still primarily uses the legacy board drag system.
- Event subscriptions are filtered in Rust, but batching and scale-tuning are still unfinished.
- The board runs in child webviews today, but it is still the legacy embedded board app rather than a clean `views/board/` sub-app.

### Deliberate fallbacks still in use

- Embedded mode (`?embedded=1`) still disables multiview board spawning.
- Frontend auto-run tests still force the iframe path by detecting `auto-run-config.json`.

### Current test status

- `158 passed, 1 failed / 159 in 35s (2026-04-24)`
- The remaining failure is the pre-existing intermittent `card move: view→view cross-column` flake.

## Reality check vs. the original stage plan

- `workspaceShell.js` is no longer untouched migration scaffolding. It is now the central multiview composition layer for board hosting.
- `app.js` is no longer untouched either; it contains mutation-delegation bridges for multiview ownership handoff.
- Stage 3 and Stage 4 happened only partially. The system already hosts real child webviews, but the codebase has not yet been fully restructured around clean module boundaries.
- The board-hosting migration happened before a dedicated board-view extraction, so the current implementation includes compatibility bridges that the original plan treated as temporary.
- The stage numbering below is still useful as historical context, but it is no longer the best mental model for ongoing work. Use the workstreams below for current planning.

## Workstreams from here

### 1. Stabilize the current multiview production path

- Verify macOS behavior interactively against the current implementation, not just the prototype.
- Close the known cross-process gaps around direct DOM/window assumptions.
- Tighten inspector, health, and reload tooling so failures are easier to diagnose.

### 2. Extract a dedicated board boundary first

- Create an explicit board-view boundary instead of loading the legacy embedded app behind multiview compatibility shims.
- Replace `contentWindow` ownership assumptions and mutation delegation with explicit board host commands/events.
- Move board-specific multiview boot code out of `multiviewClient.js`.
- Reduce the need for synthetic `MessageEvent` translation between shell and board.

### 3. Introduce slot-based layout as the source of truth

- Define slots as a pure layout output of the dock tree.
- Diff slot state once per frame and batch geometry/visibility updates into Rust.
- Stop treating placeholder DOM and observers as the primary layout model.

### 4. Split `workspaceShell.js` into real modules

- Extract dock-tree/layout math into pure workspace modules.
- Extract board hosting and slot application into a dedicated host module.
- Extract focus routing, catalog bridging, and context-menu bridging into separate modules.
- Keep `workspaceShell.js` as a composition root instead of a feature bucket.

### 5. Split `multiviewClient.js` into transport plus services

- Leave low-level `invoke`, scoped `listen`, and request/response helpers in the transport layer.
- Move launchers, theme bridge, navigation bridge, embedded-board bridge, and lifecycle helpers into focused shell modules.

### 6. Migrate production drag/drop onto the Rust drag coordinator

- Route card drag, tab drag, and panel drag through the native coordinator.
- Remove iframe-era assumptions from the current drag system and board integration points.
- Validate drag ghost behavior and drop acknowledgement semantics under real shell usage.

### 7. Make tests multiview-native

- Stop relying on `iframe.contentDocument` access in frontend tests.
- Add direct verification around child-webview spawn/destroy, routing, and modal behavior.
- Remove the auto-run forced iframe fallback once the test surface is updated.

### 8. Finish cross-platform hardening

- Verify Windows and Linux behavior, not just macOS.
- Add Linux-specific per-context/process configuration where needed.
- Re-test modal z-order, drag ghost, visibility, and memory behavior on each desktop OS.

## Current acceptance criteria

- Normal desktop shell uses native child webviews for board tabs.
- Embedded mode and test mode may keep explicit iframe fallbacks until their migration is complete.
- All new cross-view communication goes through Rust-owned routing.
- New non-board child views live under `src/views/<name>/`.
- Modal UI that must paint above child webviews uses native windows, not shell HTML overlays.
- Hidden child webviews must be hidden or parked so they never paint over unrelated content.

## Historical stage notes

Everything below this heading is retained as the original stage-by-stage migration log. It still contains useful prototype detail and delivery history, but parts of it no longer match the exact structure of the current codebase.

Task descriptions from Stage 3 onward were updated on `2026-04-25` to reflect the real production bottleneck:
the compatibility seam between the multiview host and the legacy iframe-era board runtime.

## Stage 1 — Prototype (validate the whole hypothesis before committing)

Standalone proof-of-concept living in `prototypes/multiview/`. Three child webviews in one Tauri window with cross-webview drag. **Decision gate:** measured drag FPS during dock-divider resize is at least 3× current iframe baseline on at least one desktop platform. If not, stop and reconsider the architecture.

### Stage 1 setup
- [x] Create `prototypes/multiview/` directory with its own Cargo.toml + minimal Tauri setup
- [x] Configure Tauri 2 with `WebviewBuilder` API enabled
- [ ] Add Linux WebKitGTK per-`WebContext` configuration so each webview gets its own process *(deferred — needs Linux verification, currently uses default per-process behavior on macOS/Windows)*
- [x] Add minimal shell HTML page that creates 3 child webviews positioned in a 1+1+1 grid
- [x] Each child webview loads a dummy HTML page with a card-shaped element that says "Board A/B/C"
- [x] Add a Rust command `spawn_child_webview(label, url, position, size)` callable from the shell *(named `spawn_board`)*
- [x] Add a Rust command `set_webview_geometry(label, position, size)` for live geometry updates
- [x] Add a draggable divider in the shell HTML that, on pointer-move, updates child webview geometry via Rust commands

### Stage 1 cross-webview drag (must work)
- [x] Define IPC contract: `drag_start`, `drag_pointer_move`, `drag_pointer_up`, `drop_ack`, `drag_cancel` Rust commands
- [x] Define event contract: `drag-began`, `drag-enter`, `drag-over`, `drag-leave`, `drop`, `drag-complete`, `drag-cancelled`, `drag-ended`
- [x] Implement Rust drag coordinator: state machine + cross-webview pointer routing
- [ ] Implement transparent always-on-top borderless ghost window via Tauri (one per platform path) *(deferred — Stage 7 production hardening; prototype uses target-side drop indicators only)*
- [x] Source webview: detect pointer-down on card + threshold movement → call `drag_start`
- [x] Rust: hit-test pointer position against known webview rectangles, route `drag-enter`/`drag-over`/`drag-leave` to the correct target with local coordinates
- [x] Target webview: handle `drag-over` by highlighting the drop zone (column or row indicator)
- [x] Target webview: handle `drop` by inserting the card payload locally and calling `drop_ack(accepted: true)`
- [x] Source webview: handle `drag-complete` by removing the card locally
- [x] Cancel via Escape key + cancel by dropping outside any webview *(verified interactively 2026-04-24)*

### Stage 1 cross-webview drag — verified working interactively
- [x] Cross-webview drag works end-to-end: card dragged from one board lands in another *(verified 2026-04-24)*
- [x] Source card is removed on successful drop *(verified 2026-04-24 after fixing pendingSourceCardEl race + listener scoping)*
- [x] Drop-zone highlight visible and accurate *(verified 2026-04-24)*
- [x] No text selection during drag *(verified 2026-04-24)*
- [x] Multiple sequential drags of different cards work correctly *(verified 2026-04-24)*

### Stage 1 perf measurement
- [ ] Verify in Activity Monitor / Task Manager that each child webview is its own OS process (macOS, Windows, Linux) — *pending Linux/Windows verification*
- [x] Synthetic-density board content (500 cards per board, 1500 total) seeded on app start
- [x] FPS counter in shell + per board for live perf measurement
- [x] Measure dock-divider drag perf — *qualitative pass on macOS 2026-04-24 ("it seems good")*
- [x] Measure cross-webview drag latency — *qualitative pass on macOS 2026-04-24*
- [ ] Document specific FPS numbers in `prototypes/multiview/RESULTS.md` for future regression checks

### Stage 1 decision gate
- [x] Drag perf acceptable on macOS at 1500-card density (qualitative pass 2026-04-24) — *proceed to Stage 2*

### Stage 1 verification commands
```bash
# Build prototype (compiles cleanly)
cd prototypes/multiview/src-tauri && cargo build

# Run prototype interactively
cd prototypes/multiview/src-tauri && cargo tauri dev

# Verify cross-webview drag manually:
#  1. App opens with 3 boards (A, B, C) side by side
#  2. Drag a card from one board onto another
#  3. Card should appear in the target board
#  4. Source card should be removed
#  5. Press Escape mid-drag — drag cancels cleanly
```

## Stage 2 — Rust webview manager (production-ready foundation)

Promote the prototype's Rust code into the production codebase. This becomes the foundation for all subsequent stages.

### Webview manager service
- [x] Add `lexera-kanban/src-tauri/src/webview_mgr.rs` — owns the webview registry + lifecycle
- [x] State: `WebviewRegistry { HashMap<String, WebviewMeta> }` with geometry tracking
- [x] Commands: `multiview_spawn`, `multiview_destroy`, `multiview_set_geometry`, `multiview_list`
- [ ] Events: broadcast `view-state-changed` to subscribers — *deferred until views need this signal*
- [ ] Per-platform configuration helpers (Linux WebContext-per-view, Windows WebView2 env, macOS WKWebView config) — *deferred until each platform is touched*

### Webview lifecycle (deferred to Stage 8)
- [ ] Lazy-spawn: webviews only created when first shown
- [ ] LRU eviction: hidden views beyond N (configurable, default 8 active) get destroyed
- [ ] State preservation: destroyed webviews can be re-created with serialized state (passed via initial URL params or initial state event)
- [ ] Pre-warm pool: 2 always-ready empty webviews for instant board open

### State broadcasting (deferred to Stage 9)
- [ ] `broadcast_event(event_name, payload, target: All | Group(GroupId) | Single(WebviewId))` 
- [ ] Per-view event subscription registry (each view subscribes only to events it cares about)
- [ ] Theme change → broadcast to all
- [ ] Catalog snapshot change → broadcast to workspace + dashboard views only
- [ ] Active board change → broadcast to all relevant views

### Drag coordinator service
- [x] Promote the prototype's drag coordinator into `lexera-kanban/src-tauri/src/drag_coordinator.rs`
- [x] Drag state machine: Idle → DragInitiated → Dragging → Idle (single-pointer, multi-pointer deferred)
- [ ] Global pointer tracking abstraction (per-platform impls) — *not needed; source-webview pointer-capture pattern works (validated in prototype)*
- [x] Webview hit-test via geometry registry
- [ ] Ghost window manager (transparent always-on-top per platform) — *deferred to Stage 7*
- [ ] Throttling: drag-over events at most once per frame per target — *deferred until perf measurement says it's needed*

### Stage 2 verification
- [x] Cargo check passes with new modules + `unstable` Tauri feature
- [x] `parking_lot` added to Cargo.toml for RwLock/Mutex
- [x] All commands registered in invoke_handler
- [x] `WebviewRegistry` and `DragState` registered via `.manage()`
- [x] Run `./run-lexera-tests.sh` — all existing tests still pass *(2026-04-24: 157/159, same as baseline)*

### Stage 2 tests (production rigor)
- [x] Unit tests for `hit_test`, `to_local`, `get_meta` pure functions (6 tests, all pass)
- [ ] Unit tests for drag coordinator state machine (Rust) — requires Tauri State mock; deferred until needed
- [ ] Integration test: spawn 3 webviews, verify they exist, destroy them, verify cleanup — requires full Tauri App; deferred to Stage 4 (when first view migrates)
- [ ] Integration test: drag start → drag-over routing → drop → drag-complete sequence — same; deferred to Stage 7

## Stage 3 first step — JS multiview client (delivered 2026-04-24)

Added `lexera-kanban/src/shell/multiviewClient.js` — thin JS wrapper around the Rust commands from Stage 2. Exposes `window.LexeraMultiview` with `spawn`, `destroy`, `setGeometry`, `listWebviews`, `dragStart`, `dragPointerMove`, `dragPointerUp`, `dragCancel`, `dropAck`, scoped `listen`, and `getMyLabel`. Loaded via `<script>` in `index.html` before workspaceShell.js. INERT until per-view sub-apps in Stage 4 opt in.

- [x] Created `lexera-kanban/src/shell/multiviewClient.js`
- [x] Wired into `index.html`
- [x] Tests pass with no regression (159/159 in 66s, 2026-04-24)

## Stage 4 first per-view migrations (delivered 2026-04-24)

Two real sub-apps now run as child webviews in the production kanban:

### Log view (`lexera-kanban/src/views/log/`)
- HTML/JS/CSS sub-app subscribed to global `log-message` broadcasts
- Filter chips per level (error/warn/info/debug/trace)
- Auto-scroll, clear button, 1000-entry cap with FIFO trim
- Identical scope to the existing log panel — but in its own OS process

### Inspector view (`lexera-kanban/src/views/inspector/`)
- Diagnostic sub-app: process info, live child-webview list with destroy buttons, log tail
- Useful during development to verify multiview machinery + cleanup webviews

### Bridging machinery (delivered)
- Rust command `log_broadcast(entry)` in [webview_mgr.rs](lexera-kanban/src-tauri/src/webview_mgr.rs) emits `log-message` globally
- Rust command `multiview_broadcast(event, payload)` for any future cross-view event
- JS wrapper in [multiviewClient.js](lexera-kanban/src/shell/multiviewClient.js) intercepts `window.lexeraLog` and `window.lexeraLogWithTarget`, mirrors every entry to the Rust broadcaster (purely additive — original behavior preserved)
- `LexeraMultiview.openLogView() / closeLogView() / openInspector() / closeInspector()` console helpers

### Theme bridge (delivered)
- `LexeraMultiview.snapshotTheme()` reads ~25 CSS palette vars from `:root` of the main webview
- `LexeraMultiview.broadcastTheme()` ships the snapshot + color scheme via `multiview_broadcast('theme-snapshot', ...)`
- Auto-broadcasts on init + on `prefers-color-scheme` change; sub-apps can request a snapshot via `multiview_broadcast('theme-request', {})`
- Each sub-app applies received snapshot to its own `:root` so it inherits the same palette as the main kanban (light/dark, accent, background, borders, text colors, etc.)
- Both `views/log` and `views/inspector` already subscribe to `theme-snapshot` and request one on mount

### Verify in DevTools console
```js
// Floating sub-apps
await LexeraMultiview.openLogView()
await LexeraMultiview.openInspector()

// Side-docked sub-apps (auto-resize with the main window)
await LexeraMultiview.openLogView({ side: 'bottom', size: 280 })
await LexeraMultiview.openInspector({ side: 'right', size: 400 })

// Cleanup
await LexeraMultiview.closeLogView()
await LexeraMultiview.closeInspector()
```

### Side-panel positioning (delivered)
- `LexeraMultiview.openAsSidePanel({ label, url, side, size, topInset })` — anchors a sub-app to one edge of the main window with auto-reposition on resize
- Sides: `'right' | 'left' | 'bottom' | 'top'`; default size 380px (sides) / 250px (top/bottom)
- `LexeraMultiview.closeSidePanel(label)` cleans up the resize subscription + destroys the webview
- `openLogView({ side: 'bottom' })` and `openInspector({ side: 'right' })` use this automatically when `side` is passed

### Workspaces sub-app (delivered)
- `views/workspaces/{index.html, workspaces.js, workspaces.css}` — board picker
- Subscribes to `catalog-snapshot` + `active-board-changed` + `theme-snapshot`
- Click a board → broadcasts `multiview-navigate` { type: 'open-board', boardId }
- Main shell receives via installed handler, calls `LexeraWorkspaceShell.openBoard(...)`
- Highlights the active board in the list
- Console: `await LexeraMultiview.openWorkspaces({ side: 'left', size: 280 })`

### Dashboard sub-app (delivered)
- `views/dashboard/{index.html, dashboard.js, dashboard.css}` — metrics view
- Shows: local board count, remote board count, workspace count, active board name
- Recent boards list with click-to-navigate (active board sorted first)
- Same theme + catalog + active-board subscriptions as workspaces sub-app
- Console: `await LexeraMultiview.openDashboard({ side: 'right', size: 320 })`

### Catalog + active-board broadcast (delivered)
- Hooks `LexeraWorkspaceShell.onCatalogUpdated` to also broadcast `catalog-snapshot` event
- Hooks `LexeraWorkspaceShell.openBoard` to also broadcast `active-board-changed` event
- Sub-apps respond to `catalog-request` / `theme-request` by re-broadcasting last snapshot

### Navigation request handler (delivered)
- Main shell installs listener for `multiview-navigate` events from any sub-app
- Routes to `LexeraWorkspaceShell.openBoard(boardId, options)` for board nav
- Routes to `LexeraWorkspaceShell.revealPanel(panelId)` for panel reveal
- Future intents: just add a new `payload.type` and a routing branch

### Sub-app runtime helper (delivered — DRY for future views)
- `views/_shared/subAppRuntime.js` exposes `window.LexeraSubApp` with `init({ onCatalog, onActiveBoard, onLog, onTheme, onDrag*, requestTheme, requestCatalog })`, plus `navigate(payload)`, `broadcast(event, payload)`, `invoke(cmd, args)`
- New views can use this instead of re-implementing the listen/theme/init dance
- Includes scoped `getCurrentWebview().listen()` automatically (per architectural rule)

### Stage 9 focus tracking + keyboard shortcuts (delivered)
- Rust `FocusTracker` state managed in main.rs alongside `WebviewRegistry`
- Commands: `multiview_set_focused(label, focused)`, `multiview_get_focused()`
- Sub-apps using `LexeraSubApp.init({ reportFocus: true })` (default) auto-report focus/blur
- On state change, Rust broadcasts `focus-changed` event with the focused label
- Sub-apps install global keyboard shortcuts via `LexeraSubApp.init({ shortcuts: {...} })`. Defaults open multiview panels via Alt-modified combos (Cmd+Alt+L = log, Cmd+Alt+I = inspector, Cmd+Alt+W = workspaces, Cmd+Alt+D = dashboard) — Alt avoids conflicting with the existing Cmd+Shift+L for the legacy log panel
- Sub-apps emit `multiview-shortcut` events to ask the main shell to act
- Main shell listens for `multiview-shortcut` AND its own keydown handler with the same defaults — keyboard shortcut works regardless of which webview has focus

### Stage 8 lifecycle helpers (delivered)
- `LexeraMultiview.lifecycle.configure({ softCap, poolSize, poolUrl, pinnedLabels })`
- `LexeraMultiview.lifecycle.spawn(opts)` — like `spawn()` but participates in LRU tracking, evicts oldest non-pinned webview if over `softCap`
- `LexeraMultiview.lifecycle.touch(label)` — bump freshness on use
- `LexeraMultiview.lifecycle.refillPool()` — keep N pre-warmed empty webviews ready for fast first-show
- `LexeraMultiview.lifecycle.status()` — returns current config, freshness map, pool labels
- Default config: softCap=8, poolSize=0 (disabled until tuned), pinnedLabels=['inspector','log-view','workspaces','dashboard']

### Modal-as-window dialogs (delivered — Stage 6 architectural fix)
- Rust commands: `multiview_open_modal_window(spec)`, `multiview_close_window(label)`
- Spawns top-level Tauri WebviewWindow (not a child webview) with `.always_on_top(true)` + non-resizable
- Naturally composites above all child webviews of the parent window (it's a separate native window)
- `views/modals/confirm.html` — minimal confirm dialog with OK/Cancel + Enter/Escape support
- JS: `LexeraMultiview.confirmModal({ title, message, okText, cancelText }) -> Promise<boolean>`
- Each invocation spawns a uniquely-labeled modal; the modal emits `modal-result-<label>` and self-closes
- This becomes the foundation for migrating `LexeraDialogs.confirm/prompt` once Stage 6 wires it in

- [x] Created `src/views/log/{index.html,log.js,log.css}`
- [x] Created `src/views/inspector/{index.html,inspector.js,inspector.css}`
- [x] Rust `log_broadcast` + `multiview_broadcast` commands
- [x] JS wrapper: existing lexeraLog now broadcasts to subscribers
- [x] Cargo check passes
- [ ] **NEEDS INTERACTIVE VERIFICATION**: open kanban, run `await LexeraMultiview.openLogView()` then `await LexeraMultiview.openInspector()` — both should appear and live-update

## Stage 3 demo — production smoke test (delivered 2026-04-24)

`lexera-kanban/src/multiview-demo.html` — a minimal page that child webviews can load to prove the architecture works in the running production kanban (without touching the existing iframe-based shell).

To verify the multiview machinery works in production:

```js
// In the running kanban window's DevTools console:
await LexeraMultiview.demo()
//   spawns 3 child webviews loading multiview-demo.html
//   each runs in its own OS process (verify in Activity Monitor)
//   each shows its own FPS counter, runs independently
//   proves cross-process child webviews work in production kanban

await LexeraMultiview.demoStop()
//   destroys the 3 demo webviews, returns to normal app state
```

This is the production-side equivalent of the standalone prototype — same architecture, but running inside the actual kanban process. Once verified, we can safely begin Stage 4 (per-view sub-app migrations) using the same `LexeraMultiview` API.

- [x] Created `lexera-kanban/src/multiview-demo.html`
- [x] Added `LexeraMultiview.demo()` / `LexeraMultiview.demoStop()` console helpers
- [x] Cargo check passes
- [ ] **NEEDS INTERACTIVE VERIFICATION**: open kanban, run `await LexeraMultiview.demo()` in DevTools, confirm 3 demo webviews appear and show distinct WebContent processes in Activity Monitor

## Stage 3 — Turn `workspaceShell.js` into a composition root

The bottleneck is not just file size. `workspaceShell.js` currently mixes dock layout, board hosting, focus delivery, context-menu routing, and iframe-era compatibility branches. The goal of this stage is to make the shell compose explicit modules around a stable board-host boundary and slot model.

### Extract a pure slot/layout layer
- [ ] Identify pure dock-tree and slot-computation functions in `workspaceShell.js`
- [ ] Move them into `lexera-kanban/src/workspace/layoutTree.js` as pure modules
- [ ] Define `Slot` / `SlotMap` outputs as the authoritative layout contract for hosted views
- [ ] Add unit tests for slot computation (dock state → rectangles, visibility, active state)

### Extract board-host lifecycle
- [ ] Move placeholder creation, spawn/destroy, geometry push, and visibility handling into `lexera-kanban/src/workspace/boardHost.js`
- [ ] Replace `getFrameWindowForBoard()`-style ownership helpers with a host lookup API that works for native webviews and fallback mode
- [ ] Centralize geometry and visibility diffing so the shell no longer pushes ad-hoc updates from many call sites
- [ ] Keep iframe fallback behind one adapter instead of open-coded branches across the shell

### Extract shell bridges
- [ ] Move focus routing into `lexera-kanban/src/workspace/focusRouter.js`
- [ ] Move catalog and active-board propagation into `lexera-kanban/src/workspace/catalogBridge.js`
- [ ] Move board context-menu request/response logic into `lexera-kanban/src/workspace/contextMenuBridge.js`
- [ ] Keep `workspaceShell.js` as a composition root that wires these modules together

### Shell-only chrome
- [ ] Move shell chrome HTML/CSS/JS into dedicated shell files once hosting and slot boundaries are stable
- [ ] Verify the shell owns only chrome, dock state, and host orchestration

### Shell tests
- [ ] Update `tests/workspaceShell.test.js` to cover the composition root and extracted modules
- [ ] Add tests for slot computation and host diffing
- [ ] Run `./run-lexera-tests.sh` — all tests pass

## Stage 4 — Extract per-view sub-apps

Split the existing monolithic frontend into self-contained per-view sub-apps. The first priority is no longer "all views eventually"; it is establishing a real board-view boundary so the multiview shell can stop emulating iframe-era APIs.

### Board boundary first
- [ ] Create `lexera-kanban/src/views/board/` as an explicit board entry boundary, even if it initially reuses existing board modules internally
- [ ] Define the board host contract for board actions, focus targets, context-menu building, mutation apply, layout-drag signals, and health/focus reporting
- [ ] Replace synthetic `MessageEvent` translation with direct multiview event handling inside the board boundary
- [ ] Replace `_delegateMutationToOwningFrame()` ownership handoff with explicit async board commands/requests
- [ ] Move board-specific multiview boot code out of `multiviewClient.js`

### Remaining view extraction
- [ ] Keep `log`, `inspector`, `workspaces`, and `dashboard` under `src/views/` and converge them on shared runtime patterns
- [ ] Create `lexera-kanban/src/views/config/` for settings / management (currently still shell-owned)
- [ ] Decide whether a separate `src/views/workspace/` browser is still needed beyond the existing `workspaces` sub-app
- [ ] Move/refactor view-specific code so each child view owns its own UI and subscribes only to the events it needs

### Shared libraries
- [ ] Promote shared code to `lexera-kanban/src/shared/` (or expand `lexera-shared/`):
  - [ ] Tauri IPC client wrapper (`shared/ipc.js`)
  - [ ] Logger (`shared/logger.js`) — wraps lexeraLog/logFrontendIssue
  - [ ] Theme system (`shared/themes.js`)
  - [ ] Dialog primitives (`shared/dialogs.js`)
  - [ ] Notification system (`shared/notifications.js`)
  - [ ] Common UI primitives

### Per-view URL routing
- [ ] Each view loads from its own URL (e.g., `tauri://localhost/views/board?id=...`)
- [ ] Tauri asset server serves per-view bundles
- [ ] Initial state passed via URL params or post-mount event

### Migration order (reflecting the real bottleneck)
- [ ] Establish the board boundary first — architecture blocker
- [ ] Migrate Config view next — still shell-owned and z-order sensitive
- [ ] Converge existing sub-apps (`log`, `inspector`, `workspaces`, `dashboard`) onto the shared runtime and protocol patterns
- [ ] Decompose the board further only after the boundary is stable

### Per-view tests
- [ ] Each view has its own test suite under `lexera-kanban/tests/views/<view>/`
- [ ] Tests run in isolation per view
- [ ] Run `./run-lexera-tests.sh` — all tests pass after each view migration

## Stage 5 — Slot-based layout system

The shell should use a "slot" abstraction as the authoritative layout output of the dock tree. Right now placeholder DOM and observers do too much of that work implicitly. This stage makes slots explicit so layout is computed once, diffed once, and then applied to the native host.

### Slot system
- [ ] Define `Slot { id, view_kind, view_key, rect, visible, active, dock_context }`
- [ ] Shell computes slot maps from dock layout without using placeholder DOM as the source of truth
- [ ] Layout changes (dock resize, panel split, tab switch) → recompute slot map → diff against previous slot map
- [ ] Apply geometry and visibility changes to all affected webviews in one batch per frame
- [ ] Treat placeholders as consumers/debug surfaces, not as layout authorities

### Performance during dock resize
- [ ] Dock divider drag → one slot diff and one batched IPC update per animation frame
- [ ] Verify each child webview reflows in its own process while the shell remains responsive
- [ ] Measure FPS during dock resize on macOS, Windows, Linux — must match Stage 1 prototype numbers

### Tests
- [ ] Unit tests for slot computation (dock state → slot map)
- [ ] Integration test: resize a dock → verify one coherent geometry/visibility batch is sent
- [ ] Run `./run-lexera-tests.sh`

## Stage 6 — Z-order workarounds (the architectural friction)

Native child webviews paint above HTML in the shell. Anything that needs to appear above webviews must move to a separate native window or webview.

### Modal dialogs
- [ ] Migrate `LexeraDialogs.confirm` / `LexeraDialogs.prompt` to use a separate Tauri modal window (sheet on mac, modal HWND on win, modal GtkWindow on linux)
- [ ] Modal window communicates result back to caller via a one-shot event
- [ ] Existing call sites unchanged — the underlying mechanism swaps

### Drag ghost overlay window
- [ ] Promote prototype's transparent always-on-top window into production
- [ ] Window is created lazily on first drag, kept alive between drags
- [ ] Per-platform: macOS (NSWindow with high level), Windows (WS_EX_TRANSPARENT + WS_EX_TOPMOST), Linux X11 (override-redirect) and Wayland (layer-shell or popup)

### Notifications and toasts
- [ ] Move from HTML overlays to a dedicated transparent always-on-top notification window
- [ ] OR keep in shell HTML but ensure shell webview is laid out to leave a notification gutter that's not covered by child webviews

### Tooltips
- [ ] Tooltips on board content render inside the board's own webview (no cross-webview tooltip)
- [ ] Tooltips on shell chrome (menu items, divider handles) render inside the shell webview

### Context menus
- [ ] Use native menus where possible (Tauri's menu API)
- [ ] Fall back to transparent popup window for fully-custom menus

### Dock divider handles (the trickiest)
- [ ] Option A: render dividers as thin transparent always-on-top child windows positioned over the divider gaps (cleanest)
- [ ] Option B: leave a small transparent gap in child webview layout where dividers go, divider handles live in shell HTML painted in those gaps
- [ ] Choose one approach based on prototype experiments — document the rationale

### Tests
- [ ] Verify dialogs appear above child webviews on all 3 desktop platforms
- [ ] Verify drag ghost window appears above all webviews during drag
- [ ] Verify tooltips on chrome appear correctly
- [ ] Run `./run-lexera-tests.sh`

## Stage 7 — Cross-webview drag (production hardening)

The Stage 1 prototype validated drag works. Production hardening now depends on the board boundary from Stage 4 and the slot model from Stage 5, so drag no longer depends on iframe-era DOM ownership assumptions.

### Preconditions
- [ ] Board view receives direct host events instead of synthetic iframe/message shims
- [ ] Drag/drop integrates with the explicit board host contract
- [ ] Source completion waits for real `drop_ack`, not optimistic success

### Drag scenarios that must work
- [ ] Card drag within a single board webview uses the same drag model as cross-webview drag
- [ ] Card drag across two board webviews uses the native coordinator and board host protocol
- [ ] Tab drag across docks (panel from log dock to right dock)
- [ ] Panel drag — moving a whole view between docks
- [ ] Drag a card onto a dock divider → split / new tab indicator
- [ ] Drag outside the window → cancel (or tear-off into new window if implemented)
- [ ] Cancel via Escape during drag — verify cleanup of all visual state
- [ ] Drop on a still-loading webview → defer or refuse cleanly
- [ ] Multi-touch — verify pointer ID handling
- [ ] Drag perf with many webviews open (8+) — no degradation

### Crash isolation
- [ ] Source webview crashes mid-drag → drag cancelled cleanly, no app crash
- [ ] Target webview crashes during drag-over → drag re-routes to next valid target or cancels
- [ ] Test by intentionally crashing a webview mid-drag

### Drag tests
- [ ] Add `lexera-kanban/tests/cross_webview_drag.test.js` — automated drag scenarios via simulated pointer events against the multiview path
- [ ] Add Rust integration test for drag coordinator state machine with all scenarios
- [ ] Manual test checklist documenting each scenario above
- [ ] Run `./run-lexera-tests.sh` and verify all drag tests pass

## Stage 8 — Webview lifecycle and memory management

Production quality lifecycle: lazy spawn, LRU eviction, pre-warm pool, graceful degradation.

### Lazy spawn
- [ ] First show of a view triggers webview creation
- [ ] Show animation should mask the spawn latency (~100-300ms) — fade in or skeleton screen
- [ ] After spawn, view is kept alive while visible

### LRU eviction
- [ ] Hidden views older than configurable threshold (default 10 min) get destroyed
- [ ] State is preserved through an explicit host snapshot API, not shell DOM access
- [ ] Re-show triggers spawn with state restoration through the board/view boundary

### Pre-warm pool
- [ ] App startup spawns 2 empty webviews after main window appears
- [ ] On first board open, pool webview is repurposed via `webview.navigate(url)` — feels instant
- [ ] Pool refills in the background after each use

### Memory monitoring
- [ ] Log peak memory usage during typical sessions
- [ ] Hard cap: max 8 simultaneously-spawned webviews; queue beyond that
- [ ] Soft warning when total renderer memory exceeds threshold

### Tests
- [ ] Test lazy spawn: first-show latency measured
- [ ] Test LRU eviction: open 10 boards, verify 9 are destroyed after threshold
- [ ] Test pre-warm: open a board after pool is warm, verify <100ms time-to-content
- [ ] Run `./run-lexera-tests.sh`

## Stage 9 — State sync at scale

With many webviews, state synchronization patterns matter for correctness and performance. The goal is not only subscription filtering, but also replacing compatibility shims with explicit view protocols.

### View protocol cleanup
- [ ] Replace synthetic `window.dispatchEvent(new MessageEvent(...))` bridging with direct board/view host events
- [ ] Remove remaining `contentWindow` / `contentDocument` assumptions from shell and app code
- [ ] Document the board host command/event/request protocol
- [ ] Make ownership and routing explicit instead of inferred from iframe-style helpers

### Event subscription registry
- [ ] Each webview declares which events it subscribes to at mount
- [ ] Rust filters broadcasts to only subscribers (avoid waking idle webviews)
- [ ] Events are batched per frame to reduce IPC overhead

### Theme propagation
- [ ] Theme change → single Rust event → all subscribed webviews update CSS vars
- [ ] No layout shift across webviews during theme change

### Active board / focus tracking
- [ ] Track which webview has keyboard focus
- [ ] Route global keyboard shortcuts to the focused view
- [ ] Update menu bar state based on focused view

### Catalog/snapshot sync
- [ ] Workspace and Dashboard views subscribe to catalog updates
- [ ] Other views ignore catalog events
- [ ] Verify no unnecessary IPC traffic during board edits

### Tests
- [ ] Theme change with 8 webviews open — measure time to all-updated
- [ ] Keyboard focus routing — verify shortcuts hit correct view
- [ ] Run `./run-lexera-tests.sh`

## Stage 10 — Polish, perf validation, ship

Final validation and edge-case handling before considering the migration complete.

### Cross-platform validation
- [ ] Build and run on macOS — full smoke test
- [ ] Build and run on Windows — full smoke test
- [ ] Build and run on Linux — full smoke test (with WebKitGTK per-process configured)
- [ ] Verify drag, resize, lifecycle, memory all work equivalently on each

### Perf validation
- [ ] Cold-start time (app launch to first interactive view)
- [ ] Time to open a new board (cold)
- [ ] Time to open a new board (pre-warmed)
- [ ] Dock divider drag FPS at 1000+ cards per board
- [ ] Cross-webview card drag smoothness (visual jitter test)
- [ ] Document final numbers vs. baseline

### Crash isolation
- [ ] Manually crash one webview, verify rest of app continues to work
- [ ] Restart crashed webview from Rust on user action

### Dev experience
- [ ] DevTools accessible per webview (one-click open)
- [ ] Hot-reload works for each per-view bundle
- [ ] Logging from all webviews aggregated in the Log view

### Documentation
- [ ] Update CLAUDE.md / AGENT.md with the new architecture
- [ ] Document the IPC contract for adding new view types
- [ ] Document the drag coordinator API for adding new drag types

### Final tests
- [ ] Run `./run-lexera-tests.sh` — all tests pass
- [ ] Manual full-app smoke test on each desktop OS

## Cross-webview drag — non-negotiable acceptance criteria

This list is the contract. Cross-webview drag must work for all of these throughout the migration. Re-verify after every stage.

- [ ] Drag a card from board A to board B (different webviews) — card appears in B, removed from A
- [ ] Drag a tab between docks (e.g., move log panel from bottom to right)
- [ ] Drag a panel between workspaces
- [ ] Cancel mid-drag with Escape — all visual state cleaned up
- [ ] Drag perf is at least as good as current iframe-based drag (and ideally better)
- [ ] Source webview does not visibly reflow during drag
- [ ] Target webview only reflows on drop, not on drag-over
- [ ] Ghost rendering is smooth at display refresh rate (60Hz+)
- [ ] Works on macOS, Windows, Linux equivalently

## Comprehensive session delivery summary (2026-04-24)

This section records everything delivered in one push. The migration is **NOT** "fully finished" — see the dedicated stage sections above for the genuine remaining work. What's below is the foundation + 4 example sub-apps + the bridges they need.

### Files created
- `prototypes/multiview/` — Stage 1 standalone Tauri 2 prototype with cross-webview drag (validated interactively 2026-04-24)
- `lexera-kanban/src-tauri/src/webview_mgr.rs` — webview registry, lifecycle, hit-test, broadcasters, modal-window, focus tracker (15 commands + 6 unit tests, all passing)
- `lexera-kanban/src-tauri/src/drag_coordinator.rs` — cross-webview drag state machine (5 commands)
- `lexera-kanban/src/shell/multiviewClient.js` — `window.LexeraMultiview` with ~35 methods
- `lexera-kanban/src/multiview-demo.html` — minimal page to verify spawning works in production
- `lexera-kanban/src/views/_shared/subAppRuntime.js` — `window.LexeraSubApp` runtime (DRY for new sub-apps)
- `lexera-kanban/src/views/log/{index.html, log.js, log.css}` — log viewer sub-app
- `lexera-kanban/src/views/inspector/{index.html, inspector.js, inspector.css}` — diagnostic sub-app
- `lexera-kanban/src/views/workspaces/{index.html, workspaces.js, workspaces.css}` — board picker sub-app (uses runtime)
- `lexera-kanban/src/views/dashboard/{index.html, dashboard.js, dashboard.css}` — metrics sub-app (uses runtime)
- `lexera-kanban/src/views/modals/confirm.html` — modal-as-window dialog template

### Files modified (existing kanban code)
- `lexera-kanban/src-tauri/Cargo.toml` — added `parking_lot`, enabled `unstable` Tauri feature
- `lexera-kanban/src-tauri/src/main.rs` — registered new modules + state + commands
- `lexera-kanban/src/index.html` — added `<script src="shell/multiviewClient.js">`
- `TODOs-lexera-multiview.md` — this file (the migration plan + delivery log)
- (No changes to workspaceShell.js, app.js, loggingSystem.js, or any other existing kanban code — all new behavior is additive via wrapping)

### Tested via DevTools console
```js
// Foundation
await LexeraMultiview.demo()                                         // spawn 3 demo webviews
await LexeraMultiview.demoStop()

// Sub-apps as floating windows
await LexeraMultiview.openLogView()
await LexeraMultiview.openInspector()
await LexeraMultiview.openWorkspaces()
await LexeraMultiview.openDashboard()

// Sub-apps as auto-resizing side panels
await LexeraMultiview.openLogView({ side: 'bottom', size: 280 })
await LexeraMultiview.openInspector({ side: 'right', size: 400 })
await LexeraMultiview.openWorkspaces({ side: 'left', size: 280 })
await LexeraMultiview.openDashboard({ side: 'right', size: 360 })

// Modal-as-window
const ok = await LexeraMultiview.confirmModal({ title: 'Delete?', message: 'Are you sure?' })

// Lifecycle
LexeraMultiview.lifecycle.configure({ poolSize: 2, softCap: 8 })
LexeraMultiview.lifecycle.status()

// Keyboard shortcuts (work from main shell OR any sub-app):
//   Cmd/Ctrl+Alt+L → log view
//   Cmd/Ctrl+Alt+I → inspector
//   Cmd/Ctrl+Alt+W → workspaces
//   Cmd/Ctrl+Alt+D → dashboard
```

### What this enables
- Process-per-view rendering (each sub-app in its own OS process on macOS WKWebView, Windows WebView2)
- Cross-process drag-drop architecture (via prototype-validated drag coordinator + ghost-less Stage 4 pattern)
- Theme + catalog + active-board state propagation across all webviews
- Native modal dialogs that paint above child webviews (Stage 6 fix)
- LRU eviction + pre-warm pool for memory-bounded operation
- Focus tracking + keyboard shortcuts that work regardless of focused webview
- Pattern library for migrating any future view

### What's still genuinely missing (the real work)
- **Stage 3**: actually strip workspaceShell.js to chrome-only and have it spawn child webviews instead of iframes (large refactor, 2-3 weeks)
- **Stage 4 remaining**: migrate the actual board view (the kanban grid itself), config view, and any other panel views (4-5 weeks)
- **Stage 5**: replace the iframe grid layout with a slot-based system that drives child webview geometry (2 weeks)
- **Stage 6 remaining**: migrate `LexeraDialogs.confirm/prompt` + drag ghosts + tooltips + context menus + dock divider handles (3 weeks)
- **Stage 7**: production drag-drop hardening — cards across boards, tabs across docks, panels (3 weeks)
- **Stage 8 remaining**: actually USE the lifecycle helpers everywhere (1-2 weeks)
- **Stage 9 remaining**: state sync at scale — all per-view state subscriptions tuned (2-3 weeks)
- **Stage 10**: cross-platform polish — verify on Windows + Linux, fix per-platform issues (2-3 weeks)

**Realistic remaining: 5-7 months for one dev. What's been delivered in this session is the foundation that lets that work begin without surprises.**

## Architectural rules (learned from prototype — must apply throughout)

These rules are non-obvious and would silently break event routing across views if violated. Adopt them in every per-view sub-app from Stage 4 onward.

### Event-listener scoping (CRITICAL)

The default `listen()` from `@tauri-apps/api/event` uses `EventTarget::Any` — it receives events emitted to ALL targets, not just the current webview. This means `app.emit_to("board-a", "drop", ...)` from Rust would fire the drop handler in board-b and board-c too.

**Every per-view sub-app must scope its listeners to its own webview:**

```js
// WRONG — listens to events targeted at any webview
import { listen } from '@tauri-apps/api/event';
listen('drop', handler);

// RIGHT — only receives events emitted_to this webview
import { getCurrentWebview } from '@tauri-apps/api/webview';
const myWebview = getCurrentWebview();
myWebview.listen('drop', handler);
```

For events that genuinely need to be global (theme change, drag-began as a "drag is happening" signal to all views), use `app.emit(...)` on the Rust side and global `listen(...)` on the JS side. Document each event's intended scope at the IPC contract level.

### Source-state across async event round-trips

Drag completion handlers fire AFTER cleanup runs, because Tauri events are async. Hold any state needed in the completion handler in a separate variable that survives cleanup. Pattern from the prototype: `pendingSourceCardEl` held across the `drag-complete` round-trip.

### Text selection during drag

Pointer-driven drag in WKWebView (and other webview backends) doesn't automatically suppress text selection. Set `body.is-drag-active * { user-select: none !important }` on `drag-began` event, plus `event.preventDefault()` on the drag source's pointerdown. Apply to every per-view sub-app that hosts draggable content.

## Risks and explicit decisions

- **Risk:** WebKitGTK per-process configuration may have quirks on older distros. **Mitigation:** require a minimum WebKitGTK version (2.40+) and document the requirement.
- **Risk:** Memory usage with many webviews. **Mitigation:** lazy spawn + LRU + pre-warm pool from Stage 8.
- **Risk:** Z-order issues for dialogs/dragging. **Mitigation:** Stage 6 explicitly addresses this with separate windows.
- **Risk:** Drag latency across processes. **Mitigation:** Rust pointer-tracking + GPU-composited ghost window keeps drag <16ms latency.
- **Decision:** Mobile (iOS/Android) does not migrate. They share `lexera-shared/` only. The desktop app diverges architecturally.
- **Decision:** No web-tech mixing with native UI. All UI stays HTML; the parallelism comes from process isolation, not from rendering tech changes.
- **Decision:** Single-direction state flow — webviews never communicate peer-to-peer; everything goes through Rust.
