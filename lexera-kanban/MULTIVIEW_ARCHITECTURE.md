# Lexera Kanban Multiview Architecture

This document is the authoritative description of the multiview architecture in `lexera-kanban` as it exists today. Use it together with [../TODOs-lexera-multiview.md](../TODOs-lexera-multiview.md), which now serves as a status and roadmap document rather than a line-by-line stage diary.

## Current reality

- The main application shell still lives in the primary webview and is composed by `src/workspace/workspaceShell.js`.
- Board tabs in a normal desktop shell are hosted as native Tauri child webviews rather than iframes.
- Embedded board mode (`?embedded=1`) and the frontend auto-run test mode still fall back to the iframe path.
- Utility views already extracted into their own child webviews are `log`, `inspector`, `workspaces`, and `dashboard`.
- Modal dialogs use top-level Tauri webview windows when multiview is available, via `src/dialogs.js`.
- The Rust drag coordinator and drag-ghost infrastructure exist, but the production board drag/drop system has not been fully migrated to that path yet.

## Layered architecture

### 1. Native runtime services

Files:

- `src-tauri/src/webview_mgr.rs`
- `src-tauri/src/drag_coordinator.rs`
- `src-tauri/src/main.rs`

Responsibilities:

- Own child-webview lifecycle, geometry, visibility, and registry state.
- Route broadcast and targeted events between webviews.
- Track per-view focus and health.
- Open modal windows above child webviews.
- Provide drag ghost and drag coordinator primitives.

Non-responsibilities:

- Product-specific board logic.
- Dock layout policy.
- Direct DOM assumptions about any view.

### 2. Shell transport and bridge layer

Files:

- `src/shell/multiviewClient.js`

Responsibilities:

- Wrap Tauri `invoke` and scoped `listen` APIs.
- Expose `window.LexeraMultiview` as the browser-side multiview API.
- Bridge shell events to board-compatible message events for embedded boards.
- Provide generic request/response helpers, theme broadcasting, panel launchers, and lifecycle helpers.

Current issue:

- `multiviewClient.js` is no longer just a thin transport wrapper. It now also contains launchers, bridge wiring, lifecycle helpers, and embedded-board compatibility logic.

Target boundary:

- Keep low-level invoke/listen helpers in `multiviewClient.js`.
- Move higher-level bridge and launcher logic into focused shell modules over time.

Recommended future split:

- `src/shell/multiviewClient.js` for raw IPC helpers only.
- `src/shell/panelLaunchers.js` for `openLogView`, `openInspector`, `openWorkspaces`, `openDashboard`.
- `src/shell/bridges/themeBridge.js` for theme snapshot and broadcast.
- `src/shell/bridges/navigationBridge.js` for `multiview-navigate` and shortcut routing.
- `src/shell/bridges/embeddedBoardBridge.js` for the board compatibility bridge.
- `src/shell/lifecycle.js` for LRU/pool helpers.

### 3. Workspace composition layer

Files:

- `src/workspace/workspaceShell.js`
- `src/workspace/workspaceShell.css`

Responsibilities:

- Own the dock tree, tab activation, tab movement, panel reveal, placeholder DOM, and geometry updates.
- Decide when a board tab should spawn, destroy, resize, or hide a child webview.
- Translate shell interactions into multiview events such as board actions, hierarchy focus, layout drag, and context-menu requests.
- Keep compatibility with the remaining iframe-based test and embedded flows.

Current issue:

- `workspaceShell.js` still mixes several concerns: dock-tree math, placeholder hosting, panel UI, multiview lifecycle, context-menu bridging, focus delivery, and compatibility shims.

Recommended future split:

- `src/workspace/workspaceShell.js` as the composition root only.
- `src/workspace/layoutTree.js` for pure dock-tree and slot math.
- `src/workspace/boardHost.js` for placeholder creation, spawn/destroy, geometry push, and visibility observers.
- `src/workspace/focusRouter.js` for `focus-hierarchy-target`, pane activation, and pending focus delivery.
- `src/workspace/contextMenuBridge.js` for `build-context-menu` and `dispatch-action`.
- `src/workspace/catalogBridge.js` for catalog and active-board propagation.
- `src/workspace/tabLifecycle.js` for loaded/unloaded tab state and deferred loading.
- `src/workspace/panelRegistry.js` for panel descriptors and reveal/open behavior.
- `src/workspace/tabOverflow.js` for overflow/dropdown behavior.

### 4. Per-view child webviews

Files:

