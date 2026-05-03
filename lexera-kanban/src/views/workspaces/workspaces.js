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
  // Phase 2a: row / stack / column / card nodes carry the canonical
  // TreeView drag grip so the user sees the same drag affordance the
  // dashboard, files panel, and main board sidebar already show.
  // Actual drop wiring lands in Phase 2b.
  function buildCardNode(card) {
    return { id: card.id || null, label: nodeLabel(card), type: 'card',
             children: null, expanded: false, hasToggle: false, grip: true,
             gripTitle: 'Drag card to reorder' };
  }
  function buildColumnNode(column) {
    var cards = Array.isArray(column.cards) ? column.cards : [];
    return { id: column.id || null, label: nodeLabel(column), type: 'column',
             children: cards.map(buildCardNode), expanded: true, grip: true,
             gripTitle: 'Drag column to reorder' };
  }
  function buildStackNode(stack) {
    var cols = Array.isArray(stack.columns) ? stack.columns : [];
    return { id: stack.id || null, label: nodeLabel(stack), type: 'stack',
             children: cols.map(buildColumnNode), expanded: true, grip: true,
             gripTitle: 'Drag stack to reorder' };
  }
  function buildRowNode(row) {
    var stacks = Array.isArray(row.stacks) ? row.stacks : [];
    return { id: row.id || null, label: nodeLabel(row), type: 'row',
             children: stacks.map(buildStackNode), expanded: true, grip: true,
             gripTitle: 'Drag row to reorder' };
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
      if (Array.isArray(hierarchy)) {
        children = hierarchy.length > 0
          ? hierarchy.map(buildRowNode)
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
