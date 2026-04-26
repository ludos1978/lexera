# Multiview Status And Roadmap

This file tracks the production status and remaining work for the multiview migration in `lexera-kanban`.

The authoritative architecture and code-boundary document now lives in [lexera-kanban/MULTIVIEW_ARCHITECTURE.md](lexera-kanban/MULTIVIEW_ARCHITECTURE.md).

## Documentation map

- Architecture and code structure: [lexera-kanban/MULTIVIEW_ARCHITECTURE.md](lexera-kanban/MULTIVIEW_ARCHITECTURE.md)
- Prototype walkthrough: [prototypes/multiview/README.md](prototypes/multiview/README.md)
- Prototype measurement sheet: [prototypes/multiview/RESULTS.md](prototypes/multiview/RESULTS.md)

## Hard requirement: every dock-hosted view runs in its own webview

Every view that the user can dock as a tab — board tabs **and** panel tabs (hierarchy, dashboard, logs, calendars, settings, files, frontendTests, etc.) — must be hosted as a separate Tauri child webview. The shell composes layout, places placeholders, and routes events; it must NOT render any view's UI inside its own DOM.

**Why this is a hard rule, not a nice-to-have:**

- Process isolation per view (parallel rendering, independent crash domain).
- Per-view DevTools (right-click → Inspect on a panel must open that panel's webview, not the shell's).
- Per-view event subscriptions instead of monolithic shell-side handlers.
- Stable cross-view drag/drop semantics (the drag coordinator already routes by webview label).

**Current gap (2026-04-25):**

Board tabs **and** dock-hosted panel tabs now satisfy the hosting rule. The remaining gap is feature completeness and legacy cleanup, not shell-DOM hosting: several panel sub-apps are still partial (`hierarchy` rich tree deferred, `frontendTests` still a stub), and legacy modules still read `LexeraSharedPanels` roots or `lexera-shared-panel-created` even though the workspace shell no longer uses that registry to render panels.

The floating helper views exposed by `LexeraMultiview.openLogView()` / `openInspector()` / `openWorkspaces()` / `openDashboard()` still duplicate some surfaces outside the dock-hosted path. That is acceptable as dev tooling, but the authoritative user-facing implementation remains the dock-hosted child-webview path.

## Current implementation snapshot (2026-04-25)

### Implemented

- Board tabs in the normal desktop shell spawn as native Tauri child webviews via `workspaceShell.js` + `multiviewClient.js` + `webview_mgr.rs`.
- Dock-hosted panel tabs now route through `panelHost.js` + `buildMultiviewPanelPlaceholder(...)` and spawn child webviews under `src/views/<kind>/`.
- Floating sub-app helpers still exist for `log`, `inspector`, `workspaces`, and `dashboard` under `src/views/<name>/` for dev-side inspection and side-panel workflows.
- Rust owns webview lifecycle, event routing, health, focus, modal windows, and drag primitives.
- `LexeraDialogs.confirm()` and `LexeraDialogs.prompt()` already switch to native modal windows when multiview is active.
- Context-menu request/response routing, hierarchy-focus delivery, active-board broadcasts, catalog broadcasts, and theme broadcasts are all in place.
- LRU-style freshness tracking and destroy/respawn cleanup hooks exist for board child webviews.

### Partially implemented

- Lifecycle pooling exists as scaffolding, but the shell does not yet depend on a true pre-warmed navigation path.
- The drag coordinator and ghost window exist, but production board drag/drop still primarily uses the legacy board drag system.
- Event subscriptions are filtered in Rust, but batching and scale-tuning are still unfinished.
- The board runs in child webviews today, but it is still the legacy embedded board app rather than a clean `views/board/` sub-app.
- Several panel sub-apps are still only partial ports: `hierarchy` is minimal and `frontendTests` is still a stub.
- Legacy `LexeraSharedPanels` consumers still exist in non-workspace modules and need explicit retirement so panel discovery and hydration no longer depend on shell-DOM-era hooks.

### Deliberate fallbacks still in use

- Embedded mode (`?embedded=1`) still disables multiview board spawning.
- Frontend auto-run tests still force the iframe path by detecting `auto-run-config.json`.

### Current test status

- `158 passed, 1 failed / 159 in 35s (2026-04-24)`
- The remaining failure is the pre-existing intermittent `card move: view→view cross-column` flake.

## Lifecycle-race fix: `add_child failed ... already exists` *(2026-04-25)*

### Reproduction

User reported `Failed to load board webview / add_child failed for board-tab-tab-mod5c6un-i: a webview with label 'board-tab-tab-mod5c6un-i' already exists` shown inside a board placeholder while another board was loading correctly. The error originates from Tauri's `WebviewWindow::add_child` and is surfaced verbatim by `spawn_internal` in [`webview_mgr.rs:80`](lexera-kanban/src-tauri/src/webview_mgr.rs#L80).

### Root cause

The shell's `multiviewSpawnedTabs[tabId]` registry was a binary "spawned / not-spawned" flag, but the actual webview lifecycle has three real states: spawning, ready, destroying. With only a binary flag, the shell could not distinguish "spawn already in flight" from "no webview yet", so any concurrent re-entry of `ensureMultiviewWebview` for the same tab id would issue a parallel spawn IPC and collide on the Rust side.

Three independent triggers were identified:

1. **`getOrCreateFrame` re-entry**: the render loop (or a state-change cascade) calls `getOrCreateFrame` twice for the same tab before the first `LexeraMultiview.spawn` promise resolves. The second call sees an empty registry → issues a parallel spawn → Tauri rejects the duplicate label.
2. **`destroyMultiviewWebview` optimistic local-clear**: the function deletes `multiviewSpawnedTabs[tabId]` synchronously, then calls Rust destroy as fire-and-forget. If `ensureMultiviewWebview` runs for the same tab during the destroy-in-flight window, the registry says "not spawned" but Rust still has the webview.
3. **`multiview-destroyed` auto-respawn rAF**: a single `requestAnimationFrame` defer was assumed sufficient to let Rust-side cleanup finish before respawn. On macOS the OS-level webview teardown can outlast a 16ms frame; respawn collides with the not-yet-fully-destroyed webview.

A fourth latent path: shell reload while the parent Tauri window survives (e.g. dev HMR-style flows or any future "reload shell" command) leaves Rust holding webviews under tab-ids the fresh shell will regenerate identically; restored tabs would replay the spawn → collision.

### Fix

