    const { invoke } = window.__TAURI__.core;

    // ─── State ───
    let boards = [];
    let currentCaptureType = 'text';
    let currentBoardId = null;
    let searchDebounce = null;
    let editingCardColIndex = null;
    let editingCardIndex = null;
    let currentBoard = null;

    // ─── Toast ───
    function showToast(msg, isError) {
      const el = document.getElementById('toast');
      el.textContent = msg;
      el.className = 'toast' + (isError ? ' error' : '');
      el.classList.add('show');
      setTimeout(() => el.classList.remove('show'), 2500);
    }

    // ─── Tab navigation ───
    document.querySelectorAll('.tab-bar button').forEach(btn => {
      btn.addEventListener('click', () => {
        const page = btn.dataset.page;
        document.querySelectorAll('.tab-bar button').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('page-' + page).classList.add('active');

        // Close board detail when navigating away
        if (page !== 'boards') closeBoardDetail();

        // Refresh data on tab switch
        if (page === 'capture') loadBoards();
        if (page === 'boards') { closeBoardDetail(); loadBoardsList(); }
      });
    });

    // ─── Capture type toggle ───
    document.querySelectorAll('.capture-type-toggle button').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.capture-type-toggle button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentCaptureType = btn.dataset.type;
        document.getElementById('capture-text-fields').style.display = currentCaptureType === 'text' ? 'block' : 'none';
        document.getElementById('capture-url-fields').style.display = currentCaptureType === 'url' ? 'block' : 'none';
        updateCaptureButton();
      });
    });

    // ─── Load boards into dropdowns ───
    async function loadBoards() {
      try {
        boards = await invoke('list_boards');
        const sel = document.getElementById('capture-board');
        const prev = sel.value;
        sel.innerHTML = '';
        boards.forEach(b => {
          const opt = document.createElement('option');
          opt.value = b.id;
          opt.textContent = b.title || b.id;
          sel.appendChild(opt);
        });
        // Restore previous selection or pick inbox
        if (prev && boards.some(b => b.id === prev)) {
          sel.value = prev;
        }
        updateColumns();
      } catch (e) {
        console.error('loadBoards:', e);
      }
    }

    function updateColumns() {
      const boardId = document.getElementById('capture-board').value;
      const board = boards.find(b => b.id === boardId);
      const sel = document.getElementById('capture-column');
      sel.innerHTML = '';
      if (board && board.columns) {
        board.columns.forEach(col => {
          const opt = document.createElement('option');
          opt.value = col.index;
          opt.textContent = col.title + ' (' + col.cardCount + ')';
          sel.appendChild(opt);
        });
      }
    }

    document.getElementById('capture-board').addEventListener('change', updateColumns);

    // ─── Capture button state ───
    function updateCaptureButton() {
      const btn = document.getElementById('btn-capture');
      if (currentCaptureType === 'text') {
        btn.disabled = !document.getElementById('capture-content').value.trim();
      } else {
        btn.disabled = !document.getElementById('capture-url').value.trim();
      }
    }
    document.getElementById('capture-content').addEventListener('input', updateCaptureButton);
    document.getElementById('capture-url').addEventListener('input', updateCaptureButton);

    // ─── Capture submit ───
    document.getElementById('btn-capture').addEventListener('click', async () => {
      const boardId = document.getElementById('capture-board').value;
      const colIndex = parseInt(document.getElementById('capture-column').value) || 0;

      try {
        if (currentCaptureType === 'text') {
          const content = document.getElementById('capture-content').value.trim();
          if (!content) return;
          await invoke('capture_text', { content, boardId, colIndex });
          document.getElementById('capture-content').value = '';
        } else {
          const url = document.getElementById('capture-url').value.trim();
          if (!url) return;
          const title = document.getElementById('capture-url-title').value.trim() || null;
          await invoke('capture_url', { url, title, boardId });
          document.getElementById('capture-url').value = '';
          document.getElementById('capture-url-title').value = '';
        }
        updateCaptureButton();
        showToast('Captured!');
        loadBoards();
      } catch (e) {
        showToast('Error: ' + e, true);
      }
    });

    // ─── Search ───
    const searchInput = document.getElementById('search-input');
    const searchClear = document.getElementById('search-clear');

    searchInput.addEventListener('input', () => {
      searchClear.style.display = searchInput.value ? 'block' : 'none';
      clearTimeout(searchDebounce);
      searchDebounce = setTimeout(doSearch, 300);
    });

    searchClear.addEventListener('click', () => {
      searchInput.value = '';
      searchClear.style.display = 'none';
      document.getElementById('search-results').innerHTML = '';
      document.getElementById('search-count').style.display = 'none';
      document.getElementById('search-empty').style.display = 'block';
    });

    async function doSearch() {
      const query = searchInput.value.trim();
      const resultsEl = document.getElementById('search-results');
      const countEl = document.getElementById('search-count');
      const emptyEl = document.getElementById('search-empty');

      if (!query) {
        resultsEl.innerHTML = '';
        countEl.style.display = 'none';
        emptyEl.style.display = 'block';
        return;
      }

      try {
        const results = await invoke('search', { query });
        emptyEl.style.display = results.length ? 'none' : 'block';
        emptyEl.textContent = results.length ? '' : 'No results found';
        countEl.textContent = results.length + ' result' + (results.length === 1 ? '' : 's');
        countEl.style.display = results.length ? 'block' : 'none';

        resultsEl.innerHTML = results.map(r => {
          // Strip kid comments for display
          const content = r.cardContent.replace(/<!--\s*kid:[a-f0-9]+\s*-->/g, '').trim();
          let tags = '';
          if (r.hashTags && r.hashTags.length) {
            tags += r.hashTags.map(t => '<span class="tag">' + escHtml(t) + '</span>').join('');
          }
          if (r.temporalTags && r.temporalTags.length) {
            tags += r.temporalTags.map(t => '<span class="tag temporal">' + escHtml(t) + '</span>').join('');
          }
          if (r.isOverdue) {
            tags += '<span class="tag overdue">overdue</span>';
          }
          if (r.dueDate) {
            tags += '<span class="tag temporal">due: ' + escHtml(r.dueDate) + '</span>';
          }
          return '<div class="search-result" data-board-id="' + escHtml(r.boardId) + '" data-card-id="' + escHtml(r.cardId) + '">' +
            '<div class="search-result-header">' +
              '<span class="search-result-board">' + escHtml(r.boardTitle) + '</span>' +
              '<span class="search-result-column">' + escHtml(r.columnTitle) + '</span>' +
            '</div>' +
            '<div class="search-result-content">' + escHtml(content) + '</div>' +
            (tags ? '<div class="search-result-tags">' + tags + '</div>' : '') +
          '</div>';
        }).join('');

        resultsEl.querySelectorAll('.search-result').forEach(el => {
          el.addEventListener('click', () => navigateToCard(el.dataset.boardId, el.dataset.cardId));
        });
      } catch (e) {
        emptyEl.style.display = 'block';
        emptyEl.textContent = 'Search error: ' + e;
      }
    }

    // ─── Boards list ───
    async function loadBoardsList() {
      try {
        boards = await invoke('list_boards');
        const list = document.getElementById('boards-list');
        if (!boards.length) {
          list.innerHTML = '<div class="search-empty">No boards yet</div>';
          return;
        }
        list.innerHTML = boards.map(b => {
          const cols = (b.columns || []).map(c =>
            '<span class="board-col-chip">' + escHtml(c.title) + '<span class="count">' + c.cardCount + '</span></span>'
          ).join('');
          return '<div class="board-card" data-id="' + b.id + '">' +
            '<div class="board-card-title">' + escHtml(b.title || b.id) + '</div>' +
            '<div class="board-card-columns">' + cols + '</div>' +
          '</div>';
        }).join('');

        list.querySelectorAll('.board-card').forEach(card => {
          card.addEventListener('click', () => openBoardDetail(card.dataset.id));
        });
      } catch (e) {
        console.error('loadBoardsList:', e);
      }
    }

    // ─── Board detail ───
    async function openBoardDetail(boardId, highlightCardId) {
      try {
        const board = await invoke('get_board', { boardId });
        if (!board) { showToast('Board not found', true); return; }

        currentBoardId = boardId;
        currentBoard = board;
        document.getElementById('boards-list').style.display = 'none';
        document.querySelector('#page-boards > div:first-child').style.display = 'none';
        const detail = document.getElementById('board-detail');
        detail.classList.add('active');

        document.getElementById('board-detail-title').textContent = board.title || boardId;

        const inboxBoard = boards.find(b => b.title === 'Inbox' || b.title === 'inbox');
        const isInbox = inboxBoard && inboxBoard.id === boardId;
        document.getElementById('board-delete').style.display = isInbox ? 'none' : 'inline-flex';
        const colsEl = document.getElementById('board-detail-columns');

        // Combine columns from flat and row-based formats
        const columns = board.columns || [];
        colsEl.innerHTML = columns.map((col, colIdx) => {
          const cards = (col.cards || []).map((card, cardIdx) => {
            const content = card.content.replace(/<!--\s*kid:[a-f0-9]+\s*-->/g, '').trim();
            return '<div class="board-card-item' + (card.checked ? ' checked' : '') + '"' +
              ' data-card-id="' + escHtml(card.id) + '"' +
              ' data-col-index="' + colIdx + '"' +
              ' data-card-index="' + cardIdx + '">' +
              escHtml(content) + '</div>';
          }).join('');
          return '<div class="board-column">' +
            '<div class="board-column-title">' + escHtml(col.title) + ' (' + (col.cards || []).length + ')</div>' +
            (cards || '<div class="board-empty">No cards</div>') +
          '</div>';
        }).join('');

        colsEl.querySelectorAll('.board-card-item').forEach(el => {
          el.addEventListener('click', () => openEditCardDialog(
            parseInt(el.dataset.colIndex),
            parseInt(el.dataset.cardIndex)
          ));
        });

        if (highlightCardId) {
          const target = colsEl.querySelector('[data-card-id="' + highlightCardId + '"]');
          if (target) {
            target.classList.add('highlight');
            target.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }
      } catch (e) {
        showToast('Error loading board: ' + e, true);
      }
    }

    function closeBoardDetail() {
      document.getElementById('board-detail').classList.remove('active');
      document.getElementById('boards-list').style.display = 'block';
      const header = document.querySelector('#page-boards > div:first-child');
      if (header) header.style.display = 'flex';
    }

    document.getElementById('board-back').addEventListener('click', closeBoardDetail);

    document.getElementById('board-delete').addEventListener('click', () => {
      const board = boards.find(b => b.id === currentBoardId);
      document.getElementById('delete-board-name').textContent = board ? board.title : currentBoardId;
      document.getElementById('dialog-delete-board').classList.add('show');
    });

    document.getElementById('dialog-delete-cancel').addEventListener('click', () => {
      document.getElementById('dialog-delete-board').classList.remove('show');
    });

    document.getElementById('dialog-delete-confirm').addEventListener('click', async () => {
      try {
        await invoke('delete_board', { boardId: currentBoardId });
        document.getElementById('dialog-delete-board').classList.remove('show');
        closeBoardDetail();
        showToast('Board deleted');
        loadBoardsList();
        loadBoards();
      } catch (e) {
        showToast('Error: ' + e, true);
      }
    });

    document.getElementById('dialog-delete-board').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) {
        document.getElementById('dialog-delete-board').classList.remove('show');
      }
    });

    // ─── Edit card dialog ───
    function openEditCardDialog(colIndex, cardIndex) {
      if (!currentBoard) return;
      const columns = currentBoard.columns || [];
      if (colIndex >= columns.length) return;
      const cards = columns[colIndex].cards || [];
      if (cardIndex >= cards.length) return;

      editingCardColIndex = colIndex;
      editingCardIndex = cardIndex;

      const rawContent = cards[cardIndex].content;
      const displayContent = rawContent.replace(/<!--\s*kid:[a-f0-9]+\s*-->/g, '').trim();
      document.getElementById('edit-card-content').value = displayContent;
      document.getElementById('dialog-edit-card').classList.add('show');
    }

    document.getElementById('dialog-edit-cancel').addEventListener('click', () => {
      document.getElementById('dialog-edit-card').classList.remove('show');
    });

    document.getElementById('dialog-edit-card').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) {
        document.getElementById('dialog-edit-card').classList.remove('show');
      }
    });

    document.getElementById('dialog-edit-save').addEventListener('click', async () => {
      const newContent = document.getElementById('edit-card-content').value.trim();
      if (!newContent) return;
      try {
        await invoke('edit_card', {
          boardId: currentBoardId,
          columnIndex: editingCardColIndex,
          cardIndex: editingCardIndex,
          newContent
        });
        document.getElementById('dialog-edit-card').classList.remove('show');
        showToast('Card updated');
        openBoardDetail(currentBoardId);
        loadBoards();
      } catch (e) {
        showToast('Error: ' + e, true);
      }
    });

    document.getElementById('dialog-edit-delete').addEventListener('click', () => {
      document.getElementById('dialog-edit-card').classList.remove('show');
      document.getElementById('dialog-delete-card').classList.add('show');
    });

    document.getElementById('dialog-delete-card-cancel').addEventListener('click', () => {
      document.getElementById('dialog-delete-card').classList.remove('show');
    });

    document.getElementById('dialog-delete-card').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) {
        document.getElementById('dialog-delete-card').classList.remove('show');
      }
    });

    document.getElementById('dialog-delete-card-confirm').addEventListener('click', async () => {
      try {
        await invoke('delete_card', {
          boardId: currentBoardId,
          columnIndex: editingCardColIndex,
          cardIndex: editingCardIndex
        });
        document.getElementById('dialog-delete-card').classList.remove('show');
        showToast('Card deleted');
        openBoardDetail(currentBoardId);
        loadBoards();
      } catch (e) {
        showToast('Error: ' + e, true);
      }
    });

    function navigateToCard(boardId, cardId) {
      document.querySelectorAll('.tab-bar button').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
      document.querySelector('.tab-bar button[data-page="boards"]').classList.add('active');
      document.getElementById('page-boards').classList.add('active');
      openBoardDetail(boardId, cardId);
    }

    // ─── New board dialog ───
    document.getElementById('btn-new-board').addEventListener('click', () => {
      document.getElementById('dialog-new-board').classList.add('show');
      document.getElementById('new-board-title').value = '';
      setTimeout(() => document.getElementById('new-board-title').focus(), 100);
    });

    document.getElementById('dialog-cancel').addEventListener('click', () => {
      document.getElementById('dialog-new-board').classList.remove('show');
    });

    document.getElementById('dialog-create').addEventListener('click', async () => {
      const title = document.getElementById('new-board-title').value.trim();
      if (!title) return;
      try {
        await invoke('create_board', { title });
        document.getElementById('dialog-new-board').classList.remove('show');
        showToast('Board created!');
        loadBoardsList();
        loadBoards();
      } catch (e) {
        showToast('Error: ' + e, true);
      }
    });

    // Close dialog on overlay click
    document.getElementById('dialog-new-board').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) {
        document.getElementById('dialog-new-board').classList.remove('show');
      }
    });

    // ─── Process pending shares ───
    document.getElementById('btn-process-pending').addEventListener('click', async () => {
      try {
        const count = await invoke('process_pending_shares');
        document.getElementById('pending-count').textContent = '0 items';
        if (count > 0) {
          showToast('Processed ' + count + ' shared item' + (count === 1 ? '' : 's'));
          loadBoards();
        } else {
          showToast('No pending items');
        }
      } catch (e) {
        showToast('Error: ' + e, true);
      }
    });

    // ─── Utilities ───
    function escHtml(s) {
      const d = document.createElement('div');
      d.textContent = s;
      return d.innerHTML;
    }

    // ─── Init ───
    loadBoards();
