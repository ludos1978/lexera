# Multi-Webview Migration Plan

Migrate Lexera from a single webview hosting iframes to a multi-webview architecture where every view (workspace, dashboard, log, config, each board) is its own native child webview backed by its own OS process. Goal: process-level parallel rendering on macOS (WKWebView), Windows (WebView2), and Linux (WebKitGTK). Mobile (iOS/Android) is out of scope for this migration — they share only sub-parts of the codebase.

## Workflow

Work top-down by stage. Each stage has a decision gate; do not start the next stage until the previous one is verified working. After completing tasks in a stage, run `./run-lexera-tests.sh` and update the test status line. Mark completed items with `[x]` and the commit hash. Cross-webview drag is a non-negotiable acceptance criterion — it must be validated as early as Stage 1 and must remain working after every subsequent stage.

**Test status: TBD (baseline before migration begins)**

**Decision gate per stage:** if the stage's success criteria are not met, stop and reconsider before proceeding.

## Architectural Targets

- Each top-level "view" in the app is its own webview process: shell (chrome only), workspace browser, dashboard, log, config, and one webview per open board.
- Shell webview owns: menu bar, dock divider handles, tab bars, drag-drop coordination overlays, dialog routing.
- Per-platform: each desktop OS gets equivalent process-per-webview behavior. Linux requires per-`WebContext` configuration in WebKitGTK. No platform compromised.
- Cross-webview drag works for cards, tabs, and panels. Source webview never reflows during drag; target webview only reflows on drop.
- Memory budget: lazy-spawn views, LRU-evict idle webviews, pre-warm hot pool of 2-3 ready webviews.
- All cross-webview communication goes through Rust as the source of truth. Webviews never communicate peer-to-peer.

## Stage 1 — Prototype (validate the whole hypothesis before committing)

Standalone proof-of-concept living in `prototypes/multiview/`. Three child webviews in one Tauri window with cross-webview drag. **Decision gate:** measured drag FPS during dock-divider resize is at least 3× current iframe baseline on at least one desktop platform. If not, stop and reconsider the architecture.

### Stage 1 setup
- [ ] Create `prototypes/multiview/` directory with its own Cargo.toml + minimal Tauri setup
- [ ] Configure Tauri 2 with `WebviewBuilder` API enabled
- [ ] Add Linux WebKitGTK per-`WebContext` configuration so each webview gets its own process
- [ ] Add minimal shell HTML page that creates 3 child webviews positioned in a 1+1+1 grid
- [ ] Each child webview loads a dummy HTML page with a card-shaped element that says "Board A/B/C"
- [ ] Add a Rust command `spawn_child_webview(label, url, position, size)` callable from the shell
- [ ] Add a Rust command `set_webview_geometry(label, position, size)` for live geometry updates
- [ ] Add a draggable divider in the shell HTML that, on pointer-move, updates child webview geometry via Rust commands

### Stage 1 cross-webview drag (must work)
- [ ] Define IPC contract: `drag_start`, `drag_preview`, `drop_ack`, `drag_cancel` Rust commands
- [ ] Define event contract: `drag-began`, `drag-enter`, `drag-over`, `drag-leave`, `drop`, `drag-complete`, `drag-cancelled`, `drag-ended`
- [ ] Implement Rust drag coordinator: state machine + global pointer tracking (NSEvent.mouseLocation / GetCursorPos / equivalent)
- [ ] Implement transparent always-on-top borderless ghost window via Tauri (one per platform path)
- [ ] Source webview: detect pointer-down on card + threshold movement → call `drag_start`
- [ ] Rust: hit-test pointer position against known webview rectangles, route `drag-enter`/`drag-over`/`drag-leave` to the correct target with local coordinates
- [ ] Target webview: handle `drag-over` by highlighting the drop zone (column or row indicator)
- [ ] Target webview: handle `drop` by inserting the card payload locally and calling `drop_ack(accepted: true)`
- [ ] Source webview: handle `drag-complete` by removing the card locally
- [ ] Cancel via Escape key + cancel by dropping outside any webview — verify both paths