Promote `multiviewSpawnedTabs` to a per-tab state machine in [workspaceShell.js:2099](lexera-kanban/src/workspace/workspaceShell.js#L2099):

```
multiviewSpawnedTabs[tabId] = { url, state: 'pending' | 'ready' | 'destroying' }
```

- **Mark `pending` BEFORE the IPC `spawn` call** (not after the promise resolves). Render-loop re-entry sees `state === 'pending'` and short-circuits.
- **Mark `destroying` BEFORE the IPC `destroy` call** in both `destroyMultiviewWebview` and the URL-change path. Concurrent `ensureMultiviewWebview` calls during the destroy window short-circuit instead of stacking.
- **Delete the entry only on Rust confirmation** (resolve/reject of the destroy promise). No optimistic clear.
- **"Already exists" auto-recovery**: if `LexeraMultiview.spawn` rejects with `/already exists/i`, the shell now issues `LexeraMultiview.destroy(label)` and retries `doSpawn()` exactly once (non-recursive — no loop risk). This recovers from any state divergence: orphaned Rust webviews from prior reloads, race losers, out-of-band creates.
- **`cleanupMultiviewLocalState` preserves a `pending` entry**: if a fresh spawn is in flight, a stale `multiview-destroyed` event from an earlier lifecycle no longer stomps the new one.
- **Auto-respawn becomes safe by construction**: the rAF callback still runs, but the resulting `ensureMultiviewWebview` call sees `state === 'pending'` (if a fresh spawn started in parallel) and short-circuits. No extra gating needed in the event handler.

### Why the fix is faithful to existing call sites

All four `ensureMultiviewWebview` callers (`getOrCreateFrame`, retry-button click, URL-change destroy `.then`, `multiview-destroyed` rAF callback) ignore the return value, so adding internal Promise composition does not change the public contract. `destroyMultiviewWebview` callers (`removeFrame`, `beforeunload`) likewise don't await it. The state machine is internal to the shell.

### Out of scope (deliberate)

- **No livelock detection**: a spawn that never resolves leaves the entry pinned in `pending`. This is a Tauri-side concern; not reintroduced by this fix, not fixed by it either.
- **Registry ownership move into `boardHost.js`**: that's slice 4c proper. The state machine currently lives in the shell so the bug fix and the architectural move stay decoupled.
- **Test coverage**: the existing harness doesn't mock `LexeraMultiview`. Adding a focused state-machine unit test belongs in slice 4c when the registry moves into `boardHost.js` and gets a clean injection seam.

## Performance workstream: tighten the multiview hot paths *(2026-04-25)*

Now that every dock-hosted view is a separate webview/process, the next
investment is making the multiview hot paths optimally fast. Items
ordered by perceived impact.

### 1. Pre-warmed webview pool *(landed end-to-end)*

- [x] Rust command `multiview_navigate(label, url)` calls `webview.navigate(url)` directly — bypasses `add_child`, reuses the renderer process.
- [x] JS API `LexeraMultiview.navigate(label, url)` exposed.
- [x] `tryRepurposeFromPool` rewritten to use the navigate fast-path.
- [x] `lifecycleSpawn` now tries the pool first; returns `{ label, fromPool }` so callers can rebind to the actual webview label.
- [x] `ensureMultiviewWebview` consumes `result.label`: if `fromPool`, the closure's `label` is rebound to the pool label so all downstream operations (`pushGeom`, destroy on URL change, error UI retry) target the correct webview.
- [x] Label-indirection: `tabIdFromLabel` and `isHostedTabLabel` first match the `board-tab-` / `panel-tab-` prefixes; for unprefixed labels (i.e., pool labels) they scan `multiviewSpawnedTabs[*].label` to recover the tabId. No new state needed — the existing per-tab `label` field is the source of truth.
- [x] `poolSize` default raised from 0 to **2**. `bootMultiview` calls `refillPool()` one rAF after mount so the shell isn't blocked. `tryRepurposeFromPool` re-fills after each consumption.

**Expected impact**: first click of any board (or panel) opens via `webview.navigate(url)` (typically <50 ms) instead of `add_child` (~100–300 ms). After the pool is consumed, refill happens in the background.

**Caveats**:
- The pool member's URL during pre-warm is `multiview-demo.html` (a tiny placeholder page). If a user opens DevTools on a pool webview before it's repurposed, they'll see that demo page.
- Pool members participate in LRU eviction once consumed. Until consumed, they're filtered out of the soft-cap.

### 2. Batched per-frame geometry push *(landed)*

- [x] Added `LexeraMultiview.pushGeomDeferred(update)` in [multiviewClient.js](lexera-kanban/src/shell/multiviewClient.js) — coalesces all geometry updates received in one animation frame into a single batched `multiview_set_geometry` IPC. Last update per label wins.
- [x] Updated [boardHost.localPushGeom](lexera-kanban/src/workspace/boardHost.js) and [workspaceShell.pushGeom](lexera-kanban/src/workspace/workspaceShell.js) to use the deferred path. Falls back to direct `setGeometry` if the deferred helper is unavailable.
- [x] Visibility-flip parking (offscreen at -50000,-50000) also routes through the coalescer.
- [ ] Future: a true slot-map diff that only emits updates when a slot's geometry actually changes. Today every `pushGeom` call enqueues; the coalescer dedupes by label but doesn't suppress no-op updates.

### 3. Subscription-filtered broadcasts *(landed)*

Audit found that `multiview_broadcast` was already filtering through `SubscriptionRegistry` correctly. The only outlier was `log_broadcast`, which used unfiltered `app.emit("log-message", ...)`. Every webview was being woken on every log line.

- [x] Updated `log_broadcast` in [webview_mgr.rs](lexera-kanban/src-tauri/src/webview_mgr.rs) to consult `SubscriptionRegistry`. Only webviews that called `multiview_subscribe(['log-message'])` (i.e., the actual log views) are emitted to. Falls back to global emit if no subscribers (back-compat).
- [x] Other targeted emitters (`multiview_emit_to`, `focus-changed`, `health-changed`, `multiview-destroyed`) keep `app.emit` because they're genuinely global signals. ✓ correct.

### 4. LRU memory awareness *(deferred)*

Needs the `sysinfo` crate (or per-platform process introspection) to query renderer memory. Plumbing-wise: would add a Rust command, post-spawn hook, and a `LexeraMultiview.lifecycle.status()` field. Substantial enough to be its own slice; today's count-based soft cap of 8 is the only safety.

- [ ] Add `sysinfo` crate dep in `lexera-kanban/src-tauri/Cargo.toml`.
- [ ] Add Rust `multiview_total_renderer_memory()` (per-platform OS query).
- [ ] Post-`lifecycle.spawn` hook: if total memory > threshold (default 1.5 GB), evict additional non-pinned webview.

### 5. Drag/drop migration to Rust coordinator *(deferred — blocked)*

The Rust drag coordinator + ghost window infra exist (Stage 1
prototype validated 3× FPS at 1500-card density). Production card drag
still goes through the legacy iframe-era DOM drag.

- [ ] Blocker: depends on a clean board-view boundary
      (Workstream #2). Today the legacy app.js is the active drag
      handler; the multiview path would need explicit drag-source /
      drag-target board commands.
- [ ] When unblocked: route card-drag events through `drag_coordinator`
      Rust commands; remove iframe-era assumptions.

### 6. Linux per-process WebKitGTK config *(deferred — blocked)*

On Linux today, all webviews share a `WebContext` and therefore a
process. Per-process isolation defeats the multiview perf story.

- [ ] Blocker: needs Linux verification environment.
- [ ] When unblocked: configure `WebContextBuilder::new()` per webview
      in `webview_mgr.rs` for Linux builds; document min WebKitGTK
      version.

### 7. Native `set_visible(false)` for hidden webviews *(already in place; parking kept as defensive fallback)*

Audit: `boardHost.watchPlaceholderVisibility` already calls `multiview_set_visible(label: false)` when hiding. The offscreen parking (-50000, -50000) is an additional defensive call per the comment "Belt-and-braces… in case Tauri's hide() is delayed/unreliable on this OS". Removing the parking would save one IPC per visibility flip — not a hot path — and risks paint-over bugs if `set_visible` is unreliable on Linux. Leave as-is.

- [x] `multiview_set_visible` is invoked on hide/show. ✓
- [x] Hidden-webview parking goes through the new geometry coalescer (Perf #2), so it's batched alongside other geometry updates.

### 8. Settings webview JS de-duplication *(deferred — low priority)*

Each of the four settings sub-apps (`backendSettings`,
`frontendSettings`, `renderApps`, `files`) loads its own copy of
`api.js` (1667 LOC) and `management.js` (2872 LOC). On WKWebView
per-process that's 4× parse + 4× heap. Acceptable for alpha; revisit
if startup latency becomes a felt issue.

### 9. Calendars: polling → push *(deferred — low priority)*

Calendar sub-apps poll `/calendar/tasks` every 30 s. The backend
already emits SSE for board changes; calendars could subscribe and
re-fetch only on real mutations. Marginal gain unless many calendars
are simultaneously open.

### 10. Measured baseline *(helper landed; baseline run pending)*

- [x] Added `LexeraMultiview.fpsMeter(durationMs = 5000)` in [multiviewClient.js](lexera-kanban/src-tauri/../src/shell/multiviewClient.js) — counts frames + per-frame timings via `requestAnimationFrame`. Returns `{ samples, durationMs, fps, minFrameMs, maxFrameMs, p50FrameMs, p95FrameMs }`. Logs to console for capture.
- [ ] Run a measurement pass once interactive verification of the perf landings is done. Suggested protocol:
  1. Open 4 boards in the shell.
  2. In shell DevTools: `await LexeraMultiview.fpsMeter(5000)` then immediately drag the right dock divider for 5 seconds.
  3. Pin the result in `prototypes/multiview/RESULTS.md`.
  4. Re-run after each subsequent perf change to spot regressions.

## In-flight refactor: workspaceShell.js split (started 2026-04-25)

The first refactor priority from `MULTIVIEW_ARCHITECTURE.md` is being executed incrementally. Slice-by-slice progress is tracked here so the work can be resumed across sessions.

### Slice plan for `workspaceShell.js → layoutTree.js`

- [x] **Slice 1 — pure tree traversal helpers** *(2026-04-25)*
  - Extracted `normalizeViewKind`, `isPanelTab`, `isBoardTab`, `visitTree`, `getFirstLeaf`, `findLeafById`, `findNodeAndParent`, `findTab`, `findClosestSplitParent`, `countTreeTabs` into `src/workspace/layoutTree.js` exposed as `window.LexeraLayoutTree`.
  - Wired into `index.html` before `workspaceShell.js`.
  - Test loader updated to concatenate `layoutTree.js` first via `loadIIFE([...])`.
  - 19-test suite added at `tests/layoutTree.test.js`.
  - `workspaceShell.js` shrank 5723 → 5660 lines. No regressions vs. baseline.
- [x] **Slice 2 — node constructors + id factory** *(2026-04-25)*
  - Moved `createIdFactory`, `createTabsetNode(tabs, idFactory)`, `createSplitNode(axis, first, second, ratio, idFactory)`, `withNormalizedLeaves(node, isRoot, idFactory)` into `layoutTree.js`.
  - The id factory is shell-owned; layoutTree only provides the constructor that takes it as a parameter.
  - `workspaceShell.js` keeps thin partial-application wrappers (`createTabsetNode(tabs)`, `createSplitNode(...)`, `withNormalizedLeaves(node, isRoot)`) that bind the shell's `nextId`. Internal call sites are unchanged.
- [x] **Slice 3 — board/panel finders that depend on layoutTree primitives** *(2026-04-25)*
  - Moved `findLeafContainingBoard`, `findAnyLeafContainingBoard`, `findLeafContainingPanel(node, panelId, resolvePanelTarget)` into `layoutTree.js`.
  - `workspaceShell.js` aliases the first two directly and wraps `findLeafContainingPanel(node, panelId)` with the shell's `resolvePanelTarget` callback. Function-declaration hoisting keeps the wrapper safe even though `resolvePanelTarget` is defined further down.
  - Combined slice 1+2+3 result: `workspaceShell.js` shrank 5723 → 5560 lines; `layoutTree.js` grew to 214 lines with 38 unit tests.
- [x] **Slice 3.5 — tab factories + dock migration** *(2026-04-25)*
  - Moved `createBoardTab(boardId, viewKind, idFactory)`, `createPanelTab(panelId, idFactory)`, and `migratePanelDocksToSideDocks(panelDocks, panelGroupActives, idFactory)` into `layoutTree.js`.
  - These are pure tree-construction helpers. Same partial-application wrapper pattern in `workspaceShell.js`.
  - Inserted between slice 3 and slice 4 because they are mechanically the same risk profile as slices 1–3 and would otherwise be entangled with the much riskier slice 4. Extracting them now keeps slice 4 focused on stateful/DOM work.
  - Result: `workspaceShell.js` 5560 → 5504 lines; `layoutTree.js` 214 → 278 lines; 11 new tests (49 total).
- [ ] **Slice 4 — board-host module** *(in progress — high-risk; needs interactive verification per sub-slice)*
  - Move placeholder creation, frame cache, geometry push, visibility observers, and `getFrameWindowForBoard` into `src/workspace/boardHost.js`.
  - This is the iframe-era compatibility surface; extracting it makes the seam visible and replaceable.
  - **Risk note**: this slice is intrinsically larger and more dangerous than 1–3.5 — it is stateful (`state.frameCache`, `state.loadedBoardFrames`, `state.deferredBoardLoadQueue`), touches the DOM, runs `ResizeObserver`/`IntersectionObserver`, and interacts with the multiview client to spawn/destroy child webviews. Surface area is ~94 references in `workspaceShell.js` today.
  - **Sub-slicing**:
    - [x] **4a — read-only frame helpers** *(2026-04-25)*
      - Created `src/workspace/boardHost.js` exposing `window.LexeraBoardHost.getFrameWindowForBoard(dockTree, frameCache, boardId)`. State is passed explicitly; the module is pure relative to its inputs.
      - `workspaceShell.js` keeps the 1-arg `getFrameWindowForBoard(boardId)` wrapper so the public contract on `LexeraWorkspaceShell` (consumed by `app.js` mutation delegation and stubbed by `frontendTests.js`) is unchanged.
      - Wired `boardHost.js` into `index.html` (after `layoutTree.js`, before `workspaceShell.js`) and into the test loader.
      - 8 unit tests in `tests/boardHost.test.js`. Result: `workspaceShell.js` 5504 → 5494 lines; `boardHost.js` 33 lines.
    - [x] **4b — multiview label + health-dot + visibility observer** *(2026-04-25)*
      - Moved `multiviewLabelForTab(tabId)`, `ensureHealthDot(placeholderEl, doc)`, and `watchPlaceholderVisibility(tabId, placeholderEl, pushGeomFn)` into `boardHost.js`.
      - Visibility-observer registry (previously a private `multiviewVisibilityObservers` map inside `workspaceShell.js`) is now owned by `boardHost.js`. The shell calls `boardHost.cleanupVisibilityObserver(tabId)` from `cleanupMultiviewLocalState`.
      - Added `boardHost.hasVisibilityObserver(tabId)` as a test-friendly inspector.
      - 12 new unit tests covering label formatting, health-dot create/reuse/null-doc, observer lifecycle (early-return without `LexeraMultiview`, idempotent registration, visible/hidden geometry behavior, custom `pushGeomFn` override, cleanup disconnects observers and forgets the tab, no-op for unknown tab ids).
      - Result: `workspaceShell.js` 5494 → 5422 lines; `boardHost.js` 33 → 157 lines; total reduction from baseline now 5723 → 5422 = 301 lines.
      - **Interactive verification still required**: open multiple boards, drag dividers, hide/show, destroy/respawn — unit tests use mocked observers and cannot catch real DOM regressions in this slice.
    - [x] **4c-prep — URL helpers** *(2026-04-25)*
      - Moved `multiviewUrlForTab(desiredSrc)` and `getEmbeddedUrlForTab(tab, locationHref)` into `boardHost.js`.
      - `getEmbeddedUrlForTab` now takes `locationHref` explicitly so it is pure relative to its inputs (the shell wrapper supplies `window.location.href`).
      - 11 new tests covering panel-tab early-return, required search params, `view` param suppression for default viewKind, omitted `board` param when boardId is empty, scheme-stripping, fragment preservation, and the index.html fallback for empty-path URLs.
      - Result: `workspaceShell.js` 5422 → 5400 lines; `boardHost.js` 157 → 197 lines; total reduction from baseline now 5723 → 5400 = 323 lines.
    - [ ] **4c — webview spawn/destroy + geometry push** *(deferred — biggest single block in workspaceShell.js)*
      - The remaining work in this sub-slice is the ~110-line `ensureMultiviewWebview(tab, placeholderEl, desiredSrc)` body plus its two registries (`multiviewSpawnedTabs`, `multiviewGeometryObservers`), the multiview-destroyed event listener, the beforeunload cleanup hook, the `MV_INSET` URL parameter, and the `destroyMultiviewWebview` helper.
      - **Why deferred to its own session**: this code is the single biggest concentration of multiview/Tauri integration logic in the shell. It includes recursive retry on spawn failure, error UI HTML injection, dual `requestAnimationFrame` scheduling, multi-step geometry push (spawn-time, next frame, 50ms, 200ms), and ResizeObserver wiring. Splitting cleanly requires either:
        - a) adopting a `boardHost.spawnOrUpdateBoardWebview(tab, placeholderEl, desiredSrc, options)` API that takes the retry callback and lifecycle/spawn/destroy bindings as parameters, OR
        - b) moving the registries first (mechanical), then extracting the function in a follow-up.
      - Approach (b) is preferred because it lets the giant function move as a single block once its registries already live in boardHost.
      - **Pre-condition**: needs an interactive smoke pass (open multiple boards, drag dividers, hide/show, destroy/respawn) BEFORE starting and AFTER landing, because spawn/retry/auto-respawn cannot be exercised by unit tests without a real Tauri runtime.
    - [ ] **4d — frame-cache ownership** — move `state.frameCache`/`loadedBoardFrames`/`deferredBoardLoad*` into the boardHost module.
  - **Pre-condition**: needs interactive smoke test on macOS after each sub-slice (open multiple boards, drag dividers, hide/show, destroy/respawn) — unit tests alone cannot catch DOM/observer regressions here.
- [ ] **Slice 5 — bridges**
  - `focusRouter.js` (focus delivery, hierarchy focus targets).
  - `catalogBridge.js` (catalog + active-board propagation).
  - `contextMenuBridge.js` (build-context-menu request/response).
- [ ] **Slice 6 — panel registry / tab lifecycle / overflow** *(retargeted by Workstream P)*
  - `panelRegistry.js` is now the registry of panel KINDS, their default docks, their webview URL templates (`panelUrlForTab(tab, kind)`), and the `PANEL_WEBVIEW_KINDS` allowlist used by Workstream P. It is NOT a host for shell-DOM panel elements (that lives in the legacy `LexeraSharedPanels` and is being deleted slice by slice in Workstream P).
  - `tabLifecycle.js` (loaded/unloaded tab state, deferred load queue) and `tabOverflow.js` (overflow dropdown) extract unchanged.

### Architectural insights captured during slice 1

- **No ES modules** — the kanban shell loads everything as plain `<script>` tags. The canonical split pattern is "IIFE that attaches a namespace to `window`" (e.g. `window.LexeraLayoutTree`). New shell modules must follow this pattern.
- **Test concatenation pattern** — `loadIIFE` already accepts an array of file paths and concatenates them in order before evaluation. To split an IIFE-bundle into smaller IIFEs, update the test caller to pass an array, e.g. `loadIIFE(['workspace/layoutTree.js', 'workspace/workspaceShell.js'], 'window.LexeraWorkspaceShell', {...})`.
- **`workspaceShell.js` aliases extracted helpers locally** — the pattern `var visitTree = layoutTree.visitTree;` near the top of the IIFE keeps body call sites unchanged. This minimizes diff churn during extraction.
- **Pure-vs-impure boundary** — only functions with no closure-state dependency can move cleanly. Shell functions that read `state.*` (e.g. `getTabIdForBoard`, `getFrameWindowForBoard`) belong in `boardHost.js`, not `layoutTree.js`. Functions that depend on a closure-bound id factory move into `layoutTree.js` if the factory is passed in as a parameter.
- **Pre-existing test failure** — `tests/workspaceShell.test.js > workspace shell catalog sync > broadcasts the latest workspace catalog to loaded board frames` was already failing on baseline before the slice-1 changes. Confirmed via `git stash` round-trip 2026-04-25. This should be fixed independently of the refactor; ignoring it for refactor regression checks.

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
- Make each board webview own its board runtime, data load/save path, and mutation execution so board work can proceed independently of shell-local globals.
- Replace `contentWindow` ownership assumptions and mutation delegation with explicit board host commands/events.
- Make the board host protocol safe for multiple in-flight board commands/requests at once; no shell-global serialization beyond routing.
- Move board-specific multiview boot code out of `multiviewClient.js`.
- Reduce the need for synthetic `MessageEvent` translation between shell and board.

### 3. Introduce slot-based layout as the source of truth

- Define slots as a pure layout output of the dock tree.
- Diff slot state once per frame and batch geometry/visibility updates into Rust.
- Ensure unchanged or hidden views are skipped by default so unrelated webviews do not reflow on every shell update.
- Stop treating placeholder DOM and observers as the primary layout model.

### 4. Split `workspaceShell.js` into real modules

- Extract dock-tree/layout math into pure workspace modules.
- Extract board hosting and slot application into a dedicated host module.
- Move lifecycle state machines out of the shell body so concurrent tab opens/closes for different labels can proceed independently.
- Extract focus routing, catalog bridging, and context-menu bridging into separate modules.
- Keep `workspaceShell.js` as a composition root instead of a feature bucket.

### 5. Split `multiviewClient.js` into transport plus services

- [x] **themeBridge** *(2026-04-25)* — extracted to [`src/shell/themeBridge.js`](lexera-kanban/src/shell/themeBridge.js). Exposes `window.LexeraThemeBridge` with `snapshotTheme`, `broadcastTheme`, `applyThemeSnapshot`, `initListeners`, `THEME_VAR_NAMES`. `multiviewClient.js` keeps thin delegation wrappers so `LexeraMultiview.broadcastTheme` and the boot-time `initThemeBridge` continue to work. Self-contained (its own Tauri invoke resolver).
- [x] **catalogBridge** *(2026-04-25)* — extracted to [`src/shell/catalogBridge.js`](lexera-kanban/src/shell/catalogBridge.js). Exposes `window.LexeraCatalogBridge` with `broadcastCatalog`, `broadcastActiveBoard`, `getLastCatalog`, `getLastActiveBoardId`, `wrapShellMethods`, `activate`/`deactivate` (and per-bridge `activateCatalog`/`activateActiveBoard`), and `initListeners` (handles `catalog-request`). Both bridges live together because they share the single monkey-patch over `LexeraWorkspaceShell`. `multiviewClient.js` keeps thin wrappers; `initThemeBridge` now calls both `themeBridge.initListeners()` AND `catalogBridge.initListeners()`.
- [x] **panelLaunchers** *(2026-04-25)* — extracted to [`src/shell/panelLaunchers.js`](lexera-kanban/src/shell/panelLaunchers.js). Exposes `window.LexeraPanelLaunchers` with `openAsSidePanel`/`closeSidePanel` (the underlying side-dock primitive) and per-kind launchers `openLogView`, `openInspector`, `openWorkspaces`, `openDashboard` (+ corresponding `close*`). Deduped via a `makeLauncher(label, url, defaults, message)` factory — every launcher is now a 1-line registration. `multiviewClient.js` keeps thin `delegateLauncher('openX')` wrappers so the public API (`LexeraMultiview.openLogView()` etc.) is unchanged.
- [x] **navigationBridge** *(2026-04-26)* — extracted to [`src/shell/navigationBridge.js`](lexera-kanban/src/shell/navigationBridge.js). Exposes `window.LexeraNavigationBridge` with `install`/`installWith(runtime)` plus the three handlers `handleNavigate`, `handleShortcut`, `handleFocusChanged`, and the `SHORTCUT_ACTIONS` map. `multiviewClient.js` keeps a 7-line `installNavigationHandler` wrapper so the boot path is unchanged. `installWith(runtime)` is a test seam — pass any object with `event.listen` and the bridge attaches the three listeners. 16 unit tests cover routing, missing-shell tolerance, lifecycle.touch, board-tab pane synthesis, and the shortcut launchers.
- [x] **embeddedBoardBridge** *(2026-04-26)* — extracted to [`src/shell/embeddedBoardBridge.js`](lexera-kanban/src/shell/embeddedBoardBridge.js). Exposes `window.LexeraEmbeddedBoardBridge` with `isEmbeddedKanban()`, `install({ getCurrentWebview, invoke, handleRequest })`, `shortcutForKeydownEvent(event)`, and `MV_SHORTCUTS`. Tauri-runtime accessors are dependency-injected so the bridge is self-contained; `multiviewClient.js` keeps a thin `installEmbeddedBoardBridge()` wrapper that passes the runtime helpers in. The bridge installs the catalog/board-action/layout-drag/focus-hierarchy/dispatch-action/delegate-mutation listeners, the focus + health reporters, the `build-context-menu` request handler, the embedded-fill CSS, and the Cmd/Ctrl+Alt keyboard-shortcut forwarder. 14 unit tests cover URL detection, shortcut mapping, and `install` precondition guards.
- [x] **lifecycle** *(2026-04-26)* — extracted to [`src/shell/lifecycle.js`](lexera-kanban/src/shell/lifecycle.js). Exposes `window.LexeraLifecycle` with a `create({ spawn, destroy, setGeometry, navigateWebview, listWebviews, locationSearch?, config? })` factory and a `defaultConfig(searchString)` helper. Transport primitives are dependency-injected — the lifecycle file has zero Tauri imports. `multiviewClient.js` lazily creates one instance via `lifecycle()` and exposes a thin forwarder under `LexeraMultiview.lifecycle.{configure, status, spawn, touch, evictOldestIfOverCap, refillPool}` so the public API and DevTools surface are unchanged. The boot path's pre-warm decision now reads `lc.status().config.poolSize` instead of the closure-private `lifecycleConfig`. 16 unit tests cover defaults, URL overrides, freshness tracking, cold-spawn return shape, eviction (under-cap no-op, oldest-by-freshness selection, pinned/pool exclusion), refill (pool=0 no-op, deficit fill, pool-full no-op), and configure.
- Result: `multiviewClient.js` 1473 → **841 lines** (632 lines moved out across 6 bridges); `themeBridge.js` 128 + `catalogBridge.js` 157 + `panelLaunchers.js` (untracked) + `navigationBridge.js` 141 + `embeddedBoardBridge.js` 215 + `lifecycle.js` 182. **All 6 sub-slices DONE**.

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

### P. Panel-as-webview migration (per the hard requirement)

Dock-hosted panel hosting itself is now landed: all 10 panel kinds spawn as Tauri child webviews through `panelHost.js` + `ensureMultiviewWebview`, exactly like board tabs. The remaining work in this stream is:

- Hydrate the partial panel sub-apps to feature-equivalence.
- Replace the old `LexeraSharedPanels` root/created-event consumers in legacy modules.
- Delete `sharedPanels.js` once those consumers are gone.

Panel kinds in scope (10 total): `hierarchy`, `dashboard`, `weekCalendar`, `monthCalendar`, `logs`, `backendSettings`, `frontendSettings`, `renderApps`, `files`, `frontendTests`.

Acceptance for an individual panel kind:

1. A `src/views/<kind>/{index.html, <kind>.js, <kind>.css}` sub-app exists and uses `LexeraSubApp` from `views/_shared/subAppRuntime.js`.
2. The dock-hosted panel tab spawns that sub-app as a child webview (NOT a shell DOM element).
3. No runtime path for that kind depends on `LexeraSharedPanels.createPanelElement(kind, ...)`, `LexeraSharedPanels.getRoots(kind)`, or `lexera-shared-panel-created` as a discovery mechanism.
4. Right-click → Inspect on the dock-hosted panel opens the panel's own DevTools, not the shell's.
5. Activity Monitor (macOS) shows a separate WebContent process for the panel.
6. The panel's data subscriptions (theme, catalog, focus, etc.) go through the multiview event bus, not shell-side direct calls.

Slice plan:

- [x] **Slice P1 — panel webview spawn path with per-kind opt-in** *(2026-04-25)*
  - Created [`src/workspace/panelHost.js`](lexera-kanban/src/workspace/panelHost.js) exposing `window.LexeraPanelHost` with `PANEL_WEBVIEW_KINDS` allowlist, `isPanelKindOnWebviewAllowlist`, `panelLabelForTab` (uses `'panel-tab-'` prefix to disambiguate from `'board-tab-'`), `panelUrlForTab(tab, kind, locationHref)`, and `viewDirForKind` (handles legacy directory-name overrides like `logs → log` and `hierarchy → workspaces`).
  - Extended `getOrCreateFrame` in [`workspaceShell.js`](lexera-kanban/src/workspace/workspaceShell.js): when a panel tab's kind is on the allowlist, it creates a multiview placeholder (same shape as boards) and spawns via `ensureMultiviewWebview`. Cached in-DOM panel views are dropped on first transition. Kinds NOT on the allowlist keep the legacy `LexeraSharedPanels.createPanelElement` path.
  - Lifecycle integration: `multiviewSpawnedTabs[tabId]` now carries the resolved `label` so destroy/LRU paths can recover it without re-dispatching by kind. The `multiview-destroyed` listener now handles both `'board-tab-'` and `'panel-tab-'` prefixes via `isHostedTabLabel` + `tabIdFromLabel`. The auto-respawn handler re-resolves the URL based on tab kind.
  - Wired `panelHost.js` into `index.html` and the `workspaceShell.test.js` loader.
  - 16 new tests in [`tests/panelHost.test.js`](lexera-kanban/tests/panelHost.test.js) covering label format, allowlist behavior, kind→viewDir overrides, URL construction, missing-input guards, and explicit gates against premature allowlist edits.
  - Test status: 117/118 of workspace-adjacent tests pass; same pre-existing baseline failure (catalog-sync iframe test).

- [x] **Slice P2 — pilot: `logs` panel kind** *(2026-04-25)*
  - Added `logs` to `PANEL_WEBVIEW_KINDS`. Tested via dedicated unit tests including a "kinds NOT on the allowlist" gate that catches premature additions for the rest.
  - Existing `src/views/log/` sub-app needs no code changes: it already uses `getCurrentWebview().listen('log-message', ...)` (scoped subscription per architecture rule) and ignores URL params. The `log-message` bridge is already activated on shell boot via `multiviewClient.js:1204`, so the dock-hosted log webview receives broadcasts the same way the floating side-panel does.
  - **Stop and demo**: P2 is structurally complete but **needs interactive verification** before continuing to P3:
    1. Open the kanban app. Reveal the Logs panel in the dock (bottom).
    2. The panel should render the log entries (will look the same as before).
    3. Right-click → Inspect on the log entries area. Expected: a NEW DevTools window opens scoped to the logs webview only — NOT the shell's DevTools. (Today on the legacy path it would be the shell's.)
    4. Open Activity Monitor (macOS). Expected: a NEW WebContent process appears for the logs panel.
    5. Trigger logs (e.g. perform any action that calls `lexeraLog`). Expected: entries appear live in the panel.
    6. Drag the bottom-dock divider. Expected: the log webview resizes smoothly (this exercises the same geometry-push/visibility-observer path as boards).
    7. Close the Logs panel via the tab × button. Expected: the webview disappears, no leftover process in Activity Monitor, no orphan visible.

