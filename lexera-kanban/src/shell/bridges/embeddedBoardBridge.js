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
      'html, body { width: 100%; height: 100%; min-height: 100%; margin: 0; padding: 0; overflow: hidden; }' +
      '.columns-container { scrollbar-gutter: auto !important; }' +
      '.columns-container > *:last-child { margin-bottom: 0 !important; }';
    document.head.appendChild(fillStyle);
  }

  function dispatchAsMessage(data) {
    try {
      window.dispatchEvent(new MessageEvent('message', { data: data }));
    } catch (_) {}
  }

  function cleanText(value) {
    return String(value == null ? '' : value).trim();
  }

  function findByAttr(root, selector, attr, value) {
    if (!root || value == null || typeof root.querySelectorAll !== 'function') return null;
    var expected = String(value);
    var nodes = root.querySelectorAll(selector);
    for (var i = 0; i < nodes.length; i++) {
      if (String(nodes[i].getAttribute(attr) || '') === expected) return nodes[i];
    }
    return null;
  }

  function findDashboardFocusElement(nav) {
    if (!nav) return null;
    var boardContainer = document.getElementById('columns-container');
    if (!boardContainer) return null;
    var el = null;
    if (nav.cardId) el = findByAttr(boardContainer, '.card[data-card-id]', 'data-card-id', nav.cardId);
    if (!el && typeof nav.columnIndex === 'number' && typeof nav.cardIndex === 'number') {
      var cards = boardContainer.querySelectorAll('.card[data-col-index][data-card-index]');
      for (var i = 0; i < cards.length; i++) {
        if (parseInt(cards[i].getAttribute('data-col-index') || '', 10) === nav.columnIndex &&
            parseInt(cards[i].getAttribute('data-card-index') || '', 10) === nav.cardIndex) {
          el = cards[i];
          break;
        }
      }
    }
    if (!el && nav.columnId) el = findByAttr(boardContainer, '.column[data-column-id]', 'data-column-id', nav.columnId);
    if (!el && typeof nav.columnIndex === 'number') {
      var cardsEl = findByAttr(boardContainer, '.column-cards[data-col-index]', 'data-col-index', nav.columnIndex);
      el = cardsEl && typeof cardsEl.closest === 'function' ? cardsEl.closest('.column') : null;
    }
    if (!el && nav.stackId) el = findByAttr(boardContainer, '.board-stack[data-stack-id]', 'data-stack-id', nav.stackId);
    if (!el && nav.rowId) el = findByAttr(boardContainer, '.board-row[data-row-id]', 'data-row-id', nav.rowId);
    return el;
  }

  function applyDashboardFocusFallback(nav) {
    var el = findDashboardFocusElement(nav);
    if (!el) return false;
    if (typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    if (el.classList && el.classList.contains('card')) {
      var previous = document.querySelectorAll('.card.focused');
      for (var i = 0; i < previous.length; i++) {
        if (previous[i] !== el) previous[i].classList.remove('focused');
      }
      el.classList.add('focused');
    } else if (el.classList) {
      el.classList.add('board-focus-highlight');
    }
    return true;
  }

  function findFirstBoardCardForTest() {
    var api = window.LexeraTestApi || null;
    if (!api || typeof api.getFullBoardData !== 'function') return null;
    var boardContainer = document.getElementById('columns-container');
    var renderedCard = boardContainer ? boardContainer.querySelector('.card[data-card-id]') : null;
    if (renderedCard) {
      var renderedCardId = cleanText(renderedCard.getAttribute('data-card-id'));
      if (renderedCardId) {
        var renderedColumnIndex = parseInt(renderedCard.getAttribute('data-col-index') || '', 10);
        var renderedCardIndex = parseInt(renderedCard.getAttribute('data-card-index') || '', 10);
        var titleEl = renderedCard.querySelector('.card-title-display') || renderedCard;
        return {
          boardId: typeof api.getActiveBoardId === 'function' ? cleanText(api.getActiveBoardId()) : '',
          rowId: '',
          stackId: '',
          columnId: '',
          cardId: renderedCardId,
          rowIndex: null,
          stackIndex: null,
          colLocalIndex: null,
          columnIndex: isNaN(renderedColumnIndex) ? null : renderedColumnIndex,
          cardIndex: isNaN(renderedCardIndex) ? null : renderedCardIndex,
          columnTitle: '',
          title: cleanText(titleEl && titleEl.textContent) || renderedCardId
        };
      }
    }
    var board = api.getFullBoardData();
    var rows = board && Array.isArray(board.rows) ? board.rows : [];
    var flatIdx = 0;
    for (var r = 0; r < rows.length; r++) {
      var stacks = rows[r] && Array.isArray(rows[r].stacks) ? rows[r].stacks : [];
      for (var s = 0; s < stacks.length; s++) {
        var cols = stacks[s] && Array.isArray(stacks[s].columns) ? stacks[s].columns : [];
        for (var c = 0; c < cols.length; c++) {
          var cards = cols[c] && Array.isArray(cols[c].cards) ? cols[c].cards : [];
          for (var k = 0; k < cards.length; k++) {
            var card = cards[k] || {};
            var cardId = cleanText(card.kid || card.id);
            if (!cardId) continue;
            return {
              boardId: typeof api.getActiveBoardId === 'function' ? cleanText(api.getActiveBoardId()) : '',
              rowId: cleanText(rows[r] && rows[r].id),
              stackId: cleanText(stacks[s] && stacks[s].id),
              columnId: cleanText(cols[c] && cols[c].id),
              cardId: cardId,
              rowIndex: r,
              stackIndex: s,
              colLocalIndex: c,
              columnIndex: flatIdx,
              cardIndex: k,
              columnTitle: cleanText(cols[c] && cols[c].title),
              title: cleanText(String(card.content || '').split('\n')[0]) || cardId
            };
          }
          flatIdx++;
        }
      }
    }
    return null;
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
    invoke('multiview_subscribe', {
      label: wv.label,
      events: [
        'dashboard-navigate',
        'dashboard-board-test-request',
        // Cross-view drag forwarding (Phase 5). The shell-side
        // `hierarchyDragBridge` install path emits these events to
        // whichever webview the cursor is over; the kanban-board
        // webview routes them into `window.__lexeraExternalDnd`,
        // which already knows how to map a cross-app drag payload
        // to the right card / column / row / stack drop target.
        'external-dnd-hover',
        'external-dnd-drop',
        // Per-webview cross-view-drag tracking (2026-05-09). Pointer
        // events do NOT cross separate Tauri WKWebView boundaries
        // — when the user drags from a sub-app webview into THIS
        // kanban webview, the source's pointer events stop firing
        // the moment the cursor crosses the boundary. Each receiver
        // webview compensates by tracking its OWN local pointer
        // while a drag is in flight, and routing those local coords
        // through `__lexeraExternalDnd.hover/drop`. Subscribing here
        // so the listeners arm as soon as the source broadcasts
        // `hierarchy-entity-drag-start`.
        'hierarchy-entity-drag-start',
        'cross-view-drag-handled'
      ]
    }).catch(function () {});

    // Cross-view drag receiver: relay Tauri events to the
    // already-installed `__lexeraExternalDnd` API. The bridge is set
    // up by `dragDropHandlers.registerExternalDndBridge`; subscribe
    // unconditionally so the handler is in place before that runs
    // (timing isn't guaranteed) — checked at call time.
    //
    // Diagnostic: log every drop arrival + the first hover per drag
    // session so the user can see in the Log panel whether stage 5
    // (receiver) actually fires when they expected it to. Same
    // `[xview-dnd]` prefix as the source-side bridge in
    // hierarchyDragBridge.js so a single filter pulls the whole chain.
    var _xviewLoggedHover = false;
    function xviewLog(stage, info) {
      if (typeof window === 'undefined' || typeof window.lexeraLog !== 'function') return;
      try {
        window.lexeraLog('debug', '[xview-dnd] ' + stage + ' ' + JSON.stringify(info || {}));
      } catch (_) { /* non-fatal */ }
    }
    function relayExternalDnd(method, event) {
      var p = (event && event.payload) || {};
      var api = window.__lexeraExternalDnd;
      var isDrop = method === 'drop';
      if (!api || typeof api[method] !== 'function') {
        if (isDrop || !_xviewLoggedHover) {
          xviewLog('receive.no-handler', { method: method, hasApi: !!api });
          _xviewLoggedHover = !isDrop;
        }
        return;
      }
      if (isDrop || !_xviewLoggedHover) {
        xviewLog('receive', {
          method: method,
          x: p.x,
          y: p.y,
          payloadType: p.payload && p.payload.type
        });
        _xviewLoggedHover = !isDrop;
      }
      if (isDrop) _xviewLoggedHover = false; // reset for next drag
      try { api[method](p.payload, p.x, p.y); } catch (err) {
        xviewLog('receive.handler.threw', {
          method: method,
          err: (err && err.message) ? err.message : String(err)
        });
      }
    }
    wv.listen('external-dnd-hover', function (event) { relayExternalDnd('hover', event); });
    wv.listen('external-dnd-drop', function (event) { relayExternalDnd('drop', event); });

    // ─── Per-webview cross-view drag tracking ──────────────────────
    //
    // Tauri WKWebView treats each child webview as a separate process
    // boundary; pointer / mouse events fired in the source webview
    // STOP delivering the moment the cursor crosses out of the
    // source's bounds. The shell-side `hierarchyDragBridge` chain
    // (source.broadcast → shell.forward → destination.receive) only
    // fires when the source's own pointermove fires — which it can't
    // once the cursor is over a different webview. The result: drag
    // hover preview never appears in the destination kanban view, drop
    // never lands. (User report 2026-05-09: "still doesnt allow
    // dragging to the kanban view from the workspace view!!!")
    //
    // Fix: each receiver webview watches its OWN pointermove /
    // pointerup while a drag is in flight, and routes the local
    // (clientX, clientY) straight into `__lexeraExternalDnd.hover` /
    // `.drop`. Activated when ANY webview broadcasts
    // `hierarchy-entity-drag-start`; deactivated on the
    // `cross-view-drag-handled` echo or a 30s safety timeout.
    var crossDragPayload = null;        // { source, type } awaiting hover/drop
    var crossDragMoveHandler = null;
    var crossDragUpHandler = null;
    var crossDragSafetyTimer = 0;
    var KIND_TO_TYPE = {
      row: 'tree-row', stack: 'tree-stack',
      column: 'tree-column', card: 'tree-card'
    };
    function teardownCrossDragListeners() {
      if (crossDragMoveHandler) {
        document.removeEventListener('pointermove', crossDragMoveHandler, true);
        crossDragMoveHandler = null;
      }
      if (crossDragUpHandler) {
        document.removeEventListener('pointerup', crossDragUpHandler, true);
        document.removeEventListener('pointercancel', crossDragUpHandler, true);
        crossDragUpHandler = null;
      }
      if (crossDragSafetyTimer) {
        clearTimeout(crossDragSafetyTimer);
        crossDragSafetyTimer = 0;
      }
      crossDragPayload = null;
      var api = window.__lexeraExternalDnd;
      if (api && typeof api.clear === 'function') {
        try { api.clear(); } catch (_) { /* non-fatal */ }
      }
    }
    wv.listen('hierarchy-entity-drag-start', function (event) {
      var src = (event && event.payload) || null;
      if (!src || !src.kind) {
        xviewLog('local-track.skip(no-source-kind)', {});
        return;
      }
      // Translate source kind to the payload.type strings
      // `__lexeraExternalDnd` expects (mirror of the table in
      // hierarchyDragBridge.js:415).
      var type = KIND_TO_TYPE[src.kind] || ('tree-' + src.kind);
      crossDragPayload = { source: src, type: type };
      // Replace any previous tracker (defensive — shouldn't happen,
      // but a missed cleanup must not leak stale handlers).
      teardownCrossDragListeners();
      crossDragPayload = { source: src, type: type };
      crossDragMoveHandler = function (e) {
        if (!crossDragPayload) return;
        var api = window.__lexeraExternalDnd;
        if (api && typeof api.hover === 'function') {
          try { api.hover(crossDragPayload, e.clientX, e.clientY); } catch (_) { /* non-fatal */ }
        }
      };
      crossDragUpHandler = function (e) {
        if (!crossDragPayload) return;
        var pending = crossDragPayload;
        var api = window.__lexeraExternalDnd;
        var dropped = false;
        if (api && typeof api.drop === 'function') {
          try { dropped = !!api.drop(pending, e.clientX, e.clientY); } catch (_) { /* non-fatal */ }
        }
        xviewLog('local-track.pointerup', {
          x: e.clientX, y: e.clientY,
          payloadType: pending.type, dropped: dropped
        });
        teardownCrossDragListeners();
        // Tell every other webview the drag is over so they tear
        // down their own trackers. Without this echo, the source
        // webview's hierarchy.js `activeDrag` state never clears
        // (its own pointerup never fired — events stayed local to
        // this destination). Echo also lets sibling receivers drop
        // their stale `__lexeraExternalDnd` indicators.
        try {
          invoke('multiview_broadcast', {
            event: 'cross-view-drag-handled',
            payload: { dropped: dropped, x: e.clientX, y: e.clientY, sourceKind: pending.source.kind }
          });
        } catch (_) { /* non-fatal */ }
      };
      document.addEventListener('pointermove', crossDragMoveHandler, true);
      document.addEventListener('pointerup', crossDragUpHandler, true);
      document.addEventListener('pointercancel', crossDragUpHandler, true);
      // Safety net: if no pointerup fires within 30s (window blur,
      // OS gesture-loss, etc.), clear the tracker so subsequent
      // drags start clean.
      crossDragSafetyTimer = setTimeout(function () {
        xviewLog('local-track.safety-timeout', {});
        teardownCrossDragListeners();
      }, 30000);
      xviewLog('local-track.armed', {
        sourceKind: src.kind, payloadType: type, label: wv.label
      });
    });
    wv.listen('cross-view-drag-handled', function (event) {
      // A sibling webview handled the drop; tear down our tracker.
      // The `dropped` flag is purely informational here — local
      // cleanup is the same either way.
      var p = (event && event.payload) || {};
      if (crossDragPayload) {
        xviewLog('local-track.handled-elsewhere', { dropped: !!p.dropped });
      }
      teardownCrossDragListeners();
    });

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

    wv.listen('dashboard-navigate', function (event) {
      var p = (event && event.payload) || {};
      if (p.nav) {
        var helpers = window.LexeraOrderHelpers;
        var reportFocus = function (focused) {
          invoke('multiview_broadcast', {
            event: 'dashboard-focus-applied',
            payload: {
              nav: p.nav,
              focused: !!focused,
              label: wv.label
            }
          }).catch(function () {});
        };
        if (helpers && typeof helpers.navigateHierarchyTargetInIframe === 'function') {
          helpers.navigateHierarchyTargetInIframe(p.nav).then(function (focused) {
            reportFocus(!!focused || applyDashboardFocusFallback(p.nav));
          }).catch(function () {
            dispatchAsMessage({ type: 'lexera-focus-hierarchy-target', target: p.nav });
            reportFocus(applyDashboardFocusFallback(p.nav));
          });
        } else {
          dispatchAsMessage({ type: 'lexera-focus-hierarchy-target', target: p.nav });
          reportFocus(applyDashboardFocusFallback(p.nav));
        }
      }
    });

    wv.listen('dashboard-board-test-request', function (event) {
      var p = (event && event.payload) || {};
      var result = { action: cleanText(p.action || 'state'), ok: true };
      if (result.action === 'first-visible-card') {
        result.card = findFirstBoardCardForTest();
        if (!result.card) result.ok = false;
      }
      invoke('multiview_broadcast', {
        event: 'dashboard-board-test-response',
        payload: {
          requestId: cleanText(p.requestId),
          result: result
        }
      }).catch(function () {});
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
