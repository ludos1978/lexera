// Hierarchy sub-app — grouped workspace navigation panel (Workstream P).
//
// This webview replaces the in-shell `.sidebar` board-list rendering.
// It now groups local boards by workspace with local expand/collapse
// state, while richer tree internals (stacks/columns/cards, drag/drop,
// inline rename, context menus) still remain in `src/board/boardList.js`.

(function () {
  'use strict';

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Delegate to the canonical resolver in `titleHelpers.js` so the
  // hierarchy sub-app, workspaces sub-app, in-board pane title, and
  // workspace shell tabs all show the SAME label for the same board.
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
  // Each window owns exactly one workspace, set by the catalog
  // snapshot. Null only during pre-hydration.
  var selectedWorkspaceId = null;
  var latestCatalog = null;
  var expandedWorkspaceIds = {};

  // Per-board fold state + hierarchy cache (Phase 1b of "boards must
  // be unfoldable, show titles", TODOs-lexera.md). Mirrors the
  // workspaces sub-app implementation. `boardHierarchies[id]` is one
  // of: undefined | 'loading' | 'error' | KanbanRow[].
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

  function refreshActiveHighlight() {
    var items = document.querySelectorAll('li.board-item');
    for (var i = 0; i < items.length; i++) {
      items[i].classList.toggle('is-active', items[i].dataset.boardId === activeBoardId);
    }
    var wsGroups = document.querySelectorAll('button.ws-group-header');
    for (var j = 0; j < wsGroups.length; j++) {
      wsGroups[j].classList.toggle('is-active', wsGroups[j].dataset.workspaceId === selectedWorkspaceId);
    }
  }

  function buildWorkspaceGroups(boards, remoteBoards, workspaces, workspaceId) {
    var groups = [];
    var normalizedWorkspaceId = String(workspaceId || '');
    if (!normalizedWorkspaceId) return groups;
    if (normalizedWorkspaceId === REMOTE_WORKSPACE_ID) {
      groups.push({
        id: REMOTE_WORKSPACE_ID,
        name: REMOTE_WORKSPACE_NAME,
        boards: remoteBoards || []
      });
      return groups;
    }
    var workspaceById = {};
    for (var i = 0; i < workspaces.length; i++) {
      if (workspaces[i] && workspaces[i].id) workspaceById[workspaces[i].id] = workspaces[i];
    }
    var selectedWorkspace = workspaceById[normalizedWorkspaceId];
    if (!selectedWorkspace) return groups;
    groups.push({
      id: selectedWorkspace.id,
      name: selectedWorkspace.name || '(untitled)',
      boards: boards.filter(function (board) {
        return getBoardWorkspaceIds(board).indexOf(normalizedWorkspaceId) >= 0;
      })
    });
    return groups;
  }

  function isWorkspaceExpanded(groupId, workspaceId) {
    if (Object.prototype.hasOwnProperty.call(expandedWorkspaceIds, groupId)) {
      return expandedWorkspaceIds[groupId] === true;
    }
    return true;
  }

  // Build TreeView nodes from a kanban hierarchy item — same shape the
  // dashboard / files panel / main board sidebar feed into TreeView so
  // every hierarchical surface in the app shares one visual treatment.
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
      if (latestCatalog) {
        renderWorkspaceGroups(latestCatalog.boards || [], latestCatalog.remoteBoards || [], latestCatalog.workspaces || [], selectedWorkspaceId);
        refreshActiveHighlight();
      }
    }).catch(function () {
      boardHierarchies[boardId] = 'error';
      if (latestCatalog) {
        renderWorkspaceGroups(latestCatalog.boards || [], latestCatalog.remoteBoards || [], latestCatalog.workspaces || [], selectedWorkspaceId);
        refreshActiveHighlight();
      }
    });
  }
  function toggleBoardExpand(boardId) {
    var nowExpanded = !expandedBoardIds[boardId];
    expandedBoardIds[boardId] = nowExpanded;
    if (nowExpanded && boardHierarchies[boardId] == null) {
      fetchBoardHierarchy(boardId);
    }
    if (latestCatalog) {
      renderWorkspaceGroups(latestCatalog.boards || [], latestCatalog.remoteBoards || [], latestCatalog.workspaces || [], selectedWorkspaceId);
      refreshActiveHighlight();
    }
  }

  function renderWorkspaceGroups(boards, remoteBoards, workspaces, workspaceId) {
    var groups = buildWorkspaceGroups(boards, remoteBoards, workspaces, workspaceId);
    var visibleCount = groups.length ? groups[0].boards.length : 0;
    localCountEl.textContent = '(' + visibleCount + ')';
    if (!groups.length) {
      localBoardsEl.innerHTML = '<li class="empty">none</li>';
      return;
    }
    localBoardsEl.innerHTML = '';
    groups.forEach(function (group) {
      var wrapper = document.createElement('li');
      var expanded = isWorkspaceExpanded(group.id, workspaceId);
      wrapper.className = 'ws-group';
      wrapper.setAttribute('data-workspace-group', group.id);

      var header = document.createElement('button');
      header.type = 'button';
      header.className = 'ws-group-header';
      header.dataset.workspaceId = group.id;
      header.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      header.innerHTML =
        '<span class="ws-group-caret" aria-hidden="true">' + (expanded ? '▾' : '▸') + '</span>' +
        '<span class="ws-group-name">' + escapeHtml(group.name) + '</span>' +
        '<span class="ws-group-meta">' + escapeHtml(String(group.boards.length)) + '</span>';
      header.addEventListener('click', function () {
        expandedWorkspaceIds[group.id] = !isWorkspaceExpanded(group.id, workspaceId);
        if (latestCatalog) {
          renderWorkspaceGroups(latestCatalog.boards || [], latestCatalog.remoteBoards || [], latestCatalog.workspaces || [], selectedWorkspaceId);
          refreshActiveHighlight();
        }
      });
      wrapper.appendChild(header);

      var list = document.createElement('ul');
      list.className = 'board-list nested' + (expanded ? '' : ' collapsed');
      group.boards.forEach(function (board) {
        var boardId = board.id || '';
        var boardExpanded = !!expandedBoardIds[boardId];
        var li = document.createElement('li');
        li.className = 'board-item';
        li.dataset.boardId = boardId;
        var boardLabel = resolveBoardLabel(board);

        var caret = document.createElement('button');
        caret.type = 'button';
        caret.className = 'board-caret';
        caret.setAttribute('aria-expanded', boardExpanded ? 'true' : 'false');
        caret.setAttribute('aria-label', boardExpanded ? 'Collapse board' : 'Expand board');
        caret.textContent = boardExpanded ? '▾' : '▸';
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
        idSpan.textContent = board.id ? board.id.substring(0, 8) : '';
        li.appendChild(idSpan);

        li.addEventListener('click', function () {
          LexeraSubApp.navigate({ type: 'open-board', boardId: board.id });
        });
        list.appendChild(li);

        if (boardExpanded) {
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
          list.appendChild(subtreeHost);
        }
      });
      wrapper.appendChild(list);
      localBoardsEl.appendChild(wrapper);
    });
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
      renderWorkspaceGroups(snap.boards || [], snap.remoteBoards || [], snap.workspaces || [], selectedWorkspaceId);
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
  // Mirrors LexeraDashboardTestApi / LexeraWorkspacesTestApi: every
  // operation drives the SAME DOM and event paths a real user does
  // — no internal-state shortcuts. Tests that read collectState()
  // see only what the user can see; tests that call clickBoard /
  // clickWorkspace / clickWorkspaceGroupHeader trigger the same
  // click events a mouse would.
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
  function findBoardItem(rootEl, boardId) {
    if (!rootEl) return null;
    var items = rootEl.querySelectorAll('li.board-item');
    for (var i = 0; i < items.length; i++) {
      if (items[i].dataset.boardId === String(boardId || '')) return items[i];
    }
    return null;
  }
  function findWorkspaceGroupHeader(groupId) {
    if (!localBoardsEl) return null;
    var headers = localBoardsEl.querySelectorAll('button.ws-group-header');
    for (var i = 0; i < headers.length; i++) {
      if (headers[i].dataset.workspaceId === String(groupId || '')) return headers[i];
    }
    return null;
  }
  function collectGroupState() {
    if (!localBoardsEl) return [];
    var groups = localBoardsEl.querySelectorAll('li.ws-group');
    var out = [];
    for (var i = 0; i < groups.length; i++) {
      var header = groups[i].querySelector('button.ws-group-header');
      var nested = groups[i].querySelector('ul.board-list.nested');
      var boards = nested ? nested.querySelectorAll('li.board-item') : [];
      var boardList = [];
      for (var j = 0; j < boards.length; j++) {
        var name = boards[j].querySelector('.board-name');
        boardList.push({
          id: boards[j].dataset.boardId || '',
          label: name ? name.textContent : '',
          active: boards[j].classList.contains('is-active')
        });
      }
      out.push({
        id: groups[i].getAttribute('data-workspace-group') || '',
        name: header ? (header.querySelector('.ws-group-name') || {}).textContent || '' : '',
        expanded: header ? header.getAttribute('aria-expanded') === 'true' : false,
        active: header ? header.classList.contains('is-active') : false,
        boards: boardList
      });
    }
    return out;
  }
  function collectFlatBoardItems(rootEl) {
    if (!rootEl) return [];
    var items = rootEl.querySelectorAll('li.board-item');
    var out = [];
    for (var i = 0; i < items.length; i++) {
      var name = items[i].querySelector('.board-name');
      out.push({
        id: items[i].dataset.boardId || '',
        label: name ? name.textContent : '',
        active: items[i].classList.contains('is-active')
      });
    }
    return out;
  }
  window.LexeraHierarchyTestApi = {
    collectState: function () {
      return {
        status: statusEl ? statusEl.textContent : '',
        title: titleEl ? titleEl.textContent : '',
        viewMode: viewModeEl ? viewModeEl.textContent : '',
        activeBoardId: activeBoardId,
        selectedWorkspaceId: selectedWorkspaceId,
        groups: collectGroupState(),
        remote: [],
        workspaces: []
      };
    },
    clickBoard: function (boardId, scope) {
      void scope;
      return dispatchClick(findBoardItem(localBoardsEl, boardId));
    },
    clickWorkspace: function (workspaceId) {
      void workspaceId;
      return false;
    },
    clickWorkspaceGroupHeader: function (groupId) {
      // Inline group header inside the local-boards tree — toggles
      // expand/collapse without firing a navigate.
      return dispatchClick(findWorkspaceGroupHeader(groupId));
    }
  };
})();
