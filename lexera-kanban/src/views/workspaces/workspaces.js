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
      li.dataset.workspaceId = w.id || '';
      // "Open" button spawns the workspace in a new window — the SHELL
      // routes this to `WorkspaceShell.openWorkspaceWindow(workspaceId)`,
      // which passes the id to `open_new_window` so the new window
      // boots with `?workspace=<id>` and locks itself to that workspace.
      li.innerHTML =
        '<span class="ws-name">' + escapeHtml(w.name || '(untitled)') + '</span>' +
        '<span class="ws-id">' + escapeHtml(w.id ? w.id.substring(0, 8) : '') + '</span>' +
        '<button class="ws-open-btn" type="button" title="Open in new window" aria-label="Open workspace in new window">Open</button>';
      var openBtn = li.querySelector('.ws-open-btn');
      if (openBtn) {
        openBtn.addEventListener('click', function (ev) {
          ev.stopPropagation();
          ev.preventDefault();
          if (!w.id) return;
          LexeraSubApp.navigate({ type: 'open-workspace-window', workspaceId: w.id });
        });
      }
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
    var items = listEl.querySelectorAll('li.board-item, li.ws-item');
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
  function findWorkspaceItem(workspaceId) {
    if (!workspacesEl) return null;
    var items = workspacesEl.querySelectorAll('li.ws-item');
    for (var i = 0; i < items.length; i++) {
      if (items[i].dataset.workspaceId === String(workspaceId || '')) return items[i];
    }
    return null;
  }
  window.LexeraWorkspacesTestApi = {
    collectState: function () {
      return {
        status: statusEl ? statusEl.textContent : '',
        activeBoardId: activeBoardId,
        local: collectListItemState(localBoardsEl),
        remote: collectListItemState(remoteBoardsEl),
        workspaces: collectListItemState(workspacesEl)
      };
    },
    clickBoard: function (boardId, scope) {
      // scope: 'local' | 'remote' (default: 'local'). Returns true if
      // an item was found and clicked, false otherwise — drives the
      // same `LexeraSubApp.navigate({ type: 'open-board', ... })` a
      // real click does.
      var listEl = scope === 'remote' ? remoteBoardsEl : localBoardsEl;
      return dispatchClick(findBoardItem(listEl, boardId));
    },
    clickOpenWorkspace: function (workspaceId) {
      // Drives the per-row "Open" button — fires the same
      // `LexeraSubApp.navigate({ type: 'open-workspace-window', ... })`
      // a real click does. Returns false when the workspace row or
      // the open button isn't visible (so a regression that hides
      // the affordance fails the test loudly).
      var item = findWorkspaceItem(workspaceId);
      if (!item) return false;
      var btn = item.querySelector('.ws-open-btn');
      return dispatchClick(btn);
    }
  };
})();
