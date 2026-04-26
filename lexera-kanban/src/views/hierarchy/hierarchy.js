// Hierarchy sub-app — minimal navigation panel (Workstream P).
//
// This webview replaces the in-shell `.sidebar` board-list rendering.
// Today it shows a flat list of boards + workspaces with click-to-navigate.
// The rich-tree functionality (stacks/columns/cards, drag/drop,
// expand/collapse, inline rename, context menus) lives in
// `src/board/boardList.js` (3204 lines) — porting that into this
// sub-app is its own future slice.

(function () {
  'use strict';

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  var statusEl = document.getElementById('status');
  var titleEl = document.getElementById('title');
  var localBoardsEl = document.getElementById('local-boards');
  var remoteBoardsEl = document.getElementById('remote-boards');
  var workspacesEl = document.getElementById('workspaces');
  var localCountEl = document.getElementById('local-count');
  var remoteCountEl = document.getElementById('remote-count');
  var wsCountEl = document.getElementById('ws-count');

  var activeBoardId = null;
  var activeWorkspaceId = null;

  function refreshActiveHighlight() {
    var items = document.querySelectorAll('li.board-item');
    for (var i = 0; i < items.length; i++) {
      items[i].classList.toggle('is-active', items[i].dataset.boardId === activeBoardId);
    }
    var wsItems = document.querySelectorAll('li.ws-item');
    for (var j = 0; j < wsItems.length; j++) {
      wsItems[j].classList.toggle('is-active', wsItems[j].dataset.workspaceId === activeWorkspaceId);
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

  function renderWorkspaces(workspaces) {
    wsCountEl.textContent = '(' + workspaces.length + ')';
    if (!workspaces.length) {
      workspacesEl.innerHTML = '<li class="empty">none</li>';
      return;
    }
    workspacesEl.innerHTML = '';
    workspaces.forEach(function (w) {
      var li = document.createElement('li');
      li.className = 'ws-item';
      li.dataset.workspaceId = w.id || '';
      li.innerHTML =
        '<span class="ws-name">' + escapeHtml(w.name || '(untitled)') + '</span>' +
        '<span class="ws-id">' + escapeHtml(w.id ? w.id.substring(0, 8) : '') + '</span>';
      workspacesEl.appendChild(li);
    });
  }

  LexeraSubApp.init({
    onCatalog: function (snap) {
      var ws = snap.activeWorkspace;
      if (ws && ws.name) {
        titleEl.textContent = ws.name;
        activeWorkspaceId = ws.id || null;
      } else {
        titleEl.textContent = 'All Workspaces';
        activeWorkspaceId = null;
      }
      renderBoards(localBoardsEl, snap.boards || [], localCountEl);
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
})();
