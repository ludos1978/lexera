(function () {
  'use strict';

  // PANEL_WEBVIEW_KINDS is the allowlist of panel kinds whose dock-hosted
  // tabs should spawn a child webview instead of being rendered in the
  // shell DOM. Each kind is migrated one slice at a time per Workstream P
  // in TODOs-lexera-multiview.md. Kinds NOT on this list keep using the
  // legacy LexeraSharedPanels.createPanelElement() path until they are
  // migrated.
  // Per the user's hard requirement and the aggressive Workstream P
  // migration: ALL panel kinds spawn child webviews. The legacy in-shell
  // DOM panel hosting has been deleted. Kinds whose `src/views/<dir>/`
  // sub-app is still a stub will visually show a "not yet ported"
  // placeholder until their full UI is ported in a later slice.
  var PANEL_WEBVIEW_KINDS = Object.freeze({
    logs: true,
    dashboard: true,
    hierarchy: true,
    weekCalendar: true,
    monthCalendar: true,
    backendSettings: true,
    frontendSettings: true,
    renderApps: true,
    files: true,
    frontendTests: true
  });

  // Map a panel kind to the directory under src/views/ that hosts its
  // sub-app. Most kinds use their own name as the directory; only legacy
  // mismatches (predating the formal kind taxonomy) need overrides.
  var KIND_VIEW_DIR_OVERRIDES = Object.freeze({
    logs: 'log'
  });

  function viewDirForKind(panelKind) {
    if (!panelKind) return '';
    var override = KIND_VIEW_DIR_OVERRIDES[panelKind];
    return override || panelKind;
  }

  /**
   * Returns true if the given panel kind should be hosted as a child
   * webview (Workstream P) rather than as an in-shell DOM element.
   */
  function isPanelKindOnWebviewAllowlist(kind) {
    return !!(kind && PANEL_WEBVIEW_KINDS[kind] === true);
  }

  /**
   * Routing label for a dock-hosted panel webview. Distinct from the
   * 'board-tab-' prefix used by board webviews so the multiview-destroyed
   * listener can disambiguate. The shell-side spawn registry is keyed by
   * tabId regardless of prefix; the prefix only matters for the Rust-side
   * webview label and the broadcast filtering done by event listeners.
   */
  function panelLabelForTab(tabId) {
    return 'panel-tab-' + String(tabId);
  }

  function applyChildWindowContext(fromUrl, toUrl, childLabel) {
    if (!fromUrl || !toUrl || !childLabel) return;
    var hostWindowLabel = fromUrl.searchParams.get('windowLabel') || 'main';
    toUrl.searchParams.set('windowLabel', String(childLabel));
    toUrl.searchParams.set('workspaceShellHostLabel', hostWindowLabel);
  }

  /**
   * Build the URL the dock-hosted panel webview should load. Kept pure
   * relative to its inputs (locationHref is supplied by the shell from
   * window.location.href) so the function is easy to unit-test.
   *
   * The URL points at the kanban's `index.html` with the `panelKind`
   * query parameter — that triggers the kanban's existing panel-only-
   * window mode, which renders the FULL legacy panel UI (rich
   * hierarchy tree, full dashboard, full test runner, etc.) inside the
   * webview. Same code as before; just running in its own webview /
   * process. This gives architectural compliance (each view in its
   * own DOM) plus exact feature parity (no per-kind reimplementation).
   *
   * URL params:
   *   - `panelKind=<kind>` — triggers panel-only-window mode in the
   *     kanban's workspaceShell IIFE.
   *   - `pane=<tabId>` — the dock-tab identity for routing.
   *   - `panel=<panelInstanceId>` — instance id for duplicable panels.
   *   - `panelOnly=1` — explicit marker (currently unused by the shell
   *     but useful for quick visual identification in DevTools).
   *
   * Returns '' if the inputs are missing required pieces.
   */
  function panelUrlForTab(tab, panelKind, locationHref) {
    if (!tab || !panelKind || !locationHref) return '';
    var sourceUrl = new URL(locationHref);
    var url = new URL(locationHref);
    url.search = '';
    url.hash = '';
    applyChildWindowContext(sourceUrl, url, panelLabelForTab(tab.id));
    // Same pathname as the shell (`index.html`); the panelKind query
    // param flips the runtime into panel-only mode.
    url.searchParams.set('panelKind', panelKind);
    url.searchParams.set('panelOnly', '1');
    url.searchParams.set('pane', tab.id);
    url.searchParams.set('panel', tab.panelId || panelKind);
    return url.toString();
  }

  var api = {
    PANEL_WEBVIEW_KINDS: PANEL_WEBVIEW_KINDS,
    isPanelKindOnWebviewAllowlist: isPanelKindOnWebviewAllowlist,
    panelLabelForTab: panelLabelForTab,
    panelUrlForTab: panelUrlForTab,
    viewDirForKind: viewDirForKind
  };

  if (typeof window !== 'undefined') {
    window.LexeraPanelHost = api;
  }
})();
