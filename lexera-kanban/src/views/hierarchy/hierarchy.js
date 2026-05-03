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

  // Phase 2b drag-and-drop wiring — three delegated listeners on the
  // tree container.
  //
  // 2b-2-a (dragstart): stamp source identity into DataTransfer +
  //   broadcast `hierarchy-entity-drag-start`.
  // 2b-2-b (dragover): preventDefault on a same-kind same-board target
  //   so the browser shows a copy / move cursor + add `.is-drop-target`
  //   class for visual feedback.
  // 2b-2-b (drop): broadcast `hierarchy-entity-drop` with
  //   `{ source, target }`. Local-cache reorder + `saveBoard` persist
  //   land in the next slice.
  if (localBoardsEl && !localBoardsEl.__hierarchyDragBound) {
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
      // Same-kind reorder is the only valid drop — cross-kind drops
      // are deferred to Phase 4 (tree↔board). Cross-board same-kind
      // drops are accepted (Phase 3): the bridge splices source out
      // of board A and into board B. The hierarchy sub-app shows a
      // single workspace, so cross-board only fires when the user
      // expanded multiple boards inside the same workspace.
      if (!dragSource) return null;
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
      // Only clear when leaving the container entirely so a transition
      // between sibling targets doesn't flicker.
      if (e.target === activeDropTargetEl) {
        // Browser fires dragleave on the previous target before
        // dragenter on the next — the next dragover will reapply.
        clearDropTargetEl();
      }
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
    localBoardsEl.__hierarchyDragBound = true;
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

  LexeraSubApp.init({
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
