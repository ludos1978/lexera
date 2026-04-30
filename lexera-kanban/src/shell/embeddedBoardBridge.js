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
      events: ['dashboard-navigate', 'dashboard-board-test-request']
    }).catch(function () {});

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
