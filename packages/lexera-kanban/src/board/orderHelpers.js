/**
 * LexeraOrderHelpers — Order helpers extracted from LexeraDashboard.
 *
 * Provides: title processing, layout helpers, include-path helpers,
 * fold-state helpers, reorder/sort, sidebar resize, tab indent,
 * transient UI, embedded-pane helpers, workspace shell, file rename,
 * search controls, dashboard state and rendering.
 *
 * IIFE module — no const/let, no ES imports.
 */
var LexeraOrderHelpers = (function () {
  'use strict';

  var _global = typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : typeof self !== 'undefined' ? self : {};

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

  // ─── Title / HTML-comment helpers ──────────────────────────────────────

  function extractHtmlComments(text) {
    var matches = String(text || '').match(/<!--[\s\S]*?-->/g);
    return matches ? matches.slice() : [];
  }

  function stripHtmlComments(text) {
    return String(text || '')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n[ \t]+/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function rebuildTitleWithPreservedComments(userInput, originalTitle) {
    var cleanTitle = stripHtmlComments(userInput);
    var comments = extractHtmlComments(originalTitle);
    if (comments.length === 0) return cleanTitle;
    return ((cleanTitle ? cleanTitle + ' ' : '') + comments.join(' ')).trim();
  }

  // ─── Board layout helpers ─────────────────────────────────────────────

  function normalizeBoardLayoutValue(value) {
    return _callDep('getCanvasModeHelpers').normalizeBoardLayoutValue(value);
  }

  function normalizeCanvasGridValue(value) {
    return _callDep('getCanvasModeHelpers').normalizeCanvasGridValue(value);
  }

  function getCurrentBoardLayout() {
    if (_dep('embeddedForcedBoardLayout') === 'canvas') return 'canvas';
    if (_dep('embeddedForcedBoardLayout') === 'kanban') return 'kanban';
    return normalizeBoardLayoutValue(_callDep('getBoardSettingValue', 'boardLayout', 'kanban'));
  }

  function isCanvasBoardLayout() {
    return getCurrentBoardLayout() === 'canvas';
  }

  function normalizeCanvasStackDirection(value) {
    var normalized = String(value == null ? '' : value).trim().toLowerCase();
    if (normalized === 'horizontal') normalized = 'row';
    if (normalized === 'vertical') normalized = 'column';
    return normalized === 'row' ? 'row' : 'column';
  }

  // ─── Tag/layout-tag helpers ───────────────────────────────────────────

  function stripLayoutTags(title) {
    return _dep('LexeraTagSystem').stripLayoutTags(title);
  }

  function stripStackTag(title) {
    return _dep('LexeraTagSystem').stripLayoutTags(title);
  }

  function stripLegacyImportStructureTags(title) {
    return _dep('LexeraTagSystem').stripLegacyStructureTags(title);
  }

  function isColumnHeaderTagged(title) {
    return _callDep('hasTag', String(title || ''), '#header');
  }

  function isColumnFooterTagged(title) {
    return _callDep('hasTag', String(title || ''), '#footer');
  }

  function getDisplayOrderedColumnEntries(columns, options) {
    options = options || {};
    var includeHidden = !!options.includeHidden;
    var headerEntries = [];
    var middleEntries = [];
    var footerEntries = [];
    var list = Array.isArray(columns) ? columns : [];
    for (var i = 0; i < list.length; i++) {
      var col = list[i];
      if (!col) continue;
      if (!includeHidden && _callDep('is_archived_or_deleted', col.title || '')) continue;
      var entry = { col: col, fullIndex: i };
      var hasHeader = isColumnHeaderTagged(col.title || '');
      var hasFooter = isColumnFooterTagged(col.title || '');
      if (hasHeader && !hasFooter) headerEntries.push(entry);
      else if (hasFooter && !hasHeader) footerEntries.push(entry);
      else middleEntries.push(entry);
    }
    return headerEntries.concat(middleEntries, footerEntries);
  }

  // ─── Include-path helpers ─────────────────────────────────────────────

  function extractIncludePathFromTitle(title) {
    var match = String(title || '').match(/!!!include\(([^)]+)\)!!!/i);
    return match ? String(match[1] || '').trim() : '';
  }

  function removeIncludeSyntaxFromTitle(title) {
    return String(title || '')
      .replace(/!!!include\([^)]+\)!!!/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function addIncludeSyntaxToTitle(title, filePath) {
    var cleanTitle = removeIncludeSyntaxFromTitle(title);
    var cleanPath = String(filePath || '').trim();
    return ((cleanTitle ? cleanTitle + ' ' : '') + '!!!include(' + cleanPath + ')!!!').trim();
  }

  function suggestIncludePathForColumn(title) {
    var base = removeIncludeSyntaxFromTitle(stripLayoutTags(_callDep('stripInternalHiddenTags', title || '')))
      .replace(/[^\w.-]+/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase();
    return './' + (base || 'column') + '.md';
  }

  // ─── Column layout tags ───────────────────────────────────────────────

  function getColumnLayoutTags(title) {
    var t = _dep('LexeraTagSystem').extractLayoutTags(title);
    return {
      row: t.rowRaw || '',
      span: t.spanRaw || '',
      stack: t.stack,
      header: t.header,
      footer: t.footer,
      wipLimit: t.wip || 0
    };
  }

  function getElementSizeTag(title, tagName) {
    return _dep('LexeraTagSystem').getElementSizeTag(title, tagName);
  }

  function getLegacyImportRowNumber(title) {
    var tags = getColumnLayoutTags(title);
    if (!tags.row) return 1;
    var match = tags.row.match(/\d+/);
    if (!match) return 1;
    var parsed = parseInt(match[0], 10);
    return isFinite(parsed) && parsed > 0 ? parsed : 1;
  }

  function buildRowsFromLegacyColumns(cols, fallbackTitle) {
    var list = Array.isArray(cols) ? cols : [];
    if (list.length === 0) return [];

    var rowsByNumber = {};
    var rowNumbers = [];
    for (var i = 0; i < list.length; i++) {
      var col = list[i];
      if (!col) continue;
      var rowNumber = getLegacyImportRowNumber(col.title || '');
      if (!rowsByNumber[rowNumber]) {
        rowsByNumber[rowNumber] = [];
        rowNumbers.push(rowNumber);
      }
      rowsByNumber[rowNumber].push({
        col: Object.assign({}, col, {
          title: stripLegacyImportStructureTags(col.title || '')
        }),
        stack: !!getColumnLayoutTags(col.title || '').stack
      });
    }

    rowNumbers.sort(function (a, b) { return a - b; });
    var multipleRows = rowNumbers.length > 1 || (rowNumbers.length === 1 && rowNumbers[0] !== 1);
    var rows = [];
    for (var r = 0; r < rowNumbers.length; r++) {
      var rn = rowNumbers[r];
      var entries = rowsByNumber[rn] || [];
      var groups = [];
      for (var j = 0; j < entries.length; j++) {
        if (entries[j].stack && groups.length > 0) groups[groups.length - 1].push(entries[j].col);
        else groups.push([entries[j].col]);
      }

      var stacks = [];
      for (var g = 0; g < groups.length; g++) {
        var baseTitle = groups[g][0] && groups[g][0].title ? groups[g][0].title.trim() : '';
        stacks.push({
          id: 'stack-' + Date.now() + '-' + r + '-' + g,
          title: baseTitle || ('Stack ' + (g + 1)),
          columns: groups[g]
        });
      }

      rows.push({
        id: 'row-' + Date.now() + '-' + r,
        title: multipleRows ? ('Row ' + rn) : (fallbackTitle || 'Default'),
        stacks: stacks
      });
    }
    return rows;
  }

  function reconstructColumnTitle(userInput, originalTitle) {
    return _dep('LexeraTagSystem').reconstructTitle(userInput, originalTitle);
  }

  // ─── Column span helpers ──────────────────────────────────────────────

  function toggleColumnWidth(colIndex) {
    if (!_dep('fullBoardData') || !_dep('activeBoardId')) return;
    var col = _callDep('getFullColumn', colIndex);
    if (!col) return;
    var title = col.title || '';
    var layout = getColumnLayoutTags(title);
    var currentSpan = layout.span ? parseInt(layout.span.match(/\d+/)[0], 10) : 1;
    var nextSpan = (currentSpan % 4) + 1;
    var newTitle = title.replace(/#span\d+\b/gi, '').replace(/\s+/g, ' ').trim();
    if (nextSpan > 1) newTitle = newTitle + ' #span' + nextSpan;
    if (newTitle === title) return;
    _callDep('pushUndo');
    col.title = newTitle;
    return _callDep('persistBoardMutation', { refreshMainView: true, refreshSidebar: true });
  }

  function setColumnSpan(colIndex, span) {
    if (!_dep('fullBoardData') || !_dep('activeBoardId')) return;
    var col = _callDep('getFullColumn', colIndex);
    if (!col) return;
    var title = col.title || '';
    var layout = getColumnLayoutTags(title);
    var currentSpan = layout.span ? parseInt(layout.span.match(/\d+/)[0], 10) : 1;
    if (span === currentSpan) return;
    var newTitle = title.replace(/#span\d+\b/gi, '').replace(/\s+/g, ' ').trim();
    if (span > 1) newTitle = newTitle + ' #span' + span;
    _callDep('pushUndo');
    col.title = newTitle;
    return _callDep('persistBoardMutation', { refreshMainView: true, refreshSidebar: true });
  }

  // ─── Ordering / sorting helpers ───────────────────────────────────────

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

  // ─── Fold-state helpers (delegated to foldState module) ───────────────

  function getFoldedColumns(boardId) {
    return _callDep('getFoldStateApi').getFoldedColumns(boardId, localStorage);
  }

  function getFoldedItems(boardId, kind) {
    return _callDep('getFoldStateApi').getFoldedItems(boardId, kind, localStorage);
  }

  function normalizeFoldStorageList(values) {
    return _callDep('getFoldStateApi').normalizeFoldStorageList(values);
  }

  function getRowFoldKey(row, rowIdx) {
    return _callDep('getFoldStateApi').getRowFoldKey(row, rowIdx);
  }

  function getStackFoldKey(stack, rowIdx, stackIdx) {
    return _callDep('getFoldStateApi').getStackFoldKey(stack, rowIdx, stackIdx);
  }

  function getColumnFoldKey(col, rowIdx, stackIdx, colLocalIdx, colFullIdx) {
    return _callDep('getFoldStateApi').getColumnFoldKey(col, rowIdx, stackIdx, colLocalIdx, colFullIdx);
  }

  function hasSavedFoldMatch(savedValues, foldKey, legacyValue) {
    return _callDep('getFoldStateApi').hasSavedFoldMatch(savedValues, foldKey, legacyValue);
  }

  function saveFoldState(boardId) {
    return _callDep('getFoldStateApi').saveFoldState(boardId, {
      storage: localStorage,
      container: _callDep('getElColumnsContainer')
    });
  }

  function setDirectChildFoldState(parentEl, childClassName, folded) {
    if (!parentEl) return;
    for (var i = 0; i < parentEl.children.length; i++) {
      var child = parentEl.children[i];
      if (!child || !child.classList || !child.classList.contains(childClassName)) continue;
      if (folded) child.classList.add('folded');
      else child.classList.remove('folded');
    }
  }

  function setColumnChildrenFoldState(columnEl, folded) {
    if (isCanvasBoardLayout()) return;
    if (!columnEl) return;
    var cards = columnEl.querySelectorAll('.card');
    for (var i = 0; i < cards.length; i++) {
      cards[i].classList.toggle('collapsed', folded);
      var t = cards[i].querySelector('.card-collapse-toggle');
      if (t) t.classList.toggle('expanded', !folded);
    }
  }

  function setRowChildrenFoldState(rowEl, folded) {
    if (!rowEl) return;
    if (isCanvasBoardLayout()) return;
    var rowContent = rowEl.querySelector('.board-row-content');
    if (!rowContent) return;
    setDirectChildFoldState(rowContent, 'board-stack', folded);
    var columns = rowEl.querySelectorAll('.column');
    for (var i = 0; i < columns.length; i++) {
      if (folded) columns[i].classList.add('folded');
      else columns[i].classList.remove('folded');
      setColumnChildrenFoldState(columns[i], folded);
    }
    _callDep('saveCardCollapseState', _dep('activeBoardId'));
  }

  function setStackChildrenFoldState(stackEl, folded) {
    if (isCanvasBoardLayout()) return;
    if (!stackEl) return;
    var stackContent = stackEl.querySelector('.board-stack-content');
    if (!stackContent) return;
    setDirectChildFoldState(stackContent, 'column', folded);
    var columns = stackEl.querySelectorAll('.column');
    for (var i = 0; i < columns.length; i++) {
      setColumnChildrenFoldState(columns[i], folded);
    }
    _callDep('saveCardCollapseState', _dep('activeBoardId'));
  }

  function toggleColumnFoldElement(columnEl, childrenOnly) {
    return _callDep('getFoldStateApi').toggleColumnFoldElement(columnEl, childrenOnly, {
      boardId: _dep('activeBoardId'),
      storage: localStorage,
      container: _callDep('getElColumnsContainer'),
      isCanvasBoardLayout: isCanvasBoardLayout,
      setColumnChildrenFoldState: setColumnChildrenFoldState,
      saveCardCollapseState: _dep('saveCardCollapseState'),
      saveFoldState: saveFoldState,
      refreshBoardHeaderActionStates: _dep('refreshBoardHeaderActionStates')
    });
  }

  function toggleStackFoldElement(stackEl, childrenOnly) {
    if (isCanvasBoardLayout()) return false;
    if (!stackEl) return false;
    if (childrenOnly) {
      var anyChildUnfolded = !!stackEl.querySelector('.column:not(.folded)');
      setStackChildrenFoldState(stackEl, anyChildUnfolded);
    } else {
      var nowFolded = !stackEl.classList.contains('folded');
      stackEl.classList.toggle('folded', nowFolded);
    }
    saveFoldState(_dep('activeBoardId'));
    _callDep('refreshBoardHeaderActionStates');
    return true;
  }

  function toggleRowFoldElement(rowEl, childrenOnly) {
    if (!rowEl) return false;
    if (childrenOnly && isCanvasBoardLayout()) return false;
    if (childrenOnly) {
      var anyChildUnfolded = !!rowEl.querySelector('.board-stack:not(.folded)');
      setRowChildrenFoldState(rowEl, anyChildUnfolded);
    } else {
      var nowFolded = !rowEl.classList.contains('folded');
      rowEl.classList.toggle('folded', nowFolded);
    }
    saveFoldState(_dep('activeBoardId'));
    _callDep('refreshBoardHeaderActionStates');
    return true;
  }

  // ─── Reorder helpers ──────────────────────────────────────────────────

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

  function reorderBoards(sourceIdx, targetIdx, insertBefore) {
    var orderedBoards = getOrderedItems(_dep('boards'), 'lexera-board-order', function (b) { return b.id; });
    var newOrder = reorderItems(orderedBoards, sourceIdx, targetIdx, insertBefore);
    saveOrder(newOrder, 'lexera-board-order', function (b) { return b.id; });
    _callDep('renderBoardList');
  }

  // ─── DOM / event helpers ──────────────────────────────────────────────

  function targetClosest(target, selector) {
    if (!target) return null;
    if (typeof target.closest === 'function') return target.closest(selector);
    var el = target.nodeType === 1 ? target : target.parentElement;
    if (!el || typeof el.closest !== 'function') return null;
    return el.closest(selector);
  }

  function normalizeDroppedPath(path) {
    if (!path) return '';
    var p = String(path).trim();
    if (!p) return '';
    if (p.indexOf('file://') === 0) {
      try {
        var u = new URL(p);
        p = decodeURIComponent(u.pathname || '');
        if (/^\/[A-Za-z]:\//.test(p)) p = p.slice(1);
      } catch (e) {
        // keep original string
      }
    }
    return p;
  }

  function isMarkdownPath(path) {
    return /\.md$/i.test(path || '');
  }

  function isAbsoluteLikePath(path) {
    return path.indexOf('/') === 0 || /^[A-Za-z]:[\\/]/.test(path) || path.indexOf('\\\\') === 0;
  }

  function isPositionInsideElement(pos, el) {
    if (!pos || !el) return false;
    var rect = el.getBoundingClientRect();
    var x = pos.x;
    var y = pos.y;
    if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return true;
    var dpr = window.devicePixelRatio || 1;
    if (dpr > 1) {
      var lx = x / dpr;
      var ly = y / dpr;
      if (lx >= rect.left && lx <= rect.right && ly >= rect.top && ly <= rect.bottom) return true;
    }
    return false;
  }

  function parseDroppedUriList(text) {
    if (!text) return [];
    var lines = text.split(/\r?\n/);
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line || line.indexOf('#') === 0) continue;
      out.push(line);
    }
    return out;
  }

  function collectDroppedPathsFromDataTransfer(dt) {
    if (!dt) return [];
    var out = [];
    var files = dt.files || [];
    for (var i = 0; i < files.length; i++) {
      var p = files[i].path || '';
      if (p) out.push(p);
    }
    if (typeof dt.getData === 'function') {
      var uriList = dt.getData('text/uri-list');
      if (uriList) {
        var parsed = parseDroppedUriList(uriList);
        for (var j = 0; j < parsed.length; j++) out.push(parsed[j]);
      }
      var plain = dt.getData('text/plain');
      if (plain && (plain.indexOf('file://') === 0 || isAbsoluteLikePath(plain))) out.push(plain);
    }
    return out;
  }

  function addBoardsByPath(paths) {
    if (_dep('hierarchyLocked') || !paths || paths.length === 0) return;
    var seen = {};
    var mdFiles = [];
    for (var i = 0; i < paths.length; i++) {
      var normalized = normalizeDroppedPath(paths[i]);
      if (!normalized) continue;
      if (!isAbsoluteLikePath(normalized)) continue;
      if (!isMarkdownPath(normalized)) continue;
      if (seen[normalized]) continue;
      seen[normalized] = true;
      mdFiles.push(normalized);
    }
    if (mdFiles.length === 0) return;

    var LexeraApi = _dep('LexeraApi');
    var addPromises = mdFiles.map(function (filePath) {
      return LexeraApi.addBoard(filePath).catch(function (err) {
        _callDep('lexeraLog', 'error', 'Failed to add board: ' + err.message);
      });
    });
    Promise.all(addPromises).then(function () {
      _callDep('poll');
    });
  }

  // ─── Ratio / sidebar helpers ──────────────────────────────────────────

  function normalizeRatio(rawRatio, options) {
    options = options || {};
    var ratio = Number(rawRatio);
    var fallback = isFinite(options.fallback) ? options.fallback : 0.5;
    var min = isFinite(options.min) ? options.min : 0.2;
    var max = isFinite(options.max) ? options.max : 0.8;
    var snap = isFinite(options.snap) ? options.snap : 0.5;
    var snapThreshold = isFinite(options.snapThreshold) ? options.snapThreshold : 0.04;

    if (!isFinite(ratio)) ratio = fallback;
    if (ratio < min) ratio = min;
    if (ratio > max) ratio = max;
    if (Math.abs(ratio - snap) <= snapThreshold) ratio = snap;
    return ratio;
  }

  function normalizeSidebarSplitRatio(rawRatio) {
    return normalizeRatio(rawRatio, {
      fallback: 0.58,
      min: 0.2,
      max: 0.8,
      snap: 0.5,
      snapThreshold: 0.03
    });
  }

  function bindPointerDividerDrag(divider, handlers) {
    if (!divider || !handlers) return;
    divider.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      if (handlers.canStart && !handlers.canStart(e)) return;
      e.preventDefault();

      var pointerId = e.pointerId;
      var finished = false;
      var ctx = {};
      if (handlers.onStart) {
        var startCtx = handlers.onStart(e);
        if (startCtx && typeof startCtx === 'object') ctx = startCtx;
      }

      function onMove(ev) {
        if (ev.pointerId !== pointerId) return;
        if (handlers.onMove) handlers.onMove(ev, ctx);
      }

      function finish(ev) {
        if (finished) return;
        if (ev && ev.pointerId != null && ev.pointerId !== pointerId) return;
        finished = true;
        divider.removeEventListener('pointermove', onMove, true);
        divider.removeEventListener('pointerup', finish, true);
        divider.removeEventListener('pointercancel', finish, true);
        divider.removeEventListener('lostpointercapture', finish, true);
        try {
          if (divider.hasPointerCapture && divider.hasPointerCapture(pointerId)) {
            divider.releasePointerCapture(pointerId);
          }
        } catch (err) {
          // no-op
        }
        if (handlers.onEnd) handlers.onEnd(ev, ctx);
      }

      try {
        divider.setPointerCapture(pointerId);
      } catch (err) {
        // no-op
      }

      onMove(e);
      divider.addEventListener('pointermove', onMove, true);
      divider.addEventListener('pointerup', finish, true);
      divider.addEventListener('pointercancel', finish, true);
      divider.addEventListener('lostpointercapture', finish, true);
    });

    if (handlers.onDoubleClick) {
      divider.addEventListener('dblclick', handlers.onDoubleClick);
    }
  }

  function applySidebarSectionLayout() {
    if (!_callDep('getElSidebar') || !_callDep('getElBoardList')) return;
    if (_dep('workspaceShellEnabled')) {
      if (_callDep('getElSidebarDashboardDivider')) _callDep('getElSidebarDashboardDivider').classList.add('hidden');
      _callDep('getElBoardList').style.flex = '1 1 auto';
      _callDep('getElBoardList').style.height = '';
      if (_callDep('getElDashboardRoot')) {
        _callDep('getElDashboardRoot').style.flex = '1 1 auto';
        _callDep('getElDashboardRoot').style.height = '';
      }
      return;
    }
    var dashboardHidden = !_callDep('getElDashboardRoot') || _callDep('getElDashboardRoot').classList.contains('hidden');

    if (dashboardHidden) {
      if (_callDep('getElSidebarDashboardDivider')) _callDep('getElSidebarDashboardDivider').classList.add('hidden');
      _callDep('getElBoardList').style.flex = '1 1 auto';
      _callDep('getElBoardList').style.height = '';
      if (_callDep('getElDashboardRoot')) {
        _callDep('getElDashboardRoot').style.flex = '';
        _callDep('getElDashboardRoot').style.height = '';
      }
      return;
    }

    if (_callDep('getElSidebarDashboardDivider')) _callDep('getElSidebarDashboardDivider').classList.remove('hidden');
    var sidebarSplitRatio = normalizeSidebarSplitRatio(_dep('sidebarSplitRatio'));

    var sidebarHeight = _callDep('getElSidebar').clientHeight || 0;
    var headerHeight = _callDep('getElSidebarHeader') ? _callDep('getElSidebarHeader').offsetHeight : 0;
    var dividerHeight = _callDep('getElSidebarDashboardDivider') ? (_callDep('getElSidebarDashboardDivider').offsetHeight || 8) : 0;
    var available = sidebarHeight - headerHeight - dividerHeight;
    if (available <= 0) return;

    var styles = window.getComputedStyle(_callDep('getElSidebar'));
    var hierarchyMin = parseFloat(styles.getPropertyValue('--sidebar-hierarchy-min')) || 140;
    var dashboardMin = parseFloat(styles.getPropertyValue('--sidebar-dashboard-min')) || 180;
    var minSum = hierarchyMin + dashboardMin;
    if (available < minSum) {
      var scaledHierarchyMin = Math.max(80, Math.floor((hierarchyMin / minSum) * available));
      hierarchyMin = scaledHierarchyMin;
      dashboardMin = Math.max(100, available - scaledHierarchyMin);
    }

    var boardHeight = Math.round(available * sidebarSplitRatio);
    var minBoard = Math.min(hierarchyMin, Math.max(0, available - dashboardMin));
    var maxBoard = Math.max(minBoard, available - dashboardMin);
    boardHeight = Math.max(minBoard, Math.min(maxBoard, boardHeight));
    var dashboardHeight = Math.max(0, available - boardHeight);

    _callDep('getElBoardList').style.flex = '0 0 ' + boardHeight + 'px';
    _callDep('getElBoardList').style.height = boardHeight + 'px';
    if (_callDep('getElDashboardRoot')) {
      _callDep('getElDashboardRoot').style.flex = '0 0 ' + dashboardHeight + 'px';
      _callDep('getElDashboardRoot').style.height = dashboardHeight + 'px';
    }
  }

  function setupSidebarSectionResize() {
    if (_dep('workspaceShellEnabled')) {
      applySidebarSectionLayout();
      return;
    }
    if (!_callDep('getElSidebar') || !_callDep('getElSidebarDashboardDivider')) return;
    applySidebarSectionLayout();
    window.addEventListener('resize', applySidebarSectionLayout);

    bindPointerDividerDrag(_callDep('getElSidebarDashboardDivider'), {
      canStart: function () {
        return !!_callDep('getElDashboardRoot') && !_callDep('getElDashboardRoot').classList.contains('hidden');
      },
      onStart: function () {
        var sidebarRect = _callDep('getElSidebar').getBoundingClientRect();
        var headerBottom = _callDep('getElSidebarHeader') ? _callDep('getElSidebarHeader').getBoundingClientRect().bottom : sidebarRect.top;
        var dividerHeight = _callDep('getElSidebarDashboardDivider').offsetHeight || 8;
        var trackStart = headerBottom;
        var trackSize = sidebarRect.height - (headerBottom - sidebarRect.top) - dividerHeight;
        _callDep('getElSidebar').classList.add('resizing-sections');
        return {
          trackStart: trackStart,
          trackSize: Math.max(1, trackSize)
        };
      },
      onMove: function (ev, ctx) {
        var next = (ev.clientY - ctx.trackStart) / ctx.trackSize;
        _callDep('setSidebarSplitRatio', normalizeSidebarSplitRatio(next));
        applySidebarSectionLayout();
      },
      onEnd: function () {
        _callDep('getElSidebar').classList.remove('resizing-sections');
        localStorage.setItem('lexera-sidebar-split-ratio', String(normalizeSidebarSplitRatio(_dep('sidebarSplitRatio'))));
        applySidebarSectionLayout();
      },
      onDoubleClick: function () {
        _callDep('setSidebarSplitRatio', 0.5);
        localStorage.setItem('lexera-sidebar-split-ratio', '0.5');
        applySidebarSectionLayout();
      }
    });
  }

  function applySidebarWidth() {
    if (!_callDep('getElSidebar')) return;
    if (_dep('workspaceShellEnabled')) return;
    if (_dep('sidebarWidth') > 0) {
      document.documentElement.style.setProperty('--sidebar-width', _dep('sidebarWidth') + 'px');
    }
  }

  function setupSidebarWidthResize() {
    if (_dep('workspaceShellEnabled')) return;
    if (!_callDep('getElSidebar') || !_callDep('getElSidebarWidthDivider') || !_callDep('getElLayout')) return;
    var SIDEBAR_MIN = 180;
    var SIDEBAR_MAX = 600;
    var SIDEBAR_DEFAULT = 300;
    var SNAP_THRESHOLD = 15;

    applySidebarWidth();

    bindPointerDividerDrag(_callDep('getElSidebarWidthDivider'), {
      onStart: function () {
        var sidebarRect = _callDep('getElSidebar').getBoundingClientRect();
        _callDep('getElLayout').classList.add('resizing-sidebar-width');
        return { left: sidebarRect.left };
      },
      onMove: function (ev, ctx) {
        var newWidth = ev.clientX - ctx.left;
        if (Math.abs(newWidth - SIDEBAR_DEFAULT) < SNAP_THRESHOLD) newWidth = SIDEBAR_DEFAULT;
        newWidth = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, newWidth));
        _callDep('setSidebarWidth', newWidth);
        document.documentElement.style.setProperty('--sidebar-width', newWidth + 'px');
        applySidebarSectionLayout();
      },
      onEnd: function () {
        _callDep('getElLayout').classList.remove('resizing-sidebar-width');
        localStorage.setItem('lexera-sidebar-width', String(_dep('sidebarWidth')));
        applySidebarSectionLayout();
      },
      onDoubleClick: function () {
        _callDep('setSidebarWidth', SIDEBAR_DEFAULT);
        document.documentElement.style.setProperty('--sidebar-width', SIDEBAR_DEFAULT + 'px');
        localStorage.setItem('lexera-sidebar-width', String(SIDEBAR_DEFAULT));
        applySidebarSectionLayout();
      }
    });
  }

  // ─── Tab indent helper ────────────────────────────────────────────────

  function handleTextareaTabIndent(e, textarea) {
    if (!e || !textarea || e.key !== 'Tab') return false;
    e.preventDefault();

    var text = textarea.value || '';
    var start = textarea.selectionStart || 0;
    var end = textarea.selectionEnd || 0;
    var hasSelection = end > start;

    if (!e.shiftKey && !hasSelection) {
      textarea.value = text.slice(0, start) + '\t' + text.slice(end);
      textarea.setSelectionRange(start + 1, start + 1);
      textarea.dispatchEvent(new Event('input'));
      return true;
    }

    var blockStart = text.lastIndexOf('\n', Math.max(0, start - 1));
    blockStart = blockStart === -1 ? 0 : blockStart + 1;
    var endLookupPos = hasSelection && end > 0 ? end - 1 : end;
    var blockEnd = text.indexOf('\n', endLookupPos);
    if (blockEnd === -1) blockEnd = text.length;

    var blockText = text.slice(blockStart, blockEnd);
    var lines = blockText.split('\n');
    var rebuilt = [];
    var adjustStart = 0;
    var adjustEnd = 0;
    var linePos = blockStart;

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var removed = 0;
      if (e.shiftKey) {
        if (line.indexOf('\t') === 0) removed = 1;
        else if (line.indexOf('    ') === 0) removed = 4;
        else if (line.indexOf('  ') === 0) removed = 2;
        rebuilt.push(removed > 0 ? line.slice(removed) : line);
      } else {
        rebuilt.push('\t' + line);
      }

      if (!e.shiftKey) {
        if (linePos < start) adjustStart += 1;
        if (linePos < end || (!hasSelection && linePos === start)) adjustEnd += 1;
      } else if (removed > 0) {
        if (linePos < start) adjustStart += Math.min(removed, start - linePos);
        if (linePos < end || (!hasSelection && linePos === start)) adjustEnd += Math.min(removed, end - linePos);
      }

      linePos += line.length + 1;
    }

    textarea.value = text.slice(0, blockStart) + rebuilt.join('\n') + text.slice(blockEnd);

    var newStart = e.shiftKey ? start - adjustStart : start + adjustStart;
    var newEnd = e.shiftKey ? end - adjustEnd : end + adjustEnd;
    if (!hasSelection) newEnd = newStart;
    if (newStart < 0) newStart = 0;
    if (newEnd < newStart) newEnd = newStart;
    textarea.setSelectionRange(newStart, newEnd);
    textarea.dispatchEvent(new Event('input'));
    return true;
  }

  // ─── Transient UI helpers ─────────────────────────────────────────────

  function closeTransientUiViaHotkey() {
    var didClose = false;
    if (_dep('activeColMenu') || _dep('activeCardMenu') || _dep('activeRowStackMenu') || _dep('activeEmbedMenu') || _dep('activeHtmlMenu')) {
      didClose = true;
    }
    _callDep('closeColumnContextMenu');
    _callDep('closeCardContextMenu');
    _callDep('closeRowStackMenu');
    _callDep('closeEmbedMenu');
    _callDep('closeHtmlMenu');

    if (_dep('addCardColumn') != null) {
      _callDep('setAddCardColumn', null);
      _callDep('renderColumns');
      didClose = true;
    }

    var editingTextarea = document.querySelector('.card.editing .card-edit-input');
    if (editingTextarea) {
      editingTextarea.blur();
      didClose = true;
    }

    if (_dep('currentInlineCardEditor')) {
      _callDep('closeInlineCardEditor', { save: true });
      didClose = true;
    }

    if (_dep('currentCardEditor')) {
      _callDep('closeCardEditorOverlay', { save: false });
      didClose = true;
    }

    var overlays = document.querySelectorAll('.dialog-overlay');
    if (overlays.length > 0) {
      overlays[overlays.length - 1].remove();
      didClose = true;
    }

    return didClose;
  }

  // ─── Search expansion helpers ─────────────────────────────────────────

  function setHeaderSearchExpanded(expanded, options) {
    _callDep('setHeaderSearchExpandedState', !!expanded);
    localStorage.setItem('lexera-header-search-expanded', expanded ? 'true' : 'false');
    updateHeaderSearchVisibility(options);
  }

  function updateHeaderSearchVisibility(options) {
    options = options || {};
    var $searchContainer = _dep('$searchContainer');
    var $searchInput = _dep('$searchInput');
    var $searchToggleBtn = _dep('$searchToggleBtn');
    if (!$searchContainer) return;
    var hasQuery = !!($searchInput && $searchInput.value && $searchInput.value.trim());
    var visible = _dep('headerSearchExpanded') || _dep('searchMode') || hasQuery;
    $searchContainer.classList.toggle('collapsed', !visible);
    if ($searchToggleBtn) $searchToggleBtn.classList.toggle('active', visible);
    if (visible && options.focus && $searchInput) {
      requestAnimationFrame(function () { $searchInput.focus(); });
    }
  }

  // ─── Embedded pane helpers ────────────────────────────────────────────

  function notifyParentPaneActivated() {
    if (!_dep('embeddedMode') || !_dep('embeddedPaneId')) return;
    if (!window.parent || window.parent === window) return;
    try {
      window.parent.postMessage({
        type: 'lexera-pane-activated',
        pane: _dep('embeddedPaneId'),
        boardId: _dep('activeBoardId') || ''
      }, '*');
    } catch (e) {
      // ignore cross-frame messaging issues
    }
  }

  function setupEmbeddedPaneActivation() {
    if (!_dep('embeddedMode')) return;
    var lastSentAt = 0;
    function sendActivation() {
      var now = Date.now();
      if (now - lastSentAt < 80) return;
      lastSentAt = now;
      notifyParentPaneActivated();
    }
    document.addEventListener('pointerdown', sendActivation, true);
    document.addEventListener('focusin', sendActivation, true);
    window.addEventListener('keydown', sendActivation, true);
    window.addEventListener('message', handleEmbeddedHierarchyFocusMessage);
    setTimeout(sendActivation, 0);
  }

  function handleEmbeddedHierarchyFocusMessage(event) {
    if (!_dep('embeddedMode')) return;
    var data = event && event.data;
    if (!data || !data.type) return;
    if (data.type === 'lexera-board-action' && data.action) {
      _callDep('handleBoardAction', data.action);
      return;
    }
    if (data.type !== 'lexera-focus-hierarchy-target' || !data.target) return;
    _callDep('navigateToHierarchyTarget', data.target).catch(function (err) {
      _callDep('logFrontendIssue', 'warn', 'embedded.focus', 'Failed to focus hierarchy target inside embedded pane', err);
    });
  }

  function requestWorkspaceShellViewKind(viewKind) {
    if (!_dep('embeddedWorkspaceShellParent') || !_dep('embeddedPaneId')) return false;
    if (!window.parent || window.parent === window) return false;
    var normalized = normalizeBoardLayoutValue(viewKind);
    window.parent.postMessage({
      type: 'lexera-pane-set-view-kind',
      pane: _dep('embeddedPaneId'),
      viewKind: normalized
    }, '*');
    return true;
  }

  // ─── Header / workspace shell helpers ─────────────────────────────────

  function refreshHeaderFileControls() {
    // Placeholder for header sync status updates.
  }

  function setShellActiveBoard(boardId) {
    _callDep('setActiveBoardId', boardId || null);
    _callDep('setActiveBoardData', null);
    _callDep('setFullBoardData', null);
    _callDep('setPendingExternalRebaseConflict', null);
    _callDep('setLastLoadedGeneration', null);
    _callDep('setLastLoadedRevision', null);
    _callDep('setAddCardColumn', null);
    if (!_dep('embeddedMode')) {
      if (boardId) {
        localStorage.setItem('lexera-last-board', boardId);
        _callDep('trackRecentBoard', boardId);
      } else {
        localStorage.removeItem('lexera-last-board');
      }
    }
    _callDep('renderBoardList');
    refreshHeaderFileControls();
    scheduleDashboardRefresh(60);
  }

  function setupWorkspaceShell() {
    if (!_dep('workspaceShellEnabled') || !_dep('WorkspaceShell')) return;
    _dep('WorkspaceShell').mount({
      getMainContent: _dep('getElMainContent'),
      onActiveBoardChanged: function (boardId) {
        setShellActiveBoard(boardId || null);
      },
      openWindow: function (payload) {
        if (!_dep('hasTauri')) return Promise.reject(new Error('Tauri unavailable'));
        return _callDep('tauriInvoke', 'open_new_window', payload || {});
      }
    });
  }

  // ─── File name / rename helpers ───────────────────────────────────────

  function normalizeMarkdownFileName(rawName) {
    var name = String(rawName || '').trim();
    if (!name) return '';
    name = name.replace(/[\\/]/g, '-');
    name = name.replace(/[:*?"<>|]/g, '-');
    if (!/\.md$/i.test(name)) name += '.md';
    return name;
  }

  function renameActiveBoardFile() {
    var boardId = _dep('activeBoardId');
    var oldPath = _callDep('getActiveBoardFilePath');
    if (!boardId || !oldPath) return;
    if (!_dep('hasTauri')) {
      _callDep('showNotification', 'Rename is available in the desktop app only');
      return;
    }

    var oldName = _callDep('getFileNameFromPath', oldPath);
    var requested = window.prompt('Rename board file', oldName);
    if (requested == null) return;

    var nextName = normalizeMarkdownFileName(requested);
    if (!nextName) {
      _callDep('showNotification', 'Invalid filename');
      return;
    }
    if (nextName === oldName) return;

    var sep = oldPath.indexOf('\\') !== -1 ? '\\' : '/';
    var folder = _callDep('getDirNameFromPath', oldPath);
    var newPath = folder ? (folder + sep + nextName) : nextName;
    if (_callDep('normalizePathForCompare', newPath) === _callDep('normalizePathForCompare', oldPath)) return;

    return _callDep('tauriInvoke', 'rename_path', { from: oldPath, to: newPath }).then(function () {
      var LexeraApi = _dep('LexeraApi');
      return LexeraApi.addBoard(newPath).then(function (addResult) {
        var newBoardId = addResult && addResult.boardId ? addResult.boardId : null;
        return LexeraApi.removeBoard(boardId).catch(function () {}).then(function () {
          return _callDep('poll').then(function () {
            if (newBoardId) {
              return _callDep('selectBoard', newBoardId);
            } else {
              var boards = _dep('boards');
              var normalizedNew = _callDep('normalizePathForCompare', newPath);
              for (var i = 0; i < boards.length; i++) {
                if (_callDep('normalizePathForCompare', boards[i].filePath) === normalizedNew) {
                  return _callDep('selectBoard', boards[i].id);
                }
              }
            }
          }).then(function () {
            refreshHeaderFileControls();
            _callDep('showNotification', 'Renamed file to ' + nextName);
          });
        });
      });
    }).catch(function (err) {
      _callDep('lexeraLog', 'error', '[rename.file] Rename failed: ' + err);
      _callDep('showNotification', 'Failed to rename file');
    });
  }

  function openActiveBoardFolder() {
    var filePath = _callDep('getActiveBoardFilePath');
    if (!filePath) return;
    _callDep('showInFinder', filePath);
  }

  function buildThemeOptionsMarkup(selectedThemeId) {
    var THEMES = _dep('THEMES');
    var selected = selectedThemeId || _callDep('getLexeraCurrentThemeId') || (THEMES[0] && THEMES[0].id) || 'lexera';
    var html = '';
    for (var i = 0; i < THEMES.length; i++) {
      var t = THEMES[i];
      html += '<option value="' + _callDep('escapeAttr', t.id) + '"' + (t.id === selected ? ' selected' : '') + '>' +
        _callDep('escapeHtml', t.name) + '</option>';
    }
    return html;
  }

  function openSettingsDialogForBoard(boardId) {
    var targetBoardId = boardId || _dep('activeBoardId') || '';
    _callDep('openManagementPanel', { section: 'boards', boardId: targetBoardId, tab: 'settings' });
  }

  function setupHeaderFileControls() {
    refreshHeaderFileControls();
  }

  // ─── Search controls ──────────────────────────────────────────────────

  function setupSearchControls() {
    if (_dep('embeddedMode') || !_dep('$searchInput') || !_dep('$searchContainer')) return;
    updateHeaderSearchVisibility();

    var $searchToggleBtn = _dep('$searchToggleBtn');
    if ($searchToggleBtn) {
      $searchToggleBtn.addEventListener('click', function (e) {
        e.preventDefault();
        if (_dep('headerSearchExpanded')) {
          if (_dep('$searchInput')) _dep('$searchInput').value = '';
          _callDep('exitSearchMode');
          setHeaderSearchExpanded(false);
        } else {
          setHeaderSearchExpanded(true, { focus: true });
        }
      });
    }

    document.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setHeaderSearchExpanded(true, { focus: true });
      }
    });
  }

  function ensureSidebarTreeDefaultState() {
    var versionKey = 'lexera-sidebar-tree-default-v2';
    if (localStorage.getItem(versionKey) === '1') return;
    localStorage.removeItem('lexera-sidebar-tree-state');
    localStorage.setItem(versionKey, '1');
  }

  // ─── Dashboard state and rendering ────────────────────────────────────

  var dashboardState = null;
  var dashboardSearchDebounce = null;
  var dashboardRefreshTimer = null;
  var dashboardRefreshSeq = 0;

  function normalizeDashboardScope(scope) {
    return scope === 'all' ? 'all' : 'active';
  }

  function loadDashboardPinnedQueries() {
    try {
      var raw = JSON.parse(localStorage.getItem('lexera-dashboard-pinned-queries') || '[]');
      if (!Array.isArray(raw)) return [];
      var out = [];
      for (var i = 0; i < raw.length; i++) {
        var q = String(raw[i] || '').trim();
        if (!q || out.indexOf(q) !== -1) continue;
        out.push(q);
        if (out.length >= 30) break;
      }
      return out;
    } catch (e) {
      return [];
    }
  }

  function persistDashboardPrefs() {
    if (!dashboardState) return;
    localStorage.setItem('lexera-dashboard-query', dashboardState.query || '');
    localStorage.setItem('lexera-dashboard-scope', normalizeDashboardScope(dashboardState.scope));
    localStorage.setItem('lexera-dashboard-active-pinned', dashboardState.activePinnedQuery || '');
    localStorage.setItem('lexera-dashboard-pinned-queries', JSON.stringify(dashboardState.pinnedQueries || []));
  }

  function setDashboardScope(scope) {
    if (!dashboardState) return;
    dashboardState.scope = normalizeDashboardScope(scope);
    if (_callDep('getElDashboardScopeSelect')) _callDep('getElDashboardScopeSelect').value = dashboardState.scope;
    persistDashboardPrefs();
    syncMirroredDashboardViews();
  }

  function setDashboardQuery(query, options) {
    if (!dashboardState) return;
    options = options || {};
    var next = String(query || '').trim();
    dashboardState.query = next;
    if (_callDep('getElDashboardSearchInput') && _callDep('getElDashboardSearchInput').value !== next) {
      _callDep('getElDashboardSearchInput').value = next;
    }
    if (dashboardState.pinnedQueries.indexOf(next) !== -1) {
      dashboardState.activePinnedQuery = next;
    } else if (!options.keepPinnedSelection) {
      dashboardState.activePinnedQuery = '';
    }
    persistDashboardPrefs();
    renderDashboardPinnedList();
    syncMirroredDashboardViews();
  }

  function filterDashboardResultsByScope(results) {
    if (!Array.isArray(results)) return [];
    if (!dashboardState || dashboardState.scope !== 'active') return results.slice();
    if (!_dep('activeBoardId')) return [];
    var boardId = _dep('activeBoardId');
    return results.filter(function (item) {
      return item && item.boardId === boardId;
    });
  }

  function parseSearchDateValue(dateStr) {
    if (!dateStr) return Number.POSITIVE_INFINITY;
    var stamp = Date.parse(dateStr + 'T00:00:00');
    return isNaN(stamp) ? Number.POSITIVE_INFINITY : stamp;
  }

  function formatLocalDateValue(date) {
    if (!(date instanceof Date) || isNaN(date.getTime())) return '';
    var year = String(date.getFullYear());
    var month = String(date.getMonth() + 1).padStart(2, '0');
    var day = String(date.getDate()).padStart(2, '0');
    return year + '-' + month + '-' + day;
  }

  function dashboardCalendarBaseDate(item) {
    return item && (item.dueDate || item.effectiveDate) ? String(item.dueDate || item.effectiveDate) : '';
  }

  function isDashboardCalendarQuery(query) {
    var normalized = String(query || '').trim().toLowerCase();
    return normalized === 'is:open due:any' ||
      normalized === 'is:open due:overdue' ||
      normalized === 'is:open due:today' ||
      normalized === 'is:open due:week';
  }

  function filterCalendarTasksForDashboardQuery(tasks, query) {
    var normalized = String(query || '').trim().toLowerCase();
    var openTasks = Array.isArray(tasks) ? tasks.filter(function (item) {
      return item && item.checked !== true;
    }) : [];
    if (!normalized) return [];
    if (normalized === 'is:open due:any') return openTasks;
    if (normalized === 'is:open due:overdue') {
      return openTasks.filter(function (item) { return !!(item && item.isOverdue); });
    }

    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var todayValue = formatLocalDateValue(today);
    if (normalized === 'is:open due:today') {
      return openTasks.filter(function (item) {
        return dashboardCalendarBaseDate(item) === todayValue;
      });
    }
    if (normalized === 'is:open due:week') {
      var weekStart = new Date(today);
      weekStart.setDate(today.getDate() - ((today.getDay() + 6) % 7));
      var weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 6);
      var weekStartValue = formatLocalDateValue(weekStart);
      var weekEndValue = formatLocalDateValue(weekEnd);
      return openTasks.filter(function (item) {
        var value = dashboardCalendarBaseDate(item);
        return value && value >= weekStartValue && value <= weekEndValue;
      });
    }
    return [];
  }

  function sortSearchByDueDateAsc(results) {
    return results.slice().sort(function (a, b) {
      var ad = parseSearchDateValue(a && a.dueDate);
      var bd = parseSearchDateValue(b && b.dueDate);
      if (ad !== bd) return ad - bd;
      var at = String(a && a.boardTitle || '').toLowerCase();
      var bt = String(b && b.boardTitle || '').toLowerCase();
      if (at !== bt) return at < bt ? -1 : 1;
      var ac = String(a && a.cardContent || '').toLowerCase();
      var bc = String(b && b.cardContent || '').toLowerCase();
      return ac < bc ? -1 : (ac > bc ? 1 : 0);
    });
  }

  function asCalendarTaskArray(payload) {
    if (!payload || !Array.isArray(payload.results)) return [];
    return payload.results;
  }

  function limitedSearchResults(results, maxCount) {
    if (!Array.isArray(results)) return [];
    if (results.length <= maxCount) return results;
    return results.slice(0, maxCount);
  }

  function asSearchResultArray(payload) {
    if (!payload || !Array.isArray(payload.results)) return [];
    return payload.results;
  }

  function scopeHintForDashboard() {
    if (dashboardState && dashboardState.scope === 'active' && !_dep('activeBoardId')) {
      return 'Select a board to show scoped results';
    }
    return '';
  }

  function bindMirroredDashboardView(rootEl) {
    if (!rootEl || rootEl.__lexeraDashboardMirrorBound) return;
    rootEl.__lexeraDashboardMirrorBound = true;

    rootEl.addEventListener('input', function (e) {
      var searchEl = e.target.closest('.lexera-shared-dashboard-search');
      var canonicalSearch = _callDep('getElDashboardSearchInput');
      if (!searchEl || !canonicalSearch) return;
      canonicalSearch.value = searchEl.value;
      canonicalSearch.dispatchEvent(new Event('input', { bubbles: true }));
    });

    rootEl.addEventListener('keydown', function (e) {
      var searchEl = e.target.closest('.lexera-shared-dashboard-search');
      var canonicalSearch = _callDep('getElDashboardSearchInput');
      if (!searchEl || !canonicalSearch) return;
      canonicalSearch.value = searchEl.value;
      canonicalSearch.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: e.key,
        code: e.code,
        altKey: e.altKey,
        ctrlKey: e.ctrlKey,
        shiftKey: e.shiftKey,
        metaKey: e.metaKey
      }));
    });

    rootEl.addEventListener('change', function (e) {
      var scopeEl = e.target.closest('.lexera-shared-dashboard-scope');
      var canonicalScope = _callDep('getElDashboardScopeSelect');
      if (!scopeEl || !canonicalScope) return;
      canonicalScope.value = scopeEl.value;
      canonicalScope.dispatchEvent(new Event('change', { bubbles: true }));
    });

    rootEl.addEventListener('click', function (e) {
      var searchBtn = e.target.closest('.lexera-shared-dashboard-search-btn');
      if (searchBtn && _callDep('getElDashboardSearchBtn')) {
        e.preventDefault();
        _callDep('getElDashboardSearchBtn').click();
        return;
      }
      var pinBtn = e.target.closest('.lexera-shared-dashboard-pin');
      if (pinBtn && _callDep('getElDashboardPinBtn')) {
        e.preventDefault();
        _callDep('getElDashboardPinBtn').click();
        return;
      }
      var chipBtn = e.target.closest('.dashboard-chip[data-dashboard-query]');
      if (chipBtn && _callDep('getElDashboardRoot')) {
        e.preventDefault();
        var query = chipBtn.getAttribute('data-dashboard-query') || '';
        var canonicalChip = null;
        var canonicalChips = _callDep('getElDashboardRoot').querySelectorAll('.dashboard-chip[data-dashboard-query]');
        for (var chipIdx = 0; chipIdx < canonicalChips.length; chipIdx++) {
          if ((canonicalChips[chipIdx].getAttribute('data-dashboard-query') || '') === query) {
            canonicalChip = canonicalChips[chipIdx];
            break;
          }
        }
        if (canonicalChip) canonicalChip.click();
        return;
      }

      var containerInfo = null;
      var containers = [
        ['.lexera-shared-dashboard-pinned', _dep('getElDashboardPinnedList')],
        ['.lexera-shared-dashboard-results', _dep('getElDashboardResultsList')],
        ['.lexera-shared-dashboard-deadlines', _dep('getElDashboardDeadlineList')],
        ['.lexera-shared-dashboard-overdue', _dep('getElDashboardOverdueList')]
      ];
      for (var ci = 0; ci < containers.length; ci++) {
        var localContainer = e.target.closest(containers[ci][0]);
        if (localContainer) {
          var canonicalFn = containers[ci][1];
          containerInfo = { local: localContainer, canonical: typeof canonicalFn === 'function' ? canonicalFn() : null };
          break;
        }
      }
      if (!containerInfo || !containerInfo.canonical) return;

      var localPinnedItem = e.target.closest('.dashboard-item');
      if (localPinnedItem) {
        e.preventDefault();
        var localItems = Array.prototype.slice.call(containerInfo.local.querySelectorAll('.dashboard-item'));
        var canonicalItems = Array.prototype.slice.call(containerInfo.canonical.querySelectorAll('.dashboard-item'));
        var itemIndex = localItems.indexOf(localPinnedItem);
        if (itemIndex >= 0 && canonicalItems[itemIndex]) {
          if (e.target.closest('.dashboard-item-remove')) {
            var removeBtn = canonicalItems[itemIndex].querySelector('.dashboard-item-remove');
            if (removeBtn) removeBtn.click();
          } else {
            canonicalItems[itemIndex].click();
          }
        }
        return;
      }

      var localTreeNode = e.target.closest('.tree-node[data-dashboard-target="result"]');
      if (!localTreeNode) return;
      e.preventDefault();
      var localTreeNodes = Array.prototype.slice.call(containerInfo.local.querySelectorAll('.tree-node[data-dashboard-target="result"]'));
      var canonicalTreeNodes = Array.prototype.slice.call(containerInfo.canonical.querySelectorAll('.tree-node[data-dashboard-target="result"]'));
      var treeIndex = localTreeNodes.indexOf(localTreeNode);
      if (treeIndex < 0 || !canonicalTreeNodes[treeIndex]) return;
      if (e.target.closest('.tree-toggle')) {
        var canonicalToggle = canonicalTreeNodes[treeIndex].querySelector('.tree-toggle');
        if (canonicalToggle) canonicalToggle.click();
      } else {
        canonicalTreeNodes[treeIndex].click();
      }
    });
  }

  function syncMirroredDashboardViews() {
    var dashboardRoots = _callDep('getSharedPanelRoots', 'dashboard');
    if (!dashboardRoots || !dashboardRoots.length || !_callDep('getElDashboardRoot')) return;
    var canonicalPinned = _callDep('getElDashboardPinnedList');
    var canonicalResults = _callDep('getElDashboardResultsList');
    var canonicalDeadlines = _callDep('getElDashboardDeadlineList');
    var canonicalOverdue = _callDep('getElDashboardOverdueList');
    var canonicalGroups = _callDep('getElDashboardRoot').querySelectorAll('.dashboard-group');
    for (var i = 0; i < dashboardRoots.length; i++) {
      var rootEl = dashboardRoots[i];
      if (!rootEl) continue;
      bindMirroredDashboardView(rootEl);
      var searchEl = rootEl.querySelector('.lexera-shared-dashboard-search');
      var scopeEl = rootEl.querySelector('.lexera-shared-dashboard-scope');
      var pinnedEl = rootEl.querySelector('.lexera-shared-dashboard-pinned');
      var resultsEl = rootEl.querySelector('.lexera-shared-dashboard-results');
      var deadlinesEl = rootEl.querySelector('.lexera-shared-dashboard-deadlines');
      var overdueEl = rootEl.querySelector('.lexera-shared-dashboard-overdue');
      if (searchEl && dashboardState) searchEl.value = dashboardState.query || '';
      if (scopeEl && dashboardState) scopeEl.value = dashboardState.scope || 'active';
      if (pinnedEl && canonicalPinned) pinnedEl.innerHTML = canonicalPinned.innerHTML;
      if (resultsEl && canonicalResults) resultsEl.innerHTML = canonicalResults.innerHTML;
      if (deadlinesEl && canonicalDeadlines) deadlinesEl.innerHTML = canonicalDeadlines.innerHTML;
      if (overdueEl && canonicalOverdue) overdueEl.innerHTML = canonicalOverdue.innerHTML;
      var mirrorGroups = rootEl.querySelectorAll('.dashboard-group');
      for (var j = 0; j < mirrorGroups.length && j < canonicalGroups.length; j++) {
        mirrorGroups[j].className = canonicalGroups[j].className;
      }
    }
  }

  function renderDashboardPinnedList() {
    if (!_callDep('getElDashboardPinnedList')) return;
    _callDep('getElDashboardPinnedList').innerHTML = '';
    if (!dashboardState || !dashboardState.pinnedQueries || dashboardState.pinnedQueries.length === 0) {
      setDashboardGroupEmptyState(_callDep('getElDashboardPinnedList'), true);
      var empty = document.createElement('div');
      empty.className = 'dashboard-empty';
      empty.textContent = 'No pinned searches';
      _callDep('getElDashboardPinnedList').appendChild(empty);
      syncMirroredDashboardViews();
      return;
    }
    setDashboardGroupEmptyState(_callDep('getElDashboardPinnedList'), false);

    for (var i = 0; i < dashboardState.pinnedQueries.length; i++) {
      (function (query) {
        var item = document.createElement('div');
        item.className = 'dashboard-item' + (dashboardState.activePinnedQuery === query ? ' pinned-active' : '');

        var main = document.createElement('div');
        main.className = 'dashboard-item-main';
        var title = document.createElement('div');
        title.className = 'dashboard-item-title';
        title.textContent = query;
        var meta = document.createElement('div');
        meta.className = 'dashboard-item-meta';
        meta.textContent = 'Pinned query';
        main.appendChild(title);
        main.appendChild(meta);
        item.appendChild(main);

        var right = document.createElement('div');
        right.className = 'dashboard-item-right';
        var removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'dashboard-item-remove';
        removeBtn.title = 'Remove pinned query';
        removeBtn.textContent = '\u00d7';
        removeBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          var idx = dashboardState.pinnedQueries.indexOf(query);
          if (idx !== -1) dashboardState.pinnedQueries.splice(idx, 1);
          if (dashboardState.activePinnedQuery === query) dashboardState.activePinnedQuery = '';
          persistDashboardPrefs();
          renderDashboardPinnedList();
        });
        right.appendChild(removeBtn);
        item.appendChild(right);

        item.addEventListener('click', function () {
          dashboardState.activePinnedQuery = query;
          setDashboardQuery(query, { keepPinnedSelection: true });
          scheduleDashboardRefresh(0);
        });
        _callDep('getElDashboardPinnedList').appendChild(item);
      })(dashboardState.pinnedQueries[i]);
    }
    syncMirroredDashboardViews();
  }

  function setDashboardGroupEmptyState(targetEl, isEmpty) {
    if (!targetEl || typeof targetEl.closest !== 'function') return;
    var group = targetEl.closest('.dashboard-group');
    if (!group) return;
    group.classList.toggle('is-empty', !!isEmpty);
  }

  function renderDashboardResultItems(targetEl, items, emptyText, options) {
    options = options || {};
    if (!targetEl) return;
    targetEl.innerHTML = '';

    if (!items || items.length === 0) {
      setDashboardGroupEmptyState(targetEl, !!options.collapseWhenEmpty);
      var empty = document.createElement('div');
      empty.className = 'dashboard-empty';
      empty.textContent = emptyText;
      targetEl.appendChild(empty);
      return;
    }
    setDashboardGroupEmptyState(targetEl, false);
    var treeNodes = _callDep('getDashboardTreeApi').buildDashboardResultTreeNodes(items);
    var TreeView = _dep('TreeView');
    TreeView.render(targetEl, treeNodes, {
      escapeHtml: _dep('escapeHtml'),
      variant: 'compact'
    });
    if (!targetEl.__dashboardTreeClickBound) {
      targetEl.addEventListener('click', function (e) {
        var toggle = e.target.closest('.tree-toggle');
        if (toggle && targetEl.contains(toggle)) {
          var toggleNode = toggle.closest('.tree-node');
          if (toggleNode) TreeView.toggleNode(toggleNode);
          return;
        }
        var node = e.target.closest('.tree-node[data-dashboard-target="result"]');
        if (!node || !targetEl.contains(node)) return;
        var navResult = _callDep('getDashboardTreeApi').buildDashboardNavResultFromTreeNode(node);
        if (!navResult) return;
        _callDep('navigateToSearchResult', navResult);
      });
      targetEl.__dashboardTreeClickBound = true;
    }
  }

  function renderDashboard() {
    if (!_callDep('getElDashboardRoot')) return;
    if (!dashboardState) return;
    var scopeHint = scopeHintForDashboard();
    var loadingNote = dashboardState.loading ? 'Loading...' : null;

    renderDashboardPinnedList();
    renderDashboardResultItems(
      _callDep('getElDashboardResultsList'),
      dashboardState.results,
      scopeHint || loadingNote || (dashboardState.query ? 'No matching tasks' : 'Type a query to search'),
      { collapseWhenEmpty: !dashboardState.loading && !dashboardState.query }
    );
    renderDashboardResultItems(
      _callDep('getElDashboardDeadlineList'),
      dashboardState.deadlines,
      scopeHint || loadingNote || 'No open tasks with due dates',
      { collapseWhenEmpty: !dashboardState.loading }
    );
    renderDashboardResultItems(
      _callDep('getElDashboardOverdueList'),
      dashboardState.overdue,
      scopeHint || loadingNote || 'No overdue tasks',
      { collapseWhenEmpty: !dashboardState.loading }
    );
    syncMirroredDashboardViews();
  }

  function refreshDashboardData(options) {
    options = options || {};
    if (!_callDep('getElDashboardRoot') || _dep('embeddedMode')) return Promise.resolve();
    if (!_dep('connected')) {
      if (dashboardState) {
        dashboardState.loading = false;
        dashboardState.results = [];
        dashboardState.deadlines = [];
        dashboardState.overdue = [];
      }
      renderDashboard();
      return Promise.resolve();
    }
    var refreshId = ++dashboardRefreshSeq;
    if (dashboardState) dashboardState.loading = true;
    if (!options.deferRender) renderDashboard();

    var LexeraApi = _dep('LexeraApi');
    var query = dashboardState && dashboardState.query ? dashboardState.query.trim() : '';
    var calendarScopedQuery = isDashboardCalendarQuery(query);
    var queryPromise = query && !calendarScopedQuery
      ? LexeraApi.search(query)
      : Promise.resolve({ results: [] });
    var calendarPromise = LexeraApi.getCalendarTasks();

    return Promise.all([queryPromise, calendarPromise]).then(function (resolved) {
      if (refreshId !== dashboardRefreshSeq) return;

      var scopedCalendar = filterDashboardResultsByScope(asCalendarTaskArray(resolved[1]));
      var scopedQuery = calendarScopedQuery
        ? filterCalendarTasksForDashboardQuery(scopedCalendar, query)
        : filterDashboardResultsByScope(asSearchResultArray(resolved[0]));
      var openCalendar = scopedCalendar.filter(function (item) {
        return item && item.checked !== true;
      });
      var overdueCalendar = openCalendar.filter(function (item) {
        return item && item.isOverdue;
      });

      if (dashboardState) {
        dashboardState.results = limitedSearchResults(scopedQuery, 80);
        dashboardState.deadlines = limitedSearchResults(sortSearchByDueDateAsc(openCalendar), 40);
        dashboardState.overdue = limitedSearchResults(sortSearchByDueDateAsc(overdueCalendar), 40);
      }
    }).catch(function (err) {
      if (refreshId !== dashboardRefreshSeq) return;
      _callDep('logFrontendIssue', 'error', 'dashboard.search', 'Failed to refresh', err);
      if (dashboardState) {
        dashboardState.results = [];
        dashboardState.deadlines = [];
        dashboardState.overdue = [];
      }
    }).then(function () {
      if (refreshId !== dashboardRefreshSeq) return;
      if (dashboardState) dashboardState.loading = false;
      renderDashboard();
    });
  }

  function scheduleDashboardRefresh(delayMs) {
    if (!_callDep('getElDashboardRoot') || _dep('embeddedMode')) return;
    clearTimeout(dashboardRefreshTimer);
    dashboardRefreshTimer = setTimeout(function () {
      refreshDashboardData();
    }, typeof delayMs === 'number' ? delayMs : 120);
  }

  function setupDashboardControls() {
    if (!_callDep('getElDashboardRoot')) return;
    if (_dep('embeddedMode')) {
      _callDep('getElDashboardRoot').classList.add('hidden');
      applySidebarSectionLayout();
      return;
    }

    dashboardState = _dep('dashboardState');
    if (dashboardState) {
      dashboardState.pinnedQueries = loadDashboardPinnedQueries();
      dashboardState.scope = normalizeDashboardScope(dashboardState.scope);
      if (dashboardState.pinnedQueries.indexOf(dashboardState.activePinnedQuery) === -1) {
        dashboardState.activePinnedQuery = '';
      }
    }

    if (_callDep('getElDashboardSearchInput') && dashboardState) _callDep('getElDashboardSearchInput').value = dashboardState.query || '';
    if (_callDep('getElDashboardScopeSelect') && dashboardState) _callDep('getElDashboardScopeSelect').value = dashboardState.scope;

    if (_callDep('getElDashboardSearchInput')) {
      _callDep('getElDashboardSearchInput').addEventListener('input', function () {
        setDashboardQuery(_callDep('getElDashboardSearchInput').value);
        clearTimeout(dashboardSearchDebounce);
        dashboardSearchDebounce = setTimeout(function () {
          refreshDashboardData({ deferRender: true });
        }, 220);
      });
      _callDep('getElDashboardSearchInput').addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          setDashboardQuery(_callDep('getElDashboardSearchInput').value);
          refreshDashboardData({ deferRender: true });
        } else if (e.key === 'Escape') {
          e.preventDefault();
          setDashboardQuery('');
          refreshDashboardData({ deferRender: true });
        }
      });
    }

    if (_callDep('getElDashboardSearchBtn')) {
      _callDep('getElDashboardSearchBtn').addEventListener('click', function () {
        setDashboardQuery(_callDep('getElDashboardSearchInput') ? _callDep('getElDashboardSearchInput').value : (dashboardState ? dashboardState.query : ''));
        refreshDashboardData({ deferRender: true });
      });
    }

    if (_callDep('getElDashboardScopeSelect')) {
      _callDep('getElDashboardScopeSelect').addEventListener('change', function () {
        setDashboardScope(_callDep('getElDashboardScopeSelect').value);
        refreshDashboardData({ deferRender: true });
      });
    }

    if (_callDep('getElDashboardPinBtn')) {
      _callDep('getElDashboardPinBtn').addEventListener('click', function () {
        var query = String(dashboardState ? dashboardState.query : '' || '').trim();
        if (!query) {
          _callDep('showNotification', 'Enter a query to pin');
          return;
        }
        var idx = dashboardState.pinnedQueries.indexOf(query);
        if (idx === -1) {
          dashboardState.pinnedQueries.unshift(query);
          dashboardState.activePinnedQuery = query;
          _callDep('showNotification', 'Pinned dashboard query');
        } else {
          dashboardState.pinnedQueries.splice(idx, 1);
          if (dashboardState.activePinnedQuery === query) dashboardState.activePinnedQuery = '';
          _callDep('showNotification', 'Unpinned dashboard query');
        }
        persistDashboardPrefs();
        renderDashboardPinnedList();
      });
    }

    _callDep('getElDashboardRoot').addEventListener('click', function (e) {
      var chip = e.target.closest('.dashboard-chip[data-dashboard-query]');
      if (!chip) return;
      e.preventDefault();
      var query = chip.getAttribute('data-dashboard-query') || '';
      setDashboardQuery(query);
      refreshDashboardData({ deferRender: true });
    });

    persistDashboardPrefs();
    renderDashboard();
    scheduleDashboardRefresh(0);
    applySidebarSectionLayout();
  }

  // ─── Module init & API ────────────────────────────────────────────────

  function init(deps) {
    if (!deps) return;
    var keys = Object.keys(deps);
    for (var i = 0; i < keys.length; i++) {
      _deps[keys[i]] = deps[keys[i]];
    }
    // Capture the shared dashboardState reference
    if (deps.dashboardState) dashboardState = deps.dashboardState;
  }

  return {
    init: init,
    extractHtmlComments: extractHtmlComments,
    stripHtmlComments: stripHtmlComments,
    rebuildTitleWithPreservedComments: rebuildTitleWithPreservedComments,
    normalizeBoardLayoutValue: normalizeBoardLayoutValue,
    normalizeCanvasGridValue: normalizeCanvasGridValue,
    getCurrentBoardLayout: getCurrentBoardLayout,
    isCanvasBoardLayout: isCanvasBoardLayout,
    normalizeCanvasStackDirection: normalizeCanvasStackDirection,
    stripLayoutTags: stripLayoutTags,
    stripStackTag: stripStackTag,
    stripLegacyImportStructureTags: stripLegacyImportStructureTags,
    isColumnHeaderTagged: isColumnHeaderTagged,
    isColumnFooterTagged: isColumnFooterTagged,
    getDisplayOrderedColumnEntries: getDisplayOrderedColumnEntries,
    extractIncludePathFromTitle: extractIncludePathFromTitle,
    removeIncludeSyntaxFromTitle: removeIncludeSyntaxFromTitle,
    addIncludeSyntaxToTitle: addIncludeSyntaxToTitle,
    suggestIncludePathForColumn: suggestIncludePathForColumn,
    getColumnLayoutTags: getColumnLayoutTags,
    getElementSizeTag: getElementSizeTag,
    getLegacyImportRowNumber: getLegacyImportRowNumber,
    buildRowsFromLegacyColumns: buildRowsFromLegacyColumns,
    reconstructColumnTitle: reconstructColumnTitle,
    toggleColumnWidth: toggleColumnWidth,
    setColumnSpan: setColumnSpan,
    getOrderedItems: getOrderedItems,
    saveOrder: saveOrder,
    getFoldedColumns: getFoldedColumns,
    getFoldedItems: getFoldedItems,
    normalizeFoldStorageList: normalizeFoldStorageList,
    getRowFoldKey: getRowFoldKey,
    getStackFoldKey: getStackFoldKey,
    getColumnFoldKey: getColumnFoldKey,
    hasSavedFoldMatch: hasSavedFoldMatch,
    saveFoldState: saveFoldState,
    setDirectChildFoldState: setDirectChildFoldState,
    setColumnChildrenFoldState: setColumnChildrenFoldState,
    setRowChildrenFoldState: setRowChildrenFoldState,
    setStackChildrenFoldState: setStackChildrenFoldState,
    toggleColumnFoldElement: toggleColumnFoldElement,
    toggleStackFoldElement: toggleStackFoldElement,
    toggleRowFoldElement: toggleRowFoldElement,
    reorderItems: reorderItems,
    reorderBoards: reorderBoards,
    targetClosest: targetClosest,
    normalizeDroppedPath: normalizeDroppedPath,
    isMarkdownPath: isMarkdownPath,
    isAbsoluteLikePath: isAbsoluteLikePath,
    isPositionInsideElement: isPositionInsideElement,
    parseDroppedUriList: parseDroppedUriList,
    collectDroppedPathsFromDataTransfer: collectDroppedPathsFromDataTransfer,
    addBoardsByPath: addBoardsByPath,
    normalizeRatio: normalizeRatio,
    normalizeSidebarSplitRatio: normalizeSidebarSplitRatio,
    bindPointerDividerDrag: bindPointerDividerDrag,
    applySidebarSectionLayout: applySidebarSectionLayout,
    setupSidebarSectionResize: setupSidebarSectionResize,
    applySidebarWidth: applySidebarWidth,
    setupSidebarWidthResize: setupSidebarWidthResize,
    handleTextareaTabIndent: handleTextareaTabIndent,
    closeTransientUiViaHotkey: closeTransientUiViaHotkey,
    setHeaderSearchExpanded: setHeaderSearchExpanded,
    updateHeaderSearchVisibility: updateHeaderSearchVisibility,
    notifyParentPaneActivated: notifyParentPaneActivated,
    setupEmbeddedPaneActivation: setupEmbeddedPaneActivation,
    handleEmbeddedHierarchyFocusMessage: handleEmbeddedHierarchyFocusMessage,
    requestWorkspaceShellViewKind: requestWorkspaceShellViewKind,
    refreshHeaderFileControls: refreshHeaderFileControls,
    setShellActiveBoard: setShellActiveBoard,
    setupWorkspaceShell: setupWorkspaceShell,
    normalizeMarkdownFileName: normalizeMarkdownFileName,
    renameActiveBoardFile: renameActiveBoardFile,
    openActiveBoardFolder: openActiveBoardFolder,
    buildThemeOptionsMarkup: buildThemeOptionsMarkup,
    openSettingsDialogForBoard: openSettingsDialogForBoard,
    setupHeaderFileControls: setupHeaderFileControls,
    setupSearchControls: setupSearchControls,
    ensureSidebarTreeDefaultState: ensureSidebarTreeDefaultState,
    normalizeDashboardScope: normalizeDashboardScope,
    loadDashboardPinnedQueries: loadDashboardPinnedQueries,
    persistDashboardPrefs: persistDashboardPrefs,
    setDashboardScope: setDashboardScope,
    setDashboardQuery: setDashboardQuery,
    filterDashboardResultsByScope: filterDashboardResultsByScope,
    parseSearchDateValue: parseSearchDateValue,
    formatLocalDateValue: formatLocalDateValue,
    dashboardCalendarBaseDate: dashboardCalendarBaseDate,
    isDashboardCalendarQuery: isDashboardCalendarQuery,
    filterCalendarTasksForDashboardQuery: filterCalendarTasksForDashboardQuery,
    sortSearchByDueDateAsc: sortSearchByDueDateAsc,
    asCalendarTaskArray: asCalendarTaskArray,
    limitedSearchResults: limitedSearchResults,
    asSearchResultArray: asSearchResultArray,
    scopeHintForDashboard: scopeHintForDashboard,
    bindMirroredDashboardView: bindMirroredDashboardView,
    syncMirroredDashboardViews: syncMirroredDashboardViews,
    renderDashboardPinnedList: renderDashboardPinnedList,
    setDashboardGroupEmptyState: setDashboardGroupEmptyState,
    renderDashboardResultItems: renderDashboardResultItems,
    renderDashboard: renderDashboard,
    refreshDashboardData: refreshDashboardData,
    scheduleDashboardRefresh: scheduleDashboardRefresh,
    setupDashboardControls: setupDashboardControls
  };
})();
(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : typeof self !== 'undefined' ? self : {}).LexeraOrderHelpers = LexeraOrderHelpers;
