(function () {
  'use strict';

  /**
   * @typedef {Object} BoardHostSetupDeps
   * @property {string} [bootId] - Per-shell boot id appended to webview
   *   labels. Optional — when absent, labels fall back to the
   *   un-suffixed `board-tab-<tabId>` form (single-window unit tests
   *   only).
   */

  /**
   * @typedef {Object} BoardHostTab
   *   The narrow subset of `DockTreeBoardTab` this module reads.
   *   Decoupled from the umbrella DockTreeNode typedef.
   * @property {string} id - The tab id used in the webview label.
   * @property {string} [boardId] - The board this tab opens.
   * @property {string} [viewKind] - 'kanban' / 'canvas' — sets the
   *   `view=` query param when present.
   * @property {string} [kind] - Discriminator (`'board'` for board
   *   tabs, `'panel'` for panel tabs). `getEmbeddedUrlForTab` rejects
   *   non-board tabs via `layoutTree.isBoardTab(tab)`.
   */

  /**
   * @typedef {Object} GeometryUpdate
   * @property {string} label
   * @property {number} x
   * @property {number} y
   * @property {number} width
   * @property {number} height
   */

  /**
   * @typedef {function(): void} PushGeomFn
   *   Caller-supplied geometry pusher. Takes no args — pushes the
   *   geometry for the watched placeholder under whichever rules the
   *   caller wants (per-frame coalescing, etc.). Default fallback
   *   reads the placeholder rect directly and forwards it via
   *   `multiview.pushGeomDeferred`.
   */

  /**
   * @typedef {Object} VisibilityObserverHandle
   * @property {HTMLElement} element - The placeholder this observer is
   *   bound to. Comparing pointers lets a re-watch on the same tab
   *   short-circuit when the DOM node is unchanged.
   * @property {function(): void} disconnect
   */

  /**
   * @typedef {Object<string, VisibilityObserverHandle>} VisibilityObserverMap
   */

  var layoutTree = (typeof window !== 'undefined' && window.LexeraLayoutTree) || null;
  if (!layoutTree) {
    throw new Error('LexeraLayoutTree global is required before boardHost.js');
  }

  // Per-shell boot id used as a uniqueness suffix in webview labels.
  // Tauri webview labels are GLOBAL across windows — `Window::add_child`
  // refuses a label that's already registered anywhere in the app. Two
  // windows that hand out the same tab id (the layout-tree id factory
  // restarts at 1 per shell) would otherwise both try to spawn
  // `board-tab-tab-3` and the second window's spawn would fail. The
  // boot id (Date.now() + random, generated once per shell) makes
  // labels unique across windows.
  //
  // Stays empty until `setup({ bootId })` is called by workspaceShell;
  // unit tests that load this module without setup get the legacy
  // `board-tab-<tabId>` shape, which is fine in single-window test
  // scenarios.
  /** @type {string} */
  var _bootId = '';

  /**
   * @param {BoardHostSetupDeps} [deps]
   * @returns {void}
   */
  function setup(deps) {
    if (deps && typeof deps.bootId === 'string') {
      _bootId = deps.bootId;
    }
  }

  /**
   * Resolve the iframe contentWindow currently rendering boardId, or null
   * when no host iframe owns it. The shell uses this for mutation delegation:
   * when the user reorders elements in the workspace tree for a board that's
   * open in some iframe, mutations must be routed INTO that iframe so they
   * land on the iframe's live `fullBoardData` and go through its save
   * pipeline.
   */
  /**
   * @param {*} dockTree - `DockTreeNode | null`.
   * @param {Object<string, HTMLIFrameElement>|null|undefined} frameCache
   * @param {string|null|undefined} boardId
   * @returns {Window|null}
   */
  function getFrameWindowForBoard(dockTree, frameCache, boardId) {
    if (!boardId) return null;
    var found = layoutTree.findAnyLeafContainingBoard(dockTree, boardId);
    if (!found || !found.tab) return null;
    var frame = frameCache && frameCache[found.tab.id];
    if (!frame || !frame.contentWindow) return null;
    return frame.contentWindow;
  }

  /**
   * Routing label for a board's child webview, used as the multiview
   * registry key. Single source of truth so callers don't hand-format
   * `'board-tab-' + tabId` strings.
   *
   * Format: `board-tab-<bootId>-<tabId>` (or `board-tab-<tabId>` if
   * the module wasn't initialised with a bootId — only happens in
   * isolated unit tests). The bootId guarantees the label is unique
   * across windows so two shells handing out the same tabId don't
   * collide on Tauri's global webview-label registry.
   *
   * @param {string} tabId
   * @returns {string}
   */
  function multiviewLabelForTab(tabId) {
    var safeTabId = String(tabId);
    if (_bootId) return 'board-tab-' + _bootId + '-' + safeTabId;
    return 'board-tab-' + safeTabId;
  }

  /**
   * Inverse of `multiviewLabelForTab`. Recovers the tabId from a
   * webview label, accounting for the optional bootId suffix. Returns
   * '' when the label doesn't have the board-tab prefix at all.
   *
   * @param {string|null|undefined} label
   * @returns {string}
   */
  function tabIdFromBoardLabel(label) {
    var raw = String(label || '');
    if (raw.indexOf('board-tab-') !== 0) return '';
    var rest = raw.substring('board-tab-'.length);
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
   * Build the embedded-board URL the child webview should load for a tab.
   * Returns '' for non-board tabs. `locationHref` is taken from the host
   * window so the same origin is reused; pass it explicitly to keep the
   * function pure relative to its inputs.
   *
   * @param {BoardHostTab|null|undefined} tab
   * @param {string} locationHref
   * @returns {string}
   */
  function getEmbeddedUrlForTab(tab, locationHref) {
    if (!layoutTree.isBoardTab(tab)) return '';
    var sourceUrl = new URL(locationHref);
    var url = new URL(locationHref);
    url.search = '';
    url.hash = '';
    applyChildWindowContext(sourceUrl, url, multiviewLabelForTab(tab.id));
    url.searchParams.set('embedded', '1');
    url.searchParams.set('workspaceShell', '0');
    url.searchParams.set('workspaceShellParent', '1');
    url.searchParams.set('pane', tab.id);
    if (tab.boardId) url.searchParams.set('board', tab.boardId);
    if (tab.viewKind === 'kanban' || tab.viewKind === 'canvas') {
      url.searchParams.set('view', tab.viewKind);
    }
    return url.toString();
  }

  /**
   * Convert an absolute embedded-board URL into the relative form Tauri 2's
   * `WebviewBuilder::App` expects (path + query + fragment, no scheme/host).
   * Returns the input unchanged if it is not a parseable URL.
   *
   * @param {string|null|undefined} desiredSrc
   * @returns {string}
   */
  function multiviewUrlForTab(desiredSrc) {
    if (!desiredSrc) return desiredSrc;
    try {
      var u = new URL(desiredSrc);
      var rel = u.pathname.replace(/^\/+/, '') + (u.search || '') + (u.hash || '');
      return rel || 'index.html';
    } catch (_) {
      return desiredSrc;
    }
  }

  /**
   * Ensure the placeholder has a `.mv-health-dot` child reflecting the
   * webview's connection state. Returns the dot element.
   *
   * @param {HTMLElement} placeholderEl
   * @param {Document} [doc]
   * @returns {HTMLElement|null}
   */
  function ensureHealthDot(placeholderEl, doc) {
    var ownerDoc = doc || (typeof document !== 'undefined' ? document : null);
    if (!ownerDoc) return null;
    /** @type {HTMLElement|null} */
    var dot = /** @type {HTMLElement|null} */ (placeholderEl.querySelector('.mv-health-dot'));
    if (!dot) {
      dot = ownerDoc.createElement('div');
      dot.className = 'mv-health-dot';
      dot.setAttribute('data-health', 'unknown');
      dot.setAttribute('title', 'Connection state: unknown');
      placeholderEl.appendChild(dot);
    }
    return dot;
  }

  // Private registry: tabId → { disconnect() }. Owned by this module so
  // the shell does not have to track visibility observers itself.
  /** @type {VisibilityObserverMap} */
  var visibilityObservers = {};

  /**
   * @param {string} label
   * @param {HTMLElement} placeholderEl
   * @returns {GeometryUpdate|null}
   */
  function computeVisibilityGeometryUpdate(label, placeholderEl) {
    if (!label || !placeholderEl || placeholderEl.offsetParent === null) return null;
    var sharedMultiviewWebview = (typeof window !== 'undefined' && window.LexeraMultiviewWebview) || null;
    if (sharedMultiviewWebview &&
        typeof sharedMultiviewWebview.computeNativeGeometry === 'function') {
      return sharedMultiviewWebview.computeNativeGeometry(label, placeholderEl);
    }
    var r = placeholderEl.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;
    return {
      label: label,
      x: r.left,
      y: r.top,
      width: r.width,
      height: r.height
    };
  }

  /**
   * Track a placeholder's visibility (`.is-active` class + viewport
   * intersection) and mirror it onto the corresponding child webview via
   * `LexeraMultiview`. Without this, hidden placeholders (display:none on
   * ancestor, scrolled out of view, dock collapsed) leave their webview at
   * last-known geometry, possibly painting over unrelated content.
   *
   * Idempotent per tabId — a second call for the same tab is a no-op.
   * Caller can supply a `pushGeomFn` to use shell geometry rules; otherwise
   * a local fallback that pushes the placeholder rect is used.
   *
   * @param {string} tabId
   * @param {HTMLElement} placeholderEl
   * @param {PushGeomFn} [pushGeomFn]
   * @param {string} [labelOverride]
   * @returns {void}
   */
  function watchPlaceholderVisibility(tabId, placeholderEl, pushGeomFn, labelOverride) {
    if (visibilityObservers[tabId]) {
      // If the placeholder element is the same, this is an idempotent no-op.
      // If the shell re-rendered and replaced the DOM node for this tab,
      // we must disconnect the old observer and re-bind to the new one.
      if (visibilityObservers[tabId].element === placeholderEl) return;
      cleanupVisibilityObserver(tabId);
    }
    if (typeof window === 'undefined' || !window.LexeraMultiview) return;
    var multiview = window.LexeraMultiview;
    var label = labelOverride || multiviewLabelForTab(tabId);
    var lastVisible = null;
    function localPushGeom() {
      var update = computeVisibilityGeometryUpdate(label, placeholderEl);
      if (!update) return;
      // Use the per-frame coalescer if available (Perf #2 in the
      // multiview TODOs) so dock-divider drags don't generate one IPC
      // per webview per frame.
      if (typeof multiview.pushGeomDeferred === 'function') {
        multiview.pushGeomDeferred(update);
      } else {
        multiview.setGeometry([update]).catch(function () {});
      }
    }
    var doPushGeom = typeof pushGeomFn === 'function' ? pushGeomFn : localPushGeom;
    function syncVisible() {
      var suppressed = window.LexeraMultiviewWebview &&
        typeof window.LexeraMultiviewWebview.isAllVisibleSuppressed === 'function' &&
        window.LexeraMultiviewWebview.isAllVisibleSuppressed();
      var visible = !suppressed &&
        placeholderEl.classList.contains('is-active') &&
        placeholderEl.offsetParent !== null &&
        placeholderEl.getBoundingClientRect().width > 0;
      if (visible === lastVisible) return;
      lastVisible = visible;
      multiview.invoke('multiview_set_visible', {
        label: label, visible: visible
      }).catch(function () {});
      if (visible) {
        doPushGeom();
      } else {
        // Belt-and-braces: park the hidden webview far offscreen so even if
        // Tauri's hide() is delayed/unreliable on this OS, the webview is
        // not visually overlapping anything else.
        if (typeof multiview.pushGeomDeferred === 'function') {
          multiview.pushGeomDeferred({
            label: label, x: -50000, y: -50000, width: 1, height: 1
          });
        } else {
          multiview.setGeometry([{
            label: label, x: -50000, y: -50000, width: 1, height: 1
          }]).catch(function () {});
        }
      }
    }
    var observers = [];
    if (window.MutationObserver) {
      var mo = new window.MutationObserver(syncVisible);
      mo.observe(placeholderEl, { attributes: true, attributeFilter: ['class', 'style'] });
      observers.push({ disconnect: function () { mo.disconnect(); } });
    }
    if (window.IntersectionObserver) {
      var io = new window.IntersectionObserver(syncVisible);
      io.observe(placeholderEl);
      observers.push({ disconnect: function () { io.disconnect(); } });
    }
    visibilityObservers[tabId] = {
      element: placeholderEl,
      disconnect: function () {
        for (var i = 0; i < observers.length; i++) {
          try { observers[i].disconnect(); } catch (_) {}
        }
      }
    };
    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(syncVisible);
    } else {
      syncVisible();
    }
  }

  /**
   * Disconnect and forget the visibility observer for a tab. Called when
   * the tab's child webview is destroyed or evicted.
   *
   * @param {string} tabId
   * @returns {void}
   */
  function cleanupVisibilityObserver(tabId) {
    if (visibilityObservers[tabId]) {
      try { visibilityObservers[tabId].disconnect(); } catch (_) {}
      delete visibilityObservers[tabId];
    }
  }

  /**
   * Test helper: returns true if a visibility observer is currently
   * registered for the given tab.
   *
   * @param {string} tabId
   * @returns {boolean}
   */
  function hasVisibilityObserver(tabId) {
    return !!visibilityObservers[tabId];
  }

  var api = {
    setup: setup,
    getFrameWindowForBoard: getFrameWindowForBoard,
    multiviewLabelForTab: multiviewLabelForTab,
    tabIdFromBoardLabel: tabIdFromBoardLabel,
    getEmbeddedUrlForTab: getEmbeddedUrlForTab,
    multiviewUrlForTab: multiviewUrlForTab,
    ensureHealthDot: ensureHealthDot,
    watchPlaceholderVisibility: watchPlaceholderVisibility,
    cleanupVisibilityObserver: cleanupVisibilityObserver,
    hasVisibilityObserver: hasVisibilityObserver
  };

  if (typeof window !== 'undefined') {
    window.LexeraBoardHost = api;
  }
})();