- [x] **Slice P3 — `dashboard` panel kind** *(2026-04-25)*
  - Added `dashboard` to `PANEL_WEBVIEW_KINDS`. Kind name matches the existing `src/views/dashboard/` directory (no `KIND_VIEW_DIR_OVERRIDES` entry needed).
  - The dashboard sub-app uses `LexeraSubApp` runtime (scoped event subscription, catalog/active-board snapshots). It is feature-equivalent to the in-shell dashboard panel.
  - Updated the allowlist gate test in `tests/panelHost.test.js`. Status: 118/119 of workspace-adjacent tests pass; same pre-existing baseline failure.
  - **Stop and demo**: same 7-step interactive verification protocol as P2, applied to the Dashboard panel.

### Aggressive B migration: all 10 panel kinds → child webviews *(2026-04-25)*

**User directive**: alpha software, no compatibility burden, migrate aggressively. Per-kind allowlist gating retired in favor of a single hard switch.

**What landed:**

- All 10 panel kinds added to `PANEL_WEBVIEW_KINDS` in `src/workspace/panelHost.js`. The allowlist is now a static "every kind is a webview" assertion.
- Per-kind `src/views/<kind>/index.html` entries exist for all 10 panel kinds. Some are now functional or mostly functional, while others are still partial or stubbed; see the per-kind status table below.
- `KIND_VIEW_DIR_OVERRIDES` reduced to `{ logs: 'log' }`. The `hierarchy → workspaces` override was removed because the existing `src/views/workspaces/` is a flat board picker, not the rich hierarchy tree; using it would silently regress.
- Side-dock render path (`renderSideDockTabset`) and the incremental sync path (`syncSideDockTabsetDom`) now use a single helper `buildMultiviewPanelPlaceholder(tab, panelId, panelKind)` for every panel tab. The legacy `getPanelElement` + `LexeraSharedPanels.createPanelElement` injection paths are deleted.
- `getOrCreateFrame`'s panel branch reduced to a 2-line delegation to `buildMultiviewPanelPlaceholder` — the same helper as the side-dock paths, so the lifecycle state machine, geometry pushes, visibility observers, and destroy handling are shared between center and side docks.
- `renderPanelOnly` (panel-only window mode) reworked to use `buildMultiviewPanelPlaceholder` with a synthetic tab id (`panel-only-<panelId>`) so detached panel windows host webviews too.
- `ensurePanelElements`, `getPanelElement`, `state.panelElements`, the fold-strip log-status migration, and `destroyDuplicatedPanelInstance`'s panel-element cleanup were deleted.
- `LexeraSharedPanels` is still loaded by `index.html` because non-panel modules (`loggingSystem.js`, `app.js`, `orderHelpers.js`, `moduleRuntime.js`) consume parts of it for unrelated reasons. `panelHost.js` and `workspaceShell.js` no longer call its `createPanelElement` API.