### Stage 1 perf measurement
- [ ] Verify in Activity Monitor / Task Manager that each child webview is its own OS process (macOS, Windows, Linux)
- [ ] Add a synthetic-density board content to each child webview (~500 cards each) to mimic real load
- [ ] Measure dock-divider drag FPS during resize — record baseline before and after
- [ ] Measure cross-webview drag latency (pointer-move → ghost-window-update round-trip)
- [ ] Document numbers in `prototypes/multiview/RESULTS.md`

### Stage 1 decision gate
- [ ] Drag FPS during resize ≥ 3× current iframe baseline (success → proceed). If not, stop and rethink before any production refactor.

## Stage 2 — Rust webview manager (production-ready foundation)

Promote the prototype's Rust code into the production codebase. This becomes the foundation for all subsequent stages.

### Webview manager service
- [ ] Add `lexera-kanban/src-tauri/src/webview_mgr.rs` — owns the webview registry, lifecycle, and event routing
- [ ] State: `HashMap<WebviewId, WebviewHandle>` with metadata (position, size, visibility, status)
- [ ] Commands: `create_webview`, `destroy_webview`, `set_geometry`, `set_visibility`, `navigate`
- [ ] Events: broadcast `view-state-changed` to subscribers
- [ ] Per-platform configuration helpers (Linux WebContext-per-view, Windows WebView2 environment, macOS WKWebView config)

### Webview lifecycle
- [ ] Lazy-spawn: webviews only created when first shown
- [ ] LRU eviction: hidden views beyond N (configurable, default 8 active) get destroyed
- [ ] State preservation: destroyed webviews can be re-created with serialized state (passed via initial URL params or initial state event)
- [ ] Pre-warm pool: 2 always-ready empty webviews for instant board open

### State broadcasting
- [ ] `broadcast_event(event_name, payload, target: All | Group(GroupId) | Single(WebviewId))` 
- [ ] Per-view event subscription registry (each view subscribes only to events it cares about)
- [ ] Theme change → broadcast to all
- [ ] Catalog snapshot change → broadcast to workspace + dashboard views only
- [ ] Active board change → broadcast to all relevant views

### Drag coordinator service
- [ ] Promote the prototype's drag coordinator into `lexera-kanban/src-tauri/src/drag_coordinator.rs`
- [ ] Drag state machine with explicit states: Idle, DragInitiated, Dragging, Dropping, Cancelling
- [ ] Global pointer tracking abstraction (per-platform impls)
- [ ] Webview hit-test via geometry registry
- [ ] Ghost window manager (transparent always-on-top per platform)
- [ ] Throttling: drag-over events at most once per frame per target

### Stage 2 tests
- [ ] Unit tests for webview manager state transitions (Rust)
- [ ] Unit tests for drag coordinator state machine (Rust)
- [ ] Integration test: spawn 3 webviews, verify they exist, destroy them, verify cleanup
- [ ] Integration test: drag start → drag-over routing → drop → drag-complete sequence
- [ ] Run `./run-lexera-tests.sh` — all existing tests still pass

## Stage 3 — Strip workspaceShell.js to chrome-only

Today `workspaceShell.js` is ~5k LOC mixing layout, iframe hosting, event dispatch, and drag coordination. Reduce it to ~1.5k LOC of pure window-management code.

### Extract layout/geometry math
- [ ] Identify pure layout functions in `workspaceShell.js` (slot positioning, dock sizing, divider hit areas)
- [ ] Move them into `lexera-kanban/src/shell/layout.js` as a pure module
- [ ] Add unit tests for slot positioning (input dock sizes → output rectangles)

### Replace iframe code paths with webview manager calls
- [ ] Replace `getOrCreateFrame()` with `getOrCreateWebview(viewType, params)` that calls Rust `create_webview`
- [ ] Replace `frame.contentWindow.postMessage(...)` with `core.invoke('emit_to_view', { target, event, payload })`
- [ ] Replace `frame.classList.add('is-active')` with `core.invoke('set_webview_visibility', { id, visible })`
- [ ] Replace iframe geometry setting with `core.invoke('set_webview_geometry', ...)`
- [ ] Update `broadcastLayoutDragState` to broadcast through Rust event router
- [ ] Remove iframe creation, `frameCache`, and related code paths

