/**
 * Boards Panel JavaScript
 * Frontend logic for the unified Kanban Boards sidebar panel
 * Handles: board list, board config, search, recent searches, drag-drop reorder
 */

(function() {
    const escapeHtml = window.escapeHtml;
    const escapeRegExp = window.escapeRegExp;

    const vscode = acquireVsCodeApi();

    // DOM Elements
    const searchInput = document.querySelector('.search-input');
    const searchBtn = document.querySelector('.search-btn');
    const regexToggleBtn = document.querySelector('.regex-toggle-btn');
    const scopeSelect = document.querySelector('.scope-select');
    const recentSearchesContainer = document.getElementById('recent-searches');
    const searchResultsSection = document.getElementById('search-results-section');
    const resultsList = document.getElementById('results-list');
    const boardsList = document.getElementById('boards-list');
    const boardsActions = document.getElementById('boards-actions');
    const lockBtn = document.getElementById('lock-btn');
    const allBoardsToggleBtn = document.getElementById('all-boards-toggle-btn');
    const allBoardsConfig = document.getElementById('all-boards-config');
    const allBoardsConfigContent = document.getElementById('all-boards-config-content');
    const addBoardBtn = document.getElementById('add-board-btn');
    const scanBtn = document.getElementById('scan-btn');

    // State
    let currentState = null;
    let useRegex = false;
    let searchDebounceTimer = null;
    let currentResults = [];
    let resultElements = [];
    let currentResultIndex = -1;
    let draggedPath = null;

    // Folded state tracking
    const foldedGroups = new Set();
    const expandedBoards = new Set();
    let allBoardsConfigExpanded = false;

    // Icon/label maps for search results
    const typeLabels = {
        image: 'Images', include: 'Includes', link: 'Links',
        media: 'Media', diagram: 'Diagrams', text: 'Text Matches'
    };

    // ============= Initialization =============

    function init() {
        // Search controls
        searchBtn.addEventListener('click', performSearch);
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') { performSearch(); }
        });
        searchInput.addEventListener('input', () => {
            clearTimeout(searchDebounceTimer);
            searchDebounceTimer = setTimeout(() => {
                if (searchInput.value.length >= 2) { performSearch(); }
            }, 300);
        });

        // Regex toggle
        regexToggleBtn.addEventListener('click', () => {
            useRegex = !useRegex;
            regexToggleBtn.classList.toggle('active', useRegex);
            if (searchInput.value.trim().length >= 2) { performSearch(); }
        });

        // Lock toggle
        lockBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            vscode.postMessage({ type: 'toggleLock' });
        });

        // All Boards settings toggle
        allBoardsToggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            allBoardsConfigExpanded = !allBoardsConfigExpanded;
            allBoardsConfig.style.display = allBoardsConfigExpanded ? 'block' : 'none';
            allBoardsToggleBtn.classList.toggle('active', allBoardsConfigExpanded);
            if (allBoardsConfigExpanded) { renderAllBoardsConfig(); }
        });

        // Add/Scan buttons
        addBoardBtn.addEventListener('click', () => {
            vscode.postMessage({ type: 'addBoard' });
        });
        scanBtn.addEventListener('click', () => {
            vscode.postMessage({ type: 'scanWorkspace' });
        });

        // Section toggle
        document.querySelectorAll('.section-header[data-section]').forEach(header => {
            header.addEventListener('click', (e) => {
                if (e.target.closest('button')) { return; }
                const twistie = header.querySelector('.tree-twistie');
                const section = header.closest('.boards-section, .search-results-section');
                const content = section ? section.querySelector('.section-content') : null;
                if (twistie && content) {
                    twistie.classList.toggle('expanded');
                    content.classList.toggle('collapsed');
                }
            });
        });

        // Close search results
        const closeResultsBtn = document.querySelector('.close-results-btn');
        if (closeResultsBtn) {
            closeResultsBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                searchResultsSection.style.display = 'none';
                currentResults = [];
                resultElements = [];
            });
        }

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            const isModifier = e.ctrlKey || e.metaKey;
            if (!isModifier) { return; }
            if (e.key.toLowerCase() === 'f') {
                e.preventDefault();
                searchInput.focus();
                searchInput.select();
            }
            if (e.key.toLowerCase() === 'g' && currentResults.length > 0) {
                e.preventDefault();
                const direction = e.shiftKey ? -1 : 1;
                const nextIndex = (currentResultIndex + direction + currentResults.length) % currentResults.length;
                navigateToIndex(nextIndex);
            }
        });

        // Messages from backend
        window.addEventListener('message', handleMessage);

        // Ready
        vscode.postMessage({ type: 'ready' });
    }

    // ============= Message Handling =============

    function handleMessage(event) {
        const message = event.data;

        switch (message.type) {
            case 'state':
                currentState = message;
                renderBoards();
                renderRecentSearches();
                renderLockState();
                if (allBoardsConfigExpanded) { renderAllBoardsConfig(); }
                break;

            case 'searchResults':
                displaySearchResults(message.results, message.searchType);
                break;

            case 'error':
                showError(message.message);
                break;

            case 'noActivePanel':
                showNoActivePanel();
                break;

            case 'setSearchQuery':
                if (message.query) {
                    searchInput.value = message.query;
                    performSearch();
                }
                break;
        }
    }

    // ============= Search =============

    function performSearch() {
        const query = searchInput.value.trim();
        if (query.length === 0) { return; }

        const msg = {
            type: 'searchText',
            query: query,
            scope: scopeSelect.value
        };
        if (useRegex) { msg.useRegex = true; }
        vscode.postMessage(msg);

        resultsList.innerHTML = '<div class="loading">Searching...</div>';
        searchResultsSection.style.display = 'block';
    }

    function displaySearchResults(results, searchType) {
        resultsList.innerHTML = '';
        currentResults = results || [];
        resultElements = [];
        currentResultIndex = -1;

        if (results.length === 0) {
            resultsList.innerHTML = '<div class="empty-message">' +
                (searchType === 'broken' ? 'No broken elements found' : 'No matches found') +
                '</div>';
            searchResultsSection.style.display = 'block';
            return;
        }

        searchResultsSection.style.display = 'block';

        // Check if multi-board results
        const isMultiBoard = results.some(r => r.boardName);
        let indexCounter = 0;

        if (isMultiBoard) {
            const groupedByBoard = {};
            results.forEach(result => {
                const boardKey = result.boardName || 'Current Board';
                if (!groupedByBoard[boardKey]) {
                    groupedByBoard[boardKey] = { boardUri: result.boardUri, items: {} };
                }
                const type = result.type;
                if (!groupedByBoard[boardKey].items[type]) {
                    groupedByBoard[boardKey].items[type] = [];
                }
                groupedByBoard[boardKey].items[type].push(result);
            });

            Object.keys(groupedByBoard).forEach(boardName => {
                const boardData = groupedByBoard[boardName];
                const boardGroupEl = createBoardGroup(boardName, boardData.items, searchType, indexCounter);
                Object.values(boardData.items).forEach(items => { indexCounter += items.length; });
                resultsList.appendChild(boardGroupEl);
            });
        } else {
            const grouped = {};
            results.forEach(result => {
                const type = result.type;
                if (!grouped[type]) { grouped[type] = []; }
                grouped[type].push(result);
            });

            Object.keys(grouped).forEach(type => {
                const group = grouped[type];
                const groupEl = createResultGroup(type, group, searchType, indexCounter);
                indexCounter += group.length;
                resultsList.appendChild(groupEl);
            });
        }

        if (currentResults.length > 0) {
            navigateToIndex(0, { scroll: false, focus: false });
        }
    }

    function createBoardGroup(boardName, itemsByType, searchType, startIndex) {
        const group = document.createElement('div');
        group.className = 'tree-group board-group';

        let totalItems = 0;
        Object.values(itemsByType).forEach(items => { totalItems += items.length; });

        const isFolded = foldedGroups.has('board:' + boardName);
        if (isFolded) { group.classList.add('folded'); }

        const header = document.createElement('div');
        header.className = 'tree-row board-header';
        header.innerHTML =
            '<div class="tree-twistie collapsible ' + (isFolded ? '' : 'expanded') + '"></div>' +
            '<div class="tree-contents">' +
            '<span class="tree-label-name board-name">' + escapeHtml(boardName) + ' (' + totalItems + ')</span>' +
            '</div>';

        header.addEventListener('click', () => {
            const isNowFolded = group.classList.toggle('folded');
            header.querySelector('.tree-twistie').classList.toggle('expanded', !isNowFolded);
            if (isNowFolded) { foldedGroups.add('board:' + boardName); }
            else { foldedGroups.delete('board:' + boardName); }
        });

        group.appendChild(header);

        const itemsContainer = document.createElement('div');
        itemsContainer.className = 'tree-group-items';

        let indexCounter = startIndex;
        Object.keys(itemsByType).forEach(type => {
            const items = itemsByType[type];
            const typeGroupEl = createResultGroup(type, items, searchType, indexCounter, true);
            indexCounter += items.length;
            itemsContainer.appendChild(typeGroupEl);
        });

        group.appendChild(itemsContainer);
        return group;
    }

    function createResultGroup(type, items, searchType, startIndex, nested) {
        const group = document.createElement('div');
        group.className = 'tree-group' + (nested ? ' nested-group' : '');

        const foldKey = (nested ? 'nested:' : '') + type;
        const isFolded = foldedGroups.has(foldKey);
        if (isFolded) { group.classList.add('folded'); }

        const indentHtml = nested
            ? '<div class="tree-indent"><div class="indent-guide"></div><div class="indent-guide"></div></div>'
            : '<div class="tree-indent"><div class="indent-guide"></div></div>';

        const header = document.createElement('div');
        header.className = 'tree-row';
        header.innerHTML =
            indentHtml +
            '<div class="tree-twistie collapsible ' + (isFolded ? '' : 'expanded') + '"></div>' +
            '<div class="tree-contents">' +
            '<span class="tree-label-name">' + escapeHtml(typeLabels[type] || type) + ' (' + items.length + ')</span>' +
            '</div>';

        header.addEventListener('click', () => {
            const isNowFolded = group.classList.toggle('folded');
            header.querySelector('.tree-twistie').classList.toggle('expanded', !isNowFolded);
            if (isNowFolded) { foldedGroups.add(foldKey); }
            else { foldedGroups.delete(foldKey); }
        });

        group.appendChild(header);

        const itemsContainer = document.createElement('div');
        itemsContainer.className = 'tree-group-items';
        items.forEach((item, offset) => {
            const itemEl = createResultItem(item, searchType, startIndex + offset, nested);
            itemsContainer.appendChild(itemEl);
        });
        group.appendChild(itemsContainer);

        return group;
    }

    function createResultItem(item, searchType, resultIndex, nested) {
        const el = document.createElement('div');
        el.className = 'tree-row';
        el.dataset.resultIndex = String(resultIndex);

        const isBroken = searchType === 'broken';
        let mainContent = '';
        if (item.path) {
            mainContent = escapeHtml(item.path);
        } else if (item.matchText) {
            mainContent = escapeHtml(item.matchText);
        } else if (item.context) {
            mainContent = highlightMatch(item.context, item.matchText);
        }

        const locationText = formatLocation(item.location);

        const indentHtml = nested
            ? '<div class="tree-indent"><div class="indent-guide"></div><div class="indent-guide"></div><div class="indent-guide"></div></div>'
            : '<div class="tree-indent"><div class="indent-guide"></div><div class="indent-guide"></div></div>';

        el.innerHTML =
            indentHtml +
            '<div class="tree-twistie"></div>' +
            '<div class="tree-contents">' +
            '<div class="tree-label-2line">' +
            '<span class="entry-title ' + (isBroken ? 'result-icon-broken' : '') + '">' + mainContent + '</span>' +
            '<span class="entry-location">' + locationText + '</span>' +
            '</div></div>';

        el.addEventListener('click', () => {
            navigateToIndex(resultIndex, { focus: true, scroll: true });
        });

        resultElements[resultIndex] = el;
        return el;
    }

    function navigateToIndex(index, options) {
        options = options || {};
        const scroll = options.scroll !== false;
        const focus = options.focus !== false;

        if (index < 0 || index >= currentResults.length) { return; }
        currentResultIndex = index;

        resultElements.forEach((el, i) => {
            if (el) { el.classList.toggle('active', i === currentResultIndex); }
        });

        const item = currentResults[index];
        if (focus) { navigateToElement(item); }
        if (scroll) {
            const el = resultElements[index];
            if (el) { el.scrollIntoView({ block: 'nearest' }); }
        }
    }

    function navigateToElement(item) {
        const msg = {
            type: 'navigateToElement',
            columnId: item.location.columnId,
            taskId: item.location.taskId,
            elementPath: item.path,
            elementType: item.type,
            field: item.location.field,
            matchText: item.matchText
        };
        if (item.boardUri) { msg.boardUri = item.boardUri; }
        vscode.postMessage(msg);
    }

    function formatLocation(location) {
        let text = escapeHtml(location.columnTitle);
        if (location.taskSummary) {
            text += ' / ' + escapeHtml(location.taskSummary);
        }
        return text;
    }

    function highlightMatch(context, matchText) {
        if (!matchText) { return escapeHtml(context); }
        const escaped = escapeHtml(context);
        const matchEscaped = escapeHtml(matchText);
        const regex = new RegExp('(' + escapeRegExp(matchEscaped) + ')', 'gi');
        return escaped.replace(regex, '<span class="highlight">$1</span>');
    }

    function showError(text) {
        resultsList.innerHTML = '<div class="status-message visible error">' + escapeHtml(text) + '</div>';
        searchResultsSection.style.display = 'block';
    }

    function showNoActivePanel() {
        resultsList.innerHTML =
            '<div class="no-panel-warning">' +
            '<p>No kanban board is currently open</p>' +
            '<p>Open a kanban markdown file to search</p>' +
            '</div>';
        searchResultsSection.style.display = 'block';
    }

    // ============= Recent Searches =============

    function renderRecentSearches() {
        if (!currentState || !currentState.searches) {
            recentSearchesContainer.innerHTML = '';
            return;
        }

        const searches = currentState.searches;
        if (searches.length === 0) {
            recentSearchesContainer.innerHTML = '';
            return;
        }

        let html = '';
        searches.forEach(entry => {
            const pinnedClass = entry.pinned ? ' pinned' : '';
            const pinIcon = entry.pinned ? '📌' : '📍';
            html += '<span class="recent-search-item' + pinnedClass + '" data-query="' + escapeHtml(entry.query) + '">';
            html += '<span class="recent-search-query">' + escapeHtml(entry.query) + '</span>';
            html += '<span class="recent-search-pin" data-action="pin" title="' + (entry.pinned ? 'Unpin' : 'Pin') + '">' + pinIcon + '</span>';
            html += '<span class="recent-search-close" data-action="close" title="Remove">✕</span>';
            html += '</span>';
        });

        recentSearchesContainer.innerHTML = html;

        // Event listeners
        recentSearchesContainer.querySelectorAll('.recent-search-item').forEach(item => {
            const query = item.dataset.query;

            // Click on query text to re-run search
            item.querySelector('.recent-search-query').addEventListener('click', () => {
                searchInput.value = query;
                performSearch();
            });

            // Pin toggle
            item.querySelector('[data-action="pin"]').addEventListener('click', (e) => {
                e.stopPropagation();
                vscode.postMessage({ type: 'pinSearch', query });
            });

            // Remove
            item.querySelector('[data-action="close"]').addEventListener('click', (e) => {
                e.stopPropagation();
                vscode.postMessage({ type: 'removeSearch', query });
            });
        });
    }

    // ============= Board List =============

    function renderBoards() {
        if (!currentState || !currentState.boards) {
            boardsList.innerHTML = '<div class="empty-message">No boards registered</div>';
            return;
        }

        const boards = currentState.boards;
        if (boards.length === 0) {
            boardsList.innerHTML = '<div class="empty-message">No boards registered</div>';
            return;
        }

        let html = '';
        boards.forEach(board => {
            const isExpanded = expandedBoards.has(board.filePath);
            const tagFilters = board.config.tagFilters || [];
            const canDrag = !currentState.locked;

            html += '<div class="board-item" data-file-path="' + escapeHtml(board.filePath) + '">';

            // Header row
            html += '<div class="tree-row board-item-header"' +
                (canDrag ? ' draggable="true"' : '') +
                ' data-file-path="' + escapeHtml(board.filePath) + '"' +
                ' data-board-uri="' + escapeHtml(board.uri) + '">';
            html += '<div class="tree-contents">';
            html += '<span class="tree-label-name" title="' + escapeHtml(board.filePath) + '">' + escapeHtml(board.name) + '</span>';
            html += '</div>';
            if (!currentState.locked) {
                html += '<button class="board-remove-btn" data-file-path="' + escapeHtml(board.filePath) + '" title="Remove">✕</button>';
            }
            html += '<div class="tree-twistie collapsible board-toggle' + (isExpanded ? ' expanded' : '') + '" title="Toggle settings"></div>';
            html += '</div>';

            // Config body
            html += '<div class="board-config-body' + (isExpanded ? ' expanded' : '') + '">';

            // Timeframe row
            html += '<div class="tree-row board-config-row">';
            html += '<div class="tree-indent"><div class="indent-guide"></div></div>';
            html += '<div class="tree-twistie"></div>';
            html += '<div class="tree-contents">';
            html += '<span class="board-config-label">Timeframe:</span>';
            var defaultTf = currentState.defaultTimeframe || 7;
            html += '<select class="timeframe-select" data-board-uri="' + escapeHtml(board.uri) + '">';
            html += '<option value="0"' + (board.config.timeframe === 0 ? ' selected' : '') + '>Default (' + defaultTf + 'd)</option>';
            html += '<option value="3"' + (board.config.timeframe === 3 ? ' selected' : '') + '>3 days</option>';
            html += '<option value="7"' + (board.config.timeframe === 7 ? ' selected' : '') + '>7 days</option>';
            html += '<option value="30"' + (board.config.timeframe === 30 ? ' selected' : '') + '>30 days</option>';
            html += '</select>';
            html += '</div></div>';

            // Tags input row
            html += '<div class="tree-row board-config-row">';
            html += '<div class="tree-indent"><div class="indent-guide"></div></div>';
            html += '<div class="tree-twistie"></div>';
            html += '<div class="tree-contents">';
            html += '<span class="board-config-label">Tags:</span>';
            html += '<input type="text" class="board-tag-input" data-board-uri="' + escapeHtml(board.uri) + '" placeholder="Add tag...">';
            html += '</div></div>';

            // Current tag filters
            if (tagFilters.length > 0) {
                html += '<div class="tree-row board-config-row">';
                html += '<div class="tree-indent"><div class="indent-guide"></div></div>';
                html += '<div class="tree-twistie"></div>';
                html += '<div class="tree-contents">';
                html += '<div class="board-tag-filters">';
                tagFilters.forEach(tag => {
                    html += '<span class="board-tag-filter" data-board-uri="' + escapeHtml(board.uri) + '" data-tag="' + escapeHtml(tag) + '">';
                    html += escapeHtml(tag);
                    html += '<span class="board-tag-filter-remove">✕</span>';
                    html += '</span>';
                });
                html += '</div></div></div>';
            }

            html += '</div>'; // config body end
            html += '</div>'; // board item end
        });

        boardsList.innerHTML = html;
        attachBoardEventListeners();
    }

    function attachBoardEventListeners() {
        // Board header click to open board
        boardsList.querySelectorAll('.board-item-header').forEach(header => {
            header.addEventListener('click', (e) => {
                if (e.target.closest('.board-remove-btn') || e.target.closest('.board-toggle')) { return; }
                const filePath = header.dataset.filePath;
                vscode.postMessage({ type: 'openBoard', filePath });
            });
        });

        // Fold button click to toggle config
        boardsList.querySelectorAll('.board-toggle').forEach(toggle => {
            toggle.addEventListener('click', (e) => {
                e.stopPropagation();
                const item = toggle.closest('.board-item');
                const filePath = item.dataset.filePath;
                const body = item.querySelector('.board-config-body');

                const isNowExpanded = body.classList.toggle('expanded');
                toggle.classList.toggle('expanded', isNowExpanded);

                if (isNowExpanded) { expandedBoards.add(filePath); }
                else { expandedBoards.delete(filePath); }
            });
        });

        // Remove buttons
        boardsList.querySelectorAll('.board-remove-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                vscode.postMessage({ type: 'removeBoard', filePath: btn.dataset.filePath });
            });
        });

        // Timeframe selects
        boardsList.querySelectorAll('.timeframe-select').forEach(select => {
            select.addEventListener('change', () => {
                vscode.postMessage({
                    type: 'updateBoardConfig',
                    boardUri: select.dataset.boardUri,
                    timeframe: parseInt(select.value)
                });
            });
        });

        // Tag input
        boardsList.querySelectorAll('.board-tag-input').forEach(input => {
            const addTag = () => {
                const tag = input.value.trim();
                if (tag) {
                    vscode.postMessage({
                        type: 'addTagFilter',
                        boardUri: input.dataset.boardUri,
                        tag
                    });
                    input.value = '';
                }
            };
            input.addEventListener('change', addTag);
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') { e.preventDefault(); addTag(); }
            });
        });

        // Tag filter removal
        boardsList.querySelectorAll('.board-tag-filter-remove').forEach(btn => {
            btn.addEventListener('click', () => {
                const filter = btn.closest('.board-tag-filter');
                vscode.postMessage({
                    type: 'removeTagFilter',
                    boardUri: filter.dataset.boardUri,
                    tag: filter.dataset.tag
                });
            });
        });

        // Drag & drop for reordering
        if (!currentState || currentState.locked) { return; }

        boardsList.querySelectorAll('.board-item-header[draggable="true"]').forEach(header => {
            header.addEventListener('dragstart', (e) => {
                draggedPath = header.dataset.filePath;
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', draggedPath);
            });

            header.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                header.classList.add('drag-over');
            });

            header.addEventListener('dragleave', () => {
                header.classList.remove('drag-over');
            });

            header.addEventListener('drop', (e) => {
                e.preventDefault();
                header.classList.remove('drag-over');
                if (draggedPath && draggedPath !== header.dataset.filePath) {
                    vscode.postMessage({
                        type: 'reorderBoards',
                        draggedPaths: [draggedPath],
                        targetPath: header.dataset.filePath
                    });
                }
                draggedPath = null;
            });

            header.addEventListener('dragend', () => {
                draggedPath = null;
                boardsList.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
            });
        });
    }

    // ============= All Boards Config =============

    function renderAllBoardsConfig() {
        if (!currentState) { return; }

        var defaultTf = currentState.defaultTimeframe || 7;
        var defaultTags = currentState.defaultTagFilters || [];

        var html = '';

        // Timeframe row
        html += '<div class="tree-row board-config-row">';
        html += '<div class="tree-indent"><div class="indent-guide"></div></div>';
        html += '<div class="tree-twistie"></div>';
        html += '<div class="tree-contents">';
        html += '<span class="board-config-label">Timeframe:</span>';
        html += '<select class="default-timeframe-select">';
        html += '<option value="3"' + (defaultTf === 3 ? ' selected' : '') + '>3 days</option>';
        html += '<option value="7"' + (defaultTf === 7 ? ' selected' : '') + '>7 days</option>';
        html += '<option value="30"' + (defaultTf === 30 ? ' selected' : '') + '>30 days</option>';
        html += '</select>';
        html += '</div></div>';

        // Tags input row
        html += '<div class="tree-row board-config-row">';
        html += '<div class="tree-indent"><div class="indent-guide"></div></div>';
        html += '<div class="tree-twistie"></div>';
        html += '<div class="tree-contents">';
        html += '<span class="board-config-label">Tags:</span>';
        html += '<input type="text" class="board-tag-input default-tag-input" placeholder="Add default tag...">';
        html += '</div></div>';

        // Current default tag filters
        if (defaultTags.length > 0) {
            html += '<div class="tree-row board-config-row">';
            html += '<div class="tree-indent"><div class="indent-guide"></div></div>';
            html += '<div class="tree-twistie"></div>';
            html += '<div class="tree-contents">';
            html += '<div class="board-tag-filters">';
            defaultTags.forEach(function(tag) {
                html += '<span class="board-tag-filter default-tag-filter" data-tag="' + escapeHtml(tag) + '">';
                html += escapeHtml(tag);
                html += '<span class="board-tag-filter-remove">✕</span>';
                html += '</span>';
            });
            html += '</div></div></div>';
        }

        allBoardsConfigContent.innerHTML = html;

        // Event listeners for default config
        var tfSelect = allBoardsConfigContent.querySelector('.default-timeframe-select');
        if (tfSelect) {
            tfSelect.addEventListener('change', function() {
                vscode.postMessage({ type: 'setDefaultTimeframe', timeframe: parseInt(tfSelect.value) });
            });
        }

        var tagInput = allBoardsConfigContent.querySelector('.default-tag-input');
        if (tagInput) {
            var addDefaultTag = function() {
                var tag = tagInput.value.trim();
                if (tag) {
                    vscode.postMessage({ type: 'addDefaultTagFilter', tag: tag });
                    tagInput.value = '';
                }
            };
            tagInput.addEventListener('change', addDefaultTag);
            tagInput.addEventListener('keydown', function(e) {
                if (e.key === 'Enter') { e.preventDefault(); addDefaultTag(); }
            });
        }

        allBoardsConfigContent.querySelectorAll('.default-tag-filter .board-tag-filter-remove').forEach(function(btn) {
            btn.addEventListener('click', function() {
                var filter = btn.closest('.default-tag-filter');
                vscode.postMessage({ type: 'removeDefaultTagFilter', tag: filter.dataset.tag });
            });
        });
    }

    // ============= Lock State =============

    function renderLockState() {
        if (!currentState) { return; }

        const locked = currentState.locked;
        const icon = lockBtn.querySelector('.codicon');

        if (locked) {
            icon.className = 'codicon codicon-lock';
            lockBtn.classList.remove('unlocked');
            lockBtn.title = 'Unlock (allow add/remove)';
            boardsActions.classList.add('locked');
        } else {
            icon.className = 'codicon codicon-unlock';
            lockBtn.classList.add('unlocked');
            lockBtn.title = 'Lock (prevent add/remove)';
            boardsActions.classList.remove('locked');
        }
    }

    // ============= Init =============

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