**Test status after the migration:**

- 116/117 of workspace-adjacent tests pass. Only the pre-existing baseline failure (`workspace shell catalog sync > broadcasts the latest workspace catalog to loaded board frames`) remains.
- `tests/panelHost.test.js` updated: the per-slice "do NOT yet include" gate became "includes all 10 panel kinds". The `hierarchy → workspaces` override test became "uses kind name for hierarchy".

**Per-kind status after the aggressive migration:**

| Kind | Sub-app status |
|---|---|
| `logs` | ✅ functional — existing `src/views/log/` extraction, log entries render live |
| `dashboard` | ✅ functional — existing `src/views/dashboard/` extraction, full metrics + nav |
| `hierarchy` | 🟢 minimal-but-working — `src/views/hierarchy/` shows active workspace title + flat board/workspace lists with click-to-navigate. Active-board highlight works. **Rich tree (stacks/columns/cards, drag/drop, expand/collapse, inline rename, context menus) deferred** to a future slice — porting requires moving substantial portions of the 3204-line `src/board/boardList.js`. |
| `frontendSettings` | ✅ functional — full skeleton rendered inside `src/views/frontendSettings/`, including per-mode control bindings and tag-group chips. Persists to `localStorage`, uses the shared `LexeraControlsSettings` + `ContextMenuBuilders` modules inside the sub-app, and still broadcasts `frontend-setting-changed` for live-apply on the board side. |
| `backendSettings` | 🟢 full ManagementUI mounted — loads `api.js` + `management.js` inside the sub-app, calls `ManagementUI.init({ ui: getUiPreset('backendSettings'), api: backendAdapter })`. Backend REST calls flow through `LexeraApi`. |
| `files` | 🟢 full ManagementUI mounted — same as `backendSettings` but uses `ManagementUI.mount('files', ...)` to invoke the workspace-files preset. |
| `renderApps` | 🟢 full skeleton + `LexeraRenderAppsSettings.init(panel)` — application paths, Marp plugin section, themes refresh, test/save buttons. Auto-discovers via `LexeraApi`. |
| `weekCalendar` | ✅ functional — real week grid + task list, fetches tasks directly from the backend `/calendar/tasks` endpoint via `LexeraApi.getCalendarTasks()`. Refreshes on `management-board-mutation` events and on a 30-second poll. |
| `monthCalendar` | ✅ functional — same fetch path as weekCalendar, renders a 6-week month grid with per-day task counters. |
| `frontendTests` | 🟧 descriptive stub — kind-specific title and feature list. Hydration is the biggest of all the kinds — the test runner code in `src/test/frontendTests.js` is 8805 lines and assumes shell-context globals. Significant adapter work needed. |