### Shell-only chrome
- [ ] Move all chrome HTML (toolbar, dock containers, divider handles, drop overlays) into `lexera-kanban/src/shell/index.html`
- [ ] Move shell JS into `lexera-kanban/src/shell/shell.js`
- [ ] Move shell CSS into `lexera-kanban/src/shell/shell.css`
- [ ] Verify shell HTML loads with no iframes — child views appear via webview manager only

### Shell tests
- [ ] Update `tests/workspaceShell.test.js` to test the new shell module
- [ ] Add tests for the layout module (pure functions, easy to test)
- [ ] Run `./run-lexera-tests.sh` — all tests pass

## Stage 4 — Extract per-view sub-apps

Split the existing monolithic frontend into self-contained per-view sub-apps. Each view becomes its own HTML/JS/CSS bundle.

### Directory structure
- [ ] Create `lexera-kanban/src/views/board/` — HTML entry, JS, CSS
- [ ] Create `lexera-kanban/src/views/workspace/` — workspace browser
- [ ] Create `lexera-kanban/src/views/dashboard/` — board overview, stats
- [ ] Create `lexera-kanban/src/views/log/` — lexeraLog viewer
- [ ] Create `lexera-kanban/src/views/config/` — settings (currently lexera-shared/management)
- [ ] Move/refactor existing code into these directories

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

### Migration order (lowest risk first)
- [ ] Migrate Log view first — smallest scope, validates plumbing end-to-end
- [ ] Migrate Workspace view
- [ ] Migrate Dashboard view
- [ ] Migrate Config view
- [ ] Migrate Board view (largest scope; saved for last)

### Per-view tests
- [ ] Each view has its own test suite under `lexera-kanban/tests/views/<view>/`
- [ ] Tests run in isolation per view
- [ ] Run `./run-lexera-tests.sh` — all tests pass after each view migration

## Stage 5 — Slot-based layout system

The shell uses a "slot" abstraction. Each slot has a rectangle; the webview manager places a child webview in that rectangle. Slots are computed from dock sizes + divider positions.

### Slot system
- [ ] Define `Slot { id, rect, view_type, view_state }` data type
- [ ] Shell computes slot rectangles from current dock layout
- [ ] Layout changes (dock resize, panel split, tab switch) → recompute slots → push new geometry to webview manager
- [ ] Webview manager applies geometry changes to all affected webviews in one batch

### Performance during dock resize
- [ ] Dock divider drag → batched geometry updates (one IPC per frame, not per webview)
- [ ] Verify each child webview reflows in its own process — main shell thread stays responsive
- [ ] Measure FPS during dock resize on macOS, Windows, Linux — must match Stage 1 prototype numbers

### Tests
- [ ] Unit tests for slot computation (dock sizes → slot rectangles)
- [ ] Integration test: resize a dock → verify webview manager receives correct geometry calls
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

The Stage 1 prototype validated drag works. Production hardening ensures all real-world drag scenarios work.

### Drag scenarios that must work
- [ ] Card drag within a single board webview (existing behavior preserved)
- [ ] Card drag across two board webviews (new — validated in Stage 1)
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
- [ ] Add `lexera-kanban/tests/cross_webview_drag.test.js` — automated drag scenarios via simulated pointer events
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
- [ ] State preserved in Rust before destruction
- [ ] Re-show triggers spawn with state restoration

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

With many webviews, state synchronization patterns matter for correctness and performance.

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

## Risks and explicit decisions

- **Risk:** WebKitGTK per-process configuration may have quirks on older distros. **Mitigation:** require a minimum WebKitGTK version (2.40+) and document the requirement.
- **Risk:** Memory usage with many webviews. **Mitigation:** lazy spawn + LRU + pre-warm pool from Stage 8.
- **Risk:** Z-order issues for dialogs/dragging. **Mitigation:** Stage 6 explicitly addresses this with separate windows.
- **Risk:** Drag latency across processes. **Mitigation:** Rust pointer-tracking + GPU-composited ghost window keeps drag <16ms latency.
- **Decision:** Mobile (iOS/Android) does not migrate. They share `lexera-shared/` only. The desktop app diverges architecturally.
- **Decision:** No web-tech mixing with native UI. All UI stays HTML; the parallelism comes from process isolation, not from rendering tech changes.
- **Decision:** Single-direction state flow — webviews never communicate peer-to-peer; everything goes through Rust.
