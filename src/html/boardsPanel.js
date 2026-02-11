/**
 * Boards Panel JavaScript
 * Frontend logic for the unified Kanban Boards sidebar panel
 * Handles: board list, board config, drag-drop reorder
 */

(function() {
    const escapeHtml = window.escapeHtml;

    const vscode = acquireVsCodeApi();

    // DOM Elements
    const boardsList = document.getElementById('boards-list');
    const boardsActions = document.getElementById('boards-actions');
    const addBoardBtn = document.getElementById('add-board-btn');
    const scanBtn = document.getElementById('scan-btn');

    // State
    let currentState = null;
    let draggedPath = null;

    // Folded state tracking
    const expandedBoards = new Set();
    let allBoardsConfigExpanded = false;

    // ============= Initialization =============

    function init() {
        // Add/Scan buttons
        addBoardBtn.addEventListener('click', () => {
            vscode.postMessage({ type: 'addBoard' });
        });
        scanBtn.addEventListener('click', () => {
            vscode.postMessage({ type: 'scanWorkspace' });
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
                // Skip re-render if an input inside the list is focused
                const activeEl = document.activeElement;
                const inputFocused = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'SELECT') && boardsList.contains(activeEl);
                if (!inputFocused) {
                    renderBoards();
                    if (allBoardsConfigExpanded) { renderAllBoardsConfig(); }
                }
                renderLockState();
                break;
        }
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

        // "All Boards" entry — same markup as board entries, with lock + gear
        const allBoardsExpanded = allBoardsConfigExpanded;
        html += '<div class="board-item">';
        html += '<div class="tree-row board-item-header" id="all-boards-row">';
        html += '<div class="tree-contents">';
        html += '<span class="tree-label-name">All Boards</span>';
        html += '</div>';
        html += '<button class="lock-btn" id="lock-btn" title="Toggle lock"><span class="codicon codicon-lock"></span></button>';
        html += '<div class="tree-twistie collapsible board-toggle' + (allBoardsExpanded ? ' expanded' : '') + '" id="all-boards-toggle-btn" title="All boards settings"></div>';
        html += '</div>';
        html += '<div class="all-boards-config" id="all-boards-config"' + (allBoardsExpanded ? '' : ' style="display: none;"') + '>';
        html += '<div id="all-boards-config-content"></div>';
        html += '</div>';
        html += '</div>';

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

            // Current tag filters (default tags grayed out first, then board-specific)
            var defaultTags = currentState.defaultTagFilters || [];
            if (defaultTags.length > 0 || tagFilters.length > 0) {
                html += '<div class="tree-row board-config-row">';
                html += '<div class="tree-indent"><div class="indent-guide"></div></div>';
                html += '<div class="tree-twistie"></div>';
                html += '<div class="tree-contents">';
                html += '<div class="board-tag-filters">';
                defaultTags.forEach(tag => {
                    html += '<span class="board-tag-filter inherited">';
                    html += escapeHtml(tag);
                    html += '</span>';
                });
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
        // "All Boards" lock button
        const lockBtn = document.getElementById('lock-btn');
        if (lockBtn) {
            lockBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                vscode.postMessage({ type: 'toggleLock' });
            });
        }

        // "All Boards" settings toggle
        const allBoardsToggleBtn = document.getElementById('all-boards-toggle-btn');
        if (allBoardsToggleBtn) {
            allBoardsToggleBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                allBoardsConfigExpanded = !allBoardsConfigExpanded;
                const allBoardsConfig = document.getElementById('all-boards-config');
                if (allBoardsConfig) { allBoardsConfig.style.display = allBoardsConfigExpanded ? 'block' : 'none'; }
                allBoardsToggleBtn.classList.toggle('expanded', allBoardsConfigExpanded);
                if (allBoardsConfigExpanded) { renderAllBoardsConfig(); }
            });
        }

        // Board header click to open board
        boardsList.querySelectorAll('.board-item-header[data-file-path]').forEach(header => {
            header.addEventListener('click', (e) => {
                if (e.target.closest('.board-remove-btn') || e.target.closest('.board-toggle')) { return; }
                const filePath = header.dataset.filePath;
                vscode.postMessage({ type: 'openBoard', filePath });
            });
        });

        // Fold button click to toggle config (per-board only)
        boardsList.querySelectorAll('.board-item[data-file-path] .board-toggle').forEach(toggle => {
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
                    input.blur();
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

        var allBoardsConfigContent = document.getElementById('all-boards-config-content');
        if (!allBoardsConfigContent) { return; }
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
                    tagInput.blur();
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
        const lockBtn = document.getElementById('lock-btn');
        if (lockBtn) {
            const icon = lockBtn.querySelector('.codicon');
            if (icon) {
                if (locked) {
                    icon.className = 'codicon codicon-lock';
                    lockBtn.classList.remove('unlocked');
                    lockBtn.title = 'Unlock (allow add/remove)';
                } else {
                    icon.className = 'codicon codicon-unlock';
                    lockBtn.classList.add('unlocked');
                    lockBtn.title = 'Lock (prevent add/remove)';
                }
            }
        }

        const actions = boardsActions || document.getElementById('boards-actions');
        if (actions) {
            if (locked) {
                actions.classList.add('locked');
            } else {
                actions.classList.remove('locked');
            }
        }
    }

    // ============= Init =============

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
