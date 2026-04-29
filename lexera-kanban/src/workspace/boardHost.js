(function () {
  'use strict';

  var layoutTree = (typeof window !== 'undefined' && window.LexeraLayoutTree) || null;
  if (!layoutTree) {
    throw new Error('LexeraLayoutTree global is required before boardHost.js');
  }

  /**
   * Resolve the iframe contentWindow currently rendering boardId, or null
   * when no host iframe owns it. The shell uses this for mutation delegation:
   * when the user reorders elements in the workspace tree for a board that's
   * open in some iframe, mutations must be routed INTO that iframe so they
   * land on the iframe's live `fullBoardData` and go through its save
   * pipeline.
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
   */
  function multiviewLabelForTab(tabId) {
    return 'board-tab-' + String(tabId);
  }

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
   */
  function ensureHealthDot(placeholderEl, doc) {
    var ownerDoc = doc || (typeof document !== 'undefined' ? document : null);
    if (!ownerDoc) return null;
    var dot = placeholderEl.querySelector('.mv-health-dot');
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
  var visibilityObservers = {};

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
   */
  function watchPlaceholderVisibility(tabId, placeholderEl, pushGeomFn, labelOverride) {
    if (visibilityObservers[tabId]) return;
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
      var visible = placeholderEl.classList.contains('is-active') &&
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
   */
  function cleanupVisibilityObserver(tabId) {
    if (visibilityObservers[tabId]) {
      try { visibilityObservers[tabId].disconnect(); } catch (_) {}
      delete visibilityObservers[tabId];
    }
  }

  /** Test helper: returns true if a visibility observer is currently
   *  registered for the given tab. */
  function hasVisibilityObserver(tabId) {
    return !!visibilityObservers[tabId];
  }

  var api = {
    getFrameWindowForBoard: getFrameWindowForBoard,
    multiviewLabelForTab: multiviewLabelForTab,
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
