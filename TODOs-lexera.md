## Workflow

Work on the tasks below. For each: fix, add tests, verify with `run-lexera-tests.sh`. Move completed items to [todo-archive.md](todo-archive.md). Check general architecture and improve it. If performance drops, prioritize performance work.

Keep this file structured and clean:
- Only open and in-progress items live here. Completed items go to [todo-archive.md](todo-archive.md).
- Group tasks under the appropriate `###` section. Don't add tasks as loose items outside a section.
- One task per line. Keep descriptions concise — details belong in code comments or commit messages.
- Update the test status line below after each test run.

To mark a task in progress add (in progess) at the start of the task (just after the - [ ])
To mark a task done add (done) at the start of the task and mark the task done (- [x])
To mark a task with input required add (input required) at the start of the task!

Generally do the most time consuming tasks first. If a task takes very long to complete, start it early to finish early, DO NOT DELAY LONG TASKS!

**Test status: full lexera-kanban vitest: 1981 passed, 0 failed, 2 skipped (157 files, ~20s) — fully green as of 2d6b8044. Cargo check on `lexera-kanban/src-tauri` is clean.**

## Open Tasks

### Multi-Window Structural Improvements

- [x] ~~**DragState + drag-ghost are per-process singletons** — `Mutex<Option<ActiveDrag>>` allows only one drag in the entire app; drag in window B errors out or stomps window A's state. Drag-ghost screen-position math uses hardcoded `app.get_webview_window("main")`, so dragging from window B paints the ghost at window A's offset (off-screen / wrong monitor). Fix: key `DragState` by source webview's parent-window label, resolve ghost position from the caller's window.~~ — a2602fae (DragState now `Mutex<HashMap<String, ActiveDrag>>` keyed by source webview's parent window label. All four drag commands (start / pointer_move / pointer_up / cancel) take injected `caller: tauri::Webview` and look up that window's slot. drag-ghost screen coords resolved from `caller.window().outer_position()` instead of hardcoded "main". 5 contract tests pin the shape + each call site.)

- [x] ~~**FocusTracker is a process-singleton** — `Mutex<Option<String>>` tracks one globally-focused webview. Window B's shell calling `multiview_get_focused()` can return a label from window A. Fix: `Mutex<HashMap<window_label, Option<webview_label>>>` keyed by parent window; `multiview_get_focused` reads the caller's window's slot.~~ — 8978535c (FocusTracker now `Mutex<HashMap<String, Option<String>>>`. set_focused resolves parent window from the affected webview; get_focused takes injected caller and returns its window's slot. 5 contract tests pin the shape + each call site.)

- [x] ~~**Window-close cleanup is incomplete** — `main.rs` `CloseRequested` purges only `SubscriptionRegistry` for dead labels. `FocusTracker` and `HealthTracker` keep stale entries indefinitely. Extend the existing block to clean both.~~ — 8978535c (added `HealthTracker::drop_labels(dead_labels)` and `FocusTracker::drop_window(window_label)`. CloseRequested now invokes all three (Subscription / Health / Focus). Pinned by oneWindowPerWorkspaceContract.)

- [x] ~~**MarpWatchState collisions across windows** — `HashMap<watch_path, pid>` is global, so two windows watching the same file orphan the first window's process. Fix: key by `(window_label, watch_path)` or refuse the second watch.~~ — 939d1179 (`HashMap<(window_label, input_path), pid>`. All 3 commands take caller and key on its window. `marp_stop_watch(pid=N)` verifies the PID belongs to the calling window before killing. `marp_stop_all_watches` is now per-window (was process-wide). New `stop_window` helper, wired into `CloseRequested`. 6 contract tests.)

- [x] ~~Modal result routing leaks across windows on label collision + `multiview_list_health` returns sibling windows' health entries~~ — f0be716a (modal labels now embed parent webview label `confirm-modal-<parentLabel>-<counter>`, modal HTML routes the result via `multiview_emit_to(parentLabel, …)` so it reaches only the opener; `multiview_list_health` filters to `caller.window().webviews()`. Backfilled with contract tests in 9fa9a788.)

- [x] ~~Modal windows are orphan top-level windows with no parent — they float above EVERY open window and (on macOS) drag focus across windows~~ — 550b2054 (`multiview_open_modal_window` takes injected caller, calls `builder.parent(&parent_window)` so OS groups the modal with its opener and auto-closes on parent close. 2 contract tests pin the caller injection + .parent attachment.)

- [x] ~~Layout settings saved per workspace, not per window~~ — 5a3f0a25 (`layoutPersistence.getPersistenceKey()` now returns `lexera-workspace-shell:ws:<workspaceId>` when `?workspace=` is set, so two windows pinned to the same workspace share one saved layout (last save wins) and reopening a workspace later restores the same dock tree. Falls back to per-window key for the boot main window before catalog hydrate and for detached panel-only windows. Storage rule: workspace-pinned + main → localStorage; transient secondary windows without a workspace → sessionStorage. 8 new tests in `layoutPersistence.test.js` cover keying, hooks override seam, and storage choice.)

- [x] ~~**Fix Event Scoping in `embedMenu.js`:** Update `LexeraEmbedMenu.tauriListen` to use the current webview's scope instead of `{ kind: 'Any' }`. This will prevent events like `menu-action` from leaking across windows.~~ — 849935ce (target now `{ kind: 'WebviewLabel', label: getCurrentWebview().label }`, falls back to `Any` if the webview API isn't yet ready at boot. 3 tests pin the new shape + the fallback path.)

- [x] ~~Per-window state abstraction in `settingsStore` + migrate the leaking UX state keys~~ — 601ebad7 + 0c729251 + b6300922 + ea2e3d57. Added `WINDOW_DEFS` table parallel to `BOARD_DEFS` / `SCOPED_DEFS` with `getForWindow(name)` / `setForWindow(name, value)` / `removeForWindow(name)` and a `_resolveWindowScope()` helper that prefers `?workspace=<id>` (windows pinned to the same workspace share state) and falls back to `?windowLabel=<label>` (unpinned windows isolated). Migrated all UX state keys that were firing cross-window `storage` events: sidebar split-ratio / width / hierarchy lock; dashboard query / scope / pinned / tags / collapsed; log panel categories / levels / search / source. Removed dead `else localStorage.setItem(rawKey, …)` fallback branches in every caller. **Removed `loggingSystem.js`'s cross-window `storage` event listener** (lines 315-333) entirely — it was actively re-applying log filter changes from any window into this one. `localStorageGuardrailContract` allowlist drops `sidebarResize.js` + `loggingSystem.js` (no longer touch raw localStorage). 8 new settingsStore tests pin the per-window keying.

