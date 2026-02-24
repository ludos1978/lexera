/**
 * Lexera Kanban — Board viewer with markdown rendering.
 * Uses LexeraApi from api.js.
 */
const LexeraDashboard = (function () {
  // State
  let boards = [];
  let activeBoardId = null;
  let activeBoardData = null;
  let fullBoardData = null;
  let connected = false;
  let searchMode = false;
  let searchResults = null;
  let pollInterval = null;
  let addCardColumn = null;
  var dragSource = null;
  var isEditing = false;
  var pendingRefresh = false;
  var eventSource = null;

  // DOM refs
  const $boardList = document.getElementById('board-list');
  const $boardHeader = document.getElementById('board-header');
  const $columnsContainer = document.getElementById('columns-container');
  const $searchResults = document.getElementById('search-results');
  const $emptyState = document.getElementById('empty-state');
  const $searchInput = document.getElementById('search-input');
  const $connectionDot = document.getElementById('connection-dot');

  // --- Column Grouping & Order Helpers ---

  function hasStackTag(title) {
    return /(?:^|\s)#stack(?:\s|$)/.test(title);
  }

  function stripStackTag(title) {
    return title.replace(/\s*#stack\b/g, '').trim();
  }

  function buildColumnGroups(columns) {
    var groups = [];
    for (var i = 0; i < columns.length; i++) {
      if (hasStackTag(columns[i].title) && groups.length > 0) {
        groups[groups.length - 1].columns.push(columns[i]);
      } else {
        groups.push({ columns: [columns[i]] });
      }
    }
    return groups;
  }

  function getOrderedItems(items, storageKey, idFn) {
    var saved = localStorage.getItem(storageKey);
    if (!saved) return items;
    try {
      var order = JSON.parse(saved);
      var map = {};
      for (var i = 0; i < order.length; i++) map[order[i]] = i;
      return items.slice().sort(function (a, b) {
        var ai = map[idFn(a)] !== undefined ? map[idFn(a)] : order.length;
        var bi = map[idFn(b)] !== undefined ? map[idFn(b)] : order.length;
        return ai - bi;
      });
    } catch (e) { return items; }
  }

  function saveOrder(items, storageKey, idFn) {
    localStorage.setItem(storageKey, JSON.stringify(items.map(idFn)));
  }

  function getFoldedColumns(boardId) {
    var saved = localStorage.getItem('lexera-col-fold:' + boardId);
    if (!saved) return [];
    try { return JSON.parse(saved); } catch (e) { return []; }
  }

  function saveFoldState(boardId) {
    var folded = [];
    var cols = $columnsContainer.querySelectorAll('.column[data-col-title]');
    for (var i = 0; i < cols.length; i++) {
      if (cols[i].classList.contains('folded')) {
        folded.push(cols[i].getAttribute('data-col-title'));
      }
    }
    localStorage.setItem('lexera-col-fold:' + boardId, JSON.stringify(folded));
  }

  function reorderItems(items, sourceIdx, targetIdx, insertBefore) {
    var moved = items[sourceIdx];
    var result = [];
    for (var i = 0; i < items.length; i++) {
      if (i === sourceIdx) continue;
      if (i === targetIdx && insertBefore) result.push(moved);
      result.push(items[i]);
      if (i === targetIdx && !insertBefore) result.push(moved);
    }
    return result;
  }

  function reorderColumnGroups(sourceIdx, targetIdx, insertBefore) {
    var columns = getOrderedItems(activeBoardData.columns, 'lexera-col-order:' + activeBoardId, function (c) { return c.title; });
    var groups = buildColumnGroups(columns);
    var newGroups = reorderItems(groups, sourceIdx, targetIdx, insertBefore);
    var newColumns = [];
    for (var i = 0; i < newGroups.length; i++) {
      for (var j = 0; j < newGroups[i].columns.length; j++) {
        newColumns.push(newGroups[i].columns[j]);
      }
    }
    saveOrder(newColumns, 'lexera-col-order:' + activeBoardId, function (c) { return c.title; });
    renderColumns();
  }

  function reorderBoards(sourceIdx, targetIdx, insertBefore) {
    var orderedBoards = getOrderedItems(boards, 'lexera-board-order', function (b) { return b.id; });
    var newOrder = reorderItems(orderedBoards, sourceIdx, targetIdx, insertBefore);
    saveOrder(newOrder, 'lexera-board-order', function (b) { return b.id; });
    renderBoardList();
  }

  function init() {
    $searchInput.addEventListener('input', onSearchInput);
    $searchInput.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        $searchInput.value = '';
        exitSearchMode();
      }
    });

    document.addEventListener('keydown', handleKeyNavigation);

    poll();
    pollInterval = setInterval(poll, 5000);
  }

  // --- Keyboard Navigation ---

  var focusedCardEl = null;

  function handleKeyNavigation(e) {
    if (isEditing || searchMode) return;
    if (document.activeElement && document.activeElement.tagName === 'TEXTAREA') return;
    if (document.activeElement && document.activeElement.tagName === 'INPUT') return;

    var key = e.key;
    if (key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight') {
      e.preventDefault();
      navigateCards(key);
    } else if (key === 'Enter' && focusedCardEl) {
      e.preventDefault();
      var ci = parseInt(focusedCardEl.getAttribute('data-col-index'), 10);
      var cj = parseInt(focusedCardEl.getAttribute('data-card-index'), 10);
      enterCardEditMode(focusedCardEl, ci, cj);
    } else if (key === 'Escape' && focusedCardEl) {
      unfocusCard();
    }
  }

  function navigateCards(key) {
    var allCards = $columnsContainer.querySelectorAll('.card');
    if (allCards.length === 0) return;

    if (!focusedCardEl || !focusedCardEl.isConnected) {
      focusCard(allCards[0]);
      return;
    }

    var ci = parseInt(focusedCardEl.getAttribute('data-col-index'), 10);
    var cj = parseInt(focusedCardEl.getAttribute('data-card-index'), 10);

    if (key === 'ArrowDown') {
      // Next card in same column
      var next = $columnsContainer.querySelector('.card[data-col-index="' + ci + '"][data-card-index="' + (cj + 1) + '"]');
      if (next) focusCard(next);
    } else if (key === 'ArrowUp') {
      // Previous card in same column
      if (cj > 0) {
        var prev = $columnsContainer.querySelector('.card[data-col-index="' + ci + '"][data-card-index="' + (cj - 1) + '"]');
        if (prev) focusCard(prev);
      }
    } else if (key === 'ArrowRight' || key === 'ArrowLeft') {
      // Move to adjacent column, same card position or last card
      var columns = activeBoardData ? activeBoardData.columns : [];
      var colIndices = columns.map(function (c) { return c.index; });
      var curPos = colIndices.indexOf(ci);
      var targetPos = key === 'ArrowRight' ? curPos + 1 : curPos - 1;
      if (targetPos >= 0 && targetPos < colIndices.length) {
        var targetColIdx = colIndices[targetPos];
        var target = $columnsContainer.querySelector('.card[data-col-index="' + targetColIdx + '"][data-card-index="' + cj + '"]');
        if (!target) {
          // Try last card in target column
          var colCards = $columnsContainer.querySelectorAll('.card[data-col-index="' + targetColIdx + '"]');
          if (colCards.length > 0) target = colCards[colCards.length - 1];
        }
        if (target) focusCard(target);
      }
    }
  }

  function focusCard(cardEl) {
    unfocusCard();
    focusedCardEl = cardEl;
    cardEl.classList.add('focused');
    cardEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function unfocusCard() {
    if (focusedCardEl) {
      focusedCardEl.classList.remove('focused');
      focusedCardEl = null;
    }
  }

  function connectSSEIfReady() {
    if (eventSource) return;
    eventSource = LexeraApi.connectSSE(handleSSEEvent);
    if (eventSource) {
      // Reduce polling to 30s health checks while SSE is active
      clearInterval(pollInterval);
      pollInterval = setInterval(poll, 30000);
      eventSource.onerror = function () {
        eventSource.close();
        eventSource = null;
        // Restore normal polling
        clearInterval(pollInterval);
        pollInterval = setInterval(poll, 5000);
      };
    }
  }

  function handleSSEEvent(event) {
    if (!activeBoardId || searchMode) return;
    var kind = event.kind || event.type || '';
    // Check if event is for our active board
    var boardId = event.board_id || event.boardId || '';
    if (boardId && boardId !== activeBoardId) return;
    if (kind === 'MainFileChanged' || kind === 'IncludeFileChanged') {
      if (isEditing) {
        pendingRefresh = true;
      } else {
        loadBoard(activeBoardId);
      }
    }
  }

  // --- Polling ---

  async function poll() {
    try {
      const ok = await LexeraApi.checkStatus();
      setConnected(ok);
      if (!ok) return;
    } catch {
      setConnected(false);
      return;
    }

    connectSSEIfReady();

    try {
      const data = await LexeraApi.getBoards();
      boards = data.boards || [];
      renderBoardList();

      if (activeBoardId && !searchMode) {
        const stillExists = boards.find(b => b.id === activeBoardId);
        if (stillExists) {
          await loadBoard(activeBoardId);
        } else {
          activeBoardId = null;
          activeBoardData = null;
          fullBoardData = null;
          renderMainView();
        }
      }
    } catch {
      // keep previous state
    }
  }

  function setConnected(state) {
    connected = state;
    $connectionDot.classList.toggle('connected', state);
  }

  // --- Board List ---

  function renderBoardList() {
    $boardList.innerHTML = '';
    var orderedBoards = getOrderedItems(boards, 'lexera-board-order', function (b) { return b.id; });
    for (var i = 0; i < orderedBoards.length; i++) {
      var board = orderedBoards[i];
      var totalCards = board.columns.reduce(function (sum, c) { return sum + c.cardCount; }, 0);
      var el = document.createElement('div');
      el.className = 'board-item' + (board.id === activeBoardId ? ' active' : '');
      el.draggable = true;
      el.setAttribute('data-board-index', i.toString());
      var boardName = board.title || board.filePath.split('/').pop().replace('.md', '') || 'Untitled';
      el.innerHTML =
        '<span class="board-item-title">' + escapeHtml(boardName) + '</span>' +
        '<span class="board-item-count">' + totalCards + '</span>';

      (function (boardId, boardIndex) {
        el.addEventListener('click', function () {
          exitSearchMode();
          selectBoard(boardId);
        });

        el.addEventListener('dragstart', function (e) {
          dragSource = { type: 'board', index: boardIndex };
          e.dataTransfer.effectAllowed = 'move';
          this.classList.add('dragging');
        });

        el.addEventListener('dragover', function (e) {
          if (!dragSource || dragSource.type !== 'board') return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          var items = $boardList.querySelectorAll('.board-item');
          for (var j = 0; j < items.length; j++) {
            items[j].classList.remove('drag-over-top', 'drag-over-bottom');
          }
          var rect = this.getBoundingClientRect();
          if (e.clientY < rect.top + rect.height / 2) {
            this.classList.add('drag-over-top');
          } else {
            this.classList.add('drag-over-bottom');
          }
        });

        el.addEventListener('drop', function (e) {
          e.preventDefault();
          if (!dragSource || dragSource.type !== 'board') return;
          var sourceIdx = dragSource.index;
          var targetIdx = boardIndex;
          if (sourceIdx === targetIdx) return;
          var rect = this.getBoundingClientRect();
          var insertBefore = e.clientY < rect.top + rect.height / 2;
          reorderBoards(sourceIdx, targetIdx, insertBefore);
        });

        el.addEventListener('dragend', function () {
          this.classList.remove('dragging');
          var items = $boardList.querySelectorAll('.board-item');
          for (var j = 0; j < items.length; j++) {
            items[j].classList.remove('drag-over-top', 'drag-over-bottom');
          }
          dragSource = null;
        });
      })(board.id, i);

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
      var response = await LexeraApi.getBoardColumns(boardId);
      fullBoardData = response.fullBoard || null;
      activeBoardData = response;
      renderMainView();
    } catch {
      activeBoardData = null;
      fullBoardData = null;
      renderMainView();
    }
  }

  function updateDisplayFromFullBoard() {
    if (!fullBoardData || !activeBoardData) return;
    var columns = fullBoardData.columns
      .map(function (col, index) {
        if (is_archived_or_deleted(col.title)) return null;
        var cards = col.cards.filter(function (c) { return !is_archived_or_deleted(c.content); });
        return { index: index, title: col.title, cards: cards };
      })
      .filter(function (c) { return c !== null; });
    activeBoardData.columns = columns;
  }

  function is_archived_or_deleted(text) {
    return text.indexOf('#hidden-internal-deleted') !== -1 || text.indexOf('#hidden-internal-archived') !== -1;
  }

  function findColumnTitleByIndex(index) {
    if (!fullBoardData) return null;
    if (index >= 0 && index < fullBoardData.columns.length) {
      return fullBoardData.columns[index].title;
    }
    return null;
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
        '<div>' + (connected ? 'Select a board from the sidebar' : 'Waiting for server...') + '</div>';
      return;
    }

    $emptyState.classList.add('hidden');
    $boardHeader.classList.remove('hidden');
    $boardHeader.textContent = activeBoardData.title || 'Untitled';
    $columnsContainer.classList.remove('hidden');
    applyBoardSettings();
    renderColumns();
  }

  function applyBoardSettings() {
    // Reset custom properties
    $columnsContainer.style.removeProperty('--board-column-width');
    $columnsContainer.style.removeProperty('--board-font-size');
    $columnsContainer.style.removeProperty('--board-color');
    if (!fullBoardData || !fullBoardData.boardSettings) return;
    var s = fullBoardData.boardSettings;
    if (s.columnWidth) $columnsContainer.style.setProperty('--board-column-width', s.columnWidth);
    if (s.fontSize) $columnsContainer.style.setProperty('--board-font-size', s.fontSize);
    if (s.boardColor) $columnsContainer.style.setProperty('--board-color', s.boardColor);
  }

  function renderColumns() {
    unfocusCard();
    $columnsContainer.innerHTML = '';
    if (!activeBoardData) return;

    var columns = getOrderedItems(activeBoardData.columns, 'lexera-col-order:' + activeBoardId, function (c) { return c.title; });
    var groups = buildColumnGroups(columns);

    for (var g = 0; g < groups.length; g++) {
      var group = groups[g];
      var groupEl = document.createElement('div');
      groupEl.className = 'column-group';
      groupEl.draggable = true;
      groupEl.setAttribute('data-group-index', g.toString());

      var foldedCols = getFoldedColumns(activeBoardId);

      for (var c = 0; c < group.columns.length; c++) {
        var col = group.columns[c];
        var displayTitle = stripStackTag(col.title);

        var colEl = document.createElement('div');
        colEl.className = 'column';
        colEl.setAttribute('data-col-title', col.title);
        if (foldedCols.indexOf(col.title) !== -1) {
          colEl.classList.add('folded');
        }

        var header = document.createElement('div');
        header.className = 'column-header';
        header.innerHTML =
          '<span>' + escapeHtml(displayTitle) + '</span>' +
          '<span class="column-count">' + col.cards.length + '</span>';
        (function (columnEl) {
          header.addEventListener('click', function (e) {
            e.stopPropagation();
            columnEl.classList.toggle('folded');
            saveFoldState(activeBoardId);
          });
        })(colEl);
        colEl.appendChild(header);

        var cardsEl = document.createElement('div');
        cardsEl.className = 'column-cards';
        cardsEl.setAttribute('data-col-index', col.index.toString());
        var collapsedCards = getCollapsedCards(activeBoardId);
        for (var j = 0; j < col.cards.length; j++) {
          var card = col.cards[j];
          var cardEl = document.createElement('div');
          cardEl.className = 'card' + (card.checked ? ' checked' : '');
          cardEl.draggable = true;
          cardEl.setAttribute('data-col-index', col.index.toString());
          cardEl.setAttribute('data-card-index', j.toString());
          cardEl.setAttribute('data-card-id', card.id);
          var firstTag = getFirstTag(card.content);
          if (firstTag) cardEl.style.borderLeftColor = getTagColor(firstTag);
          if (collapsedCards.indexOf(card.id) !== -1) cardEl.classList.add('collapsed');
          var toggle = document.createElement('span');
          toggle.className = 'card-collapse-toggle';
          toggle.textContent = cardEl.classList.contains('collapsed') ? '\u25B8' : '\u25BE';
          (function (toggleEl, el) {
            toggleEl.addEventListener('click', function (e) {
              e.stopPropagation();
              el.classList.toggle('collapsed');
              toggleEl.textContent = el.classList.contains('collapsed') ? '\u25B8' : '\u25BE';
              saveCardCollapseState(activeBoardId);
            });
          })(toggle, cardEl);
          cardEl.innerHTML = renderCardContent(card.content, activeBoardId);
          cardEl.insertBefore(toggle, cardEl.firstChild);
          (function (el, ci, cj) {
            el.addEventListener('dblclick', function (e) {
              if (e.target.classList.contains('card-checkbox')) return;
              e.preventDefault();
              e.stopPropagation();
              enterCardEditMode(el, ci, cj);
            });
            el.addEventListener('contextmenu', function (e) {
              e.preventDefault();
              e.stopPropagation();
              showCardContextMenu(e.clientX, e.clientY, ci, cj);
            });
            el.addEventListener('change', function (e) {
              if (!e.target.classList.contains('card-checkbox')) return;
              e.stopPropagation();
              toggleCheckbox(ci, cj, parseInt(e.target.getAttribute('data-line'), 10), e.target.checked);
            });
          })(cardEl, col.index, j);
          cardsEl.appendChild(cardEl);
        }
        setupCardDnD(cardsEl, col.index);
        colEl.appendChild(cardsEl);

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
        groupEl.appendChild(colEl);
      }

      // Column group DnD handlers
      (function (groupIndex) {
        groupEl.addEventListener('dragstart', function (e) {
          if (e.target.closest('.card')) return;
          dragSource = { type: 'column-group', index: groupIndex };
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', '');
          this.classList.add('dragging');
        });

        groupEl.addEventListener('dragover', function (e) {
          if (!dragSource || dragSource.type !== 'column-group') return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          var allGroups = $columnsContainer.querySelectorAll('.column-group');
          for (var k = 0; k < allGroups.length; k++) {
            allGroups[k].classList.remove('drag-over-left', 'drag-over-right');
          }
          var rect = this.getBoundingClientRect();
          if (e.clientX < rect.left + rect.width / 2) {
            this.classList.add('drag-over-left');
          } else {
            this.classList.add('drag-over-right');
          }
        });

        groupEl.addEventListener('drop', function (e) {
          e.preventDefault();
          if (!dragSource || dragSource.type !== 'column-group') return;
          var sourceIdx = dragSource.index;
          var targetIdx = groupIndex;
          if (sourceIdx === targetIdx) return;
          var rect = this.getBoundingClientRect();
          var insertBefore = e.clientX < rect.left + rect.width / 2;
          reorderColumnGroups(sourceIdx, targetIdx, insertBefore);
        });

        groupEl.addEventListener('dragend', function () {
          this.classList.remove('dragging');
          var allGroups = $columnsContainer.querySelectorAll('.column-group');
          for (var k = 0; k < allGroups.length; k++) {
            allGroups[k].classList.remove('drag-over-left', 'drag-over-right');
          }
          dragSource = null;
        });
      })(g);

      $columnsContainer.appendChild(groupEl);
    }
  }

  async function submitCard(colIndex, content) {
    content = content.trim();
    if (!content || !activeBoardId) return;

    try {
      await LexeraApi.addCard(activeBoardId, colIndex, content);
      addCardColumn = null;
      await loadBoard(activeBoardId);
    } catch (err) {
      alert('Failed to add card: ' + err.message);
    }
  }

  // --- Card DnD ---

  function setupCardDnD(cardsEl, colIndex) {
    cardsEl.addEventListener('dragstart', function (e) {
      var cardEl = e.target.closest('.card');
      if (!cardEl) return;
      e.stopPropagation();
      dragSource = {
        type: 'card',
        colIndex: parseInt(cardEl.getAttribute('data-col-index'), 10),
        cardIndex: parseInt(cardEl.getAttribute('data-card-index'), 10),
      };
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', cardEl.getAttribute('data-card-id') || '');
      cardEl.classList.add('dragging');
    }, true);

    cardsEl.addEventListener('dragover', function (e) {
      if (!dragSource || dragSource.type !== 'card') return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      clearCardDropIndicators();
      var insertIdx = findCardInsertIndex(e, cardsEl);
      showCardDropIndicator(cardsEl, insertIdx);
    });

    cardsEl.addEventListener('dragleave', function (e) {
      if (!dragSource || dragSource.type !== 'card') return;
      if (!cardsEl.contains(e.relatedTarget)) {
        clearCardDropIndicators();
      }
    });

    cardsEl.addEventListener('drop', function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (!dragSource || dragSource.type !== 'card') return;
      clearCardDropIndicators();
      var targetColIndex = parseInt(cardsEl.getAttribute('data-col-index'), 10);
      var insertIdx = findCardInsertIndex(e, cardsEl);
      moveCard(dragSource.colIndex, dragSource.cardIndex, targetColIndex, insertIdx);
      dragSource = null;
    });

    cardsEl.addEventListener('dragend', function () {
      clearCardDropIndicators();
      var draggingEl = cardsEl.querySelector('.card.dragging');
      if (draggingEl) draggingEl.classList.remove('dragging');
      dragSource = null;
    });
  }

  function findCardInsertIndex(e, cardsEl) {
    var cards = cardsEl.querySelectorAll('.card:not(.dragging)');
    for (var i = 0; i < cards.length; i++) {
      var rect = cards[i].getBoundingClientRect();
      if (e.clientY < rect.top + rect.height / 2) {
        return i;
      }
    }
    return cards.length;
  }

  function showCardDropIndicator(cardsEl, insertIdx) {
    var indicator = document.createElement('div');
    indicator.className = 'card-drop-indicator';
    var cards = cardsEl.querySelectorAll('.card:not(.dragging)');
    if (insertIdx < cards.length) {
      cardsEl.insertBefore(indicator, cards[insertIdx]);
    } else {
      cardsEl.appendChild(indicator);
    }
  }

  function clearCardDropIndicators() {
    var indicators = document.querySelectorAll('.card-drop-indicator');
    for (var i = 0; i < indicators.length; i++) {
      indicators[i].remove();
    }
  }

  async function moveCard(fromColIdx, fromCardIdx, toColIdx, toInsertIdx) {
    if (!fullBoardData || !activeBoardId) return;
    var fromCol = fullBoardData.columns[fromColIdx];
    var toCol = fullBoardData.columns[toColIdx];
    if (!fromCol || !toCol) return;

    // Get the visible (non-archived) cards to find the real index in fullBoardData
    var fromFullIdx = getFullCardIndex(fromCol, fromCardIdx);
    if (fromFullIdx === -1) return;

    var card = fromCol.cards.splice(fromFullIdx, 1)[0];

    // Calculate target index in the full cards array (-1 means append)
    var toFullIdx = getFullCardIndex(toCol, toInsertIdx);
    if (toFullIdx === -1) toFullIdx = toCol.cards.length;

    toCol.cards.splice(toFullIdx, 0, card);

    try {
      await LexeraApi.saveBoard(activeBoardId, fullBoardData);
      updateDisplayFromFullBoard();
      renderColumns();
    } catch (err) {
      // Reload to restore consistent state
      await loadBoard(activeBoardId);
    }
  }

  function getFullCardIndex(col, visibleIdx) {
    var visible = 0;
    for (var i = 0; i < col.cards.length; i++) {
      if (!is_archived_or_deleted(col.cards[i].content)) {
        if (visible === visibleIdx) return i;
        visible++;
      }
    }
    return -1;
  }

  // --- Card Editing ---

  function enterCardEditMode(cardEl, colIndex, cardIndex) {
    if (!fullBoardData) return;
    var col = fullBoardData.columns[colIndex];
    if (!col) return;
    var fullIdx = getFullCardIndex(col, cardIndex);
    var card = col.cards[fullIdx];
    if (!card) return;

    isEditing = true;
    var editCancelled = false;
    cardEl.classList.add('editing');
    var textarea = document.createElement('textarea');
    textarea.className = 'card-edit-input';
    textarea.value = card.content;
    cardEl.innerHTML = '';
    cardEl.appendChild(textarea);

    function autoResize() {
      textarea.style.height = 'auto';
      textarea.style.height = textarea.scrollHeight + 'px';
    }
    textarea.addEventListener('input', autoResize);
    requestAnimationFrame(function () {
      textarea.focus();
      autoResize();
    });

    textarea.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        textarea.blur();
      }
      if (e.key === 'Escape') {
        editCancelled = true;
        isEditing = false;
        cardEl.classList.remove('editing');
        cardEl.innerHTML = renderCardContent(card.content, activeBoardId);
        if (pendingRefresh) {
          pendingRefresh = false;
          loadBoard(activeBoardId);
        }
      }
    });

    textarea.addEventListener('blur', function () {
      if (editCancelled) return;
      saveCardEdit(cardEl, colIndex, fullIdx, textarea.value);
    });
  }

  async function saveCardEdit(cardEl, colIndex, fullCardIdx, newContent) {
    isEditing = false;
    if (!fullBoardData || !activeBoardId) return;
    var col = fullBoardData.columns[colIndex];
    if (!col || !col.cards[fullCardIdx]) return;

    var oldContent = col.cards[fullCardIdx].content;
    if (newContent === oldContent) {
      cardEl.classList.remove('editing');
      cardEl.innerHTML = renderCardContent(oldContent, activeBoardId);
      if (pendingRefresh) {
        pendingRefresh = false;
        loadBoard(activeBoardId);
      }
      return;
    }

    col.cards[fullCardIdx].content = newContent;
    try {
      await LexeraApi.saveBoard(activeBoardId, fullBoardData);
      updateDisplayFromFullBoard();
      renderColumns();
    } catch (err) {
      await loadBoard(activeBoardId);
    }
    if (pendingRefresh) {
      pendingRefresh = false;
      loadBoard(activeBoardId);
    }
  }

  // --- Checkbox Toggle ---

  async function toggleCheckbox(colIndex, cardIndex, lineIndex, checked) {
    if (!fullBoardData || !activeBoardId) return;
    var col = fullBoardData.columns[colIndex];
    if (!col) return;
    var fullIdx = getFullCardIndex(col, cardIndex);
    if (fullIdx === -1) return;
    var card = col.cards[fullIdx];
    if (!card) return;

    var lines = card.content.split('\n');
    if (lineIndex < 0 || lineIndex >= lines.length) return;
    if (checked) {
      lines[lineIndex] = lines[lineIndex].replace(/\[([ ])\]/, '[x]');
    } else {
      lines[lineIndex] = lines[lineIndex].replace(/\[([xX])\]/, '[ ]');
    }
    card.content = lines.join('\n');

    try {
      await LexeraApi.saveBoard(activeBoardId, fullBoardData);
      updateDisplayFromFullBoard();
      renderColumns();
    } catch (err) {
      await loadBoard(activeBoardId);
    }
  }

  // --- Card Context Menu ---

  var activeCardMenu = null;

  function closeCardContextMenu() {
    if (activeCardMenu) {
      activeCardMenu.remove();
      activeCardMenu = null;
    }
  }

  function showCardContextMenu(x, y, colIndex, cardIndex) {
    closeCardContextMenu();
    var menu = document.createElement('div');
    menu.className = 'card-context-menu';
    menu.innerHTML =
      '<div class="card-menu-item" data-card-action="edit">Edit</div>' +
      '<div class="card-menu-item" data-card-action="duplicate">Duplicate</div>' +
      '<div class="card-menu-divider"></div>' +
      '<div class="card-menu-item" data-card-action="archive">Archive</div>' +
      '<div class="card-menu-item" data-card-action="park">Park</div>' +
      '<div class="card-menu-item card-menu-danger" data-card-action="delete">Delete</div>';

    // Viewport bounds checking
    document.body.appendChild(menu);
    var menuRect = menu.getBoundingClientRect();
    if (x + menuRect.width > window.innerWidth) x = window.innerWidth - menuRect.width - 4;
    if (y + menuRect.height > window.innerHeight) y = window.innerHeight - menuRect.height - 4;
    if (x < 0) x = 4;
    if (y < 0) y = 4;
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';

    menu.addEventListener('click', function (e) {
      var actionEl = e.target.closest('[data-card-action]');
      if (!actionEl) return;
      var action = actionEl.getAttribute('data-card-action');
      closeCardContextMenu();
      handleCardMenuAction(action, colIndex, cardIndex);
    });

    activeCardMenu = menu;
  }

  function handleCardMenuAction(action, colIndex, cardIndex) {
    if (action === 'edit') {
      var cardsEls = $columnsContainer.querySelectorAll('.card[data-col-index="' + colIndex + '"][data-card-index="' + cardIndex + '"]');
      if (cardsEls.length > 0) {
        enterCardEditMode(cardsEls[0], colIndex, cardIndex);
      }
    } else if (action === 'duplicate') {
      duplicateCard(colIndex, cardIndex);
    } else if (action === 'archive') {
      tagCard(colIndex, cardIndex, '#hidden-internal-archived');
    } else if (action === 'park') {
      tagCard(colIndex, cardIndex, '#hidden-internal-parked');
    } else if (action === 'delete') {
      deleteCard(colIndex, cardIndex);
    }
  }

  async function duplicateCard(colIndex, cardIndex) {
    if (!fullBoardData || !activeBoardId) return;
    var col = fullBoardData.columns[colIndex];
    if (!col) return;
    var fullIdx = getFullCardIndex(col, cardIndex);
    var card = col.cards[fullIdx];
    if (!card) return;

    var clone = JSON.parse(JSON.stringify(card));
    clone.id = 'dup-' + Date.now();
    clone.kid = null;
    col.cards.splice(fullIdx + 1, 0, clone);

    try {
      await LexeraApi.saveBoard(activeBoardId, fullBoardData);
      updateDisplayFromFullBoard();
      renderColumns();
    } catch (err) {
      await loadBoard(activeBoardId);
    }
  }

  async function tagCard(colIndex, cardIndex, tag) {
    if (!fullBoardData || !activeBoardId) return;
    var col = fullBoardData.columns[colIndex];
    if (!col) return;
    var fullIdx = getFullCardIndex(col, cardIndex);
    if (fullIdx === -1) return;
    var card = col.cards[fullIdx];
    if (!card) return;

    // Append tag to first line of content
    var lines = card.content.split('\n');
    lines[0] = lines[0] + ' ' + tag;
    card.content = lines.join('\n');

    try {
      await LexeraApi.saveBoard(activeBoardId, fullBoardData);
      updateDisplayFromFullBoard();
      renderColumns();
    } catch (err) {
      await loadBoard(activeBoardId);
    }
  }

  async function deleteCard(colIndex, cardIndex) {
    if (!fullBoardData || !activeBoardId) return;
    var col = fullBoardData.columns[colIndex];
    if (!col) return;
    var fullIdx = getFullCardIndex(col, cardIndex);
    if (fullIdx < 0 || fullIdx >= col.cards.length) return;

    col.cards.splice(fullIdx, 1);

    try {
      await LexeraApi.saveBoard(activeBoardId, fullBoardData);
      updateDisplayFromFullBoard();
      renderColumns();
    } catch (err) {
      await loadBoard(activeBoardId);
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
      searchResults = await LexeraApi.search(query);
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

  // --- Embed Menu ---

  var activeEmbedMenu = null;

  function closeEmbedMenu() {
    if (activeEmbedMenu) {
      activeEmbedMenu.remove();
      activeEmbedMenu = null;
    }
  }

  document.addEventListener('click', function (e) {
    // Close card context menu on any click (capture phase handles embed menu)
    closeCardContextMenu();

    // Handle burger menu button clicks
    if (e.target.classList.contains('embed-menu-btn')) {
      e.stopPropagation();
      var container = e.target.closest('.embed-container');
      if (!container) return;
      if (activeEmbedMenu && activeEmbedMenu.parentElement === container) {
        closeEmbedMenu();
        return;
      }
      closeEmbedMenu();
      showEmbedMenu(container, e.target);
      return;
    }

    // Handle menu action clicks
    var actionEl = e.target.closest('[data-action]');
    if (actionEl && activeEmbedMenu && activeEmbedMenu.contains(actionEl)) {
      e.stopPropagation();
      var action = actionEl.getAttribute('data-action');
      var container = activeEmbedMenu.closest('.embed-container');
      handleEmbedAction(action, container);
      return;
    }

    // Click outside closes menu
    if (activeEmbedMenu && !activeEmbedMenu.contains(e.target)) {
      closeEmbedMenu();
    }
  }, true);

  var hasTauri = typeof window.__TAURI__ !== 'undefined';

  function showEmbedMenu(container, btn) {
    var filePath = container.getAttribute('data-file-path');
    var boardId = container.getAttribute('data-board-id');
    var isAbsolute = filePath && filePath.charAt(0) === '/';
    var menu = document.createElement('div');
    menu.className = 'embed-menu';
    menu.innerHTML =
      '<div class="embed-menu-item" data-action="refresh">Force Refresh</div>' +
      '<div class="embed-menu-item" data-action="info">Info</div>' +
      '<div class="embed-menu-divider"></div>' +
      '<div class="embed-menu-item" data-action="open-system">Open in System App</div>' +
      '<div class="embed-menu-item" data-action="path-fix">Path Fix</div>' +
      '<div class="embed-menu-item" data-action="convert-path">' + (isAbsolute ? 'Convert to Relative' : 'Convert to Absolute') + '</div>' +
      '<div class="embed-menu-divider"></div>' +
      '<div class="embed-menu-item embed-menu-danger" data-action="delete">Delete Embed</div>';
    container.appendChild(menu);
    activeEmbedMenu = menu;
  }

  function handleEmbedAction(action, container) {
    if (!container) { closeEmbedMenu(); return; }
    var filePath = container.getAttribute('data-file-path');
    var boardId = container.getAttribute('data-board-id');

    if (action === 'refresh') {
      var media = container.querySelector('img, video, audio');
      if (media) {
        var src = media.getAttribute('src').split('?')[0];
        media.setAttribute('src', src + '?t=' + Date.now());
      }
      container.classList.remove('embed-broken');
      closeEmbedMenu();

    } else if (action === 'info') {
      closeEmbedMenu();
      if (!boardId || !filePath) return;
      LexeraApi.fileInfo(boardId, filePath).then(function (info) {
        var infoMenu = document.createElement('div');
        infoMenu.className = 'embed-menu embed-info-panel';
        var sizeStr = info.size ? formatFileSize(info.size) : 'unknown';
        var dateStr = info.lastModified ? new Date(info.lastModified * 1000).toLocaleString() : 'unknown';
        infoMenu.innerHTML =
          '<div class="embed-info-title">File Info</div>' +
          '<div class="embed-info-row"><span>Name:</span> ' + escapeHtml(info.filename || '') + '</div>' +
          '<div class="embed-info-row"><span>Path:</span> ' + escapeHtml(info.path || '') + '</div>' +
          '<div class="embed-info-row"><span>Exists:</span> ' + (info.exists ? 'Yes' : 'No') + '</div>' +
          (info.exists ? (
            '<div class="embed-info-row"><span>Size:</span> ' + sizeStr + '</div>' +
            '<div class="embed-info-row"><span>Type:</span> ' + escapeHtml(info.mediaCategory || '') + '</div>' +
            '<div class="embed-info-row"><span>Modified:</span> ' + dateStr + '</div>'
          ) : '') +
          '<div class="embed-menu-item" data-action="close-info" style="margin-top:6px;text-align:center">Close</div>';
        container.appendChild(infoMenu);
        activeEmbedMenu = infoMenu;
      }).catch(function () { /* silently fail */ });

    } else if (action === 'close-info') {
      closeEmbedMenu();

    } else if (action === 'open-system') {
      closeEmbedMenu();
      if (!filePath) return;
      // Resolve to absolute path first if relative
      if (filePath.charAt(0) !== '/' && boardId) {
        LexeraApi.request('/boards/' + boardId + '/convert-path', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cardId: '', path: filePath, to: 'absolute' }),
        }).then(function (res) {
          openInSystem(res.path);
        }).catch(function () {
          openInSystem(filePath);
        });
      } else {
        openInSystem(filePath);
      }

    } else if (action === 'path-fix') {
      closeEmbedMenu();
      if (!boardId || !filePath) return;
      var filename = filePath.split('/').pop();
      LexeraApi.request('/boards/' + boardId + '/find-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: filename }),
      }).then(function (res) {
        if (!res.matches || res.matches.length === 0) {
          showPathFixResults(container, []);
          return;
        }
        showPathFixResults(container, res.matches);
      }).catch(function () { /* silently fail */ });

    } else if (action === 'convert-path') {
      closeEmbedMenu();
      if (!boardId || !filePath) return;
      var isAbsolute = filePath.charAt(0) === '/';
      LexeraApi.request('/boards/' + boardId + '/convert-path', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cardId: '', path: filePath, to: isAbsolute ? 'relative' : 'absolute' }),
      }).then(function (res) {
        if (res.changed) {
          container.setAttribute('data-file-path', res.path);
          var media = container.querySelector('img, video, audio');
          if (media) {
            var newSrc = LexeraApi.fileUrl(boardId, res.path);
            media.setAttribute('src', newSrc);
          }
        }
      }).catch(function () { /* silently fail */ });

    } else if (action === 'delete') {
      closeEmbedMenu();
      container.remove();

    } else if (action && action.indexOf('pick-path:') === 0) {
      var newPath = action.substring(10);
      closeEmbedMenu();
      container.setAttribute('data-file-path', newPath);
      var media = container.querySelector('img, video, audio');
      if (media && boardId) {
        var newSrc = LexeraApi.fileUrl(boardId, newPath);
        media.setAttribute('src', newSrc);
      }
      container.classList.remove('embed-broken');
    }
  }

  function openInSystem(path) {
    if (hasTauri && window.__TAURI__ && window.__TAURI__.core) {
      window.__TAURI__.core.invoke('open_in_system', { path: path }).catch(function (e) {
        console.error('open_in_system failed:', e);
      });
    } else {
      window.open('file://' + path, '_blank');
    }
  }

  function showPathFixResults(container, matches) {
    var menu = document.createElement('div');
    menu.className = 'embed-menu embed-info-panel';
    if (matches.length === 0) {
      menu.innerHTML =
        '<div class="embed-info-title">Path Fix</div>' +
        '<div class="embed-info-row">No matching files found</div>' +
        '<div class="embed-menu-item" data-action="close-info" style="margin-top:6px;text-align:center">Close</div>';
    } else {
      var html = '<div class="embed-info-title">Found ' + matches.length + ' match(es)</div>';
      for (var i = 0; i < matches.length; i++) {
        var short = matches[i].split('/').slice(-3).join('/');
        html += '<div class="embed-menu-item" data-action="pick-path:' + escapeHtml(matches[i]) + '" title="' + escapeHtml(matches[i]) + '">' + escapeHtml(short) + '</div>';
      }
      html += '<div class="embed-menu-divider"></div>';
      html += '<div class="embed-menu-item" data-action="close-info" style="text-align:center">Cancel</div>';
      menu.innerHTML = html;
    }
    container.appendChild(menu);
    activeEmbedMenu = menu;
  }

  function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  // --- Media Category ---

  function getMediaCategory(ext) {
    if (!ext) return 'unknown';
    ext = ext.toLowerCase();
    var cats = {
      image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'tiff', 'tif'],
      video: ['mp4', 'webm', 'mov', 'avi', 'mkv'],
      audio: ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a'],
      document: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'md', 'csv', 'json'],
    };
    for (var cat in cats) {
      if (cats[cat].indexOf(ext) !== -1) return cat;
    }
    return 'unknown';
  }

  function getFileExtension(path) {
    var dot = path.lastIndexOf('.');
    if (dot === -1 || dot === path.length - 1) return '';
    return path.substring(dot + 1).toLowerCase();
  }

  // --- Card Collapse ---

  function getCollapsedCards(boardId) {
    var saved = localStorage.getItem('lexera-card-collapse:' + boardId);
    if (!saved) return [];
    try { return JSON.parse(saved); } catch (e) { return []; }
  }

  function saveCardCollapseState(boardId) {
    var collapsed = [];
    var cards = $columnsContainer.querySelectorAll('.card[data-card-id]');
    for (var i = 0; i < cards.length; i++) {
      if (cards[i].classList.contains('collapsed')) {
        collapsed.push(cards[i].getAttribute('data-card-id'));
      }
    }
    localStorage.setItem('lexera-card-collapse:' + boardId, JSON.stringify(collapsed));
  }

  // --- Tag Colors ---

  var TAG_COLORS = {
    '#comment': '#d4883c',
    '#note': '#c9b84e',
    '#urgent': '#e05252',
    '#feature': '#4ec98a',
    '#bug': '#e05252',
    '#todo': '#5c9cd4',
    '#done': '#4ec9b0',
    '#blocked': '#c94e7c',
    '#question': '#9b7ed4',
    '#idea': '#d4c24e',
    '#review': '#5cc9c9',
    '#wip': '#d49b4e',
  };

  var TAG_PALETTE = [
    '#d4883c', '#5c9cd4', '#4ec98a', '#c94e7c',
    '#9b7ed4', '#c9b84e', '#5cc9c9', '#d49b4e',
    '#7ed47e', '#d45c8c', '#4ec9b0', '#d4644e',
  ];

  function getTagColor(tagName) {
    var lower = tagName.toLowerCase();
    if (TAG_COLORS[lower]) return TAG_COLORS[lower];
    var hash = 0;
    for (var i = 0; i < lower.length; i++) {
      hash = ((hash << 5) - hash) + lower.charCodeAt(i);
      hash = hash & hash;
    }
    return TAG_PALETTE[Math.abs(hash) % TAG_PALETTE.length];
  }

  function getFirstTag(content) {
    var lines = content.split('\n');
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].trim() === '') break; // end of card header
      var match = lines[i].match(/(^|\s)(#[a-zA-Z][\w-]*)/);
      if (match) return match[2];
    }
    return null;
  }

  // --- Util ---

  function renderCardContent(content, boardId) {
    var lines = content.split('\n');
    var html = '';
    var inList = false;

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];

      // Empty line: close list if open, add line break
      if (line.trim() === '') {
        if (inList) { html += '</ul>'; inList = false; }
        html += '<br>';
        continue;
      }

      // Headings
      var headingMatch = line.match(/^(#{1,3})\s+(.+)/);
      if (headingMatch) {
        if (inList) { html += '</ul>'; inList = false; }
        var level = headingMatch[1].length;
        html += '<h' + level + '>' + renderInline(headingMatch[2], boardId) + '</h' + level + '>';
        continue;
      }

      // Checkbox list items (must be checked BEFORE unordered list)
      var checkMatch = line.match(/^-\s+\[([ xX])\]\s*(.*)/);
      if (checkMatch) {
        if (!inList) { html += '<ul>'; inList = true; }
        var checked = checkMatch[1] !== ' ';
        var checkedAttr = checked ? ' checked' : '';
        var strikePre = checked ? '<s>' : '';
        var strikePost = checked ? '</s>' : '';
        html += '<li class="checkbox-item"><input type="checkbox" class="card-checkbox" data-line="' + i + '"' + checkedAttr + '> ' + strikePre + renderInline(checkMatch[2], boardId) + strikePost + '</li>';
        continue;
      }

      // Unordered list items
      var listMatch = line.match(/^[-*]\s+(.+)/);
      if (listMatch) {
        if (!inList) { html += '<ul>'; inList = true; }
        html += '<li>' + renderInline(listMatch[1], boardId) + '</li>';
        continue;
      }

      // Regular line
      if (inList) { html += '</ul>'; inList = false; }
      html += '<div>' + renderInline(line, boardId) + '</div>';
    }

    if (inList) html += '</ul>';
    return html;
  }

  function renderInline(text, boardId) {
    var safe = escapeHtml(text);

    // Embeds: ![alt](path "optional title") — wrap in embed container with media category detection
    safe = safe.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, function (_, alt, rawSrc) {
      // Strip optional title: path "title" or path &quot;title&quot;
      var src = rawSrc.replace(/\s+(&quot;|")[^"]*(&quot;|")$/, '').trim();
      var ext = getFileExtension(src);
      var category = getMediaCategory(ext);
      var isExternal = src.indexOf('http') === 0 || src.indexOf('data:') === 0;
      var filePath = src;

      // Relative paths go through the API file endpoint
      if (!isExternal && boardId) {
        src = LexeraApi.fileUrl(boardId, rawSrc);
      }

      var inner = '';
      if (category === 'image') {
        inner = '<img src="' + src + '" alt="' + alt + '" loading="lazy" onerror="this.parentElement.classList.add(\'embed-broken\')">';
      } else if (category === 'video') {
        inner = '<video controls preload="metadata" src="' + src + '" onerror="this.parentElement.classList.add(\'embed-broken\')"></video>';
      } else if (category === 'audio') {
        inner = '<audio controls preload="metadata" src="' + src + '" onerror="this.parentElement.classList.add(\'embed-broken\')"></audio>';
      } else if (category === 'document') {
        var filename = rawSrc.split('/').pop();
        inner = '<span class="embed-file-link">&#128196; ' + escapeHtml(filename) + '</span>';
      } else {
        var filename = rawSrc.split('/').pop();
        inner = '<span class="embed-file-link">&#128206; ' + escapeHtml(filename) + '</span>';
      }

      return '<span class="embed-container" data-file-path="' + escapeHtml(filePath) + '" data-board-id="' + (boardId || '') + '" data-media-type="' + category + '">' +
        inner +
        '<button class="embed-menu-btn" title="Embed actions">&#8942;</button>' +
        '</span>';
    });

    // Links: [text](url)
    safe = safe.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');

    // Wiki links: [[text]]
    safe = safe.replace(/\[\[([^\]]+)\]\]/g, '<span class="wiki-link">$1</span>');

    // Bold: **text**
    safe = safe.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

    // Italic: *text*
    safe = safe.replace(/\*([^*]+)\*/g, '<em>$1</em>');

    // Strikethrough: ~~text~~
    safe = safe.replace(/~~([^~]+)~~/g, '<s>$1</s>');

    // Inline code: `code`
    safe = safe.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Tags: #tag-name (word boundary, not inside HTML attributes)
    safe = safe.replace(/(^|\s)(#[a-zA-Z][\w-]*)/g, '$1<span class="tag">$2</span>');

    return safe;
  }

  function escapeHtml(str) {
    var d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return { poll: poll };
})();
