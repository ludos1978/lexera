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
  var _rt = typeof window !== 'undefined' && window.LexeraRuntime ? window.LexeraRuntime : null;
  var _Settings = typeof LexeraSettings !== 'undefined' ? LexeraSettings : null;

  // Read deps — runtime state takes priority for shared state keys
  function _dep(name) {
    if (_rt && _rt.getState(name) !== undefined) return _rt.getState(name);
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
    return _callDep('persistBoardMutation', { targets: [{ type: 'board' }, { type: 'sidebar' }] });
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
    return _callDep('persistBoardMutation', { targets: [{ type: 'board' }, { type: 'sidebar' }] });
  }

  // ─── Ordering / sorting helpers ───────────────────────────────────────

  function getOrderedItems(items, storageKey, idFn) {
    var order;
    try {
      if (_Settings && storageKey === 'lexera-board-order') {
        order = _Settings.get('boardOrder');
      } else {
        var saved = localStorage.getItem(storageKey);
        if (!saved) return items;
        order = JSON.parse(saved);
      }
      if (!Array.isArray(order) || order.length === 0) return items;
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
    if (!Array.isArray(items)) return;
    var ids = items.map(idFn);
    if (_Settings && storageKey === 'lexera-board-order') {
      _Settings.set('boardOrder', ids);
    } else {
      localStorage.setItem(storageKey, JSON.stringify(ids));
    }
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

  function normalizeReorderBoardList(boards) {
    var list = Array.isArray(boards) ? boards : [];
    var normalized = [];
    for (var i = 0; i < list.length; i++) {
      if (!list[i] || !list[i].id) continue;
      normalized.push(list[i]);
    }
    return normalized;
  }

  function resolveBoardReorderId(ref, orderedBoards) {
    if (ref == null) return '';
    if (typeof ref === 'string') return String(ref).trim();
    if (typeof ref === 'object' && ref.boardId) return String(ref.boardId).trim();
    if (typeof ref === 'number' && isFinite(ref) && ref >= 0 && ref < orderedBoards.length) {
      return orderedBoards[ref] && orderedBoards[ref].id ? String(orderedBoards[ref].id).trim() : '';
    }
    return '';
  }

  function reorderIds(orderIds, sourceId, targetId, insertBefore) {
    var ids = Array.isArray(orderIds) ? orderIds.slice() : [];
    var sourceIdx = ids.indexOf(sourceId);
    var targetIdx = ids.indexOf(targetId);
    if (sourceIdx === -1 || targetIdx === -1 || sourceIdx === targetIdx) return ids;
    var moved = ids.splice(sourceIdx, 1)[0];
    if (sourceIdx < targetIdx) targetIdx -= 1;
    var insertIdx = insertBefore ? targetIdx : targetIdx + 1;
    if (insertIdx < 0) insertIdx = 0;
    if (insertIdx > ids.length) insertIdx = ids.length;
    ids.splice(insertIdx, 0, moved);
    return ids;
  }

  function reorderBoards(sourceRef, targetRef, insertBefore) {
    var boardList = _dep('boards');
    if (!Array.isArray(boardList)) {
      _callDep('logFrontendIssue', 'warn', 'boards.reorder', 'boards dep is not an array', { type: typeof boardList });
      return;
    }
    var orderedBoards = getOrderedItems(normalizeReorderBoardList(boardList), 'lexera-board-order', function (b) { return b.id; });
    var sourceId = resolveBoardReorderId(sourceRef, orderedBoards);
    var targetId = resolveBoardReorderId(targetRef, orderedBoards);
    if (!sourceId || !targetId || sourceId === targetId) return;
    var orderedIds = orderedBoards.map(function (b) { return b.id; });
    var newOrder = reorderIds(orderedIds, sourceId, targetId, insertBefore);
    if (_Settings) { _Settings.set('boardOrder', newOrder); } else { localStorage.setItem('lexera-board-order', JSON.stringify(newOrder)); }
    _callDep('invalidateBoardListFingerprint');
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

  // ─── Ratio / sidebar helpers (delegated to LexeraSidebarResize) ─────

  var _SidebarResize = typeof LexeraSidebarResize !== 'undefined' ? LexeraSidebarResize : null;

  function normalizeRatio(rawRatio, options) {
    return _SidebarResize ? _SidebarResize.normalizeRatio(rawRatio, options) : rawRatio;
  }

  function applySidebarSectionLayout() {
    if (_SidebarResize) _SidebarResize.applySidebarSectionLayout();
  }

  function setupSidebarSectionResize() {
    if (_SidebarResize) _SidebarResize.setupSidebarSectionResize();
  }

  function applySidebarWidth() {
    if (_SidebarResize) _SidebarResize.applySidebarWidth();
  }

  function setupSidebarWidthResize() {
    if (_SidebarResize) _SidebarResize.setupSidebarWidthResize();
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
    if (_Settings) { _Settings.set('headerSearchExpanded', !!expanded); } else { localStorage.setItem('lexera-header-search-expanded', expanded ? 'true' : 'false'); }
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

  // Called directly by the workspace shell (same-origin direct invocation on
  // frame.contentWindow.LexeraOrderHelpers) — no embeddedMode guard needed.
  // Bypasses boardSearch chain (which incorrectly routes through workspace shell
  // in the iframe) and focuses the card element directly via DOM.
  function navigateHierarchyTargetInIframe(target) {
    if (!target || !target.boardId) return Promise.resolve(false);
    // Use boardNavigation directly — bypasses boardSearch WS path
    var nav = _callDep('getBoardNavigationApi');
    if (!nav || typeof nav.navigateToHierarchyTarget !== 'function') return Promise.resolve(false);
    return nav.navigateToHierarchyTarget(target, {
      selectBoard: function () { return Promise.resolve(); },
      getActiveBoardId: function () { return target.boardId; },
      getActiveBoardData: function () { return _callDep('getActiveBoardData'); },
      loadBoard: function () { return Promise.resolve(); },
      unfoldSearchTarget: function (t) {
        if (nav && typeof nav.unfoldSearchTarget === 'function') {
          nav.unfoldSearchTarget(t, {
            getActiveBoardId: function () { return target.boardId; },
            getColumnsContainer: function () { return document.getElementById('columns-container'); },
            saveFoldState: function () { _callDep('saveFoldState'); }
          });
        }
      },
      focusHierarchyTargetLocally: function (t) {
        var c = document.getElementById('columns-container');
        if (!c) return false;
        var el = null;
        if (t.cardId) el = c.querySelector('.card[data-card-id="' + t.cardId + '"]');
        if (!el && t.brokenSrc) {
          var broken = c.querySelector('[data-file-path="' + t.brokenSrc + '"]') ||
                       c.querySelector('[data-include-path="' + t.brokenSrc + '"]');
          if (broken) el = broken.closest('.card') || broken.closest('.column') || broken;
        }
        if (!el) return false;
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        if (el.classList.contains('card')) _callDep('focusCard', el);
        else _callDep('focusBoardEntity', el);
        return true;
      }
    });
  }

  function handleEmbeddedHierarchyFocusMessage(event) {
    var data = event && event.data;
    if (!_dep('embeddedMode')) return;
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
    // The workspace shell notifies us that a different board tab is now active.
    // Boards are loaded inside iframes — we do NOT load board data in the
    // parent window. We only update the sidebar to highlight the active board
    // and refresh the dashboard scope.
    _callDep('setActiveBoardId', boardId || null);
    if (!_dep('embeddedMode')) {
      if (boardId) {
        if (_Settings) { _Settings.set('lastBoard', boardId); } else { localStorage.setItem('lexera-last-board', boardId); }
        _callDep('trackRecentBoard', boardId);
      }
    }
    _callDep('renderBoardList');
    refreshHeaderFileControls();
    scheduleDashboardRefresh(120);
  }

  function flushStaleMirrors() {
    var hasStaleDashboard = false;
    var hasStaleHierarchy = false;
    var dashboardRoots = _callDep('getSharedPanelRoots', 'dashboard');
    if (dashboardRoots) {
      for (var d = 0; d < dashboardRoots.length; d++) {
        if (dashboardRoots[d] && dashboardRoots[d].getAttribute('data-mirror-stale') === 'true' && isMirrorRootVisible(dashboardRoots[d])) {
          hasStaleDashboard = true;
          break;
        }
      }
    }
    var hierarchyRoots = _callDep('getSharedPanelRoots', 'hierarchy');
    if (hierarchyRoots) {
      for (var h = 0; h < hierarchyRoots.length; h++) {
        if (hierarchyRoots[h] && hierarchyRoots[h].getAttribute('data-mirror-stale') === 'true' && isMirrorRootVisible(hierarchyRoots[h])) {
          hasStaleHierarchy = true;
          break;
        }
      }
    }
    if (hasStaleDashboard) syncMirroredDashboardViews();
    if (hasStaleHierarchy) _callDep('syncMirroredWorkspaceViews');
  }

  function setupWorkspaceShell() {
    if (!_dep('workspaceShellEnabled') || !_dep('WorkspaceShell')) return;
    var shell = _dep('WorkspaceShell');
    shell.mount({
      getMainContent: _dep('getElMainContent'),
      onActiveBoardChanged: function (boardId) {
        setShellActiveBoard(boardId || null);
      },
      onAfterRender: function () {
        flushStaleMirrors();
      },
      openWindow: function (payload) {
        if (!_dep('hasTauri')) return Promise.reject(new Error('Tauri unavailable'));
        return _callDep('tauriInvoke', 'open_new_window', payload || {});
      },
      showNativeMenu: function (items, x, y) {
        return _callDep('showNativeMenu', items, x, y);
      },
      refreshBoardHierarchy: function (boardId, fullBoard) {
        _callDep('setBoardHierarchyRows', boardId, fullBoard, '');
        _callDep('invalidateBoardListFingerprint');
        _callDep('renderBoardList');
      }
    });
    // Ensure hierarchy panel is visible after mount — guards against corrupted persisted state
    if (typeof shell.isPanelVisible === 'function' && !shell.isPanelVisible('hierarchy')) {
      if (typeof shell.revealPanel === 'function') shell.revealPanel('hierarchy');
    }
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
    if (_Settings) { _Settings.set('sidebarTreeState', null); } else { localStorage.removeItem('lexera-sidebar-tree-state'); }
    localStorage.setItem(versionKey, '1');
  }

  // ─── Dashboard state and rendering ────────────────────────────────────

  var dashboardState = null;
  var dashboardSearchDebounce = null;
  var dashboardRefreshTimer = null;
  var dashboardBrokenRefreshTimer = null;
  var dashboardRefreshSeq = 0;
  var dashboardFileInventorySeq = 0;
  var dashboardMirrorSyncQueued = false;
  var _fileInventoryBoardId = null;       // board ID of last successful file inventory
  var _fileInventoryDataStamp = 0;        // incremented when board data changes
  var _fileInventoryLastStamp = -1;       // stamp of last completed file inventory
  var _brokenScanPending = false;         // true while a deferred broken scan is queued
  var _brokenScanBoardId = null;          // board ID when scan was scheduled

  // ── Dashboard data cache: avoids blank dashboard on tab switches ──
  // Keyed by boardId + scope + query, stores processed dashboardState snapshot.
  var _dashboardDataCache = {};
  var _DASHBOARD_DATA_CACHE_MAX = 8;

  function _dashboardCacheKey() {
    var boardId = _dep('activeBoardId') || '__none__';
    var scope = dashboardState ? (dashboardState.scope || 'active') : 'active';
    var query = dashboardState ? (dashboardState.query || '') : '';
    return boardId + '|' + scope + '|' + query;
  }

  function _saveDashboardDataToCache() {
    if (!dashboardState) return;
    var key = _dashboardCacheKey();
    var snapshot = {
      results: dashboardState.results,
      resultTotal: dashboardState.resultTotal,
      overdue: dashboardState.overdue,
      overdueTotal: dashboardState.overdueTotal,
      today: dashboardState.today,
      todayTotal: dashboardState.todayTotal,
      thisWeek: dashboardState.thisWeek,
      thisWeekTotal: dashboardState.thisWeekTotal,
      upcoming: dashboardState.upcoming,
      upcomingTotal: dashboardState.upcomingTotal,
      later: dashboardState.later,
      laterTotal: dashboardState.laterTotal,
      todos: dashboardState.todos,
      taggedGroups: dashboardState.taggedGroups,
      _ts: Date.now()
    };
    _dashboardDataCache[key] = snapshot;
    // Evict oldest entries when cache exceeds max size
    var keys = Object.keys(_dashboardDataCache);
    if (keys.length > _DASHBOARD_DATA_CACHE_MAX) {
      var oldest = keys[0];
      var oldestTs = _dashboardDataCache[oldest]._ts;
      for (var ki = 1; ki < keys.length; ki++) {
        if (_dashboardDataCache[keys[ki]]._ts < oldestTs) {
          oldest = keys[ki];
          oldestTs = _dashboardDataCache[keys[ki]]._ts;
        }
      }
      delete _dashboardDataCache[oldest];
    }
  }

  function _restoreDashboardDataFromCache() {
    if (!dashboardState) return false;
    var key = _dashboardCacheKey();
    var snapshot = _dashboardDataCache[key];
    if (!snapshot) return false;
    dashboardState.results = snapshot.results || [];
    dashboardState.resultTotal = snapshot.resultTotal;
    dashboardState.overdue = snapshot.overdue || [];
    dashboardState.overdueTotal = snapshot.overdueTotal;
    dashboardState.today = snapshot.today || [];
    dashboardState.todayTotal = snapshot.todayTotal;
    dashboardState.thisWeek = snapshot.thisWeek || [];
    dashboardState.thisWeekTotal = snapshot.thisWeekTotal;
    dashboardState.upcoming = snapshot.upcoming || [];
    dashboardState.upcomingTotal = snapshot.upcomingTotal;
    dashboardState.later = snapshot.later || [];
    dashboardState.laterTotal = snapshot.laterTotal;
    dashboardState.todos = snapshot.todos || [];
    dashboardState.taggedGroups = snapshot.taggedGroups || [];
    return true;
  }

  // ── Dashboard render-cache: skip DOM rebuild when data is unchanged ──
  // Simple dirty-flag for dashboard sections: generation counter bumped on data change.
  var _dashboardRenderGeneration = 0;
  var _dashboardRenderedGeneration = {};

  /**
   * Cheap fingerprint: item count + first/last IDs. Avoids JSON.stringify cost.
   */
  function _dashboardFingerprint(data, extra) {
    if (!Array.isArray(data) || data.length === 0) return '0';
    var first = data[0];
    var last = data[data.length - 1];
    var fp = data.length + ':' + (first.id || first.title || '') + ':' + (last.id || last.title || '');
    return extra ? fp + '|' + extra : fp;
  }

  /**
   * Check whether a section's fingerprint matches the cached value.
   * If it matches, return true (skip render). Otherwise store and return false.
   */
  function _dashboardCacheHit(cacheKey, fingerprint) {
    if (_dashboardRenderedGeneration[cacheKey] === fingerprint) return true;
    _dashboardRenderedGeneration[cacheKey] = fingerprint;
    return false;
  }

  /**
   * Invalidate (clear) the entire dashboard render cache, e.g. on board switch.
   */
  function invalidateDashboardRenderCache() {
    _dashboardRenderGeneration++;
    _dashboardRenderedGeneration = {};
    markFileInventoryDirty();
  }

  function normalizeDashboardScope(scope) {
    return scope === 'all' ? 'all' : 'active';
  }

  function loadDashboardPinnedQueries() {
    try {
      var raw = _Settings ? _Settings.get('dashboardPinnedQueries') : JSON.parse(localStorage.getItem('lexera-dashboard-pinned-queries') || '[]');
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
    if (_Settings) {
      _Settings.set('dashboardQuery', dashboardState.query || '');
      _Settings.set('dashboardScope', normalizeDashboardScope(dashboardState.scope));
      _Settings.set('dashboardActivePinned', dashboardState.activePinnedQuery || '');
      _Settings.set('dashboardPinnedQueries', dashboardState.pinnedQueries || []);
    } else {
      localStorage.setItem('lexera-dashboard-query', dashboardState.query || '');
      localStorage.setItem('lexera-dashboard-scope', normalizeDashboardScope(dashboardState.scope));
      localStorage.setItem('lexera-dashboard-active-pinned', dashboardState.activePinnedQuery || '');
      localStorage.setItem('lexera-dashboard-pinned-queries', JSON.stringify(dashboardState.pinnedQueries || []));
    }
  }

  function setDashboardScope(scope) {
    if (!dashboardState) return;
    dashboardState.scope = normalizeDashboardScope(scope);
    if (_callDep('getElDashboardScopeSelect')) _callDep('getElDashboardScopeSelect').value = dashboardState.scope;
    persistDashboardPrefs();
    scheduleMirroredDashboardSync();
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
    scheduleMirroredDashboardSync();
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

      var containerInfo = getDashboardMirrorContainerInfo(e.target);
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

      var localTreeNode = e.target.closest('.tree-node[data-dashboard-target]');
      if (!localTreeNode) return;
      e.preventDefault();
      var targetType = localTreeNode.getAttribute('data-dashboard-target') || '';
      var targetSelector = targetType ? '.tree-node[data-dashboard-target="' + targetType + '"]' : '.tree-node[data-dashboard-target]';
      var localTreeNodes = Array.prototype.slice.call(containerInfo.local.querySelectorAll(targetSelector));
      var canonicalTreeNodes = Array.prototype.slice.call(containerInfo.canonical.querySelectorAll(targetSelector));
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

  function cloneChildrenInto(source, target) {
    target.textContent = '';
    for (var i = 0; i < source.childNodes.length; i++) {
      target.appendChild(source.childNodes[i].cloneNode(true));
    }
  }

  var DASHBOARD_MIRROR_LISTS = [
    { selector: '.lexera-shared-dashboard-pinned', getter: 'getElDashboardPinnedList' },
    { selector: '.lexera-shared-dashboard-results', getter: 'getElDashboardResultsList' },
    { selector: '.lexera-shared-dashboard-overdue', getter: 'getElDashboardOverdueList' },
    { selector: '.lexera-shared-dashboard-upcoming', getter: 'getElDashboardUpcomingList' },
    { selector: '.lexera-shared-dashboard-todos', getter: 'getElDashboardTodosList' },
    { selector: '.lexera-shared-dashboard-tagged', getter: 'getElDashboardTaggedList' },
    { selector: '.lexera-shared-dashboard-embeds', getter: 'getElDashboardEmbedsList' },
    { selector: '.lexera-shared-dashboard-broken', getter: 'getElDashboardBrokenList' },
    { selector: '.lexera-shared-dashboard-included', getter: 'getElDashboardIncludedList' }
  ];

  function getDashboardMirrorContainerInfo(target) {
    for (var i = 0; i < DASHBOARD_MIRROR_LISTS.length; i++) {
      var binding = DASHBOARD_MIRROR_LISTS[i];
      var localContainer = target.closest(binding.selector);
      if (!localContainer) continue;
      return {
        local: localContainer,
        canonical: _callDep(binding.getter)
      };
    }
    return null;
  }

  function isMirrorRootVisible(rootEl) {
    return rootEl.offsetParent !== null;
  }

  function syncMirroredDashboardViews() {
    var dashboardRoots = _callDep('getSharedPanelRoots', 'dashboard');
    if (!dashboardRoots || !dashboardRoots.length || !_callDep('getElDashboardRoot')) return;
    var canonicalGroups = _callDep('getElDashboardRoot').querySelectorAll('.dashboard-group');
    for (var i = 0; i < dashboardRoots.length; i++) {
      var rootEl = dashboardRoots[i];
      if (!rootEl) continue;
      if (!isMirrorRootVisible(rootEl)) {
        rootEl.setAttribute('data-mirror-stale', 'true');
        continue;
      }
      rootEl.removeAttribute('data-mirror-stale');
      bindMirroredDashboardView(rootEl);
      var searchEl = rootEl.querySelector('.lexera-shared-dashboard-search');
      var scopeEl = rootEl.querySelector('.lexera-shared-dashboard-scope');
      if (searchEl && dashboardState) searchEl.value = dashboardState.query || '';
      if (scopeEl && dashboardState) scopeEl.value = dashboardState.scope || 'active';
      for (var li = 0; li < DASHBOARD_MIRROR_LISTS.length; li++) {
        var binding = DASHBOARD_MIRROR_LISTS[li];
        var localList = rootEl.querySelector(binding.selector);
        var canonicalList = _callDep(binding.getter);
        if (localList && canonicalList) cloneChildrenInto(canonicalList, localList);
      }
      var mirrorGroups = rootEl.querySelectorAll('.dashboard-group');
      for (var j = 0; j < mirrorGroups.length && j < canonicalGroups.length; j++) {
        mirrorGroups[j].className = canonicalGroups[j].className;
      }
    }
  }

  function scheduleMirroredDashboardSync() {
    if (dashboardMirrorSyncQueued) return;
    dashboardMirrorSyncQueued = true;
    var flush = function () {
      dashboardMirrorSyncQueued = false;
      syncMirroredDashboardViews();
    };
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(flush);
      return;
    }
    setTimeout(flush, 0);
  }

  function scheduleDashboardBrokenRefresh(delayMs) {
    clearTimeout(dashboardBrokenRefreshTimer);
    dashboardBrokenRefreshTimer = setTimeout(function () {
      dashboardBrokenRefreshTimer = null;
      renderDashboardBrokenList();
    }, typeof delayMs === 'number' ? delayMs : 300);
  }

  function formatDashboardDate(d) {
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  function getEndOfWeek(d) {
    var dayOfWeek = d.getDay(); // 0=Sun
    var daysUntilSunday = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;
    var end = new Date(d.getTime() + daysUntilSunday * 86400000);
    return end;
  }

  // ── Dashboard tagged items config ──────────────────────────────────
  var _cachedDashboardTags = null;

  function getDashboardTags() {
    if (_cachedDashboardTags && Array.isArray(_cachedDashboardTags)) return _cachedDashboardTags;
    try {
      if (_Settings) {
        var settingsVal = _Settings.get('dashboardTags');
        if (Array.isArray(settingsVal)) return settingsVal;
      } else {
        var raw = localStorage.getItem('lexera-dashboard-tags');
        if (raw) {
          var parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) return parsed;
        }
      }
    } catch (err) { _callDep('logFrontendIssue', 'warn', 'dashboard.tags', 'Failed to read dashboard tags', err); }
    return ['#important', '#blocked', '#review'];
  }

  function setDashboardTags(tags) {
    _cachedDashboardTags = tags;
    try { if (_Settings) { _Settings.set('dashboardTags', tags); } else { localStorage.setItem('lexera-dashboard-tags', JSON.stringify(tags)); } } catch (_) { /* intentional: localStorage unavailable in private browsing */ }
    var LexeraApi = _dep('LexeraApi');
    var workspaceId = _dep('activeWorkspaceId') || null;
    if (workspaceId === '__all__') workspaceId = null;
    if (LexeraApi && typeof LexeraApi.request === 'function') {
      LexeraApi.request('/config/dashboard-tags', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags: tags, workspace: workspaceId })
      }).catch(function () { /* best effort */ });
    }
  }

  function refreshDashboardTagsFromBackend() {
    var LexeraApi = _dep('LexeraApi');
    if (!LexeraApi || typeof LexeraApi.request !== 'function') return;
    var workspaceId = _dep('activeWorkspaceId') || '';
    if (workspaceId === '__all__') workspaceId = '';
    var url = '/config/dashboard-tags' + (workspaceId ? '?workspace=' + encodeURIComponent(workspaceId) : '');
    LexeraApi.request(url, { timeoutMs: 3000 }).then(function (data) {
      if (data && Array.isArray(data.tags)) {
        _cachedDashboardTags = data.tags;
        try { if (_Settings) { _Settings.set('dashboardTags', data.tags); } else { localStorage.setItem('lexera-dashboard-tags', JSON.stringify(data.tags)); } } catch (_) { /* intentional */ }
      }
    }).catch(function () { /* use cached/localStorage fallback */ });
  }

  // ── Dashboard calendar view ───────────────────────────────────────
  function getISOWeek(d) {
    var dt = new Date(d.getTime());
    dt.setHours(0, 0, 0, 0);
    dt.setDate(dt.getDate() + 3 - (dt.getDay() + 6) % 7);
    var week1 = new Date(dt.getFullYear(), 0, 4);
    return 1 + Math.round(((dt - week1) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
  }

  function getMonday(d) {
    var dt = new Date(d.getTime());
    var day = dt.getDay();
    var diff = day === 0 ? -6 : 1 - day;
    dt.setDate(dt.getDate() + diff);
    dt.setHours(0, 0, 0, 0);
    return dt;
  }

  function buildDateTaskMap(tasks) {
    var map = {};
    for (var i = 0; i < (tasks || []).length; i++) {
      var due = tasks[i].dueDate;
      if (!due) continue;
      if (!map[due]) map[due] = [];
      map[due].push(tasks[i]);
    }
    return map;
  }

  function escapeCalHtml(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  // Weekly view: 7 days starting from today, each day shows date + task titles
  function renderWeekCalendar(el, tasks) {
    if (!el) return;
    var now = new Date();
    var todayStr = formatDashboardDate(now);
    var dateMap = buildDateTaskMap(tasks);
    var dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    var html = '';
    for (var d = 0; d < 7; d++) {
      var dt = new Date(now.getTime() + d * 86400000);
      var dtStr = formatDashboardDate(dt);
      var isToday = dtStr === todayStr;
      var dayTasks = dateMap[dtStr] || [];
      html += '<div class="cal-week-day' + (isToday ? ' cal-today' : '') + '">';
      html += '<div class="cal-week-day-header">';
      html += '<span class="cal-week-day-name">' + dayLabels[dt.getDay()] + '</span>';
      html += '<span class="cal-week-day-date">' + dt.getDate() + '.' + (dt.getMonth() + 1) + '.</span>';
      if (dayTasks.length > 0) html += '<span class="cal-count">' + dayTasks.length + '</span>';
      html += '</div>';
      for (var t = 0; t < dayTasks.length && t < 5; t++) {
        var title = String(dayTasks[t].cardContent || '').split('\n')[0];
        if (title.length > 50) title = title.substring(0, 50) + '\u2026';
        var board = dayTasks[t].boardTitle || '';
        html += '<div class="cal-week-task">' + escapeCalHtml(title);
        if (board) html += ' <span class="cal-week-task-board">' + escapeCalHtml(board) + '</span>';
        html += '</div>';
      }
      if (dayTasks.length > 5) html += '<div class="cal-week-task cal-week-more">+' + (dayTasks.length - 5) + ' more</div>';
      if (dayTasks.length === 0) html += '<div class="cal-week-empty">\u2014</div>';
      html += '</div>';
    }
    el.innerHTML = html;
  }

  // Horizontal week timeline for standalone panel: today + 6 days as columns
  function renderWeekTimeline(el, tasks) {
    if (!el) return;
    var now = new Date();
    var todayStr = formatDashboardDate(now);
    var dateMap = buildDateTaskMap(tasks);
    var dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    var html = '<div class="cal-timeline">';
    for (var d = 0; d < 7; d++) {
      var dt = new Date(now.getTime() + d * 86400000);
      var dtStr = formatDashboardDate(dt);
      var isToday = dtStr === todayStr;
      var dayTasks = dateMap[dtStr] || [];
      html += '<div class="cal-timeline-col' + (isToday ? ' cal-today' : '') + '">';
      html += '<div class="cal-timeline-header">';
      html += '<span class="cal-timeline-day">' + dayLabels[dt.getDay()] + '</span>';
      html += '<span class="cal-timeline-date">' + dt.getDate() + '.' + (dt.getMonth() + 1) + '</span>';
      if (dayTasks.length > 0) html += '<span class="cal-count">' + dayTasks.length + '</span>';
      html += '</div>';
      html += '<div class="cal-timeline-tasks">';
      for (var t = 0; t < dayTasks.length; t++) {
        var title = String(dayTasks[t].cardContent || '').split('\n')[0];
        if (title.length > 40) title = title.substring(0, 40) + '\u2026';
        html += '<div class="cal-timeline-task">' + escapeCalHtml(title) + '</div>';
      }
      if (dayTasks.length === 0) html += '<div class="cal-timeline-empty">\u2014</div>';
      html += '</div>';
      html += '</div>';
    }
    html += '</div>';
    el.innerHTML = html;
  }

  // Monthly view: 4-week grid with counts
  function renderMonthCalendar(el, tasks) {
    if (!el) return;
    var now = new Date();
    var todayStr = formatDashboardDate(now);
    var dateMap = buildDateTaskMap(tasks);
    var startMonday = getMonday(new Date(now.getTime() - 7 * 86400000));
    var dayNames = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
    var html = '<table class="dashboard-calendar-grid"><thead><tr><th>CW</th>';
    for (var d = 0; d < 7; d++) html += '<th>' + dayNames[d] + '</th>';
    html += '</tr></thead><tbody>';
    for (var w = 0; w < 4; w++) {
      var weekStart = new Date(startMonday.getTime() + w * 7 * 86400000);
      var cw = getISOWeek(weekStart);
      html += '<tr><td class="cal-cw">' + cw + '</td>';
      for (var dd = 0; dd < 7; dd++) {
        var cellDate = new Date(weekStart.getTime() + dd * 86400000);
        var cellStr = formatDashboardDate(cellDate);
        var count = (dateMap[cellStr] || []).length;
        var isToday = cellStr === todayStr;
        var isPast = cellStr < todayStr;
        var cls = 'cal-day' + (isToday ? ' cal-today' : '') + (isPast ? ' cal-past' : '') + (count > 0 ? ' cal-has-tasks' : '');
        html += '<td class="' + cls + '"><span class="cal-date">' + cellDate.getDate() + '</span>';
        if (count > 0) html += '<span class="cal-count">' + count + '</span>';
        html += '</td>';
      }
      html += '</tr>';
    }
    html += '</tbody></table>';
    el.innerHTML = html;
  }

  // Task list below calendar — upcoming tasks grouped by date
  function renderCalendarTaskList(el, tasks) {
    if (!el) return;
    var now = new Date();
    var todayStr = formatDashboardDate(now);
    var sorted = sortSearchByDueDateAsc((tasks || []).filter(function (t) { return t && !t.isOverdue; }));
    if (sorted.length === 0) { el.innerHTML = '<div class="dashboard-empty">No upcoming tasks</div>'; return; }
    var html = '';
    var lastDate = '';
    for (var i = 0; i < sorted.length && i < 30; i++) {
      var due = sorted[i].dueDate || '';
      if (due !== lastDate) {
        lastDate = due;
        var label = due === todayStr ? 'Today' : due;
        html += '<div class="cal-task-date-header">' + escapeCalHtml(label) + '</div>';
      }
      var title = String(sorted[i].cardContent || '').split('\n')[0];
      if (title.length > 60) title = title.substring(0, 60) + '\u2026';
      var board = sorted[i].boardTitle || '';
      html += '<div class="cal-task-item">' + escapeCalHtml(title);
      if (board) html += ' <span class="cal-task-board">' + escapeCalHtml(board) + '</span>';
      html += '</div>';
    }
    if (sorted.length > 30) html += '<div class="cal-task-item cal-week-more">+' + (sorted.length - 30) + ' more</div>';
    el.innerHTML = html;
  }

  function getCalendarTasks() {
    if (!dashboardState) return [];
    return (dashboardState.overdue || []).concat(
      dashboardState.today || [], dashboardState.thisWeek || [],
      dashboardState.upcoming || [], dashboardState.later || []);
  }

  function renderStandaloneCalendarPanels(tasks) {
    if (!window.LexeraSharedPanels) return;
    var rt = typeof window !== 'undefined' && window.LexeraRuntime ? window.LexeraRuntime : null;
    var weekRoots = window.LexeraSharedPanels.getRoots('weekCalendar');
    for (var w = 0; w < weekRoots.length; w++) {
      var weekBody = weekRoots[w].querySelector('.calendar-panel-body');
      if (rt && weekBody) rt.setViewLoading(weekBody, false);
      var weekEl = weekRoots[w].querySelector('.lexera-shared-calendar-week-view');
      var weekTaskEl = weekRoots[w].querySelector('.lexera-shared-calendar-task-list');
      renderWeekTimeline(weekEl, tasks);
      renderCalendarTaskList(weekTaskEl, tasks);
    }
    var monthRoots = window.LexeraSharedPanels.getRoots('monthCalendar');
    for (var m = 0; m < monthRoots.length; m++) {
      var monthBody = monthRoots[m].querySelector('.calendar-panel-body');
      if (rt && monthBody) rt.setViewLoading(monthBody, false);
      var monthEl = monthRoots[m].querySelector('.lexera-shared-calendar-month-view');
      var monthTaskEl = monthRoots[m].querySelector('.lexera-shared-calendar-task-list');
      renderMonthCalendar(monthEl, tasks);
      renderCalendarTaskList(monthTaskEl, tasks);
    }
  }

  function isSkippableDashboardFilePath(value) {
    var normalized = String(value || '').trim();
    if (!normalized) return true;
    if (_callDep('isExternalHttpUrl', normalized)) return true;
    return /^(?:#|mailto:|tel:|data:|javascript:)/i.test(normalized);
  }

  function normalizeDashboardFilePath(path) {
    var normalized = String(path || '').trim();
    if (!normalized) return '';
    if (isSkippableDashboardFilePath(normalized)) return '';
    var fileRef = _callDep('parseLocalFileReference', normalized);
    if (fileRef && fileRef.path) normalized = String(fileRef.path || '').trim();
    return normalized;
  }

  function appendDashboardFileGroup(store, kind, rawPath, contextLabel, locationData) {
    var normalizedPath = normalizeDashboardFilePath(rawPath);
    if (!normalizedPath) return;
    var key = kind + '|' + normalizedPath.toLowerCase();
    var ext = _callDep('getFileExtension', normalizedPath) || '';
    var mediaCategory = kind === 'embed' ? (_callDep('getMediaCategory', ext) || '') : '';
    if (!store.byKey[key]) {
      store.byKey[key] = {
        kind: kind,
        path: normalizedPath,
        count: 0,
        firstContextLabel: contextLabel || '',
        firstCardId: (locationData && locationData.cardId) || null,
        firstColumnIndex: (locationData && locationData.columnIndex != null) ? locationData.columnIndex : null,
        firstRowIndex: (locationData && locationData.rowIndex != null) ? locationData.rowIndex : null,
        firstStackIndex: (locationData && locationData.stackIndex != null) ? locationData.stackIndex : null,
        firstColLocalIndex: (locationData && locationData.colLocalIndex != null) ? locationData.colLocalIndex : null,
        extension: ext,
        mediaCategory: mediaCategory
      };
      store.list.push(store.byKey[key]);
    }
    store.byKey[key].count += 1;
    if (!store.byKey[key].firstContextLabel && contextLabel) {
      store.byKey[key].firstContextLabel = contextLabel;
    }
  }

  function getColumnIncludeSourcePath(col) {
    if (col && col.includeSource && col.includeSource.rawPath) {
      return String(col.includeSource.rawPath || '').trim();
    }
    return extractIncludePathFromTitle(col && col.title ? col.title : '');
  }

  function getDashboardInventoryContextLabel(col, visibleIndex) {
    return removeIncludeSyntaxFromTitle(col && col.title ? col.title : '') || ('Column ' + (visibleIndex + 1));
  }

  function getDashboardResolvedCardContent(col, card) {
    var content = String(card && card.content ? card.content : '');
    var includeSourcePath = getColumnIncludeSourcePath(col);
    if (!content || !includeSourcePath) return content;
    if (typeof _callDep('resolveMarkdownRelativeTargets', content, includeSourcePath) === 'string') {
      return _callDep('resolveMarkdownRelativeTargets', content, includeSourcePath);
    }
    return content;
  }

  function collectDashboardFileReferences(boardData) {
    var rows = boardData && Array.isArray(boardData.rows) ? boardData.rows : [];
    var embedStore = { list: [], byKey: {} };
    var includeStore = { list: [], byKey: {} };
    var visibleIndex = 0;
    for (var rowIdx = 0; rowIdx < rows.length; rowIdx++) {
      var row = rows[rowIdx];
      var stacks = row && Array.isArray(row.stacks) ? row.stacks : [];
      for (var stackIdx = 0; stackIdx < stacks.length; stackIdx++) {
        var stack = stacks[stackIdx];
        var columns = stack && Array.isArray(stack.columns) ? stack.columns : [];
        for (var colIdx = 0; colIdx < columns.length; colIdx++, visibleIndex++) {
          var col = columns[colIdx];
          if (!col) continue;
          var contextLabel = getDashboardInventoryContextLabel(col, visibleIndex);
          var includePath = getColumnIncludeSourcePath(col);
          var colLocation = { cardId: null, columnIndex: visibleIndex, rowIndex: rowIdx, stackIndex: stackIdx, colLocalIndex: colIdx };
          if (includePath) appendDashboardFileGroup(includeStore, 'include', includePath, contextLabel, colLocation);

          var cards = Array.isArray(col.cards) ? col.cards : [];
          for (var cardIdx = 0; cardIdx < cards.length; cardIdx++) {
            var card = cards[cardIdx];
            var content = getDashboardResolvedCardContent(col, card);
            if (!content) continue;
            var cardLocation = { cardId: (card && card.id) ? String(card.id) : null, columnIndex: visibleIndex, rowIndex: rowIdx, stackIndex: stackIdx, colLocalIndex: colIdx };

            String(content).replace(/!\[([^\]]*)\]\(([^)]+)\)(\{[^}]+\})?/g, function (_match, _alt, rawTarget) {
              var parsed = _callDep('parseMarkdownTarget', rawTarget);
              appendDashboardFileGroup(embedStore, 'embed', parsed && parsed.path ? parsed.path : rawTarget, contextLabel, cardLocation);
              return _match;
            });

            String(content).replace(/(^|[^!])\[([^\]]+)\]\(([^)]+)\)/g, function (_match, _prefix, _label, rawTarget) {
              var parsed = _callDep('parseMarkdownTarget', rawTarget);
              appendDashboardFileGroup(embedStore, 'embed', parsed && parsed.path ? parsed.path : rawTarget, contextLabel, cardLocation);
              return _match;
            });

            String(content).replace(/!!!include\(([^)]+)\)!!!/g, function (_match, rawIncludePath) {
              appendDashboardFileGroup(includeStore, 'include', rawIncludePath, contextLabel, cardLocation);
              return _match;
            });
          }
        }
      }
    }
    return {
      fileEmbeds: embedStore.list,
      includedFiles: includeStore.list
    };
  }

  function getDashboardInventoryContextLabelFromElement(el) {
    var colEl = el && typeof el.closest === 'function' ? el.closest('.column') : null;
    if (!colEl) return '';
    var rawTitle = typeof colEl.getAttribute === 'function' ? String(colEl.getAttribute('data-col-title') || '').trim() : '';
    if (!rawTitle && typeof colEl.querySelector === 'function') {
      var titleEl = colEl.querySelector('.column-title');
      rawTitle = titleEl && titleEl.textContent ? String(titleEl.textContent || '').trim() : '';
    }
    return removeIncludeSyntaxFromTitle(rawTitle);
  }

  function collectDashboardFileReferencesFromContainer(container) {
    var embedStore = { list: [], byKey: {} };
    var includeStore = { list: [], byKey: {} };
    if (!container || typeof container.querySelectorAll !== 'function') {
      return {
        fileEmbeds: embedStore.list,
        includedFiles: includeStore.list
      };
    }

    var embedSelector = [
      '.embed-container[data-file-path]',
      '.inline-file-embed-container[data-file-path]',
      '.link-path-overlay-container[data-file-path]',
      '.image-path-overlay-container[data-file-path]',
      '.video-path-overlay-container[data-file-path]',
      '.wysiwyg-media[data-file-path]',
      '.wysiwyg-media-block[data-file-path]'
    ].join(', ');
    var includeSelector = [
      '.column-include-badge[data-include-path]',
      '.include-inline-container[data-file-path]',
      '.include-link-container[data-file-path]'
    ].join(', ');

    function domElementLocation(el) {
      var cardEl = el && typeof el.closest === 'function' ? el.closest('.card') : null;
      var colEl = el && typeof el.closest === 'function' ? el.closest('.column') : null;
      var cardId = cardEl ? (cardEl.getAttribute('data-card-id') || null) : null;
      var colIdx = cardEl ? parseInt(cardEl.getAttribute('data-col-index'), 10) : NaN;
      var rIdx = colEl ? parseInt(colEl.getAttribute('data-row-index'), 10) : NaN;
      var sIdx = colEl ? parseInt(colEl.getAttribute('data-stack-index'), 10) : NaN;
      var clIdx = colEl ? parseInt(colEl.getAttribute('data-col-local-index'), 10) : NaN;
      return {
        cardId: cardId || null,
        columnIndex: isNaN(colIdx) ? null : colIdx,
        rowIndex: isNaN(rIdx) ? null : rIdx,
        stackIndex: isNaN(sIdx) ? null : sIdx,
        colLocalIndex: isNaN(clIdx) ? null : clIdx
      };
    }

    var embedEls = container.querySelectorAll(embedSelector);
    for (var embedIdx = 0; embedIdx < embedEls.length; embedIdx++) {
      var embedEl = embedEls[embedIdx];
      var embedPath = typeof embedEl.getAttribute === 'function' ? embedEl.getAttribute('data-file-path') || '' : '';
      appendDashboardFileGroup(embedStore, 'embed', embedPath, getDashboardInventoryContextLabelFromElement(embedEl), domElementLocation(embedEl));
    }

    var includeEls = container.querySelectorAll(includeSelector);
    for (var includeIdx = 0; includeIdx < includeEls.length; includeIdx++) {
      var includeEl = includeEls[includeIdx];
      var includePath = typeof includeEl.getAttribute === 'function'
        ? (includeEl.getAttribute('data-include-path') || includeEl.getAttribute('data-file-path') || '')
        : '';
      appendDashboardFileGroup(includeStore, 'include', includePath, getDashboardInventoryContextLabelFromElement(includeEl), domElementLocation(includeEl));
    }

    return {
      fileEmbeds: embedStore.list,
      includedFiles: includeStore.list
    };
  }

  function collectDashboardIncludedFiles(boardData) {
    return collectDashboardFileReferences(boardData).includedFiles;
  }

  function collectDashboardFileEmbeds(boardData) {
    return collectDashboardFileReferences(boardData).fileEmbeds;
  }

  function requestDashboardFileInfo(boardId, filePath) {
    var infoRequester = _callDep('requestFileInfo');
    if (typeof infoRequester === 'function') {
      return infoRequester(boardId, filePath);
    }
    var api = _dep('LexeraApi');
    if (api && typeof api.fileInfo === 'function') {
      return api.fileInfo(boardId, filePath).catch(function () { return null; });
    }
    return Promise.resolve(null);
  }

  function bindDashboardTreeInteractions(targetEl) {
    if (!targetEl || targetEl.__dashboardTreeClickBound) return;
    var TreeView = _dep('TreeView');
    targetEl.addEventListener('click', function (e) {
      var toggle = e.target.closest('.tree-toggle');
      if (toggle && targetEl.contains(toggle)) {
        var toggleNode = toggle.closest('.tree-node');
        if (toggleNode) TreeView.toggleNode(toggleNode);
        return;
      }
      var node = e.target.closest('.tree-node[data-dashboard-target]');
      if (!node || !targetEl.contains(node)) return;
      var target = String(node.getAttribute('data-dashboard-target') || '').trim();
      if (target === 'result') {
        var navResult = _callDep('getDashboardTreeApi').buildDashboardNavResultFromTreeNode(node);
        if (navResult) _callDep('navigateToSearchResult', navResult);
        return;
      }
      if (target === 'file') {
        var fileBoardId = _dep('activeBoardId') || _fileInventoryBoardId || '';
        var fileCardId = String(node.getAttribute('data-dashboard-card-id') || '').trim() || null;
        var fileRowIndex = parseInt(node.getAttribute('data-dashboard-row-index'), 10);
        var fileStackIndex = parseInt(node.getAttribute('data-dashboard-stack-index'), 10);
        var fileColLocalIndex = parseInt(node.getAttribute('data-dashboard-col-local-index'), 10);
        var fileCardIndex = parseInt(node.getAttribute('data-dashboard-card-index'), 10);
        if (fileBoardId) {
          _callDep('navigateToSearchResult', {
            boardId: fileBoardId,
            cardId: fileCardId,
            rowIndex: isNaN(fileRowIndex) ? null : fileRowIndex,
            stackIndex: isNaN(fileStackIndex) ? null : fileStackIndex,
            colLocalIndex: isNaN(fileColLocalIndex) ? null : fileColLocalIndex,
            cardIndex: isNaN(fileCardIndex) ? null : fileCardIndex
          });
        }
        return;
      }
      if (target === 'broken') {
        var boardId = _dep('activeBoardId') || _brokenScanBoardId || '';
        var cardId = String(node.getAttribute('data-dashboard-card-id') || '').trim() || null;
        var cardIndex = parseInt(node.getAttribute('data-dashboard-card-index'), 10);
        var rowIndex = parseInt(node.getAttribute('data-dashboard-row-index'), 10);
        var stackIndex = parseInt(node.getAttribute('data-dashboard-stack-index'), 10);
        var colLocalIndex = parseInt(node.getAttribute('data-dashboard-col-local-index'), 10);
        var brokenSrc = String(node.getAttribute('data-dashboard-broken-src') || '').trim() || null;
        if (boardId) {
          _callDep('navigateToSearchResult', {
            boardId: boardId,
            cardId: cardId,
            rowIndex: isNaN(rowIndex) ? null : rowIndex,
            stackIndex: isNaN(stackIndex) ? null : stackIndex,
            colLocalIndex: isNaN(colLocalIndex) ? null : colLocalIndex,
            cardIndex: isNaN(cardIndex) ? null : cardIndex,
            brokenSrc: brokenSrc
          });
        }
      }
    });
    targetEl.__dashboardTreeClickBound = true;
  }

  function renderDashboardTreeItems(targetEl, treeNodes, emptyText, options) {
    options = options || {};
    if (!targetEl) return;

    // ── change detection: skip rebuild if data hasn't changed ──
    var cacheKey = options._cacheKey || (targetEl.id || '') || null;
    if (cacheKey) {
      var fp = _dashboardFingerprint(treeNodes, emptyText + '|' + (options.collapseWhenEmpty ? '1' : '0'));
      if (_dashboardCacheHit(cacheKey, fp)) return;
    }

    targetEl.innerHTML = '';

    if (!treeNodes || treeNodes.length === 0) {
      setDashboardGroupEmptyState(targetEl, !!options.collapseWhenEmpty);
      var empty = document.createElement('div');
      empty.className = 'dashboard-empty';
      empty.textContent = emptyText;
      targetEl.appendChild(empty);
      return;
    }
    setDashboardGroupEmptyState(targetEl, false);
    var TreeView = _dep('TreeView');
    TreeView.render(targetEl, treeNodes, {
      escapeHtml: _dep('escapeHtml'),
      variant: 'compact'
    });
    bindDashboardTreeInteractions(targetEl);
  }

  function renderDashboardFileInventoryList(targetEl, items, emptyText) {
    if (!targetEl) return;
    var state = ensureDashboardState();
    var loading = !!(state && state.fileInventoryLoading);

    // ── change detection: skip rebuild if data hasn't changed ──
    var cacheKey = 'inv_' + (targetEl.id || emptyText);
    var fp = _dashboardFingerprint(items, loading ? 'loading' : 'ready');
    if (_dashboardCacheHit(cacheKey, fp)) return;

    setDashboardGroupEmptyState(targetEl, !loading && (!items || items.length === 0));
    if (loading && (!items || items.length === 0)) {
      targetEl.innerHTML = '<div class="dashboard-empty">Loading...</div>';
      return;
    }
    if (!items || items.length === 0) {
      targetEl.innerHTML = '<div class="dashboard-empty">' + escapeCalHtml(emptyText) + '</div>';
      return;
    }
    renderDashboardTreeItems(
      targetEl,
      _callDep('getDashboardTreeApi').buildDashboardInventoryTreeNodes(items),
      emptyText,
      { _cacheKey: null } // already cached at this level, skip inner cache
    );
  }

  function buildDashboardBrokenItems(runtimeItems, embedItems, includeItems) {
    var items = [];
    var byKey = {};
    function push(item) {
      if (!item) return;
      var key = String(item.type || '') + '|' + String(item.src || '').toLowerCase();
      if (!byKey[key]) {
        byKey[key] = {
          type: item.type || 'embed',
          src: item.src || '',
          count: 0
        };
        if (typeof item.colIndex === 'number') byKey[key].colIndex = item.colIndex;
        if (typeof item.cardIndex === 'number') byKey[key].cardIndex = item.cardIndex;
        if (item.cardId) byKey[key].cardId = item.cardId;
        if (item.reason) byKey[key].reason = item.reason;
        items.push(byKey[key]);
      }
      byKey[key].count += item.count || 1;
      if (!byKey[key].reason && item.reason) byKey[key].reason = item.reason;
      if ((byKey[key].colIndex == null || byKey[key].colIndex < 0) && typeof item.colIndex === 'number') {
        byKey[key].colIndex = item.colIndex;
      }
      if ((byKey[key].cardIndex == null || byKey[key].cardIndex < 0) && typeof item.cardIndex === 'number') {
        byKey[key].cardIndex = item.cardIndex;
      }
      if (!byKey[key].cardId && item.cardId) byKey[key].cardId = item.cardId;
    }
    var inventories = [].concat(embedItems || [], includeItems || []);
    for (var i = 0; i < inventories.length; i++) {
      if (inventories[i].status !== 'missing') continue;
      push({
        type: inventories[i].kind === 'include'
          ? 'include'
          : (inventories[i].mediaCategory || 'embed'),
        src: inventories[i].path,
        count: inventories[i].count || 1
      });
    }
    for (var j = 0; j < (runtimeItems || []).length; j++) push(runtimeItems[j]);
    return items;
  }

  function markFileInventoryDirty() {
    _fileInventoryDataStamp++;
  }

  function refreshDashboardFileInventory(forceRefresh) {
    var state = ensureDashboardState();
    var boardId = _dep('activeBoardId') || '';
    var boardData = _dep('fullBoardData');
    if (!boardId || !_dep('connected')) {
      _fileInventoryBoardId = null;
      _fileInventoryLastStamp = -1;
      state.fileInventoryLoading = false;
      state.fileEmbeds = [];
      state.includedFiles = [];
      state.brokenFiles = [];
      renderDashboardFileEmbedsList();
      renderDashboardIncludedFilesList();
      renderDashboardBrokenList();
      scheduleMirroredDashboardSync();
      return Promise.resolve();
    }

    // Skip if the board and data stamp haven't changed since last successful refresh
    if (!forceRefresh && boardId === _fileInventoryBoardId && _fileInventoryDataStamp === _fileInventoryLastStamp) {
      return Promise.resolve();
    }

    var refs = boardData
      ? collectDashboardFileReferences(boardData)
      : { fileEmbeds: [], includedFiles: [] };
    if (!refs.fileEmbeds.length || !refs.includedFiles.length) {
      var containerRefs = collectDashboardFileReferencesFromContainer(getDashboardBrokenScanContainer());
      if (!refs.fileEmbeds.length) refs.fileEmbeds = containerRefs.fileEmbeds;
      if (!refs.includedFiles.length) refs.includedFiles = containerRefs.includedFiles;
    }
    var seq = ++dashboardFileInventorySeq;
    state.fileInventoryLoading = true;
    renderDashboardFileEmbedsList();
    renderDashboardIncludedFilesList();

    // Collect all unique paths and batch-check them in a single API request
    var allItems = (refs.fileEmbeds || []).concat(refs.includedFiles || []);
    var uniquePaths = [];
    var pathSet = {};
    for (var pi = 0; pi < allItems.length; pi++) {
      if (allItems[pi].path && !pathSet[allItems[pi].path]) {
        pathSet[allItems[pi].path] = true;
        uniquePaths.push(allItems[pi].path);
      }
    }

    var batchApi = _dep('LexeraApi');
    var batchPromise = batchApi && typeof batchApi.fileInfoBatch === 'function'
      ? batchApi.fileInfoBatch(boardId, uniquePaths).catch(function () { return null; })
      : Promise.resolve(null);

    return batchPromise.then(function (batchResult) {
      if (seq !== dashboardFileInventorySeq) return;
      var infoMap = batchResult && batchResult.results ? batchResult.results : {};

      function resolveItem(item) {
        var info = infoMap[item.path] || null;
        var status = info && info.exists === false ? 'missing' : (info ? 'exists' : 'unknown');
        return Object.assign({}, item, {
          status: status,
          exists: status === 'exists',
          fileInfo: info
        });
      }

      state.fileEmbeds = (refs.fileEmbeds || []).map(resolveItem);
      state.includedFiles = (refs.includedFiles || []).map(resolveItem);
      state.brokenFiles = buildDashboardBrokenItems([], state.fileEmbeds, state.includedFiles);
      state.fileInventoryLoading = false;
      _fileInventoryBoardId = boardId;
      _fileInventoryLastStamp = _fileInventoryDataStamp;
      renderDashboardFileEmbedsList();
      renderDashboardIncludedFilesList();
      renderDashboardBrokenList();
      scheduleMirroredDashboardSync();
    }).catch(function (err) {
      if (seq !== dashboardFileInventorySeq) return;
      _callDep('logFrontendIssue', 'warn', 'dashboard.files', 'Failed to refresh dashboard file inventory', err);
      state.fileEmbeds = [];
      state.includedFiles = [];
      state.brokenFiles = [];
      state.fileInventoryLoading = false;
      renderDashboardFileEmbedsList();
      renderDashboardIncludedFilesList();
      renderDashboardBrokenList();
      scheduleMirroredDashboardSync();
    });
  }

  function scanBrokenElementsFromContainer(container) {
    if (!container || typeof container.querySelectorAll !== 'function') return [];
    var broken = [];
    var seen = {};
    var selector = [
      '.embed-broken',
      '.include-broken',
      '.image-path-overlay-container.image-broken[data-file-path]',
      '.video-path-overlay-container.image-broken[data-file-path]',
      '.wysiwyg-media.image-broken[data-file-path]',
      '.wysiwyg-media-block.image-broken[data-file-path]',
      '.link-path-overlay-container.link-broken[data-file-path]',
      '.external-embed-container[data-external-policy-action]:not([data-external-policy-action=""]):not([data-external-policy-action="open_page"])'
    ].join(', ');
    var brokenEls = container.querySelectorAll(selector);
    for (var i = 0; i < brokenEls.length; i++) {
      var el = brokenEls[i];
      var cardEl = typeof el.closest === 'function' ? el.closest('.card') : null;
      var colEl = typeof el.closest === 'function' ? el.closest('.column') : null;
      var colIndex = cardEl ? parseInt(cardEl.getAttribute('data-col-index'), 10) : -1;
      var cardIndex = cardEl ? parseInt(cardEl.getAttribute('data-card-index'), 10) : -1;
      var cardId = cardEl ? String(cardEl.getAttribute('data-card-id') || '') : '';
      var rowIndex = colEl ? parseInt(colEl.getAttribute('data-row-index'), 10) : -1;
      var stackIndex = colEl ? parseInt(colEl.getAttribute('data-stack-index'), 10) : -1;
      var colLocalIndex = colEl ? parseInt(colEl.getAttribute('data-col-local-index'), 10) : -1;
      var src =
        (typeof el.getAttribute === 'function' && (
          el.getAttribute('data-file-path') ||
          el.getAttribute('data-include-path') ||
          el.getAttribute('data-embed-url') ||
          el.getAttribute('src')
        )) || '';
      var img = typeof el.querySelector === 'function' ? el.querySelector('img[src]') : null;
      var video = typeof el.querySelector === 'function' ? el.querySelector('video') : null;
      var audio = typeof el.querySelector === 'function' ? el.querySelector('audio') : null;
      if (!src && img && typeof img.getAttribute === 'function') src = img.getAttribute('src') || '';
      if (!src && video && typeof video.getAttribute === 'function') src = video.getAttribute('src') || '';
      if (!src && audio && typeof audio.getAttribute === 'function') src = audio.getAttribute('src') || '';
      var type = 'embed';
      var hasBrokenIncludePlaceholder = !!(typeof el.querySelector === 'function' && el.querySelector('.broken-include-placeholder'));
      var externalPolicyAction = typeof el.getAttribute === 'function' ? String(el.getAttribute('data-external-policy-action') || '').trim() : '';
      var mediaType = typeof el.getAttribute === 'function' ? String(el.getAttribute('data-media-type') || '').trim().toLowerCase() : '';
      var reason = typeof el.getAttribute === 'function' ? String(el.getAttribute('data-external-policy-reason') || '').trim() : '';
      if ((el.classList && el.classList.contains('include-broken')) || hasBrokenIncludePlaceholder) type = 'include';
      else if (externalPolicyAction && externalPolicyAction !== 'open_page') type = 'external';
      else if (el.classList && el.classList.contains('link-broken')) type = 'link';
      else if (mediaType === 'audio' || audio) type = 'audio';
      else if (mediaType === 'video' || video) type = 'video';
      else if (mediaType === 'image' || (el.classList && el.classList.contains('image-broken'))) type = 'image';
      else if (img) type = 'image';
      else if (video) type = 'video';
      else if (audio) type = 'audio';
      var key = [type, src, colIndex, cardIndex].join('|');
      if (seen[key]) continue;
      seen[key] = true;
      var item = {
        type: type,
        src: src,
        colIndex: colIndex,
        cardIndex: cardIndex,
        cardId: cardId,
        rowIndex: rowIndex >= 0 ? rowIndex : null,
        stackIndex: stackIndex >= 0 ? stackIndex : null,
        colLocalIndex: colLocalIndex >= 0 ? colLocalIndex : null
      };
      if (reason) item.reason = reason;
      broken.push(item);
    }
    return broken;
  }

  // ── Dashboard broken elements scanner ─────────────────────────────
  function getDashboardBrokenScanContainer() {
    var shell = _dep('WorkspaceShell');
    if (_dep('workspaceShellEnabled') && shell && typeof shell.getActiveBoardColumnsContainer === 'function') {
      var shellContainer = shell.getActiveBoardColumnsContainer();
      if (shellContainer) return shellContainer;
    }
    return _callDep('getElColumnsContainer');
  }

  function scanBrokenElements() {
    return scanBrokenElementsFromContainer(getDashboardBrokenScanContainer());
  }

  function renderDashboardFileEmbedsList() {
    renderDashboardFileInventoryList(
      _callDep('getElDashboardEmbedsList'),
      dashboardState && dashboardState.fileEmbeds ? dashboardState.fileEmbeds : [],
      'No file embeds'
    );
    scheduleMirroredDashboardSync();
  }

  function renderDashboardIncludedFilesList() {
    renderDashboardFileInventoryList(
      _callDep('getElDashboardIncludedList'),
      dashboardState && dashboardState.includedFiles ? dashboardState.includedFiles : [],
      'No included files'
    );
    scheduleMirroredDashboardSync();
  }

  var _cachedBrokenDomItems = [];   // last DOM-scan results

  /**
   * Render the broken-elements list using cached DOM-scan results and
   * file-inventory data.  The expensive DOM scan is NOT run here — it is
   * triggered separately via scheduleDeferredBrokenScan().
   */
  function renderDashboardBrokenList() {
    var el = _callDep('getElDashboardBrokenList');
    if (!el) return;
    var items = buildDashboardBrokenItems(
      _cachedBrokenDomItems,
      dashboardState && dashboardState.fileEmbeds ? dashboardState.fileEmbeds : [],
      dashboardState && dashboardState.includedFiles ? dashboardState.includedFiles : []
    );

    // ── change detection: skip rebuild if data hasn't changed ──
    var fp = _dashboardFingerprint(items);
    if (_dashboardCacheHit('broken', fp)) return;

    setDashboardGroupEmptyState(el, items.length === 0);
    if (items.length === 0) {
      el.innerHTML = '<div class="dashboard-empty">No broken elements</div>';
      scheduleMirroredDashboardSync();
      return;
    }
    renderDashboardTreeItems(
      el,
      _callDep('getDashboardTreeApi').buildDashboardBrokenTreeNodes(items),
      'No broken elements',
      { _cacheKey: null } // already cached at this level
    );
    scheduleMirroredDashboardSync();
  }

  /**
   * Run the expensive broken-element DOM scan off the hot render path.
   * Uses requestIdleCallback (with setTimeout fallback) so the main
   * render cycle is never blocked by querySelectorAll over the board.
   */
  function scheduleDeferredBrokenScan() {
    if (_brokenScanPending) return;
    _brokenScanPending = true;
    _brokenScanBoardId = _dep('activeBoardId');
    var run = function () {
      _brokenScanPending = false;
      // Skip if board changed since scan was scheduled
      if (_brokenScanBoardId !== _dep('activeBoardId')) return;
      _cachedBrokenDomItems = scanBrokenElements();
      renderDashboardBrokenList();
    };
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(run, { timeout: 500 });
    } else {
      setTimeout(run, 80);
    }
  }

  function renderDashboardPinnedList() {
    if (!_callDep('getElDashboardPinnedList')) return;

    // ── change detection: skip rebuild if pinned data hasn't changed ──
    var pinnedData = dashboardState ? { q: dashboardState.pinnedQueries, a: dashboardState.activePinnedQuery } : null;
    var fp = _dashboardFingerprint(pinnedData);
    if (_dashboardCacheHit('pinned', fp)) return;

    _callDep('getElDashboardPinnedList').innerHTML = '';
    if (!dashboardState || !dashboardState.pinnedQueries || dashboardState.pinnedQueries.length === 0) {
      setDashboardGroupEmptyState(_callDep('getElDashboardPinnedList'), true);
      var empty = document.createElement('div');
      empty.className = 'dashboard-empty';
      empty.textContent = 'No pinned searches';
      _callDep('getElDashboardPinnedList').appendChild(empty);
      scheduleMirroredDashboardSync();
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
    scheduleMirroredDashboardSync();
  }

  function setDashboardGroupEmptyState(targetEl, isEmpty) {
    if (!targetEl || typeof targetEl.closest !== 'function') return;
    var group = targetEl.closest('.dashboard-group');
    if (!group) return;
    group.classList.toggle('is-empty', !!isEmpty);
  }

  function renderDashboardResultItems(targetEl, items, emptyText, options) {
    renderDashboardTreeItems(
      targetEl,
      _callDep('getDashboardTreeApi').buildDashboardResultTreeNodes(items),
      emptyText,
      options
    );
  }

  function renderDashboard() {
    if (!dashboardState) return;

    // Always render standalone calendar panels, even without dashboard DOM
    var allCalendar = getCalendarTasks();
    renderStandaloneCalendarPanels(allCalendar);

    if (!_callDep('getElDashboardRoot')) return;

    // Clear loading / connection state on the dashboard body
    var rt = typeof window !== 'undefined' && window.LexeraRuntime ? window.LexeraRuntime : null;
    var dashBody = _callDep('getElDashboardRoot') ? _callDep('getElDashboardRoot').querySelector('.sidebar-dashboard-body') : null;
    if (rt && dashBody) {
      rt.setViewLoading(dashBody, !!dashboardState.loading);
      rt.setViewConnected(dashBody, !!_dep('connected'));
    }

    var scopeHint = scopeHintForDashboard();
    var loadingNote = dashboardState.loading ? 'Loading...' : null;

    renderDashboardPinnedList();
    renderDashboardResultItems(
      _callDep('getElDashboardResultsList'),
      dashboardState.results,
      scopeHint || loadingNote || (dashboardState.query ? 'No matching tasks' : 'Type a query to search'),
      { collapseWhenEmpty: !dashboardState.loading && !dashboardState.query, _cacheKey: 'results' }
    );

    // Calendar views inside dashboard panel
    renderWeekCalendar(document.getElementById('dashboard-calendar-week'), allCalendar);
    renderMonthCalendar(document.getElementById('dashboard-calendar-month'), allCalendar);
    renderCalendarTaskList(document.getElementById('dashboard-calendar-tasks'), allCalendar);

    renderDashboardResultItems(
      _callDep('getElDashboardOverdueList'),
      dashboardState.overdue,
      scopeHint || loadingNote || 'No overdue tasks',
      { collapseWhenEmpty: !dashboardState.loading, _cacheKey: 'overdue' }
    );
    // "Upcoming" combines today + this week + upcoming + later (non-overdue)
    var allUpcoming = (dashboardState.today || []).concat(
      dashboardState.thisWeek || [], dashboardState.upcoming || [], dashboardState.later || []);
    var upcomingEl = _callDep('getElDashboardUpcomingList');
    renderDashboardResultItems(upcomingEl, allUpcoming,
      scopeHint || loadingNote || 'No upcoming tasks',
      { collapseWhenEmpty: !dashboardState.loading, _cacheKey: 'upcoming' });
    var todosEl = _callDep('getElDashboardTodosList');
    renderDashboardResultItems(todosEl, dashboardState.todos,
      scopeHint || loadingNote || 'No open tasks',
      { collapseWhenEmpty: !dashboardState.loading, _cacheKey: 'todos' });
    // Tagged items — render each tag group
    var taggedEl = _callDep('getElDashboardTaggedList');
    if (taggedEl) {
      var groups = dashboardState.taggedGroups || [];
      renderDashboardTreeItems(
        taggedEl,
        _callDep('getDashboardTreeApi').buildDashboardTaggedTreeNodes(groups),
        scopeHint || loadingNote || 'No tagged items',
        { collapseWhenEmpty: !dashboardState.loading, _cacheKey: 'tagged' }
      );
    }
    renderDashboardFileEmbedsList();
    renderDashboardIncludedFilesList();
    renderDashboardBrokenList();
    // File inventory only re-fetches when data actually changed (dirty flag)
    refreshDashboardFileInventory();
    // Broken-element DOM scan runs off the hot path via requestIdleCallback
    scheduleDeferredBrokenScan();
    scheduleMirroredDashboardSync();
  }

  function ensureDashboardState() {
    if (!dashboardState) dashboardState = _dep('dashboardState');
    if (!dashboardState) {
      // Default scope: 'all' in workspace shell (multiple boards visible),
      // 'active' in single-board mode
      var defaultScope = _dep('workspaceShellEnabled') ? 'all' : 'active';
      var storedScope = null;
      try { storedScope = _Settings ? _Settings.get('dashboardScope') : localStorage.getItem('lexera-dashboard-scope'); } catch (_) {}
      dashboardState = {
      query: '', scope: normalizeDashboardScope(storedScope || defaultScope), loading: false,
      results: [], overdue: [], today: [], thisWeek: [],
      upcoming: [], later: [], todos: [], taggedGroups: [],
      pinnedQueries: [], activePinnedQuery: '',
      fileInventoryLoading: false, fileEmbeds: [], includedFiles: [], brokenFiles: []
    };
    }
    return dashboardState;
  }

  function clearDashboardResults() {
    dashboardState.results = [];
    dashboardState.overdue = [];
    dashboardState.today = [];
    dashboardState.thisWeek = [];
    dashboardState.upcoming = [];
    dashboardState.later = [];
    dashboardState.todos = [];
    dashboardState.taggedGroups = [];
    invalidateDashboardRenderCache();
  }

  function refreshDashboardData(options) {
    options = options || {};
    if (_dep('embeddedMode')) return Promise.resolve();
    var hasDashboard = !!_callDep('getElDashboardRoot');
    var hasCalendars = hasAnyCalendarPanel();
    if (!hasDashboard && !hasCalendars) return Promise.resolve();
    ensureDashboardState();
    if (!_dep('connected')) {
      dashboardState.loading = false;
      clearDashboardResults();
      dashboardState.fileInventoryLoading = false;
      dashboardState.fileEmbeds = [];
      dashboardState.includedFiles = [];
      dashboardState.brokenFiles = [];
      renderDashboard();
      return Promise.resolve();
    }
    var refreshId = ++dashboardRefreshSeq;

    // Show cached data immediately if available (avoids blank dashboard)
    var hadCache = _restoreDashboardDataFromCache();
    dashboardState.loading = true;
    if (hadCache) {
      // Render stale data right away so the user sees content instantly
      renderDashboard();
    } else if (!options.deferRender) {
      renderDashboard();
    }

    // Start file inventory in parallel with main data fetch
    refreshDashboardFileInventory();

    // Fire getDashboardData directly — no blocking checkStatus() call.
    // Backend readiness is detected by catch on the actual data request.
    return _refreshDashboardDataCore(refreshId, options);
  }

  function _refreshDashboardDataCore(refreshId, options) {
    var LexeraApi = _dep('LexeraApi');
    var query = dashboardState.query ? dashboardState.query.trim() : '';
    var calendarScopedQuery = isDashboardCalendarQuery(query);
    var dashTags = getDashboardTags();
    var queryResult = { results: [] };
    var calendarResponse = { results: [] };
    var todosResult = { results: [] };
    var tagResults = [];

    // Pagination options for dashboard requests
    var dashSearchOpts = { limit: 30, truncate: 200 };
    var dashCalendarOpts = { limit: 20 };

    return LexeraApi.getDashboardData({
      q: query,
      tags: dashTags,
      searchLimit: dashSearchOpts.limit,
      searchTruncate: dashSearchOpts.truncate,
      calendarLimit: dashCalendarOpts.limit
    }).then(function (data) {
      if (refreshId !== dashboardRefreshSeq) return;
      queryResult = (data && data.query) || { results: [] };
      calendarResponse = (data && data.calendar) || { results: [] };
      todosResult = (data && data.todos) || { results: [] };
      tagResults = data && Array.isArray(data.tags) ? data.tags : [];
    }).then(function () {
      if (refreshId !== dashboardRefreshSeq) return;

      var scopedCalendar = filterDashboardResultsByScope(asCalendarTaskArray(calendarResponse));
      var scopedQuery = calendarScopedQuery
        ? filterCalendarTasksForDashboardQuery(scopedCalendar, query)
        : filterDashboardResultsByScope(asSearchResultArray(queryResult));

      dashboardState.results = limitedSearchResults(scopedQuery, 80);

      // Store total counts from paginated responses
      dashboardState.resultTotal = queryResult.total || (queryResult.results || []).length;

      // Use backend-provided time groups when available, fall back to client-side grouping
      var groups = calendarResponse.groups;
      if (groups) {
        var extractGroup = function (g) { return Array.isArray(g) ? g : (g && g.items) || []; };
        var extractTotal = function (g) { return (g && g.total != null) ? g.total : (Array.isArray(g) ? g.length : ((g && g.items) || []).length); };
        dashboardState.overdue = limitedSearchResults(filterDashboardResultsByScope(extractGroup(groups.overdue)), 40);
        dashboardState.overdueTotal = extractTotal(groups.overdue);
        dashboardState.today = limitedSearchResults(filterDashboardResultsByScope(extractGroup(groups.today)), 40);
        dashboardState.todayTotal = extractTotal(groups.today);
        dashboardState.thisWeek = limitedSearchResults(filterDashboardResultsByScope(extractGroup(groups.thisWeek)), 40);
        dashboardState.thisWeekTotal = extractTotal(groups.thisWeek);
        dashboardState.upcoming = limitedSearchResults(filterDashboardResultsByScope(extractGroup(groups.upcoming)), 40);
        dashboardState.upcomingTotal = extractTotal(groups.upcoming);
        dashboardState.later = limitedSearchResults(filterDashboardResultsByScope(extractGroup(groups.later)), 40);
        dashboardState.laterTotal = extractTotal(groups.later);
      } else {
        // Fallback: client-side grouping (for older backends)
        var openCalendar = scopedCalendar.filter(function (item) { return item && item.checked !== true; });
        var overdueCalendar = openCalendar.filter(function (item) { return item && item.isOverdue; });
        dashboardState.overdue = limitedSearchResults(sortSearchByDueDateAsc(overdueCalendar), 40);
        var now = new Date();
        var todayStr = formatDashboardDate(now);
        var endOfWeekStr = formatDashboardDate(getEndOfWeek(now));
        var twoWeeksStr = formatDashboardDate(new Date(now.getTime() + 14 * 86400000));
        var nonOverdue = openCalendar.filter(function (item) { return item && !item.isOverdue; });
        var sorted = sortSearchByDueDateAsc(nonOverdue);
        var today = [], thisWeek = [], upcoming = [], later = [];
        for (var di = 0; di < sorted.length; di++) {
          var due = sorted[di].dueDate || '';
          if (due === todayStr) today.push(sorted[di]);
          else if (due <= endOfWeekStr) thisWeek.push(sorted[di]);
          else if (due <= twoWeeksStr) upcoming.push(sorted[di]);
          else later.push(sorted[di]);
        }
        dashboardState.today = limitedSearchResults(today, 40);
        dashboardState.thisWeek = limitedSearchResults(thisWeek, 40);
        dashboardState.upcoming = limitedSearchResults(upcoming, 40);
        dashboardState.later = limitedSearchResults(later, 40);
      }
      // Open tasks (todos)
      var scopedTodos = filterDashboardResultsByScope(asSearchResultArray(todosResult));
      dashboardState.todos = limitedSearchResults(scopedTodos, 60);
      // Tagged items
      var taggedGroups = [];
      for (var tgi = 0; tgi < tagResults.length; tgi++) {
        var tagResult = tagResults[tgi];
        if (tagResult && tagResult.tag) {
          var scopedTagResults = filterDashboardResultsByScope(asSearchResultArray(tagResult));
          taggedGroups.push({ tag: tagResult.tag, items: limitedSearchResults(scopedTagResults, 30) });
        }
      }
      dashboardState.taggedGroups = taggedGroups;
      dashboardState._retryCount = 0;
      // Cache processed data for instant display on tab switches
      _saveDashboardDataToCache();
    }).catch(function (err) {
      if (refreshId !== dashboardRefreshSeq) return;
      // Detect backend-not-ready (network error, timeout, 503) vs real failures
      var isBackendDown = err && (
        err.name === 'AbortError' ||
        err.message === 'Failed to fetch' ||
        (err.status && err.status >= 500)
      );
      if (isBackendDown) {
        _callDep('logFrontendIssue', 'warn', 'dashboard.search', 'Backend not ready', err);
        var rtErr = typeof window !== 'undefined' && window.LexeraRuntime ? window.LexeraRuntime : null;
        var dashBodyErr = _callDep('getElDashboardRoot') ? _callDep('getElDashboardRoot').querySelector('.sidebar-dashboard-body') : null;
        if (rtErr && dashBodyErr) rtErr.setViewError(dashBodyErr, true, 'Backend not ready');
      } else {
        _callDep('logFrontendIssue', 'error', 'dashboard.search', 'Failed to refresh', err);
      }
      clearDashboardResults();
      // Retry with exponential backoff if backend was busy
      var retryDelay = Math.min(30000, 8000 * Math.pow(1.5, (dashboardState._retryCount || 0)));
      dashboardState._retryCount = (dashboardState._retryCount || 0) + 1;
      scheduleDashboardRefresh(retryDelay);
    }).then(function () {
      if (refreshId !== dashboardRefreshSeq) return;
      if (dashboardState) dashboardState.loading = false;
      var rtOk = typeof window !== 'undefined' && window.LexeraRuntime ? window.LexeraRuntime : null;
      var dashBodyOk = _callDep('getElDashboardRoot') ? _callDep('getElDashboardRoot').querySelector('.sidebar-dashboard-body') : null;
      if (rtOk && dashBodyOk) rtOk.setViewError(dashBodyOk, false);
      markFileInventoryDirty();
      renderDashboard();
    });
  }

  function hasAnyCalendarPanel() {
    if (!window.LexeraSharedPanels) return false;
    return window.LexeraSharedPanels.getRoots('weekCalendar').length > 0 ||
      window.LexeraSharedPanels.getRoots('monthCalendar').length > 0;
  }

  function scheduleDashboardRefresh(delayMs) {
    if (_dep('embeddedMode')) return;
    if (!_callDep('getElDashboardRoot') && !hasAnyCalendarPanel()) return;
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

    // Dashboard group fold/unfold via header click
    _callDep('getElDashboardRoot').addEventListener('click', function (e) {
      var header = e.target.closest('.dashboard-group-header');
      if (!header) return;
      // Don't fold when clicking interactive elements
      if (e.target.closest('button, a, input, select')) return;
      var group = header.closest('.dashboard-group');
      if (!group) return;
      group.classList.toggle('collapsed');
      // Persist fold state
      saveDashboardFoldState();
    });
    restoreDashboardFoldState();

    persistDashboardPrefs();
    renderDashboard();
    scheduleDashboardRefresh(0);
    applySidebarSectionLayout();
  }

  function saveDashboardFoldState() {
    var root = _callDep('getElDashboardRoot');
    if (!root) return;
    var groups = root.querySelectorAll('.dashboard-group');
    var collapsed = [];
    for (var i = 0; i < groups.length; i++) {
      if (groups[i].classList.contains('collapsed')) {
        var header = groups[i].querySelector('.dashboard-group-header');
        if (header) collapsed.push(header.textContent.trim());
      }
    }
    try { if (_Settings) { _Settings.set('dashboardCollapsed', collapsed); } else { localStorage.setItem('lexera-dashboard-collapsed', JSON.stringify(collapsed)); } } catch (_) { /* intentional: localStorage unavailable in private browsing */ }
  }

  function restoreDashboardFoldState() {
    var root = _callDep('getElDashboardRoot');
    if (!root) return;
    var stored;
    try { stored = _Settings ? _Settings.get('dashboardCollapsed') : JSON.parse(localStorage.getItem('lexera-dashboard-collapsed')); } catch (_) { return; }
    if (!Array.isArray(stored) || stored.length === 0) return;
    var groups = root.querySelectorAll('.dashboard-group');
    for (var i = 0; i < groups.length; i++) {
      var header = groups[i].querySelector('.dashboard-group-header');
      if (header && stored.indexOf(header.textContent.trim()) !== -1) {
        groups[i].classList.add('collapsed');
      }
    }
  }

  // ─── Module init & API ────────────────────────────────────────────────

  function init(deps) {
    if (!deps) return;
    if (typeof window !== 'undefined' && window.LexeraRuntime) {
      window.LexeraRuntime.mergeDeps(_deps, deps);
    } else {
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
    navigateHierarchyTargetInIframe: navigateHierarchyTargetInIframe,
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
    collectDashboardFileReferences: collectDashboardFileReferences,
    collectDashboardFileReferencesFromContainer: collectDashboardFileReferencesFromContainer,
    collectDashboardFileEmbeds: collectDashboardFileEmbeds,
    collectDashboardIncludedFiles: collectDashboardIncludedFiles,
    scanBrokenElements: scanBrokenElements,
    scanBrokenElementsFromContainer: scanBrokenElementsFromContainer,
    renderDashboardPinnedList: renderDashboardPinnedList,
    setDashboardGroupEmptyState: setDashboardGroupEmptyState,
    renderDashboardResultItems: renderDashboardResultItems,
    renderDashboard: renderDashboard,
    refreshDashboardData: refreshDashboardData,
    scheduleDashboardRefresh: scheduleDashboardRefresh,
    setupDashboardControls: setupDashboardControls,
    getCalendarTasks: getCalendarTasks,
    renderStandaloneCalendarPanels: renderStandaloneCalendarPanels,
    refreshDashboardTagsFromBackend: refreshDashboardTagsFromBackend,
    invalidateDashboardRenderCache: invalidateDashboardRenderCache,
    markFileInventoryDirty: markFileInventoryDirty
  };
})();
(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : typeof self !== 'undefined' ? self : {}).LexeraOrderHelpers = LexeraOrderHelpers;
