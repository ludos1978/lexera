// Phase 6.1 closing slice — ambient global declarations for the
// IIFE-pattern globals that the lexera-kanban shell exposes via
// `window.LexeraXxx = (...)()`. Each is typed as `any` to start;
// progressive tightening is a follow-up slice (replace `any` with
// the real surface defined by each module's IIFE return value).
//
// This file exists ONLY to silence the dozens of "Property X does
// not exist on type Window" errors so `tsc --noEmit` can surface
// the shape errors that actually matter — JSDoc typedef
// mismatches inside annotated files (workspaceShell.js,
// multiviewWebview.js).
//
// Loaded via `tsconfig.typedef-check.json` `include`.

// ─────────────────────────────────────────────────────────────────────
// Per-module API surfaces. Progressive tightening: each module's `any`
// is replaced with a real interface as a slice. The TS gate then
// catches call-site mismatches the moment a signature drifts.
// ─────────────────────────────────────────────────────────────────────

/**
 * Source: src/shell/bridges/catalogBridge.js (IIFE;
 * window.LexeraCatalogBridge = api). Caches the last
 * board-catalog snapshot + active-board id and re-broadcasts each
 * to every sub-app webview when activated. wrapShellMethods()
 * monkey-patches `LexeraWorkspaceShell.onCatalogUpdated` /
 * `onActiveBoardChanged` so the bridge intercepts every
 * shell-emitted update without the shell knowing about it. Idempotent
 * via the `__lexeraMultiviewCatalogWrapped` flag on `window`.
 */
interface LexeraCatalogBridgeApi {
  /** Push a snapshot to every sub-app via the multiview broadcast
   *  bus + cache it as the new `lastCatalogSnapshot`. */
  broadcastCatalog(snapshot: unknown): Promise<unknown>;
  /** Read the cached snapshot (`null` until the first broadcast). */
  getLastCatalog(): unknown;
  /** Toggle the catalog-broadcast switch on/off. */
  activateCatalog(): void;
  deactivateCatalog(): void;
  /** Push an active-board id to every sub-app + cache it. */
  broadcastActiveBoard(boardId: string | null): Promise<unknown>;
  /** Read the cached active-board id. */
  getLastActiveBoardId(): string | null;
  /** Toggle the active-board-broadcast switch on/off. */
  activateActiveBoard(): void;
  deactivateActiveBoard(): void;
  /** Activate both catalog + active-board sides at once. */
  activate(): void;
  /** Deactivate both at once. */
  deactivate(): void;
  /** Idempotent monkey-patch of LexeraWorkspaceShell.onCatalogUpdated
   *  + onActiveBoardChanged so the bridge intercepts every shell
   *  emit. Guarded by `window.__lexeraMultiviewCatalogWrapped`. */
  wrapShellMethods(): void;
  /** Subscribe to the `catalog-request` event so a freshly-loaded
   *  sub-app can pull the cached snapshot on demand. */
  initListeners(): void;
}

/**
 * Source: src/shell/bridges/navigationBridge.js (IIFE;
 * window.LexeraNavigationBridge = api). Subscribes the shell to
 * multiview-navigate / multiview-shortcut / focus-changed /
 * frontend-tests-command events and dispatches them. SHORTCUT_ACTIONS
 * is the static map of action ids → handlers (open-log-view,
 * open-inspector, open-workspaces, open-dashboard).
 */
interface LexeraNavigationBridgeEvent<P = unknown> {
  payload?: P;
  windowLabel?: string;
}

interface LexeraNavigationBridgeApi {
  /** Wire listeners via the current webview's `listen()`. Returns
   *  true on success, false when the webview helper is unavailable
   *  (test/embedded contexts). */
  install(): boolean;
  /** Same as install but accepts an explicit Tauri runtime so the
   *  bridge can fall back to `runtime.event.listen('Any', …)` when
   *  the per-webview listener isn't available. Note: webview-scoped
   *  listening is preferred (see Tauri #11379). */
  installWith(runtime: unknown): boolean;
  /** Handle a `multiview-navigate` event payload. */
  handleNavigate(event: LexeraNavigationBridgeEvent): void;
  /** Handle a `multiview-shortcut` event payload — looks up the
   *  action in SHORTCUT_ACTIONS and invokes the handler. */
  handleShortcut(event: LexeraNavigationBridgeEvent): void;
  /** Handle a `focus-changed` event broadcast from any webview. */
  handleFocusChanged(event: LexeraNavigationBridgeEvent): void;
  /** Handle a `frontend-tests-command` event payload. */
  handleFrontendTestsCommand(event: LexeraNavigationBridgeEvent): void;
  /** Re-broadcast the shell's frontend-tests state to every sub-app. */
  broadcastFrontendTestsState(): Promise<unknown>;
  /** Action id → handler map. Static; the bridge's only writable
   *  surface is mutating handlers in place (which the codebase
   *  doesn't currently do). */
  SHORTCUT_ACTIONS: { [actionId: string]: () => unknown };
}

/**
 * Source: src/shell/bridges/themeBridge.js (IIFE;
 * window.LexeraThemeBridge = api). Owns the live CSS-custom-property
 * palette + color-scheme snapshot the shell pushes to every sub-app
 * webview via the multiview broadcast bus. Sub-apps that opt into
 * `LexeraSubApp.init({ requestTheme: true })` receive the snapshot
 * on connect and on every subsequent broadcast.
 */
interface LexeraThemeSnapshot {
  /** Map of CSS custom-property name → value. Includes only the
   *  whitelisted vars in `THEME_VAR_NAMES`. */
  palette: { [varName: string]: string };
  /** Resolved colour scheme — explicit `colorScheme` style on
   *  documentElement when set, otherwise the `prefers-color-scheme`
   *  media-query result. */
  color_scheme: 'light' | 'dark';
}

interface LexeraThemeBridgeApi {
  /** The whitelist of CSS custom-property names broadcast in
   *  snapshots. Snapshot consumers should mirror this list when
   *  applying. */
  THEME_VAR_NAMES: string[];
  /** Capture the current palette + colour scheme. Returns `null`
   *  when document/documentElement isn't available (test sandboxes). */
  snapshotTheme(): LexeraThemeSnapshot | null;
  /** Take a snapshot and broadcast it to every subscribed webview
   *  via `multiview_broadcast` IPC. Resolves silently when the IPC
   *  is unavailable (offline / no Tauri). */
  broadcastTheme(): Promise<unknown>;
  /** Apply a received snapshot's palette to :root of the current
   *  document. No-op for snapshots without a palette. */
  applyThemeSnapshot(snapshot: LexeraThemeSnapshot | null | undefined): void;
  /** Wire the shell-side listeners that re-broadcast on
   *  `theme-request` events from sub-apps. Returns a teardown fn. */
  initListeners(): () => void;
}

/**
 * Source: src/shell/panelLaunchers.js (IIFE;
 * window.LexeraPanelLaunchers = api). DevTools-console helpers for
 * opening Stage-4 utility sub-apps (log, inspector, workspaces,
 * dashboard) as either floating webviews or side-docked panels.
 * Underlying primitives (openAsSidePanel / closeSidePanel +
 * computeSlotRect) live here too — extracted from
 * `multiviewClient.js` (Workstream 5). The kind-specific launchers
 * (openLogView / openInspector / openWorkspaces / openDashboard) are
 * thin wrappers that pin a default URL + close-helper for one kind.
 */
interface LexeraPanelLaunchersSidePanelOpts {
  label: string;
  url: string;
  side?: 'left' | 'right' | 'bottom' | 'top';
  size?: number;
  topInset?: number;
}

