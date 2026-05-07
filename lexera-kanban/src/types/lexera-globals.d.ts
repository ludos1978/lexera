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
    LexeraGeometryObserver: any;
    LexeraPanelDefinitions: any;
    LexeraTreeRegistry: any;
    LexeraTitleHelpers: any;
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
