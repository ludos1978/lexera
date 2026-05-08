(function () {
  'use strict';

  /**
   * @typedef {Object} PanelHostSetupDeps
   * @property {string} [bootId] - Per-shell boot id appended to panel
   *   webview labels. Optional — when absent, labels fall back to the
   *   un-suffixed `panel-tab-<tabId>` form (currently only the unit
   *   tests).
   */

  /**
   * @typedef {Object} PanelHostTab
   *   The narrow subset of `DockTreePanelTab` this module reads. Kept
   *   structural so the host stays decoupled from the umbrella
   *   `DockTreeNode` typedef in workspaceShell.js / layoutTree.js.
   * @property {string} id - The tab id used in the webview label.
   * @property {string} [panelId] - The panel instance id; when
   *   missing, falls through to the panel kind in the `panel=` query
   *   param so the sub-app gets a usable instance handle.
   */

  // Per-shell boot id, used as a uniqueness suffix in panel-tab webview
  // labels. See `boardHost.js` for full rationale — Tauri webview
  // labels are GLOBAL across windows, so two shells handing out the
  // same tab id would otherwise collide.
  /** @type {string} */
  var _bootId = '';

  /**
   * @param {PanelHostSetupDeps} [deps]
   * @returns {void}
   */
  function setup(deps) {
    if (deps && typeof deps.bootId === 'string') {
      _bootId = deps.bootId;
    }
  }

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

  /**
   * @param {string|null|undefined} panelKind
   * @returns {string}
   */
  function viewDirForKind(panelKind) {
    if (!panelKind) return '';
    var override = KIND_VIEW_DIR_OVERRIDES[panelKind];
    return override || panelKind;
  }

  /**
   * Returns true if the given panel kind should be hosted as a child
   * webview (Workstream P) rather than as an in-shell DOM element.
   * @param {string|null|undefined} kind
   * @returns {boolean}
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
   *
   * Format: `panel-tab-<bootId>-<tabId>` (or `panel-tab-<tabId>` if
   * the module wasn't initialised — only happens in unit tests).
   * The bootId guarantees the label is unique across windows.
   *
   * @param {string} tabId
   * @returns {string}
   */
  function panelLabelForTab(tabId) {
    var safeTabId = String(tabId);
    if (_bootId) return 'panel-tab-' + _bootId + '-' + safeTabId;
    return 'panel-tab-' + safeTabId;
  }

  /**
   * Inverse of `panelLabelForTab`. Recovers the tabId from a panel
   * webview label, accounting for the optional bootId suffix.
   * Returns '' when the label doesn't have the panel-tab prefix.
   *
   * @param {string|null|undefined} label
   * @returns {string}
   */
  function tabIdFromPanelLabel(label) {
    var raw = String(label || '');
    if (raw.indexOf('panel-tab-') !== 0) return '';
    var rest = raw.substring('panel-tab-'.length);
    if (_bootId && rest.indexOf(_bootId + '-') === 0) {
      return rest.substring(_bootId.length + 1);
    }
    return rest;
  }

  /**
   * @param {URL} fromUrl
   * @param {URL} toUrl
   * @param {string} childLabel
   * @returns {void}
   */
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
   * IMPORTANT: dock-hosted panels must load their dedicated per-kind
   * sub-app entrypoint under `src/views/<kind>/index.html`, not the
   * shell's `index.html?panelKind=...` compatibility path. The latter
   * boots the legacy workspace shell runtime inside the child webview
   * and defeats the view migration entirely.
   *
   * URL params:
   *   - `panelKind=<kind>` — kind identity for diagnostics/future hooks.
   *   - `pane=<tabId>` — the dock-tab identity for routing.
   *   - `panel=<panelInstanceId>` — instance id for duplicable panels.
   *
   * Returns '' if the inputs are missing required pieces.
   *
   * @param {PanelHostTab|null|undefined} tab
   * @param {string|null|undefined} panelKind
   * @param {string|null|undefined} locationHref
   * @returns {string}
   */
  function panelUrlForTab(tab, panelKind, locationHref) {
    if (!tab || !panelKind || !locationHref) return '';
    var sourceUrl = new URL(locationHref);
    var viewDir = viewDirForKind(panelKind);
    if (!viewDir) return '';
    var url = new URL('views/' + viewDir + '/index.html', sourceUrl);
    applyChildWindowContext(sourceUrl, url, panelLabelForTab(tab.id));
    url.searchParams.set('panelKind', panelKind);
    url.searchParams.set('pane', tab.id);
    url.searchParams.set('panel', tab.panelId || panelKind);
    return url.toString();
  }

  var api = {
    setup: setup,
    PANEL_WEBVIEW_KINDS: PANEL_WEBVIEW_KINDS,
    isPanelKindOnWebviewAllowlist: isPanelKindOnWebviewAllowlist,
    panelLabelForTab: panelLabelForTab,
    tabIdFromPanelLabel: tabIdFromPanelLabel,
    panelUrlForTab: panelUrlForTab,
    viewDirForKind: viewDirForKind
  };

  if (typeof window !== 'undefined') {
    window.LexeraPanelHost = api;
  }
})();