interface LexeraPanelLaunchersLauncherOpts {
  side?: 'left' | 'right' | 'bottom' | 'top';
  size?: number;
  topInset?: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

interface LexeraPanelLaunchersApi {
  /** Mount a child webview as a side-docked panel pinned to `side`.
   *  Subscribes to window resize so the panel re-tracks the slot. */
  openAsSidePanel(opts: LexeraPanelLaunchersSidePanelOpts): Promise<unknown>;
  /** Tear down a previously-opened side panel by its label. */
  closeSidePanel(label: string): Promise<unknown>;
  /** Open the Log view. With `opts.side` set, docks; otherwise
   *  floats at (x, y) with the given size. */
  openLogView(opts?: LexeraPanelLaunchersLauncherOpts): Promise<unknown>;
  closeLogView(): Promise<unknown>;
  /** Open the Inspector view. Same opts contract as openLogView. */
  openInspector(opts?: LexeraPanelLaunchersLauncherOpts): Promise<unknown>;
  closeInspector(): Promise<unknown>;
  /** Open the Workspaces sub-app. Same opts contract. */
  openWorkspaces(opts?: LexeraPanelLaunchersLauncherOpts): Promise<unknown>;
  closeWorkspaces(): Promise<unknown>;
  /** Open the Dashboard sub-app. Same opts contract. */
  openDashboard(opts?: LexeraPanelLaunchersLauncherOpts): Promise<unknown>;
  closeDashboard(): Promise<unknown>;
}

/**
 * Source: src/shell/inspectorShortcuts.js (IIFE;
 * window.LexeraInspectorShortcuts = api). Pure-logic predicates that
 * classify a KeyboardEvent as either the single-window inspector
 * combo (F12 / Cmd-Shift-I / Alt-I) or the all-views inspector
 * combo (Cmd/Ctrl + Alt + Shift + I). Lives outside the app.js IIFE
 * so vitest can exercise the predicates without booting the shell;
 * the actual handlers stay in app.js. Strict-superset note:
 * isInspectorAllShortcut is a strict superset of isInspectorShortcut,
 * so callers MUST test it FIRST to win the precedence race.
 */
interface LexeraInspectorShortcutsApi {
  /** True when `e` is the single-window inspector shortcut
   *  (F12, Cmd/Ctrl+Shift+I without Alt, or Alt+I without Cmd/Ctrl).
   *  Returns false on null / undefined. */
  isInspectorShortcut(e: KeyboardEvent | null | undefined): boolean;
  /** True when `e` is the open-DevTools-for-EVERY-webview shortcut
   *  (Cmd/Ctrl + Alt + Shift + I). Strict superset of
   *  isInspectorShortcut — test this first. */
  isInspectorAllShortcut(e: KeyboardEvent | null | undefined): boolean;
}

/**
 * Source: src/shell/multiviewClient.js (IIFE;
 * window.LexeraMultiview = api). The umbrella front-door for every
 * shell ⇄ Rust IPC the multiview architecture exposes — webview
 * lifecycle (spawn / destroy / setGeometry / navigate), drag
 * coordination (dragStart / dragPointerMove / dragPointerUp /
 * dragCancel / dropAck), scoped event listeners, sub-app launchers
 * (openLogView / openInspector / openWorkspaces / openDashboard +
 * close-pairs), modal dialogs (confirmModal / promptModal), drag
 * ghost window (ghost*), request/response IPC (request /
 * handleRequest), and a `lifecycle` sub-API delegating to
 * LexeraLifecycle (Stage 8 of the multiview migration).
 *
 * Many of the methods below are already-typed via other interfaces
 * — sub-app launchers use the LexeraPanelLaunchers* shapes, theme
 * broadcast methods mirror LexeraThemeBridgeApi, etc. Where a
 * method's signature isn't worth re-stating here (low call-site
 * count + delegated to a typed bridge), it stays as
 * `(...args: any[]) => any` for now and gets tightened in a
 * follow-up slice.
 */
interface LexeraMultiviewSpawnOpts {
  label: string;
  url: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface LexeraMultiviewGeometryUpdate {
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface LexeraMultiviewLifecycleApi {
  /** Update the soft-cap / pool-size config in place. */
  configure(updates: Partial<{ softCap: number; poolSize: number; poolUrl: string; pinnedLabels: string[] }>): unknown;
  /** Snapshot of the current config + freshness map + pool ids. */
  status(): unknown;
  /** Spawn that participates in lifecycle (touches freshness, may
   *  trigger eviction). Resolves to `{ label, fromPool }`. */
  spawn(opts: LexeraMultiviewSpawnOpts): Promise<{ label: string; fromPool: boolean }>;
  /** Bump a label's freshness timestamp (touch the LRU). */
  touch(label: string): void;
  /** Walk the freshness map; if over softCap, destroy the oldest
   *  non-pinned non-pool webview. */
  evictOldestIfOverCap(): Promise<unknown>;
  /** Top up the pool to poolSize by pre-spawning offscreen
   *  webviews with the configured poolUrl. */
  refillPool(): Promise<unknown>;
}

interface LexeraMultiviewApi {
  // ── Webview lifecycle ──────────────────────────────────────
  spawn(opts: LexeraMultiviewSpawnOpts): Promise<unknown>;
  destroy(label: string): Promise<unknown>;
  setGeometry(updates: LexeraMultiviewGeometryUpdate[]): Promise<unknown>;
  pushGeomDeferred(
    update: LexeraMultiviewGeometryUpdate,
    options?: { immediate?: boolean }
  ): unknown;
  fpsMeter: unknown;
  navigate(label: string, url: string): Promise<unknown>;
  listWebviews(): Promise<Array<{ label: string }>>;

  // ── Drag coordinator ───────────────────────────────────────
  /** Begin a drag session: `source` is a short kind tag
   *  (`'tab'`, `'tree-card'`, …); `payload` carries the kind-specific
   *  source descriptor for the receiving webview to consume. */
  dragStart(source: string, payload: unknown): Promise<unknown>;
  /** Forward the current pointer position to the Rust drag coordinator. */
  dragPointerMove(x: number, y: number): Promise<unknown>;
  /** Forward pointer-up to end the drag session. */
  dragPointerUp(x: number, y: number): Promise<unknown>;
  /** Abandon the current drag session without firing a drop. */
  dragCancel(): Promise<unknown>;
  /** Ack a drop event back to the coordinator. `accepted=false`
   *  signals the target rejected the drop. */
  dropAck(accepted: boolean): Promise<unknown>;

  // ── Scoped event bus ───────────────────────────────────────
  listen(event: string, handler: (data: unknown) => void): unknown;
  getMyLabel(): string;
  invoke(cmd: string, args?: unknown): Promise<unknown>;

  // ── Demo / dev ─────────────────────────────────────────────
  demo(): Promise<unknown>;
  demoStop(): Promise<unknown>;

  // ── Sub-app launchers (Stage 4) ────────────────────────────
  openLogView(opts?: LexeraPanelLaunchersLauncherOpts): Promise<unknown>;
  closeLogView(): Promise<unknown>;
  openInspector(opts?: LexeraPanelLaunchersLauncherOpts): Promise<unknown>;
  closeInspector(): Promise<unknown>;
  openWorkspaces(opts?: LexeraPanelLaunchersLauncherOpts): Promise<unknown>;
  closeWorkspaces(): Promise<unknown>;
  openDashboard(opts?: LexeraPanelLaunchersLauncherOpts): Promise<unknown>;
  closeDashboard(): Promise<unknown>;
  openAsSidePanel(opts: LexeraPanelLaunchersSidePanelOpts): Promise<unknown>;
  closeSidePanel(label: string): Promise<unknown>;

  // ── Logging / theme / catalog bridges ──────────────────────
  /** Best-effort: forward a log entry to every other webview's log
   *  panel. Returns `void` — the underlying invoke promise is
   *  swallowed so a missing/dead log subscriber never rejects into
   *  the caller. */
  broadcastLog(level: LexeraLogLevel, source: string, message: string): void;
  broadcastTheme(): Promise<unknown>;
  snapshotTheme(): LexeraThemeSnapshot | null;
  applyThemeSnapshot(snapshot: LexeraThemeSnapshot | null | undefined): void;
  broadcastCatalog(snapshot: unknown): Promise<unknown>;
  getLastCatalog(): unknown;

  // ── Modal-as-window dialogs (Stage 6) ──────────────────────
  confirmModal(opts: { title?: string; message: string }): Promise<boolean>;
  promptModal(opts: { title?: string; message: string; initial?: string }): Promise<string | null>;

  // ── Drag ghost window (Stage 7) ────────────────────────────
  /** Spawn the drag-ghost window if it doesn't exist. Defaults
   *  match the impl (url=views/drag-ghost/index.html, 220×60). */
  ghostEnsure(opts?: { url?: string; width?: number; height?: number }): Promise<unknown>;
  ghostMove(x: number, y: number): Promise<unknown>;
  ghostHide(): Promise<unknown>;
  ghostSetContent(html: string): Promise<unknown>;

  // ── Request/response IPC ───────────────────────────────────
  /** Delegates to LexeraRequestBridge. Rejects with "not loaded"
   *  if the bridge global isn't installed. */
  request(targetLabel: string, requestEvent: string, payload?: unknown, timeoutMs?: number): Promise<unknown>;
  /** Register a per-event handler that fires on incoming requests
   *  for `requestEvent`. Handler signature is decided by the
   *  requestBridge contract; left loose here so each bridge can pin
   *  its own shape. Rejects with "not loaded" if the bridge global
   *  isn't installed. */
  handleRequest(requestEvent: string, handler: (...args: any[]) => any): Promise<unknown>;

  // ── Lifecycle sub-API (Stage 8) ────────────────────────────
  lifecycle: LexeraMultiviewLifecycleApi;
}

/**
 * Source: src/core/moduleRuntime.js (IIFE;
 * window.LexeraRuntime = api). Shared infrastructure for IIFE
 * modules — a reactive state store with change-listeners + an event
 * bus + a getter/setter-preserving deps merger + a module registry
 * with auto-discovery + a few view state-class helpers (loading /
 * empty / error / connected) for sub-app surfaces.
 *
 * The reactive `state` is a Proxy: reads via `runtime.state.foo`
 * call `getState('foo')`, writes via `runtime.state.foo = …` call
 * `setState('foo', …)` which fires both the per-key listeners AND
 * a `<key>:changed` event. Falls back to a plain object when the
 * Proxy global is unavailable (very old runtimes).
 */
interface LexeraRuntimeStartupReport {
  /** Names of KNOWN_MODULES that have been discovered or
   *  registered. */
  found: string[];
  /** Names that haven't been discovered yet (script tag missing,
   *  IIFE failed to register, etc.). */
  missing: string[];
  /** Total number of names in the KNOWN_MODULES list. */
  total: number;
}

interface LexeraRuntimeApi {
  /** Reactive state accessor — Proxy(get → getState, set →
   *  setState) when Proxy is available, plain `_stateValues`
   *  object otherwise. Read like `runtime.state.boards`. */
  state: { [key: string]: unknown };
  /** Initialise a state key with a starting value + an empty
   *  listener list. */
  defineState(key: string, initialValue: unknown): void;
  getState(key: string): unknown;
  /** Write a state key, fire all listeners + a `<key>:changed`
   *  event. */
  setState(key: string, value: unknown): void;
  /** Subscribe to per-key state changes. Returns an `unsubscribe`
   *  fn. */
  onStateChange(
    key: string,
    fn: (value: unknown, previous: unknown) => void
  ): () => void;
  /** Subscribe to an event bus topic. Returns an `unsubscribe` fn. */
  on(event: string, fn: (data: unknown) => void): () => void;
  /** Fire an event-bus topic to every subscribed listener.
   *  Listener errors are caught + logged via console.error so one
   *  bad listener can't block the rest. */
  emit(event: string, data?: unknown): void;
  /** Copy own properties from `source` to `target`, preserving any
   *  getter/setter descriptors. Modules use this to absorb deps
   *  without losing live-binding semantics. Returns `target`. */
  mergeDeps<T extends object>(target: T, source: object | null | undefined): T;
  /** Register a module instance under a name (called once per
   *  IIFE). */
  registerModule(name: string, mod: unknown): void;
  /** Look up a previously-registered module; `null` when missing. */
  getModule(name: string): unknown;
  /** Walk KNOWN_MODULES, copy each `window.<name>` into the
   *  registry that isn't already there. Called once after script
   *  load. */
  discoverModules(): void;
  /** Diagnostic snapshot of the registry vs. KNOWN_MODULES. */
  getStartupReport(): LexeraRuntimeStartupReport;
  /** The auto-discovery allowlist. Static; mutating this in place
   *  is technically possible but the codebase doesn't. */
  KNOWN_MODULES: string[];
  /** Toggle the `view-loading` class on a sub-app container.
   *  Removes `view-empty` automatically. */
  setViewLoading(container: HTMLElement | null, loading: boolean): void;
  /** Toggle the `view-empty` class + write a `data-empty-message`
   *  attribute. Removes `view-loading` automatically. */
  setViewEmpty(
    container: HTMLElement | null,
    empty: boolean,
    message?: string
  ): void;
  /** Toggle the `view-error` class + write a `data-error-message`
   *  attribute. */
  setViewError(
    container: HTMLElement | null,
    error: boolean,
    message?: string
  ): void;
  /** Toggle the `view-connected` / `view-disconnected` class pair. */
  setViewConnected(container: HTMLElement | null, connected: boolean): void;
}

/**
 * Source: src/workspace/panelHost.js (IIFE;
 * window.LexeraPanelHost = api). Owns panel-side webview routing —
 * the allowlist of panel kinds that spawn child webviews
 * (PANEL_WEBVIEW_KINDS), the `panel-tab-<bootId>-<tabId>` label
 * convention (and its inverse), and the per-kind URL builder that
 * loads `views/<kind>/index.html` instead of the legacy
 * shell-compat `index.html?panelKind=…` path.
 */
interface LexeraPanelHostTab {
  /** Tab id used in the webview label. */
  id: string;
  /** Panel-instance id; falls through to the panel kind in the
   *  `panel=` URL param when missing so the sub-app still gets a
   *  usable instance handle. */
  panelId?: string;
}

interface LexeraPanelHostApi {
  /** Stash the per-shell boot id used as a uniqueness suffix in
   *  panel-tab webview labels. Optional — when bootId isn't
   *  supplied (only happens in unit tests), the labels fall back
   *  to the un-suffixed `panel-tab-<tabId>` form. */
  setup(deps?: { bootId?: string }): void;
  /** Frozen allowlist of panel kinds whose dock-hosted tabs should
   *  spawn a child webview. Per Workstream P, this is currently
   *  every panel kind. */
  PANEL_WEBVIEW_KINDS: Readonly<{ [kind: string]: true }>;
  /** True when the kind is on PANEL_WEBVIEW_KINDS. */
  isPanelKindOnWebviewAllowlist(kind: string | null | undefined): boolean;
  /** `panel-tab-<bootId>-<tabId>` (or `panel-tab-<tabId>` when
   *  bootId is empty). Distinct from the `board-tab-` prefix so
   *  the multiview-destroyed listener can disambiguate. */
  panelLabelForTab(tabId: string): string;
  /** Inverse of panelLabelForTab. Returns '' when the label
   *  doesn't carry the panel-tab prefix. */
  tabIdFromPanelLabel(label: string | null | undefined): string;
  /** Build the per-kind sub-app URL the dock webview should load
   *  (`views/<kind>/index.html?panelKind=&pane=&panel=`). Pure
   *  relative to inputs (locationHref is supplied by the shell).
   *  Returns '' when any required piece is missing. */
  panelUrlForTab(
    tab: LexeraPanelHostTab | null | undefined,
    panelKind: string | null | undefined,
    locationHref: string | null | undefined
  ): string;
  /** Map a panel kind to the sub-app directory under `src/views/`.
   *  Most kinds use their own name; only legacy mismatches need
   *  overrides (currently just `logs` → `log`). */
  viewDirForKind(panelKind: string | null | undefined): string;
}

/**
 * Source: src/workspace/layoutTree.js (IIFE;
 * window.LexeraLayoutTree = api). Pure tree primitives — no DOM,
 * no state, no webviews. Every layout-tree mutation in the codebase
 * must go through this API (enforced by
 * `layoutTreeMutationContract.test.js`).
 *
 * Tree-node types are kept loose (`any`) here; the canonical typed
 * shapes live as JSDoc @typedef in workspaceShell.js
 * (DockTreeNode / DockTreeLeaf / DockTreeSplit / DockTreeTab) and
 * are referenced via call-site annotations rather than re-declared
 * here. A future slice can lift them into this file once
 * cross-file @typedef visibility is needed elsewhere.
 */
interface LexeraLayoutTreeApi {
  /** Coerce a viewKind string to one of the known kinds; falls
   *  back to 'default' on null/unknown. */
  normalizeViewKind(value: string | null | undefined): 'canvas' | 'kanban' | 'default';
  /** TS type predicate — narrows arbitrary values to
   *  `LexeraDockTreePanelTab` so callers can read `.panelId` after
   *  the guard without an explicit cast. */
  isPanelTab(tab: unknown): tab is LexeraDockTreePanelTab;
  /** TS type predicate — narrows arbitrary values to
   *  `LexeraDockTreeBoardTab`. */
  isBoardTab(tab: unknown): tab is LexeraDockTreeBoardTab;
  /** Depth-first walk of the dock tree. Visitor fires for every
   *  node (root + every child of every split); `parent` is `null` at
   *  the root and otherwise the enclosing node (typed as the full
   *  `DockTreeNode` union rather than `DockTreeSplit` because some
   *  consumers — e.g. `findNodeAndParent`'s permissive `parent` slot
   *  — keep the looser shape). `side` is `''` at the root and
   *  `'first'`/`'second'` for split children. */
  visitTree(
    node: LexeraDockTreeNode | null,
    visitor: (
      candidate: LexeraDockTreeNode,
      parent: LexeraDockTreeNode | null,
      side: 'first' | 'second' | ''
    ) => void,
    parent?: LexeraDockTreeNode | null,
    side?: 'first' | 'second' | ''
  ): void;
  getFirstLeaf(node: LexeraDockTreeNode | null): LexeraDockTreeLeaf | null;
  findLeafById(node: LexeraDockTreeNode | null, leafId: string): LexeraDockTreeLeaf | null;
  /** Walk the tree for `nodeId`. Returns the matched node, its
   *  parent (always a split when non-null — the visitor only fires
   *  on children with a parent — but typed loosely as DockTreeNode
   *  to match `visitTree`'s callback signature), and which slot
   *  the node occupies in that split. */
  findNodeAndParent(
    node: LexeraDockTreeNode | null,
    nodeId: string
  ): {
    node: LexeraDockTreeNode;
    parent: LexeraDockTreeNode | null;
    side: 'first' | 'second' | '';
  } | null;
  /** Walk the tree for a tab with `id === tabId`. The tab is
   *  typed as the discriminated `LexeraDockTreeTab` union — call
   *  sites narrow on `tab.kind` (or via `isBoardTab` / `isPanelTab`)
   *  to read board-only / panel-only fields. */
  findTab(
    node: LexeraDockTreeNode | null,
    tabId: string
  ): { tab: LexeraDockTreeTab; leaf: LexeraDockTreeLeaf; index: number } | null;
  /** Walk to the split that DIRECTLY contains the leaf with id
   *  `targetLeafId`. Returns null when the leaf isn't reachable
   *  from `node`, or when the leaf IS the root (no parent split). */
  findClosestSplitParent(
    node: LexeraDockTreeNode | null,
    targetLeafId: string,
    parentSplit?: LexeraDockTreeSplit | null
  ): LexeraDockTreeSplit | null;
  countTreeTabs(tree: LexeraDockTreeNode | null): number;
  collectAllTabIds(tree: LexeraDockTreeNode | null): string[];
  /** Remove a tab from anywhere in the tree by tab.id. Returns the
   *  hit record `{ removed, leaf, index }` or `null` when the tab
   *  wasn't found. Updates the affected leaf's activeTabId to
   *  follow the "first remaining tab" rule.
   *
   *  `removed` is the discriminated `LexeraDockTreeTab` union; the
   *  sole call site in workspaceShell.js (pruneMissingBoards)
   *  ignores the field, so no narrowing pass was required. */
  removeTabById(
    tree: LexeraDockTreeNode | null,
    tabId: string
  ): { removed: LexeraDockTreeTab; leaf: LexeraDockTreeLeaf; index: number } | null;
  /** Remove every tab matching tabId from a SINGLE leaf. Returns
   *  the count removed (companion to removeTabById which is
   *  single-match tree-wide). */
  removeTabFromLeaf(leaf: LexeraDockTreeLeaf, tabId: string): number;
  /** Pull the tab at `index` out of `leaf`. Returns the removed
   *  tab object, or `null` on bounds / type failure. Uses the
   *  "left neighbour" activeTabId fallback. */
  extractTabAtIndex(leaf: LexeraDockTreeLeaf, index: number): LexeraDockTreeTab | null;
  /** Insert a tab into a leaf at index; returns the final
   *  inserted index (or -1 on validation failure). */
  insertTabIntoLeaf(leaf: LexeraDockTreeLeaf, tab: LexeraDockTreeTab, index?: number): number;
  /** Move a tab between leaves. Returns `{ tab, insertedAt }` on
   *  success, `null` on bounds / type failure. `tab` is the
   *  discriminated `LexeraDockTreeTab` union; the sole call site
   *  (workspaceShell.js, same-leaf reorder helper) only checks the
   *  result for truthiness, so no narrowing pass was required. */
  moveTab(
    sourceLeaf: LexeraDockTreeLeaf,
    sourceIndex: number,
    destLeaf: LexeraDockTreeLeaf,
    destIndex?: number
  ): { tab: LexeraDockTreeTab; insertedAt: number } | null;
  /** Wholesale replace `holder[key]` with `nextTree`. Returns the
   *  symmetric `{ removed, added }` tab-id diff so the caller can
   *  clean up frame caches / multiview state for removed ids.
   *  `holder` stays loosely typed because call sites pass either
   *  the umbrella shell state or the side-docks map — both have
   *  more fields than just the tree key. */
  replaceTreeRoot(
    holder: { [k: string]: any },
    key: string,
    nextTree: LexeraDockTreeNode | null
  ): { removed: string[]; added: string[] };
  createIdFactory(): (prefix: string) => string;
  createTabsetNode(
    tabs: Array<LexeraDockTreeTab>,
    idFactory?: (prefix: string) => string
  ): LexeraDockTreeLeaf;
  createSplitNode(
    axis: 'horizontal' | 'vertical',
    first: LexeraDockTreeNode,
    second: LexeraDockTreeNode,
    ratio: number,
    idFactory?: (prefix: string) => string
  ): LexeraDockTreeSplit;
  withNormalizedLeaves(
    node: LexeraDockTreeNode | null,
    isRoot: boolean,
    idFactory?: (prefix: string) => string
  ): LexeraDockTreeNode | null;
  createBoardTab(
    boardId: string,
    viewKind: string | null | undefined,
    idFactory?: (prefix: string) => string
  ): LexeraDockTreeBoardTab;
  createPanelTab(
    panelId: string,
    idFactory?: (prefix: string) => string
  ): LexeraDockTreePanelTab;
  /** Migrate the legacy `{left, right, bottom: Array<Array<string>>}`
   *  panel-docks shape (versions 1-3 of the persisted layout) to the
   *  current `sideDocks` tree shape (version 4). Returns a three-axis
   *  map of `DockTreeNode | null`. Used by layoutPersistence's
   *  `hydrate` when it encounters an older payload. */
  migratePanelDocksToSideDocks(
    panelDocks: { left?: Array<Array<string>>; right?: Array<Array<string>>; bottom?: Array<Array<string>> } | null | undefined,
    panelGroupActives: { [groupId: string]: string } | null | undefined,
    idFactory?: (prefix: string) => string
  ): { left: LexeraDockTreeNode | null; right: LexeraDockTreeNode | null; bottom: LexeraDockTreeNode | null };
  /** Find the leaf containing a board tab with the matching
   *  `boardId` AND `viewKind` (defaults via `normalizeViewKind`).
   *  Returns the hit record `{ tab, leaf }` or null. */
  findLeafContainingBoard(
    node: LexeraDockTreeNode | null,
    boardId: string,
    viewKind?: string
  ): { tab: LexeraDockTreeBoardTab; leaf: LexeraDockTreeLeaf } | null;
  /** Same as findLeafContainingBoard but matches the FIRST leaf
   *  containing any tab with the given boardId regardless of
   *  viewKind. Used by mutation-delegation paths that don't care
   *  which view variant is currently active. */
  findAnyLeafContainingBoard(
    node: LexeraDockTreeNode | null,
    boardId: string
  ): { tab: LexeraDockTreeBoardTab; leaf: LexeraDockTreeLeaf } | null;
  /** Find the leaf containing a panel tab whose `panelId` matches.
   *  `resolvePanelTarget` lets callers map a stored panel id to
   *  the runtime instance id. */
  findLeafContainingPanel(
    node: LexeraDockTreeNode | null,
    panelId: string,
    resolvePanelTarget?: (id: string) => string
  ): { tab: LexeraDockTreePanelTab; leaf: LexeraDockTreeLeaf } | null;
}

/**
 * Source: src/workspace/tabDragController.js (IIFE;
 * window.LexeraTabDragController = api). Pointer-based tab/panel
 * drag controller — owns the pointermove/pointerup listeners,
 * drop-zone highlight DOM, ghost element, and the
 * `state.pointerDrag` record (see WorkspaceShellDragState).
 *
 * Setup is keyed on a long deps bag the shell hands over; the
 * runtime API (handlePointerDown, clearDropZones) is what the
 * shell calls during normal drag flow.
 */
interface LexeraTabDragControllerApi {
  /** Wire the controller against the shell's helpers + state.
   *  Must be called once at boot before any handlePointerDown.
   *  Throws if any of the required dep keys is missing. */
  setup(deps: Record<string, unknown>): void;
  /** Pointer-down handler the shell installs on the tab-strip
   *  containers. Decides whether the gesture is a click vs the
   *  start of a drag and arms a global pointermove/pointerup
   *  pair when the latter is plausible. */
  handlePointerDown(event: PointerEvent): void;
  /** Reset every active drop-zone highlight + clear the tab-insert
   *  marker DOM. Exposed so the shell's `clearPanelDropTargets()`
   *  can call it without reaching into module internals. */
  clearDropZones(): void;
}

/**
 * Source: src/keybindingRegistry.js (IIFE;
 * window.LexeraKeybindingRegistry = api). User-keybinding store +
 * matcher + dispatcher. Keybindings are loaded once at boot from
 * the keybindings.json config; runtime callers ask the registry to
 * match a KeyboardEvent against the loaded set and then execute the
 * resolved binding (either inserting text into a textarea or
 * dispatching a board/card action via LexeraActionRegistry).
 */
interface LexeraKeybinding {
  /** Raw "Cmd+Shift+K" / "Ctrl+B" string the user typed. */
  key: string;
  /** Normalised combo (modifier flags + lowercase key). */
  combo: { ctrl: boolean; meta: boolean; shift: boolean; alt: boolean; key: string };
  /** Action id dispatched on match (e.g. 'insert-text', 'next-card'). */
  action: string;
  /** Context filter ('always' / 'editor' / 'card-focus' / 'board'). */
  when: string;
  /** Optional payload passed to the action handler. */
  args: Record<string, unknown> | null;
  /** Optional human-readable description for the help overlay. */
  description: string;
}

interface LexeraKeybindingRegistryApi {
  /** Load user bindings from a JSON string (the contents of
   *  keybindings.json). Empty / invalid input loads nothing but
   *  still flips isLoaded() to true. */
  loadFromJson(jsonString: string | null | undefined): void;
  /** Find the first binding matching (event, context). Context is
   *  one of the `when` values used during load. Returns null when
   *  no binding matches. */
  match(event: KeyboardEvent, context: string): LexeraKeybinding | null;
  /** Run a matched binding. Returns true when the action was
   *  handled, false otherwise. textarea + insertFn are required
   *  for `insert-text` / `insert-formatting` actions; other actions
   *  dispatch through LexeraActionRegistry. */
  execute(
    binding: LexeraKeybinding | null | undefined,
    textarea: HTMLTextAreaElement | null,
    insertFn: ((textarea: HTMLTextAreaElement, args: { snippet?: string } & Record<string, unknown>) => void) | null
  ): boolean;
  /** Snapshot of all loaded bindings (used by the help overlay). */
  getUserBindings(): LexeraKeybinding[];
  /** Format a key string ('Meta+Shift+K') for display, swapping
   *  symbols on macOS and word names elsewhere. */
  formatKeyDisplay(keyStr: string): string;
  /** Path of the keybindings.json on disk; persisted so reload can
   *  be wired to the same path the load came from. */
  setConfigPath(path: string | null): void;
  getConfigPath(): string | null;
  /** True after loadFromJson() has run at least once. */
  isLoaded(): boolean;
}

/**
 * Source: src/debug/debugApi.js (IIFE; window.LexeraDebug = api).
 * Runtime debug helpers reachable from DevTools — the user can flip
 * native-webview visibility, query the suppression state, or grab a
 * dock snapshot without rebuilding the app. Wraps existing
 * primitives (LexeraMultiviewWebview.setAllVisible +
 * LexeraWorkspaceShell._test_inspectDock).
 */
interface LexeraDebugApi {
  /** Hide (true) or restore (false) every child webview that floats
   *  above shell DOM. Returns ok=true when the multiview helper was
   *  available; ok=false + reason string when not (test/embedded
   *  contexts where LexeraMultiviewWebview is missing). */
  hideAllOverlays(hide: boolean): { ok: true; hidden: boolean }
                                | { ok: false; reason: string };
  /** Current suppression state (`true` = hidden, `false` = visible).
   *  `null` when the multiview helper is unavailable. */
  isOverlaysHidden(): boolean | null;
  /** Snapshot of one dock's resolved DOM/state for diagnostic
   *  output. Returns the shell's `_test_inspectDock` payload or
   *  ok=false + reason when the shell isn't mounted. */
  dockSnapshot(
    dockId: 'left' | 'right' | 'bottom' | string
  ): unknown;
}

/**
 * Source: lexera-shared/dialogs.js (synced into each app's src/ via
 * sync-runtime-assets; window.LexeraDialogs = api). Replaces native
 * window.confirm/prompt — using those is forbidden in this codebase
 * (memory: feedback_no_native_browser_popups).
 */
interface LexeraDialogsChooseOption<V = unknown> {
  /** Returned by the choose() promise when the user clicks this row. */
  value: V;
  /** Visible row label; falls back to `value` when omitted. */
  label?: string;
  /** Secondary line under the label. */
  hint?: string;
}

interface LexeraDialogsApi {
  /** Modal "Cancel / OK" confirm. Resolves true on OK, false on
   *  Cancel / Escape / overlay click. Routed through the multiview
   *  modal-as-window helper when available so it composites above
   *  child Tauri webviews. */
  confirm(message: string | null | undefined): Promise<boolean>;
  /** Modal text prompt. Resolves the typed string on OK, `null` on
   *  Cancel / Escape / overlay click. Initial value optional. */
  prompt(
    message: string | null | undefined,
    initialValue?: string | null,
    opts?: { title?: string }
  ): Promise<string | null>;
  /** Modal one-of-N picker. Resolves the matching option's `value`
   *  when clicked; `null` on Cancel / Escape / overlay click. */
  choose<V = unknown>(
    message: string | null | undefined,
    options: ReadonlyArray<LexeraDialogsChooseOption<V>>,
    opts?: { title?: string }
  ): Promise<V | null>;
}

/**
 * Source: src/workspace/geometryObserver.js (IIFE;
 * window.LexeraGeometryObserver = api). Factory + a per-instance
 * stateful API that wraps a single shared ResizeObserver watching
 * every `.ws-view-tabs` element in the workspace shell.
 */
interface LexeraGeometryObserverInstance {
  /** Recompute overflow for one header element + invoke the
   *  onTabsLayoutChanged hook. No-op when headerEl is falsy. */
  updateTabOverflow(headerEl: HTMLElement | null | undefined): void;
  /** Subscribe a header's `.ws-view-tabs` child to the shared
   *  ResizeObserver. Idempotent — repeated calls re-observe
   *  the same element. */
  observeTabOverflow(headerEl: HTMLElement | null | undefined): void;
  /** Disconnect the shared observer + cancel any pending rAF. */
  destroy(): void;
  /** Test seam: whether the lazy ResizeObserver has been created. */
  _test_hasObserver(): boolean;
  /** Test seam: the rAF id of the next scheduled flush
   *  (`0` when nothing pending). */
  _test_pendingRafId(): number;
}

/**
 * Source: src/dropzone/dropZoneIndicators.js (IIFE;
 * window.LexeraDropZoneIndicators = api). Builds the cosmetic
 * vertical/horizontal lines that paint between rows / stacks /
 * columns / cards during a drag, and activates the indicator nearest
 * the cursor as it moves. The `tree-*` drag-type variants are issued
 * by workspace-tree sub-apps so cross-view drags paint the same
 * indicators as in-view drags.
 */
type LexeraDropZoneDragType =
  | 'card' | 'tree-card'
  | 'board-row' | 'tree-row'
  | 'board-stack' | 'tree-stack'
  | 'column' | 'tree-column';

interface LexeraDropZoneIndicatorsDeps {
  /** Returns the board's main columns container element. */
  getElColumnsContainer(): HTMLElement | null;
  /** Returns true when the stack uses horizontal column layout. */
  isHorizontalCanvasStack(stackEl: Element | null): boolean;
}

interface LexeraDropZoneIndicatorsApi {
  init(deps: LexeraDropZoneIndicatorsDeps): void;
  /** Hit-target zones between stacks (used during stack drag). */
  insertStackDropZones(): void;
  removeStackDropZones(): void;
  /** Cosmetic line elements between siblings of the matching kind. */
  insertDropZoneIndicators(dragType: LexeraDropZoneDragType): void;
  removeDropZoneIndicators(): void;
  clearDropZoneIndicatorHighlights(): void;
  /** Highlight the indicator nearest the cursor at (mx, my). */
  highlightDropZoneIndicator(dragType: LexeraDropZoneDragType, mx: number, my: number): void;
}

/**
 * Source: src/sidebar/sidebarSync.js (IIFE;
 * window.LexeraSidebarSync = api). Owns the "sync sidebar with view"
 * highlight + the editable / read-only hierarchy lock + the sidebar
 * hierarchy burger menu. Two persisted prefs back the toggles
 * (`sidebarSync` global, `hierarchyLocked` per-window).
 */
interface LexeraSidebarSyncMenuItem {
  id?: string;
  label?: string;
  separator?: boolean;
}

interface LexeraSidebarSyncActionRegistry {
  dispatch(scope: string, action: string, args: Record<string, unknown>): void;
}

interface LexeraSidebarSyncDeps {
  getFocusedCardEl(): HTMLElement | null;
  getElColumnsContainer(): HTMLElement | null;
  getElBoardList(): HTMLElement | null;
  getSidebarTreeOwnerNode(el: Element | null): Element | null;
  renderBoardList(): void;
  /** Optional legacy sidebar-display menu items, inserted before the
   *  fold-all / unfold-all entries when present. */
  buildSidebarHierarchyDisplayMenuItems?: () => Array<LexeraSidebarSyncMenuItem>;
  formatMenuToggleLabel(on: boolean, label: string): string;
  showNativeMenu(
    items: Array<LexeraSidebarSyncMenuItem>,
    x: number,
    y: number,
    id: string
  ): Promise<string | null>;
  getActionRegistry(): LexeraSidebarSyncActionRegistry | null;
}

interface LexeraSidebarSyncApi {
  init(deps: LexeraSidebarSyncDeps): void;
  /** Highlight the sidebar tree node that matches the current viewport
   *  (focused card → first visible column). No-op when sync is off. */
  syncSidebarToView(): void;
  /** Highlight the node matching `selector`, expanding any collapsed
   *  ancestor tree-children containers along the way. */
  highlightSidebarNode(selector: string): void;
  toggleSidebarSync(): void;
  toggleSidebarLock(): void;
  /** Pop the hierarchy burger menu anchored at the given button. */
  showSidebarHierarchyMenu(anchorEl: HTMLElement | null): void;
  isSyncEnabled(): boolean;
  isHierarchyLocked(): boolean;
}

/**
 * Source: src/canvas/canvasMode.js (IIFE;
 * window.LexeraCanvasMode = api). Pure helpers consumed by canvas-mode
 * boards (free-form spatial layout) to parse the various title/param
 * micro-syntaxes: board-layout discrimination, grid-size normalisation,
 * `[#tag]{param:value, …}` connection specs, and the
 * percent/px column-width spec used by `width:` cells.
 */
interface LexeraCanvasConnectionSpec {
  targetTag: string;
  params: { [key: string]: string };
}

interface LexeraCanvasWidthSpec {
  kind: 'percent' | 'px';
  value: number;
}

interface LexeraCanvasModeHelpersDeps {
  /** Strip <!-- … --> comments before pattern matching. Defaults to a
   *  built-in implementation when omitted. */
  stripHtmlComments?: (text: string) => string;
}

interface LexeraCanvasModeHelpers {
  /** Normalise board-layout flag to either `'canvas'` or the fallback
   *  `'kanban'`. */
  normalizeBoardLayoutValue(value: unknown): 'canvas' | 'kanban';
  /** Normalise grid-size to one of `'off' | '16' | '32' | '64' |
   *  'largest' | <number-string>`. */
  normalizeCanvasGridValue(value: unknown): string;
  /** Parse `key1:val1, key2:val2` into a plain map. */
  parseCanvasParamMap(raw: string | null | undefined): { [key: string]: string };
  /** Pull every `[#tag]{params}` connection block out of a card title. */
  extractCanvasConnectionSpecs(
    title: string | null | undefined
  ): Array<LexeraCanvasConnectionSpec>;
  /** Parse `width:` cell values (fractions, percents, px). Returns
   *  `null` when the value isn't parseable. */
  getCanvasColumnWidthSpec(value: unknown): LexeraCanvasWidthSpec | null;
}

interface LexeraCanvasModeApi {
  createCanvasModeHelpers(deps?: LexeraCanvasModeHelpersDeps): LexeraCanvasModeHelpers;
}

/**
 * Source: src/canvas/canvasPan.js (IIFE;
 * window.LexeraCanvasPan = api). Registers a `canvas.move` drag handler
 * with LexeraControlsDispatcher — the dispatcher owns event wiring and
 * the (mode, action) match; this module owns only the pan state + the
 * apply-pan side effect, plus a scroll-suppression listener on the
 * document so accidental browser scroll never moves canvas content
 * (canvas mode uses pan-transform, not native scroll).
 */
interface LexeraCanvasPanDeps {
  getActiveBoardData(): unknown;
  isCanvasBoardLayout(): boolean;
  canStartCanvasPointerPan(target: EventTarget | null, button: number, altKey: boolean): boolean;
  getElColumnsContainer(): HTMLElement | null;
  getCanvasPanX(): number;
  getCanvasPanY(): number;
  applyCanvasPan(panX: number, panY: number): void;
}

interface LexeraCanvasPanApi {
  init(deps: LexeraCanvasPanDeps): void;
  detach(): void;
  isPanning(): boolean;
  cancelPan(): void;
}

/**
 * Source: src/canvas/canvasLayout.js (IIFE;
 * window.LexeraCanvasLayout = api). Pure geometry helpers for canvas
 * mode — anchor resolution on rectangular boxes, default connection
 * sides, Bézier path generation, stack-direction / tag extraction,
 * and per-column flex/width application based on `w:` params.
 */
interface LexeraCanvasBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

type LexeraCanvasSide = 'left' | 'right' | 'top' | 'bottom' | 'center';

interface LexeraCanvasAnchor {
  x: number;
  y: number;
  side: LexeraCanvasSide;
}

/** Pulled out so `resolveCanvasConnectionAnchor` can be called with
 *  either source-side or target-side parameter keys. */
interface LexeraCanvasAnchorKeys {
  side: string;
  aliasSide: string;
  position: string;
  x: string;
  y: string;
}

interface LexeraCanvasLayoutDeps {
  stripLayoutTags?: (text: string | null | undefined) => string;
  getCanvasColumnWidthSpec?: (value: unknown) => { kind: 'percent' | 'px'; value: number } | null;
}

interface LexeraCanvasLayoutApi {
  init(deps: LexeraCanvasLayoutDeps): void;
  normalizeCanvasStackDirection(value: unknown): 'row' | 'column';
  normalizeCanvasAnchorSide(value: unknown, fallback: LexeraCanvasSide): LexeraCanvasSide;
  parseCanvasAnchorOffset(
    value: unknown,
    size: number,
    start: number,
    center: number,
    end: number
  ): number | null;
  getDefaultCanvasConnectionSide(
    sourceBox: LexeraCanvasBox,
    targetBox: LexeraCanvasBox,
    role: 'source' | 'target'
  ): LexeraCanvasSide;
  resolveCanvasConnectionAnchor(
    box: LexeraCanvasBox,
    params: { [key: string]: string },
    keys: LexeraCanvasAnchorKeys,
    fallbackSide?: LexeraCanvasSide
  ): LexeraCanvasAnchor;
  canvasSideToVector(side: LexeraCanvasSide | string): { x: number; y: number };
  getCanvasConnectionPath(
    sourceAnchor: LexeraCanvasAnchor,
    targetAnchor: LexeraCanvasAnchor
  ): string;
  extractCanvasStackTags(title: string | null | undefined): string[];
  applyCanvasColumnLayout(
    colEl: HTMLElement | null,
    col: { params?: { [key: string]: string } } | null | undefined
  ): void;
}

/**
 * Source: src/keyboard/appShellShortcuts.js (IIFE;
 * window.LexeraAppShellShortcuts = api). Routes a handful of cmd/ctrl
 * keyboard shortcuts to the workspace shell when one is present —
 * close-active-tab, next/prev tab, toggle hierarchy/dashboard/files
 * panel. Returns true when the event was handled so the caller knows
 * to stop bubbling.
 */
interface LexeraAppShellShortcutsWorkspaceShell {
  handleBoardAction(action: string): void;
}

interface LexeraAppShellShortcutsDeps {
  workspaceShellEnabled: boolean;
  WorkspaceShell: LexeraAppShellShortcutsWorkspaceShell | null | undefined;
  isEditing: boolean;
}

interface LexeraAppShellShortcutsApi {
  dispatchWorkspaceShellAction(event: KeyboardEvent, deps: LexeraAppShellShortcutsDeps): boolean;
}

/**
 * Source: src/actionRegistry.js (IIFE;
 * window.LexeraActionRegistry = api). Pluggable per-scope action
 * dispatcher used by burger menus, native menu bar, hierarchy entity
 * actions, etc. Each scope registers patterns (`'string'`, `'prefix*'`,
 * or a RegExp); `dispatch(scope, action, ctx)` finds the first match
 * and runs the handler.
 */
type LexeraActionPattern = string | RegExp;
type LexeraActionHandler = (action: string, context: Record<string, unknown>) => void;

type LexeraParsedActionPattern =
  | { type: 'exact'; value: LexeraActionPattern; raw: LexeraActionPattern }
  | { type: 'prefix'; prefix: string; raw: LexeraActionPattern }
  | { type: 'regex'; regex: RegExp; raw: string };

interface LexeraActionRegistryEntry {
  parsed: LexeraParsedActionPattern;
  handler: LexeraActionHandler;
}

interface LexeraActionRegistryApi {
  register(scope: string, pattern: LexeraActionPattern, handler: LexeraActionHandler): void;
  registerGroup(
    scope: string,
    entries: Array<[LexeraActionPattern, LexeraActionHandler]>
  ): void;
  dispatch(
    scope: string,
    action: string | null | undefined,
    context?: Record<string, unknown>
  ): boolean;
  find(scope: string, action: string): LexeraActionRegistryEntry | null;
}

/**
 * Source: src/contentEnhancerRegistry.js (IIFE;
 * window.LexeraContentEnhancerRegistry = api). Facade over
 * LexeraPluginRegistry for content-enhancer plugins (mermaid,
 * excalidraw, code-highlight, etc.). Each enhancer matches a CSS
 * selector against rendered card content and either runs the enhance
 * fn immediately or defers it via IntersectionObserver when `lazy`.
 */
interface LexeraContentEnhancer {
  id: string;
  name?: string;
  version?: string;
  /** Lower priority runs first (ascending sort in `getAll()`). */
  priority?: number;
  /** CSS selector matched against `root`. Falsy = root-wide enhance. */
  selector?: string;
  /** When true the enhance call is deferred until the element scrolls
   *  into the lazy observer's intersection margin. */
  lazy?: boolean;
  enhance(el: Element, context: unknown): void;
  kind?: string;
  metadata?: { id: string; name: string; version: string; priority: number };
}

interface LexeraContentEnhancerRegistryApi {
  register(enhancer: LexeraContentEnhancer): void;
  remove(id: string): void;
  /** Returns enhancers sorted by ascending `priority`. */
  getAll(): Array<LexeraContentEnhancer>;
  /** Walk every registered enhancer against `root` + (lazy)
   *  IntersectionObserver. */
  enhance(root: Element | null | undefined, context: unknown): void;
  observeLazyImages(root: Element | Document | null | undefined): void;
}

/**
 * Source: src/views/inspector/inspector.js. Test seam published as
 * window.LexeraInspectorTestApi when the inspector view boots — lets
 * Vitest integration tests drive the destroy/reload buttons and
 * snapshot the visible state without simulating raw clicks.
 */
/**
 * Source: src/views/files/files.js. Test seam published as
 * window.LexeraFilesTestApi when the files sub-app boots — surfaces
 * mount status / error sub-tree and the management-refresh hook the
 * shell fires across the IPC bus. Sibling of {Dashboard, Workspaces,
 * Hierarchy, Log, Inspector}TestApi seams.
 */
interface LexeraFilesTestApiState {
  mounted: boolean;
  error: string | null;
  loadingClass: boolean;
  errorText: string;
  hasErrorBlock: boolean;
}

interface LexeraFilesTestApi {
  collectState(): LexeraFilesTestApiState;
  triggerManagementRefresh(section?: string): boolean;
}

/**
 * Source: src/views/_shared/calendarRuntime.js (IIFE;
 * window.LexeraCalendarRuntime = api). Renders the week / month
 * calendar grids and task list for sub-app webviews — backend-fetched
 * task data via `LexeraApi.getCalendarTasks`, polled with a
 * configurable interval, also re-fetches on `management-board-mutation`
 * events.
 */
interface LexeraCalendarTask {
  due: string;
  title: string;
  boardId: string;
  boardName: string;
  cardId: string;
}

interface LexeraCalendarMountOptions {
  /** Grid kind — 'week' renders 7-day; 'month' renders a calendar
   *  grid. Anything else falls back to 'week'. */
  kind?: 'week' | 'month';
  /** Re-fetch interval in milliseconds. Default 30000; pass 0 to
   *  disable polling. */
  pollMs?: number;
  [k: string]: unknown;
}

interface LexeraCalendarMountInstance {
  refresh(): void;
}

interface LexeraCalendarRuntimeApi {
  /** Format `Date` as YYYY-MM-DD. */
  ymd(date: Date): string;
  startOfWeek(date: Date): Date;
  startOfMonth(date: Date): Date;
  renderWeekGrid(host: HTMLElement | null, tasks: Array<LexeraCalendarTask>, refDate?: Date): void;
  renderMonthGrid(host: HTMLElement | null, tasks: Array<LexeraCalendarTask>, refDate?: Date): void;
  renderTaskList(host: HTMLElement | null, tasks: Array<LexeraCalendarTask>): void;
  normalizeTasks(arr: unknown): Array<LexeraCalendarTask>;
  fetchCalendarTasks(opts?: Record<string, unknown>): Promise<Array<LexeraCalendarTask>>;
  mount(panelEl: Element | null, opts?: LexeraCalendarMountOptions): LexeraCalendarMountInstance;
}

/**
 * Source: src/views/debug/debug.js. Test seam published as
 * window.LexeraDebugWindow when the `--debug` window boots — lets
 * Vitest drive the controller (overlays toggle, snapshot refresh,
 * frontend-tests open, render-profile start/stop, JSON copy)
 * without simulating raw clicks. Internal state + helper functions
 * exposed via `_test_*` prefixed properties.
 */
interface LexeraDebugWindowState {
  overlaysHidden: boolean;
}

interface LexeraDebugWindowProfileState {
  running: boolean;
  lastPayload: unknown;
}

interface LexeraDebugWindowTestApi {
  _test_emit(eventName: string, payload?: unknown): Promise<unknown>;
  _test_listen(eventName: string, handler: (...args: unknown[]) => void): Promise<() => void>;
  _test_state: LexeraDebugWindowState;
  _test_toggleOverlays(): void;
  _test_refreshSnapshots(): void;
  _test_openFrontendTests(): void;
  _test_setOverlayStatusUi(hidden: boolean): void;
  _test_startRenderProfile(): void;
  _test_stopRenderProfile(): void;
  _test_profileState: LexeraDebugWindowProfileState;
  _test_readProfileDurationMs(): number;
  _test_copyProfileAsJson(): void;
}

/**
 * Source: src/views/_shared/settingsRuntime.js (IIFE;
 * window.LexeraSettingsRuntime = api). Shared scaffolding for the
 * frontend / backend / files / etc. settings sub-app webviews —
 * exposes a `buildFrontendSettingsOptions()` shape compatible with
 * the legacy `frontendSettings.init()` deps bag, a backend API
 * adapter (delegates to `LexeraApi.request`), a callback bag for
 * `ManagementUI.init`, plus localStorage get/set + multiview
 * broadcast primitives.
 */
interface LexeraSettingsRuntimeBackendApiAdapter {
  get(path: string, options?: unknown): Promise<unknown>;
  post(path: string, body?: unknown): Promise<unknown>;
  put(path: string, body?: unknown): Promise<unknown>;
  delete(path: string): Promise<unknown>;
}

interface LexeraSettingsRuntimeApi {
  /** Options bag compatible with `frontendSettings.init` — visual
   *  theme, UI scale, scroll/zoom speed, tag visibility, html-comment /
   *  html-content modes, editor toggles, and the legacy menu hooks. */
  buildFrontendSettingsOptions(): Record<string, unknown>;
  /** Adapter that funnels HTTP-shaped calls (`get`/`post`/`put`/
   *  `delete`) through `LexeraApi.request`. Throws when LexeraApi
   *  isn't on the window yet. */
  buildBackendApiAdapter(): LexeraSettingsRuntimeBackendApiAdapter;
  /** Callback bag for `ManagementUI.init` — notification, confirm
   *  modal, board mutation broadcasts, server restart, etc. */
  buildBackendCallbacks(): Record<string, unknown>;
  /** Multiview event broadcast helper. */
  broadcast(event: string, payload?: Record<string, unknown>): void;
  /** localStorage `getItem` with default-fallback. */
  getLs(key: string, fallback: string): string;
  /** localStorage `setItem` with stringification + try/catch. */
  setLs(key: string, value: unknown): void;
}

/**
 * Source: src/visualThemes.js (IIFE; window.LEXERA_VISUAL_THEMES + 5
 * helper functions exposed on the Window). Built-in themes are
 * `warm-paper` (default) and `no-style`; user themes are discovered
 * from the on-disk themes directory at runtime.
 */
interface LexeraVisualTheme {
  id: string;
  /** Inherited base theme id (e.g. starter themes share `warm-paper`'s
   *  visuals as a baseline). */
  baseId?: string;
  name: string;
  description?: string;
  /** When true, the theme is the explicit "no overrides" choice and
   *  should leave app.css alone. */
  noStyle?: boolean;
  /** Build-time `'builtin'` themes vs runtime-discovered `'user'`
   *  themes. */
  source: 'builtin' | 'user' | string;
  [k: string]: unknown;
}

/**
 * Source: src/sidebar/sidebarTree.js (IIFE;
 * window.LexeraSidebarTree = api). Helpers for rendering the kanban
 * sidebar's expanded board hierarchy view — card counts per row/stack,
 * hidden-card detection, preview text extraction, and the recursive
 * tree-node builder consumed by the sidebar TreeView.
 */
interface LexeraSidebarTreeStack {
  columns?: Array<{ cards?: Array<unknown> }>;
}

interface LexeraSidebarTreeRow {
  stacks?: Array<LexeraSidebarTreeStack>;
}

interface LexeraSidebarTreeState {
  rows?: Array<string>;
  stacks?: Array<string>;
  columns?: Array<string>;
}

interface LexeraSidebarTreeOptions {
  stripLayoutTags?: (text: string | null | undefined) => string;
  getDisplayOrderedColumnEntries?: (
    columns: Array<unknown>
  ) => Array<{ col: unknown; fullIndex: number }>;
}

interface LexeraSidebarTreeApi {
  isHiddenCard(content: string | null | undefined): boolean;
  countCardsInRow(row: LexeraSidebarTreeRow | null | undefined): number;
  countCardsInStack(stack: LexeraSidebarTreeStack | null | undefined): number;
  cardPreviewText(content: string | null | undefined): string;
  buildSidebarTreeNodes(
    rows: Array<LexeraSidebarTreeRow> | null | undefined,
    boardId: string,
    treeState: LexeraSidebarTreeState | null | undefined,
    hasTreeState: boolean,
    options?: LexeraSidebarTreeOptions
  ): Array<unknown>;
}

/**
 * Source: src/app.js (the giant LexeraDashboard IIFE;
 * `window.LexeraDashboard = api`). Exposes the legacy dashboard view
 * controls + the mutation entrypoints the workspace shell delegates
 * into when the user drags a hierarchy node onto the parent shell's
 * sidebar — without those, mutations triggered from the parent's
 * sidebar tree would land on a detached `fullBoardData` copy and be
 * lost.
 *
 * Most parameter shapes pass through to internal mutation routines
 * (`moveCard` / `moveStack` / `moveColumnWithinBoard` / etc.) whose
 * source/target descriptors mix board-relative coordinates with
 * stable ids. The shapes are typed loosely as `unknown` for now —
 * a future slice can narrow each entrypoint when the consumer side
 * is also brought into the typedef gate.
 */
interface LexeraDashboardApi {
  poll(): unknown;
  showElementContextMenu(...args: unknown[]): unknown;
  getFullBoardData(): unknown;
  getActiveBoardId(): string;
  openDashboardSearch(...args: unknown[]): unknown;
  openEditForHierarchyTarget(...args: unknown[]): unknown;
  /** Mutation entrypoints — workspace shell delegates here. */
  moveCard(source: unknown, target: unknown): unknown;
  reorderRows(s: unknown, t: unknown, b?: unknown): unknown;
  moveStack(fromRow: unknown, fromStack: unknown, toRow: unknown, toStack: unknown, boardId?: unknown): unknown;
  moveColumnWithinBoard(
    fromRow: unknown, fromStack: unknown, fromCol: unknown,
    toRow: unknown, toStack: unknown, toCol: unknown,
    boardId?: unknown
  ): unknown;
  moveColumnToExistingStack(
    fromRow: unknown, fromStack: unknown, fromCol: unknown,
    toRow: unknown, toStack: unknown
  ): unknown;
  commitHierarchyTreeEdit(boardId: string, boardData: unknown, options?: unknown): unknown;
}

/**
 * Source: src/hierarchy/hierarchyController.js (IIFE;
 * window.LexeraHierarchyController = api). Binds click / context-menu
 * / dblclick / keyboard handlers to a tree element. Each handler is
 * opt-in via the options bag; capabilities (drag / menu / activate /
 * edit) are validated against the hierarchy contract before firing.
 */
interface LexeraHierarchyControllerHelpers {
  toggleNode(node: Element, event?: Event): void;
  [k: string]: unknown;
}

interface LexeraHierarchyControllerOptions {
  HierarchyContract?: unknown;
  menuSelector?: string;
  toggleSelector?: string;
  gripSelector?: string;
  onGripClick?: (node: Element | null, event: Event, helpers: LexeraHierarchyControllerHelpers) => void;
  onNodeMenu?: (node: Element | null, event: Event, helpers: LexeraHierarchyControllerHelpers) => void;
  onNodeActivate?: (node: Element | null, event: Event, helpers: LexeraHierarchyControllerHelpers) => void;
  onNodeContextMenu?: (node: Element | null, event: Event, helpers: LexeraHierarchyControllerHelpers) => void;
  onNodeEdit?: (node: Element | null, event: Event, helpers: LexeraHierarchyControllerHelpers) => void;
  [k: string]: unknown;
}

interface LexeraHierarchyControllerInlineEditHandle {
  node: Element;
  labelEl: Element | null;
  input: HTMLInputElement | HTMLTextAreaElement | null;
  cancel(): void;
  commit(): void;
}

interface LexeraHierarchyControllerApi {
  bindTreeInteractions(targetEl: Element | null, options?: LexeraHierarchyControllerOptions): Element | null;
  findTreeNode(target: EventTarget | null, container?: Element | null): Element | null;
  closestWithin(target: EventTarget | null, selector: string, container?: Element | null): Element | null;
  beginInlineLabelEdit(
    node: Element | null,
    options?: Record<string, unknown>
  ): LexeraHierarchyControllerInlineEditHandle | null;
}

/**
 * Source: src/tagSystem.js (IIFE; window.LexeraTagSystem = api). Pure
 * tag-handling utilities — layout-tag vocabulary, internal hidden-tag
 * markers, header-tag tokenization, tag expressions, query helpers, and
 * tag manipulation. Single source of truth for `row(N)` / `span(N)` /
 * `stack` / `header` / `footer` / `wip-N` / `sticky` / `width{N}` /
 * `height{N}` layout tag patterns.
 */
interface LexeraTagSystemLayoutTagDef {
  name: string;
  pattern: string;
  type: 'numeric' | 'boolean' | 'braced';
  negate: string | null;
}

interface LexeraTagSystemExtractedLayoutTags {
  [tagName: string]: number | boolean | string | null;
}

interface LexeraTagSystemTokenOptions {
  includeOffsets?: boolean;
  [k: string]: unknown;
}

interface LexeraTagSystemApi {
  LAYOUT_TAGS: Array<LexeraTagSystemLayoutTagDef>;
  INTERNAL_HIDDEN_SUFFIXES: Array<string>;

  // Layout tag operations
  stripLayoutTags(title: string | null | undefined): string;
  stripLegacyStructureTags(title: string | null | undefined): string;
  isLayoutTag(tagName: string | null | undefined): boolean;
  extractLayoutTags(title: string | null | undefined): LexeraTagSystemExtractedLayoutTags;
  reconstructTitle(userInput: string | null | undefined, originalTitle: string | null | undefined): string;
  getElementSizeTag(title: string | null | undefined, tagName: 'width' | 'height' | string): string | null;

  // Internal hidden tag operations
  isArchivedOrDeleted(text: string | null | undefined): boolean;
  hasInternalHiddenTag(text: string | null | undefined, tag: string): boolean;
  stripInternalHiddenTags(text: string | null | undefined): string;
  applyInternalHiddenTag(text: string | null | undefined, tag: string): string;

  // Header tag tokenization
  isTagTokenBoundaryChar(ch: string): boolean;
  normalizeTagTokenForMatch(token: string | null | undefined): string;
  collectHeaderTagTokens(text: string | null | undefined, options?: LexeraTagSystemTokenOptions): Array<string | { token: string; start: number; end: number }>;

  // Tag expressions
  isTagExpression(tagName: string | null | undefined): boolean;
  evaluateTagExpression(expression: string, tagLookup: (tag: string) => boolean): boolean;
  tokenizeTagExpression(expression: string): Array<unknown>;

  // Tag query
  extractAllTags(text: string | null | undefined): Array<string>;
  hasTag(text: string | null | undefined, tagName: string): boolean;

  // Tag classification
  isNumericIndexTag(tagName: string | null | undefined): boolean;
  isTagStyleEligible(tagName: string | null | undefined): boolean;

  // Tag manipulation
  normalizePromptTagToken(rawToken: string | null | undefined): string;
  parsePromptTagList(rawInput: string | null | undefined): Array<string>;
  removeTagFromHeader(headerText: string | null | undefined, tagName: string): string;
  addTagToHeader(headerText: string | null | undefined, tagName: string): string;
  replaceTagInHeader(headerText: string | null | undefined, oldTag: string, newTag: string): string;
  clearRemovableTags(headerText: string | null | undefined): string;
}

/**
 * Source: src/workspace/multiviewWebview.js (IIFE;
 * window.LexeraMultiviewWebview = api). Manages the lifecycle of
 * native Tauri child webviews (board + panel tabs) on top of the
 * shell DOM — `ensure`/`destroy` spawn-or-reuse, geometry sync,
 * health-status dots, and the cursor → label hit-test used by the
 * cross-Tauri-webview drag router.
 *
 * Internal `_test_*` seams are typed loosely (the gate already covers
 * the file's body; the test seams are exposed for Vitest to drive the
 * Phase 4.1 placeholder observer and the slot-map diff cache without
 * a real shell mount).
 */
interface LexeraMultiviewWebviewHealth {
  status?: string;
  message?: string;
  [k: string]: unknown;
}

interface LexeraMultiviewWebviewGeometry {
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  [k: string]: unknown;
}

interface LexeraMultiviewWebviewRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface LexeraMultiviewWebviewHostGeometryContext {
  x: number;
  y: number;
  width: number;
  height: number;
  ready: boolean;
}

interface LexeraMultiviewWebviewSetupDeps {
  getPlaceholder(tabId: string): HTMLElement | null;
  [k: string]: unknown;
}

interface LexeraMultiviewWebviewApi {
  setup(deps: LexeraMultiviewWebviewSetupDeps): void;
  ensure(tab: { id: string; [k: string]: unknown }, placeholderEl: HTMLElement | null, desiredSrc?: string): void;
  destroy(tabId: string): void;
  cleanupLocalState(tabId: string): void;
  refreshAllGeometry(): void;
  /** Cursor → spawned-webview-label hit-test (top-window coords). */
  getWebviewLabelAtTopPoint(topX: number, topY: number): string | null;
  /** Top-window rect for a given spawned webview, or null when not
   *  ready / not laid out. */
  getWebviewRect(label: string): LexeraMultiviewWebviewRect | null;
  setAllVisible(visible: boolean): void;
  isAllVisibleSuppressed(): boolean;
  computeNativeGeometry(label: string, placeholderEl: HTMLElement | null): LexeraMultiviewWebviewGeometry | null;
  getNativeGeometryConfig(): Record<string, unknown>;
  getHostGeometryContext(): LexeraMultiviewWebviewHostGeometryContext;
  refreshHostGeometryContext(force?: boolean): Promise<LexeraMultiviewWebviewHostGeometryContext>;
  getDebugGeometryOverride(label: string): { x: number; y: number; width: number; height: number };
  applyHealth(tabId: string, health: LexeraMultiviewWebviewHealth | null | undefined): void;
  reapplyAllHealthDots(): void;
  labelForTab(tab: { id: string; [k: string]: unknown }): string;
  labelForTabId(tabId: string): string;
  tabIdFromLabel(label: string): string;
  spawnedLabel(tabId: string): string;
  destroyAll(): void;
  noteLocalDestroy(label: string): void;
  // Internal test seams — typed loosely (consumed only by Vitest).
  _test_installPhaseFourPlaceholderObserver: (...args: unknown[]) => unknown;
  _test_phaseFourCollectRemovedTabIds: (...args: unknown[]) => unknown;
  _test_phaseFourCheckPending: (...args: unknown[]) => unknown;
  _test_phaseFourPendingState(): Record<string, number>;
  _test_phaseFourResetState(): void;
  _test_pushGeometryForLabel(label: string, placeholderEl: HTMLElement | null): void;
  _test_lastPushedGeometryByLabel(): Record<string, { x: number; y: number; width: number; height: number }>;
  _test_leakReport(): {
    spawnedTabs: number;
    spawnedDetail: Record<string, unknown>;
    spawnedTabIds: string[];
    geometryObservers: number;
    spawnRetryWatchers: number;
    spawnLocks: number;
  };
}

/**
 * Source: src/settings/renderAppsSettings.js (IIFE;
 * window.LexeraRenderAppsSettings = api). Manages the render-apps
 * (Mermaid, Excalidraw, Marp, etc.) settings panel — discovery,
 * status caching, and theme-list refresh.
 */
interface LexeraRenderAppsSettingsApi {
  render(panel: Element | null): void;
  init(panel: Element | null): void;
  destroy(panel: Element | null): void;
  reload(panel: Element | null): void;
  ensureDiscovery(): Promise<unknown>;
  refreshDiscovery(): Promise<unknown>;
  getCachedStatus(): unknown;
  getCachedThemes(): unknown;
  onDiscoveryChange(handler: (snapshot: unknown) => void): () => void;
}

/**
 * Source: src/views/renderApps/renderApps.js. Test seam published as
 * window.LexeraRenderAppsTestApi when the renderApps sub-app boots —
 * surfaces mount status, status text in the panel, and the error
 * landing state. Sibling of {Dashboard, Workspaces, Hierarchy, Log,
 * Inspector, Files}TestApi seams.
 */
interface LexeraRenderAppsTestApiState {
  initialised: boolean;
  error: string;
  statusText: string;
  hasErrorBlock: boolean;
}

interface LexeraRenderAppsTestApi {
  collectState(): LexeraRenderAppsTestApiState;
}

/**
 * Source: src/views/backendSettings/backendSettings.js. Test seam
 * published as window.LexeraBackendSettingsTestApi when the sub-app
 * boots — surfaces mount status + the management-refresh hook the
 * shell fires. Same shape as the other ManagementUI-wrapper test
 * seams.
 */
interface LexeraBackendSettingsTestApiState {
  mounted: boolean;
  error: string;
  loadingClass: boolean;
  errorText: string;
  hasErrorBlock: boolean;
}

interface LexeraBackendSettingsTestApi {
  collectState(): LexeraBackendSettingsTestApiState;
  triggerManagementRefresh(section?: string): boolean;
}

/**
 * Source: src/settings/frontendSettings.js (IIFE;
 * window.LexeraFrontendSettings = api). Initializes / re-renders the
 * frontend settings panel from a `LexeraSettingsRuntime`-built
 * options bag. The settings sub-app bootstrap calls `init` once and
 * `render` on subsequent visual-theme registry changes.
 */
interface LexeraFrontendSettingsApi {
  init(options: Record<string, unknown>, panel: Element | null): void;
  render(options: Record<string, unknown>, panel: Element | null): void;
  open(...args: unknown[]): unknown;
}

/**
 * Source: src/views/frontendSettings/frontendSettings.js. Test seam
 * published as window.LexeraFrontendSettingsTestApi when the sub-app
 * boots — surfaces mount status + error state + a hook that
 * dispatches `lexera-visual-themes-changed` so tests can drive the
 * re-render path.
 */
interface LexeraFrontendSettingsTestApiState {
  booted: boolean;
  hasError: boolean;
  errorText: string;
  lastError: string;
}

interface LexeraFrontendSettingsTestApi {
  collectState(): LexeraFrontendSettingsTestApiState;
  triggerVisualThemesChanged(): boolean;
}

/**
 * Source: src/views/dashboard/dashboard.js. Test seam published as
 * window.LexeraDashboardTestApi when the dashboard sub-app boots —
 * surfaces visible state (loading / query / mounted board lists +
 * card ids) and drives search + mirror-update + node-click without
 * simulating raw user input.
 */
interface LexeraDashboardTestApiListSummary {
  cardIds: string[];
  nodeCount: number;
  htmlLength: number;
}

interface LexeraDashboardTestApiState {
  mounted: boolean;
  loading: boolean;
  receivedFirstSnapshot: boolean;
  query: string;
  allBoards: boolean;
  activeBoardId: string;
  lists: { [listId: string]: LexeraDashboardTestApiListSummary };
}

interface LexeraDashboardTestApi {
  collectState(): LexeraDashboardTestApiState;
  setSearch(query: string, allBoards?: boolean): void;
  applyMirror(snapshot: Record<string, unknown> | null | undefined): void;
  clickCard(cardId: string, listId?: string): unknown;
}

/**
 * Source: src/devtools/devtoolsTitle.js (IIFE;
 * window.LexeraDevtoolsTitle = api). Pure helper for app.js's
 * document.title decoration. Picks the most human-readable
 * identifier from the URL params so each DevTools inspector window
 * is named after the thing the user actually cares about.
 */
interface LexeraDevtoolsTitleApi {
  /** Short-hand a long opaque id (board id, workspace id) for display
   *  in window-chrome real estate. ≤12 chars passes through; longer
   *  collapses to `<first-8>…<last-3>`. */
  shortHash(value: unknown): string;
  /** Compute the `<title>` suffix from URL params + the window label.
   *  Returns an empty string for the boot main shell (no decoration). */
  deriveSuffix(
    urlParams: URLSearchParams | Record<string, unknown> | null | undefined,
    windowLabel: string | null | undefined
  ): string;
}

/**
 * Source: src/boardSettingRegistry.js (IIFE;
 * window.LexeraBoardSettingRegistry = api). Per-board-setting
 * descriptor registry — each descriptor declares an `id`, an
 * `actionPrefix` for menu-action routing, and an `options` list (or
 * factory returning one). The registry's `buildMenuItems` helper
 * assembles a native context-menu items array decorated with a ✓
 * checkmark for the current value.
 */
interface LexeraBoardSettingOption {
  value?: unknown;
  label?: string;
  separator?: boolean;
}

interface LexeraBoardSettingDescriptor {
  id: string;
  category?: string;
  actionPrefix: string;
  options?: Array<LexeraBoardSettingOption> | (() => Array<LexeraBoardSettingOption>) | null;
}

interface LexeraBoardSettingMenuItem {
  id?: string;
  label?: string;
  separator?: boolean;
}

interface LexeraBoardSettingRegistryApi {
  register(desc: LexeraBoardSettingDescriptor): void;
  get(id: string): LexeraBoardSettingDescriptor | null;
  getAll(): Array<LexeraBoardSettingDescriptor>;
  getByCategory(category: string): Array<LexeraBoardSettingDescriptor>;
  buildMenuItems(id: string, currentValue: unknown): Array<LexeraBoardSettingMenuItem>;
}

/**
 * Source: src/menuContributorRegistry.js (IIFE;
 * window.LexeraMenuContributorRegistry = api). Facade over
 * `LexeraPluginRegistry` for menu contributors — each contributor
 * declares `scopes` it applies to, an optional `section` for
 * separator placement, and a `build(scope, context)` callback that
 * returns the items to splice into the menu.
 */
interface LexeraMenuContributorItem {
  id?: string;
  label?: string;
  separator?: boolean;
}

interface LexeraMenuContributor {
  id?: string;
  name?: string;
  version?: string;
  priority?: number;
  /** Used by `buildMenu` to insert separators between sections. */
  section?: string;
  scopes?: Array<string>;
  build(scope: string, context: unknown): Array<LexeraMenuContributorItem>;
  kind?: string;
  metadata?: { id: string; name: string; version: string; priority: number };
}

interface LexeraMenuContributorRegistryApi {
  register(contributor: LexeraMenuContributor): void;
  getForScope(scope: string): Array<LexeraMenuContributor>;
  remove(id: string): void;
  buildMenu(scope: string, context: unknown): Array<LexeraMenuContributorItem>;
}

/**
 * Source: src/canvas/canvasDom.js (IIFE;
 * window.LexeraCanvasDom = api). Tiny helper that resolves the
 * `.board-row-content` DOM node from a canvas drop-target descriptor.
 */
interface LexeraCanvasDomDropTarget {
  node?: Element | null;
  contentNode?: Element | null;
}

interface LexeraCanvasDomApi {
  getCanvasRowContentNodeFromDropTarget(
    target: LexeraCanvasDomDropTarget | null | undefined,
    fallbackNode?: Element | null
  ): Element | null;
}

/**
 * Source: src/themes.js. Built-in palette object exposed as the
 * top-level `LEXERA_THEMES` array (no IIFE; the `var LEXERA_THEMES =
 * [...]` literal becomes a window-scope global at script-top).
 */
interface LexeraBaseTheme {
  id: string;
  name: string;
  light: { [cssVar: string]: string };
  dark: { [cssVar: string]: string };
}

/**
 * Source: src/core/viewStateStore.js (IIFE;
 * window.LexeraViewState = api). Thin observable wrapper over
 * LexeraRuntime's state store. Registers a handful of well-known
 * UI-state keys (searchMode / isEditing / connected / embeddedMode /
 * headerSearchExpanded / addCardColumn) so any module can read,
 * write, and subscribe without ad-hoc closure variables.
 */
interface LexeraViewStateKeyDefaults {
  searchMode: boolean;
  isEditing: boolean;
  connected: boolean;
  embeddedMode: boolean;
  headerSearchExpanded: boolean;
  addCardColumn: string | null;
}

interface LexeraViewStateApi {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  on(key: string, fn: (value: unknown, oldValue: unknown) => void): () => void;
  KEYS: LexeraViewStateKeyDefaults;
}

/**
 * Source: src/diagramRegistry.js (IIFE;
 * window.LexeraDiagramRegistry = api). Facade over
 * `LexeraPluginRegistry` for diagram-rendering plugins (mermaid,
 * plantuml, etc.). The `flush()` helper batches enqueued render
 * requests by pluginId, lazily inits the plugin if needed, and runs
 * each `render(...)` promise.
 */
interface LexeraDiagramPlugin {
  id: string;
  languages: Array<string>;
  render(elementId: string, code: string, boardId?: string | null): Promise<string>;
  isReady(): boolean;
  init(): Promise<unknown>;
  kind?: string;
  metadata?: { id: string; name: string; version: string };
}

interface LexeraDiagramRegistryApi {
  register(plugin: LexeraDiagramPlugin): void;
  getById(id: string): LexeraDiagramPlugin | null;
  findByLanguage(lang: string): LexeraDiagramPlugin | null;
  getAll(): Array<LexeraDiagramPlugin>;
  nextId(prefix: string): string;
  enqueue(pluginId: string, elementId: string, code: string, boardId?: string | null): void;
  flush(): void;
}

/**
 * Source: src/canvas/stackDrop.js (IIFE;
 * window.LexeraCanvasStackDrop = api). Resolves a canvas-mode
 * stack-drop target (row + 2D position) from a pointer (`clientX`,
 * `clientY`) using injected DOM accessors; `applyCanvasDropPositionToStack`
 * writes the resolved coordinates onto the stack's `params.x` /
 * `params.y` so the persistence layer carries them through.
 */
interface LexeraCanvasStackDropApi {
  resolveCanvasStackDropTarget(
    options: Partial<{
      isCanvasLayout: boolean;
      activeBoardId: string;
      clientX: number;
      clientY: number;
      grabOffsetX: number;
      grabOffsetY: number;
      fallbackRowContent: Element | null;
      resolveCanvasRowContentDropTarget(
        clientX: number,
        clientY: number
      ): { boardId: string; indexMode: string; rowIndex: number } | null;
      getCanvasRowContentNodeFromDropTarget(
        target: { boardId: string; indexMode: string; rowIndex: number },
        fallback?: Element | null
      ): Element | null;
      getCanvasDropPositionInRowContent(
        rowContent: Element,
        clientX: number,
        clientY: number,
        grabOffsetX?: number,
        grabOffsetY?: number
      ): { x: number; y: number } | null;
    }> | null | undefined
  ): {
    kind: 'row';
    boardId: string;
    rowIndex: number;
    indexMode: 'display';
    canvasPosition: { x: number; y: number };
  } | null;
  applyCanvasDropPositionToStack(
    targetBoardId: string,
    activeBoardId: string,
    isCanvasLayout: boolean,
    target: { canvasPosition?: { x: number; y: number } } | null | undefined,
    stack: { params?: { [k: string]: string } } | null
  ): { params?: { [k: string]: string } } | null;
}

/**
 * Source: src/utils/appUtils.js (IIFE; window.LexeraAppUtils = api).
 * Misc cross-module helpers — `renderTable` delegates to the card
 * content renderer, `flushPendingDiagramQueues` to the diagram
 * registry, plus pure `escapeRegex` and `applyAbbreviationsToHtml`
 * (which walks rendered HTML and wraps abbreviation keys in `<abbr
 * title>` spans without touching tag bodies).
 */
interface LexeraAppUtilsDeps {
  escapeAttr?: (s: string | null | undefined) => string;
  handleDiagramAction?: (...args: unknown[]) => unknown;
  requestRenderedPlantUmlSvg?: (...args: unknown[]) => unknown;
  escapeHtml?: (s: string | null | undefined) => string;
}

interface LexeraAppUtilsApi {
  init(deps: LexeraAppUtilsDeps): void;
  renderTable(lines: Array<unknown>, startIdx: number, boardId: string, renderState: unknown): string;
  flushPendingDiagramQueues(): void;
  escapeRegex(str: string | null | undefined): string;
  applyAbbreviationsToHtml(
    html: string | null | undefined,
    abbrDefs: { [k: string]: string } | null | undefined
  ): string;
}

/**
 * Source: src/utils/mediaCategory.js (IIFE;
 * window.LexeraMediaCategory = api). Classifies file extensions into
 * media buckets (image / video / audio / document / unknown) +
 * detects safe inline-embed extensions (.md / .csv / .json / etc.).
 * External URL inference covers `googleusercontent.com` /
 * `ggpht.com` / `ytimg.com` (treated as images) + format/fm/mime
 * query params.
 */
type LexeraMediaCategoryKind = 'image' | 'video' | 'audio' | 'document' | 'unknown' | '';

interface LexeraMediaCategoryDeps {
  isExternalHttpUrl(url: string | null | undefined): boolean;
  normalizeFilePathForDetection(path: string | null | undefined): string;
  getFileNameFromPath(path: string): string;
}

interface LexeraMediaCategoryApi {
  init(deps: LexeraMediaCategoryDeps): void;
  getMediaCategory(ext: string | null | undefined): LexeraMediaCategoryKind;
  inferExternalMediaCategoryFromUrl(url: string | null | undefined): LexeraMediaCategoryKind;
  getFileExtension(path: string | null | undefined): string;
  getInlineFileEmbedExtension(path: string | null | undefined): string;
}

/**
 * Source: src/canvas/canvasViewport.js (IIFE;
 * window.LexeraCanvasViewport = api). Pure geometry helpers for the
 * canvas-mode focus / zoom-to-fit pipeline. `calculateCanvasFocusViewport`
 * returns the zoom + pan offsets that fit a stack-bounds rectangle
 * inside the visible viewport, respecting padding and min/max zoom.
 */
interface LexeraCanvasViewportRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width?: number;
  height?: number;
}

interface LexeraCanvasViewportStackMetric {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface LexeraCanvasViewportFocusOptions {
  padding?: number;
  minZoom?: number;
  maxZoom?: number;
  surfaceOffsetX?: number;
  surfaceOffsetY?: number;
}

interface LexeraCanvasViewportFocusResult {
  zoom: number;
  panX: number;
  panY: number;
  bounds: LexeraCanvasViewportRect;
}

interface LexeraCanvasViewportApi {
  rectsIntersect(
    a: LexeraCanvasViewportRect | null | undefined,
    b: LexeraCanvasViewportRect | null | undefined
  ): boolean;
  hasAnyVisibleCanvasStack(
    stackRects: Array<LexeraCanvasViewportRect> | null | undefined,
    viewportRect: LexeraCanvasViewportRect | null | undefined
  ): boolean;
  getCanvasStackBounds(
    stackMetrics: Array<LexeraCanvasViewportStackMetric> | null | undefined
  ): LexeraCanvasViewportRect | null;
  calculateCanvasFocusViewport(
    stackMetrics: Array<LexeraCanvasViewportStackMetric> | null | undefined,
    viewportSize: { width?: number; height?: number } | null | undefined,
    options?: LexeraCanvasViewportFocusOptions
  ): LexeraCanvasViewportFocusResult | null;
}

/**
 * Source: src/fold/foldState.js (IIFE;
 * window.LexeraFoldState = api). Manages per-board folded-element
 * state (rows / stacks / columns / cards) — stable fold keys derived
 * from entity id or display path, persisted to localStorage via the
 * `lexera-{row,stack,col}-fold:<boardId>` keys.
 */
interface LexeraFoldStateStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface LexeraFoldStateSaveOptions {
  storage?: LexeraFoldStateStorage;
  container?: Element | null;
}

interface LexeraFoldStateToggleOptions {
  boardId?: string;
  isCanvasBoardLayout?: boolean | (() => boolean);
  setColumnChildrenFoldState?: (el: Element, expand: boolean) => void;
  saveCardCollapseState?: (boardId?: string) => void;
  saveFoldState?: (boardId?: string) => void;
  refreshBoardHeaderActionStates?: () => void;
  storage?: LexeraFoldStateStorage;
  container?: Element | null;
}

interface LexeraFoldStateApi {
  normalizeFoldStorageList(values: unknown): Array<string>;
  getRowFoldKey(row: { id?: unknown } | null | undefined, rowIdx: number): string;
  getStackFoldKey(
    stack: { id?: unknown } | null | undefined,
    rowIdx: number,
    stackIdx: number
  ): string;
  getColumnFoldKey(
    col: { id?: unknown; index?: number } | null | undefined,
    rowIdx: number,
    stackIdx: number,
    colLocalIdx: number,
    colFullIdx?: number
  ): string;
  hasSavedFoldMatch(
    savedValues: Array<string> | null | undefined,
    foldKey: string,
    legacyValue?: string | null
  ): boolean;
  getFoldedColumns(boardId: string, storage: LexeraFoldStateStorage | null | undefined): Array<string>;
  getFoldedItems(boardId: string, kind: string, storage: LexeraFoldStateStorage | null | undefined): Array<string>;
  saveFoldState(boardId: string, options: LexeraFoldStateSaveOptions): void;
  toggleColumnFoldElement(
    columnEl: Element | null,
    childrenOnly: boolean,
    options: LexeraFoldStateToggleOptions
  ): boolean;
}

/**
 * Source: src/interaction/scrollBehavior.js (IIFE;
 * window.LexeraScrollBehavior = api). Pure helpers for scroll +
 * zoom + canvas-pan input: speed-multiplier normalization,
 * wheel-delta → pixel conversion, can-this-element-consume-the-delta
 * gating that drives the parent board's wheel event handler.
 */
type LexeraScrollBehaviorSource =
  | { boardSettings?: { [k: string]: unknown }; [k: string]: unknown }
  | ((key: string, fallback: string) => unknown)
  | string
  | null
  | undefined;

interface LexeraScrollBehaviorScaleOptions {
  fallback?: string | null;
  precision?: number;
}

interface LexeraScrollBehaviorWheelOptions {
  window?: Window | null;
  viewportHeight?: number;
  document?: Document | null;
  getComputedStyle?: (el: Element) => CSSStyleDeclaration;
}

interface LexeraScrollBehaviorApi {
  normalizeBoardScrollSpeedValue(rawValue: unknown): string;
  getBoardScrollSpeedMultiplier(source: LexeraScrollBehaviorSource, fallback?: string | null): number;
  normalizeBoardZoomSpeedValue(rawValue: unknown): string;
  getBoardZoomSpeedMultiplier(source: LexeraScrollBehaviorSource, fallback?: string | null): number;
  scaleZoomDelta(
    baseDelta: number,
    source: LexeraScrollBehaviorSource,
    options?: LexeraScrollBehaviorScaleOptions
  ): number;
  normalizeWheelDeltaToPixels(
    delta: number,
    deltaMode: number,
    options?: LexeraScrollBehaviorWheelOptions
  ): number;
  canStartCanvasPointerPan(
    target: Element | null | undefined,
    button: number,
    altKey: boolean
  ): boolean;
  canScrollableElementConsumeWheelDelta(
    el: Element | null | undefined,
    axis: 'x' | 'y',
    delta: number,
    options?: LexeraScrollBehaviorWheelOptions
  ): boolean;
  shouldHandleBoardViewportWheelEvent(
    target: Element | null | undefined,
    container: Element | null | undefined,
    deltaX: number,
    deltaY: number,
    options?: LexeraScrollBehaviorWheelOptions
  ): boolean;
}

interface LexeraInspectorVisibleRow {
  health: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface LexeraInspectorLogLine {
  level: string;
  text: string;
}

interface LexeraInspectorTestApiState {
  countLabel: string;
  rows: Array<LexeraInspectorVisibleRow>;
  logLines: Array<LexeraInspectorLogLine>;
  fps: string;
}

interface LexeraInspectorTestApi {
  collectState(): LexeraInspectorTestApiState;
  clickDestroy(label: string): boolean;
  clickReload(label: string): boolean;
}

/**
 * Source: src/views/log/log.js. Test seam published as
 * window.LexeraLogTestApi when the log view boots — lets Vitest
 * integration tests drive the filter chips, search box, and clear /
 * refresh actions without simulating raw user interactions.
 */
interface LexeraLogVisibleEntry {
  level: string;
  source: string;
  message: string;
}

interface LexeraLogTestApiState {
  status: string;
  connected: boolean;
  visibleEntries: Array<LexeraLogVisibleEntry>;
  totalEntries: number;
  searchText: string;
  activeLevels: { [level: string]: boolean };
  activeSources: { [source: string]: boolean };
  sourceFilterAll: boolean;
}

interface LexeraLogTestApi {
  collectState(): LexeraLogTestApiState;
  appendEntry(entry: { level?: string; source?: string; message?: string; [k: string]: unknown }): void;
  setSearch(text: string): boolean;
  clickClear(): boolean;
  clickRefresh(): boolean;
  toggleLevel(lvl: string): boolean;
  toggleSource(src: string): boolean;
}

interface LexeraGeometryObserverApi {
  /** Build an instance bound to the supplied callback bag.
   *  `onTabsLayoutChanged(headerEl)` fires after each recompute so
   *  the shell can close any open overflow dropdown when the
   *  visible-tab set shifts underneath it. */
  create(deps?: {
    onTabsLayoutChanged?: (headerEl: HTMLElement) => void;
  }): LexeraGeometryObserverInstance;
  /** Internal hook exposed for the contract test
   *  (`geometryObserverContract.test.js`). */
  _recomputeOverflow(headerEl: HTMLElement): boolean;
}

/**
 * Source: src/titleHelpers.js (IIFE; window.LexeraTitleHelpers = api).
 * Pure helpers — no state, no DOM. Used by boardHeader, workspaceShell,
 * and the workspaces / hierarchy sub-apps to converge on a single
 * board-label resolver.
 */
interface LexeraTitleHelpersApi {
  /** Extract every <!-- … --> HTML comment as a string array. */
  extractHtmlComments(text: string | null | undefined): string[];
  /** Strip <!-- … --> blocks and collapse stray whitespace. */
  stripHtmlComments(text: string | null | undefined): string;
  /**
   * Re-emit a title containing the user's edited prefix followed by
   * the original title's HTML comments (preserving hidden metadata
   * like `<!-- id:… -->` even when the user retypes the visible
   * portion).
   */
  rebuildTitleWithPreservedComments(
    userInput: string | null | undefined,
    originalTitle: string | null | undefined
  ): string;
  /**
   * Canonical priority chain: parsed title → filename without `.md` →
   * legacy `name` → `'Untitled'`. Accepts both `filePath` (camelCase
   * Rust serde) and `file_path` (legacy snake_case) payload keys.
   */
  resolveBoardLabel(
    meta: { title?: string; filePath?: string; file_path?: string; name?: string } | null | undefined
  ): string;
  /**
   * Card label resolver. Cards have no canonical `title` field — the
   * displayed label is derived from `card.content` (first non-empty
   * line, skipping image-only lines, stripping H1/H2/H3 markers, HTML
   * comments, and #hidden-internal-* tags). If a caller has already
   * stashed a `title` on the card object (e.g. boardCleanup), that
   * wins. Falls back to `'Untitled'` when nothing is derivable.
   */
  resolveCardLabel(
    card: { title?: string; content?: string } | null | undefined
  ): string;
  /** Strip directory separators and the trailing `.md` extension. */
  basenameWithoutMd(filePath: string | null | undefined): string;
}

/**
 * Source: src/workspace/treeRegistry.js (IIFE;
 * window.LexeraTreeRegistry = api). Centralises iteration over the
 * four layout trees the workspace shell holds (one centre dock + three
 * side docks). Stateful — `setup()` must be called once before any
 * other method (throws on missing deps).
 */
type LexeraTreeRegistryTreeId = 'center' | 'left' | 'right' | 'bottom';

/**
 * Recursive DockTreeNode union (DockTreeLeaf | DockTreeSplit). Mirrors
 * the JSDoc `@typedef`s in `src/workspace/layoutTree.js` (the module
 * that owns construction + mutation of every node) — kept in sync so
 * the .d.ts ambient view matches what checkJs sees at the call sites.
 *
 * Tab variants are discriminated on `kind` (`'board' | 'panel'`); node
 * variants on `type` (`'tabs' | 'split'`). The shell + reconciler walk
 * these unions through `LexeraLayoutTreeApi.visitTree` /
 * `collectAllTabIds` and the find* helpers below.
 */
interface LexeraDockTreeBoardTab {
  /** Stable tab id minted by `createBoardTab` / `idFactory('tab')`. */
  id: string;
  kind: 'board';
  /** The board this tab opens. Empty string allowed mid-creation. */
  boardId: string;
  /** Normalised view kind from `normalizeViewKind`. */
  viewKind: 'canvas' | 'kanban' | 'default';
}

interface LexeraDockTreePanelTab {
  /** Stable tab id minted by `createPanelTab` / `idFactory('tab')`. */
  id: string;
  kind: 'panel';
  /** Matches a key in the workspace shell's `state.panelInstances`. */
  panelId: string;
}

type LexeraDockTreeTab = LexeraDockTreeBoardTab | LexeraDockTreePanelTab;

interface LexeraDockTreeLeaf {
  type: 'tabs';
  /** Stable pane id minted by `idFactory('pane')`. */
  id: string;
  /** Ordered list of tabs in this pane. May be empty briefly during
   *  mutation; `withNormalizedLeaves` collapses empty non-root leaves
   *  to `null`. */
  tabs: Array<LexeraDockTreeTab>;
  /** Id of the currently rendered tab in `tabs`. Empty string when
   *  the leaf is empty. Kept consistent by the mutation helpers. */
  activeTabId: string;
}

interface LexeraDockTreeSplit {
  type: 'split';
  /** Stable split id minted by `idFactory('split')`. */
  id: string;
  /** `horizontal` stacks first-above-second; `vertical` puts them
   *  side-by-side. */
  axis: 'horizontal' | 'vertical';
  /** First-child fraction of the split, clamped to `[0.18, 0.82]`. */
  ratio: number;
  first: LexeraDockTreeNode;
  second: LexeraDockTreeNode;
}

type LexeraDockTreeNode = LexeraDockTreeLeaf | LexeraDockTreeSplit;

/**
 * Pre-tab-tree persistence shape: per dock, a list of groups, each
 * group a list of panel ids. `LexeraLayoutTreeApi.migratePanelDocksToSideDocks`
 * walks it once at boot and emits a `LexeraDockTreeNode | null` per dock.
 */
interface LexeraLegacyPanelDocks {
  left: Array<Array<string>>;
  right: Array<Array<string>>;
  bottom: Array<Array<string>>;
}

interface LexeraTreeRegistryFoundLeaf {
  treeId: LexeraTreeRegistryTreeId;
  leaf: LexeraDockTreeNode;
}
interface LexeraTreeRegistryFoundTab {
  treeId: LexeraTreeRegistryTreeId;
  tab: LexeraDockTreeNode;
  leaf: LexeraDockTreeNode;
  index: number;
}
interface LexeraTreeRegistryFoundPanel {
  treeId: LexeraTreeRegistryTreeId;
  tab: LexeraDockTreeNode;
  leaf: LexeraDockTreeNode;
}

interface LexeraTreeRegistryApi {
  /** Bind shell state + helpers. Throws if any required dep is
   *  missing. Must be called once before any other method. */
  setup(deps: {
    /** Live reference to the workspace shell state — only the
     *  layout-tree fields are read/written. The registry never
     *  copies, so mutations land directly on the shell's source
     *  of truth. Other shell-state fields exist but are opaque
     *  to this module. */
    state: {
      dockTree?: LexeraDockTreeNode | null;
      sideDocks?: {
        left?: LexeraDockTreeNode | null;
        right?: LexeraDockTreeNode | null;
        bottom?: LexeraDockTreeNode | null;
      };
      [otherKey: string]: unknown;
    };
    /** `window.LexeraLayoutTree`. Tree-walk primitives are read off
     *  this object once setup() runs. */
    layoutTree: LexeraLayoutTreeApi;
    withNormalizedLeaves: (node: LexeraDockTreeNode, isRoot: boolean) => LexeraDockTreeNode;
    resolvePanelTargetFn: (panelId: string) => string;
  }): void;
  /** The four tree ids in iteration order:
   *  `['center', 'left', 'right', 'bottom']`. */
  allTreeIds(): readonly LexeraTreeRegistryTreeId[];
  /** Root node of the named tree, or `null` if empty. */
  getTreeRoot(treeId: LexeraTreeRegistryTreeId): LexeraDockTreeNode | null;
  /** Replace the root of the named tree. Pass `null` to empty it. */
  setTreeRoot(treeId: LexeraTreeRegistryTreeId, root: LexeraDockTreeNode | null): void;
  /** Run `withNormalizedLeaves` on every non-empty tree root,
   *  flagging the centre tree via the `isRoot` argument. */
  normalizeAllTrees(): void;
  /** Find a leaf by id across all four trees, or `null`. */
  findLeafInAllTrees(leafId: string): LexeraTreeRegistryFoundLeaf | null;
  /** Find a tab by id across all four trees, or `null`. */
  findTabInAllTrees(tabId: string): LexeraTreeRegistryFoundTab | null;
  /** Find a panel by id across all four trees. Resolves panel
   *  references via the configured `resolvePanelTargetFn`. */
  findPanelInAllTrees(panelId: string): LexeraTreeRegistryFoundPanel | null;
}

/**
 * Source: src/workspace/messageBridge.js (IIFE;
 * window.LexeraMessageBridge = api). Shell ↔ board-webview IPC.
 * All messages between the workspace shell and embedded board
 * sub-apps go through this module. Stateful — `setup({ multiview })`
 * must be called once before any other method (throws otherwise).
 *
 * Mirrors the JSDoc typedefs in messageBridge.js (CatalogSnapshot,
 * MultiviewLabelResolver). Tab and snapshot inner shapes are kept
 * loose (`any`/`unknown`) at this boundary; the messageBridge module
 * itself owns the precise validation.
 */
interface LexeraMessageBridgeCatalogSnapshot {
  boards: Array<unknown>;
  remoteBoards: Array<unknown>;
  workspaces: Array<unknown>;
  activeWorkspaceId: string;
  activeWorkspace: Record<string, unknown> | null;
  viewWorkspaceId: string;
  viewWorkspace: Record<string, unknown> | null;
  workspaceViewMode: 'manual' | 'follow-active-board';
}

interface LexeraMessageBridgeMultiviewLabelResolver {
  /** Resolve the Tauri webview label for a board tab id. */
  labelForTabId(tabId: string): string;
  /** Resolve the Tauri webview label for a tab object. */
  labelForTab(tab: unknown): string;
}

/**
 * Shape of the value returned by `build-context-menu` IPC roundtrips
 * (see workspaceShell.js:~4684 — used to populate native context
 * menus). `context` carries arbitrary scope-specific fields the
 * webview wants surfaced back through `dispatchAction`, so it stays
 * permissive.
 */
interface LexeraMessageBridgeContextMenuResponse {
  items: Array<Record<string, unknown>>;
  context: Record<string, any>;
}

interface LexeraMessageBridgeApi {
  /** Bind the multiview label resolver. Throws if `multiview` is
   *  missing. Must be called once at boot. */
  setup(deps: { multiview: LexeraMessageBridgeMultiviewLabelResolver }): void;
  /** Send `focus-hierarchy-target` to the webview hosting `tabId`. */
  focusHierarchy(tabId: string, target: unknown, options?: Record<string, unknown>): boolean;
  /** Send `board-action` (`{ action }`) to the webview hosting
   *  the supplied tab object. */
  boardAction(tab: unknown, action: string): boolean;
  /** Broadcast `layout-drag` (`{ active }`) to every child webview. */
  layoutDrag(active: boolean): boolean;
  /** Broadcast `backend-connection-state` (`{ connected }`) to
   *  every child webview. */
  broadcastBackendConnectionState(connected: boolean): boolean;
  /** Push the catalog snapshot to every child webview via
   *  LexeraMultiview.broadcastCatalog. Returns false if the
   *  multiview broadcaster isn't available. */
  broadcastCatalog(snapshot: LexeraMessageBridgeCatalogSnapshot): boolean;
  /** Targeted catalog send for a freshly-activated pane. */
  sendCatalog(tabId: string, snapshot: LexeraMessageBridgeCatalogSnapshot): boolean;
  /** Coerce a partial / null / undefined snapshot into a fully
   *  populated CatalogSnapshot with stable defaults. Idempotent. */
  normalizeCatalog(snapshot: Partial<LexeraMessageBridgeCatalogSnapshot> | null | undefined): LexeraMessageBridgeCatalogSnapshot;
  /** Round-trip `build-context-menu` request to the webview hosting
   *  `tabId`. Resolves with the menu definition or rejects on
   *  timeout / unavailable transport. Default timeout 1500ms. */
  requestContextMenu(tabId: string, scope: string, ctx: unknown, timeoutMs?: number): Promise<LexeraMessageBridgeContextMenuResponse | null>;
  /** Send `dispatch-action` (`{ scope, action, context }`) to the
   *  webview hosting `tabId`. */
  dispatchAction(tabId: string, scope: string, action: string, context: unknown): boolean;
}

/**
 * Source: src/shell/bridges/backendStatusBridge.js (IIFE;
 * window.LexeraBackendStatusBridge = api). Renders a small fixed-
 * position pill in the top-right corner reflecting the backend's
 * connection state. Subscribes to the Tauri runtime `backend-status`
 * event and re-renders the indicator on each payload.
 *
 * State machine (payload.state values handled): `connected` (hides
 * the pill), `waiting` (initial connect), `reconnecting` (post-drop
 * with attempt counter), `unavailable` (terminal — optional reason
 * string). Anything else falls through to a generic
 * "Backend status: <state>" label so unknown states don't go silent.
 */
type LexeraBackendStatusTone = 'connected' | 'waiting' | 'reconnecting' | 'unavailable' | 'unknown';

interface LexeraBackendStatusView {
  /** Whether the indicator pill is shown. `false` only when
   *  `state === 'connected'`. */
  visible: boolean;
  /** User-facing label for the pill. Empty when not visible. */
  label: string;
  /** Coarse mood for theming hooks; written to `data-tone`. */
  tone: LexeraBackendStatusTone;
}

interface LexeraBackendStatusPayload {
  /** Connection state: drives label + visibility. Unknown values
   *  are rendered as `Backend status: <state>` so the user still
   *  sees the raw signal. */
  state?: string | null;
  /** Reconnect attempt counter — only meaningful when
   *  `state === 'reconnecting'`. */
  attempt?: number | null;
  /** Optional human reason string surfaced when `state === 'unavailable'`. */
  reason?: string | null;
}

interface LexeraBackendStatusRuntimeEvent {
  /** Tauri webview event listener — `runtime.event.listen(name, fn)`. */
  listen(eventName: string, handler: (event: { payload: LexeraBackendStatusPayload | null }) => void): void;
}

interface LexeraBackendStatusRuntime {
  event?: LexeraBackendStatusRuntimeEvent;
}

interface LexeraBackendStatusBridgeApi {
  /** Stable Tauri event name the bridge subscribes to. */
  readonly EVENT_NAME: 'backend-status';
  /** DOM id used by `ensureElement` so the indicator pill is
   *  reused across renders. */
  readonly INDICATOR_ID: 'lexera-backend-status-indicator';
  /** Pure helper: turn a status payload into the rendered view
   *  shape (visible / label / tone). No DOM access. */
  describe(payload: LexeraBackendStatusPayload | null | undefined): LexeraBackendStatusView;
  /** Render the indicator pill into `doc.body`, creating it on
   *  first call. Returns the same view shape `describe` would. */
  render(doc: Document | null | undefined, payload: LexeraBackendStatusPayload | null | undefined): LexeraBackendStatusView;
  /** Subscribe to `backend-status` events on the supplied Tauri
   *  runtime so each payload re-renders the pill. Returns `false`
   *  if the runtime doesn't expose `event.listen`; otherwise `true`. */
  installWith(
    runtime: LexeraBackendStatusRuntime | null | undefined,
    options?: { document?: Document | null }
  ): boolean;
}

/**
 * Source: src/shell/bridges/managementBridge.js (IIFE;
 * window.LexeraManagementBridge = api). Subscribes to three
 * management-side broadcasts emitted by the backend / management UI:
 * `management-workspaces-loaded`, `management-board-mutation`, and
 * `render-apps-config-saved`. Each event is filtered by the bridge's
 * own window label (events targeted at other windows are ignored)
 * before being dispatched to the supplied handler bag.
 *
 * Webview-scoped listeners are preferred — Tauri 2 leaks `emit_to`
 * events across windows when subscribed with kind `Any`
 * (tauri-apps/tauri#11379); the bridge falls back to
 * runtime-scoped listening only when the per-webview helper isn't
 * available.
 */
interface LexeraManagementBridgeWorkspacesPayload {
  workspaces: Array<unknown>;
  defaultWorkspaceId: string | null;
}

interface LexeraManagementBridgeBoardMutationPayload {
  /** Mutation discriminator. The bridge dispatches handlers for
   *  `'added' | 'removed' | 'settings-saved'`; any other value is
   *  ignored. */
  kind: string;
  /** Required for `removed` / `settings-saved`; null for `added`. */
  boardId: string | null;
  /** Carried only on `settings-saved`. */
  settings: Record<string, unknown> | null;
}

interface LexeraManagementBridgeRenderAppsConfigPayload {
  /** Free-form key/value map of render-apps settings the management
   *  UI just saved. */
  values: Record<string, unknown>;
}

interface LexeraManagementBridgeHandlers {
  onWorkspacesLoaded?(workspaces: Array<unknown>, defaultWorkspaceId: string | null): void;
  onBoardAdded?(): void;
  onBoardRemoved?(boardId: string): void;
  onBoardSettingsSaved?(boardId: string, settings: Record<string, unknown>): void;
  onRenderAppsConfigSaved?(values: Record<string, unknown>): void;
}

interface LexeraManagementBridgeRuntime {
  event?: { listen?(eventName: string, handler: (event: unknown) => void): unknown };
}

interface LexeraManagementBridgeApi {
  /** Wire listeners against the implicit Tauri runtime
   *  (`window.__TAURI__`). Returns `true` on success, `false` when
   *  the runtime / event API is unavailable. */
  install(handlers?: LexeraManagementBridgeHandlers | null): boolean;
  /** Same as `install` but accepts an explicit runtime so the bridge
   *  can be used from contexts that don't expose it on `window`
   *  (test sandboxes, embedded webviews). Prefers the current
   *  webview's `listen()` (avoids the Tauri #11379 cross-window
   *  leak); falls back to `runtime.event.listen()`. */
  installWith(
    runtime: LexeraManagementBridgeRuntime | null | undefined,
    handlers?: LexeraManagementBridgeHandlers | null
  ): boolean;
  /** Filter `management-workspaces-loaded` by source window,
   *  normalize, dispatch `onWorkspacesLoaded`. Returns `true` when
   *  the handler ran. */
  handleWorkspacesLoaded(
    event: unknown,
    handlers: LexeraManagementBridgeHandlers | null | undefined
  ): boolean;
  /** Filter `management-board-mutation` by source window, normalize,
   *  dispatch the matching `kind` callback. Returns `true` when a
   *  callback ran (and `false` for ignored kinds / missing
   *  handlers). */
  handleBoardMutation(
    event: unknown,
    handlers: LexeraManagementBridgeHandlers | null | undefined
  ): boolean;
  /** Filter `render-apps-config-saved` by source window, normalize,
   *  dispatch `onRenderAppsConfigSaved`. Returns `true` when the
   *  handler ran. */
  handleRenderAppsConfigSaved(
    event: unknown,
    handlers: LexeraManagementBridgeHandlers | null | undefined
  ): boolean;
  /** Coerce a raw `management-workspaces-loaded` event into a stable
   *  `{ workspaces, defaultWorkspaceId }` shape. Idempotent. */
  normalizeWorkspacesPayload(event: unknown): LexeraManagementBridgeWorkspacesPayload;
  /** Coerce a raw `management-board-mutation` event into a stable
   *  `{ kind, boardId, settings }` shape. Idempotent. */
  normalizeBoardMutationPayload(event: unknown): LexeraManagementBridgeBoardMutationPayload;
  /** Coerce a raw `render-apps-config-saved` event into a stable
   *  `{ values }` shape. Idempotent. */
  normalizeRenderAppsConfigPayload(event: unknown): LexeraManagementBridgeRenderAppsConfigPayload;
}

/**
 * Source: src/shell/bridges/hierarchyDragBridge.js (IIFE;
 * window.LexeraHierarchyDragBridge = api). Shell-side handler for the
 * `hierarchy-entity-drop` broadcasts emitted by the workspaces and
 * hierarchy sub-apps when the user drags a row / stack / column / card
 * onto a sibling. Pure-helper layer (`applyEntityReorder` / `…Absorb`
 * / `…Rename` / `applyDrop`) mutates `KanbanBoard` shapes in place;
 * the IO-bound `install` wraps them with `LexeraApi.saveBoard` and
 * `routeCrossViewDragPoint` translates a sub-app drag mousemove to a
 * (targetLabel, localX, localY) tuple the shell forwards via
 * `multiview_emit_to`.
 *
 * Entity kind discriminator is `'row' | 'stack' | 'column' | 'card'`
 * for nested entities and `'board'` for the special `row → board`
 * absorb (the kanban itself as the absorb container).
 */
type LexeraHierarchyDragEntityKind = 'row' | 'stack' | 'column' | 'card' | 'board';

interface LexeraHierarchyDragSource {
  kind: LexeraHierarchyDragEntityKind;
  entityId: string;
  /** Required for cross-board moves; identical to target.boardId
   *  signals a same-board move. */
  boardId?: string;
}

interface LexeraHierarchyDragTarget {
  kind: LexeraHierarchyDragEntityKind;
  entityId: string;
  boardId?: string;
  /** Drop side relative to the target sibling. Defaults to `'before'`
   *  for backwards compatibility with pre-zone-aware call sites. */
  position?: 'before' | 'after';
}

interface LexeraHierarchyDragRoutePointDeps {
  /** Label of the webview firing the drag mousemove. */
  sourceWebviewLabel: string;
  /** Pointer coordinates in the source document's client space. */
  sourceClientX: number;
  sourceClientY: number;
  /** Top-window rect for any webview by label, or null when the
   *  label isn't currently spawned. */
  getWebviewRect(label: string): { left: number; top: number; right: number; bottom: number } | null;
  /** Shell helper from multiviewWebview.js — looks up which webview's
   *  geometry contains the supplied top-window point. */
  getWebviewLabelAtTopPoint(topX: number, topY: number): string | null;
}

interface LexeraHierarchyDragRoutePointResult {
  /** Label of the destination webview that the cursor is currently
   *  over (excludes the source itself). */
  targetLabel: string;
  /** Pointer coords inside the target webview's document — what
   *  `__lexeraExternalDnd.hover(payload, x, y)` expects. */
  localX: number;
  localY: number;
  /** Same point in top-window coordinates. */
  topX: number;
  topY: number;
}

interface LexeraHierarchyDragWebview {
  /** Webview label (e.g. `board-tab-…` / `panel-tab-…`). */
  label: string;
  listen(eventName: string, handler: (event: { payload?: unknown } | null | undefined) => void): unknown;
}

interface LexeraHierarchyDragInstallDeps {
  getCurrentWebview(): LexeraHierarchyDragWebview | null | undefined;
  invoke(cmd: string, args?: Record<string, unknown>): Promise<unknown>;
  /** Resolve a board id to a `KanbanBoard`-shaped object the pure
   *  helpers can mutate. */
  loadBoard(boardId: string): Promise<unknown>;
  /** Persist a mutated board. */
  saveBoard(boardId: string, board: unknown): Promise<unknown>;
  /** Optional success hook fired after persist. */
  onApplied?: (boardId: string) => void;
  /** Optional error hook for any failure path. */
  onError?: (err: unknown) => void;
}

interface LexeraHierarchyDragBridgeApi {
  /** Same-board sibling reorder. Returns `true` when source and
   *  target share a parent and the move was applied; `false`
   *  otherwise (cross-parent / cross-board / mismatched kind /
   *  identical entities). Mutates `board` in place. */
  applyEntityReorder(board: unknown, source: LexeraHierarchyDragSource, target: LexeraHierarchyDragTarget): boolean;
  /** Same-board cross-kind absorb (card→column, column→stack,
   *  stack→row, row→board). Appends source to target's children
   *  array. Returns `true` when the kind pair forms a valid one-
   *  level absorb. */
  applyEntityAbsorb(board: unknown, source: LexeraHierarchyDragSource, target: LexeraHierarchyDragTarget): boolean;
  /** Cross-board sibling reorder. Mutates BOTH boards in place; the
   *  caller must persist both. */
  applyCrossBoardEntityReorder(srcBoard: unknown, tgtBoard: unknown, source: LexeraHierarchyDragSource, target: LexeraHierarchyDragTarget): boolean;
  /** Cross-board cross-kind absorb. Same kind-pair rules as the
   *  same-board variant; mutates both boards in place. */
  applyCrossBoardEntityAbsorb(srcBoard: unknown, tgtBoard: unknown, source: LexeraHierarchyDragSource, target: LexeraHierarchyDragTarget): boolean;
  /** In-place rename. Refuses empty / unchanged titles. */
  applyEntityRename(board: unknown, source: LexeraHierarchyDragSource, newTitle: string | null | undefined): boolean;
  /** Unified dispatch — picks the right helper based on
   *  same-board vs cross-board and same-kind vs cross-kind. Does
   *  NOT call `saveBoard`; the caller is expected to persist. */
  applyDrop(srcBoard: unknown, tgtBoard: unknown, source: LexeraHierarchyDragSource, target: LexeraHierarchyDragTarget): boolean;
  /** Translate a source-document drag point to a (targetLabel,
   *  localX, localY) tuple the shell can forward via
   *  `multiview_emit_to`. Pure — all geometry deps injected.
   *  Returns `null` when the cursor is outside any known webview or
   *  resolves to the source webview itself. */
  routeCrossViewDragPoint(deps: LexeraHierarchyDragRoutePointDeps | null | undefined): LexeraHierarchyDragRoutePointResult | null;
  /** Production wiring — listens for `hierarchy-entity-drop` events
   *  on the current webview, looks up boards via the injected IO
   *  callbacks, applies the move, persists. Returns `false` when
   *  required deps are missing or the webview helper is
   *  unavailable. */
  install(deps: LexeraHierarchyDragInstallDeps | null | undefined): boolean;
}

/**
 * Source: src/shell/bridges/embeddedBoardBridge.js (IIFE;
 * window.LexeraEmbeddedBoardBridge = api). The sub-app side of the
 * multiview wiring — runs INSIDE every kanban-board webview whose URL
 * carries `?embedded=1`. Bridges shell broadcasts (catalog,
 * dashboard navigation, layout/theme/connection state, cross-view
 * drag, context-menu requests, mutation delegation) into the legacy
 * `window.message` shape that the embedded board's existing
 * orderHelpers.js / app.js handlers already consume. Also reports
 * focus + health back to the shell, forwards the four open-helper
 * keyboard shortcuts the webview captured before the shell could see
 * them, and services cross-webview request/dispatch for build-context-
 * menu and delegate-mutation.
 *
 * The bridge is dependency-injected because `multiviewClient.js` owns
 * the Tauri-runtime accessors. `install(deps)` is called from
 * `bootMultiview` only when the URL marks the webview as an embedded
 * board; on any other webview it short-circuits to `false` so the
 * subscribe / listen plumbing never runs.
 */
interface LexeraEmbeddedBoardBridgeShortcutMap {
  /** Modifier+key chord (e.g. `Ctrl+Alt+L`, `Meta+Alt+I`) → shortcut
   *  action id (e.g. `open-log-view`, `open-inspector`). Forwarded to
   *  the shell as `multiview-shortcut` for the open-helper map in
   *  `navigationBridge`. */
  [chord: string]: string;
}

interface LexeraEmbeddedBoardBridgeWebview {
  /** Webview label (e.g. `board-tab-…`). Used as the source-window
   *  filter on outbound broadcasts and the subscribe key. */
  label: string;
  listen(eventName: string, handler: (event: { payload?: unknown } | null | undefined) => void): unknown;
}

interface LexeraEmbeddedBoardBridgeDeps {
  /** Returns the current webview handle the bridge listens on. The
   *  bridge bails (`install` → `false`) when this is missing or
   *  returns null. */
  getCurrentWebview(): LexeraEmbeddedBoardBridgeWebview | null | undefined;
  /** Tauri command invoker — used for `multiview_subscribe`,
   *  `multiview_broadcast`, `multiview_set_focused`,
   *  `multiview_set_health`. */
  invoke(cmd: string, args?: Record<string, unknown>): Promise<unknown>;
  /** Optional request/response responder (see requestBridge). When
   *  present, the bridge installs a `build-context-menu` handler on
   *  it; absent → context-menu requests go unanswered (sub-app
   *  webviews that don't surface a menu can omit it). */
  handleRequest?: (
    requestEvent: string,
    handler: (data: unknown) => unknown | Promise<unknown>
  ) => unknown;
}

interface LexeraEmbeddedBoardBridgeApi {
  /** Detect whether the current URL marks this webview as an
   *  embedded kanban board (`?embedded=1`). */
  isEmbeddedKanban(): boolean;
  /** Wire shell ⇄ embedded-board listeners. Returns `true` on full
   *  success, `false` when the webview isn't embedded, deps are
   *  incomplete, or the webview helper isn't available. Idempotent
   *  for the CSS-injection step (marker `<style id>` guards re-run);
   *  the listen/subscribe side trusts the caller to install once. */
  install(deps: LexeraEmbeddedBoardBridgeDeps | null | undefined): boolean;
  /** Resolve a `KeyboardEvent` to a shortcut action id (via
   *  `MV_SHORTCUTS`) or `null` if no chord matches. The keydown
   *  handler installed by `install` calls this to decide whether to
   *  forward the event as `multiview-shortcut`. */
  shortcutForKeydownEvent(event: KeyboardEvent): string | null;
  /** Static chord → action map. Read-only by convention; the
   *  embedded-board side mirrors the four open-helper actions
   *  defined in `LexeraNavigationBridgeApi.SHORTCUT_ACTIONS`. */
  MV_SHORTCUTS: LexeraEmbeddedBoardBridgeShortcutMap;
}

/**
 * Source: src/shell/bridges/requestBridge.js (IIFE;
 * window.LexeraRequestBridge = api). Request/response IPC pattern
 * over Tauri events: pairs a request event with a `<event>-response`
 * event using a unique correlation id. Used for cross-webview features
 * that need a return value (e.g., "build the context menu for this
 * scope and give me the items back" — see workspaceShell.js:~4684).
 *
 * Caller-side `request` emits to a specific webview and resolves
 * with its response or rejects on timeout. Responder-side
 * `handleRequest` installs a handler that auto-broadcasts the
 * response with the same correlation id.
 *
 * Stateful — call `create({ tauri, invoke })` once per webview to
 * get the `{ request, handleRequest }` instance. Throws if either
 * dep is missing.
 */
interface LexeraRequestBridgeInstance {
  /** Send `requestEvent` to `targetLabel` and resolve with the
   *  responder's data, or reject on `_error` / timeout. Default
   *  timeout 2000ms. The bridge uses the existing tauri runtime's
   *  `multiview_emit_to` IPC for delivery. */
  request<TResponse = unknown>(
    targetLabel: string,
    requestEvent: string,
    payload?: unknown,
    timeoutMs?: number
  ): Promise<TResponse>;
  /** Install a handler for `requestEvent` that auto-broadcasts the
   *  response (with the request's correlation id) on
   *  `<requestEvent>-response`. The handler may return a value or
   *  a Promise; thrown / rejected values are forwarded as `_error`
   *  strings on the response payload. Returns the listen()
   *  unsubscribe function (wrapped in a Promise — Tauri's
   *  `listen()` returns a Promise<UnlistenFn>). */
  handleRequest(
    requestEvent: string,
    handler: (data: unknown) => unknown | Promise<unknown>
  ): Promise<unknown>;
}

interface LexeraRequestBridgeApi {
  /** Build a `{ request, handleRequest }` instance bound to the
   *  supplied Tauri runtime + invoke functions. Throws if either
   *  required dep is missing. */
  create(deps: {
    tauri: () => unknown;
    invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
  }): LexeraRequestBridgeInstance;
}

/**
 * Source: src/workspace/layoutPersistence.js (IIFE;
 * window.LexeraLayoutPersistence = api). Owns the localStorage /
 * sessionStorage round-trip for the workspace shell layout — pure
 * `serialize` / `hydrate` helpers + IO-bound `persist` / `restore`.
 *
 * Storage policy: workspace-pinned windows + the boot main window go
 * to localStorage; transient secondary windows (detached panel-only,
 * etc.) use sessionStorage so ad-hoc layouts don't pollute persistent
 * storage. Per-workspace keying so two windows on the same workspace
 * share one saved layout (last save wins).
 *
 * Wire format (versions 1-3 are legacy `panelDocks` groups migrated
 * via layoutTree.migratePanelDocksToSideDocks; version 4 is the
 * current `sideDocks` tree shape).
 *
 * Stateful — `setup()` must be called once with the live shell state
 * + helper deps before any other call.
 */
interface LexeraLayoutPersistenceSerializedTab {
  id: string;
  kind: 'board' | 'panel';
  /** Set on `kind: 'board'`. */
  boardId?: string;
  /** Set on `kind: 'panel'`. Carries the resolved panel instance id. */
  panelId?: string;
  /** Optional view discriminator preserved across persistence. */
  viewKind?: string;
}
interface LexeraLayoutPersistenceSerializedTabsNode {
  type: 'tabs';
  id: string;
  activeTabId: string;
  tabs: Array<LexeraLayoutPersistenceSerializedTab>;
}
interface LexeraLayoutPersistenceSerializedSplitNode {
  type: 'split';
  id: string;
  axis: 'horizontal' | 'vertical';
  ratio: number;
  first: LexeraLayoutPersistenceSerializedNode | null;
  second: LexeraLayoutPersistenceSerializedNode | null;
}
type LexeraLayoutPersistenceSerializedNode =
  | LexeraLayoutPersistenceSerializedTabsNode
  | LexeraLayoutPersistenceSerializedSplitNode;

/**
 * The narrow slice of the workspace shell `state` this module reads
 * + writes. Kept structural so persistence stays decoupled from the
 * umbrella `WorkspaceShellState` typedef in workspaceShell.js.
 */
interface LexeraLayoutPersistenceState {
  mounted: boolean;
  windowLabel: string;
  profile: string;
  /** Centre dock root — `LexeraDockTreeNode | null`. */
  dockTree: LexeraDockTreeNode | null;
  sideDocks: { left: LexeraDockTreeNode | null; right: LexeraDockTreeNode | null; bottom: LexeraDockTreeNode | null };
  dockSizes: { [dockId: string]: number };
  dockRestoreSizes: { [dockId: string]: number };
  panelVisibility: { [panelId: string]: boolean };
  panelInstances: { [panelId: string]: unknown };
  foldedPanes: { [paneId: string]: number };
  activePanelId: string;
  activeLeafId: string;
  hooks?: { getPersistenceKey?: () => string };
}

interface LexeraLayoutPersistenceSetupDeps {
  state: LexeraLayoutPersistenceState;
  layoutTree: unknown;
  panelDefs: unknown;
  nextId: (prefix: string) => string;
  resolvePanelTarget: (panelId: string | null | undefined) => string;
  syncIntegratedPanelVisibility: () => void;
  ensureActiveLeaf: () => void;
}

interface LexeraLayoutPersistenceApi {
  /** Bind shell state + helpers. Throws if any required dep is
   *  missing. Must be called once at boot before any other method. */
  setup(deps: LexeraLayoutPersistenceSetupDeps): void;
  /** Pure: serialise a live dock-tree node into the wire shape.
   *  Returns null for null input. */
  serialize(node: LexeraDockTreeNode | null | undefined): LexeraLayoutPersistenceSerializedNode | null;
  /** Pure: rebuild a live dock-tree node from a serialized payload.
   *  `panelInstances` defaults to `state.panelInstances`. Tolerates
   *  partial / wrong-shape payloads by returning null. */
  hydrate(
    raw: LexeraLayoutPersistenceSerializedNode | null | undefined,
    panelInstances?: { [panelId: string]: unknown }
  ): LexeraDockTreeNode | null;
  /** Side-effecting: serialise `state` and write JSON to the
   *  resolved storage (local- or sessionStorage). */
  persist(): void;
  /** Side-effecting: read JSON from the resolved storage and
   *  hydrate `state` in place. Returns true on a successful restore;
   *  false on missing / unparseable / version-mismatch payloads. */
  restore(): boolean;
  /** Storage key for the current workspace / window context.
   *  Honours `state.hooks.getPersistenceKey` override. */
  getPersistenceKey(): string;
  /** Pick localStorage vs sessionStorage based on workspace pin +
   *  windowLabel. */
  getPersistenceStorage(): Storage;
}

/**
 * Source: src/workspace/boardHost.js (IIFE;
 * window.LexeraBoardHost = api). Owns the shell-side wiring for
 * embedded board webviews — webview-label minting (with per-shell
 * boot-id suffix to keep labels globally unique across windows),
 * embedded URL construction, the connection-health dot, and the
 * placeholder visibility observer that drives `multiview_set_visible`
 * + geometry pushes.
 *
 * Stateful — `setup({ bootId })` may be called once at boot to set
 * the unique-suffix; without it, labels fall back to the legacy
 * `board-tab-<tabId>` shape (single-window unit-test convenience).
 */
interface LexeraBoardHostTab {
  /** The tab id minted by the layout-tree id factory. */
  id: string;
  /** Set on board tabs (kind === 'board'). */
  boardId?: string;
  /** 'kanban' | 'canvas' — sets the `view=` query param on the
   *  embedded URL when present. */
  viewKind?: string;
  /** Discriminator that matches `LexeraDockTreeTab`'s `kind`. */
  kind?: string;
}

interface LexeraBoardHostApi {
  /** Bind the per-shell bootId. Optional — single-window tests load
   *  the module without setup and get the legacy un-suffixed label
   *  shape, which is fine for those scenarios. */
  setup(deps?: { bootId?: string }): void;
  /** Resolve the iframe `contentWindow` currently rendering
   *  `boardId`, or null when no host iframe owns it. Used for
   *  mutation delegation — workspace-tree drag mutations must land
   *  inside the iframe whose `fullBoardData` is the live source. */
  getFrameWindowForBoard(
    dockTree: LexeraDockTreeNode | null | undefined,
    frameCache: { [tabId: string]: HTMLIFrameElement } | null | undefined,
    boardId: string | null | undefined
  ): Window | null;
  /** Mint the webview label for a tab id. Includes the per-shell
   *  bootId suffix when `setup` set it; falls back to
   *  `board-tab-<tabId>` otherwise. */
  multiviewLabelForTab(tabId: string): string;
  /** Inverse: recover a tab id from a webview label. Returns ''
   *  when the label doesn't carry the `board-tab-` prefix. */
  tabIdFromBoardLabel(label: string | null | undefined): string;
  /** Build the embedded-board URL the child webview should load
   *  for a board tab. Returns '' for non-board tabs. */
  getEmbeddedUrlForTab(
    tab: LexeraBoardHostTab | null | undefined,
    locationHref: string
  ): string;
  /** Convert an absolute embedded-board URL into the relative form
   *  Tauri 2's `WebviewBuilder::App` expects. Returns the input
   *  unchanged on parse failure. */
  multiviewUrlForTab(desiredSrc: string | null | undefined): string;
  /** Ensure the placeholder element has a `.mv-health-dot` child
   *  reflecting the webview's connection state. Returns the dot
   *  element, or null when no document is available. */
  ensureHealthDot(
    placeholderEl: HTMLElement,
    doc?: Document
  ): HTMLElement | null;
  /** Install the MutationObserver + IntersectionObserver pair that
   *  drives `multiview_set_visible` IPCs and geometry pushes on
   *  placeholder visibility changes. Idempotent per tabId — a
   *  second call for the same `(tabId, placeholderEl)` pair is a
   *  no-op; a different placeholder rebinds. */
  watchPlaceholderVisibility(
    tabId: string,
    placeholderEl: HTMLElement,
    pushGeomFn?: () => void,
    labelOverride?: string
  ): void;
  /** Disconnect and forget the visibility observer for a tab.
   *  Called when the tab's child webview is destroyed or evicted. */
  cleanupVisibilityObserver(tabId: string): void;
  /** Test seam — true when a visibility observer is currently
   *  bound for `tabId`. */
  hasVisibilityObserver(tabId: string): boolean;
}

/**
 * Source: src/workspace/sharedPanels.js (IIFE;
 * window.LexeraSharedPanels = api). Per-kind registry of duplicable
 * panel instances (hierarchy / dashboard / week+monthCalendar / logs /
 * backendSettings / frontendSettings). Each kind has a factory that
 * mints an HTMLElement; the registry tracks live instances so the
 * shell can enumerate roots (e.g. for theme broadcasts) and tear
 * them down at unmount.
 *
 * `lexera-shared-panel-created` CustomEvent fires on `window` for
 * every successful `createPanelElement` call so listeners (e.g.
 * sub-app boot code) can wire onto fresh panel DOM.
 */
interface LexeraSharedPanelsCreatedEventDetail {
  kind: string;
  instanceId: string;
  element: HTMLElement;
}

interface LexeraSharedPanelsApi {
  /** True when `kind` is one of the duplicable panel kinds (the
   *  registry's allowlist). */
  isDuplicableKind(kind: string): boolean;
  /** Build + register a new panel instance. Returns the rooted
   *  HTMLElement on success, `null` when the kind has no factory.
   *  Dispatches `lexera-shared-panel-created` on `window`. */
  createPanelElement(kind: string, instanceId: string): HTMLElement | null;
  /** Drop the registered instance for `instanceId` from the
   *  registry. Caller is responsible for actually removing the DOM
   *  node — this method only forgets the reference. */
  unregisterInstance(instanceId: string): void;
  /** Enumerate live root elements for one panel kind. Returns an
   *  empty array for non-duplicable kinds. */
  getRoots(kind: string): HTMLElement[];
}

/**
 * Source: src/shell/lifecycle.js (IIFE; window.LexeraLifecycle = api).
 * Webview lifecycle: LRU freshness tracking, soft-cap eviction, and a
 * pre-warmed webview pool that the spawn fast-path can repurpose via
 * `navigateWebview` (the renderer process is kept alive — much cheaper
 * than `add_child`).
 *
 * Transport primitives (`spawn`, `destroy`, `setGeometry`,
 * `navigateWebview`, `listWebviews`) live in `multiviewClient.js` and
 * are dependency-injected via `create({...})`. Returns the lifecycle
 * instance — `multiviewClient.js` exposes it on `LexeraMultiview.lifecycle`.
 *
 * Mirrors the JSDoc `@typedef`s in `src/shell/lifecycle.js`; if the
 * interfaces below diverge from those, the typedef-check gate will
 * surface the mismatch.
 */
interface LexeraLifecycleConfig {
  softCap: number;
  poolSize: number;
  poolUrl: string;
  pinnedLabels: string[];
}

interface LexeraLifecycleSpawnOptions {
  label: string;
  url: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface LexeraLifecycleGeometryUpdate {
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface LexeraLifecycleWebviewListEntry {
  label: string;
}

interface LexeraLifecycleDeps {
  spawn(opts: LexeraLifecycleSpawnOptions): Promise<unknown>;
  destroy(label: string): Promise<unknown>;
  setGeometry(updates: Array<LexeraLifecycleGeometryUpdate>): Promise<unknown>;
  navigateWebview(label: string, url: string): Promise<unknown>;
  listWebviews(): Promise<Array<LexeraLifecycleWebviewListEntry>>;
  /** Optional URL search string for config overrides. Defaults to
   *  `window.location.search`. */
  locationSearch?: string;
  /** Optional initial config; missing fields fall back to defaults. */
  config?: LexeraLifecycleConfig;
}

interface LexeraLifecycleSpawnResult {
  label: string;
  /** True when the spawn was satisfied by repurposing a pool entry
   *  (renderer process kept alive) instead of `add_child`. */
  fromPool: boolean;
}

interface LexeraLifecycleStatus {
  config: LexeraLifecycleConfig;
  /** Per-label LRU timestamp (ms epoch). */
  freshness: { [label: string]: number };
  /** Labels of currently-pre-warmed pool entries. */
  pool: string[];
}

interface LexeraLifecycleInstance {
  /** Apply a partial config update; returns the merged config. */
  configure(updates: Partial<LexeraLifecycleConfig>): LexeraLifecycleConfig;
  /** Snapshot of current config + freshness + pool, intended for
   *  diagnostics / debug surfaces. */
  status(): LexeraLifecycleStatus;
  /** Spawn (or repurpose from pool) a webview at the requested
   *  geometry. The instance handles soft-cap eviction first if
   *  the spawn would push live count past `softCap`. */
  spawn(opts: LexeraLifecycleSpawnOptions): Promise<LexeraLifecycleSpawnResult>;
  /** Mark `label` as recently-used so it survives soft-cap eviction. */
  touch(label: string): void;
  /** Force a soft-cap pass (normally fired by `spawn`). */
  evictOldestIfOverCap(): Promise<unknown>;
  /** Force a pool top-up to `poolSize` entries. */
  refillPool(): Promise<unknown>;
  /** Test seams — internal state accessors for vitest. */
  _getConfig(): LexeraLifecycleConfig;
  _getFreshness(): { [label: string]: number };
  _getPool(): string[];
}

interface LexeraLifecycleApi {
  /** Build a lifecycle instance bound to the supplied transport
   *  primitives. */
  create(deps: LexeraLifecycleDeps): LexeraLifecycleInstance;
  /** Resolve a `LexeraLifecycleConfig` from the supplied URL
   *  search string (or `window.location.search`). Used by `create`
   *  when no explicit `config` is passed in `deps`. */
  defaultConfig(searchString?: string): LexeraLifecycleConfig;
}

/**
 * Frontend log levels accepted by `lexeraLog` (the in-app logger that
 * surfaces every entry into the Log panel). Per-feedback in CLAUDE.md
 * the kanban frontend MUST log only via `lexeraLog` / `logFrontendIssue`
 * — never `console.*` or stderr — so callers across the codebase
 * funnel through this signature.
 */
type LexeraLogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Drag-payload type discriminators handled by the external-DnD bridge
 * (defined in src/dragdrop/dragDropHandlers.js). The bridge dispatches
 * to per-kind drop handlers (card / row / stack / column) based on
 * the `type` field. `tree-*` variants come from sub-app webviews
 * (workspace-tree / hierarchy panel); `board-*` and `column` come
 * from in-board drag.
 */
type LexeraExternalDndPayloadType =
  | 'tree-card'
  | 'board-row'
  | 'tree-row'
  | 'board-stack'
  | 'tree-stack'
  | 'column'
  | 'tree-column';

/**
 * Cross-webview drag payload. `source` shape varies per `type`
 * (a card-id string for `tree-card`, a row hierarchy object for
 * `board-row`, etc.) — typed as `unknown` so consumers narrow on
 * `type` first before destructuring `source`.
 */
interface LexeraExternalDndPayload {
  type: LexeraExternalDndPayloadType | string;
  source: unknown;
}

/**
 * Source: src/dragdrop/dragDropHandlers.js (`registerExternalDndBridge`
 * installs `window.__lexeraExternalDnd = api`). The cross-Tauri-webview
 * drag receiver — sub-apps (hierarchyDragBridge, embeddedBoardBridge)
 * forward pointer events from one webview into the kanban board's
 * webview via `multiview_emit_to`, and the kanban-side handler relays
 * them through this API. Pointer events do NOT cross WKWebView
 * boundaries naturally; this bridge is the workaround.
 */
interface LexeraExternalDndApi {
  /** Update drop preview for the supplied cross-view drag point.
   *  Returns `true` when a drop target was matched. Inserts the
   *  per-type drop-zone indicators on the first hover for a new
   *  drag type. */
  hover(
    payload: LexeraExternalDndPayload | null | undefined,
    x: number,
    y: number
  ): boolean;
  /** Apply the drop at the supplied cross-view drag point. Returns
   *  `true` when a per-type handler accepted the drop. */
  drop(
    payload: LexeraExternalDndPayload | null | undefined,
    x: number,
    y: number
  ): boolean;
  /** Tear down drop-zone indicators and reset the cached drag-type
   *  state. Called when the source ends the drag without a drop. */
  clear(): void;
}

/**
 * Snapshot returned by `getLogFoldedStatusData()` (defined in
 * src/logging/loggingSystem.js). Drives the four badges rendered in
 * the bottom-dock fold strip when the log panel is collapsed:
 * connection state, log count, sync user count, and in-flight API
 * call count.
 */
interface LexeraLogFoldedStatusData {
  /** Backend connection state. Drives the green/red dot + label. */
  connected: boolean;
  /** Total log entries currently in the in-memory buffer. */
  logCount: number;
  /** Number of remote sync peers currently visible in `LexeraApi`. */
  userCount: number;
  /** Number of `LexeraApi` requests still awaiting a response. */
  inFlightCount: number;
}

/**
 * Source: src/workspace/panelDefinitions.js (IIFE;
 * window.LexeraPanelDefinitions = api). Owns the canonical panel
 * registry plus pure normalisers for the persisted shell state
 * shape. Stateful — `setup({ nextId })` must be called before any
 * `createDefault*` factory so newly-minted ids come from the
 * shared layout-tree id counter.
 */
type LexeraPanelDefinitionsDockId = 'left' | 'right' | 'bottom';
type LexeraPanelDefinitionsProfile = 'workspace' | 'detachedBoard' | string;

interface LexeraPanelDefinition {
  id: string;
  title: string;
  // Typed as `string` rather than the narrow `DockId` union so the
  // bare object literals in `panelDefinitions.js` (`defaultDock: 'left'`)
  // satisfy the table without an `as const`. JSDoc keeps the
  // narrower contract documented; this boundary stays permissive
  // for the JS literal.
  defaultDock: string;
  duplicable: boolean;
  integratedHeader: boolean;
}
type LexeraPanelDefinitionTable = { [kind: string]: LexeraPanelDefinition };

interface LexeraPanelDefinitionsInstance {
  id: string;
  kind: string;
}
type LexeraPanelDefinitionsInstanceMap = { [instanceId: string]: LexeraPanelDefinitionsInstance };

// Carries an index signature in addition to the three known keys so
// the LayoutPersistence state's looser `{ [dockId: string]: number }`
// shape stays assignable to it. The typedef-tightening sweep is
// progressive — both forms must coexist until every consumer
// migrates to the named keys.
interface LexeraPanelDefinitionsDockSizeMap {
  left: number;
  right: number;
  bottom: number;
  [dockId: string]: number;
}
interface LexeraPanelDefinitionsDockRestoreSizeMap {
  left: number;
  right: number;
  bottom: number;
  [dockId: string]: number;
}
type LexeraPanelDefinitionsVisibilityMap = { [panelId: string]: boolean };

interface LexeraPanelDefinitionsDockGroups {
  left: Array<Array<string>>;
  right: Array<Array<string>>;
  bottom: Array<Array<string>>;
}

interface LexeraPanelDefinitionsSideDocksMap {
  left: LexeraDockTreeNode | null;
  right: LexeraDockTreeNode | null;
  bottom: LexeraDockTreeNode | null;
}

interface LexeraPanelDefinitionsApi {
  /** Bind the shared layout-tree id factory. Throws if `nextId`
   *  isn't a function. Must be called once before any
   *  `createDefault*` factory mints ids. */
  setup(deps: { nextId: (prefix: string) => string }): void;
  /** Static panel registry — keyed by panel kind. Read-only at the
   *  call-site; mutating it would corrupt the runtime. */
  readonly PANEL_DEFINITIONS: LexeraPanelDefinitionTable;
  /** Per-kind default visibility used by `createDefaultPanelVisibility`. */
  readonly DEFAULT_PANEL_VISIBILITY: LexeraPanelDefinitionsVisibilityMap;
  /** A copy of the runtime allow-list (kinds the current shell may
   *  show). Defaults to every key in PANEL_DEFINITIONS until
   *  `configureAllowedPanelKinds` filters it. */
  getAllowedPanelKinds(): string[];
  /** True when `kind` is a registered panel AND on the current
   *  runtime allow-list. */
  isPanelKindAllowed(kind: string | null | undefined): boolean;
  /** True when `kind` exists in PANEL_DEFINITIONS, regardless of
   *  the allow-list. Used by setup-time validation. */
  isPanelKindAllowedFromDefinitions(kind: string | null | undefined): boolean;
  /** Replace the runtime allow-list. Empty / invalid input resets
   *  to "every defined kind". Unknown kinds are dropped silently. */
  configureAllowedPanelKinds(allowedKinds: string[] | null | undefined): void;
  /** Default dock layout for a fresh shell — left, right, bottom
   *  arrays of group arrays. */
  getDefaultDockGroups(): LexeraPanelDefinitionsDockGroups;
  /** First kind on the current allow-list, or '' when the
   *  allow-list is empty. */
  getFirstAllowedPanelKind(): string;
  /** Coerce arbitrary input to a registered + allowed kind. Returns
   *  '' (not the input) when the value isn't permitted. */
  normalizePanelKind(value: string | null | undefined): string;
  /** Build a fresh `{ instanceId → instance }` map for every
   *  allowed panel kind. */
  createDefaultPanelInstances(): LexeraPanelDefinitionsInstanceMap;
  /** Coerce a partial / wrong-shape persisted panel-instance map
   *  into the canonical shape. Drops entries whose kind is no
   *  longer registered + allowed; mints fresh ids via the bound
   *  `nextId` for instances missing one. */
  normalizePanelInstances(raw: unknown): LexeraPanelDefinitionsInstanceMap;
  /** Resolve an instance id from a stored `value` against the
   *  current `panelInstances`. Falls back to the kind itself when
   *  `value` doesn't resolve (back-compat with pre-instance state). */
  normalizePanelIdWithInstances(
    value: string | null | undefined,
    panelInstances: LexeraPanelDefinitionsInstanceMap | null | undefined
  ): string;
  /** Clamp a dock pixel size to that dock's allowed range. Bottom
   *  is the only horizontal-axis dock so it has its own scale. */
  clampPanelSize(dockId: LexeraPanelDefinitionsDockId, value: unknown): number;
  /** Coerce + clamp arbitrary persisted-state input to a valid
   *  pixel size. Non-numeric / sentinel values are mapped to 0
   *  (collapsed). */
  normalizeDockSizeValue(dockId: LexeraPanelDefinitionsDockId, value: unknown): number;
  /** Default `{left, right, bottom}` pixel sizes for a profile.
   *  `'detachedBoard'` returns all-zero. */
  createDefaultDockSizes(profile: LexeraPanelDefinitionsProfile): LexeraPanelDefinitionsDockSizeMap;
  /** Default restore-sizes for the springback-on-uncollapse path. */
  createDefaultDockRestoreSizes(profile: LexeraPanelDefinitionsProfile): LexeraPanelDefinitionsDockRestoreSizeMap;
  /** Coerce a persisted DockSizeMap into the canonical shape +
   *  clamp each axis. */
  normalizeDockSizes(raw: unknown, profile: LexeraPanelDefinitionsProfile): LexeraPanelDefinitionsDockSizeMap;
  /** Coerce a persisted DockRestoreSizeMap. */
  normalizeDockRestoreSizes(raw: unknown, profile: LexeraPanelDefinitionsProfile): LexeraPanelDefinitionsDockRestoreSizeMap;
  /** Default `{ panelId → boolean }` map for a profile. */
  createDefaultPanelVisibility(profile: LexeraPanelDefinitionsProfile): LexeraPanelDefinitionsVisibilityMap;
  /** Helper used by panelDocks normalisers — dedupe a list of
   *  panel ids in place against `seen`. Mutates `seen`. */
  ensureUniquePanelIds(
    ids: string[],
    seen: { [id: string]: boolean },
    panelInstances: LexeraPanelDefinitionsInstanceMap | null | undefined
  ): string[];
  /** Coerce a persisted panel-docks shape (legacy `{ left, right,
   *  bottom: Array<Array<string>> }`) into the canonical groups
   *  shape, dropping unknown / disallowed instance ids. */
  normalizePanelDocks(
    raw: unknown,
    profile: LexeraPanelDefinitionsProfile,
    panelInstances: LexeraPanelDefinitionsInstanceMap | null | undefined
  ): LexeraPanelDefinitionsDockGroups;
  /** Coerce a persisted panel-visibility map. */
  normalizePanelVisibility(
    raw: unknown,
    profile: LexeraPanelDefinitionsProfile,
    panelInstances: LexeraPanelDefinitionsInstanceMap | null | undefined
  ): LexeraPanelDefinitionsVisibilityMap;
  /** Default empty side-docks tree map (all three sides null) for
   *  a profile that wants no panels. */
  createDefaultSideDocks(profile: LexeraPanelDefinitionsProfile): LexeraPanelDefinitionsSideDocksMap;
}

/**
 * Public surface of `src/views/_shared/subAppRuntime.js` (set via
 * `window.LexeraSubApp = { … }`). Only the methods that consumers
 * actually call are typed — the rest land as `any` until a future
 * slice tightens them. Keep this in sync with the object literal
 * at subAppRuntime.js:758.
 */
interface LexeraSubAppApi {
  init(opts: any): void;
  navigate(payload: any): Promise<unknown>;
  /** Broadcasts to sibling-window or global subscribers depending on event kind. */
  broadcast(event: string, payload?: any): Promise<unknown>;
  invoke(cmd: string, args?: any): Promise<unknown>;
  getQueryParam(name: string): string;
  getContext(): {
    panelKind: string;
    panelInstanceId: string;
    paneId: string;
    windowLabel: string;
    hostWindowLabel: string;
  };
  getPanelKind(): string;
  getPanelInstanceId(): string;
  getPaneId(): string;
  getWindowLabel(): string;
  getHostWindowLabel(): string;
  /** Returns the Tauri webview record (label + listen) for the current
   *  webview. Returns null when the Tauri runtime isn't available. */
  getCurrentWebview(): { label: string; listen: Function } | null;
  applyThemeSnapshot(snap: any): void;
  confirmModal(opts: any): Promise<boolean>;
  promptModal(opts: any): Promise<string | null>;
  showNotification(message: string, opts?: any): void;
}

/**
 * Public surface of `src/views/_shared/treeCrossViewDrop.js` — the
 * shared destination-side cross-view drop receiver wired by
 * hierarchy.js and workspaces.js. Stage 17d extracted the duplicated
 * code from both sub-apps; Stage 17j brings the module into the
 * typedef gate.
 */
interface LexeraTreeCrossViewDropApi {
  install(deps: {
    /** Hit-test for the local tree DOM. Returns the resolved tree-node
     *  + a `{ boardId, kind, entityId, position? }` info record, or
     *  null when no valid target is under the cursor. */
    readDropTargetFromPoint(
      clientX: number,
      clientY: number,
      source: { boardId: string; kind: string; entityId: string } | null
    ): {
      node: Element;
      info: {
        boardId: string;
        kind: string;
        entityId: string;
        position?: 'before' | 'after';
      };
    } | null;
    /** Returns the current webview's label string for the self-skip
     *  guard. May return '' when the runtime isn't ready. */
    getOwnWebviewLabel?(): string;
  }): {
    onExternalDnd(
      eventKind: 'hover' | 'drop' | 'clear',
      payload: LexeraExternalDndPayload | null | undefined
    ): void;
    armCrossDragTracker(src: {
      boardId?: string;
      kind?: string;
      entityId?: string;
      sourceWebviewLabel?: string;
    } | null): void;
    teardownCrossDragTracker(reason?: string): void;
  };
  /** Best-effort destructure of a cross-view DnD payload into the
   *  receiver's `{ boardId, kind, entityId }` shape. Returns null
   *  when the payload doesn't carry a recognizable source. */
  mapXviewSourceFromPayload(payload: LexeraExternalDndPayload | null | undefined): {
    boardId: string;
    kind: string;
    entityId: string;
  } | null;
  KIND_TO_TYPE: Record<string, string>;
}

declare global {
  interface Window {
    // Lexera shell + workspace modules (window.LexeraXxx = (() => ...)()).
    lexeraLog(level: LexeraLogLevel, message: string): void;
    /** Same shape as `lexeraLog` plus an explicit `target` channel
     *  for routing into per-area filters in the in-app log panel
     *  (e.g. 'frontend' / 'notification.info' / 'sub-app.setup').
     *  Set on `window` by subAppRuntime.js's `installSubAppLogger`. */
    lexeraLogWithTarget(level: LexeraLogLevel, target: string, message: string): void;
    /** Toast / pill notifications. Installed by
     *  subAppRuntime.js's `installSubAppNotifications` (and the shell
     *  has its own implementation). `opts` is loosely-typed for now —
     *  future slice can tighten to { variant, duration, action, ... }. */
    showNotification(message: string, opts?: any): void;
    LexeraLayoutTree: LexeraLayoutTreeApi;
    /** Typed via `@typedef LexeraLifecycleReconcilerApi` in
     *  src/workspace/lifecycleReconciler.js (script-mode JS @typedef
     *  declarations leak into the global TS namespace). */
    LexeraLifecycleReconciler: LexeraLifecycleReconcilerApi;
    LexeraBoardHost: LexeraBoardHostApi;
    LexeraPanelHost: LexeraPanelHostApi;
    LexeraMultiviewWebview: LexeraMultiviewWebviewApi;
    LexeraMultiview: LexeraMultiviewApi;
    LexeraMessageBridge: LexeraMessageBridgeApi;
    LexeraLayoutPersistence: LexeraLayoutPersistenceApi;
    LexeraTabDragController: LexeraTabDragControllerApi;
    LexeraGeometryObserver: LexeraGeometryObserverApi;
    LexeraPanelDefinitions: LexeraPanelDefinitionsApi;
    LexeraTreeRegistry: LexeraTreeRegistryApi;
    LexeraTitleHelpers: LexeraTitleHelpersApi;
    LexeraSharedPanels: LexeraSharedPanelsApi;
    LexeraSubApp: LexeraSubAppApi;
    LexeraTreeCrossViewDrop: LexeraTreeCrossViewDropApi;
    // First-pass `any` declarations — future slices can tighten.
    // Added 2026-05-10 (Stage 17l) so embeddedBoardBridge.js can
    // type-check; the actual public surfaces live in their respective
    // modules' IIFE assignments.
    LexeraTestApi: any;
    LexeraApi: any;
    LexeraCalendarRuntime: LexeraCalendarRuntimeApi;
    LEXERA_VISUAL_THEMES: Array<LexeraVisualTheme>;
    getLexeraCurrentVisualThemeId(): string;
    applyLexeraVisualTheme(themeId: string | null | undefined, options?: Record<string, unknown>): LexeraVisualTheme;
    ContextMenuBuilders: any;
    LexeraInspectorTestApi: LexeraInspectorTestApi;
    LexeraLogTestApi: LexeraLogTestApi;
    LexeraDebugWindow: LexeraDebugWindowTestApi;
    LexeraDragDropHandlers: any;
    LexeraOrderHelpers: any;
    LexeraRowStackMenu: any;
    LexeraActionRegistry: LexeraActionRegistryApi;
    LexeraContentEnhancerRegistry: LexeraContentEnhancerRegistryApi;
    LexeraTagSystem: LexeraTagSystemApi;
    LexeraDropZoneIndicators: LexeraDropZoneIndicatorsApi;
    LexeraPollingService: any;
    LexeraCanvasMode: LexeraCanvasModeApi;
    LexeraCanvasPan: LexeraCanvasPanApi;
    LexeraControlsDispatcher: any;
    LexeraCanvasLayout: LexeraCanvasLayoutApi;
    LexeraColumnContextMenu: any;
    LexeraKeyboardNavigation: any;
    LexeraAppShellShortcuts: LexeraAppShellShortcutsApi;
    LexeraBoardList: any;
    LexeraSidebarSync: LexeraSidebarSyncApi;
    LexeraSidebarTree: LexeraSidebarTreeApi;
    LexeraHierarchyController: LexeraHierarchyControllerApi;
    LexeraFrontendTests: any;
    LexeraFilesTestApi: LexeraFilesTestApi;
    LexeraRenderAppsTestApi: LexeraRenderAppsTestApi;
    LexeraRenderAppsSettings: LexeraRenderAppsSettingsApi;
    LexeraBackendSettingsTestApi: LexeraBackendSettingsTestApi;
    LexeraFrontendSettings: LexeraFrontendSettingsApi;
    LexeraFrontendSettingsTestApi: LexeraFrontendSettingsTestApi;
    LexeraDashboardTestApi: LexeraDashboardTestApi;
    LexeraDevtoolsTitle: LexeraDevtoolsTitleApi;
    LexeraBoardSettingRegistry: LexeraBoardSettingRegistryApi;
    LexeraMenuContributorRegistry: LexeraMenuContributorRegistryApi;
    LexeraCanvasDom: LexeraCanvasDomApi;
    LexeraViewState: LexeraViewStateApi;
    LexeraDiagramRegistry: LexeraDiagramRegistryApi;
    LexeraCanvasStackDrop: LexeraCanvasStackDropApi;
    LexeraAppUtils: LexeraAppUtilsApi;
    LexeraMediaCategory: LexeraMediaCategoryApi;
    LexeraCanvasViewport: LexeraCanvasViewportApi;
    LexeraFoldState: LexeraFoldStateApi;
    LexeraScrollBehavior: LexeraScrollBehaviorApi;
    LexeraControlsSettings: any;
    LexeraCardContentRenderer: any;
    LexeraDiagramDeps: LexeraAppUtilsDeps;
    ManagementUI: any;
    LexeraSettingsRuntime: LexeraSettingsRuntimeApi;
    LexeraWorkspaceShell: any;
    LexeraDashboard: LexeraDashboardApi;
    LexeraDebug: LexeraDebugApi;
    LexeraEmbedMenu: any;
    LexeraThemeBridge: LexeraThemeBridgeApi;
    LexeraCatalogBridge: LexeraCatalogBridgeApi;
    LexeraNavigationBridge: LexeraNavigationBridgeApi;
    LexeraRequestBridge: LexeraRequestBridgeApi;
    LexeraManagementBridge: LexeraManagementBridgeApi;
    LexeraBackendStatusBridge: LexeraBackendStatusBridgeApi;
    LexeraEmbeddedBoardBridge: LexeraEmbeddedBoardBridgeApi;
    LexeraHierarchyDragBridge: LexeraHierarchyDragBridgeApi;
    LexeraKeybindingRegistry: LexeraKeybindingRegistryApi;
    LexeraRuntime: LexeraRuntimeApi;
    LexeraDialogs: LexeraDialogsApi;
    LexeraInspectorShortcuts: LexeraInspectorShortcutsApi;
    LexeraPanelLaunchers: LexeraPanelLaunchersApi;
    LexeraLifecycle: LexeraLifecycleApi;

    // Logging diagnostics.
    getLogFoldedStatusData(): LexeraLogFoldedStatusData;

    // Tauri 2 globals injected by the runtime.
    __TAURI__: any;
    __TAURI_INTERNALS__: any;

    // Test seams. All optional — only the test runner / debug surface
    // sets them; production code does truthy-checks before reading.
    /** Trace every mutation through the in-app logger. Vitest sets
     *  this to surface state transitions in failing-test diagnostics. */
    __lexeraDebugMutations?: boolean;
    __lexeraExternalDnd: LexeraExternalDndApi;
    /** Single-install guard for `views/_shared/healthDot.js` so
     *  multiple sub-apps loading the script don't double-attach the
     *  observer. Set to `true` at module-load time. */
    __lexeraHealthDotInstalled?: boolean;
    /** Single-install guards for `shell/bridges/catalogBridge.js` —
     *  wraps `LexeraMultiview.broadcastCatalog` / `openBoardInView`
     *  to add tracing without double-wrapping if the bridge initialises
     *  multiple times (idempotence). */
    __lexeraMultiviewCatalogWrapped?: boolean;
    __lexeraMultiviewOpenBoardWrapped?: boolean;
    /** Capture per-mutation profiler entries (timestamps + durations).
     *  Used by the debug-window profiler trace. */
    __lexeraProfileMutations?: boolean;
    /** Monotonic counter incremented on every `renderColumns` call —
     *  vitest asserts on it to confirm render budgets. */
    __lexeraRenderColumnsCount?: number;
    /** True after the first `renderColumns` call lands. Vitest uses
     *  it as a boot-readiness gate. */
    __lexeraRenderColumnsEverCalled?: boolean;
  }

  // Bare globals (declared without `window.` prefix at their call
  // sites — IIFE-pattern leak from sibling scripts loaded before
  // workspaceShell.js into the same window).
  function traceFrontendAction(...args: any[]): any;
  function setDropZoneHighlight(...args: any[]): any;
  function showNativeMenu(...args: any[]): any;
  function showInFinder(...args: any[]): any;
  function logFrontendIssue(...args: any[]): any;
  function lexeraLog(...args: any[]): any;
  // Vendor IIFE bound to bare-name access in settingsRuntime.js
  // (loaded via plain <script> tag, doesn't carry `window.` prefix
  // at every call site).
  const ContextMenuBuilders: any;
  // Settings store IIFE — loaded before sidebarSync.js, accessed by
  // bare name via `typeof LexeraSettings !== 'undefined'`.
  const LexeraSettings: any;
  // Plugin registry IIFE — accessed by bare name via `typeof
  // LexeraPluginRegistry !== 'undefined'` in contentEnhancerRegistry.js.
  const LexeraPluginRegistry: any;
  // ControlsSettings IIFE — accessed by bare name in scrollBehavior.js
  // via `typeof LexeraControlsSettings !== 'undefined'`.
  const LexeraControlsSettings: any;
  // Tag system IIFE — also accessed by bare name via `LexeraTagSystem.x`
  // from sidebarTree.js and other consumers loaded after tagSystem.js.
  // (The Window-typed form is `LexeraTagSystemApi`; the bare-name const
  // stays `any` because the bare-name reference doesn't always import
  // the Window narrowing.)
  const LexeraTagSystem: any;
  // Hierarchy contract IIFE — accessed by bare name from sidebarTree.js
  // for entity capability lookups.
  const LexeraHierarchyContract: any;
  // SubApp IIFE — broadcast/listen sugar, accessed by bare name in
  // some view bootstraps (`LexeraSubApp.broadcast(...)`).
  const LexeraSubApp: any;
  // (`LEXERA_THEMES`, `applyLexeraTheme`, `getLexeraCurrentThemeId`
  // live in src/themes.js as top-level `var`/`function` declarations;
  // since that file is in the typedef gate, tsc infers their types
  // directly from the .js literals — no .d.ts re-declaration here.)

  // Custom property the shell stashes on a side-dock header DOM
  // node so it can match the centre-tree overflow header lookup.
  interface Element {
    _wsOverflowHeaderEl?: HTMLElement | null;
  }
  interface HTMLElement {
    _wsOverflowHeaderEl?: HTMLElement | null;
  }
}

export {};
