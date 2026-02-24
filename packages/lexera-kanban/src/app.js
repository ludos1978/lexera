/**
 * Lexera Kanban — Board viewer with markdown rendering.
 * Uses LexeraApi from api.js.
 */
const LexeraDashboard = (function () {
  // State
  let boards = [];
  let activeBoardId = null;
  let activeBoardData = null;
  let connected = false;
  let searchMode = false;
  let searchResults = null;
  let pollInterval = null;
  let addCardColumn = null;
  var dragSource = null;

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

    poll();
    pollInterval = setInterval(poll, 5000);
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
      activeBoardData = await LexeraApi.getBoardColumns(boardId);
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
        '<div>' + (connected ? 'Select a board from the sidebar' : 'Waiting for server...') + '</div>';
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
        for (var j = 0; j < col.cards.length; j++) {
          var card = col.cards[j];
          var cardEl = document.createElement('div');
          cardEl.className = 'card' + (card.checked ? ' checked' : '');
          cardEl.innerHTML = renderCardContent(card.content, activeBoardId);
          cardsEl.appendChild(cardEl);
        }
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
          dragSource = { type: 'column-group', index: groupIndex };
          e.dataTransfer.effectAllowed = 'move';
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

      // Unordered list items
      var listMatch = line.match(/^[-*]\s+(.+)/);
      if (listMatch) {
        if (!inList) { html += '<ul>'; inList = true; }
        html += '<li>' + renderInline(listMatch[1], boardId) + '</li>';
        continue;
      }

      // Checkbox list items
      var checkMatch = line.match(/^-\s+\[([ xX])\]\s*(.*)/);
      if (checkMatch) {
        if (!inList) { html += '<ul>'; inList = true; }
        var checked = checkMatch[1] !== ' ';
        var prefix = checked ? '<s>' : '';
        var suffix = checked ? '</s>' : '';
        html += '<li>' + prefix + renderInline(checkMatch[2], boardId) + suffix + '</li>';
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

    // Bold: **text**
    safe = safe.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

    // Italic: *text*
    safe = safe.replace(/\*([^*]+)\*/g, '<em>$1</em>');

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
