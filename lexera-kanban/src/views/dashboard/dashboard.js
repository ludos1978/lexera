// Dashboard sub-app — uses LexeraSubApp shared runtime.
//
// Shows board metrics + recent boards with click-to-navigate.
// Theme inheritance, scoped event listening, focus reporting, and
// keyboard shortcuts all handled by the runtime.

(function () {
  'use strict';

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  var statusEl = document.getElementById('status');
  var mLocal = document.getElementById('m-local');
  var mRemote = document.getElementById('m-remote');
  var mWs = document.getElementById('m-ws');
  var mActive = document.getElementById('m-active');
  var recentEl = document.getElementById('recent');

  var allBoards = [];
  var activeBoardId = null;

  function findBoardName(id) {
    for (var i = 0; i < allBoards.length; i++) {
      if (allBoards[i].id === id) return allBoards[i].name || allBoards[i].title || '(untitled)';
    }
    return '';
  }

  function renderRecent() {
    var sorted = allBoards.slice().sort(function (a, b) {
      var aActive = a.id === activeBoardId ? -1 : 0;
      var bActive = b.id === activeBoardId ? -1 : 0;
      return aActive - bActive;
    }).slice(0, 8);
    if (!sorted.length) {
      recentEl.innerHTML = '<li class="recent-item" style="color:var(--text-muted,#666);font-style:italic;">No boards</li>';
      return;
    }
    recentEl.innerHTML = '';
    sorted.forEach(function (b) {
      var li = document.createElement('li');
      li.className = 'recent-item' + (b.id === activeBoardId ? ' is-active' : '');
      li.dataset.boardId = b.id || '';
      li.innerHTML =
        '<span class="recent-name">' + escapeHtml(b.name || b.title || '(untitled)') + '</span>' +
        '<span class="recent-id">' + escapeHtml(b.id ? b.id.substring(0, 8) : '') + '</span>';
      li.addEventListener('click', function () {
        LexeraSubApp.navigate({ type: 'open-board', boardId: b.id });
      });
      recentEl.appendChild(li);
    });
  }

  LexeraSubApp.init({
    onCatalog: function (snap) {
      var local = Array.isArray(snap.boards) ? snap.boards : [];
      var remote = Array.isArray(snap.remoteBoards) ? snap.remoteBoards : [];
      var ws = Array.isArray(snap.workspaces) ? snap.workspaces : [];
      mLocal.textContent = String(local.length);
      mRemote.textContent = String(remote.length);
      mWs.textContent = String(ws.length);
      allBoards = local.concat(remote);
      var name = findBoardName(activeBoardId);
      mActive.textContent = name || (activeBoardId || 'none');
      renderRecent();
      statusEl.textContent = 'connected';
    },
    onActiveBoard: function (boardId) {
      activeBoardId = boardId || null;
      var name = findBoardName(activeBoardId);
      mActive.textContent = name || (activeBoardId || 'none');
      renderRecent();
    },
    onError: function (err) {
      statusEl.textContent = String(err);
    }
  });
})();
