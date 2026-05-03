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

  function renderHierarchyNode(node, kind) {
    var li = document.createElement('li');
    li.className = 'board-tree-node board-tree-' + kind;
    var label = window.LexeraTitleHelpers.resolveBoardLabel(node);
    if (label === 'Untitled') label = node.title || node.name || '';
    li.innerHTML = '<span class="board-tree-label">' + escapeHtml(label || '(no title)') + '</span>';
    return li;
  }

  function appendChildren(parentLi, items, kind, childField, childKind) {
    if (!items || !items.length) return;
    var ul = document.createElement('ul');
    ul.className = 'board-tree-children board-tree-children-' + kind;
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var node = renderHierarchyNode(item, kind);
      if (childField) {
        appendChildren(node, item[childField], childKind, nextChildField(childKind), nextChildKind(childKind));
      }
      ul.appendChild(node);
    }
    parentLi.appendChild(ul);
  }

  function nextChildField(kind) {
    if (kind === 'row') return 'stacks';
    if (kind === 'stack') return 'columns';
    if (kind === 'column') return 'cards';
    return null;
  }
  function nextChildKind(kind) {
    if (kind === 'row') return 'stack';
    if (kind === 'stack') return 'column';
    if (kind === 'column') return 'card';
    return null;
  }

  function renderBoardTree(rows) {
    var rootLi = document.createElement('li');
    rootLi.className = 'board-tree';
    var ul = document.createElement('ul');
    ul.className = 'board-tree-children board-tree-children-root';
    if (!rows || !rows.length) {
      var empty = document.createElement('li');
      empty.className = 'board-tree-empty';
      empty.textContent = '(empty board)';
      ul.appendChild(empty);
    } else {
      for (var i = 0; i < rows.length; i++) {
        var rowNode = renderHierarchyNode(rows[i], 'row');
        appendChildren(rowNode, rows[i].stacks, 'stack', 'columns', 'column');
        ul.appendChild(rowNode);
      }
    }
    rootLi.appendChild(ul);
    return rootLi;
  }

  function renderBoardTreePlaceholder(text) {
    var li = document.createElement('li');
    li.className = 'board-tree board-tree-placeholder';
    li.textContent = text;
    return li;
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
        if (hierarchy === 'loading') {
          target.appendChild(renderBoardTreePlaceholder('Loading…'));
        } else if (hierarchy === 'error') {
          target.appendChild(renderBoardTreePlaceholder('Failed to load board structure'));
        } else if (Array.isArray(hierarchy)) {
          target.appendChild(renderBoardTree(hierarchy));
        } else {
          target.appendChild(renderBoardTreePlaceholder('Loading…'));
        }
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