- [x] ~~**Prevent `activeWorkspace` State Leakage:** Update `lexera-kanban/src/core/settingsStore.js` to mark `activeWorkspace` as non-persisted or window-scoped. Currently, `localStorage` writes to this key cause other windows to "yank" to the same workspace.~~ — 4d253fcc (removed the dead `activeWorkspace` DEFS entry + the matching `lexera-active-workspace` registry entry. Writes / reads / storage listener were already gone from prior commits; this closes the loop so the def can't be revived without re-introducing the leak. Pinned via `oneWindowPerWorkspaceContract.test.js`.)
- [x] ~~Hierarchy sub-app: boards listed as "(untitled)"~~ — bc8c02df (swapped fallback order from `board.name || board.title` to `board.title || board.name`; same fix workspaces.js got in ff9cbf03. Pinned by hierarchyView.test.js feeding title-only / name-only / both shapes.)

- [ ] **Hierarchy sub-app: unfold a board to show its rows/stacks/columns/cards (regressed when in-shell `#board-list` was replaced by the child-webview hierarchy panel)** — needs user-confirmed scope. Minimum viable port: (a) sub-app emits `hierarchy-request:<boardId>` event; (b) shell-side bridge calls `LexeraApi.getBoardHierarchy(boardId)` and broadcasts `hierarchy-snapshot` back via `multiview_emit_to`; (c) sub-app renders rows/stacks/columns/cards using the existing `TreeView` module + `buildSidebarTreeNodes` (in `boardList.js`'s `getSidebarTreeApi`). Skips drag/drop, context menus, inline rename — those are separate ports. Estimate ~150 lines + 1-2 contract tests.

- [x] ~~**Enforce Unique Webview Labels:** Modify `boardHost.js` and `panelHost.js` to include a window-unique prefix (e.g., `WORKSPACE_SHELL_BOOT_ID`) in `multiviewLabelForTab` and `panelLabelForTab`. This prevents label collisions and accidental webview "adoption" across windows.~~ — b00bb004 (per-shell `_bootId` stored via `setup({ bootId })`, called by workspaceShell with `WORKSPACE_SHELL_BOOT_ID`. Format `board-tab-<bootId>-<tabId>` / `panel-tab-<bootId>-<tabId>` keeps Tauri's global webview registry collision-free. Inverse helpers `tabIdFromBoardLabel` / `tabIdFromPanelLabel` strip the bootId; consumers in multiviewWebview, navigationBridge, app.js's mutation-delegate path all migrated. 10 contract tests cover both label shapes + a round-trip invariant.)
- [x] ~~**Audit Rust Emissions:** Audit `main.rs` and `webview_mgr.rs` for `app.emit()` calls. Replace global broadcasts with targeted emissions (`window.emit()` or `webview.emit()`) where the event is window-specific (e.g., `menu-action`).~~ — 55af3634 + b6f8821c. Drag events (`drag-began` / `drag-ended`) scoped to source's window. focus-changed / multiview-destroyed / health-changed scoped to affected webview's window via lifted `emit_to_window_of_label` helper. `log-message` left global by design (in-app Log panel reflects activity from any webview). Same commit fixed the 4 hardcoded `app.get_window("main")` lookups in `multiview_destroy` / `multiview_set_geometry` / `multiview_navigate` / `multiview_set_visible` that silently no-op'd for child webviews in secondary windows. 19 contract tests pin the new shape across drag_coordinator + webview_mgr.
- [x] ~~**Verify Isolation:** Create a verification script or automated test that spawns two top-level windows and confirms that switching workspaces or opening boards in one does not affect the other.~~ — 5b944b13 + 47f5cf38 + e3efaa16 + 9940620b (`multiWindowIsolationContract.test.js` — 27 tests across 6 architectural patterns: per-window Rust state shape, dynamic window resolution in lifecycle commands, scoped emit for window-scoped events, bootId-embedded webview labels, full close-cleanup of every Tauri-managed registry, per-window UX state via WINDOW_DEFS. Includes a single-assertion guard listing every required cleanup helper so a future addition that forgets one fails CI cleanly.)

- [x] ~~Audit's deferred LOW-severity items: WebviewRegistry close-cleanup, multiview_get_health caller-window check, StreamRegistry per-window cleanup, SubscriptionRegistry invariants doc~~ — 4320d10c + 868e9507 + e3efaa16 + f3e22cd5 (every shared Tauri-managed `State<T>` now has explicit per-window close-cleanup; defensive caller-checks on health queries; StreamRegistry tracks owner_window and aborts orphan subscriptions on close; SubscriptionRegistry's load-bearing invariants documented at the data-structure definition.)

### Unsorted (leave this header here!)

- [x] ~~when closing windows, it should close the view, but not the application!~~ — bf885953 + 0ca8d259 (every window closes on red-X click — main no longer special-cased to minimise. `RunEvent::ExitRequested` is intercepted on macOS; `USER_REQUESTED_QUIT` atomic flag is set only by `quit_app` (Cmd+Q / File > Quit). Closing the last window keeps the process alive on macOS (menu bar persists, re-openable via File > New Window). On Windows/Linux the intercept is `#[cfg]`-gated out so the platform-conventional exit-on-last-close still applies — once a system tray ships, the cfg can be widened. 6 contract tests pin the new shape.)

- [x] ~~analyze the strucutre of the code why are different views not separated in different windows (different windows can have one or more different or similar boards opened!). where must the data be separated and where must the data be shared (baords in the backend might be modified by multiple windows in the frontend!).~~ — analysis delivered in conversation + archived in memory `project_window_view_data_split.md`. **Three nested view containers**: OS window → child webview (`Window::add_child`, own renderer process) → JS layout-tree tab/leaf. Shell is one webview; every board/panel/dashboard/log/settings view runs in its **own child webview**. **Per-window state (must NOT leak)**: `windowLabel`, `dockTree`, `sideDocks`, `dockSizes`, `panelVisibility`, `activeLeafId`, `activeBoardId`. Layout persists per `windowLabel` (only `main` writes localStorage; secondary windows write sessionStorage — `layoutPersistence.js:50-62`). `Settings.lastBoard` / `Settings.activeWorkspace` are deliberately NOT persisted (c900a0d4 / 84057342 / ebe8e71a) — each window picks initial board from `?board=` URL only. **Shared (single source of truth) = the backend**: one Loro `LiveSession` per `boardId` (`live_sync.rs:11-40`); every window opens its own per-window `liveSyncState` and exchanges Loro updates with that single backend session. Loro CRDT is the merge point; file watcher → SSE replicates board changes to every shell, with self-write suppression and dirty-skip on reload. Shell-broadcast (catalog snapshot, theme palette) is one-way shell → its own children only. **Why views aren't already in separate OS windows**: `open_new_window` exists (accepts board_id / view_kind / panel_kind / workspace_id / origin_window), but the user-facing entry points are only `File → New Window`, `File → Open Workspace ▶ <ws>`, and panel detach. Missing for full per-view-per-window: (a) `tabDragController` only reorders within the four trees of one shell — no "tear off tab to new window" UI; (b) `webview_mgr.rs` destroy/geometry/navigate/visible commands hardcode `app.get_window("main")` (lines 371, 401, 453, 495), so a child webview adopted by a non-main window cannot be torn down by these commands.

- [x] ~~the views show in the wrong window as well!~~ — native menu actions (View > Panels > Dashboard, etc.) were broadcasting to EVERY window via `app.emit("menu-action", …)`, so each click revealed the panel everywhere at once. Now route to the focused window only via `webview_windows().find(is_focused).emit(…)`, with a fallback to broadcast when no window is focused (rare, eg during creation). Pinned by a contract test that fails if the broadcast pattern is reintroduced.

- [x] ~~Open Workspace > X spawns 2+ windows per click~~ — fe2aade6 + dd50c86f (Tauri 2's frontend listener filter `target: { kind: 'Any' }` used by `tauriListen` is a greedy wildcard: `app.emit_to(label, …)` matches every webview that registered such a listener, regardless of label. Result: emitting `menu-action: open-workspace:<id>` reached every webview JS context (shell + child board/panel webviews + every other open window), each with its own `lastOpenWorkspaceWindowRequest` debounce, each spawning a fresh window. **Fix**: handle `open-workspace:<id>` directly in the Rust `on_menu_event` via `open_new_window(workspace_id=…)` — same pattern as `new-window` — and skip the `emit_to` fall-through entirely. Plus `LAST_FOCUSED_WINDOW` Mutex tracker so macOS menu clicks (which transiently move focus to the menu bar, making `is_focused()` return false on every window) still resolve the originating window. Plus `CloseRequested` cleanup that clears `LAST_FOCUSED_WINDOW` if it pointed at the closing window AND drops every webview label of that window from `SubscriptionRegistry` so multiview_broadcast doesn't accumulate stale entries. Contract tests pin the strip_prefix dispatch, the Focused(true) tracker, the close-cleanup cleanup chain, and the no-focus drop fallback.)

- [x] ~~switching boards in one view switches the other view too~~ — ebe8e71a (root cause: `Settings.set('lastBoard', boardId)` was writing the current board to shared `localStorage` on every switch. pollingService cold-start (`!activeBoardId`) read it back, so opening window B *after* window A switched to Z auto-loaded Z too — windows ended up showing the same board even though workspace state was per-window. **Fix**: drop every Settings.set('lastBoard') write (selectBoard, setShellActiveBoard, removeBoard, pollingService board-removed) AND the cold-start Settings.get('lastBoard') read. Each window picks its initial board from `?board=` URL param, falling back to the first available. Contract test pins no writes / no read across all four call sites; orderHelpers test updated to assert localStorage stays null after setShellActiveBoard; pollingService removed from the localStorage allowlist.)

- [x] ~~Delete unreachable ws_header / workspace-section reconciliation in boardList.js~~ — `_createWsHeaderEl`, `_updateWsHeaderContent`, the `ws_header` reconciliation branch in renderBoardList, the workspace-section-focus click router (in both canonical-target lookup AND mirror-event handler), and the now-dead `focusWorkspaceView` function + its export + the `shell.focusWorkspace` adapter + the `'focus-workspace'` navigationBridge case all deleted. ~120 lines of dead code gone.

- [x] ~~Remove the legacy `ALL_WORKSPACES_ID = '__all__'` sentinel and every `isAllView` branch~~ — fully eliminated: constant deleted from `app.js`; `_dep('ALL_WORKSPACES_ID')` references in `boardList.js`/`orderHelpers.js`/`hierarchy.js` all replaced with truthy-checks against the workspace id. `_buildDesiredEntries` collapsed to a single-workspace flat list (no `ws_header` entries, no `__unassigned__` group). hierarchy.js drops the "All Workspaces" picker item; clicking a sibling workspace now spawns a new window via `open-workspace-window`. Sidebar workspace-section drill-down UI removed. `boardListWorkspaceSectionFocus.test.js` deleted (tested dead UX); `boardListLoadingState.test.js`, `views/hierarchy/hierarchyView.test.js`, `frontendTests.js` workspace-sidebar tests, `oneWindowPerWorkspaceContract.test.js` updated to assert single-workspace semantics. Contract test gained an explicit "no codepath references `ALL_WORKSPACES_ID` or `__all__` anymore" guard to prevent regressions.

- [x] ~~the workspace must only open ONE workspace, not all at once. Hovering "Open Workspace" should reveal a submenu of all configured workspaces.~~ — 93c81a22 + 83dff022 + 96758e21 + 82417477 ((a) action dep bag exposes `getWorkspaces` (live-getter) — chooser fallback no longer reports "No workspaces available". (b) File menu now hosts a NATIVE dynamic submenu `Open Workspace ▶` with one entry per workspace, rebuilt on every catalog change via `set_workspaces_submenu` Tauri command. Each entry dispatches `open-workspace:<id>` straight to `WorkspaceShell.openWorkspaceWindow(id)` — no chooser. (c) `pickDefaultWorkspaceId(list)` (prefers `isDefault`, else first) promotes the window to a real workspace when the catalog hydrates. (d) **Cross-window leak fix**: `setActiveWorkspaceId` no longer persists via `Settings.set('activeWorkspace', …)` — that was firing a `storage` event into sibling windows and yanking their views. Active workspace is now per-window in-memory ONLY. Boot reads `Settings.get('activeWorkspace')` removed; the `lexera-active-workspace` storage event listener removed. Sources of truth for a window's workspace are: URL `?workspace=` lock + catalog default-picker. Cleanup of remaining `ALL_WORKSPACES_ID` constant is a follow-up.)

- [x] ~~the kanban board view tab headers have a burger menu instead of a close button. the burger menu must be replaced by the close button, so it's the same as all other views!~~ — 4adee6a2 (board tabs now render `× ws-view-close` for both per-tab and header-level action buttons, identical to panel tabs. Board context actions (open detached, reveal in finder, split, set view kind, …) move to right-click → showBoardTabMenu via handleRootContextMenu, so discoverability is preserved without cluttering the tab. Existing `workspaceShell.test.js` test re-pinned: now asserts NO `data-ws-action="tab-menu"` button exists on the board tab header AND a `.ws-view-close` does.)

- [x] ~~one window per workspace + "Open" menu action.~~ — 31814eb7 + a00e8f57 (FULL chain. **Native menu entry** (a00e8f57): File > Open Workspace… (Cmd+O) → `open-workspace` action → reads `d.workspaces` → `LexeraDialogs.choose` (new generic chooser added to lexera-shared) → on pick → `shell.openWorkspaceWindow(workspaceId)`. Falls back to direct `open_new_window` Tauri command if shell unavailable (embedded mode). **Per-row sub-app button** (31814eb7): same path — workspaces sub-app `.ws-open-btn` (now styled visibly with hover/focus states) emits the same navigate type. **Plumbing** (31814eb7): navigationBridge → `shell.openWorkspaceWindow(workspaceId)` → workspaceShell forwards `payload.workspaceId` to `open_new_window` → Rust appends `?workspace=<id>` → app.js reads `urlParams.get('workspace')` and pins the window's `activeWorkspaceId` per-window only (NOT persisted). Cross-window drag-drop unchanged. 7-step source-level contract test + workspaces view runtime test pin menu → action → chooser → openWorkspaceWindow → forward → URL → app boot.)

- [x] ~~how can the frontend tests success if the features are not functional?~~ — initial rollout complete: every sub-app now exposes a `Lexera*TestApi` whose helpers drive the SAME DOM and event paths a real user does. Regressions that break rendering or wiring make the API return false / yield wrong state, so the test result tracks user-visible behaviour instead of source matching.
  - dashboard: `LexeraDashboardTestApi` (collectState / setSearch / clickCard) — now exercises the visible dashboard panel DOM, result click event path, and embedded board focus acknowledgement.
  - workspaces: `LexeraWorkspacesTestApi` (collectState / clickBoard / clickOpenWorkspace) — added e7f056b8.
  - hierarchy: `LexeraHierarchyTestApi` (collectState / clickBoard / clickWorkspace / clickWorkspaceGroupHeader) — added d87e0f1a.
  - log: `LexeraLogTestApi` (collectState / appendEntry / setSearch / clickClear / clickRefresh / toggleLevel / toggleSource) — added 7d9a1254.
  - inspector: `LexeraInspectorTestApi` (collectState / clickDestroy / clickReload) — added d904d6a9.
  - files: `LexeraFilesTestApi` (collectState / triggerManagementRefresh) — added c67b18ad.
  - frontendSettings: `LexeraFrontendSettingsTestApi` (collectState / triggerVisualThemesChanged) — added 45deed28.
  - backendSettings: `LexeraBackendSettingsTestApi` (collectState / triggerManagementRefresh) — added 32b4d277.
  - renderApps: `LexeraRenderAppsTestApi` (collectState) — added 5d20bb60.
  - **future tests in any sub-app**: extend the matching `Lexera*TestApi` rather than adding a parallel surface; never assert on private internals.

- [~] check all tests if they are really testing what we need! — 1fe4f101 + b73f67eb (PARTIAL: dashboardShellMirrorContract upgraded to regex+runtime; cardDraggingLayoutContract gained runtime computed-style check on `.card.dragging` (b73f67eb). Remaining: fullBoardRenderContract (source-level invariants — runtime equivalent would need orderHelpers + persistBoardMutation harness), ipcAuthSingleEntryContract (first test is intentionally a source walk, second pins regex on api.js — runtime equivalent would mock core.invoke).)

- [x] ~~the dashboard isnt showing any of the content it should show!~~ — 0db2938d + 57957cca (SHELL renders into a hidden mirror DOM, broadcasts each list's innerHTML on `dashboard-mirror-update`; webview applies HTML and forwards tree-node clicks back via `dashboard-navigate` → `navigateToSearchResult` so the focus chain runs unchanged. 8-test contract suite + dashboard view test update locks the wiring.)

- [x] ~~the workspace isnt showing the names of the board, all show (untitled)~~ — ff9cbf03 (workspaces.js fallback chain reordered: prefer canonical `b.title` over legacy `b.name` so /boards-shaped payloads render correctly; 2 regression tests pin the fallback truth-table)

- [x] ~~when adding a card to a column it should hide the "+ add card" button immediately, solve it using css only by detecting any siblings and hide the button directly.~~ — eaaac0fa (added `.column-cards:not(:empty) + .column-footer:not(.add-mode) { display: none }` adjacent-sibling rule alongside the existing JS-driven `.has-cards` class — instant hide on first card insertion without paying the WebKit `:has()` perf cost)

- [x] ~~make all add element buttons (+ Add Row, + Add Stack, + Add Column, + Add Card) have the same layout.~~ — f47d51c8 (card button now carries `add-entity-btn add-card-btn` so visual treatment comes from the shared class while `add-card-btn` keeps only column-footer-context tweaks; contract test pins both halves)

- [ ] the workspace tree doesnt look at all good! not the right list of elements, not the right structure — **needs user input**: which specific elements look wrong and what structure is expected? sidebar tree at [sidebar/sidebarTree.js](lexera-kanban/src/sidebar/sidebarTree.js) renders Workspace > Board > Row > Stack > Column > Card

- [x] /refactor the @lexera-kanban/src/workspace/workspaceShell.js this is a mess!

- [x] ~~can you create 3 dedicated test markdown boards~~ — three boards exist in [tests/kanban-feature-suite/](tests/kanban-feature-suite/): `board-01-feature-showcase.md` (showcase), `board-02-edge-cases.md` (edge cases — 16 `!!!include()!!!` column titles incl. broken includes via `nope.*`, `does-not-exist.md`, `also-missing.md`, `never-exists.marp.md`), `board-03-scale-stress.md` (1 row × multiple stacks × variable columns × cards with images/videos/audio/pdf/xlsx/drawio/excalidraw — 12 includes). Multi-page formats (pdf, epub, marp-presentation, xlsx) are exercised via `includes/`. The pristine versions live at the original `board-0X-*.md` paths and are restorable via `git checkout` — manual testing produces working copies side-by-side as `*-lexera2.md` so the originals serve as the immutable backup.

- [x] if we can add the mergeIncludes depth cap to the plugin settings put it there
after the user exported the board, it might 
- eighter be an active export: the automatically-updating must be shown in the active processes. this is displayed in a button in the top right of the board view. it must show that it's an active process and it can be stopped there (stop re-exporting the changes the user does on saving it).
- alternatively be an file that is only exported once (pdf) : a popup in the top right corner should show that it created a new output file show the path and allow the user to open the file, open the file explorer at the file position. this dialogue goes away within 10 seconds, but the process button allows seeing it again.

- [x] Q1: a folder is created for the export, the main file is placed in this directory, a _Rendered folder is created where the media files are placed (if pack linked files is selected). othervise the paths are linking directly to the cache files.
Q2: for packed files the path should allways be relative. for files that are linking the original or the cached files we usually also use relative mode. 

we might modify the export "Link & asset handling" settings:
- "rewrite relative links": 
- "pack linked" files opens a dropdown where the user can select to pack all file types or define a list of file extensions which should be packed. also a file size limit can be defined for all file types. files are allways linked relatively.
- "pack all files" : is removed, as its now covered by the "pack linked"
- "dont modify links" is removed.

we also move the merge includes into main file down to the output section. it will embed all media into the main file if it's possible (other markdown files) and convert it to the appropriate export format. 

- [x] ~~**Audit: unify all IPC call construction so auth is applied consistently.**~~ — 33603763 (already centralised; locked with contract test)

- [x] ~~add stack, column and card must only show in the parent element if there is no sibling already in there! solve it with css!~~ — 1651b213 (already implemented; row/stack/column via JS emptiness branches, card via `.column.has-cards > .column-footer { display:none }`. Contract test now pins all four levels.)

- [x] ~~when i drag-move a card it sometimes disappears instead of showing up in the new locaiton!~~ — 4e10704c

- [x] ~~when i drag-move a card downwards in the column it's not put into the highlighted position, but one above!~~ — 4865830a

- [x] ~~for the kanban/canvas boards elements in the workspaces instead of the "x" button (remove) add a burger menu (the same as for all sub-elements in the board). put the options that appear when right clicking a board in there, as well as the remove board from workspace option.~~ — 4c83ad87

### Lexera v2 design rollout (handoff bundle from claude.ai/design)

Bundle lives at `/tmp/lexera-design-v2/lexera-v2/` (palette + typography + JSX prototypes + chat transcript).

- [x] **Phase 1 · Tokens as default** — swapped `:root` palette to LX.light warm-paper (`--bg-primary #f6f4ef`, `--bg-secondary #fbfaf6`, `--border #d4cdbd`, `--accent #3d3a32`, `--text-muted #7a746a`, etc.), preferred Inter + JetBrains Mono via `--font-ui` / `--font-board` / `--font-mono`, aligned `--font-color-unified` fallback in [app.css:40-71](lexera-kanban/src/app.css#L40-L71) and [workspaceShell.css:19](lexera-kanban/src/workspace/workspaceShell.css#L19). Style-contract test updated.
- [x] **Phase 2 structural changes** (each its own round — confirm scope first): all 11 sub-items below shipped — see individual rollup commits.
  - [x] Row title on vertical left rail (writing-mode: vertical-rl, rotate 180°); folded row = single horizontal line. ALREADY IN CODE: [app.css:2523-2538](lexera-kanban/src/app.css#L2523-L2538) — `.board-row-header` sets `writing-mode: vertical-rl; transform: rotate(180deg); width: var(--layout-row-rail-width)` (36 px). Folded state at [app.css:2898-2919](lexera-kanban/src/app.css#L2898-L2919) un-rotates and reorders into a single horizontal line.
  - [x] Stack = fixed px width, Column = `frac` of stack via `ColRow`; siblings tile to sum ≤ 1. Stacks never scroll horizontally; row `maxHeight` scrolls whole row as one unit. DONE: `--stack-width-default: 350px` token added ([app.css :root](lexera-kanban/src/app.css)), `.board-stack` gets `overflow-x: clip` ([app.css:2935-2936](lexera-kanban/src/app.css#L2935-L2936)). Row-content scroll rule added for rows with explicit heights. Column widths continue to flex via tag-based `#w2/#w3` scheme + `--stack-width-override` inline overrides — equivalent to the design's `frac` concept mapped onto the existing tag grammar.
  - [x] Pane dropdown replacing tab bar — DESIGN's alternative; user chose the per-tab × close button instead, restored this session ([workspaceShell.js:2878-2886](lexera-kanban/src/workspace/workspaceShell.js#L2878-L2886)).
  - [x] Per-board header row: filename · burger · drawers · settings · export · save · scale. ALREADY IN CODE: [boardHeader.js:69-99](lexera-kanban/src/board/boardHeader.js#L69-L99) — LEFT filename + burger + sync indicator · MIDDLE New / Incoming / Park / Archive / Trash buttons with count badges · RIGHT Changes / Settings / Export + board-level burger.
  - [x] Burger `☰` on every Row / Stack / Column / Card header (metadata + actions). ALREADY IN CODE: `.row-menu-btn`, `.stack-menu-btn`, `.column-menu-btn` ([app.js:7536, 7991, 8169](lexera-kanban/src/app.js)), `.card-menu-btn` ([app.js:7308](lexera-kanban/src/app.js#L7308)) — all using `burger-menu-btn` class.
  - [x] Empty-state add affordances: "+ row", "+ stack", "+ column", "+ card" only when container is empty. ALREADY IN CODE: `buildRowElement`/`buildStackElement`/`renderNewFormatBoard` only emit the placeholder when the level is empty ([app.js:8040, 8214, 8272](lexera-kanban/src/app.js#L8040)); column has-cards class hides `.column-footer` via CSS ([app.css:4894](lexera-kanban/src/app.css#L4894)).
  - [x] Card fold behavior: folded = first content line inline with fold button; opened = full content below. ALREADY IN CODE: `.card.collapsed .card-content { display: none }` hides body when folded ([app.css:3880](lexera-kanban/src/app.css#L3880)); `.card:not(.collapsed) .card-title-display { display: none }` hides header title when expanded ([app.css:3807](lexera-kanban/src/app.css#L3807)) so the rendered markdown below is the only copy of the title.
  - [x] Drop numeric counts from Row / Stack / Column headers — DONE: removed `.board-row-count` and `.board-stack-count` from headers; `.column-count` now renders only when a WIP limit is defined (shows `N/M` as functional signal). Unused `stackColCount` / `totalCards` computations stripped.
  - [x] Unfolded workspace sidebar: full Workspace > Board > Row > Stack > Column > Card tree with drag between sidebar and view. ALREADY IN CODE: [sidebar/sidebarTree.js](lexera-kanban/src/sidebar/sidebarTree.js) builds `.tree-row`, `.tree-stack`, `.tree-column`, `.tree-card` nodes; drag handlers in [dragdrop/dndListeners.js](lexera-kanban/src/dragdrop/dndListeners.js) support `tree-row/stack/column/card` drag types into the board-list ([boardList.js](lexera-kanban/src/board/boardList.js) references tree-row/stack/column/card in 15 sites).
  - [x] Compact dashboard variant: single vertical list, one line per result, day-bucket grouped. ALREADY IN CODE: `#sidebar-dashboard` stacks 9 sections vertically (results, pinned, overdue, upcoming, open-tasks, tagged, file-embeds, broken-elements, included-files) with `.tree-children`/`.tree-node` single-line rows ([index.html:36-85](lexera-kanban/src/index.html#L36-L85)). Large-grid variant from the design bundle never existed in the app.
  - [x] Tag manager screen: full-pane list + inline color/property editor. DONE: new `tags` management tab registered in `UI_PRESETS.files.topTabs` ([management.js:144](lexera-kanban/src/management.js#L144)); `renderTagsSection()` + `buildTagRowsHtml()` list every `LexeraTagColors.TAG_COLORS` entry merged with user `tagColorOverrides`, marks overrides with a "custom" badge, clicks a row to open the existing `showTagColorPicker` popover ([management.js:693-760](lexera-kanban/src/management.js#L693-L760) + delegate click handler). CSS in `management.css` renders swatch + mono color label per row. Full editing of name/scope/light-dark swatches from the v2 design is a future refinement — current minimum supports override editing for every tag in use.

### Testing & Quality

- [ ] Check the tests for duplicates and refactor opportunities. Especially the checks that run after each change. Make a verification library (`TestVerify`) that simplifies testing while staying close to the user experience. STARTED: `TestVerify` namespace with `afterMutation`, `moveCard`, `snapshot`, `cardMoved`, `makeCard`, `getColumnFromData`, etc. exists in frontendTests.js. Needs wider adoption across all 155 tests.
- [ ] Create formal test groups. Suggested groups defined but not yet implemented as `describe()` blocks. See [todo-archive.md](todo-archive.md) for the full list.

- [x] the workspaces adds boards sometimes multiple times! especially in the frontend tests this happens a lot! — FIXED: `_buildDesiredEntries` deduplicates via seen-hash. `assertWorkspaceViewIntegrity` now checks parent window in autoRun mode. Every test teardown asserts no duplicate boards and that board-list count didn't grow.

### Board Rendering

- [x] ~~Items still needing full board render: row/stack hidden tags, board frontmatter changes, board settings changes, tag style preset change. These genuinely affect the whole board.~~ — 593c08d0 (contract test pins all four call sites)

### Dashboard

- [x] ~~**Incremental DOM updates** — `renderDashboard()` does `innerHTML = ''` on every call. Diff and update only changed items.~~ — closed: `renderDashboardTreeItems` ([orderHelpers.js:2197](lexera-kanban/src/board/orderHelpers.js#L2197)) tries `TreeView.patch` first, only falling back to `innerHTML = ''` when no existing tree exists; `_dashboardFingerprint` change-detection ([orderHelpers.js:2178-2182](lexera-kanban/src/board/orderHelpers.js#L2178-L2182)) skips the rebuild entirely when data is unchanged. Patch behavior pinned by `treeViewPatch.test.js`. Only remaining unconditional clear is `renderDashboardPinnedList` for ≤5 entries — diff overhead would cost more than the rebuild.
- [ ] **Virtual scrolling for result lists** — currently renders 80 result + 60 todo + 40x4 calendar items as DOM nodes. Only render visible viewport items.
- [ ] **Move search to Web Worker** — the backend search itself is fast, but parsing/grouping/tree-building on the main thread blocks rendering. Move post-processing off-thread.

### Large Board Performance

- [ ] **Virtual scrolling for columns** (medium) — with 104 columns, most are off-screen. Only render columns in/near the viewport.
- [ ] **Web Worker for heavy operations** (low) — move markdown rendering, undo diffing, and board serialization off the main thread.

### Backend Stability

- [~] **Stale h2c connections after macOS sleep/wake** — 341e886d (option 1 of 3 shipped: TCP keepalive on accepted h2c sockets via socket2 — `with_time(30s).with_interval(10s)` — so the kernel tears down dead connections within ~1 minute and request timeouts become the upper bound on staleness instead of multi-minute hangs. Defense-in-depth — frontend retry path in `api.js:retryWithBackendRecovery` still runs the full recover-and-retry chain. Remaining options PARKED until validated: (2) frontend-side connection health checks before reuse — design-heavy with timing/visibility heuristics, marginal gain over keepalive + retry combo; (3) switch from persistent h2c to short-lived HTTP/1.1.)
- [ ] **File upstream Loro issue** — Loro 1.10.8 has a `MovableList::mov()` panic when the element at the source position was already consumed. Our code is safe (`catch_unwind` + session rebuild), and pre-move validation was added in `reorder_list_by_id`. File an issue on `loro-dev/loro` when a minimal reproduction is available.

### Frontend Test Additions

- [~] Dashboard deadline/overdue sections update after temporal tag mutations. PARTIAL: basic rendering and search-refresh tests exist; dashboard-section DOM assertions need manual-mode tests (autoRun skips dashboard DOM).
- [x] ~~Clicking a dashboard result focuses and reveals the matching card in the board view.~~ — b9b8ced4 + 6671f8a0 (search-focus path: focusHierarchyTargetLocally calls focusCard(el) on the rendered card + no column-fallback firing; reveal path: revealCardContent flips data-hidden-revealed on exactly the matching card)
- [x] ~~Dashboard navigation targets still focus the correct element after live mutations and rerenders.~~ — covered by existing `boardSearchFocus.test.js` (stable column-id wins over stale visible-path indices, falls back from missing card to owning column via stable ids) + b9b8ced4 (focusCard happy-path + silent no-op)
- [x] ~~Dashboard selection on temporal sections (due-soon, overdue) jumps to correct card with expected focus state.~~ — 2b57d4ca + b9b8ced4 + 6671f8a0 (full chain pinned: tree-node click → buildDashboardNavResultFromTreeNode payload → navigateToSearchResult → focusHierarchyTargetLocally cardId path → focusCard reveals)
- [~] Dashboard results stay correct after tag edits that change visibility (deadline, overdue, parked, archived, hidden). PARTIAL: tag-edit and hidden-state tests cover data; dashboard-specific DOM assertions need manual-mode tests.
- [x] ~~Burger-menu reveal and edit actions open or focus the expected content target (not just data mutation).~~ — 6671f8a0 (8-test suite in burgerMenuRevealTargets.test.js pins data-hidden-revealed flipping at card / column / row / stack scope, including idempotent toggling and out-of-range no-ops)
- [~] Temporal tags via burger-menu update visible time badges and dashboard groupings. PARTIAL: badge rendering verified; grouping assertions need manual-mode tests.

### Multi-Board Drag & Drop Test Plan

Requires workspace shell mode (multiple boards open in iframes). Tests use `LexeraTestApi.moveCard()` with different `source.boardId` / `target.boardId` — no mouse simulation needed.

**Setup:** Use `LexeraTestApi.selectBoard()` to switch between boards, `setTestBoard()` to inject test data into each board.

- [x] ~~Cross-board move: card from board A column appears in board B column~~ — 25f815f1
- [x] ~~Cross-board move: source card is trashed with `#hidden-internal-deleted` (not removed)~~ — 25f815f1
- [x] ~~Cross-board move: target board card count increases by 1~~ — 25f815f1
- [x] ~~Cross-board move: source board visible card count decreases by 1~~ — 25f815f1
- [x] ~~Cross-board move: card content preserved exactly in target board~~ — 25f815f1
- [x] ~~Cross-board move: total visible card count across both boards stays constant~~ — 25f815f1
- [x] ~~Cross-board move: source board sidebar reflects the trashed card (hidden)~~ — 25f815f1 (asserted via commitBoardIds → board-a)
- [x] ~~Cross-board move: target board sidebar reflects the new card~~ — 25f815f1 (asserted via commitBoardIds → board-b)
- [x] ~~Board switch: `selectBoard()` loads correct board data and re-renders view~~ — 4cfe272b (selectBoard runs before loadBoard, skipped when target already active, focus chain still fires for re-reveal)
- [x] ~~Board switch: switching back restores previous board state~~ — 4cfe272b (round-trip test: A→B→A re-runs the full chain twice; each focus event carries the correct cardId for its target board)
- [x] ~~Workspace view: sidebar shows correct cards after cross-board move~~ — covered by 25f815f1 (commitBoardIds includes both source + target boards → both sidebars refresh through commitBoardMutations)
- [x] ~~Same-board move via workspace coordinates still works in multi-board context~~ — 30317604 (explicit isolation pin: board B unchanged when board A receives a workspace-coords same-board move)
- [x] ~~Cross-board move with workspace-style source coordinates (rowIndex/stackIndex/colIndex)~~ — covered by `workspace-to-view cross-board commits both boards for UI refresh` in mutations.test.js
- [x] ~~Cross-board move with workspace-style target coordinates~~ — covered by `view-to-workspace cross-board commits both boards for UI refresh` in mutations.test.js
- [x] ~~Cross-board move: no duplicate card IDs in either board after move~~ — 25f815f1

Scope: the active Lexera code now lives in the promoted top-level V2 directories such as `lexera-core`, `lexera-backend`, `lexera-kanban`, `lexera-capture-ios`, `lexera-shared`, and `lexera-web-clipper`. This backlog tracks the remaining architecture, boundary, tooling, and cleanup work after that repository promotion. Completed promotion-path tasks were moved to `todo-archive.md`.

## Major Features

- Compare our solution to https://github.com/andes90/collabmd?tab=readme-ov-file#installation-options , what can we learn from its implementation. What can we copy?

## Repository Foundation

- [ ] Decide the final repository structure: keep the promoted flat top-level layout or normalize it further into grouped directories such as `apps/`, `core/`, `shared/`, `tools/`, and `archive/`.
- [ ] Move legacy `src/` into an explicit archive location such as `archive/v1/` while preserving history and build reproducibility.
- [ ] Keep the restructure mostly path-level and boundary-level first, without mixing it with feature refactors in the same change set.
- [ ] Convert fragile relative cross-module imports to stable workspace or crate references before large directory moves.
- [x] ~~Choose one package manager for the whole repository and remove mixed lockfile usage after migration.~~ — 7f0425a6 (npm is canonical; root + per-package use `package-lock.json`. The orphan `pnpm-lock.yaml` (2918 lines, stale — no `pnpm-workspace.yaml`, no package.json referenced its top-level imports) was deleted.)
- [x] ~~Create one root `lint` command that runs all supported packages in dependency order.~~ — 2a8f10dd (`npm run lint` → `lint.sh` → `lint:js` (eslint `--quiet` so the 89k+ style warnings don't drown the 0 errors — transport-discipline rules stay error-severity) then `lint:rust` (cargo clippy `--workspace --all-targets --no-deps`, baseline warnings retained but not promoted to errors). Eslint + @typescript-eslint plugins now pinned in root devDependencies.)
- [ ] Standardize TypeScript base config and let packages extend it instead of drifting independently.
- [ ] Standardize Rust workspace settings and shared lint rules for all Tauri and core crates.
- [ ] Add package boundary checks so app packages do not reach into each other through private files.
- [ ] Split repository concerns into clear groups such as apps, libraries, tooling, docs, and archived code paths.
- [ ] Add a dependency map document that shows which active packages are allowed to depend on which other packages.
- [ ] Isolate archived legacy code behind a clear boundary, exclude it from default CI, lint, coverage, and search scopes, and prevent active development from depending on it accidentally.
- [ ] Document the archival policy for legacy code: reference-only, frozen compatibility layer, or eventual deletion after the promoted packages cover the required scope.
- [ ] Separate generated schemas, vendor assets, and test-only support code from authored product code in the promoted layout so architecture reviews do not keep mixing them together.

## Repository Promotion Mapping

- [ ] Decide whether `lexera-capture-ios` is a first-class app in the long-term structure or a platform experiment that should move to support or archive space.
- [ ] Decide the end-state of `packages/shared` and `lexera-shared`: canonical shared contracts or UI packages, merge targets, temporary bridges, or archive candidates.
- [ ] Classify non-Lexera directories such as `ludos-*`, `marp-engine`, `agent`, and platform experiments as active support code, tooling, vendor code, or archive.
- [ ] Move non-mainline experimental or historical packages out of the primary app and core tree so the main repository structure stays focused.
- [ ] Add temporary compatibility notes or wrapper scripts if old paths are still referenced by local tooling during the migration.
- [ ] Remove transitional path aliases and compatibility wrappers once the new structure is stable.
- [ ] Record the final repository map in a top-level architecture document and keep it updated.

## Package Boundaries

- [ ] Define `lexera-core` as the canonical domain and file-format engine instead of letting multiple runtimes own parsing rules.
- [ ] Define one shared contract layer for DTOs, board schema, IDs, tag semantics, and message payloads used by the active Lexera packages.
- [ ] Move browser-only code out of shared logic packages so they can stay runtime-agnostic.
- [ ] Keep host-specific integration logic behind adapter modules so it does not leak into reusable services.
- [ ] Move Tauri-only integration logic behind adapter modules so it does not leak into reusable services.
- [ ] Decide whether `BoardStorage` remains a real app-facing abstraction or is replaced by narrower explicit services, because app code currently depends on `LocalStorage`-only capabilities.
- [ ] Define package boundaries for secondary apps such as `lexera-capture-ios` so they consume shared domain modules instead of re-implementing feature slices ad hoc.
- [ ] Keep export orchestration behind a dedicated subsystem boundary instead of letting it spread across frontend scripts, backend routes, and Tauri command modules.
- [ ] Replace ad hoc cross-package conventions with explicit public APIs per package.
- [ ] Add app and library README files that state responsibility, public API, and non-goals for each promoted module.
- [ ] Mark experimental apps, libraries, and features explicitly so production paths stay clear.

## Shared Contracts And Shared UI

- [x] ~~Rename shared package identifiers from Ludos naming to Lexera naming~~ — ab603cab (`packages/shared` now publishes as `@lexera/shared`; root + `lexera-web-clipper/package.json` updated; 7 web-clipper source imports rewritten; lockfiles regenerated; redundant `packages/shared/package-lock.json` removed (npm-workspaces consolidates). Side fixes: shared `tsconfig.json` gained `"DOM"` lib so `webClipper.ts` (uses fetch/URL/AbortSignal/setTimeout) compiles; `lexera-web-clipper` pinned `jsdom@^29.0.2` in devDependencies — popup tests imported it without a manifest entry and only worked through transitive hoisting before.)
- [ ] Decide whether temporal parsing belongs in the shared contract layer, `lexera-core`, or a dedicated parsing library.
- [ ] If `lexera-shared` remains active, replace the current `management.js` and `management.css` file-copy workflow with a real shared package that has its own manifest, build, and tests.
- [ ] Stop copying shared management assets into app source folders during Tauri build hooks.
- [ ] Define ownership boundaries for shared frontend code so management UI, theme helpers, and transport helpers do not become an unstructured misc package.
- [ ] Consolidate backend discovery, REST helpers, SSE helpers, and connection bootstrap logic that is currently split across frontend entrypoints.
- [ ] Extract shared frontend bridge helpers for Tauri invoke, event listen, theme bootstrap, and backend discovery so app entrypoints stop hand-rolling them.
- [ ] Add tests for shared frontend modules directly instead of only testing them indirectly through app bootstraps.
- [ ] Add a shared preferences layer for theme and UI settings instead of reading and writing `localStorage` directly from many feature scripts.
- [ ] Introduce shared DOM rendering helpers or view primitives so shared UI modules do not rely on uncontrolled `innerHTML` updates everywhere.
- [ ] Define which shared UI surfaces may use trusted string HTML rendering and which must move to safer DOM-builder or template primitives.

## Duplicate Logic And Single Sources

- [ ] Make `lexera-backend` config the authoritative home for shared frontend defaults such as scroll speed, zoom speed, tag visibility, and HTML render modes, and remove the current `lexera-default-*` `localStorage` fallback path from the Kanban app.
- [ ] Restrict browser `localStorage` to explicitly machine-local or ephemeral UI state only, and document which settings are allowed to stay local instead of synced through backend config or board YAML.
- [ ] Route every remaining local-only frontend preference through one settings service instead of raw `localStorage` calls spread across feature files.
- [x] ~~Add a guardrail such as a lint rule, grep-based check, or architecture test that blocks new raw `localStorage` access outside the approved settings layer.~~ — 7db7b76f (`localStorageGuardrailContract.test.js` walks `lexera-kanban/src` (skipping the build-synced `themes.js`/`backendDiscovery.js`/`dialogs.js`/`management.js` copies from lexera-shared) and pins the 22 baseline files that touch `localStorage.*`. New files trigger an explicit failure that points the author at `LexeraSettings` / `core/settingsStore.js`. Stale baseline entries also fail so refactor wins get recorded.)
- [ ] Finish the board-setting descriptor work so one manifest owns menu metadata, action IDs, persistence target, default values, normalization, and CSS application instead of splitting that behavior across Rust and JS files.
- [ ] Remove duplicated board-setting action wiring between native menu code and frontend registration by generating both from the same descriptor manifest or shared contract.
- [ ] Centralize temporal tag parsing and resolution in one semantic owner so search, shared utilities, and Kanban UI do not keep separate feature sets for the same domain concept.
- [ ] Replace duplicated backend auth, discovery, retry, and JSON request helpers across Kanban, backend webviews, quick capture, and web clipper with one shared client layer per runtime family.
- [ ] Align the backend API implementation and API spec on one contract, including whether routes stay unversioned or move under `/api/v1`, so frontend clients stop inventing their own ad hoc shapes.
- [ ] Reduce intentional source duplication such as `themes.js`, `backendDiscovery.js`, management assets, and workspace shell assets to one authored location plus reproducible build outputs.

## Build And Asset Pipeline

- [ ] Replace script-tag source loading in app frontends with a defined build pipeline and one composition root per app.
- [ ] Make Tauri `frontendDist` point at built frontend outputs instead of mutable source directories once the frontend module split is in place.
- [ ] Stop treating `src/` folders as both authored source and Tauri-ready output in the active apps.
- [ ] Separate vendored third-party assets from first-party source code with clear ownership and update policy.
- [ ] Decide whether Excalidraw assets remain vendored inside the app or move into a vendor or tools area with a documented sync process.
- [ ] Replace one-off shell copy steps in Tauri config with reproducible build tasks that work the same in dev, CI, and release.
- [ ] Create a build target for shared frontend artifacts so apps consume generated outputs instead of raw copied files.
- [ ] Replace inline HTML and CSS app composition in secondary apps such as `lexera-capture-ios` with a buildable frontend module if those apps remain active.
- [ ] Add asset-manifest checks so referenced frontend files, copied shared assets, and vendored bundles cannot silently drift.

## Board Model And File Format

- [ ] Choose one canonical board schema for rows, stacks, columns, cards, settings, and metadata.
- [ ] Remove duplicate board model definitions by generating or contract-testing TypeScript and Rust representations from the same schema.
- [ ] Separate persisted board data from transient UI state such as selection, folding, hover, loading, and drag state.
- [ ] Define a file format version field and migration rules for legacy and hierarchical board formats.
- [ ] Centralize reserved tags, hidden tags, layout tags, and YAML keys in one schema source.
- [ ] Centralize ID generation and persistent identity rules so merge and sync behavior stays stable across runtimes.
- [ ] Decide whether board format detection stays heuristic or moves to an explicit persisted format version so parser branching is visible and testable.
- [ ] Add round-trip fixtures that guarantee parse and generate stability for both legacy and new board formats.
- [ ] Add fixtures for malformed files and partial recovery so parser behavior is predictable under error conditions.
- [ ] Move board mutation rules into explicit domain commands instead of scattering structural edits across UI handlers.
- [ ] Define invariants for valid boards such as allowed nesting, empty container behavior, and include ownership.

## Parser And Content Pipeline

- [ ] Pick one canonical markdown parser behavior and make all runtimes conform to it through shared fixtures.
- [ ] Extract include resolution, tag parsing, frontmatter parsing, and markdown normalization into separate pipeline stages.
- [ ] Define a parse pipeline interface with clear input, output, diagnostics, and recovery semantics.
- [ ] Add golden tests for includes, embedded media, diagrams, exports, and tag parsing against real board fixtures.
- [ ] Add explicit parser diagnostics instead of silent fallback behavior for unsupported or ambiguous syntax.
- [ ] Separate pure parsing from filesystem access so parser tests stay deterministic.
- [ ] Add a content transformation pipeline for export-only rewrites so board parsing does not absorb exporter concerns.
- [ ] Separate parser format detection from parse execution so legacy or hierarchical routing rules can be tested and versioned independently.

## Plugin Strategy

- [ ] Define a minimal plugin model with only the extension points that are likely to grow: import, export, embed, renderer, editor integration, and menu contribution.
- [ ] Write a plugin capability schema that covers preview, export transform, edit support, dependencies, and failure modes.
- [ ] Unify plugin registration across `lexera-kanban`, `lexera-backend`, and shared Lexera libraries so built-ins are declared once.
- [ ] Replace hardcoded plugin loading lists with manifest-driven builtin registration where possible.
- [ ] Move file-type detection into a shared plugin capability layer instead of duplicating detection logic by runtime.
- [ ] Define a stable fallback path when a plugin is unavailable, misconfigured, or only partially supported.
- [ ] Add plugin-level tests that validate detection, preview config, export config, and graceful degradation.
- [ ] Add a plugin development guide with lifecycle, naming, contracts, and sample implementations.
- [ ] Keep plugin APIs narrow and versioned so future features do not require breaking every existing plugin.
- [ ] Add a capability matrix for each embed and export plugin showing preview, edit, pack, and export support.

## Embedded Media And Visualization

- [ ] Separate embedded media handling into distinct concerns: detection, metadata, preview rendering, editing, export rendering, and packing.
- [ ] Create a renderer adapter interface for diagram and document outputs so new media types do not require UI-specific branching.
- [ ] Add a metadata extraction layer for embedded files so the UI can render labels, page counts, and preview availability consistently.
- [ ] Add a cache strategy for rendered previews with invalidation rules based on file content and renderer version.
- [ ] Add security rules for external embeds and file access boundaries so plugin growth does not widen the attack surface accidentally.
- [ ] Define how unsupported media types should render in board view, export, and pack flows.
- [ ] Add extension points for future embedded editors without making every media plugin also own editing behavior.
- [ ] Add extension points for future visualization outputs such as timeline, graph, dashboard, and slide views without coupling them to the board parser.
- [ ] Split renderer capability probing from render execution so CLI discovery, availability checks, and actual export rendering do not stay coupled in one command module.

## Frontend Structure

- [ ] LATER: Break the Kanban frontend entrypoint, currently `lexera-kanban/src/app.js`, into a small bootstrap plus feature modules with explicit ownership.
- [ ] Convert global registry patterns in the frontend into module-scoped APIs with explicit imports and exports.
- [ ] Introduce one board store layer that owns board state, derived state, and mutations.
- [ ] Separate pure state mutations from DOM rendering so behavior can be tested without the browser.
- [ ] Extract one typed backend API client from UI orchestration so transport, retries, caching, SSE, and WebSocket sync are not mixed into view code.
- [ ] Extract a shared frontend platform layer for Tauri invoke, event, dialog, clipboard, and backend discovery so feature modules stay host-agnostic.
- [ ] Group frontend code by feature area such as board, export, clipboard, dashboard, management, and settings.
- [ ] Move shared UI primitives such as dialogs, menus, notifications, and status bars into reusable modules.
- [ ] Split rendering pipelines for board content, overlays, and management UI so each can evolve independently.
- [ ] Reduce direct DOM querying at runtime by defining feature-local mount points and UI controllers.
- [ ] Introduce a frontend event and action convention so interactions do not become stringly-typed and implicit.
- [ ] Add contract tests for frontend registries and feature modules so extraction from `app.js` stays safe.
- [ ] Migrate browser scripts that are effectively application code from plain JS to TypeScript where it improves safety.
- [ ] Split `lexera-kanban/src/app.css` into tokens, layout, components, and feature styles, and standardize those CSS tokens, layout variables, and theme definitions across frontend packages.
- [ ] Split the Kanban shell into explicit feature modules for sidebar tree, dashboard, board view, log panel, management panel, export flow, and sync state.
- [ ] Extract theme bootstrap and persistence from individual entrypoints so Kanban, management, and quick capture do not each apply theme state differently.
- [ ] LATER: Replace `window.Lexera*` global registries with a single app bootstrap that wires modules together explicitly.
- [ ] LATER: Replace `index.html` script-chain loading with module imports or a bundle manifest so load order is no longer part of the architecture.
- [ ] Convert IIFE-oriented frontend tests to direct module imports and remove source-string loaders like `tests/load-iife.js` as real module entrypoints are extracted.
- [ ] Separate pure board rendering, DOM event wiring, and persisted preference handling into different layers.
- [ ] Bring `lexera-capture-ios` styling under the same token and component structure if that app remains an active product surface.
- [ ] Reduce direct `innerHTML` rendering in the Kanban app by defining clearer render boundaries for trusted HTML, plugin output, and normal UI content.
- [ ] Decide whether the management panel belongs inside the Kanban app shell or should be mounted as a shared app-independent module.
- [ ] Extract export UI state and export tree state into dedicated modules so export behavior is not coupled to the main board runtime.
- [ ] Give export its own frontend composition root so dialog state, storage keys, API calls, and Tauri output adapters are not mixed into the main board shell.
- [ ] Define a stable plugin and registry API boundary for the frontend so future media and visualization features do not require editing the main app bootstrap.

## Backend Structure

- [ ] Break backend startup wiring into bootstrap, configuration, storage, sync, API, and UI-bridge modules with small entrypoints.
- [ ] Introduce backend service layers for boards, media, templates, export, workspaces, and collaboration instead of route-heavy modules.
- [ ] Make API route modules thin adapters that validate requests and call services.
- [ ] Define shared request and response DTOs for the backend API instead of allowing shape drift across clients.
- [ ] Add structured error types with clear mapping to HTTP status and user-facing messages.
- [ ] Isolate filesystem operations behind repository interfaces so tests do not depend on live disk behavior.
- [ ] Isolate file watching behind a service boundary so sync, parser, and storage logic can stay deterministic in tests.
- [ ] Break `AppState` into narrower state bundles or service containers so handlers do not depend on one broad mutable service locator.
- [ ] Introduce a config service that owns mutate-normalize-save flows instead of calling `save_config` and `normalize_workspace_setup` directly from many handlers.
- [ ] Separate collaboration and networking concerns from core board mutation logic.
- [ ] Add lifecycle management for background tasks so watchers, sync loops, and streams shut down cleanly.
- [ ] Add structured logging targets and correlation IDs for operations that span frontend, backend, and sync layers.
- [ ] LATER: Split `api/board.rs` into read endpoints, write endpoints, live-sync endpoints, and response mappers instead of keeping board concerns in one large module.
- [ ] LATER: Split `collab_api.rs` into invites, public rooms, identity, discovery, remote connections, and server-configuration modules instead of one wide collaboration route file.
- [ ] Move workspace, board assignment, and sync configuration rules out of API handlers and into explicit services.
- [ ] Separate backend app bootstrap from server bootstrap so tray, capture UI, HTTP API, and collaboration runtime can evolve independently.
- [ ] Consolidate backend frontend pages such as connection settings and quick capture around shared transport helpers instead of duplicating discovery logic.
- [ ] Replace direct `Arc<LocalStorage>` dependencies with narrower traits or services where consumers need only board reads, writes, search, or sync capabilities.
- [ ] Decide whether backend UI assets belong in the backend app package or in a shared frontend module consumed by multiple apps.
- [ ] Extract event-stream and WebSocket broadcasting concerns into dedicated runtime modules with explicit lifecycle ownership.
- [ ] Define a single backend state composition root so config, storage, watchers, and collaborators are wired in one place.
- [ ] Audit background task ownership in `lib.rs` so startup, restore, periodic save, and shutdown behavior live in named runtime supervisors instead of one growing setup flow.
- [ ] Add API contract tests that cover the full board payload shape returned to the Kanban frontend and management UI.
- [ ] Remove frontend-side port-scanning duplication once the backend location and discovery contract are centralized.
- [ ] Wrap Tauri invoke, event, and window integration behind small frontend adapters so backend UI scripts do not depend on raw globals everywhere.
- [ ] Decide whether route registration should be nested by domain or API version so the router stays navigable as more endpoints are added.
- [ ] Make route composition authoritative so every declared router is mounted in one visible place and orphaned modules cannot silently exist outside the running server.

## Sync And Collaboration

- [ ] Decide whether collaboration is based on authoritative saves, operation logs, CRDT state, or a hybrid model and document the choice.
- [ ] Keep one conflict-resolution strategy in the core domain instead of separate save, sync, and live-edit variants drifting apart.
- [ ] Define version and revision tokens that every runtime uses the same way for optimistic concurrency.
- [ ] Unify server-side and client-side sync session behavior around shared protocol helpers so `sync_ws.rs` and `sync_client.rs` do not drift semantically.
- [ ] Define how remote board mirrors are identified, named, stored, and surfaced in the UI instead of relying on ad hoc local ID prefixes.
- [ ] Add end-to-end fixtures for merge, rebase, crash recovery, and external file change scenarios.
- [ ] Add explicit feature flags for experimental collaboration features so stable board editing remains predictable.
- [ ] Define workspace, board, and peer ownership rules so sync logic is not mixed with UI assumptions.

## Core Library Structure

- [ ] Split `lexera-core` into clearer internal layers for parsing, storage, search, export, merge, sync, and watcher concerns.
- [ ] LATER: Break `storage/local.rs` into smaller modules such as board repository, write pipeline, include synchronization, revision tracking, and search indexing.
- [ ] LATER: Break `crdt/bridge.rs` into smaller modules such as metadata mapping, board serialization, list reordering, move operations, and persistence helpers.
- [ ] Either expand `BoardStorage` to the capabilities apps actually use or remove it so the codebase does not keep a misleading partial abstraction.
- [ ] Split `LocalStorage` into capability-focused services and make its public surface match the app-facing abstractions that backend code should depend on.
- [ ] Define which `lexera-core` APIs are stable for app use and which remain internal implementation details.
- [ ] Keep CRDT-specific concerns behind a narrower interface so non-collaborative board flows do not depend on bridge internals.
- [ ] Separate CRDT persistence, diff application, undo or redo, and board serialization into smaller bridge components.
- [ ] Split parser and ID-generation utilities that should stay runtime-neutral from filesystem and include-resolution layers that are runtime-specific.
- [ ] Add smaller traits for search, board repository, revisioning, and collaboration persistence instead of routing everything through one concrete storage type.
- [ ] Decide whether export, archive, and search remain in one crate or should later be split into focused libraries after the repository move stabilizes.
- [ ] Move large inline Rust test blocks toward dedicated fixture-driven tests where that improves readability and cross-runtime comparison.
- [ ] Add fixture-based parity tests between the canonical Lexera parser and any remaining secondary parser implementation.
- [ ] Review feature gating inside `lexera-core` so watcher and collaboration-heavy dependencies stay optional where possible.
- [ ] Decide whether mobile storage should converge on shared core storage services or remain a separate simplified adapter with clearly documented divergence.

## Testing And Quality Gates

- [ ] Add a pull-request CI workflow that runs lint, unit tests, parser fixtures, and package builds on every change.
- [ ] Keep the release publish workflow separate from the verification workflow.
- [ ] Add repo-level smoke tests that verify the main runtimes can boot with minimal fixture data.
- [ ] Add shared fixture packs used by TypeScript, browser, and Rust tests so behavior is compared against the same samples.
- [ ] Add contract tests for API payloads, plugin manifests, and schema migrations.
- [ ] Add contract tests for config mutation flows so workspace normalization and persistence are verified once instead of indirectly through many handlers.
- [ ] Add router-composition tests that fail if declared backend sub-routers such as export endpoints are not mounted in the running server.
- [ ] Add performance regression tests for large boards, heavy embeds, and export transformations.
- [ ] Add snapshot or golden tests for export outputs where formatting stability matters.
- [ ] Add coverage reporting per package and enforce realistic thresholds only after flaky areas are stabilized.
- [ ] Add a minimal end-to-end board editing flow test for create, move, save, reload, and export.
- [ ] Add migration-safety tests that verify repo path moves do not break Tauri frontend loading, shared assets, or package-local fixtures.
- [ ] Add frontend smoke tests that verify the Kanban app bootstraps correctly without depending on script tag load order.
- [ ] Add shared module tests for management UI and backend transport helpers once they are extracted from app-local bootstraps.
- [ ] Add tests for shared backend discovery and transport adapters so port scanning, Tauri invoke fallback, SSE, and log streams are validated once.
- [ ] Add smoke tests for secondary apps such as `lexera-capture-ios` if they remain active.
- [ ] Add checks for dead or orphaned modules so unused shared layers and abandoned abstractions are surfaced early.

## Developer Experience

- [ ] Add app and library local `README` files with how to run, test, and debug each active Lexera module in isolation.
- [ ] Standardize logging and debug toggles so developers can enable targeted diagnostics in the active Lexera modules without code edits.
- [ ] Add scripts for fixture generation, parser diffing, and contract verification across the promoted Lexera modules.
- [ ] Add a lightweight architecture decision record process for changes to file format, plugin APIs, sync model, and package boundaries.
- [ ] Add a generated dependency report so new cross-package coupling is visible in reviews.
- [ ] Add a structural report command that highlights oversized source files, globals-heavy entrypoints, and duplicated bootstrap helpers.
- [ ] Add a route and command inventory report so frontend-used endpoints, mounted routers, and Tauri invoke commands can be compared automatically.
- [ ] Document which package directories are product code, support code, generated code, vendor code, or transitional code.
- [ ] Add a migration playbook for path moves so contributors can rebase, relink local tools, and update IDE settings without guesswork.

## Documentation And Cleanup

- [ ] Write one high-level architecture document that explains the roles of `lexera-kanban`, `lexera-backend`, `lexera-core`, and the supporting shared layers.
- [ ] Separate architecture backlog items from product backlog items so structural work stays visible.
- [ ] Archive or merge outdated todo files once the new architecture backlog is adopted.
- [ ] Document naming conventions for packages, services, registries, plugins, and frontmatter keys.
- [ ] Record which packages are first-class products, which are support code, and which are candidates for archive after the promotion.
- [ ] Document the lifecycle expectations for optional integrations such as remote sync sidecars, discovery services, and mobile capture clients.
- [ ] Document the supported extension points for future exporters, embedded media types, and visualization modes.
- [ ] Document what should stay intentionally simple so the architecture does not accumulate generic abstractions too early.
- [ ] Add a short migration note at the old package and archive locations that points contributors to the new primary directories.

# Lexera Kanban Todo

> Active backlog only. Completed items moved to [todo-archive.md](todo-archive.md).

## Immediate UX / Product
- [ ] Remove the workspace dropdown once the hierarchy tree can express workspace filtering directly.

## Hierarchy Unification
> All three surfaces (workspace, dashboard, files) share `TreeView` + `HierarchyContract`. Phase 1 (consolidate shared code) is complete.

### Phase 2: Migrate node builders to hierarchy contract
- [ ] Migrate workspace node builder — switch consumers of `data-board-id`/`data-row-index` etc. to use hierarchy descriptor, then remove duplicate `data-*` attrs.
- [ ] Migrate dashboard node builders — switch `activateDashboardTreeNode` to read from hierarchy descriptor, remove `data-dashboard-*` attrs.
- [ ] Migrate management node builder — switch selection handler to use `data-hierarchy-kind` + `data-hierarchy-entity-id`, remove `data-mgmt-config-*` attrs.
- [ ] Dashboard group headers → TreeView nodes — render dashboard as one TreeView tree instead of static `<div class="dashboard-group-header">` with CSS triangles. Location: `sharedPanels.js` + `orderHelpers.js::renderDashboard()`.

### Phase 3: Unify style and interaction contracts
- [ ] Unify right-side "meta slot" model — extend node definition with `metaSlots` array so each surface declares what goes in `.tree-meta`.
- [ ] Write one shared CSS rule set for all tree surfaces — consolidate sidebar/dashboard/management tree CSS blocks.

### Phase 4: Cutover and cleanup
- [ ] Delete `sidebarTree.js`, `dashboardTree.js`, and `buildConfigTreeNodes` from `management.js` after adapters handle everything.
- [ ] Add regression tests — one per surface verifying node tree output and interaction dispatch.

## JS Simplification

### Structure review findings
- [ ] Keep `app.js` as a composition root only: move compatibility wrappers, feature delegates, and fallback implementations back into their owning modules or explicit bridge modules.
- [ ] Simplify the large `OrderHelpers` dependency/proxy/fallback block in `app.js`; make `LexeraOrderHelpers` expose the needed API directly and remove the app-level proxy fallback once coverage is in place.
- [ ] Remove canvas fallback helpers from `app.js` after `canvasMode.js` / `canvasMath.js` / canvas feature modules own the behavior directly.
- [ ] Replace the many `getXApi()` helpers in `app.js` with a single module lookup or explicit dependency object through `LexeraRuntime`.
- [ ] Collapse long `LexeraEmbedMenu` delegation stubs in `app.js` into the embed menu module boundary, or expose one narrow embed-menu facade instead of many pass-through globals.
- [ ] Collapse TagColors / TagSystem pass-through wrappers in `app.js` into the tag modules so app bootstrap does not mirror their APIs.
- [ ] Standardize frontend dependency injection on `lexera-kanban/src/core/moduleRuntime.js` (VERIFIED EXISTS); remove repeated local `_deps`, `_dep`, `_callDep`, and `window.Lexera*` lookup patterns from feature modules as they are touched.
- [ ] Split `lexera-kanban/src/test/frontendTests.js` into smaller suites and shared fixtures so frontend test behavior is easier to reason about and slow/failing groups can be isolated.
- [ ] Split `lexera-kanban/src/app.css` further by feature area and reduce repeated button/icon selector groups with shared component classes or `:is()` groups where that keeps the CSS clearer.
- [ ] Render repeated dashboard group skeleton markup in `lexera-kanban/src/index.html` from a data-driven helper or template instead of maintaining repeated static blocks.

### Break up app.js
- [ ] LATER: Extract state initialization (~580 lines) — 48 state variables + `_rt.defineState()` calls.

### Reduce large modules
| File | Lines | Action |
|------|-------|--------|
| workspaceShell.js | 4,877 | LATER: Split UI from iframe bridge |
| embedMenu.js | 4,768 | LATER: Split by embed domain, audit 63 `_callDep()` calls |
| orderHelpers.js | 3,138 | LATER: Extract TitleHelpers, LayoutHelpers, DashboardState |
| management.js | 2,855 | Extract tree node builders |
| boardList.js | 2,844 | Move draft storage to BoardDraftStore |

## Board / Session Pipeline
- [ ] Introduce one authoritative board-session store with separate structure/content update paths.
- [ ] Finish stable-id cross-view entity move contract.
- [ ] Remove iframe workspace-shell after in-process state pipeline is ready.

## Legacy Retirement
- [ ] Freeze canonical board contract: `rows → stacks → columns → cards`.
- [ ] Make legacy loading one-way and boundary-only, then delete frontend converters, flat-column schema, format branching.

## Feature Backlog
- [ ] Structure map view (mindmap-style, cf. inklink).
- [ ] Keyboard Phase 2: entity context menu, rename, creation shortcuts.
- [ ] Keyboard Phase 3: command palette, board history, multi-select.
- [ ] Stack width grid (1-12) and column fractional widths.

## Parked Until Explicit Spec
- [ ] Per-user isolation beyond local-user model.
- [ ] Additional sources/editors/pipeline: email, filesystem, office editor, build pipeline, typed API.

## Frontend Integration Tests — Remaining
- [ ] Board factory: `createTestBoardPair()` — creates Board A (3 columns, 6 cards) + Board B (2 columns, 3 cards) via `setTestBoard` (needed for cross-board tests)

## Manual Verification
- [ ] Quick capture: screen resolution change on macOS, Windows, Linux.
- [ ] Quick capture: monitor disconnect migration.
- [ ] Quick capture: watcher deduplication across repeated open/close cycles.

## Verified Task Status (2026-04-15)

All items verified against the actual codebase by code inspection, file existence, grep, and test execution.

### Verified PARTIALLY done
- [~] Ludos naming → Lexera — no `ludos` in JS/RS source, but `@ludos/shared` in root `package.json` + 7 import sites in lexera-web-clipper. Renaming requires cross-package refactor.
- [~] TypeScript base config — root `tsconfig.json` exists, but packages don't extend a shared base
- [~] Structured error types — `InviteError`, `AuthError`, `PublicRoomError` enums exist; most other API handlers use string errors
- [~] Lifecycle management — 34 `shutdown`/`cleanup`/`JoinHandle` refs in `lib.rs` but no named supervisors
- [~] Config mutation centralized — `config_api.rs` (995 lines) handles most config flows, but 20 `save_config`/`normalize_workspace` refs scattered across other API handlers

### Verified NOT done (with evidence)
- [x] ~~Choose one package manager — both `package-lock.json` (npm) and `pnpm-lock.yaml` (pnpm) at root~~ — 7f0425a6 (orphan pnpm-lock.yaml removed; npm is canonical)
- [ ] Architecture document — no ARCHITECTURE.md at root
- [x] ~~Root lint command — `test.sh` has no lint; no `lint` in `package.json`~~ — 2a8f10dd (`npm run lint` wired up; eslint deps pinned)
- [ ] Package boundary checks — root `eslint.config.mjs` exists, but no boundary/import restriction rules found
- [ ] Dependency map document — none
- [ ] ADR (architecture decision records) — no `adr/` or `decisions/`
- [x] ~~`sidebarTree.js` deleted — still at `sidebar/sidebarTree.js` (9.3KB)~~ — outdated note: the original "delete" plan assumed a full merge into the consolidated `treeView.js` (439 lines, the rendering primitive). The split landed differently — `sidebarTree.js` (246 lines) and `dashboardTree.js` (417 lines) are surface adapters that BUILD the per-context tree-node arrays then hand them to `TreeView.render` / `TreeView.patch`. They are real consumers, not duplicates. Both files are referenced by 5+ call sites each. Keep.
- [x] ~~`dashboardTree.js` deleted — still at `dashboard/dashboardTree.js` (15KB)~~ — same as sidebarTree above.
- [x] ~~`buildConfigTreeNodes` removed from management.js — 2 references remain~~ — outdated note: `buildConfigTreeNodes()` is the active builder of the management config-tree (Global Settings + per-workspace + per-board nodes). Called from `TreeView.render(el, buildConfigTreeNodes(), ...)` at [management.js:2374](lexera-shared/management.js#L2374). Real producer, not a leftover.
- [x] ~~Source duplication — `themes.js` ×3, `backendDiscovery.js` ×3 (gitignore fixed, copies are build-synced from lexera-shared)~~ — 9d36932e (themes.js was already untracked; backendDiscovery.js copies in lexera-kanban + lexera-backend were still committed despite the gitignore — `git rm --cached`'d so the gitignore actually applies. Single source of truth = `lexera-shared/{themes,backendDiscovery}.js`, copies regenerated by `sync-runtime-assets.mjs` on dev/build.)
- [x] ~~Workspace dropdown removed — `renderWorkspaceSelect` in app.js (2 refs)~~ — outdated note: no `<select>` workspace widget exists in the markup. The 3-line mirror-refresh helper has been renamed `refreshWorkspaceMirrors` (8c45d84e + 643140e4) — 9 src sites + 2 test sites updated.
- [ ] `createTestBoardPair()` factory — 0 matches
- [ ] Per-package READMEs — only lexera-shared, lexera-web-clipper have README.md; 4 missing
- [ ] CI for lint/test/build on PRs — `.github/workflows/main.yml` is deploy-only
- [ ] Coverage reporting — none
- [ ] Golden/snapshot tests for exports — none
- [ ] End-to-end board editing flow test — none
- [ ] Board format version field — no `format_version` in `types.rs`
- [x] ~~Legacy loading still present — `migrateLegacyBoard` (3 refs), `legacyColumns` (4 refs)~~ — 69310267 (user authorised "remove all legacy code!" — full deletion: `migrateLegacyBoard`, `buildRowsFromLegacyColumns`, `rowsFromLegacyColumns` (boardList + ExportTreeBuilder), `normalizeLegacyColumnsToRows`, `stripLegacyImportStructureTags`, `getLegacyImportRowNumber`, `groupIntoStacks` (only used by the converter), legacy `lexera-ui-template` / `lexera-board-theme` localStorage migrations, legacy `'legacy'` theme alias. `ensureBoardRowsForMutation` simplified to a one-line guard (drops legacy `columns→rows` fallback + unused `fallbackTitle` arg). 17 callsites updated. `legacyColumnConverterParity.test.js` deleted. App now only accepts row-based board JSON; columns-only payloads return empty hierarchy. 1857 vitest pass, 161 / 161 run-lexera-tests.sh pass.)
- [ ] `collab_api.rs` not split — 2,206 lines
- [ ] `api/board.rs` not split — 1,812 lines
- [ ] Stop copying shared management assets — `beforeDevCommand` still runs `sync-runtime-assets.mjs`
- [ ] Shared tests for management.js — no tests dir in lexera-shared
- [ ] Plugin capability schema — none found
- [ ] Performance regression tests — none (only tag contrast benchmarks)
- [ ] Route composition test — none
- [ ] Migration playbook — none
- [ ] Naming conventions document — none

### Cannot verify by code inspection (require user decisions or design work)
These are architecture/design/strategy decisions that need human judgment, not code artifacts:

**Repository & Package decisions:**
Decide final repo structure, classify non-Lexera dirs, decide capture-ios status, decide packages/shared vs lexera-shared, define package boundaries for secondary apps, decide BoardStorage abstraction fate, decide API versioning, decide route registration style, decide board format detection strategy, decide mobile storage convergence, decide management panel ownership, decide export crate splitting

**Architecture design work:**
Define shared contract layer (DTOs/schema/IDs), define parse pipeline interface, define plugin model, write plugin capability schema, define plugin fallback path, define plugin dev guide, define board invariants, define workspace/board/peer ownership rules, decide collaboration model (CRDT/authoritative), define version/revision tokens, define conflict-resolution strategy

**Documentation to write:**
Document archival policy, document naming conventions, document lifecycle expectations, document extension points, document what should stay simple, write architecture document, write per-package READMEs, add migration notes at old locations

**Feature work not started:**
Structure map view, Keyboard Phase 2/3, stack width grid, per-user isolation, additional sources/editors pipeline, workspace burger menu for boards

**Refactoring work (verified NOT started but scope is clear):**
Break app.js into bootstrap + modules (11,063 lines), split workspaceShell.js (4,891), split embedMenu.js (4,925), extract OrderHelpers sub-modules (3,173), extract boardList draft storage (2,961), split management.js tree builders (2,848), split storage/local.rs (6,303), split crdt/bridge.rs (5,993), split lib.rs (1,027), collapse app.js pass-through wrappers (66 `window.Lexera*` globals, 26 direct `localStorage` calls), replace `window.Lexera*` with explicit wiring, replace index.html script-chain with module imports (94 script tags), convert IIFE tests to module imports

### Metrics
| Metric | Count |
|--------|-------|
| `window.Lexera*` globals in app.js | 66 |
| `_rt.defineState` + `_rt.setState` in app.js | 16 |
| Direct `localStorage.` calls in app.js | 26 |
| Script tags in index.html | 94 |
| `_callDep` / `_dep` patterns in feature modules | widespread |
| Total `[ ]` items in this file | ~302 |
| Verified done | 22 |
| Verified partial | 7 |
| Verified not done | 31 |
| Design decisions (cannot verify) | ~242 |

## Historical Review Notes

Large historical status sections, package-by-package quality reviews, already-completed hardening work, and the older phased recommendation lists were moved out of the active backlog. Keep the active file focused on unresolved architecture and product work; use [todo-archive.md](todo-archive.md) and git history for the older progress reports.

- ~~native multiview webviews paint above shell DOM, hiding dropdowns and drag indicators~~ — c0627702: refcounted `setAllVisible` on `LexeraMultiviewWebview`, hooks tab drag mode + tab overflow dropdown, gates `boardHost` visibility observer + spawn-time visibility on the same flag so concurrent suppressors compose.