- `src/views/log/`
- `src/views/inspector/`
- `src/views/workspaces/`
- `src/views/dashboard/`
- `src/views/modals/`
- `src/views/drag-ghost/`
- `src/views/_shared/`

Responsibilities:

- Render self-contained sub-app UIs.
- Subscribe only to the events that a specific view needs.
- Request navigation or actions through the shell rather than directly reaching into peer views.
- Report focus and health through the shared runtime or explicit commands.

Recommended structure per view:

- `index.html` for the entry document.
- `<view>.js` for the controller/runtime glue.
- `<view>.css` for local styling.
- Shared primitives pulled from `src/views/_shared/`.

Implementation note:

- `workspaces`, `dashboard`, `log`, and `inspector` now follow the shared runtime pattern.
- The remaining view gaps are feature completeness (`hierarchy`, `frontendTests`) and the explicit board-entry boundary, not utility-view bootstrap drift.

### 5. Legacy board application

Files:

- `src/index.html`
- `src/app.js`
- `src/board/`
- `src/dragdrop/`
- `src/search/`
- related legacy frontend modules

Responsibilities:

- This is still the actual board runtime.
- In multiview mode, board child webviews load the existing embedded kanban app rather than a new `src/views/board/` bundle.
- Board mutations, rendering, keyboard navigation, context-menu building, and most drag/drop behavior still live here.

Important consequence:

- The board has been multiview-hosted before it has been fully extracted into a clean standalone sub-app.
- That is why `workspaceShell.js`, `multiviewClient.js`, and `app.js` currently contain several compatibility bridges.

### 6. Shared utilities

Files:

- `src/views/_shared/subAppRuntime.js`
- `src/views/_shared/healthDot.js`
- `src/dialogs.js`
- `src/dialogs.css`
- `src/core/viewStateStore.js`

Responsibilities:

- Common sub-app bootstrapping, scoped event subscriptions, focus reporting, shortcut forwarding, and health indication.
- Dialog behavior that can switch between overlay mode and native modal-window mode.
- Small shared frontend state helpers.

Target direction:

- Prefer putting new cross-view browser utilities in a shared helper rather than duplicating boot logic in each sub-app.

## Event model

### Core rule

All cross-webview traffic goes through Rust. Webviews do not communicate peer-to-peer.

### Broadcast events

Examples already in use:

- `theme-snapshot`
- `catalog-snapshot`
- `active-board-changed`
- `log-message`
- `layout-drag`
- `multiview-shortcut`
- `panel-ready`
- `panel-teardown`
- `focus-changed`
- `health-changed`
- `multiview-destroyed`

Use broadcasts for:

- State snapshots.
- Shell-wide activity signals.
- Events where more than one view may care.

### Targeted events

Examples already in use:

- `board-action`
- `focus-hierarchy-target`
- `dispatch-action`
- `delegate-mutation`

Use targeted events for:

- Sending work to exactly one board or one view.
- Avoiding accidental fan-out into unrelated webviews.

### Request/response pattern

Examples already in use:

- `build-context-menu`
- `build-context-menu-response`

Use the `LexeraMultiview.request()` / `handleRequest()` pattern when the sender needs a value back.

### Listener rule

Always use the current webview's scoped listener for targeted events.

Correct pattern:

```js
const wv = window.__TAURI__.webview.getCurrentWebview();
wv.listen('drop', handler);
```

Do not use the global event listener for targeted webview traffic, because it defaults to an any-target subscription and breaks event isolation.

### Current panel-view contract

For dock-hosted panel webviews, `src/views/_shared/subAppRuntime.js` is the shared contract boundary.

- Identity helpers exposed on `window.LexeraSubApp`:
  - `getPanelKind()`
  - `getPanelInstanceId()`
  - `getPaneId()`
  - `getWindowLabel()`
  - `getHostWindowLabel()`
  - `getContext()`
- Lifecycle handshake emitted by `LexeraSubApp.init()`:
  - `panel-ready` with `{ label, paneId, panelKind, panelInstanceId, windowLabel, hostWindowLabel, at }`
  - `panel-teardown` with the same payload shape on `beforeunload`

Current per-kind event subscriptions:

