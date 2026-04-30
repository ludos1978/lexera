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

  var statusEl = document.getElementById('status');
  var titleEl = document.getElementById('title');
  var viewModeEl = document.getElementById('view-mode');
  var localBoardsEl = document.getElementById('local-boards');
  var remoteBoardsEl = document.getElementById('remote-boards');
  var workspacesEl = document.getElementById('workspaces');
  var localCountEl = document.getElementById('local-count');
  var remoteCountEl = document.getElementById('remote-count');
  var wsCountEl = document.getElementById('ws-count');

  var activeBoardId = null;
  // Each window owns exactly one workspace, set by the catalog
  // snapshot. Null only during pre-hydration.
  var selectedWorkspaceId = null;
  var latestCatalog = null;
  var expandedWorkspaceIds = {};

  function resolveWorkspaceFromSnapshot(snap) {
    if (!snap || typeof snap !== 'object') return null;
    if (snap.viewWorkspace && snap.viewWorkspace.id) return snap.viewWorkspace;
    if (snap.activeWorkspace && snap.activeWorkspace.id) return snap.activeWorkspace;
    var preferredId = snap.viewWorkspaceId != null && snap.viewWorkspaceId !== ''
      ? String(snap.viewWorkspaceId)
      : String(snap.activeWorkspaceId || '');
    if (!preferredId) return null;
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
    var wsItems = document.querySelectorAll('li.ws-item');
    for (var j = 0; j < wsItems.length; j++) {
      wsItems[j].classList.toggle('is-active', wsItems[j].dataset.workspaceId === selectedWorkspaceId);
    }
    var wsGroups = document.querySelectorAll('button.ws-group-header');
    for (var k = 0; k < wsGroups.length; k++) {
      wsGroups[k].classList.toggle('is-active', wsGroups[k].dataset.workspaceId === selectedWorkspaceId);
    }
  }

  function renderBoards(target, boards, counterEl) {
    counterEl.textContent = '(' + boards.length + ')';
    if (!boards.length) {
      target.innerHTML = '<li class="empty">none</li>';
      return;
    }
    target.innerHTML = '';
    boards.forEach(function (b) {
      var li = document.createElement('li');
      li.className = 'board-item';
      li.dataset.boardId = b.id || '';
      li.innerHTML =
        '<span class="board-name">' + escapeHtml(b.name || b.title || '(untitled)') + '</span>' +
        '<span class="board-id">' + escapeHtml(b.id ? b.id.substring(0, 8) : '') + '</span>';
      li.addEventListener('click', function () {
        LexeraSubApp.navigate({ type: 'open-board', boardId: b.id });
      });
      target.appendChild(li);
    });
  }

  function buildWorkspaceGroups(boards, workspaces, workspaceId) {
    var groups = [];
    var normalizedWorkspaceId = String(workspaceId || '');
    if (!normalizedWorkspaceId) return groups;
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

  function renderWorkspaceGroups(boards, workspaces, workspaceId) {
    localCountEl.textContent = '(' + boards.length + ')';
    var groups = buildWorkspaceGroups(boards, workspaces, workspaceId);
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
          renderWorkspaceGroups(latestCatalog.boards || [], latestCatalog.workspaces || [], selectedWorkspaceId);
          refreshActiveHighlight();
        }
      });
      wrapper.appendChild(header);

      var list = document.createElement('ul');
      list.className = 'board-list nested' + (expanded ? '' : ' collapsed');
      group.boards.forEach(function (board) {
        var li = document.createElement('li');
        li.className = 'board-item';
        li.dataset.boardId = board.id || '';
        li.innerHTML =
          '<span class="board-name">' + escapeHtml(board.name || board.title || '(untitled)') + '</span>' +
          '<span class="board-id">' + escapeHtml(board.id ? board.id.substring(0, 8) : '') + '</span>';
        li.addEventListener('click', function () {
          LexeraSubApp.navigate({ type: 'open-board', boardId: board.id });
        });
        list.appendChild(li);
      });
      wrapper.appendChild(list);
      localBoardsEl.appendChild(wrapper);
    });
  }

  function renderWorkspaces(workspaces) {
    wsCountEl.textContent = '(' + workspaces.length + ')';
    workspacesEl.innerHTML = '';
    if (!workspaces.length) return;
    workspaces.forEach(function (w) {
      var li = document.createElement('li');
      li.className = 'ws-item';
      li.dataset.workspaceId = w.id || '';
      li.innerHTML =
        '<span class="ws-name">' + escapeHtml(w.name || '(untitled)') + '</span>' +
        '<span class="ws-id">' + escapeHtml(w.id ? w.id.substring(0, 8) : '') + '</span>';
      // Clicking a different workspace opens it in a NEW window — each
      // window owns exactly one workspace for its lifetime.
      li.addEventListener('click', function () {
        if (!w.id) return;
        LexeraSubApp.navigate({ type: 'open-workspace-window', workspaceId: w.id });
      });
      workspacesEl.appendChild(li);
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
      renderWorkspaceGroups(snap.boards || [], snap.workspaces || [], selectedWorkspaceId);
      renderBoards(remoteBoardsEl, snap.remoteBoards || [], remoteCountEl);
      renderWorkspaces(snap.workspaces || []);
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
  function findWorkspaceItem(workspaceId) {
    if (!workspacesEl) return null;
    var items = workspacesEl.querySelectorAll('li.ws-item');
    for (var i = 0; i < items.length; i++) {
      if (items[i].dataset.workspaceId === String(workspaceId || '')) return items[i];
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
  function collectWorkspaceItems() {
    if (!workspacesEl) return [];
    var items = workspacesEl.querySelectorAll('li.ws-item');
    var out = [];
    for (var i = 0; i < items.length; i++) {
      var name = items[i].querySelector('.ws-name');
      out.push({
        id: items[i].dataset.workspaceId || '',
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
        remote: collectFlatBoardItems(remoteBoardsEl),
        workspaces: collectWorkspaceItems()
      };
    },
    clickBoard: function (boardId, scope) {
      // scope: 'local' (default — searches inside grouped tree) | 'remote'
      var rootEl = scope === 'remote' ? remoteBoardsEl : localBoardsEl;
      return dispatchClick(findBoardItem(rootEl, boardId));
    },
    clickWorkspace: function (workspaceId) {
      // Top "Workspaces" sidebar list — focuses the workspace view.
      return dispatchClick(findWorkspaceItem(workspaceId));
    },
    clickWorkspaceGroupHeader: function (groupId) {
      // Inline group header inside the local-boards tree — toggles
      // expand/collapse without firing a navigate.
      return dispatchClick(findWorkspaceGroupHeader(groupId));
    }
  };
})();
