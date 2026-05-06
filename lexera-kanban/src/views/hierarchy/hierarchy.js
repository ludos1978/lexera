// Hierarchy sub-app — workspace navigation panel.
//
// The whole panel renders as a single TreeView (treeView.js) — same
// component the dashboard, files panel, and main board sidebar use, so
// every hierarchical surface in the app shares one visual treatment.
// Tree shape (boards are the top-level roots — the workspace name lives
// in the panel header, not inside the tree):
//
//   board (root, type='board')          ← lazy-loads its children on expand
//   └── row (type='row')
//       └── stack (type='stack')
//           └── column (type='column')
//               └── card (type='card')
//
// Per-board hierarchy (rows/stacks/columns/cards) is fetched once via
// `LexeraApi.getBoardHierarchy(id)` and cached for the panel lifetime.

(function () {
  'use strict';

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function resolveBoardLabel(board) {
    return window.LexeraTitleHelpers.resolveBoardLabel(board);
  }

  var statusEl = document.getElementById('status');
  var titleEl = document.getElementById('title');
  var viewModeEl = document.getElementById('view-mode');
  var localBoardsEl = document.getElementById('local-boards');
  var localCountEl = document.getElementById('local-count');

  var activeBoardId = null;
  var REMOTE_WORKSPACE_ID = '__remote_boards__';
  var REMOTE_WORKSPACE_NAME = 'Remote Boards';
  var selectedWorkspaceId = null;
  var latestCatalog = null;
  // Per-board fold state + hierarchy cache. `boardHierarchies[id]` is
  // one of: undefined | 'loading' | 'error' | KanbanRow[].
  var expandedBoardIds = {};
  var boardHierarchies = {};

  function resolveWorkspaceFromSnapshot(snap) {
    if (!snap || typeof snap !== 'object') return null;
    if (snap.viewWorkspace && snap.viewWorkspace.id) return snap.viewWorkspace;
    if (snap.activeWorkspace && snap.activeWorkspace.id) return snap.activeWorkspace;
    var preferredId = snap.viewWorkspaceId != null && snap.viewWorkspaceId !== ''
      ? String(snap.viewWorkspaceId)
      : String(snap.activeWorkspaceId || '');
    if (!preferredId) return null;
    if (preferredId === REMOTE_WORKSPACE_ID) {
      return { id: REMOTE_WORKSPACE_ID, name: REMOTE_WORKSPACE_NAME, isRemoteWorkspace: true };
    }
    var workspaces = Array.isArray(snap.workspaces) ? snap.workspaces : [];
    for (var i = 0; i < workspaces.length; i++) {
      if (workspaces[i] && workspaces[i].id === preferredId) return workspaces[i];
    }
    return null;
  }

  function getBoardWorkspaceIds(board) {
    if (!board || typeof board !== 'object') return [];
    if (Array.isArray(board.workspace_ids)) return board.workspace_ids.filter(Boolean);
    if (Array.isArray(board.workspaceIds)) return board.workspaceIds.filter(Boolean);
    if (board.workspace_id) return [board.workspace_id];
    if (board.workspaceId) return [board.workspaceId];
    return [];
  }

  // ── TreeView node builders ──────────────────────────────────────
  function nodeLabel(item) {
    var label = window.LexeraTitleHelpers.resolveBoardLabel(item);
    if (label === 'Untitled') label = item.title || item.name || '';
    return label || '(no title)';
  }
  // Phase 2a: row / stack / column / card nodes carry the canonical
  // TreeView drag grip — same SVG affordance the dashboard, files
  // panel, and main board sidebar use.
  // Phase 2b-1: also mark the `.tree-node` `draggable="true"` so the
  // browser fires native dragstart events. The drop wiring lands in
  // 2b-2; this slice only enables the source half.
  function dragAttrs(boardId, kind) {
    // Pointer-based drag: identify draggable rows by `data-drag-kind`
    // rather than the HTML5 `draggable` attribute (which doesn't fire
    // reliably in WKWebView for these element types).
    return {
      'data-drag-kind': kind,
      'data-drag-board-id': boardId
    };
  }
  function buildCardNode(card, ctx) {
    return { id: card.id || null, label: nodeLabel(card), type: 'card',
             children: null, expanded: false, hasToggle: false, grip: true,
             gripTitle: 'Drag card to reorder',
             attrs: dragAttrs(ctx.boardId, 'card') };
  }
  function buildColumnNode(column, ctx) {
    var cards = Array.isArray(column.cards) ? column.cards : [];
    return { id: column.id || null, label: nodeLabel(column), type: 'column',
             children: cards.map(function (c) { return buildCardNode(c, ctx); }),
             expanded: true, grip: true,
             gripTitle: 'Drag column to reorder',
             attrs: dragAttrs(ctx.boardId, 'column') };
  }
  function buildStackNode(stack, ctx) {
    var cols = Array.isArray(stack.columns) ? stack.columns : [];
    return { id: stack.id || null, label: nodeLabel(stack), type: 'stack',
             children: cols.map(function (c) { return buildColumnNode(c, ctx); }),
             expanded: true, grip: true,
             gripTitle: 'Drag stack to reorder',
             attrs: dragAttrs(ctx.boardId, 'stack') };
  }
  function buildRowNode(row, ctx) {
    var stacks = Array.isArray(row.stacks) ? row.stacks : [];
    return { id: row.id || null, label: nodeLabel(row), type: 'row',
             children: stacks.map(function (s) { return buildStackNode(s, ctx); }),
             expanded: true, grip: true,
             gripTitle: 'Drag row to reorder',
             attrs: dragAttrs(ctx.boardId, 'row') };
  }
  function buildPlaceholderNode(text) {
    return { id: null, label: text, type: 'placeholder',
             children: null, expanded: false, hasToggle: false, grip: false };
  }
  function buildBoardNode(board) {
    var boardId = board.id || '';
    var isExpanded = !!expandedBoardIds[boardId];
    var children = [];
    if (isExpanded) {
      var hierarchy = boardHierarchies[boardId];
      var ctx = { boardId: boardId };
      if (Array.isArray(hierarchy)) {
        children = hierarchy.length > 0
          ? hierarchy.map(function (r) { return buildRowNode(r, ctx); })
          : [buildPlaceholderNode('(empty board)')];
      } else if (hierarchy === 'error') {
        children = [buildPlaceholderNode('Failed to load board structure')];
      } else {
        children = [buildPlaceholderNode('Loading…')];
      }
    }
    return {
      id: 'board:' + boardId,
      label: nodeLabel(board),
      type: 'board',
      // Always show a toggle so the user knows the board is expandable
      // before the first lazy fetch fills children.
      hasToggle: true,
      expanded: isExpanded,
      grip: false,
      children: children,
      attrs: {
        'data-board-id': boardId,
        'data-tree-target': 'board'
      }
    };
  }

  function selectBoardsForWorkspace(boards, remoteBoards, workspaceId) {
    var normalized = String(workspaceId || '');
    if (!normalized) return [];
    if (normalized === REMOTE_WORKSPACE_ID) return remoteBoards || [];
    return (boards || []).filter(function (board) {
      return getBoardWorkspaceIds(board).indexOf(normalized) >= 0;
    });
  }

  function refreshActiveHighlight() {
    if (!localBoardsEl) return;
    var nodes = localBoardsEl.querySelectorAll('.tree-node[data-tree-target="board"]');
    for (var i = 0; i < nodes.length; i++) {
      var bid = nodes[i].getAttribute('data-board-id') || '';
      nodes[i].classList.toggle('is-active', bid === activeBoardId);
    }
  }

  function fetchBoardHierarchy(boardId) {
    var api = window.LexeraApi;
    if (!api || typeof api.getBoardHierarchy !== 'function') {
      boardHierarchies[boardId] = 'error';
      return;
    }
    boardHierarchies[boardId] = 'loading';
    api.getBoardHierarchy(boardId).then(function (data) {
      boardHierarchies[boardId] = (data && Array.isArray(data.rows)) ? data.rows : [];
      renderFromCatalog();
    }).catch(function () {
      boardHierarchies[boardId] = 'error';
      renderFromCatalog();
    });
  }
  function toggleBoardExpand(boardId) {
    var nowExpanded = !expandedBoardIds[boardId];
    expandedBoardIds[boardId] = nowExpanded;
    if (nowExpanded && boardHierarchies[boardId] == null) {
      fetchBoardHierarchy(boardId);
    }
    renderFromCatalog();
  }

  function renderFromCatalog() {
    var snap = latestCatalog || {};
    renderTree(snap.boards || [], snap.remoteBoards || [], selectedWorkspaceId);
    refreshActiveHighlight();
  }

  function renderTree(boards, remoteBoards, workspaceId) {
    if (!localBoardsEl) return;
    var workspaceBoards = selectBoardsForWorkspace(boards, remoteBoards, workspaceId);
    if (localCountEl) localCountEl.textContent = '(' + workspaceBoards.length + ')';
    localBoardsEl.innerHTML = '';
    if (!workspaceBoards.length) {
      var empty = document.createElement('div');
      empty.className = 'hierarchical-empty empty';
      empty.textContent = 'none';
      localBoardsEl.appendChild(empty);
      return;
    }
    if (window.TreeView && typeof window.TreeView.render === 'function') {
      window.TreeView.render(
        localBoardsEl,
        workspaceBoards.map(buildBoardNode),
        { escapeHtml: escapeHtml }
      );
    }
  }

  // Pointer-based drag/drop. HTML5 native `draggable` does not fire
  // reliably in WKWebView / WebView2 for these element types; every
  // other Lexera drag surface (sidebar tree in `dndListeners.js`,
  // workspace shell tabs in `tabDragController.js`) uses the same
  // mousedown → distance-threshold → mousemove → mouseup pattern,
  // so we mirror it here. Broadcast contract stays the same:
  // `hierarchy-entity-drag-start` once the threshold is crossed,
  // `hierarchy-entity-drop` on a valid mouseup target.
  if (localBoardsEl && !localBoardsEl.__hierarchyDragBound) {
    // Container relations:
    //   card → column, column → stack, stack → row, row → board
    var ABSORB_KINDS = { card: 'column', column: 'stack', stack: 'row', row: 'board' };
    var DRAG_THRESHOLD_PX = 5;
    var pendingDrag = null;
    var activeDrag = null;
    var activeDropTargetEl = null;

    var readSourceFromNode = function (el) {
      var src = el && el.closest ? el.closest('.tree-node[data-drag-kind]') : null;
      if (!src || !localBoardsEl.contains(src)) return null;
      return {
        boardId: src.getAttribute('data-drag-board-id') || '',
        kind: src.getAttribute('data-drag-kind') || '',
        entityId: src.getAttribute('data-tree-id') || ''
      };
    };
    var readDropTargetFromPoint = function (clientX, clientY, dragSource) {
      var hit = document.elementFromPoint(clientX, clientY);
      // Drag-kind nodes are canonical drop targets; board nodes (the
      // TreeView root for each kanban) are also valid targets, but
      // only for row → board absorbs.
      var tgt = hit && hit.closest
        ? hit.closest('.tree-node[data-drag-kind], .tree-node[data-tree-target="board"]')
        : null;
      if (!tgt || !localBoardsEl.contains(tgt)) return null;
      var info;
      if (tgt.getAttribute('data-drag-kind')) {
        info = {
          boardId: tgt.getAttribute('data-drag-board-id') || '',
          kind: tgt.getAttribute('data-drag-kind') || '',
          entityId: tgt.getAttribute('data-tree-id') || ''
        };
      } else if (tgt.getAttribute('data-tree-target') === 'board') {
        var bid = tgt.getAttribute('data-board-id') || '';
        info = { boardId: bid, kind: 'board', entityId: bid };
      } else {
        return null;
      }
      if (!dragSource) return null;
      if (info.entityId === dragSource.entityId) return null;
      var sameKind = info.kind === dragSource.kind;
      if (!sameKind) {
        var absorbInto = ABSORB_KINDS[dragSource.kind];
        if (absorbInto !== info.kind) return null;
        // Stacks land "in an empty row"; columns "added to an empty
        // stack". When the target already has same-source-kind
        // children visible, force a sibling drop instead so the user
        // gets zone-aware control. Card → column and row → board
        // absorbs stay permissive (user explicitly allowed them).
        if ((dragSource.kind === 'stack' && info.kind === 'row') ||
            (dragSource.kind === 'column' && info.kind === 'stack')) {
          var entry = tgt.parentElement;
          var children = entry ? entry.querySelector('.tree-children') : null;
          var anyChild = children
            ? children.querySelector('.tree-node[data-drag-kind="' + dragSource.kind + '"]')
            : null;
          if (anyChild) return null;
        }
      }
      if (sameKind) {
        var rect = tgt.getBoundingClientRect();
        info.position = (rect.height > 0 && clientY >= rect.top + rect.height / 2)
          ? 'after' : 'before';
      }
      return { node: tgt, info: info };
    };
    var clearDropTargetEl = function () {
      if (activeDropTargetEl) {
        activeDropTargetEl.classList.remove('is-drop-target');
        activeDropTargetEl = null;
      }
    };
    var endDrag = function () {
      clearDropTargetEl();
      pendingDrag = null;
      activeDrag = null;
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('mouseup', onUp, true);
    };
    var getOwnWebviewLabel = function () {
      try {
        var wv = window.LexeraSubApp && typeof window.LexeraSubApp.getCurrentWebview === 'function'
          ? window.LexeraSubApp.getCurrentWebview() : null;
        return (wv && wv.label) || '';
      } catch (_) { return ''; }
    };
    // Same `[xview-dnd]` instrumentation as workspaces.js. First-fire
    // flag logs once per drag so the in-app Log panel shows that the
    // source IS broadcasting AND the resolved sourceLabel is non-empty.
    // Drag-move fires ~60Hz; we log only the first call per drag.
    var _xviewSourceLogged = false;
    var broadcastCrossViewMove = function (clientX, clientY) {
      if (!window.LexeraSubApp || typeof window.LexeraSubApp.broadcast !== 'function') return;
      var label = getOwnWebviewLabel();
      if (!_xviewSourceLogged && typeof window.lexeraLog === 'function') {
        try {
          window.lexeraLog('debug', '[xview-dnd] source.broadcast { view: "hierarchy", sourceLabel: "' +
            String(label) + '", hasLabel: ' + (!!label) + ' }');
        } catch (_) {}
        _xviewSourceLogged = true;
      }
      var promise = window.LexeraSubApp.broadcast('hierarchy-entity-drag-move', {
        source: activeDrag.source,
        sourceWebviewLabel: label,
        sourceClientX: clientX,
        sourceClientY: clientY
      });
      if (promise && typeof promise.catch === 'function') {
        promise.catch(function (err) {
          if (typeof window.lexeraLog === 'function') {
            try {
              window.lexeraLog('warn', '[xview-dnd] source.broadcast.failed view=hierarchy err=' +
                ((err && err.message) ? err.message : String(err)));
            } catch (_) {}
          }
        });
      }
    };

    var onMove = function (e) {
      if (!pendingDrag) return;
      if (!activeDrag) {
        var dx = e.clientX - pendingDrag.startX;
        var dy = e.clientY - pendingDrag.startY;
        if (dx * dx + dy * dy < DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) return;
        activeDrag = { source: pendingDrag.source };
        if (window.LexeraSubApp && typeof window.LexeraSubApp.broadcast === 'function') {
          window.LexeraSubApp.broadcast('hierarchy-entity-drag-start', activeDrag.source);
        }
      }
      var match = readDropTargetFromPoint(e.clientX, e.clientY, activeDrag.source);
      if (activeDropTargetEl !== (match && match.node)) {
        clearDropTargetEl();
        if (match) {
          match.node.classList.add('is-drop-target');
          activeDropTargetEl = match.node;
        }
      }
      // No local target → cursor may be over another webview. Forward
      // the cursor position so the shell can route to that webview's
      // `__lexeraExternalDnd.hover`.
      if (!match) broadcastCrossViewMove(e.clientX, e.clientY);
    };
    var onUp = function (e) {
      if (!activeDrag) {
        // Below threshold — let the click handler take care of the
        // navigate / toggle path.
        endDrag();
        return;
      }
      var match = readDropTargetFromPoint(e.clientX, e.clientY, activeDrag.source);
      var src = activeDrag.source;
      var clientX = e.clientX, clientY = e.clientY;
      clearDropTargetEl();
      var hadLocalDrop = !!match;
      var dropPayload = match ? { source: src, target: match.info } : null;
      pendingDrag = null;
      activeDrag = null;
      _xviewSourceLogged = false; // reset for next drag session
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('mouseup', onUp, true);
      if (window.LexeraSubApp && typeof window.LexeraSubApp.broadcast === 'function') {
        if (hadLocalDrop) {
          // Local within-panel reorder/absorb. Logged so the user can
          // verify in the Log panel that the drop fired.
          if (typeof window.lexeraLog === 'function') {
            try {
              window.lexeraLog('debug', '[xview-dnd] source.local-drop { view: "hierarchy", srcKind: "' +
                (src && src.kind || '') + '", tgtKind: "' + (match && match.info && match.info.kind || '') +
                '", srcBoard: "' + (src && src.boardId || '') +
                '", tgtBoard: "' + (match && match.info && match.info.boardId || '') + '" }');
            } catch (_) {}
          }
          var localPromise = window.LexeraSubApp.broadcast('hierarchy-entity-drop', dropPayload);
          if (localPromise && typeof localPromise.catch === 'function') {
            localPromise.catch(function (err) {
              if (typeof window.lexeraLog === 'function') {
                try {
                  window.lexeraLog('warn', '[xview-dnd] source.local-drop.failed view=hierarchy err=' +
                    ((err && err.message) ? err.message : String(err)));
                } catch (_) {}
              }
            });
          }
        } else {
          // Cursor was outside this webview — let the shell-side
          // router try to dispatch this as `external-dnd-drop` to
          // whichever webview the cursor was over.
          var endLabel = getOwnWebviewLabel();
          if (typeof window.lexeraLog === 'function') {
            try {
              window.lexeraLog('debug', '[xview-dnd] source.drag-end-external { view: "hierarchy", sourceLabel: "' +
                String(endLabel) + '", x: ' + clientX + ', y: ' + clientY + ' }');
            } catch (_) {}
          }
          var endPromise = window.LexeraSubApp.broadcast('hierarchy-entity-drag-end-external', {
            source: src,
            sourceWebviewLabel: endLabel,
            sourceClientX: clientX,
            sourceClientY: clientY
          });
          if (endPromise && typeof endPromise.catch === 'function') {
            endPromise.catch(function (err) {
              if (typeof window.lexeraLog === 'function') {
                try {
                  window.lexeraLog('warn', '[xview-dnd] source.drag-end-external.failed view=hierarchy err=' +
                    ((err && err.message) ? err.message : String(err)));
                } catch (_) {}
              }
            });
          }
        }
      }
    };
    localBoardsEl.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      // Clicks on the toggle stay click-driven so fold/unfold isn't
      // hijacked by a tiny drag.
      if (e.target && e.target.closest && e.target.closest('.tree-toggle')) return;
      var source = readSourceFromNode(e.target);
      if (!source) return;
      pendingDrag = { startX: e.clientX, startY: e.clientY, source: source };
      activeDrag = null;
      document.addEventListener('mousemove', onMove, true);
      document.addEventListener('mouseup', onUp, true);
    });
    window.addEventListener('blur', endDrag);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) endDrag();
    });
    localBoardsEl.__hierarchyDragBound = true;
  }

  // Right-click on a tree-node is intentionally not assigned here —
  // suppress the browser's default context menu so it doesn't pop up
  // over the tree.
  if (localBoardsEl && !localBoardsEl.__hierarchyContextMenuBound) {
    localBoardsEl.addEventListener('contextmenu', function (e) {
      if (e.target && e.target.closest && e.target.closest('.tree-node[data-drag-kind]')) {
        e.preventDefault();
      }
    });
    localBoardsEl.__hierarchyContextMenuBound = true;
  }

  // Double-click on a row / stack / column / card label opens an
  // inline editor. Enter / blur commits + broadcasts
  // `hierarchy-entity-rename`; Escape cancels. Boards (TreeView roots
  // without `data-drag-kind`) stay non-editable here — renaming a
  // board file is a heavier operation that belongs in the in-board
  // surface.
  function startInlineRename(nodeEl) {
    if (!nodeEl) return;
    if (nodeEl.querySelector('.tree-rename-input')) return;
    var labelEl = nodeEl.querySelector('.tree-label');
    if (!labelEl) return;
    var source = {
      boardId: nodeEl.getAttribute('data-drag-board-id') || '',
      kind: nodeEl.getAttribute('data-drag-kind') || '',
      entityId: nodeEl.getAttribute('data-tree-id') || ''
    };
    if (!source.boardId || !source.kind || !source.entityId) return;
    var originalText = labelEl.textContent || '';
    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'tree-rename-input';
    input.value = originalText;
    labelEl.style.display = 'none';
    labelEl.parentNode.insertBefore(input, labelEl.nextSibling);
    input.focus();
    input.select();
    var done = false;
    function finish(commit) {
      if (done) return;
      done = true;
      var next = String(input.value || '').trim();
      if (input.parentNode) input.parentNode.removeChild(input);
      labelEl.style.display = '';
      if (commit && next && next !== originalText) {
        if (window.LexeraSubApp && typeof window.LexeraSubApp.broadcast === 'function') {
          window.LexeraSubApp.broadcast('hierarchy-entity-rename', {
            source: source, newTitle: next
          });
        }
      }
    }
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    input.addEventListener('blur', function () { finish(true); });
  }
  if (localBoardsEl && !localBoardsEl.__hierarchyDblClickBound) {
    localBoardsEl.addEventListener('dblclick', function (e) {
      var node = e.target && e.target.closest
        ? e.target.closest('.tree-node[data-drag-kind]')
        : null;
      if (!node) return;
      if (e.target.closest('.tree-toggle')) return;
      if (e.target.closest('.tree-grip')) return;
      e.preventDefault();
      startInlineRename(node);
    });
    localBoardsEl.__hierarchyDblClickBound = true;
  }

  // Single delegated click listener — keeps wiring simple even though
  // the tree is rebuilt on every state change.
  if (localBoardsEl && !localBoardsEl.__hierarchyClickBound) {
    localBoardsEl.addEventListener('click', function (e) {
      var toggle = e.target.closest && e.target.closest('.tree-toggle');
      var node = e.target.closest && e.target.closest('.tree-node');
      if (!node || !localBoardsEl.contains(node)) return;
      var target = node.getAttribute('data-tree-target') || '';
      if (toggle) {
        // Toggle path — never navigates open the board.
        if (target === 'board') {
          // Boards lazy-fetch their hierarchy on first expand and the
          // tree is rebuilt from scratch on every state change, so we
          // route through `toggleBoardExpand` (which mutates state)
          // rather than `TreeView.toggleNode` (which only flips DOM).
          var bid = node.getAttribute('data-board-id') || '';
          if (bid) toggleBoardExpand(bid);
          return;
        }
        // Rows / stacks / columns / cards already have their full
        // children rendered when the board is expanded — toggle them
        // purely in the DOM via TreeView's helper, same as the
        // dashboard / files panel / main board sidebar.
        if (window.TreeView && typeof window.TreeView.toggleNode === 'function') {
          window.TreeView.toggleNode(node);
        }
        return;
      }
      // Whole-row click on a board → navigate-open.
      if (target === 'board') {
        var rowBid = node.getAttribute('data-board-id') || '';
        if (rowBid) LexeraSubApp.navigate({ type: 'open-board', boardId: rowBid });
      }
    });
    localBoardsEl.__hierarchyClickBound = true;
  }

  // After a drag-drop reorder, the shell-side bridge persists the new
  // board state and broadcasts `hierarchy-board-changed` so sub-apps
  // can drop their cached hierarchy. Without this, the user would see
  // no visible reorder because we'd re-render from stale rows.
  function invalidateBoardHierarchy(boardId) {
    if (!boardId) return;
    delete boardHierarchies[boardId];
    if (expandedBoardIds[boardId]) {
      // Re-fetch immediately so the user sees the updated structure
      // without having to collapse and re-expand the board.
      fetchBoardHierarchy(boardId);
    } else {
      renderFromCatalog();
    }
  }

  LexeraSubApp.init({
    onCustom: {
      'hierarchy-board-changed': function (payload) {
        invalidateBoardHierarchy((payload && payload.boardId) || '');
      }
    },
    onCatalog: function (snap) {
      latestCatalog = snap || null;
      var ws = resolveWorkspaceFromSnapshot(snap);
      if (ws && ws.name) {
        titleEl.textContent = ws.name;
        selectedWorkspaceId = ws.id || null;
      } else {
        titleEl.textContent = 'Workspace';
        selectedWorkspaceId = null;
      }
      viewModeEl.textContent = snap && snap.workspaceViewMode === 'manual' ? 'manual view' : 'follow active board';
      renderFromCatalog();
      // Status pill removed from the panel chrome — keep the assignment
      // null-safe so onCatalog still runs cleanly, and the test API can
      // still surface the most-recent label when a fixture mounts one.
      if (statusEl) statusEl.textContent = 'connected';
    },
    onActiveBoard: function (boardId) {
      activeBoardId = boardId;
      refreshActiveHighlight();
    },
    onError: function (err) {
      if (statusEl) statusEl.textContent = String(err);
    }
  });

  // ── Test API ──────────────────────────────────────────────────────
  // User-interaction surface for vitest + autoRun integration tests.
  // Drives the SAME DOM events a real user would.
  function dispatchClick(node) {
    if (!node) return false;
    var ev = typeof MouseEvent === 'function'
      ? new MouseEvent('click', { bubbles: true, cancelable: true })
      : document.createEvent('MouseEvent');
    if (ev.initMouseEvent) {
      ev.initMouseEvent('click', true, true, window, 1, 0, 0, 0, 0, false, false, false, false, 0, null);
    }
    node.dispatchEvent(ev);
    return true;
  }
  function findBoardNode(boardId) {
    if (!localBoardsEl) return null;
    var sel = '.tree-node[data-tree-target="board"][data-board-id="' + String(boardId || '').replace(/"/g, '\\"') + '"]';
    return localBoardsEl.querySelector(sel);
  }
  function collectBoardItems() {
    if (!localBoardsEl) return [];
    var nodes = localBoardsEl.querySelectorAll('.tree-node[data-tree-target="board"]');
    var out = [];
    for (var i = 0; i < nodes.length; i++) {
      var labelEl = nodes[i].querySelector('.tree-label');
      out.push({
        id: nodes[i].getAttribute('data-board-id') || '',
        label: labelEl ? labelEl.textContent : '',
        active: nodes[i].classList.contains('is-active'),
        expanded: nodes[i].getAttribute('aria-expanded') === 'true'
      });
    }
    return out;
  }
  window.LexeraHierarchyTestApi = {
    collectState: function () {
      // Boards are the top-level tree roots — no workspace node anymore.
      // The header (#title) shows the workspace name; tests can read
      // `state.title` for that. `groups` is a single synthetic group
      // wrapping the current workspace's boards so existing test calls
      // continue to work.
      var boards = collectBoardItems();
      var groups = selectedWorkspaceId
        ? [{
            id: selectedWorkspaceId,
            name: titleEl ? titleEl.textContent : '',
            expanded: true,
            active: true,
            boards: boards
          }]
        : [];
      return {
        status: statusEl ? statusEl.textContent : '',
        title: titleEl ? titleEl.textContent : '',
        viewMode: viewModeEl ? viewModeEl.textContent : '',
        activeBoardId: activeBoardId,
        selectedWorkspaceId: selectedWorkspaceId,
        groups: groups,
        remote: [],
        workspaces: []
      };
    },
    clickBoard: function (boardId, scope) {
      void scope;
      // Click the board's tree-label — same DOM path a real click takes.
      var node = findBoardNode(boardId);
      if (!node) return false;
      var label = node.querySelector('.tree-label') || node;
      return dispatchClick(label);
    },
    clickWorkspace: function (workspaceId) {
      void workspaceId;
      return false;
    },
    clickWorkspaceGroupHeader: function (groupId) {
      // The workspace lives in the panel header, not inside the tree —
      // there's nothing to toggle here. Kept on the API surface so
      // callers don't need a feature check.
      void groupId;
      return false;
    }
  };
})();