| Kind | Entry | Subscriptions |
|---|---|---|
| `logs` | `src/views/log/` | `log-message`, `theme-snapshot` |
| `dashboard` | `src/views/dashboard/` | `catalog-snapshot`, `active-board-changed`, `theme-snapshot` |
| `hierarchy` | `src/views/hierarchy/` | `catalog-snapshot`, `active-board-changed`, `theme-snapshot` |
| `weekCalendar` | `src/views/weekCalendar/` | `theme-snapshot`, `management-board-mutation`, `calendar-tasks-update` |
| `monthCalendar` | `src/views/monthCalendar/` | `theme-snapshot`, `management-board-mutation`, `calendar-tasks-update` |
| `backendSettings` | `src/views/backendSettings/` | `theme-snapshot` |
| `frontendSettings` | `src/views/frontendSettings/` | `theme-snapshot` |
| `renderApps` | `src/views/renderApps/` | `theme-snapshot` |
| `files` | `src/views/files/` | `theme-snapshot` |
| `frontendTests` | `src/views/frontendTests/` | `theme-snapshot`, `frontend-tests-state` |

## Labels and ownership

Current label conventions:

- Board tabs: `board-tab-<tabId>`
- Panel tabs: `panel-tab-<tabId>`
- Utility views: `log-view`, `inspector`, `workspaces`, `dashboard`
- Modal windows: generated unique labels such as `confirm-modal-<n>`
- Drag ghost: `drag-ghost`

Rules:

- Labels are runtime routing identifiers, not product ids.
- Product code should not infer business meaning from a label beyond the documented prefix contract.
- If a new view type needs targeting, define and document its label prefix in one place.

## Geometry and visibility lifecycle

Current flow:

- `workspaceShell.js` creates a placeholder element for each board tab.
- Placeholder geometry is read from the DOM and pushed to Rust through `multiview_set_geometry`.
- `ResizeObserver` and visibility observers keep the child webview aligned with its placeholder.
- Hidden views are both hidden natively and parked offscreen as a defensive fallback.
- LRU freshness is updated on tab activation and focus changes.

Important constraint:

- The shell is still the source of truth for layout. Rust owns native placement, but not dock layout decisions.

## What is implemented vs. still provisional

Implemented:

- Board child-webview hosting in the normal desktop shell.
- Cross-view event routing through Rust.
- Catalog, theme, log, focus, health, and context-menu bridges.
- Native modal windows for `LexeraDialogs.confirm()` and `LexeraDialogs.prompt()`.
- Basic LRU eviction hooks and placeholder visibility handling.

Partially implemented:

- Lifecycle pooling exists as scaffolding, but the shell does not rely on a true pre-warmed navigation path yet.
- Health, focus, and inspector tooling exist, but their APIs should still be cleaned up and normalized.
- `multiviewClient.js` contains both stable transport primitives and temporary migration glue.

Not yet fully implemented:

- A dedicated `src/views/board/` board bundle.
- Production drag/drop routed through `drag_coordinator.rs`.
- Serialized board state restoration across destroy/recreate.
- Full Linux/Windows validation and Linux-specific per-context hardening.
- Test infrastructure that operates directly against multiview instead of forcing iframe fallback.

## Rules for adding a new multiview sub-app

1. Create `src/views/<name>/index.html`, `<name>.js`, and `<name>.css`.
2. Start with `src/views/_shared/subAppRuntime.js` unless the view has a concrete reason not to.
3. Subscribe only to the events the view actually needs.
4. Use `LexeraSubApp.navigate()`, `broadcast()`, or `invoke()` instead of reaching into another view's globals.
5. If the shell needs something from the view, define a named event contract and route it through Rust.
6. Add a launcher in the shell layer, not inside unrelated product modules.
7. Verify theme inheritance, focus reporting, health reporting, and close/destroy behavior.

## Refactor priorities

The next structural work should happen in this order:

1. Extract a dedicated board sub-app boundary so the board is no longer "legacy app loaded in embedded mode". The current `layoutTree.js` / `boardHost.js` extraction work is useful only insofar as it makes that seam explicit.
2. Introduce slot-based layout as the source of truth so geometry and visibility updates are diffed from state instead of inferred from placeholder DOM.
3. Continue splitting `workspaceShell.js` into layout, hosting, routing, and panel modules around that cleaner board boundary.
4. Split `multiviewClient.js` into transport primitives and higher-level shell services.
5. Migrate drag/drop to the Rust drag coordinator and remove iframe-era assumptions.
6. Move tests away from iframe-only inspection so multiview becomes test-native.

## Short architectural summary

- Rust owns native lifecycle and cross-webview transport.
- The shell owns dock layout and high-level workspace orchestration.
- Per-view child webviews own their own UI and subscribe to narrow event sets.
- The board is hosted in multiview today, but it is not yet architecturally extracted.
- The main code-structure goal is to reduce compatibility glue in `workspaceShell.js` and `multiviewClient.js` by turning them into composition layers rather than feature buckets.
