// Workspaces sub-app — uses LexeraSubApp shared runtime.
//
// Shows the current workspace and its boards. The synthetic Remote Boards
// workspace uses the same list, but with remote boards as its contents.

(function () {
  'use strict';

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Delegate to the canonical resolver in `titleHelpers.js`. This
  // sub-app, the in-board pane title (`boardHeader.js`), the
  // workspace shell tab headers (`workspaceShell.js`), and the
  // hierarchy sub-app all share that one resolver — so the same
  // board ALWAYS shows the same label across every surface.
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

  // ── Per-board fold state + hierarchy cache ─────────────────────────
  // Phase 1 of "boards must be unfoldable, show titles of every element"
  // (TODOs-lexera.md, 2026-05-03). Only the structural read-only render
  // ships here — drag/drop and re-ordering land in later phases.
  //
  // `boardHierarchies[id]` is one of:
  //   undefined  → never fetched
  //   'loading'  → fetch in flight, show spinner-ish placeholder
  //   'error'    → last fetch failed, show error placeholder
  //   Array      → KanbanRow[] from `/boards/:id/hierarchy`
  var expandedBoardIds = {};
  var boardHierarchies = {};
  var latestBoardsRendered = [];

  function refreshActiveHighlight() {
    var items = document.querySelectorAll('li.board-item');
    for (var i = 0; i < items.length; i++) {
      items[i].classList.toggle('is-active', items[i].dataset.boardId === activeBoardId);
    }
  }

  // Build a generic TreeView node from a kanban hierarchy item. The
  // shape (id / label / type / children / expanded / grip:false) is the
  // same one the dashboard, files panel, and main board sidebar feed
  // into TreeView — keeping the visual treatment consistent across
  // every hierarchical surface in the app.
  function nodeLabel(item) {
    var label = window.LexeraTitleHelpers.resolveBoardLabel(item);
    if (label === 'Untitled') label = item.title || item.name || '';
    return label || '(no title)';
  }
  function buildCardNode(card) {
    return {
      id: card.id || null,
      label: nodeLabel(card),
      type: 'card',
      children: null,
      expanded: false,
      hasToggle: false,
      grip: false
    };
  }
  function buildColumnNode(column) {
    var cards = Array.isArray(column.cards) ? column.cards : [];
    return {
      id: column.id || null,
      label: nodeLabel(column),
      type: 'column',
      children: cards.map(buildCardNode),
      expanded: true,
      grip: false
    };
  }
  function buildStackNode(stack) {
    var cols = Array.isArray(stack.columns) ? stack.columns : [];
    return {
      id: stack.id || null,
      label: nodeLabel(stack),
      type: 'stack',
      children: cols.map(buildColumnNode),
      expanded: true,
      grip: false
    };
  }
  function buildRowNode(row) {
    var stacks = Array.isArray(row.stacks) ? row.stacks : [];
    return {
      id: row.id || null,
      label: nodeLabel(row),
      type: 'row',
      children: stacks.map(buildStackNode),
      expanded: true,
      grip: false
    };
  }

  function renderBoardTree(rows) {
    var container = document.createElement('div');
    container.className = 'board-tree-container';
    if (!rows || !rows.length) {
      var empty = document.createElement('div');
      empty.className = 'tree-empty hierarchical-empty';
      empty.textContent = '(empty board)';
      container.appendChild(empty);
      return container;
    }
    if (window.TreeView && typeof window.TreeView.render === 'function') {
      window.TreeView.render(container, rows.map(buildRowNode), { escapeHtml: escapeHtml });
    }
    return container;
  }

  function renderBoardTreePlaceholder(text) {
    var div = document.createElement('div');
    div.className = 'board-tree-container board-tree-placeholder';
    div.textContent = text;
    return div;
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
    if (!boards.length) {
      target.innerHTML = '<li class="empty">none</li>';
      return;
    }
    target.innerHTML = '';
    boards.forEach(function (b) {
      var boardId = b.id || '';
      var expanded = !!expandedBoardIds[boardId];
      var li = document.createElement('li');
      li.className = 'board-item';
      li.dataset.boardId = boardId;
      var boardLabel = resolveBoardLabel(b);
      var caret = document.createElement('button');
      caret.type = 'button';
      caret.className = 'board-caret';
      caret.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      caret.setAttribute('aria-label', expanded ? 'Collapse board' : 'Expand board');
      caret.textContent = expanded ? '▾' : '▸';
      caret.addEventListener('click', function (ev) {
        ev.stopPropagation();
        toggleBoardExpand(boardId);
      });
      li.appendChild(caret);
      var nameSpan = document.createElement('span');
      nameSpan.className = 'board-name';
      nameSpan.textContent = boardLabel;
      li.appendChild(nameSpan);
      var idSpan = document.createElement('span');
      idSpan.className = 'board-id';
      idSpan.textContent = b.id ? b.id.substring(0, 8) : '';
      li.appendChild(idSpan);
      li.addEventListener('click', function () {
        LexeraSubApp.navigate({ type: 'open-board', boardId: b.id });
      });
      target.appendChild(li);

      if (expanded) {
        var hierarchy = boardHierarchies[boardId];
        var subtreeHost = document.createElement('li');
        subtreeHost.className = 'board-subtree';
        subtreeHost.dataset.forBoardId = boardId;
        if (hierarchy === 'loading') {
          subtreeHost.appendChild(renderBoardTreePlaceholder('Loading…'));
        } else if (hierarchy === 'error') {
          subtreeHost.appendChild(renderBoardTreePlaceholder('Failed to load board structure'));
        } else if (Array.isArray(hierarchy)) {
          subtreeHost.appendChild(renderBoardTree(hierarchy));
        } else {
          subtreeHost.appendChild(renderBoardTreePlaceholder('Loading…'));
        }
        target.appendChild(subtreeHost);
      }
    });
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
  // Mirrors the LexeraDashboardTestApi shape (see views/dashboard/
  // dashboard.js): everything tests do here drives the SAME DOM and
  // event paths a user does — no internal-state shortcuts. Tests that
  // call collectState() see only what the user can see; tests that
  // call clickBoard()/clickWorkspace() trigger the same click event a
  // mouse would.
  function collectListItemState(listEl) {
    if (!listEl) return [];
    var items = listEl.querySelectorAll('li.board-item');
    var out = [];
    for (var i = 0; i < items.length; i++) {
      var name = items[i].querySelector('.board-name, .ws-name');
      out.push({
        id: items[i].dataset.boardId || '',
        label: name ? name.textContent : '',
        active: items[i].classList.contains('is-active')
      });
    }
    return out;
  }
  function findBoardItem(listEl, boardId) {
    if (!listEl) return null;
    var items = listEl.querySelectorAll('li.board-item');
    for (var i = 0; i < items.length; i++) {
      if (items[i].dataset.boardId === String(boardId || '')) return items[i];
    }
    return null;
  }
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
  window.LexeraWorkspacesTestApi = {
    collectState: function () {
      return {
        status: statusEl ? statusEl.textContent : '',
        activeBoardId: activeBoardId,
        local: collectListItemState(localBoardsEl),
        remote: [],
        currentWorkspace: currentWorkspace ? {
          id: currentWorkspace.id || '',
          label: currentWorkspace.name || '(untitled)'
        } : null,
        workspaces: []
      };
    },
    clickBoard: function (boardId, scope) {
      // scope: 'local' | 'remote' (default: 'local'). Returns true if
      // an item was found and clicked, false otherwise — drives the
      // same `LexeraSubApp.navigate({ type: 'open-board', ... })` a
      // real click does.
      void scope;
      return dispatchClick(findBoardItem(localBoardsEl, boardId));
    },
    clickOpenWorkspace: function (workspaceId) {
      void workspaceId;
      return false;
    }
  };
})();
