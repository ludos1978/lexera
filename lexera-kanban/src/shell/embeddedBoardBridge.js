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

  function formatDebugGeometryValue(value) {
    return String(Math.round(Number(value) || 0));
  }

  function formatSignedDebugGeometryValue(value) {
    var num = Math.round(Number(value) || 0);
    if (num > 0) return '+' + String(num);
    return String(num);
  }

  var debugGeometryInvoke = null;
  var pendingDebugGeometryPayload = null;
  var pendingDebugGeometryFlushInstalled = false;

  function requestCurrentDebugGeometry(label) {
    if (!label || typeof debugGeometryInvoke !== 'function') return;
    debugGeometryInvoke('multiview_broadcast', {
      event: 'debug-geometry-request',
      payload: { label: String(label) }
    }).catch(function () {});
  }

  function schedulePendingDebugGeometryOverlayFlush() {
    if (pendingDebugGeometryFlushInstalled || typeof document === 'undefined') return;
    pendingDebugGeometryFlushInstalled = true;
    var flush = function () {
      pendingDebugGeometryFlushInstalled = false;
      if (!pendingDebugGeometryPayload) return;
      var payload = pendingDebugGeometryPayload;
      pendingDebugGeometryPayload = null;
      updateDebugGeometryOverlay(payload);
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', flush, { once: true });
      return;
    }
    setTimeout(flush, 0);
  }

  function ensureDebugGeometryOverlay() {
    if (!document.getElementById('lexera-mv-debug-geometry-styles')) {
      var styleEl = document.createElement('style');
      styleEl.id = 'lexera-mv-debug-geometry-styles';
      styleEl.textContent =
        '#lexera-mv-debug-geometry {' +
        'position: fixed;' +
        'top: 4px;' +
        'left: 4px;' +
        'z-index: 2147483647;' +
        'pointer-events: auto;' +
        'font: 11px/1.25 var(--font-mono, monospace);' +
        'color: var(--text-primary, #fff);' +
        'background: color-mix(in srgb, var(--bg-secondary, #111) 88%, transparent);' +
        'border: 1px solid color-mix(in srgb, var(--accent, #6aa0ff) 55%, transparent);' +
        'border-radius: 3px;' +
        'padding: 3px 6px;' +
        'box-shadow: 0 1px 3px rgba(0, 0, 0, 0.18);' +
        'display: flex;' +
        'flex-direction: column;' +
        'gap: 4px;' +
        'min-width: 168px;' +
        '}' +
        '#lexera-mv-debug-geometry .mv-debug-geometry-text {' +
        'white-space: pre;' +
        'pointer-events: none;' +
        '}' +
        '#lexera-mv-debug-geometry .mv-debug-geometry-controls {' +
        'display: grid;' +
        'grid-template-columns: repeat(4, minmax(0, 1fr));' +
        'gap: 3px 6px;' +
        '}' +
        '#lexera-mv-debug-geometry .mv-debug-geometry-row {' +
        'display: flex;' +
        'align-items: center;' +
        'gap: 3px;' +
        '}' +
        '#lexera-mv-debug-geometry .mv-debug-geometry-key {' +
        'min-width: 10px;' +
        'pointer-events: none;' +
        '}' +
        '#lexera-mv-debug-geometry button {' +
        'appearance: none;' +
        'border: 1px solid color-mix(in srgb, var(--accent, #6aa0ff) 55%, transparent);' +
        'background: color-mix(in srgb, var(--bg-tertiary, #1c1c1c) 90%, transparent);' +
        'color: var(--text-primary, #fff);' +
        'border-radius: 2px;' +
        'padding: 0 5px;' +
        'font: inherit;' +
        'line-height: 1.2;' +
        'cursor: pointer;' +
        '}' +
        '#lexera-mv-debug-geometry button:hover {' +
        'background: color-mix(in srgb, var(--accent, #6aa0ff) 20%, var(--bg-tertiary, #1c1c1c));' +
        '}';
      (document.head || document.documentElement || document.body).appendChild(styleEl);
    }
    if (!document.body) return null;
    var overlay = document.getElementById('lexera-mv-debug-geometry');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'lexera-mv-debug-geometry';
      overlay.setAttribute('aria-hidden', 'true');
      var textEl = document.createElement('div');
      textEl.className = 'mv-debug-geometry-text';
      overlay.appendChild(textEl);
      var controlsEl = document.createElement('div');
      controlsEl.className = 'mv-debug-geometry-controls';
      var fields = [
        { key: 'x', label: 'x' },
        { key: 'y', label: 'y' },
        { key: 'width', label: 'w' },
        { key: 'height', label: 'h' }
      ];
      for (var i = 0; i < fields.length; i++) {
        (function (field) {
          var row = document.createElement('div');
          row.className = 'mv-debug-geometry-row';
          var keyEl = document.createElement('span');
          keyEl.className = 'mv-debug-geometry-key';
          keyEl.textContent = field.label;
          row.appendChild(keyEl);
          ['-', '+'].forEach(function (symbol) {
            var button = document.createElement('button');
            button.type = 'button';
            button.textContent = symbol;
            button.addEventListener('click', function (event) {
              event.preventDefault();
              event.stopPropagation();
              if (!overlay.getAttribute('data-target-label')) return;
              if (typeof debugGeometryInvoke !== 'function') return;
              debugGeometryInvoke('multiview_broadcast', {
                event: 'debug-geometry-adjust',
                payload: {
                  label: overlay.getAttribute('data-target-label'),
                  field: field.key,
                  delta: symbol === '+' ? 1 : -1
                }
              }).catch(function () {});
            });
            row.appendChild(button);
          });
          controlsEl.appendChild(row);
        })(fields[i]);
      }
      overlay.appendChild(controlsEl);
      document.body.appendChild(overlay);
    }
    return overlay;
  }

  function updateDebugGeometryOverlay(payload) {
    if (!payload) return;
    pendingDebugGeometryPayload = payload;
    var overlay = ensureDebugGeometryOverlay();
    if (!overlay) {
      schedulePendingDebugGeometryOverlayFlush();
      return;
    }
    pendingDebugGeometryPayload = null;
    overlay.setAttribute('data-target-label', String(payload.label || ''));
    var title = payload.boardId
      ? ('board ' + String(payload.boardId))
      : String(payload.label || 'board');
    var nativeRect = payload.native || {};
    var shellRect = payload.shell || {};
    var adjust = payload.adjust || {};
    var textEl = overlay.querySelector('.mv-debug-geometry-text') || overlay;
    textEl.textContent =
      title + '\n' +
      'native ' + formatDebugGeometryValue(nativeRect.x) + ',' + formatDebugGeometryValue(nativeRect.y) +
      ' ' + formatDebugGeometryValue(nativeRect.width) + 'x' + formatDebugGeometryValue(nativeRect.height) + '\n' +
      'shell  ' + formatDebugGeometryValue(shellRect.x) + ',' + formatDebugGeometryValue(shellRect.y) +
      ' ' + formatDebugGeometryValue(shellRect.width) + 'x' + formatDebugGeometryValue(shellRect.height) + '\n' +
      'delta  ' + formatSignedDebugGeometryValue(adjust.x) + ',' + formatSignedDebugGeometryValue(adjust.y) +
      ' ' + formatSignedDebugGeometryValue(adjust.width) + 'x' + formatSignedDebugGeometryValue(adjust.height);
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
    debugGeometryInvoke = invoke;
    var wv = getCurrentWebview();
    if (!wv || typeof wv.listen !== 'function') return false;

    injectFillStyles();

    wv.listen('debug-geometry', function (event) {
      updateDebugGeometryOverlay(event && event.payload ? event.payload : null);
    });
    requestCurrentDebugGeometry(wv.label || '');

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
