/**
 * Ludos Dashboard — Main application logic.
 * IIFE pattern, uses LudosApi from api.js.
 */
const LudosDashboard = (function () {
  // State
  let boards = [];
  let activeBoardId = null;
  let activeBoardData = null;
  let connected = false;
  let searchMode = false;
  let searchResults = null;
  let pollInterval = null;
  let addCardColumn = null; // column index with open add-card form

  // DOM refs
  const $boardList = document.getElementById('board-list');
  const $main = document.getElementById('main-content');
  const $boardHeader = document.getElementById('board-header');
  const $columnsContainer = document.getElementById('columns-container');
  const $searchResults = document.getElementById('search-results');
  const $emptyState = document.getElementById('empty-state');
  const $searchInput = document.getElementById('search-input');
  const $connectionDot = document.getElementById('connection-dot');
  const $settingsBtn = document.getElementById('settings-btn');
  const $settingsDialog = document.getElementById('settings-dialog');
  const $settingsUrl = document.getElementById('settings-url');
  const $settingsSave = document.getElementById('settings-save');
  const $settingsCancel = document.getElementById('settings-cancel');

  function init() {
    // Load saved URL
    $settingsUrl.value = LudosApi.getBaseUrl();

    // Event listeners
    $searchInput.addEventListener('input', onSearchInput);
    $searchInput.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        $searchInput.value = '';
        exitSearchMode();
      }
    });
    $settingsBtn.addEventListener('click', openSettings);
    $settingsCancel.addEventListener('click', closeSettings);
    $settingsSave.addEventListener('click', saveSettings);
    $settingsDialog.addEventListener('click', function (e) {
      if (e.target === $settingsDialog) closeSettings();
    });

    // Start polling
    poll();
    pollInterval = setInterval(poll, 5000);
  }

  // --- Polling ---

  async function poll() {
    try {
      const ok = await LudosApi.checkStatus();
      setConnected(ok);
      if (!ok) return;
    } catch {
      setConnected(false);
      return;
    }

    try {
      const data = await LudosApi.getBoards();
      boards = data.boards || [];
      renderBoardList();

      // Refresh active board if still exists
      if (activeBoardId && !searchMode) {
        const stillExists = boards.find(b => b.id === activeBoardId);
        if (stillExists) {
          await loadBoard(activeBoardId);
        } else {
          activeBoardId = null;
          activeBoardData = null;
          renderMainView();
        }
      }
    } catch {
      // API available but boards endpoint failed — keep previous state
    }
  }

  function setConnected(state) {
    connected = state;
    $connectionDot.classList.toggle('connected', state);
  }

  // --- Board List ---

  function renderBoardList() {
    $boardList.innerHTML = '';
    for (const board of boards) {
      const totalCards = board.columns.reduce(function (sum, c) { return sum + c.cardCount; }, 0);
      const el = document.createElement('div');
      el.className = 'board-item' + (board.id === activeBoardId ? ' active' : '');
      el.innerHTML =
        '<span class="board-item-title">' + escapeHtml(board.title || 'Untitled') + '</span>' +
        '<span class="board-item-count">' + totalCards + '</span>';
      el.addEventListener('click', function () {
        exitSearchMode();
        selectBoard(board.id);
      });
      $boardList.appendChild(el);
    }
  }

  async function selectBoard(boardId) {
    activeBoardId = boardId;
    addCardColumn = null;
    renderBoardList();
    await loadBoard(boardId);
  }

  async function loadBoard(boardId) {
    try {
      activeBoardData = await LudosApi.getBoardColumns(boardId);
      renderMainView();
    } catch {
      activeBoardData = null;
      renderMainView();
    }
  }

  // --- Main View ---

  function renderMainView() {
    if (searchMode && searchResults) {
      renderSearchResults();
      return;
    }

    $searchResults.classList.add('hidden');

    if (!activeBoardData) {
      $boardHeader.classList.add('hidden');
      $columnsContainer.classList.add('hidden');
      $emptyState.classList.remove('hidden');
      $emptyState.innerHTML =
        '<div class="empty-state-icon">&#9776;</div>' +
        '<div>' + (connected ? 'Select a board from the sidebar' : 'Not connected to ludos-sync') + '</div>' +
        (!connected ? '<div style="font-size:11px">Check that ludos-sync is running at ' + escapeHtml(LudosApi.getBaseUrl()) + '</div>' : '');
      return;
    }

    $emptyState.classList.add('hidden');
    $boardHeader.classList.remove('hidden');
    $boardHeader.textContent = activeBoardData.title || 'Untitled';
    $columnsContainer.classList.remove('hidden');
    renderColumns();
  }

  function renderColumns() {
    $columnsContainer.innerHTML = '';
    if (!activeBoardData) return;

    for (var i = 0; i < activeBoardData.columns.length; i++) {
      var col = activeBoardData.columns[i];
      var colEl = document.createElement('div');
      colEl.className = 'column';

      // Header
      var header = document.createElement('div');
      header.className = 'column-header';
      header.innerHTML =
        '<span>' + escapeHtml(col.title) + '</span>' +
        '<span class="column-count">' + col.cards.length + '</span>';
      colEl.appendChild(header);

      // Cards
      var cardsEl = document.createElement('div');
      cardsEl.className = 'column-cards';
      for (var j = 0; j < col.cards.length; j++) {
        var card = col.cards[j];
        var cardEl = document.createElement('div');
        cardEl.className = 'card' + (card.checked ? ' checked' : '');
        cardEl.textContent = card.content;
        cardsEl.appendChild(cardEl);
      }
      colEl.appendChild(cardsEl);

      // Footer — add card
      var footer = document.createElement('div');
      footer.className = 'column-footer';

      if (addCardColumn === col.index) {
        footer.innerHTML =
          '<textarea class="add-card-input" placeholder="Card content..." autofocus></textarea>' +
          '<div class="add-card-actions">' +
          '<button class="btn-small btn-primary add-card-submit">Add</button>' +
          '<button class="btn-small btn-cancel add-card-cancel">Cancel</button>' +
          '</div>';

        (function (colIndex) {
          var textarea = footer.querySelector('.add-card-input');
          footer.querySelector('.add-card-submit').addEventListener('click', function () {
            submitCard(colIndex, textarea.value);
          });
          footer.querySelector('.add-card-cancel').addEventListener('click', function () {
            addCardColumn = null;
            renderColumns();
          });
          textarea.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              submitCard(colIndex, textarea.value);
            }
            if (e.key === 'Escape') {
              addCardColumn = null;
              renderColumns();
            }
          });
          // Focus after render
          requestAnimationFrame(function () { textarea.focus(); });
        })(col.index);
      } else {
        var btn = document.createElement('button');
        btn.className = 'add-card-btn';
        btn.textContent = '+ Add card';
        (function (colIndex) {
          btn.addEventListener('click', function () {
            addCardColumn = colIndex;
            renderColumns();
          });
        })(col.index);
        footer.appendChild(btn);
      }

      colEl.appendChild(footer);
      $columnsContainer.appendChild(colEl);
    }
  }

  async function submitCard(colIndex, content) {
    content = content.trim();
    if (!content || !activeBoardId) return;

    try {
      await LudosApi.addCard(activeBoardId, colIndex, content);
      addCardColumn = null;
      await loadBoard(activeBoardId);
    } catch (err) {
      alert('Failed to add card: ' + err.message);
    }
  }

  // --- Search ---

  let searchDebounce = null;

  function onSearchInput() {
    clearTimeout(searchDebounce);
    var q = $searchInput.value.trim();
    if (!q) {
      exitSearchMode();
      return;
    }
    searchDebounce = setTimeout(function () { performSearch(q); }, 300);
  }

  async function performSearch(query) {
    try {
      searchResults = await LudosApi.search(query);
      searchMode = true;
      renderSearchResults();
    } catch {
      // ignore search errors
    }
  }

  function exitSearchMode() {
    searchMode = false;
    searchResults = null;
    $searchResults.classList.add('hidden');
    renderMainView();
  }

  function renderSearchResults() {
    $boardHeader.classList.add('hidden');
    $columnsContainer.classList.add('hidden');
    $emptyState.classList.add('hidden');
    $searchResults.classList.remove('hidden');

    if (!searchResults || !searchResults.results.length) {
      $searchResults.innerHTML =
        '<div class="search-results-title">Search: "' + escapeHtml(searchResults ? searchResults.query : '') + '"</div>' +
        '<div class="empty-state" style="height:auto;padding:40px"><div>No results found</div></div>';
      return;
    }

    // Group by board
    var groups = {};
    for (var i = 0; i < searchResults.results.length; i++) {
      var r = searchResults.results[i];
      var key = r.boardId;
      if (!groups[key]) groups[key] = { title: r.boardTitle, boardId: r.boardId, items: [] };
      groups[key].items.push(r);
    }

    var html = '<div class="search-results-title">Search: "' + escapeHtml(searchResults.query) + '" (' + searchResults.results.length + ' results)</div>';

    var keys = Object.keys(groups);
    for (var g = 0; g < keys.length; g++) {
      var group = groups[keys[g]];
      html += '<div class="search-group">';
      html += '<div class="search-group-title">' + escapeHtml(group.title || 'Untitled') + '</div>';

      for (var j = 0; j < group.items.length; j++) {
        var item = group.items[j];
        html += '<div class="search-result-item" data-board="' + item.boardId + '">';
        html += '<div class="search-result-column">' + escapeHtml(item.columnTitle) + '</div>';
        html += '<div class="search-result-content">' + escapeHtml(item.cardContent) + '</div>';
        html += '</div>';
      }
      html += '</div>';
    }

    $searchResults.innerHTML = html;

    // Click handlers for search results
    var resultItems = $searchResults.querySelectorAll('.search-result-item');
    for (var k = 0; k < resultItems.length; k++) {
      resultItems[k].addEventListener('click', function () {
        var boardId = this.getAttribute('data-board');
        $searchInput.value = '';
        exitSearchMode();
        selectBoard(boardId);
      });
    }
  }

  // --- Settings ---

  function openSettings() {
    $settingsUrl.value = LudosApi.getBaseUrl();
    $settingsDialog.classList.remove('hidden');
    $settingsUrl.focus();
  }

  function closeSettings() {
    $settingsDialog.classList.add('hidden');
  }

  function saveSettings() {
    var url = $settingsUrl.value.trim();
    if (url) {
      LudosApi.setBaseUrl(url);
      closeSettings();
      poll();
    }
  }

  // --- Util ---

  function escapeHtml(str) {
    var d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  // Boot
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return { poll: poll };
})();
