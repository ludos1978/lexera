(function () {
  'use strict';

  // The sub-app side of the multiview wiring. Runs INSIDE each board
  // webview (URL has `?embedded=1`). Listens for shell-broadcast events
  // and bridges them into the legacy `window.message` shape that the
  // embedded board's `orderHelpers.js`, `app.js`, etc. already handle.
  // Also reports focus/health back to the shell, forwards keyboard
  // shortcuts the webview captured before the shell could see them, and
  // services cross-webview request/dispatch (context menus, mutation
  // delegation).
  //
  // The bridge is dependency-injected because `multiviewClient.js` owns
  // the Tauri-runtime accessors (`invoke`, `getCurrentWebview`,
  // `handleRequest`). `install(deps)` is called from `bootMultiview`
  // when a webview's URL marks it as an embedded board.

  function isEmbeddedKanban() {
    try {
      var p = new URLSearchParams(window.location.search || '');
      return p.get('embedded') === '1';
    } catch (_) { return false; }
  }

  // Inject minimal CSS so the embedded board fills its slot with no
  // scrollbar-gutter reservation. Idempotent — checks for the marker
  // <style id> before re-injecting.
  function injectFillStyles() {
    if (document.getElementById('lexera-mv-embed-fill-styles')) return;
    var fillStyle = document.createElement('style');
    fillStyle.id = 'lexera-mv-embed-fill-styles';
    fillStyle.textContent =
      'html, body { margin: 0; padding: 0; min-height: 100%; }' +
      '.columns-container { scrollbar-gutter: auto !important; }' +
      '.columns-container > *:last-child { margin-bottom: 0 !important; }';
    document.head.appendChild(fillStyle);
  }

  function dispatchAsMessage(data) {
    try {
      window.dispatchEvent(new MessageEvent('message', { data: data }));
    } catch (_) {}
  }

  // Keyboard shortcuts that the focused webview captures before the
  // shell can see them. Forwarded as `multiview-shortcut` so the shell
  // (via `navigationBridge`) routes them to the right open helper.
  var MV_SHORTCUTS = {
    'Ctrl+Alt+L': 'open-log-view',
    'Meta+Alt+L': 'open-log-view',
    'Ctrl+Alt+I': 'open-inspector',
    'Meta+Alt+I': 'open-inspector',
    'Ctrl+Alt+W': 'open-workspaces',
    'Meta+Alt+W': 'open-workspaces',
    'Ctrl+Alt+D': 'open-dashboard',
    'Meta+Alt+D': 'open-dashboard'
  };

  function shortcutForKeydownEvent(event) {
    var parts = [];
    if (event.ctrlKey) parts.push('Ctrl');
    if (event.metaKey) parts.push('Meta');
    if (event.shiftKey) parts.push('Shift');
    if (event.altKey) parts.push('Alt');
    if (event.key && event.key.length === 1) parts.push(event.key.toUpperCase());
    else if (event.key) parts.push(event.key);
    return MV_SHORTCUTS[parts.join('+')] || null;
  }

  function install(deps) {
    if (!isEmbeddedKanban()) return false;
    deps = deps || {};
    var getCurrentWebview = deps.getCurrentWebview;
    var invoke = deps.invoke;
    var handleRequest = deps.handleRequest;
    if (typeof getCurrentWebview !== 'function' || typeof invoke !== 'function') return false;
    var wv = getCurrentWebview();
    if (!wv || typeof wv.listen !== 'function') return false;

    injectFillStyles();

    wv.listen('catalog-snapshot', function (event) {
      var p = (event && event.payload) || {};
      dispatchAsMessage({
        type: 'lexera-workspace-catalog',
        boards: Array.isArray(p.boards) ? p.boards : [],
        remoteBoards: Array.isArray(p.remoteBoards) ? p.remoteBoards : [],
        workspaces: Array.isArray(p.workspaces) ? p.workspaces : []
      });
    });

    wv.listen('board-action', function (event) {
      var p = (event && event.payload) || {};
      if (p.action) {
        dispatchAsMessage({ type: 'lexera-board-action', action: p.action });
      }
    });

    wv.listen('layout-drag', function (event) {
      var p = (event && event.payload) || {};
      dispatchAsMessage({ type: 'lexera-layout-drag', active: !!p.active });
    });

    wv.listen('focus-hierarchy-target', function (event) {
      var p = (event && event.payload) || {};
      if (p.target) {
        dispatchAsMessage({ type: 'lexera-focus-hierarchy-target', target: p.target });
      }
    });

    // Re-request snapshots in case the board mounted after the last
    // broadcast — main shell re-emits on receiving these requests.
    invoke('multiview_broadcast', { event: 'catalog-request', payload: {} })
      .catch(function () {});

    // Report focus state to Rust so the shell can detect pane
    // activation in multiview mode (replaces the old window.parent
    // postMessage path that doesn't work cross-process).
    function reportFocus(focused) {
      invoke('multiview_set_focused', { label: wv.label, focused: focused })
        .catch(function () {});
    }
    window.addEventListener('focus', function () { reportFocus(true); });
    window.addEventListener('blur', function () { reportFocus(false); });
    document.addEventListener('pointerdown', function () { reportFocus(true); }, true);
    if (document.hasFocus()) reportFocus(true);

    function reportHealth(state) {
      invoke('multiview_set_health', { label: wv.label, state: state })
        .catch(function () {});
    }
    reportHealth('yellow');

    function refreshHealthFromRuntime() {
      try {
        var rt = window.LexeraRuntime;
        if (!rt || typeof rt.getState !== 'function') return;
        var connected = !!rt.getState('backendConnected');
        var pendingRenders = rt.getState('pendingRenderCount') || 0;
        var s = connected ? (pendingRenders > 0 ? 'yellow' : 'green') : 'red';
        reportHealth(s);
      } catch (_) {}
    }
    window.addEventListener('lexera-backend-connection-state-changed', refreshHealthFromRuntime);
    setTimeout(refreshHealthFromRuntime, 500);
    setInterval(refreshHealthFromRuntime, 3000);

    if (typeof handleRequest === 'function') {
      handleRequest('build-context-menu', function (req) {
        try {
          var rsm = window.LexeraRowStackMenu;
          if (!rsm || typeof rsm.buildContextMenuItemsAndContext !== 'function') {
            return { items: [], context: req.context || {} };
          }
          var built = rsm.buildContextMenuItemsAndContext(req.scope, req.context || {});
          return {
            items: (built && built.items) || [],
            context: (built && built.context) || (req.context || {})
          };
        } catch (e) {
          return { items: [], context: req.context || {}, error: String(e && e.message) };
        }
      });
    }

    wv.listen('dispatch-action', function (event) {
      var p = (event && event.payload) || {};
      try {
        var ar = window.LexeraActionRegistry;
        if (ar && typeof ar.dispatch === 'function' && p.scope && p.action) {
          ar.dispatch(p.scope, p.action, p.context || {});
        }
      } catch (_) {}
    });

    document.addEventListener('keydown', function (event) {
      var action = shortcutForKeydownEvent(event);
      if (!action) return;
      event.preventDefault();
      invoke('multiview_broadcast', {
        event: 'multiview-shortcut',
        payload: { action: action, from: wv.label }
      }).catch(function () {});
    });

    wv.listen('delegate-mutation', function (event) {
      var p = (event && event.payload) || {};
      try {
        var dash = window.LexeraDashboard;
        if (dash && typeof dash[p.method] === 'function') {
          dash[p.method].apply(dash, Array.isArray(p.args) ? p.args : []);
        }
      } catch (e) {
        try {
          if (typeof window.lexeraLog === 'function') {
            window.lexeraLog('warn', '[multiview] delegate-mutation failed: ' + (e && e.message || e));
          }
        } catch (_) {}
      }
    });

    return true;
  }

  var api = {
    isEmbeddedKanban: isEmbeddedKanban,
    install: install,
    shortcutForKeydownEvent: shortcutForKeydownEvent,
    MV_SHORTCUTS: MV_SHORTCUTS
  };

  if (typeof window !== 'undefined') {
    window.LexeraEmbeddedBoardBridge = api;
  }
})();
