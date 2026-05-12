// Leading line comment to dodge slice-13 checkJs duplicate-id quirk.

/**
 * @typedef {Object} LexeraFoldStateStorage
 * @property {(key: string) => (string | null)} getItem
 * @property {(key: string, value: string) => void} setItem
 */

/**
 * @typedef {Object} LexeraFoldStateSaveOptions
 * @property {LexeraFoldStateStorage} [storage]
 * @property {Element | null} [container]
 */

/**
 * @typedef {Object} LexeraFoldStateToggleOptions
 * @property {string} [boardId]
 * @property {boolean | (() => boolean)} [isCanvasBoardLayout]
 * @property {(el: Element, expand: boolean) => void} [setColumnChildrenFoldState]
 * @property {(boardId?: string) => void} [saveCardCollapseState]
 * @property {(boardId?: string) => void} [saveFoldState]
 * @property {() => void} [refreshBoardHeaderActionStates]
 * @property {LexeraFoldStateStorage} [storage]
 * @property {Element | null} [container]
 */

/**
 * @typedef {Object} LexeraFoldStateApi
 * @property {(values: unknown) => Array<string>} normalizeFoldStorageList
 * @property {(row: { id?: unknown } | null | undefined, rowIdx: number) => string} getRowFoldKey
 * @property {(stack: { id?: unknown } | null | undefined, rowIdx: number, stackIdx: number) => string} getStackFoldKey
 * @property {(col: { id?: unknown; index?: number } | null | undefined, rowIdx: number, stackIdx: number, colLocalIdx: number, colFullIdx?: number) => string} getColumnFoldKey
 * @property {(savedValues: Array<string> | null | undefined, foldKey: string, legacyValue?: string | null) => boolean} hasSavedFoldMatch
 * @property {(boardId: string, storage: LexeraFoldStateStorage | null | undefined) => Array<string>} getFoldedColumns
 * @property {(boardId: string, kind: string, storage: LexeraFoldStateStorage | null | undefined) => Array<string>} getFoldedItems
 * @property {(boardId: string, options: LexeraFoldStateSaveOptions) => void} saveFoldState
 * @property {(columnEl: Element | null, childrenOnly: boolean, options: LexeraFoldStateToggleOptions) => boolean} toggleColumnFoldElement
 */

