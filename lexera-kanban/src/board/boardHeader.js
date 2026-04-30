/**
 * LexeraBoardHeader — Board header rendering and creation-drag logic
 * extracted from app.js.
 *
 * IIFE module — no const/let, no ES imports.
 */
var LexeraBoardHeader = (function () {
  'use strict';

  // --- Dependencies (injected via init) ---
  var _deps = {};

  function _dep(name) {
    return _deps[name];
  }

  function _callDep(name) {
    var fn = _deps[name];
    if (typeof fn === 'function') return fn.apply(null, Array.prototype.slice.call(arguments, 1));
    return undefined;
  }

  // --- Module-local state ---
  var $foldAllBtn = null;
  var $foldAllCardsBtn = null;
  var $saveTrackingBtn = null;
  var _boardHeaderResizeBound = false;

  // --- Constants ---
  var BOARD_HEADER_COMPACT_WIDTH = 1320;
  var BOARD_HEADER_COMPACT_HEADER_WIDTH = 1180;
  var BOARD_HEADER_V1_COMPACT_ICONS = {
    createEmpty: '+',
    createTemplate: '\u25A6',
    createClipboard: '\u2398',
    incoming: '\u2193',
    parked: '\u23F8',
    archived: '\u25A3',
    trash: '\u2715',
    foldColumnsCollapsed: '\u25B3',
    foldColumnsExpanded: '\u25BD',
    foldCardsCollapsed: '\u25B4',
    foldCardsExpanded: '\u25BE',
    pinHeaders: '\uD83D\uDCCC',
    processes: '\u2699',
    themeZoom: '\u2315',
    exportPack: '\u21EA'
  };

  // ─── renderBoardHeader ─────────────────────────────────────────────

  function renderBoardHeader() {
    var incomingCount = _callDep('getIncomingCount');
    var parkedCount = _callDep('getParkedCount');
    var archivedCount = _callDep('getArchivedCount');
    var deletedCount = _callDep('getDeletedCount');
    var boardFilePath = _callDep('getActiveBoardFilePath');
    var activeBoardData = _callDep('getActiveBoardData');
    var activeBoardId = _callDep('getActiveBoardId');
    var connected = _callDep('getConnected');
    var embeddedMode = _callDep('getEmbeddedMode');
    var BURGER_MENU_ICON_HTML = _dep('BURGER_MENU_ICON_HTML');
    var boardFileName = boardFilePath
      ? _callDep('getDisplayFileNameFromPath', boardFilePath)
      : ((activeBoardData && activeBoardData.title) ? activeBoardData.title : 'Untitled');
    var hasBoardFile = !!(activeBoardId && boardFilePath);
    var html = '';
    var fileTitle = boardFileName || 'Untitled';
    // Drawer pill builder: icon (accent-tinted per kind) + label + trailing
    // caret ▾, matching lexera-shell.jsx DrawerBtn verbatim.
    function drawerPill(opts) {
      var kind = opts.kind || 'neutral';
      var cls = 'board-action-btn drawer-pill drawer-pill-' + kind;
      if (opts.extraClass) cls += ' ' + opts.extraClass;
      if (opts.count > 0) cls += ' has-items';
      return '<button class="' + cls + '" id="' + opts.id + '"' +
        (opts.title ? ' title="' + _callDep('escapeAttr', opts.title) + '"' : '') + '>' +
        '<span class="drawer-pill-icon" aria-hidden="true">' + (opts.icon || '') + '</span>' +
        '<span class="drawer-pill-label">' + _callDep('escapeHtml', opts.label) + '</span>' +
        (opts.count > 0 ? '<span class="drawer-pill-count">' + opts.count + '</span>' : '') +
        '<span class="drawer-pill-caret" aria-hidden="true">\u25BE</span>' +
        '</button>';
    }

    html += '<div class="board-header-zone board-header-zone-left">';
    html += '<span class="board-header-pane-dot ' + (activeBoardId ? 'is-active' : '') + '" aria-hidden="true"></span>';
    html += '<div class="board-header-file-group">';
    html += '<button id="btn-pane-file-title" class="board-header-file-title' + (hasBoardFile ? ' has-board' : '') + '" title="' +
      _callDep('escapeAttr', hasBoardFile ? boardFilePath : fileTitle) + '">' +
      '<span class="file-title-caret" aria-hidden="true">\u25BE</span>' +
      '<span class="file-title-text">' + _callDep('escapeHtml', fileTitle) + '</span>' +
      '</button>';
    html += '<button class="burger-menu-btn board-menu-btn" id="btn-file-header-menu" title="File header settings">' + BURGER_MENU_ICON_HTML + '</button>';
    html += '<span id="sync-status-indicator" class="sync-status-indicator ' + (connected ? 'connected' : 'disconnected') + '" title="' + (connected ? 'Connected' : 'Disconnected') + '"></span>';
    html += '</div>';
    html += '</div>';

    html += '<div class="board-header-zone board-header-zone-middle">';
    html += '<div class="board-header-actions board-header-actions-middle">';
    html += drawerPill({ id: 'btn-create-new', icon: '+', label: 'new', kind: 'neutral',
      title: 'Create new row, stack, column or card' });
    html += '<span class="board-header-separator" aria-hidden="true"></span>';
    html += drawerPill({ id: 'btn-incoming', icon: '\u2193', label: 'incoming', kind: 'incoming',
      count: incomingCount, extraClass: 'header-drop-target',
      title: 'Incoming — drop cards here to mark as incoming' });
    html += drawerPill({ id: 'btn-parked', icon: '\u25D0', label: 'parked', kind: 'parked',
      count: parkedCount, extraClass: 'header-drop-target',
      title: 'Show parked items — drop cards here to park' });
    html += '<span class="board-header-separator" aria-hidden="true"></span>';
    html += drawerPill({ id: 'btn-archived', icon: '\u25A6', label: 'archived', kind: 'neutral',
      count: archivedCount, extraClass: 'header-drop-target',
      title: 'Show archived items — drop cards here to archive' });
    html += drawerPill({ id: 'btn-trash', icon: '\u2715', label: 'trashed', kind: 'trashed',
      count: deletedCount, extraClass: 'header-drop-target danger',
      title: 'Show deleted items — drop cards here to delete' });
    html += '</div>';
    html += '</div>';

    html += '<div class="board-header-zone board-header-zone-right">';
    html += '<div class="board-header-actions board-header-actions-right">';
    html += drawerPill({ id: 'btn-save-tracking', icon: '\u25CF', label: 'changes', kind: 'neutral',
      title: 'Save now and inspect change tracking' });
    html += drawerPill({ id: 'btn-theme-zoom', icon: '\u2699', label: 'settings', kind: 'neutral',
      title: 'Open frontend settings' });
    html += drawerPill({ id: 'btn-export', icon: '\u2197', label: 'export', kind: 'neutral',
      title: 'Export or pack board' });
    html += '<span id="board-export-processes-slot" class="board-export-processes-slot" aria-live="polite"></span>';
    html += '<button class="burger-menu-btn board-menu-btn" id="btn-board-menu" title="Extended board settings">' + BURGER_MENU_ICON_HTML + '</button>';
    html += '</div>';
    html += '</div>';
    var boardHeaderEl = _callDep('getElBoardHeader');
    boardHeaderEl.innerHTML = html;
    _callDep('applyTagStyleToEntity', boardHeaderEl, activeBoardData && activeBoardData.title ? activeBoardData.title : '');
    _callDep('loadTemplatesOnce');

    // Refresh board-header-lifetime cached refs
    $foldAllBtn = null;
    $foldAllCardsBtn = null;
    // $pinHeadersBtn removed — column headers always sticky
    $saveTrackingBtn = document.getElementById('btn-save-tracking');
    var paneFileTitleBtn = document.getElementById('btn-pane-file-title');
    var fileHeaderMenuBtn = document.getElementById('btn-file-header-menu');
    if (paneFileTitleBtn) {
      paneFileTitleBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (embeddedMode) _callDep('notifyParentPaneActivated');
      });
      paneFileTitleBtn.addEventListener('dblclick', function (e) {
        if (!hasBoardFile) return;
        e.preventDefault();
        e.stopPropagation();
        _callDep('renameActiveBoardFile');
      });
      paneFileTitleBtn.addEventListener('contextmenu', function (e) {
        e.preventDefault();
        e.stopPropagation();
        _callDep('showFilenameContextMenu', e.clientX, e.clientY);
      });
    }
    if (fileHeaderMenuBtn) {
      var _fileMenuOpen = false;
      fileHeaderMenuBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (_fileMenuOpen) return;
        _fileMenuOpen = true;
        _callDep('showFileHeaderSettingsMenu', fileHeaderMenuBtn).finally(function () {
          _fileMenuOpen = false;
        });
      });
    }

    // Pin headers button removed — always sticky
    // undo/redo and stats buttons removed from header (keyboard / bottom bar)
    if ($saveTrackingBtn) {
      $saveTrackingBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (!_callDep('getActiveBoardId') || !_callDep('getFullBoardData')) return;
        if (_callDep('isBoardDirty')) {
          _callDep('handleBoardAction', 'save-now');
          return;
        }
        _callDep('showSaveTrackingMenu', $saveTrackingBtn);
      });
      $saveTrackingBtn.addEventListener('contextmenu', function (e) {
        e.preventDefault();
        e.stopPropagation();
        _callDep('showSaveTrackingMenu', $saveTrackingBtn, e.clientX, e.clientY);
      });
    }
    // processes button removed from header (bottom bar tab)
    var themeZoomBtn = document.getElementById('btn-theme-zoom');
    if (themeZoomBtn) {
      themeZoomBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        _callDep('showThemeZoomMenu', themeZoomBtn);
      });
    }
    var createNewBtn = document.getElementById('btn-create-new');
    if (createNewBtn) {
      createNewBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        _callDep('showHeaderSourceDropdown', 'new', createNewBtn);
      });
    }
    var incomingBtn = document.getElementById('btn-incoming');
    if (incomingBtn) {
      incomingBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        _callDep('showIncomingItems', incomingBtn);
      });
    }
    var exportBtn = document.getElementById('btn-export');
    if (exportBtn) {
      exportBtn.addEventListener('click', async function () {
        await _callDep('triggerBoardExport');
      });
    }
    var parkedBtn = document.getElementById('btn-parked');
    if (parkedBtn) {
      parkedBtn.addEventListener('click', function () {
        _callDep('showParkedItems', parkedBtn);
      });
    }
    var archivedBtn = document.getElementById('btn-archived');
    if (archivedBtn) {
      archivedBtn.addEventListener('click', function () {
        _callDep('showArchivedItems', archivedBtn);
      });
    }
    var trashBtn = document.getElementById('btn-trash');
    if (trashBtn) {
      trashBtn.addEventListener('click', function () {
        _callDep('showDeletedItems', trashBtn);
      });
    }
    var boardMenuBtn = document.getElementById('btn-board-menu');
    if (boardMenuBtn) {
      boardMenuBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        var rect = boardMenuBtn.getBoundingClientRect();
        _callDep('showBoardContextMenu', rect.right, rect.bottom);
      });
    }
    boardHeaderEl.oncontextmenu = function (e) {
      e.preventDefault();
      e.stopPropagation();
      _callDep('showBoardContextMenu', e.clientX, e.clientY);
    };
    if (typeof window !== 'undefined' && window.LexeraExportProcesses &&
        typeof window.LexeraExportProcesses.syncMount === 'function') {
      window.LexeraExportProcesses.syncMount();
    }
    if (!_boardHeaderResizeBound) {
      _boardHeaderResizeBound = true;
      window.addEventListener('resize', refreshBoardHeaderActionStates);
    }
    refreshBoardHeaderActionStates();
  }

  // ─── getCreationEntityLabel ────────────────────────────────────────

  function getCreationEntityLabel(entityType) {
    var value = String(entityType || '').trim().toLowerCase();
    if (value === 'board') return 'Board';
    if (value === 'row') return 'Row';
    if (value === 'stack') return 'Stack';
    if (value === 'column') return 'Column';
    return 'Card';
  }

  // ─── getCreationEntityDragIconSvg ──────────────────────────────────

  function getCreationEntityDragIconSvg(entityType) {
    var value = String(entityType || '').trim().toLowerCase();
    if (value === 'board') {
      return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="1"></rect><rect x="6" y="6" width="5" height="5" rx="1"></rect><rect x="13" y="6" width="5" height="5" rx="1"></rect><rect x="6" y="13" width="12" height="5" rx="1"></rect></svg>';
    }
    if (value === 'row') {
      return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="6" rx="1"></rect><rect x="3" y="13" width="18" height="8" rx="1"></rect></svg>';
    }
    if (value === 'stack') {
      return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="4" height="18" rx="1"></rect><rect x="10" y="3" width="4" height="18" rx="1"></rect><rect x="17" y="3" width="4" height="18" rx="1"></rect></svg>';
    }
    if (value === 'column') {
      return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="4" width="13" height="11" rx="2" stroke-dasharray="4 2"></rect><rect x="9" y="9" width="13" height="11" rx="2"></rect></svg>';
    }
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"></rect><line x1="8" y1="9" x2="16" y2="9"></line><line x1="8" y1="13" x2="13" y2="13"></line></svg>';
  }

  // ─── buildCreationEntityDragIconHtml ───────────────────────────────

  function buildCreationEntityDragIconHtml(entityType, extraAttrs) {
    var value = String(entityType || '').trim().toLowerCase();
    if (value !== 'board' && value !== 'row' && value !== 'stack' && value !== 'column' && value !== 'card') value = 'card';
    var attrs = Array.isArray(extraAttrs) ? extraAttrs.join(' ') : '';
    if (attrs) attrs = ' ' + attrs;
    return '<span class="drag-grip entity-drag-icon entity-drag-icon-' + value + '"' + attrs + '>' +
      getCreationEntityDragIconSvg(value) +
      '</span>';
  }

  // ─── buildLayoutPresetMenuItems ────────────────────────────────────

  function buildLayoutPresetMenuItems() {
    var current = _callDep('getBoardSettingValue', 'layoutPreset', 'normal') || 'normal';
    var items = [
      { id: 'set-layout-preset:normal', label: (current === 'normal' ? '\u2713 ' : '') + 'Normal' },
      { id: 'set-layout-preset:spacious', label: (current === 'spacious' ? '\u2713 ' : '') + 'Spacious' }
    ];
    var presets = _callDep('getSavedLayoutPresets') || {};
    var presetNames = Object.keys(presets);
    if (presetNames.length > 0) {
      items.push({ separator: true });
      for (var i = 0; i < presetNames.length; i++) {
        var name = presetNames[i];
        items.push({ id: 'set-layout-preset:' + name, label: (current === name ? '\u2713 ' : '') + name });
      }
    }
    items.push({ separator: true });
    items.push({ id: 'save-layout-preset', label: 'Save Current as Preset\u2026' });
    if (presetNames.length > 0) {
      var deleteItems = [];
      for (var j = 0; j < presetNames.length; j++) {
        deleteItems.push({ id: 'delete-layout-preset:' + presetNames[j], label: presetNames[j] });
      }
      items.push({ id: 'delete-layout-preset', label: 'Delete Preset', items: deleteItems });
    }
    return items;
  }

  // ─── buildTagStyleRoleItems ────────────────────────────────────────

  function buildTagStyleRoleItems(normalizedTag) {
    var TAG_STYLE_ROLES = [
      { value: 'header', label: 'Header Bar' },
      { value: 'footer', label: 'Footer Bar' },
      { value: 'badge', label: 'Badge' },
      { value: 'border-only', label: 'Border Only' },
      { value: 'background', label: 'Background' },
      { value: 'effect', label: 'Effect' },
      { value: '', label: 'None' }
    ];
    var rawTag = normalizedTag.charAt(0) === '#' ? normalizedTag.substring(1) : normalizedTag;
    var categoryKey = _callDep('getTagCategoryKey', rawTag);
    var currentRole = categoryKey ? _callDep('getResolvedCategoryRole', categoryKey) : '';
    var items = [];
    for (var i = 0; i < TAG_STYLE_ROLES.length; i++) {
      var r = TAG_STYLE_ROLES[i];
      items.push({
        id: 'tag-style-role:' + r.value,
        label: (currentRole === r.value ? '\u2713 ' : '') + r.label
      });
    }
    if (categoryKey) {
      items.push({ separator: true });
      items.push({ id: 'tag-style-role-info', label: 'Category: ' + categoryKey, disabled: true });
    }
    return items;
  }

  // ─── buildHeaderCreationTemplateSubmenu ─────────────────────────────

  function buildHeaderCreationTemplateSubmenu(actionPrefix, entityType, templates) {
    var entityLabel = entityType.charAt(0).toUpperCase() + entityType.slice(1);
    var items = [];
    for (var i = 0; i < templates.length; i++) {
      items.push({
        id: actionPrefix + ':' + entityType + ':' + templates[i].id,
        label: templates[i].name || templates[i].id
      });
    }
    if (items.length === 0) {
      items.push({ id: actionPrefix + ':' + entityType + ':none', label: 'No templates available', disabled: true });
    }
    return {
      id: actionPrefix + '-submenu-' + entityType,
      label: entityLabel,
      items: items
    };
  }

  // ─── resolveHeaderCardCreationContext ──────────────────────────────

  function resolveHeaderCardCreationContext(mx, my) {
    if (!_callDep('getActiveBoardId') || !_callDep('getFullBoardData')) return null;
    var target = _callDep('resolveCardDropTarget', mx, my);
    if (!target || target.boardId !== _callDep('getActiveBoardId')) return null;
    if (
      target.kind === 'header-incoming' ||
      target.kind === 'header-park' ||
      target.kind === 'header-archive' ||
      target.kind === 'header-trash'
    ) {
      return null;
    }
    var rowId = target.rowId || null;
    var stackId = target.stackId || null;
    var columnId = target.columnId || null;
    var cardId = target.cardId || null;
    var insertBefore = typeof target.before === 'boolean' ? target.before : null;
    if (typeof target.flatColIndex === 'number') {
      return {
        flatColIndex: target.flatColIndex,
        rowIndex: typeof target.rowIndex === 'number' ? target.rowIndex : undefined,
        stackIndex: typeof target.stackIndex === 'number' ? target.stackIndex : undefined,
        colIndex: typeof target.colIndex === 'number' ? target.colIndex : undefined,
        rowId: rowId,
        stackId: stackId,
        columnId: columnId,
        cardId: cardId,
        before: insertBefore,
        atCardIndex: typeof target.insertIdx === 'number' ? target.insertIdx : undefined,
        insertMode: target.insertMode === 'full' ? 'full' : 'visible'
      };
    }
    if (
      typeof target.rowIndex === 'number' &&
      typeof target.stackIndex === 'number' &&
      typeof target.colIndex === 'number'
    ) {
      var flatColIdx = _callDep('resolveFlatColumnIndexForCreationDescriptor', {
        rowIndex: target.rowIndex,
        stackIndex: target.stackIndex,
        colIndex: target.colIndex,
        indexMode: target.indexMode || 'display'
      });
      if (flatColIdx >= 0) {
        return {
          flatColIndex: flatColIdx,
          rowIndex: target.rowIndex,
          stackIndex: target.stackIndex,
          colIndex: target.colIndex,
          rowId: rowId,
          stackId: stackId,
          columnId: columnId,
          cardId: cardId,
          before: insertBefore,
          atCardIndex: typeof target.insertIdx === 'number' ? target.insertIdx : undefined,
          insertMode: target.insertMode === 'full' ? 'full' : 'visible'
        };
      }
    }
    if (typeof target.rowIndex === 'number' && typeof target.stackIndex === 'number') {
      return {
        rowIndex: target.rowIndex,
        stackIndex: target.stackIndex,
        rowId: rowId,
        stackId: stackId,
        columnId: columnId,
        cardId: cardId,
        before: insertBefore,
        insertIdx: typeof target.insertIdx === 'number' ? target.insertIdx : undefined,
        insertMode: target.insertMode === 'full' ? 'full' : 'visible',
        indexMode: target.indexMode || 'display'
      };
    }
    if (typeof target.rowIndex === 'number') {
      return {
        rowIndex: target.rowIndex,
        rowId: rowId,
        before: insertBefore,
        insertIdx: typeof target.insertIdx === 'number' ? target.insertIdx : undefined,
        insertMode: target.insertMode === 'full' ? 'full' : 'visible',
        indexMode: target.indexMode || 'display'
      };
    }
    return null;
  }

  // ─── resolveHeaderColumnCreationContext ─────────────────────────────

  function resolveHeaderColumnCreationContext(mx, my) {
    if (!_callDep('getActiveBoardId') || !_callDep('getFullBoardData')) return null;

    var columnEl = _callDep('findDraggableColumnAt', mx, my);
    if (columnEl) {
      var columnRect = columnEl.getBoundingClientRect();
      var insertBefore = my < columnRect.top + columnRect.height / 2;
      var rowIdx = parseInt(columnEl.getAttribute('data-row-index'), 10);
      var stackIdx = parseInt(columnEl.getAttribute('data-stack-index'), 10);
      var displayColIdx = parseInt(columnEl.getAttribute('data-col-local-index'), 10);
      if (!isNaN(rowIdx) && !isNaN(stackIdx) && !isNaN(displayColIdx)) {
        var stack = _callDep('findFullDataStack', rowIdx, stackIdx);
        if (stack) {
          var atColIdx = _callDep('findInsertColumnIndexInStack', stack, displayColIdx, insertBefore);
          if (atColIdx >= 0) {
            return {
              rowIdx: rowIdx,
              stackIdx: stackIdx,
              rowId: String(columnEl.getAttribute('data-row-id') || '').trim() || null,
              stackId: String(columnEl.getAttribute('data-stack-id') || '').trim() || null,
              columnId: String(columnEl.getAttribute('data-column-id') || '').trim() || null,
              before: insertBefore,
              atColIdx: atColIdx
            };
          }
        }
      }
    }

    var stackEl = _callDep('findBoardStackAt', mx, my);
    if (stackEl) {
      var stackRowIdx = parseInt(stackEl.getAttribute('data-row-index'), 10);
      var stackIdx2 = parseInt(stackEl.getAttribute('data-stack-index'), 10);
      if (!isNaN(stackRowIdx) && !isNaN(stackIdx2)) {
        return {
          rowIdx: stackRowIdx,
          stackIdx: stackIdx2,
          rowId: String(stackEl.getAttribute('data-row-id') || '').trim() || null,
          stackId: String(stackEl.getAttribute('data-stack-id') || '').trim() || null
        };
      }
    }

    var treeColTarget = _callDep('getTreeColumnDropTarget', mx, my);
    var activeBoardId = _callDep('getActiveBoardId');
    if (treeColTarget && treeColTarget.boardId === activeBoardId) {
      if (treeColTarget.indexMode === 'full') {
        var fullInsert = treeColTarget.before ? treeColTarget.colIndex : (treeColTarget.colIndex + 1);
        return {
          rowIdx: treeColTarget.rowIndex,
          stackIdx: treeColTarget.stackIndex,
          rowId: treeColTarget.rowId || null,
          stackId: treeColTarget.stackId || null,
          columnId: treeColTarget.columnId || null,
          before: treeColTarget.before,
          atColIdx: fullInsert
        };
      }
      var targetStack = _callDep('findFullDataStack', treeColTarget.rowIndex, treeColTarget.stackIndex);
      if (targetStack) {
        var treeInsert = _callDep('findInsertColumnIndexInStack', targetStack, treeColTarget.colIndex, treeColTarget.before);
        if (treeInsert >= 0) {
          return {
            rowIdx: treeColTarget.rowIndex,
            stackIdx: treeColTarget.stackIndex,
            rowId: treeColTarget.rowId || null,
            stackId: treeColTarget.stackId || null,
            columnId: treeColTarget.columnId || null,
            before: treeColTarget.before,
            atColIdx: treeInsert
          };
        }
      }
    }

    var treeStackTarget = _callDep('getTreeStackDropTarget', mx, my);
    if (treeStackTarget && treeStackTarget.boardId === activeBoardId) {
      return {
        rowIdx: treeStackTarget.rowIndex,
        stackIdx: treeStackTarget.stackIndex,
        rowId: treeStackTarget.rowId || null,
        stackId: treeStackTarget.stackId || null
      };
    }

    var rowBodyTarget = _callDep('resolveRowBodyDropTarget', mx, my);
    if (rowBodyTarget && rowBodyTarget.boardId === activeBoardId) {
      return {
        rowIdx: rowBodyTarget.rowIndex,
        rowId: rowBodyTarget.rowId || null,
        indexMode: rowBodyTarget.indexMode || 'display'
      };
    }

    var rowTarget = _callDep('getRowDropTarget', mx, my);
    if (rowTarget && rowTarget.boardId === activeBoardId) {
      return {
        atIndex: rowTarget.before ? rowTarget.rowIndex : (rowTarget.rowIndex + 1),
        rowId: rowTarget.rowId || null,
        before: rowTarget.before
      };
    }

    var boardRect = _callDep('getElColumnsContainer').getBoundingClientRect();
    if (_callDep('isPointInsideRect', mx, my, boardRect)) {
      var activeBoardData = _callDep('getActiveBoardData');
      var visibleRows = (activeBoardData && Array.isArray(activeBoardData.rows)) ? activeBoardData.rows : [];
      return { atIndex: visibleRows.length };
    }

    return null;
  }

  // ─── resolveHeaderStackCreationContext ──────────────────────────────

  function resolveHeaderStackCreationContext(mx, my) {
    var activeBoardId = _callDep('getActiveBoardId');
    if (!activeBoardId) return null;

    var stackTarget = _callDep('getStackDropTarget', mx, my);
    if (stackTarget && stackTarget.boardId === activeBoardId) {
      var atStackIdx = stackTarget.before ? stackTarget.stackIndex : (stackTarget.stackIndex + 1);
      return {
        rowIdx: stackTarget.rowIndex,
        rowId: stackTarget.rowId || null,
        stackId: stackTarget.stackId || null,
        before: stackTarget.before,
        atStackIdx: atStackIdx
      };
    }

    var rowEl = _callDep('findNodeAtPoint', _callDep('getElColumnsContainer').querySelectorAll('.board-row'), mx, my);
    if (rowEl) {
      var rowIdx = parseInt(rowEl.getAttribute('data-row-index'), 10);
      if (!isNaN(rowIdx)) {
        return {
          rowIdx: rowIdx,
          rowId: String(rowEl.getAttribute('data-row-id') || '').trim() || null
        };
      }
    }

    var treeRow = _callDep('findNodeAtPoint', _callDep('getElBoardList').querySelectorAll('.tree-node[data-tree-drag="tree-row"]'), mx, my);
    if (treeRow) {
      var rowBoardId = treeRow.getAttribute('data-board-id') || activeBoardId;
      var treeRowIdx = parseInt(treeRow.getAttribute('data-row-index'), 10);
      if (rowBoardId === activeBoardId && !isNaN(treeRowIdx)) {
        return {
          rowIdx: treeRowIdx,
          rowId: String(treeRow.getAttribute('data-row-id') || '').trim() || null
        };
      }
    }

    return null;
  }

  // ─── resolveHeaderRowCreationContext ────────────────────────────────

  function resolveHeaderRowCreationContext(mx, my) {
    var activeBoardId = _callDep('getActiveBoardId');
    if (!activeBoardId) return null;
    var rowTarget = _callDep('getRowDropTarget', mx, my);
    if (rowTarget && rowTarget.boardId === activeBoardId) {
      var atIndex = rowTarget.before ? rowTarget.rowIndex : (rowTarget.rowIndex + 1);
      return {
        atIndex: atIndex,
        rowId: rowTarget.rowId || null,
        before: rowTarget.before
      };
    }

    var boardRect = _callDep('getElColumnsContainer').getBoundingClientRect();
    if (_callDep('isPointInsideRect', mx, my, boardRect)) {
      var activeBoardData = _callDep('getActiveBoardData');
      var visibleRows = (activeBoardData && Array.isArray(activeBoardData.rows)) ? activeBoardData.rows : [];
      return { atIndex: visibleRows.length };
    }

    return null;
  }

  // ─── resolveHeaderCreationDropTarget ───────────────────────────────

  function resolveHeaderCreationDropTarget(mx, my) {
    if (!_callDep('getActiveBoardId') || !_callDep('getFullBoardData')) return null;

    var cardContext = resolveHeaderCardCreationContext(mx, my);
    if (cardContext) return { entityType: 'card', context: cardContext };

    var columnContext = resolveHeaderColumnCreationContext(mx, my);
    if (columnContext) return { entityType: 'column', context: columnContext };

    var stackContext = resolveHeaderStackCreationContext(mx, my);
    if (stackContext) return { entityType: 'stack', context: stackContext };

    var rowContext = resolveHeaderRowCreationContext(mx, my);
    if (rowContext) return { entityType: 'row', context: rowContext };

    return null;
  }

  // ─── resolveHeaderDropTag ──────────────────────────────────────────

  function resolveHeaderDropTag(mx, my) {
    return _callDep('DragDropHandlers_resolveHeaderDropTag', mx, my);
  }

  // ─── clearHeaderCreationDragVisuals ────────────────────────────────

  function clearHeaderCreationDragVisuals() {
    _callDep('removeStackDropZones');
    _callDep('removeDropZoneIndicators');
    _callDep('clearPtrDropIndicators');
    _callDep('clearCardDropIndicators');
    _callDep('clearSidebarDropHighlights');
    _callDep('clearCardDragOverHighlights');
    _callDep('clearHeaderDropTargetHighlights');
  }

  // ─── getHeaderCreationDragIndicatorType ────────────────────────────

  function getHeaderCreationDragIndicatorType(entityType) {
    if (entityType === 'card') return 'tree-card';
    if (entityType === 'column') return 'column';
    if (entityType === 'stack') return 'board-stack';
    if (entityType === 'row') return 'board-row';
    return null;
  }

  // ─── updateHeaderCreationDragVisualsForTarget ──────────────────────

  function updateHeaderCreationDragVisualsForTarget(target, mx, my) {
    _callDep('clearPtrDropIndicators');
    _callDep('clearCardDropIndicators');
    _callDep('clearSidebarDropHighlights');
    _callDep('clearCardDragOverHighlights');
    _callDep('clearDropZoneIndicatorHighlights');
    _callDep('clearHeaderDropTargetHighlights');
    if (!target) return false;

    if (target.entityType === 'card') {
      var highlightedCard = _callDep('updateCardDropTarget', mx, my);
      _callDep('clearHeaderDropTargetHighlights');
      return highlightedCard;
    }

    if (target.entityType === 'column') {
      var highlightedColumn = _callDep('updatePtrDropTargetByType', 'column', mx, my);
      _callDep('clearHeaderDropTargetHighlights');
      return highlightedColumn;
    }

    if (target.entityType === 'stack') {
      var highlightedStack = _callDep('updatePtrDropTargetByType', 'board-stack', mx, my);
      _callDep('clearHeaderDropTargetHighlights');
      return highlightedStack;
    }

    if (target.entityType === 'row') {
      var highlightedRow = _callDep('updatePtrDropTargetByType', 'board-row', mx, my);
      _callDep('clearHeaderDropTargetHighlights');
      return highlightedRow;
    }

    return false;
  }

  // ─── getHeaderCreationDragLabel ────────────────────────────────────

  function getHeaderCreationDragLabel(mode, target) {
    var base = mode === 'empty' ? 'Empty' : (mode === 'template' ? 'Template' : 'Clipboard');
    if (!target || !target.entityType) return base;
    return base + ' ' + target.entityType.charAt(0).toUpperCase() + target.entityType.slice(1);
  }

  // ─── attachHeaderCreationDragSource ────────────────────────────────

  function attachHeaderCreationDragSource(btn, mode) {
    if (!btn) return;
    btn.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      if (!_callDep('getActiveBoardId') || !_callDep('getFullBoardData')) return;
      if (_callDep('getPtrDrag') || _callDep('getCardDrag')) return;

      var DRAG_THRESHOLD = _dep('DRAG_THRESHOLD') || 5;
      var startX = e.clientX;
      var startY = e.clientY;
      var started = false;
      var ghost = null;
      var currentTarget = null;
      var currentIndicatorType = null;

      function setIndicatorForEntity(entityType) {
        var nextIndicatorType = getHeaderCreationDragIndicatorType(entityType);
        if (nextIndicatorType === currentIndicatorType) return;
        _callDep('removeStackDropZones');
        _callDep('removeDropZoneIndicators');
        currentIndicatorType = nextIndicatorType;
        if (!nextIndicatorType) return;
        if (nextIndicatorType === 'column') _callDep('insertStackDropZones');
        _callDep('insertDropZoneIndicators', nextIndicatorType);
      }

      function onMove(ev) {
        var dx = ev.clientX - startX;
        var dy = ev.clientY - startY;
        if (!started) {
          if ((dx * dx + dy * dy) < DRAG_THRESHOLD * DRAG_THRESHOLD) return;
          started = true;
          btn.classList.add('dragging');
          ghost = document.createElement('div');
          ghost.className = 'card-drag-ghost';
          ghost.textContent = getHeaderCreationDragLabel(mode, null);
          ghost.style.left = (ev.clientX + 8) + 'px';
          ghost.style.top = (ev.clientY - 12) + 'px';
          document.body.appendChild(ghost);
          var sel = window.getSelection();
          if (sel) sel.removeAllRanges();
        }

        if (ghost) {
          ghost.style.left = (ev.clientX + 8) + 'px';
          ghost.style.top = (ev.clientY - 12) + 'px';
        }

        currentTarget = resolveHeaderCreationDropTarget(ev.clientX, ev.clientY);
        setIndicatorForEntity(currentTarget ? currentTarget.entityType : null);
        updateHeaderCreationDragVisualsForTarget(currentTarget, ev.clientX, ev.clientY);
        if (ghost) ghost.textContent = getHeaderCreationDragLabel(mode, currentTarget);
      }

      function cleanup() {
        btn.classList.remove('dragging');
        if (ghost) ghost.remove();
        ghost = null;
        clearHeaderCreationDragVisuals();
      }

      function onUp(ev) {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        document.removeEventListener('pointercancel', onCancel);
        if (!started) return;
        _callDep('setSuppressHeaderCreationClickUntil', Date.now() + 500);
        ev.preventDefault();
        ev.stopPropagation();
        var dropTarget = resolveHeaderCreationDropTarget(ev.clientX, ev.clientY) || currentTarget;
        cleanup();
        _callDep('applyHeaderCreationDragDrop', mode, dropTarget, ev.clientX, ev.clientY).catch(function (err) {
          _callDep('logFrontendIssue', 'error', 'header.creation.drag', 'Drop apply failed', err);
          _callDep('showNotification', 'Creation drop failed');
        });
      }

      function onCancel() {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        document.removeEventListener('pointercancel', onCancel);
        if (!started) return;
        cleanup();
      }

      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
      document.addEventListener('pointercancel', onCancel);
    });
  }

  // ─── refreshBoardHeaderActionStates ────────────────────────────────

  function refreshBoardHeaderActionStates() {
    var boardHeaderEl = _callDep('getElBoardHeader');
    var headerWidth = 0;
    if (boardHeaderEl) {
      var headerRect = boardHeaderEl.getBoundingClientRect();
      headerWidth = isFinite(headerRect.width) ? Math.round(headerRect.width) : 0;
    }
    var compactMode = !!(
      typeof window !== 'undefined' &&
      (window.innerWidth <= BOARD_HEADER_COMPACT_WIDTH ||
        (headerWidth > 0 && headerWidth <= BOARD_HEADER_COMPACT_HEADER_WIDTH))
    );

    var createNewBtn = document.getElementById('btn-create-new');
    var incomingBtn = document.getElementById('btn-incoming');
    var parkedBtn = document.getElementById('btn-parked');
    var archivedBtn = document.getElementById('btn-archived');
    var trashBtn = document.getElementById('btn-trash');
    var runningProcessesBtn = document.getElementById('btn-running-processes');
    var themeZoomBtn = document.getElementById('btn-theme-zoom');
    var exportBtn = document.getElementById('btn-export');

    var parkedCount = _callDep('getParkedCount');
    var archivedCount = _callDep('getArchivedCount');
    var deletedCount = _callDep('getDeletedCount');
    var incomingCount = _callDep('getIncomingCount');

    function setHeaderActionLabel(btn, fullLabel, compactLabel, title) {
      if (!btn) return;
      btn.textContent = compactMode ? compactLabel : fullLabel;
      btn.classList.toggle('icon-only', compactMode);
      btn.setAttribute('aria-label', fullLabel);
      if (title) btn.title = title;
    }

    function applyHeaderLabelsForMode() {
      if (boardHeaderEl) boardHeaderEl.classList.toggle('board-header-compact', compactMode);

      setHeaderActionLabel(createNewBtn, 'New', BOARD_HEADER_V1_COMPACT_ICONS.createEmpty, 'Create new row, stack, column or card');

      setHeaderActionLabel(
        incomingBtn,
        'Incoming' + (incomingCount > 0 ? ' (' + incomingCount + ')' : ''),
        BOARD_HEADER_V1_COMPACT_ICONS.incoming,
        'Incoming (clipboard-fed)'
      );
      setHeaderActionLabel(
        parkedBtn,
        'Park' + (parkedCount > 0 ? ' (' + parkedCount + ')' : ''),
        BOARD_HEADER_V1_COMPACT_ICONS.parked,
        'Show parked items — drop cards here to park'
      );
      setHeaderActionLabel(
        archivedBtn,
        'Archive' + (archivedCount > 0 ? ' (' + archivedCount + ')' : ''),
        BOARD_HEADER_V1_COMPACT_ICONS.archived,
        'Show archived items — drop cards here to archive'
      );
      setHeaderActionLabel(
        trashBtn,
        'Trash' + (deletedCount > 0 ? ' (' + deletedCount + ')' : ''),
        BOARD_HEADER_V1_COMPACT_ICONS.trash,
        'Show deleted items — drop cards here to delete'
      );
      if (incomingBtn) incomingBtn.classList.toggle('has-items', incomingCount > 0);
      if (parkedBtn) parkedBtn.classList.toggle('has-items', parkedCount > 0);
      if (archivedBtn) archivedBtn.classList.toggle('has-items', archivedCount > 0);
      if (trashBtn) trashBtn.classList.toggle('has-items', deletedCount > 0);

      var allColumnsFolded = _callDep('areAllColumnsFolded');
      var allCardsCollapsed = _callDep('areAllCardsCollapsed');
      var isCanvasLayout = _callDep('isCanvasBoardLayout');
      if ($foldAllBtn) $foldAllBtn.style.display = isCanvasLayout ? 'none' : '';
      if ($foldAllCardsBtn) $foldAllCardsBtn.style.display = isCanvasLayout ? 'none' : '';
      if (!isCanvasLayout) {
        setHeaderActionLabel(
          $foldAllBtn,
          allColumnsFolded ? 'Unfold Columns' : 'Fold Columns',
          allColumnsFolded ? BOARD_HEADER_V1_COMPACT_ICONS.foldColumnsCollapsed : BOARD_HEADER_V1_COMPACT_ICONS.foldColumnsExpanded,
          'Fold/unfold all columns'
        );
        setHeaderActionLabel(
          $foldAllCardsBtn,
          allCardsCollapsed ? 'Unfold Cards' : 'Fold Cards',
          allCardsCollapsed ? BOARD_HEADER_V1_COMPACT_ICONS.foldCardsCollapsed : BOARD_HEADER_V1_COMPACT_ICONS.foldCardsExpanded,
          'Collapse or expand all cards'
        );
      }

      setHeaderActionLabel(runningProcessesBtn, 'Processes', BOARD_HEADER_V1_COMPACT_ICONS.processes, 'Open running processes and logs');
      setHeaderActionLabel(themeZoomBtn, 'Themes / Zoom', BOARD_HEADER_V1_COMPACT_ICONS.themeZoom, 'Visual style and zoom controls');
      setHeaderActionLabel(exportBtn, 'Export / Pack', BOARD_HEADER_V1_COMPACT_ICONS.exportPack, 'Export or pack board');

      if ($saveTrackingBtn) {
        var dirty = _callDep('isBoardDirty');
        var headerSavingInProgress = _callDep('getHeaderSavingInProgress');
        var saveLabel = headerSavingInProgress ? 'Saving...' : (dirty ? 'Save*' : 'Saved');
        var saveIcon = headerSavingInProgress ? '\u2026' : (dirty ? '\u25CF' : '\u2713');
        setHeaderActionLabel($saveTrackingBtn, saveLabel, saveIcon, 'Save now and inspect change tracking');
        $saveTrackingBtn.classList.toggle('has-items', dirty || headerSavingInProgress);
        $saveTrackingBtn.disabled = headerSavingInProgress;
      }
    }

    function headerActionsOverflowing() {
      if (!boardHeaderEl) return false;
      var tolerance = 4;
      var actionGroups = boardHeaderEl.querySelectorAll('.board-header-actions-middle, .board-header-actions-right');
      for (var i = 0; i < actionGroups.length; i++) {
        if (!actionGroups[i]) continue;
        if ((actionGroups[i].scrollWidth - actionGroups[i].clientWidth) > tolerance) return true;
      }
      return false;
    }

    applyHeaderLabelsForMode();

    if (!compactMode && headerActionsOverflowing()) {
      compactMode = true;
      applyHeaderLabelsForMode();
    }
  }

  // ─── Init ─────────────────────────────────────────────────────────

  function init(deps) {
    if (!deps) return;
    var keys = Object.keys(deps);
    for (var i = 0; i < keys.length; i++) {
      var desc = Object.getOwnPropertyDescriptor(deps, keys[i]);
      if (desc && (desc.get || desc.set)) {
        Object.defineProperty(_deps, keys[i], desc);
      } else {
        _deps[keys[i]] = deps[keys[i]];
      }
    }
  }

  // ─── Public API ───────────────────────────────────────────────────

  return {
    init: init,
    renderBoardHeader: renderBoardHeader,
    refreshBoardHeaderActionStates: refreshBoardHeaderActionStates,
    attachHeaderCreationDragSource: attachHeaderCreationDragSource,
    getHeaderCreationDragLabel: getHeaderCreationDragLabel,
    getHeaderCreationDragIndicatorType: getHeaderCreationDragIndicatorType,
    updateHeaderCreationDragVisualsForTarget: updateHeaderCreationDragVisualsForTarget,
    clearHeaderCreationDragVisuals: clearHeaderCreationDragVisuals,
    resolveHeaderCardCreationContext: resolveHeaderCardCreationContext,
    resolveHeaderColumnCreationContext: resolveHeaderColumnCreationContext,
    resolveHeaderRowCreationContext: resolveHeaderRowCreationContext,
    resolveHeaderStackCreationContext: resolveHeaderStackCreationContext,
    resolveHeaderCreationDropTarget: resolveHeaderCreationDropTarget,
    resolveHeaderDropTag: resolveHeaderDropTag,
    getCreationEntityLabel: getCreationEntityLabel,
    getCreationEntityDragIconSvg: getCreationEntityDragIconSvg,
    buildCreationEntityDragIconHtml: buildCreationEntityDragIconHtml,
    buildHeaderCreationTemplateSubmenu: buildHeaderCreationTemplateSubmenu,
    buildLayoutPresetMenuItems: buildLayoutPresetMenuItems,
    buildTagStyleRoleItems: buildTagStyleRoleItems
  };
})();
if (typeof globalThis !== 'undefined') globalThis.LexeraBoardHeader = LexeraBoardHeader;
if (typeof window !== 'undefined') window.LexeraBoardHeader = LexeraBoardHeader;
