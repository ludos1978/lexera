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
  findTab(node: any, tabId: string): { tab: any; leaf: any; index: number } | null;
  findClosestSplitParent(node: any, targetLeafId: string, parentSplit?: any): any;
  countTreeTabs(tree: any): number;
  collectAllTabIds(tree: any): string[];
  /** Remove a tab from anywhere in the tree by tab.id. Returns the
   *  hit record `{ removed, leaf, index }` or `null` when the tab
   *  wasn't found. Updates the affected leaf's activeTabId to
   *  follow the "first remaining tab" rule. */
  removeTabById(tree: any, tabId: string): { removed: any; leaf: any; index: number } | null;
  /** Remove every tab matching tabId from a SINGLE leaf. Returns
   *  the count removed (companion to removeTabById which is
   *  single-match tree-wide). */
  removeTabFromLeaf(leaf: any, tabId: string): number;
  /** Pull the tab at `index` out of `leaf`. Returns the removed
   *  tab object, or `null` on bounds / type failure. Uses the
   *  "left neighbour" activeTabId fallback. */
  extractTabAtIndex(leaf: any, index: number): any;
  /** Insert a tab into a leaf at index; returns the final
   *  inserted index (or -1 on validation failure). */
  insertTabIntoLeaf(leaf: any, tab: any, index?: number): number;
  /** Move a tab between leaves. Returns `{ tab, insertedAt }` on
   *  success, `null` on bounds / type failure. */
  moveTab(
    sourceLeaf: any,
    sourceIndex: number,
    destLeaf: any,
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
 * Recursive DockTreeNode union (DockTreeLeaf | DockTreeSplit) is
 * authored as JSDoc in `workspaceShell.js`. Kept as `any` at this
 * .d.ts boundary so the slice doesn't have to repeat the full union;
 * a follow-up tightening can replace this with a real interface once
 * those JSDoc shapes are exported as a shared type.
 */
type LexeraDockTreeNode = any;

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
    LexeraLayoutPersistence: any;
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
    LexeraCatalogBridge: any;
    LexeraNavigationBridge: any;
    LexeraRequestBridge: LexeraRequestBridgeApi;
    LexeraManagementBridge: any;
    LexeraBackendStatusBridge: LexeraBackendStatusBridgeApi;
    LexeraEmbeddedBoardBridge: any;
    LexeraHierarchyDragBridge: any;
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