(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  /** @type {any} */ (root).LexeraFoldState = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /** @param {unknown} value */
  function safeIndex(value) {
    return typeof value === 'number' && isFinite(value) ? value : -1;
  }

  function entityId(obj) {
    return obj && obj.id != null ? String(obj.id || '').trim() : '';
  }

  /** @param {unknown} values */
  function normalizeFoldStorageList(values) {
    var list = /** @type {Array<unknown>} */ (Array.isArray(values) ? values : []);
    /** @type {Array<string>} */
    var out = [];
    /** @type {{ [k: string]: boolean }} */
    var seen = {};
    for (var i = 0; i < list.length; i++) {
      if (list[i] == null) continue;
      var value = String(list[i] || '').trim();
      if (!value || seen[value]) continue;
      seen[value] = true;
      out.push(value);
    }
    return out;
  }

  function getRowFoldKey(row, rowIdx) {
    var id = entityId(row);
    if (id) return 'row:id:' + id;
    return 'row:path:' + safeIndex(rowIdx);
  }

  function getStackFoldKey(stack, rowIdx, stackIdx) {
    var id = entityId(stack);
    if (id) return 'stack:id:' + id;
    return 'stack:path:' + safeIndex(rowIdx) + ':' + safeIndex(stackIdx);
  }

  function getColumnFoldKey(col, rowIdx, stackIdx, colLocalIdx, colFullIdx) {
    var id = entityId(col);
    if (id) return 'column:id:' + id;
    if (col && typeof col.index === 'number' && isFinite(col.index)) {
      return 'column:index:' + col.index;
    }
    var sr = safeIndex(rowIdx);
    var ss = safeIndex(stackIdx);
    if (typeof colFullIdx === 'number' && isFinite(colFullIdx)) {
      return 'column:path:' + sr + ':' + ss + ':' + colFullIdx;
    }
    return 'column:display:' + sr + ':' + ss + ':' + safeIndex(colLocalIdx);
  }

  function hasSavedFoldMatch(savedValues, foldKey, legacyValue) {
    var saved = Array.isArray(savedValues) ? savedValues : [];
    var normalizedKey = String(foldKey || '').trim();
    var normalizedLegacy = String(legacyValue || '').trim();
    for (var i = 0; i < saved.length; i++) {
      var current = String(saved[i] || '').trim();
      if (!current) continue;
      if (normalizedKey && current === normalizedKey) return true;
      if (normalizedLegacy && current === normalizedLegacy) return true;
    }
    return false;
  }

  function resolveStorage(storage) {
    return storage && typeof storage.getItem === 'function' && typeof storage.setItem === 'function'
      ? storage
      : null;
  }

  function getFoldedColumns(boardId, storage) {
    return getFoldedItems(boardId, 'col', storage);
  }

  function getFoldedItems(boardId, kind, storage) {
    var resolvedStorage = resolveStorage(storage);
    if (!resolvedStorage) return [];
    var saved = resolvedStorage.getItem('lexera-' + kind + '-fold:' + boardId);
    if (!saved) return [];
    try { return normalizeFoldStorageList(JSON.parse(saved)); } catch (e) { return []; }
  }

  /**
   * @param {Element | null} container
   * @param {string} selector
   */
  function collectFoldedKeys(container, selector) {
    if (!container || typeof container.querySelectorAll !== 'function') return [];
    /** @type {Array<string>} */
    var folded = [];
    var items = container.querySelectorAll(selector);
    for (var i = 0; i < items.length; i++) {
      if (!items[i] || !items[i].classList || !items[i].classList.contains('folded')) continue;
      var foldKey = items[i].getAttribute ? items[i].getAttribute('data-fold-key') : null;
      if (foldKey != null) folded.push(foldKey);
    }
    return normalizeFoldStorageList(folded);
  }

  function saveFoldState(boardId, options) {
    options = options || {};
    var resolvedStorage = resolveStorage(options.storage);
    if (!resolvedStorage) return;
    var container = options.container || null;
    resolvedStorage.setItem('lexera-col-fold:' + boardId, JSON.stringify(collectFoldedKeys(container, '.column[data-fold-key]')));
    resolvedStorage.setItem('lexera-row-fold:' + boardId, JSON.stringify(collectFoldedKeys(container, '.board-row[data-fold-key]')));
    resolvedStorage.setItem('lexera-stack-fold:' + boardId, JSON.stringify(collectFoldedKeys(container, '.board-stack[data-fold-key]')));
  }

  function resolveCanvasLayoutFlag(value) {
    return typeof value === 'function' ? !!value() : !!value;
  }

  function toggleColumnFoldElement(columnEl, childrenOnly, options) {
    options = options || {};
    if (resolveCanvasLayoutFlag(options.isCanvasBoardLayout)) return false;
    if (!columnEl) return false;
    if (childrenOnly) {
      var anyCardExpanded = !!(columnEl.querySelector && columnEl.querySelector('.card:not(.collapsed)'));
      if (typeof options.setColumnChildrenFoldState === 'function') {
        options.setColumnChildrenFoldState(columnEl, anyCardExpanded);
      }
      if (typeof options.saveCardCollapseState === 'function') {
        options.saveCardCollapseState(options.boardId);
      }
    } else {
      var nowFolded = !(columnEl.classList && columnEl.classList.contains('folded'));
      if (columnEl.classList && typeof columnEl.classList.toggle === 'function') {
        columnEl.classList.toggle('folded', nowFolded);
      }
      if (typeof options.saveFoldState === 'function') {
        options.saveFoldState(options.boardId);
      } else {
        saveFoldState(options.boardId, options);
      }
    }
    if (typeof options.refreshBoardHeaderActionStates === 'function') {
      options.refreshBoardHeaderActionStates();
    }
    return true;
  }

  /** @type {LexeraFoldStateApi} */
  var publicApi = {
    normalizeFoldStorageList: normalizeFoldStorageList,
    getRowFoldKey: getRowFoldKey,
    getStackFoldKey: getStackFoldKey,
    getColumnFoldKey: getColumnFoldKey,
    hasSavedFoldMatch: hasSavedFoldMatch,
    getFoldedColumns: getFoldedColumns,
    getFoldedItems: getFoldedItems,
    saveFoldState: saveFoldState,
    toggleColumnFoldElement: toggleColumnFoldElement
  };
  return publicApi;
}));
