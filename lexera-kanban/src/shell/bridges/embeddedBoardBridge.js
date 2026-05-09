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
    // The external-dnd-drop arrives via the shell's
    // forwardCrossViewDrag chain (source pointerup outside source
    // bounds → shell looks up cursor's webview → emits
    // external-dnd-drop here). Pointer capture on the source means
    // the destination's OWN pointerup never fires for cross-WKWebView
    // drops, so this listener — NOT the per-webview pointerup
    // tracker installed below — is the path that lands the user's
    // release. relayExternalDnd's legacy __lexeraExternalDnd.drop is
    // a kanban-internal mutator that doesn't persist cross-board, so
    // we ALSO build a tree-target from the destination's DOM and
    // broadcast hierarchy-entity-drop for the shell-side
    // hierarchyDragBridge.applyDrop persistence chain. The legacy
    // local apply is kept (relayExternalDnd) so the in-kanban hover
    // visual stays consistent for the brief moment between drop and
    // re-render — saveBoard's broadcast will overwrite it shortly.
    wv.listen('external-dnd-drop', function (event) {
      var p = (event && event.payload) || {};
      var inner = p.payload || null;
      var src = inner && inner.source;
      if (src && typeof p.x === 'number' && typeof p.y === 'number') {
        var target = resolveCrossViewTreeTarget(p.x, p.y, src);
        xviewLog('receive.drop.tree-target', {
          x: p.x, y: p.y,
          srcKind: src.kind,
          targetKind: target && target.kind,
          targetEntityId: target && target.entityId,
          targetPosition: target && target.position,
          resolved: !!target
        });
        if (target) {
          try {
            invoke('multiview_broadcast', {
              event: 'hierarchy-entity-drop',
              payload: { source: src, target: target }
            });
          } catch (_) { /* non-fatal */ }
        }
      }
      relayExternalDnd('drop', event);
    });

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
    // Resolve the destination kanban's active board id. The shell's
    // applyDrop needs `{ boardId, kind, entityId }` on the target so
    // it can load the right board and route through the four
    // helpers. Tries `LexeraDashboard.getActiveBoardId()` first
    // (exposed by app.js), then falls back to the embedded-board URL
    // param `?board=` so the helper still works when the dashboard
    // global hasn't finished initialising. Last resort: the body's
    // `data-active-board-id` attribute if any future tooling sets it.
    function getDestinationActiveBoardId() {
      try {
        var dash = window.LexeraDashboard;
        if (dash && typeof dash.getActiveBoardId === 'function') {
          var id = dash.getActiveBoardId();
          if (id) return String(id);
        }
      } catch (_) { /* non-fatal */ }
      try {
        var p = new URLSearchParams(window.location.search || '');
        var fromUrl = p.get('board');
        if (fromUrl) return String(fromUrl);
      } catch (_) { /* non-fatal */ }
      try {
        if (document.body && document.body.dataset && document.body.dataset.activeBoardId) {
          return String(document.body.dataset.activeBoardId);
        }
      } catch (_) { /* non-fatal */ }
      return null;
    }
    // ABSORB_PARENT mirrors the source-side ABSORB_KINDS table in
    // hierarchy.js / workspaces.js so the destination's hit-test
    // accepts the same kind pairs the source allows.
    var ABSORB_PARENT = { card: 'column', column: 'stack', stack: 'row', row: 'board' };
    // Source-aware DOM hit-test → tree-shaped drop target. Same-kind
    // hit yields sibling reorder (with `position`); a hit on the
    // ABSORB_PARENT[sourceKind] yields cross-kind absorb (no
    // `position` — append-as-last). Other kinds in the cursor's
    // ancestor chain are ignored so a row-drag never accidentally
    // resolves to a card target the absorb table can't apply.
    function resolveCrossViewTreeTarget(x, y, source) {
      if (!document.elementFromPoint) return null;
      var hit = document.elementFromPoint(x, y);
      if (!hit || typeof hit.closest !== 'function') return null;
      var boardId = getDestinationActiveBoardId();
      if (!boardId) return null;
      var sourceKind = source && source.kind;
      if (!sourceKind) return null;
      var absorbKind = ABSORB_PARENT[sourceKind] || null;

      // 1) Card source: prefer card-sibling reorder. If the cursor
      // landed on a specific card, use it. Otherwise look for the
      // enclosing column-cards container and pick the nearest card
      // by vertical centre — keeps the drop slot in agreement with
      // the kanban's own hover preview, which highlights an insert
      // line at the same position. If the column has no cards (or
      // the cursor missed all of them), fall through to absorb.
      if (sourceKind === 'card') {
        var card = hit.closest('.card[data-card-id]');
        if (card) {
          var cid = String(card.getAttribute('data-card-id') || '').trim();
          if (cid) {
            var crect = card.getBoundingClientRect();
            var cposition = (crect.height > 0 && y >= crect.top + crect.height / 2)
              ? 'after' : 'before';
            return { boardId: boardId, kind: 'card', entityId: cid, position: cposition };
          }
        }
        var cardsContainer = hit.closest('.column-cards');
        if (cardsContainer) {
          var siblingCards = cardsContainer.querySelectorAll(':scope > .card[data-card-id]');
          if (siblingCards.length > 0) {
            var nearest = null;
            var nearestDist = Infinity;
            for (var i = 0; i < siblingCards.length; i++) {
              var srect = siblingCards[i].getBoundingClientRect();
              var center = srect.top + srect.height / 2;
              var d = Math.abs(y - center);
              if (d < nearestDist) { nearestDist = d; nearest = siblingCards[i]; }
            }
            if (nearest) {
              var nrect = nearest.getBoundingClientRect();
              var npos = (nrect.height > 0 && y >= nrect.top + nrect.height / 2)
                ? 'after' : 'before';
              var nid = String(nearest.getAttribute('data-card-id') || '').trim();
              if (nid) return { boardId: boardId, kind: 'card', entityId: nid, position: npos };
            }
          }
          // Empty column — absorb on parent column.
          var emptyCol = cardsContainer.closest('.column[data-column-id]');
          if (emptyCol) {
            var ecid = String(emptyCol.getAttribute('data-column-id') || '').trim();
            if (ecid) return { boardId: boardId, kind: 'column', entityId: ecid };
          }
        }
      }

      // 2) Column source: prefer column-sibling reorder.
      if (sourceKind === 'column') {
        var col = hit.closest('.column[data-column-id]');
        if (col) {
          var colId = String(col.getAttribute('data-column-id') || '').trim();
          if (colId) {
            var colRect = col.getBoundingClientRect();
            // Columns are typically arranged horizontally inside a
            // stack — pick before/after on the X axis.
            var horizontalSplit = (colRect.width > 0 && x >= colRect.left + colRect.width / 2)
              ? 'after' : 'before';
            return { boardId: boardId, kind: 'column', entityId: colId, position: horizontalSplit };
          }
        }
      }

      // 3) Stack source: prefer stack-sibling reorder.
      if (sourceKind === 'stack') {
        var st = hit.closest('.board-stack[data-stack-id]');
        if (st) {
          var stId = String(st.getAttribute('data-stack-id') || '').trim();
          if (stId) {
            var stRect = st.getBoundingClientRect();
            // Stacks within a row are typically horizontal too.
            var stPos = (stRect.width > 0 && x >= stRect.left + stRect.width / 2)
              ? 'after' : 'before';
            return { boardId: boardId, kind: 'stack', entityId: stId, position: stPos };
          }
        }
      }

      // 4) Row source: prefer row-sibling reorder.
      if (sourceKind === 'row') {
        var rw = hit.closest('.board-row[data-row-id]');
        if (rw) {
          var rwId = String(rw.getAttribute('data-row-id') || '').trim();
          if (rwId) {
            var rwRect = rw.getBoundingClientRect();
            // Rows are stacked vertically in a board.
            var rwPos = (rwRect.height > 0 && y >= rwRect.top + rwRect.height / 2)
              ? 'after' : 'before';
            return { boardId: boardId, kind: 'row', entityId: rwId, position: rwPos };
          }
        }
      }

      // 5) Cross-kind absorb fallback. The cursor wasn't over a
      // valid same-kind sibling — try the source's ABSORB_PARENT
      // kind. This is what gives the user "drop on a parent →
      // append as last item".
      if (absorbKind === 'column') {
        var absorbCol = hit.closest('.column[data-column-id]');
        if (absorbCol) {
          var acId = String(absorbCol.getAttribute('data-column-id') || '').trim();
          if (acId) return { boardId: boardId, kind: 'column', entityId: acId };
        }
      } else if (absorbKind === 'stack') {
        var absorbStack = hit.closest('.board-stack[data-stack-id]');
        if (absorbStack) {
          var asId = String(absorbStack.getAttribute('data-stack-id') || '').trim();
          if (asId) return { boardId: boardId, kind: 'stack', entityId: asId };
        }
      } else if (absorbKind === 'row') {
        var absorbRow = hit.closest('.board-row[data-row-id]');
        if (absorbRow) {
          var arId = String(absorbRow.getAttribute('data-row-id') || '').trim();
          if (arId) return { boardId: boardId, kind: 'row', entityId: arId };
        }
      } else if (absorbKind === 'board') {
        // Row → board absorb: target = the destination board itself.
        return { boardId: boardId, kind: 'board', entityId: boardId };
      }

      return null;
    }
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
        // Resolve a tree-shaped target from the local DOM hit-test.
        // The kanban's own `__lexeraExternalDnd.drop` is intentionally
        // NOT called here — it mutates THIS webview's local board
        // data, which is wrong for cross-board moves (the source
        // entity still lives in source.boardId; only the shell can
        // load both boards + apply the move atomically). Instead we
        // build a `{ boardId, kind, entityId, position? }` target and
        // broadcast `hierarchy-entity-drop` so the shell-side
        // `hierarchyDragBridge.applyDrop` does the right thing for
        // both same-board and cross-board cases.
        var target = resolveCrossViewTreeTarget(e.clientX, e.clientY, pending.source);
        var dropped = !!target;
        xviewLog('local-track.pointerup', {
          x: e.clientX, y: e.clientY,
          payloadType: pending.type,
          targetKind: target && target.kind,
          targetEntityId: target && target.entityId,
          targetPosition: target && target.position,
          dropped: dropped
        });
        teardownCrossDragListeners();
        if (target) {
          // Persist via the shell. hierarchyDragBridge listens for
          // `hierarchy-entity-drop` and routes through applyDrop's
          // four-helper dispatch (same/cross-board × same/cross-kind).
          try {
            invoke('multiview_broadcast', {
              event: 'hierarchy-entity-drop',
              payload: { source: pending.source, target: target }
            });
          } catch (_) { /* non-fatal */ }
        }
        // Tell every other webview the drag is over so they tear
        // down their own trackers AND the source webview's
        // hierarchy.js / workspaces.js resets its activeDrag state
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
