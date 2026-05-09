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
  isPanelTab(tab: any): boolean;
  isBoardTab(tab: any): boolean;
  visitTree(
    node: any,
    visitor: (candidate: any, parent: any, side: 'first' | 'second' | '') => void,
    parent?: any,
    side?: 'first' | 'second' | ''
  ): void;
  getFirstLeaf(node: any): any;
  findLeafById(node: any, leafId: string): any;
  findNodeAndParent(node: any, nodeId: string): any;
  findTab(
    node: LexeraDockTreeNode | null,
    tabId: string
  ): { tab: any; leaf: LexeraDockTreeLeaf; index: number } | null;
  findClosestSplitParent(node: any, targetLeafId: string, parentSplit?: any): any;
  countTreeTabs(tree: LexeraDockTreeNode | null): number;
  collectAllTabIds(tree: LexeraDockTreeNode | null): string[];
  /** Remove a tab from anywhere in the tree by tab.id. Returns the
   *  hit record `{ removed, leaf, index }` or `null` when the tab
   *  wasn't found. Updates the affected leaf's activeTabId to
   *  follow the "first remaining tab" rule.
   *
   *  `removed` is typed as `any` (not `LexeraDockTreeTab`) because
   *  many consumers in workspaceShell.js access `.boardId` /
   *  `.viewKind` directly without narrowing on `kind` first;
   *  tightening the return surfaces 10+ latent type errors that
   *  need a separate narrowing pass. */
  removeTabById(
    tree: LexeraDockTreeNode | null,
    tabId: string
  ): { removed: any; leaf: LexeraDockTreeLeaf; index: number } | null;
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
   *  success, `null` on bounds / type failure. `tab` typed as `any`
   *  for the same narrow-by-kind reason called out on `removeTabById`. */
  moveTab(
    sourceLeaf: LexeraDockTreeLeaf,
    sourceIndex: number,
    destLeaf: LexeraDockTreeLeaf,
    destIndex?: number
  ): { tab: any; insertedAt: number } | null;
  /** Wholesale replace `holder[key]` with `nextTree`. Returns the
   *  symmetric `{ removed, added }` tab-id diff so the caller can
   *  clean up frame caches / multiview state for removed ids. */
  replaceTreeRoot(holder: any, key: string, nextTree: any): { removed: string[]; added: string[] };
  createIdFactory(): (prefix: string) => string;
  createTabsetNode(tabs: any[], idFactory?: (prefix: string) => string): any;
  createSplitNode(axis: 'horizontal' | 'vertical', first: any, second: any, ratio: number, idFactory?: (prefix: string) => string): any;
  withNormalizedLeaves(node: any, isRoot: boolean, idFactory?: (prefix: string) => string): any;
  createBoardTab(boardId: string, viewKind: string | null | undefined, idFactory?: (prefix: string) => string): any;
  createPanelTab(panelId: string, idFactory?: (prefix: string) => string): any;
  migratePanelDocksToSideDocks(panelDocks: any, panelGroupActives: any, idFactory?: (prefix: string) => string): any;
  findLeafContainingBoard(node: any, boardId: string, viewKind?: string): any;
  findAnyLeafContainingBoard(node: any, boardId: string): any;
  findLeafContainingPanel(node: any, panelId: string, resolvePanelTarget?: (id: string) => string): { tab: any; leaf: any } | null;
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
    state: any;
    layoutTree: any;
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

declare global {
  interface Window {
    // Lexera shell + workspace modules (window.LexeraXxx = (() => ...)()).
    lexeraLog: any;
    LexeraLayoutTree: LexeraLayoutTreeApi;
    /** Typed via `@typedef LexeraLifecycleReconcilerApi` in
     *  src/workspace/lifecycleReconciler.js (script-mode JS @typedef
     *  declarations leak into the global TS namespace). */
    LexeraLifecycleReconciler: LexeraLifecycleReconcilerApi;
    LexeraBoardHost: any;
    LexeraPanelHost: any;
    LexeraMultiviewWebview: any;
    LexeraMultiview: any;
    LexeraMessageBridge: LexeraMessageBridgeApi;
    LexeraLayoutPersistence: LexeraLayoutPersistenceApi;
    LexeraTabDragController: LexeraTabDragControllerApi;
    LexeraGeometryObserver: LexeraGeometryObserverApi;
    LexeraPanelDefinitions: any;
    LexeraTreeRegistry: LexeraTreeRegistryApi;
    LexeraTitleHelpers: LexeraTitleHelpersApi;
    LexeraSharedPanels: any;
    LexeraWorkspaceShell: any;
    LexeraDashboard: any;
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
    LexeraRuntime: any;
    LexeraDialogs: LexeraDialogsApi;
    LexeraInspectorShortcuts: LexeraInspectorShortcutsApi;
    LexeraPanelLaunchers: LexeraPanelLaunchersApi;
    LexeraLifecycle: any;

    // Logging diagnostics.
    getLogFoldedStatusData: any;

    // Tauri 2 globals injected by the runtime.
    __TAURI__: any;
    __TAURI_INTERNALS__: any;

    // Test seams.
    __lexeraDebugMutations: any;
    __lexeraExternalDnd: any;
    __lexeraProfileMutations: any;
    __lexeraRenderColumnsCount: any;
    __lexeraRenderColumnsEverCalled: any;
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
