// Workspaces sub-app — uses LexeraSubApp shared runtime.
//
// Shows local boards, remote boards, and workspaces. Click a board
// to broadcast a navigation request to the main shell.

(function () {
  'use strict';

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  var statusEl = document.getElementById('status');
  var localBoardsEl = document.getElementById('local-boards');
  var remoteBoardsEl = document.getElementById('remote-boards');
  var workspacesEl = document.getElementById('workspaces');
  var localCountEl = document.getElementById('local-count');
  var remoteCountEl = document.getElementById('remote-count');
  var wsCountEl = document.getElementById('ws-count');

  var activeBoardId = null;

  function refreshActiveHighlight() {
    var items = document.querySelectorAll('li.board-item');
    for (var i = 0; i < items.length; i++) {
      items[i].classList.toggle('is-active', items[i].dataset.boardId === activeBoardId);
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
      // BoardInfo from /boards uses `title` (camelCase per the Rust
      // serde rename); `name` is a legacy field still accepted as a
      // fallback. The previous order `b.name || b.title` evaluated
      // `undefined || ''` for real boards (since `name` is absent and
      // `title` may briefly be an empty string before the file parse
      // completes), short-circuiting to '(untitled)' for every row.
      // Prefer `title` first so the canonical field wins, with `name`
      // as the legacy fallback and `(untitled)` only when both are
      // truly absent.
      var boardLabel = b.title || b.name || '(untitled)';
      li.innerHTML =
        '<span class="board-name">' + escapeHtml(boardLabel) + '</span>' +
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
      li.innerHTML =
        '<span class="ws-name">' + escapeHtml(w.name || '(untitled)') + '</span>' +
        '<span class="ws-id">' + escapeHtml(w.id ? w.id.substring(0, 8) : '') + '</span>';
      workspacesEl.appendChild(li);
    });
  }

  LexeraSubApp.init({
    onCatalog: function (snap) {
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