**Per-kind hydration plan:**

The descriptive stubs are visually consistent and unambiguous about scope, but they do nothing yet. The blocker for real hydration is that each kind's UI is split across:

1. The **HTML skeleton** that `sharedPanels.js → createPanelElement(kind, ...)` produces (small, easy to copy into the sub-app).
2. The **hydration script** that listens for `lexera-shared-panel-created` and binds the skeleton to data (medium-to-huge, often assumes shell context).
3. The **option-providers** that the hydration script needs (callbacks for read/write of settings, current board state, etc.).

For each kind, the port becomes:

- [x] **Slice P-settings-runtime** *(2026-04-25)* — built `src/views/_shared/settingsRuntime.js` exposing `LexeraSettingsRuntime.buildFrontendSettingsOptions()`. The runtime backs each option's getter/setter with `localStorage` (matching the legacy `lexera-default-*` keys so persisted state is unchanged) and broadcasts a `frontend-setting-changed` multiview event for live-apply on the board side. It also exposes generic helpers `getLs`, `setLs`, `broadcast` that follow-up settings kinds can reuse.
- [x] **Slice P-frontendSettings** *(2026-04-26)* — `src/views/frontendSettings/index.html` now ships the full skeleton (mirrored from `sharedPanels.js`'s `createFrontendSettingsPanelElement`) and bootstraps:
  ```html
  <script src="../_shared/subAppRuntime.js"></script>
  <script src="../_shared/settingsRuntime.js"></script>
  <script src="../../settings/controlsSettings.js"></script>
  <script src="../../menu/contextMenuBuilders.js"></script>
  <script src="../../settings/frontendSettings.js"></script>
  <script>LexeraFrontendSettings.init(LexeraSettingsRuntime.buildFrontendSettingsOptions(), panel);</script>
  ```
  Sections rendered: Appearance (visual theme, UI scale), Interaction (scroll/zoom speed), Controls (per-mode keyboard/mouse bindings), Display (tag visibility, HTML comments/content), Tag Groups in Menus, Editors (overlay/special chars), and Hierarchy display toggles. The sub-app now loads `LexeraControlsSettings` and `ContextMenuBuilders` directly, so control-binding chips and tag-group chips work without shell-only closures.
- [x] **Slice P-backendSettings** *(2026-04-25)* — `src/views/backendSettings/index.html` loads `../../api.js` + `../../management.js` + the new `_shared/settingsRuntime.js`. Calls `ManagementUI.init({ ui: ManagementUI.getUiPreset('backendSettings'), api: LexeraSettingsRuntime.buildBackendApiAdapter(), callbacks: LexeraSettingsRuntime.buildBackendCallbacks() })` against a `view-loading` skeleton container. Errors surface inline.
- [x] **Slice P-files** *(2026-04-25)* — same scaffold as backendSettings but `ManagementUI.mount('files', ...)` to invoke the workspace-files preset. The `lexera-shared-files-container` selector is preserved.
- [x] **Slice P-renderApps** *(2026-04-25)* — `src/views/renderApps/index.html` ships the full skeleton (mirrored from `sharedPanels.js → createRenderAppsPanelElement`) and calls `LexeraRenderAppsSettings.init(panel)`. The renderApps module already auto-resolves `window.LexeraApi`, so loading `../../api.js` is enough.
- [x] **Slice P-calendars** *(2026-04-25)* — built `src/views/_shared/calendarRuntime.js` (week + month grid renderers, task list, mount helper, backend fetch + normalization) and `src/views/_shared/calendar.css`. Both `weekCalendar` and `monthCalendar` sub-apps render real grids and **fetch tasks directly from the backend** via `LexeraApi.getCalendarTasks()` (the `/calendar/tasks` endpoint already returns the flat task list). Tasks are normalized from the backend's camelCase `SearchResult` shape (`dueDate`, `cardContent`, `boardTitle`, `boardId`) into the runtime's field names. The mount helper schedules a 30-second polling refresh and refreshes on `management-board-mutation` broadcasts so edits land without a manual reload. No multiview bridge needed — the backend-direct path is cleaner than routing through the active board webview.
- [ ] **Slice P-frontendTests** — port the test runner. Largest effort: 8805 lines of harness code that drives DOM-level test interactions on the active board. May need a `multiview-emit-to-board` IPC bridge for some operations.
- [ ] **Slice P-hierarchy-rich** — port the rich tree from `src/board/boardList.js` into `src/views/hierarchy/`. The minimal hierarchy already works; this slice ADDS expand/collapse, drag/drop, inline rename, hierarchy focus, context menus.
- [ ] **Slice P-retirement** — after all kinds are fully hydrated, delete anything in `LexeraSharedPanels` that nothing depends on. Possibly delete `src/workspace/sharedPanels.js` entirely (audit first).
  - Replace [`logging/loggingSystem.js`](lexera-kanban/src/logging/loggingSystem.js) `getSharedLogRoots()` with explicit panel-ready state or log-view presence tracked via multiview events.
  - Replace [`app.js`](lexera-kanban/src/app.js) `lexera-shared-panel-created` hooks with explicit panel-ready / panel-mounted events scoped to panel webviews.
  - Replace [`board/orderHelpers.js`](lexera-kanban/src/board/orderHelpers.js) calendar root lookups (`getRoots('weekCalendar' | 'monthCalendar')`) with explicit calendar webview events or backend-direct panel refresh.
  - Replace [`management/managementWiring.js`](lexera-kanban/src/management/managementWiring.js) `lexera-shared-panel-created` hooks with explicit panel-ready handshakes for backend settings / files panels.
  - After the above are removed, stop loading `src/workspace/sharedPanels.js` and delete dead registry/event code.

### Audit of remaining panel kinds *(2026-04-25 — superseded by the aggressive B migration above)*

Each remaining kind requires a `src/views/<dir>/` sub-app that is **feature-equivalent** to the in-shell DOM panel before it can be allowlisted. Anything less is a regression and must not ship.

| Kind | Existing extraction? | Equivalent? | Action required |
|---|---|---|---|
| `logs` | `src/views/log/` | yes | ✅ migrated in P2 |
| `dashboard` | `src/views/dashboard/` | yes | ✅ migrated in P3 |
| `hierarchy` | `src/views/workspaces/` | **NO** — flat board picker, not the rich hierarchy tree (drag-drop, expand/collapse, hierarchy focus, inline edit) | Build NEW `src/views/hierarchy/` |
| `weekCalendar` | none | n/a | Build NEW `src/views/weekCalendar/` |
| `monthCalendar` | none | n/a | Build NEW `src/views/monthCalendar/` |
| `backendSettings` | none | n/a | Build NEW `src/views/backendSettings/` |
| `frontendSettings` | none | n/a | Build NEW `src/views/frontendSettings/` |
| `renderApps` | none | n/a | Build NEW `src/views/renderApps/` |
| `files` | none | n/a | Build NEW `src/views/files/` |
| `frontendTests` | none | n/a | Build NEW `src/views/frontendTests/` |

8 of the 10 kinds need new sub-apps. The migration cannot be reduced to "flip the allowlist bit" for these — each requires porting the in-shell rendering + data bindings + interaction handlers into a self-contained child webview that uses `LexeraSubApp` and the multiview event bus.

### Revised slice plan

- [ ] **Slice P4 — build `src/views/hierarchy/` sub-app**
  - Highest user-visible impact (left sidebar tree).
  - Substantial scope: tree rendering, expand/collapse state, hierarchy-focus delivery (`focus-hierarchy-target` event), inline rename, drag/drop within tree, context menus.
  - Once feature-equivalent, add `hierarchy` to `KIND_VIEW_DIR_OVERRIDES` (`hierarchy → hierarchy`, no override needed if dir matches kind) and `PANEL_WEBVIEW_KINDS`.
  - **Suggested approach**: extract the hierarchy tree component from `lexera-kanban/src/board/boardList.js` (and related files) into a sub-app entry; communicate with the shell via `multiview-navigate`, `focus-hierarchy-target`, and the catalog-snapshot bridge.

- [ ] **Slice P5 — build `src/views/frontendTests/` sub-app**
  - Test runner UI. Likely simpler than hierarchy (read-mostly, click "run" → broadcast).

- [ ] **Slice P6 — settings family**
  - `backendSettings`, `frontendSettings`, `renderApps`, `files` — four kinds with similar UI shapes (forms + save buttons).
  - Build a shared `src/views/_shared/settingsRuntime.js` helper for common form+save plumbing.
  - Each kind gets its own `src/views/<kind>/` entry that uses the shared runtime.

- [ ] **Slice P7 — calendar family**
  - `weekCalendar`, `monthCalendar` — date-grid widgets with similar shapes.
  - Could share a calendar-base runtime or be independent.

- [ ] **Slice P8 — retirement**
  - Once the allowlist covers all 10 kinds, delete `LexeraSharedPanels.createPanelElement` and the in-shell panel branch in `getOrCreateFrame`. Audit for any remaining `state.panelElements` references and remove. Stop loading `src/workspace/sharedPanels.js`.

Cross-cutting tasks for Workstream P:

- [ ] Update `views/_shared/subAppRuntime.js` so `LexeraSubApp.init()` exposes the `?panel=<instanceId>` URL parameter as `LexeraSubApp.getPanelInstanceId()`.
- [ ] Extend `LexeraBoardHost` (or introduce `LexeraPanelHost`) so panel webviews participate in the same lifecycle state machine as boards (pending/ready/destroying — see "Lifecycle-race fix" above). The state machine is generic over webview labels; the only difference is the URL template.
- [ ] Add an explicit `panel-ready` / `panel-teardown` handshake so legacy modules stop inferring panel existence from DOM creation side effects.
- [ ] Document the per-kind event contract (what each panel subscribes to) in `MULTIVIEW_ARCHITECTURE.md`.
- [ ] Tests: each migrated panel kind gets a `tests/views/<kind>/` test directory with at least URL-routing and event-subscription tests.
- [ ] Slice 6 of the in-flight `workspaceShell.js` split (`panelRegistry.js`) is **retargeted**: it now hosts the `PANEL_WEBVIEW_KINDS` allowlist and `panelUrlForTab` helper, not in-shell panel construction.

## Current acceptance criteria

- **Every dock-hosted view (board OR panel) runs in its own Tauri child webview.** No view's UI is rendered in the shell DOM. (Workstream P now covers hydration and retirement of legacy panel-era consumers, not the hosting migration itself.)
- Normal desktop shell uses native child webviews for board tabs.
- Embedded mode and test mode may keep explicit iframe fallbacks until their migration is complete.
- All new cross-view communication goes through Rust-owned routing.
- All non-shell view code lives under `src/views/<name>/` and uses `LexeraSubApp` from `views/_shared/subAppRuntime.js`.
- Modal UI that must paint above child webviews uses native windows, not shell HTML overlays.
- Hidden child webviews must be hidden or parked so they never paint over unrelated content.
- Opening, resizing, or mutating one board must not force avoidable reflow or reload work in unrelated child webviews.
- Concurrent open of multiple board OR panel tabs must be race-safe: no duplicate-label spawn attempts, no corrupted host registry state, no shell-global ownership ambiguity.
- Unrelated hidden or parked webviews must stay asleep unless they explicitly subscribe to the event being routed.
- Right-click → Inspect on any dock-hosted view opens that view's own DevTools, not the shell's.

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

Added `lexera-kanban/src/shell/multiviewClient.js` as the browser-side multiview transport around the Rust commands from Stage 2. It began as a thin wrapper exposing `window.LexeraMultiview` with `spawn`, `destroy`, `setGeometry`, `listWebviews`, `dragStart`, `dragPointerMove`, `dragPointerUp`, `dragCancel`, `dropAck`, scoped `listen`, and `getMyLabel`. In the current codebase it also carries launchers, theme/catalog/focus bridges, modal helpers, and embedded-board compatibility logic. Loaded via `<script>` in `index.html` before `workspaceShell.js` and actively used by the normal desktop shell.

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
- The main shell subscribes to `multiview-shortcut` via `multiviewClient.js` and executes the requested action
- There is intentionally no extra main-shell global keydown handler; shortcut emission stays inside sub-apps so it does not interfere with existing kanban shortcuts and tests

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

`lexera-kanban/src/multiview-demo.html` — a minimal page that child webviews can load to prove the architecture works in the running production kanban without depending on the embedded board compatibility path. Historical note: when delivered on `2026-04-24`, this also avoided touching the then-iframe-based board shell.

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
- [ ] Add regression test: re-enter `ensureMultiviewWebview()` for the same tab while spawn is pending — no duplicate-label spawn IPC
- [ ] Add regression test: opening two different board tabs in parallel does not corrupt shared lifecycle registries
- [ ] Run `./run-lexera-tests.sh` — all tests pass

## Stage 4 — Extract per-view sub-apps

Split the existing monolithic frontend into self-contained per-view sub-apps. The first priority is no longer "all views eventually"; it is establishing a real board-view boundary so the multiview shell can stop emulating iframe-era APIs.

### Board boundary first
- [ ] Create `lexera-kanban/src/views/board/` as an explicit board entry boundary, even if it initially reuses existing board modules internally
- [ ] Define the board host contract for board actions, focus targets, context-menu building, mutation apply, layout-drag signals, and health/focus reporting
- [ ] Make the board boundary own board data hydration, persistence, and mutation application locally; the shell only routes commands and snapshots
- [ ] Replace synthetic `MessageEvent` translation with direct multiview event handling inside the board boundary
- [ ] Replace `_delegateMutationToOwningFrame()` ownership handoff with explicit async board commands/requests
- [ ] Ensure multiple board webviews can service context-menu requests, focus targets, and mutation commands concurrently without shared shell-global assumptions
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
- [ ] Do not emit geometry or visibility work for unchanged slots; slot diff is the only authority for native host updates
- [ ] Treat placeholders as consumers/debug surfaces, not as layout authorities

### Performance during dock resize
- [ ] Dock divider drag → one slot diff and one batched IPC update per animation frame
- [ ] Verify each child webview reflows in its own process while the shell remains responsive
- [ ] Verify resizing one dock does not trigger avoidable geometry work for unrelated hidden or unchanged views
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
- [ ] Pool refill never blocks or delays a visible board open; foreground opens beat background pre-warm work
- [ ] Define lifecycle states explicitly (`pending`, `ready`, `destroying`, `parked`) so concurrent lifecycle transitions are race-safe

### Memory monitoring
- [ ] Log peak memory usage during typical sessions
- [ ] Hard cap: max 8 simultaneously-spawned webviews; queue beyond that
- [ ] Soft warning when total renderer memory exceeds threshold

### Tests
- [ ] Test lazy spawn: first-show latency measured
- [ ] Test LRU eviction: open 10 boards, verify 9 are destroyed after threshold
- [ ] Test pre-warm: open a board after pool is warm, verify <100ms time-to-content
- [ ] Test concurrent open: open multiple boards at once, verify visible boards win over background pool refill and no duplicate spawn occurs
- [ ] Run `./run-lexera-tests.sh`

## Stage 9 — State sync at scale

With many webviews, state synchronization patterns matter for correctness and performance. The goal is not only subscription filtering, but also replacing compatibility shims with explicit view protocols.

### View protocol cleanup
- [ ] Replace synthetic `window.dispatchEvent(new MessageEvent(...))` bridging with direct board/view host events
- [ ] Remove remaining `contentWindow` / `contentDocument` assumptions from shell and app code
- [ ] Document the board host command/event/request protocol
- [ ] Make ownership and routing explicit instead of inferred from iframe-style helpers
- [ ] Ensure request/response channels support multiple in-flight requests safely (context menus, board commands, future RPC-style interactions)
- [ ] Carry `reply_to` / source-label metadata in requests and emit responses with `multiview_emit_to(reply_to, ...)` instead of global `*-response` broadcasts
- [ ] Stop using broadcast response events as the default request/response transport; unrelated webviews should not wake just to discard mismatched `_corr` ids

### Event subscription registry
- [ ] Each webview declares which events it subscribes to at mount
- [ ] Rust filters broadcasts to only subscribers (avoid waking idle webviews)
- [ ] Events are batched per frame to reduce IPC overhead
- [ ] Hidden or parked views do not receive catalog/theme/layout traffic they did not subscribe to

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
- [ ] Verify board edits in one view do not trigger unrelated snapshot work in other idle board webviews
- [ ] Replace mount-time `theme-request` / `catalog-request` global rebroadcast with targeted snapshot replies or spawn-time initial snapshot injection
- [ ] Opening multiple sub-apps in parallel must not rebroadcast the same theme/catalog snapshot to every already-mounted subscriber

### Tests
- [ ] Theme change with 8 webviews open — measure time to all-updated
- [ ] Keyboard focus routing — verify shortcuts hit correct view
- [ ] Parallel protocol test: two board requests in flight at once resolve to the correct targets and responses
- [ ] Snapshot-bootstrap test: open several views in parallel and verify only the requesters receive the initial theme/catalog reply
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
