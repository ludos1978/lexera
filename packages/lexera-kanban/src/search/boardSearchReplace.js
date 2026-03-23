var BoardSearchReplace = (function () {
  var _deps = null;
  var searchReplacePanel = null;

  function init(deps) {
    _deps = deps || {};
  }

  function getFullBoardData() {
    return typeof _deps.getFullBoardData === 'function' ? _deps.getFullBoardData() : null;
  }

  function getActiveBoardId() {
    return typeof _deps.getActiveBoardId === 'function' ? _deps.getActiveBoardId() : null;
  }

  function getAllColumnsFromBoardData(boardData) {
    return typeof _deps.getAllColumnsFromBoardData === 'function' ? _deps.getAllColumnsFromBoardData(boardData) : [];
  }

  function pushUndo() {
    if (typeof _deps.pushUndo === 'function') _deps.pushUndo();
  }

  function persistBoardMutation() {
    if (typeof _deps.persistBoardMutation === 'function') return _deps.persistBoardMutation();
    return Promise.resolve();
  }

  function showNotification(msg) {
    if (typeof _deps.showNotification === 'function') _deps.showNotification(msg);
  }

  function openSearchReplacePanel() {
    if (searchReplacePanel) { searchReplacePanel.querySelector('.sr-search-input').focus(); return; }
    var fullBoardData = getFullBoardData();
    var activeBoardId = getActiveBoardId();
    if (!fullBoardData || !activeBoardId) return;
    var panel = document.createElement('div');
    panel.className = 'search-replace-panel';
    panel.innerHTML =
      '<div class="sr-row">' +
        '<input class="sr-search-input" type="text" placeholder="Find in board\u2026" />' +
        '<span class="sr-match-count"></span>' +
        '<button class="sr-btn sr-prev-btn" title="Previous">\u25B2</button>' +
        '<button class="sr-btn sr-next-btn" title="Next">\u25BC</button>' +
        '<button class="sr-btn sr-close-btn" title="Close">\u2715</button>' +
      '</div>' +
      '<div class="sr-row">' +
        '<input class="sr-replace-input" type="text" placeholder="Replace with\u2026" />' +
        '<button class="sr-btn sr-replace-btn">Replace</button>' +
        '<button class="sr-btn sr-replace-all-btn">Replace All</button>' +
      '</div>';
    var boardHeader = document.getElementById('board-header');
    if (boardHeader && boardHeader.parentNode) {
      boardHeader.parentNode.insertBefore(panel, boardHeader.nextSibling);
    } else {
      document.body.appendChild(panel);
    }
    searchReplacePanel = panel;
    var searchInput = panel.querySelector('.sr-search-input');
    var replaceInput = panel.querySelector('.sr-replace-input');
    var matchCountEl = panel.querySelector('.sr-match-count');
    var matches = [];
    var matchIndex = -1;

    function collectMatches() {
      matches = [];
      var query = searchInput.value;
      var boardData = getFullBoardData();
      if (!query || !boardData) return;
      var lowerQuery = query.toLowerCase();
      var allCols = getAllColumnsFromBoardData(boardData);
      for (var ci = 0; ci < allCols.length; ci++) {
        var col = allCols[ci];
        if (!col || !col.cards) continue;
        for (var ki = 0; ki < col.cards.length; ki++) {
          var card = col.cards[ki];
          var content = card && card.content ? card.content : '';
          var lowerContent = content.toLowerCase();
          var pos = 0;
          while (true) {
            var idx = lowerContent.indexOf(lowerQuery, pos);
            if (idx === -1) break;
            matches.push({ colIndex: ci, cardIndex: ki, card: card, offset: idx });
            pos = idx + 1;
          }
        }
      }
    }

    function updateMatchDisplay() {
      if (matches.length === 0) {
        matchCountEl.textContent = searchInput.value ? 'No matches' : '';
      } else {
        matchCountEl.textContent = (matchIndex + 1) + ' of ' + matches.length;
      }
    }

    function clearHighlights() {
      var highlighted = document.querySelectorAll('.sr-highlight');
      for (var h = 0; h < highlighted.length; h++) highlighted[h].classList.remove('sr-highlight');
    }

    function highlightCurrentMatch() {
      clearHighlights();
      if (matchIndex < 0 || matchIndex >= matches.length) return;
      var m = matches[matchIndex];
      var cardEls = document.querySelectorAll('.card[data-card-index="' + m.cardIndex + '"]');
      for (var i = 0; i < cardEls.length; i++) {
        var colEl = cardEls[i].closest('.kanban-column-stack, .kanban-full-height-column');
        if (colEl) {
          cardEls[i].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          cardEls[i].classList.add('sr-highlight');
          break;
        }
      }
    }

    function onSearchChange() {
      collectMatches();
      matchIndex = matches.length > 0 ? 0 : -1;
      updateMatchDisplay();
      highlightCurrentMatch();
    }

    searchInput.addEventListener('input', onSearchChange);

    panel.querySelector('.sr-next-btn').addEventListener('click', function () {
      if (matches.length === 0) return;
      matchIndex = (matchIndex + 1) % matches.length;
      updateMatchDisplay();
      highlightCurrentMatch();
    });

    panel.querySelector('.sr-prev-btn').addEventListener('click', function () {
      if (matches.length === 0) return;
      matchIndex = (matchIndex - 1 + matches.length) % matches.length;
      updateMatchDisplay();
      highlightCurrentMatch();
    });

    panel.querySelector('.sr-replace-btn').addEventListener('click', async function () {
      if (matchIndex < 0 || matchIndex >= matches.length) return;
      var m = matches[matchIndex];
      var query = searchInput.value;
      var replacement = replaceInput.value;
      pushUndo();
      var content = m.card.content || '';
      m.card.content = content.substring(0, m.offset) + replacement + content.substring(m.offset + query.length);
      await persistBoardMutation();
      onSearchChange();
    });

    panel.querySelector('.sr-replace-all-btn').addEventListener('click', async function () {
      if (matches.length === 0) return;
      var query = searchInput.value;
      var replacement = replaceInput.value;
      if (!query) return;
      pushUndo();
      var boardData = getFullBoardData();
      var allCols = getAllColumnsFromBoardData(boardData);
      for (var ci = 0; ci < allCols.length; ci++) {
        var col = allCols[ci];
        if (!col || !col.cards) continue;
        for (var ki = 0; ki < col.cards.length; ki++) {
          var card = col.cards[ki];
          if (!card || !card.content) continue;
          var escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          card.content = card.content.replace(new RegExp(escaped, 'gi'), replacement);
        }
      }
      await persistBoardMutation();
      onSearchChange();
      showNotification('Replaced all matches');
    });

    function closePanel() {
      clearHighlights();
      if (searchReplacePanel) { searchReplacePanel.remove(); searchReplacePanel = null; }
    }

    panel.querySelector('.sr-close-btn').addEventListener('click', closePanel);

    panel.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.preventDefault(); closePanel(); }
      if (e.key === 'Enter' && e.target === searchInput) { e.preventDefault(); onSearchChange(); }
      if (e.key === 'Enter' && e.target === replaceInput) {
        e.preventDefault();
        panel.querySelector('.sr-replace-btn').click();
      }
    });

    searchInput.focus();
  }

  function closeSearchReplacePanel() {
    if (searchReplacePanel) { searchReplacePanel.remove(); searchReplacePanel = null; }
  }

  return {
    init: init,
    openSearchReplacePanel: openSearchReplacePanel,
    closeSearchReplacePanel: closeSearchReplacePanel
  };
})();

window.BoardSearchReplace = BoardSearchReplace;
