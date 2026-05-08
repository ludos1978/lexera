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

declare global {
  interface Window {
    // Lexera shell + workspace modules (window.LexeraXxx = (() => ...)()).
    lexeraLog: any;
    LexeraLayoutTree: any;
    LexeraLifecycleReconciler: any;
    LexeraBoardHost: any;
    LexeraPanelHost: any;
    LexeraMultiviewWebview: any;
    LexeraMultiview: any;
    LexeraMessageBridge: any;
    LexeraLayoutPersistence: any;
    LexeraTabDragController: any;
    LexeraGeometryObserver: LexeraGeometryObserverApi;
    LexeraPanelDefinitions: any;
    LexeraTreeRegistry: any;
    LexeraTitleHelpers: LexeraTitleHelpersApi;
    LexeraSharedPanels: any;
    LexeraWorkspaceShell: any;
    LexeraDashboard: any;
    LexeraDebug: any;
    LexeraEmbedMenu: any;
    LexeraThemeBridge: any;
    LexeraCatalogBridge: any;
    LexeraNavigationBridge: any;
    LexeraRequestBridge: any;
    LexeraManagementBridge: any;
    LexeraBackendStatusBridge: any;
    LexeraEmbeddedBoardBridge: any;
    LexeraHierarchyDragBridge: any;
    LexeraKeybindingRegistry: any;
    LexeraRuntime: any;
    LexeraDialogs: any;

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
