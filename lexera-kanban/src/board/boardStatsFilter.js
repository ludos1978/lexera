var BoardStatsFilter = (function () {
  var _deps = {};
  var _rt = typeof window !== 'undefined' && window.LexeraRuntime ? window.LexeraRuntime : null;

  // ── State ─────────────────────────────────────────────────────────────
  var boardTagFilter = [];
  var boardStatsBarVisible = false;

  // ── Init ──────────────────────────────────────────────────────────────
  function init(deps) {
    if (typeof window !== 'undefined' && window.LexeraRuntime) {
      _rt = window.LexeraRuntime;
      _rt.mergeDeps(_deps, deps);
    } else {
      _deps = deps || {};
    }
  }

  // ── Board Tag Filter ─────────────────────────────────────────────────

  function toggleBoardTagFilter(tag) {
    var normalized = String(tag || '').trim().toLowerCase();
    if (!normalized) return;
    var idx = boardTagFilter.indexOf(normalized);
    if (idx >= 0) {
      boardTagFilter.splice(idx, 1);
    } else {
      boardTagFilter.push(normalized);
    }
    applyBoardTagFilter();
    renderBoardTagFilterBar();
  }

  function clearBoardTagFilter() {
    boardTagFilter = [];
    applyBoardTagFilter();
    renderBoardTagFilterBar();
  }

  function applyBoardTagFilter() {
    var cards = _deps.getElColumnsContainer().querySelectorAll('.card');
    if (boardTagFilter.length === 0) {
      for (var i = 0; i < cards.length; i++) {
        cards[i].classList.remove('tag-filter-hidden');
      }
      return;
    }
    for (var j = 0; j < cards.length; j++) {
      var card = cards[j];
      var colIndex = parseInt(card.getAttribute('data-col-index'), 10);
      var cardIndex = parseInt(card.getAttribute('data-card-index'), 10);
      var col = _deps.getFullColumn(colIndex);
      var content = col && col.cards && col.cards[cardIndex] ? String(col.cards[cardIndex].content || '') : '';
      var contentLower = content.toLowerCase();
      var matches = true;
      for (var f = 0; f < boardTagFilter.length; f++) {
        if (contentLower.indexOf(boardTagFilter[f]) < 0) {
          matches = false;
          break;
        }
      }
      card.classList.toggle('tag-filter-hidden', !matches);
    }
  }

  function renderBoardTagFilterBar() {
    var existing = document.querySelector('.board-tag-filter-bar');
    if (existing) existing.remove();
    if (boardTagFilter.length === 0) return;

    var bar = document.createElement('div');
    bar.className = 'board-tag-filter-bar';
    var label = document.createElement('span');
    label.className = 'board-tag-filter-label';
    label.textContent = 'Filtered by:';
    bar.appendChild(label);
    for (var i = 0; i < boardTagFilter.length; i++) {
      var chip = document.createElement('button');
      chip.className = 'board-tag-filter-chip';
      chip.setAttribute('data-filter-tag', boardTagFilter[i]);
      chip.textContent = boardTagFilter[i] + ' \u00d7';
      chip.title = 'Remove ' + boardTagFilter[i] + ' filter';
      bar.appendChild(chip);
    }
    var clearBtn = document.createElement('button');
    clearBtn.className = 'board-action-btn board-tag-filter-clear';
    clearBtn.textContent = 'Clear all';
    bar.appendChild(clearBtn);

    bar.addEventListener('click', function (e) {
      var chipEl = e.target.closest('[data-filter-tag]');
      if (chipEl) {
        toggleBoardTagFilter(chipEl.getAttribute('data-filter-tag'));
        return;
      }
      if (e.target.closest('.board-tag-filter-clear')) {
        clearBoardTagFilter();
      }
    });

    var header = _deps.getElBoardHeader();
    if (header && header.parentNode) {
      header.parentNode.insertBefore(bar, header.nextSibling);
    }
  }

  // ── Board Statistics Bar ─────────────────────────────────────────────

  function toggleBoardStatsBar() {
    var panel = getElLogPanel();
    var isStatsActive = activeLogSource === 'stats' && panel && !panel.classList.contains('hidden');
    if (isStatsActive) {
      // Close panel
      boardStatsBarVisible = false;
      setActiveLogSource('backend');
      setLogPanelVisibility(false);
    } else {
      // Open with stats
      boardStatsBarVisible = true;
      renderBoardStatsBar();
      setActiveLogSource('stats');
      setLogPanelVisibility(true);
    }
  }

  function renderBoardStatsBar() {
    var statsPanel = document.getElementById('log-entries-stats');
    if (!statsPanel) return;
    var fullBoardData = _deps.getFullBoardData();
    if (!boardStatsBarVisible || !fullBoardData) {
      statsPanel.innerHTML = '';
      return;
    }

    var allCols = _deps.getAllColumnsFromBoardData(fullBoardData);
    var totalCards = 0;
    var totalWords = 0;
    var totalCheckboxes = 0;
    var totalChecked = 0;
    var totalRows = fullBoardData.rows ? fullBoardData.rows.length : 0;
    var tagCounts = {};

    for (var ci = 0; ci < allCols.length; ci++) {
      var col = allCols[ci];
      if (!col || !col.cards) continue;
      for (var ki = 0; ki < col.cards.length; ki++) {
        var card = col.cards[ki];
        if (!card) continue;
        var cardContent = card.content || '';
        if (_deps.hasInternalHiddenTag(cardContent, '#hidden-internal-incoming') ||
            _deps.hasInternalHiddenTag(cardContent, '#hidden-internal-parked') ||
            _deps.hasInternalHiddenTag(cardContent, '#hidden-internal-archived') ||
            _deps.hasInternalHiddenTag(cardContent, '#hidden-internal-deleted')) continue;
        totalCards++;
        var words = cardContent.trim().split(/\s+/);
        totalWords += cardContent.trim() ? words.length : 0;
        var checkStats = _deps.countCheckboxes(cardContent);
        totalChecked += checkStats.checked;
        totalCheckboxes += checkStats.total;
        var tags = _deps.collectHeaderTagTokens(cardContent, { includeHash: true });
        for (var ti = 0; ti < tags.length; ti++) {
          var tag = tags[ti];
          if (tag.indexOf('#hidden-internal') === 0) continue;
          tagCounts[tag] = (tagCounts[tag] || 0) + 1;
        }
      }
    }

    var sortedTags = Object.keys(tagCounts).sort(function (a, b) { return tagCounts[b] - tagCounts[a]; });
    var topTags = sortedTags.slice(0, 10);

    var statsHtml = '<div class="board-stats-bar">';
    statsHtml += '<span class="board-stats-item"><strong>Cards:</strong> ' + totalCards + '</span>';
    statsHtml += '<span class="board-stats-item"><strong>Columns:</strong> ' + allCols.length + '</span>';
    statsHtml += '<span class="board-stats-item"><strong>Rows:</strong> ' + totalRows + '</span>';
    statsHtml += '<span class="board-stats-item"><strong>Words:</strong> ' + totalWords + '</span>';
    if (totalCheckboxes > 0) {
      statsHtml += '<span class="board-stats-item"><strong>Tasks:</strong> ' + totalChecked + '/' + totalCheckboxes + '</span>';
    }
    if (topTags.length > 0) {
      statsHtml += '<span class="board-stats-sep">|</span>';
      for (var j = 0; j < topTags.length; j++) {
        statsHtml += '<span class="board-stats-tag">' + _deps.escapeHtml(topTags[j]) + ' <span class="board-stats-tag-count">' + tagCounts[topTags[j]] + '</span></span>';
      }
    }
    statsHtml += '</div>';
    statsPanel.innerHTML = statsHtml;
  }

  // ── State reset (called on board switch) ─────────────────────────────

  function resetState() {
    boardTagFilter = [];
    boardStatsBarVisible = false;
  }

  // ── Public API ────────────────────────────────────────────────────────

  return {
    init: init,
    toggleBoardTagFilter: toggleBoardTagFilter,
    clearBoardTagFilter: clearBoardTagFilter,
    applyBoardTagFilter: applyBoardTagFilter,
    renderBoardTagFilterBar: renderBoardTagFilterBar,
    toggleBoardStatsBar: toggleBoardStatsBar,
    renderBoardStatsBar: renderBoardStatsBar,
    resetState: resetState
  };
})();

window.BoardStatsFilter = BoardStatsFilter;
