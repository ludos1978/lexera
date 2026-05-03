// Workspaces sub-app — uses LexeraSubApp shared runtime.
//
// Shows the current workspace and its boards as a single TreeView
// (treeView.js) — same component the dashboard, files panel, and
// main board sidebar use. Boards are the top-level tree roots; each
// board lazily fetches its own row/stack/column/card hierarchy on
// expand. The synthetic Remote Boards workspace flows through the
// same path with `remoteBoards` as the source list.

(function () {
  'use strict';

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function resolveBoardLabel(b) {
    return window.LexeraTitleHelpers.resolveBoardLabel(b);
  }

  var statusEl = document.getElementById('status');
  var localBoardsEl = document.getElementById('local-boards');
  var currentWorkspaceEl = document.getElementById('current-workspace');
  var localCountEl = document.getElementById('local-count');

  var activeBoardId = null;
  var currentWorkspace = null;
  var REMOTE_WORKSPACE_ID = '__remote_boards__';
  var REMOTE_WORKSPACE_NAME = 'Remote Boards';

  // Per-board fold state + hierarchy cache. `boardHierarchies[id]` is
  // one of: undefined | 'loading' | 'error' | KanbanRow[].
  var expandedBoardIds = {};
  var boardHierarchies = {};
  var latestBoardsRendered = [];

  function refreshActiveHighlight() {
    if (!localBoardsEl) return;
    var nodes = localBoardsEl.querySelectorAll('.tree-node[data-tree-target="board"]');
    for (var i = 0; i < nodes.length; i++) {
      var bid = nodes[i].getAttribute('data-board-id') || '';
      nodes[i].classList.toggle('is-active', bid === activeBoardId);
    }
  }

  // ── TreeView node builders ──────────────────────────────────────
  function nodeLabel(item) {
    var label = window.LexeraTitleHelpers.resolveBoardLabel(item);
    if (label === 'Untitled') label = item.title || item.name || '';
    return label || '(no title)';
  }
  // Phase 2a: drag grip + Phase 2b-1: native `draggable="true"` on
  // every entity inside an expanded board so the browser fires
  // dragstart events. Drop wiring is Phase 2b-2.
  function dragAttrs(boardId, kind) {
    return {
      draggable: 'true',
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
      label: resolveBoardLabel(board),
      type: 'board',
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

  function fetchBoardHierarchy(boardId) {
    var api = window.LexeraApi;
    if (!api || typeof api.getBoardHierarchy !== 'function') {
      boardHierarchies[boardId] = 'error';
      return;
    }
    boardHierarchies[boardId] = 'loading';
    api.getBoardHierarchy(boardId).then(function (data) {
      boardHierarchies[boardId] = (data && Array.isArray(data.rows)) ? data.rows : [];
      rerenderLocalBoards();
    }).catch(function () {
      boardHierarchies[boardId] = 'error';
      rerenderLocalBoards();
    });
  }
  function toggleBoardExpand(boardId) {
    var nowExpanded = !expandedBoardIds[boardId];
    expandedBoardIds[boardId] = nowExpanded;
    if (nowExpanded && boardHierarchies[boardId] == null) {
      fetchBoardHierarchy(boardId);
    }
    rerenderLocalBoards();
  }

  function rerenderLocalBoards() {
    renderBoards(localBoardsEl, latestBoardsRendered, localCountEl);
    refreshActiveHighlight();
  }

  function renderBoards(target, boards, counterEl) {
    latestBoardsRendered = boards;
    counterEl.textContent = '(' + boards.length + ')';
    target.innerHTML = '';
    if (!boards.length) {
      var empty = document.createElement('div');
      empty.className = 'hierarchical-empty empty';
      empty.textContent = 'none';
      target.appendChild(empty);
      return;
    }
    if (window.TreeView && typeof window.TreeView.render === 'function') {
      window.TreeView.render(target, boards.map(buildBoardNode), { escapeHtml: escapeHtml });
    }
  }

  // Phase 2b drag-and-drop wiring — see hierarchy.js for the full
  // commentary; keeping the two surfaces in sync.
  if (localBoardsEl && !localBoardsEl.__workspacesDragBound) {
    var readSource = function (el) {
      var src = el && el.closest ? el.closest('.tree-node[draggable="true"]') : null;
      if (!src || !localBoardsEl.contains(src)) return null;
      return {
        boardId: src.getAttribute('data-drag-board-id') || '',
        kind: src.getAttribute('data-drag-kind') || '',
        entityId: src.getAttribute('data-tree-id') || ''
      };
    };
    var readDropTarget = function (el, dragSource) {
      var tgt = el && el.closest ? el.closest('.tree-node[draggable="true"]') : null;
      if (!tgt || !localBoardsEl.contains(tgt)) return null;
      var info = {
        boardId: tgt.getAttribute('data-drag-board-id') || '',
        kind: tgt.getAttribute('data-drag-kind') || '',
        entityId: tgt.getAttribute('data-tree-id') || ''
      };
      if (!dragSource) return null;
      if (info.boardId !== dragSource.boardId) return null;
      if (info.kind !== dragSource.kind) return null;
      if (info.entityId === dragSource.entityId) return null;
      return { node: tgt, info: info };
    };
    var activeDragSource = null;
    var activeDropTargetEl = null;
    var clearDropTargetEl = function () {
      if (activeDropTargetEl) {
        activeDropTargetEl.classList.remove('is-drop-target');
        activeDropTargetEl = null;
      }
    };
    localBoardsEl.addEventListener('dragstart', function (e) {
      var payload = readSource(e.target);
      if (!payload) return;
      activeDragSource = payload;
      if (e.dataTransfer && typeof e.dataTransfer.setData === 'function') {
        try {
          e.dataTransfer.setData('application/x-lexera-entity', JSON.stringify(payload));
          e.dataTransfer.effectAllowed = 'move';
        } catch (_) { /* JSDOM may reject unknown MIME — non-fatal */ }
      }
      if (window.LexeraSubApp && typeof window.LexeraSubApp.broadcast === 'function') {
        window.LexeraSubApp.broadcast('hierarchy-entity-drag-start', payload);
      }
    });
    localBoardsEl.addEventListener('dragover', function (e) {
      var match = readDropTarget(e.target, activeDragSource);
      if (!match) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      if (activeDropTargetEl !== match.node) {
        clearDropTargetEl();
        match.node.classList.add('is-drop-target');
        activeDropTargetEl = match.node;
      }
    });
    localBoardsEl.addEventListener('dragleave', function (e) {
      if (e.target === activeDropTargetEl) clearDropTargetEl();
    });
    localBoardsEl.addEventListener('drop', function (e) {
      var match = readDropTarget(e.target, activeDragSource);
      clearDropTargetEl();
      if (!match) {
        activeDragSource = null;
        return;
      }
      e.preventDefault();
      if (window.LexeraSubApp && typeof window.LexeraSubApp.broadcast === 'function') {
        window.LexeraSubApp.broadcast('hierarchy-entity-drop', {
          source: activeDragSource,
          target: match.info
        });
      }
      activeDragSource = null;
    });
    localBoardsEl.addEventListener('dragend', function () {
      clearDropTargetEl();
      activeDragSource = null;
    });
    localBoardsEl.__workspacesDragBound = true;
  }

  // Single delegated click listener — keeps wiring simple.
  if (localBoardsEl && !localBoardsEl.__workspacesClickBound) {
    localBoardsEl.addEventListener('click', function (e) {
      var toggle = e.target.closest && e.target.closest('.tree-toggle');
      var node = e.target.closest && e.target.closest('.tree-node');
      if (!node || !localBoardsEl.contains(node)) return;
      var target = node.getAttribute('data-tree-target') || '';
      if (toggle) {
        if (target === 'board') {
          // Boards lazy-fetch their hierarchy and rebuild the tree —
          // route through state-mutating toggle rather than the
          // DOM-only TreeView helper.
          var bid = node.getAttribute('data-board-id') || '';
          if (bid) toggleBoardExpand(bid);
          return;
        }
        // Rows / stacks / columns already have children in the DOM —
        // toggle in place via TreeView's helper, same pattern the
        // dashboard / files panel / main board sidebar use.
        if (window.TreeView && typeof window.TreeView.toggleNode === 'function') {
          window.TreeView.toggleNode(node);
        }
        return;
      }
      // Whole-row click on a board → navigate-open. Other types are
      // not navigable (no per-card open yet).
      if (target === 'board') {
        var rowBid = node.getAttribute('data-board-id') || '';
        if (rowBid) LexeraSubApp.navigate({ type: 'open-board', boardId: rowBid });
      }
    });
    localBoardsEl.__workspacesClickBound = true;
  }

  function findCurrentWorkspace(snap) {
    if (snap && snap.activeWorkspace && snap.activeWorkspace.id) return snap.activeWorkspace;
    var activeId = snap && snap.activeWorkspaceId ? String(snap.activeWorkspaceId) : '';
    if (activeId === REMOTE_WORKSPACE_ID) {
      return { id: REMOTE_WORKSPACE_ID, name: REMOTE_WORKSPACE_NAME, isRemoteWorkspace: true };
    }
    var workspaces = snap && Array.isArray(snap.workspaces) ? snap.workspaces : [];
    if (activeId) {
      for (var i = 0; i < workspaces.length; i++) {
        if (String(workspaces[i] && workspaces[i].id || '') === activeId) return workspaces[i];
      }
      return { id: activeId, name: activeId };
    }
    return workspaces.length ? workspaces[0] : null;
  }

  function renderCurrentWorkspace(snap) {
    var workspace = findCurrentWorkspace(snap || {});
    currentWorkspace = workspace;
    if (!currentWorkspaceEl) return;
    if (!workspace) {
      currentWorkspaceEl.innerHTML = '<span class="empty">none</span>';
      return;
    }
    currentWorkspaceEl.dataset.workspaceId = workspace.id || '';
    currentWorkspaceEl.innerHTML =
      '<span class="current-workspace-name">' + escapeHtml(workspace.name || '(untitled)') + '</span>' +
      '<span class="current-workspace-id">' + escapeHtml(workspace.id ? String(workspace.id).substring(0, 8) : '') + '</span>';
  }

  LexeraSubApp.init({
    onCatalog: function (snap) {
      var workspace = findCurrentWorkspace(snap || {});
      var visibleBoards = workspace && workspace.id === REMOTE_WORKSPACE_ID
        ? (snap.remoteBoards || [])
        : (snap.boards || []);
      renderBoards(localBoardsEl, visibleBoards, localCountEl);
      renderCurrentWorkspace(snap || {});
      refreshActiveHighlight();
      statusEl.textContent = 'connected';
    },
    onActiveBoard: function (boardId) {
      activeBoardId = boardId;
      refreshActiveHighlight();
    },
    onError: function (err) {
      statusEl.textContent = String(err);
    }
  });

  // ── Test API ──────────────────────────────────────────────────────
  // User-interaction surface for vitest + autoRun integration tests.
  // Mirrors LexeraDashboardTestApi: every operation drives the SAME
  // DOM and event paths a real user does.
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
  function collectListItemState() {
    if (!localBoardsEl) return [];
    var nodes = localBoardsEl.querySelectorAll('.tree-node[data-tree-target="board"]');
    var out = [];
    for (var i = 0; i < nodes.length; i++) {
      var labelEl = nodes[i].querySelector('.tree-label');
      out.push({
        id: nodes[i].getAttribute('data-board-id') || '',
        label: labelEl ? labelEl.textContent : '',
        active: nodes[i].classList.contains('is-active')
      });
    }
    return out;
  }
  window.LexeraWorkspacesTestApi = {
    collectState: function () {
      return {
        status: statusEl ? statusEl.textContent : '',
        activeBoardId: activeBoardId,
        local: collectListItemState(),
        remote: [],
        currentWorkspace: currentWorkspace ? {
          id: currentWorkspace.id || '',
          label: currentWorkspace.name || '(untitled)'
        } : null,
        workspaces: []
      };
    },
    clickBoard: function (boardId, scope) {
      // Drives the same `LexeraSubApp.navigate({ type: 'open-board' })`
      // a real label click does.
      void scope;
      var node = findBoardNode(boardId);
      if (!node) return false;
      var label = node.querySelector('.tree-label') || node;
      return dispatchClick(label);
    },
    clickOpenWorkspace: function (workspaceId) {
      void workspaceId;
      return false;
    }
  };
})();
