/**
 * Undo/Redo System for Lexera Kanban
 *
 * Manages undo/redo stacks with delta-based snapshots.
 * Depends on LexeraBoardDelta for delta computation/application.
 *
 * Exposed as window.LexeraUndoRedo
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  root.LexeraUndoRedo = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var MAX_UNDO = 30;
  var MAX_UNDO_BYTES = 10 * 1024 * 1024;

  var undoStack = [];
  var redoStack = [];
  var undoTotalBytes = 0;
  var undoPendingSnapshot = null;

  // Dependencies injected via init()
  var _deps = null;

  /**
   * Initialize the undo/redo system with required dependencies.
   *
   * @param {Object} deps
   * @param {function(): Object|null} deps.getFullBoardData - returns current fullBoardData
   * @param {function(): string|null} deps.getActiveBoardId - returns current activeBoardId
   * @param {function(Object, Object): Object} deps.computeBoardDelta - computes delta between two boards
   * @param {function(Object): Object} deps.cloneBoardData - deep-clones board data
   * @param {function(Object): number} deps.estimateDeltaSize - estimates byte size of a delta
   * @param {function(Object, Object, boolean): Object} deps.applyBoardDelta - applies delta to board
   * @param {function(Object): Object|null} deps.getBoardSaveBase - gets save base from board
   * @param {function(Object, Object): void} deps.setBoardSaveBase - sets save base on board
   * @param {function(Object): Promise} deps.persistBoardMutation - persists board changes
   */
  function init(deps) {
    _deps = deps;
  }

  function _ensureDeps() {
    if (!_deps) throw new Error('[undoRedoSystem] Not initialized — call init(deps) first');
  }

  /**
   * Finalize any pending undo snapshot by computing the delta
   * between the snapshot (pre-mutation state) and current fullBoardData (post-mutation state).
   */
  function finalizePendingUndo() {
    if (!undoPendingSnapshot) return;
    _ensureDeps();
    var fullBoardData = _deps.getFullBoardData();
    if (!fullBoardData) return;
    var delta = _deps.computeBoardDelta(undoPendingSnapshot, fullBoardData);
    var deltaSize = _deps.estimateDeltaSize(delta);
    undoStack.push({ delta: delta, size: deltaSize });
    undoTotalBytes += deltaSize;
    while (undoStack.length > MAX_UNDO) {
      undoTotalBytes -= undoStack.shift().size;
    }
    while (undoTotalBytes > MAX_UNDO_BYTES && undoStack.length > 0) {
      undoTotalBytes -= undoStack.shift().size;
    }
    undoPendingSnapshot = null;
  }

  /**
   * Capture a snapshot of the current board state for undo.
   * Call this BEFORE making a mutation.
   */
  function pushUndo() {
    _ensureDeps();
    var fullBoardData = _deps.getFullBoardData();
    if (!fullBoardData) return;
    finalizePendingUndo();
    undoPendingSnapshot = _deps.cloneBoardData(fullBoardData);
    redoStack = [];
  }

  /**
   * Undo the last board mutation.
   */
  async function undo() {
    _ensureDeps();
    finalizePendingUndo();
    var fullBoardData = _deps.getFullBoardData();
    var activeBoardId = _deps.getActiveBoardId();
    if (undoStack.length === 0 || !fullBoardData || !activeBoardId) return;
    var saveBase = _deps.getBoardSaveBase(fullBoardData);
    var entry = undoStack.pop();
    undoTotalBytes -= entry.size;
    redoStack.push(entry);
    _deps.applyBoardDelta(fullBoardData, entry.delta, true);
    _deps.setBoardSaveBase(fullBoardData, saveBase || fullBoardData);
    await _deps.persistBoardMutation({ targets: [{ type: 'board' }] });
  }

  /**
   * Redo the last undone board mutation.
   */
  async function redo() {
    _ensureDeps();
    var fullBoardData = _deps.getFullBoardData();
    var activeBoardId = _deps.getActiveBoardId();
    if (redoStack.length === 0 || !fullBoardData || !activeBoardId) return;
    var saveBase = _deps.getBoardSaveBase(fullBoardData);
    var entry = redoStack.pop();
    undoStack.push(entry);
    undoTotalBytes += entry.size;
    _deps.applyBoardDelta(fullBoardData, entry.delta, false);
    _deps.setBoardSaveBase(fullBoardData, saveBase || fullBoardData);
    await _deps.persistBoardMutation({ targets: [{ type: 'board' }] });
  }

  /**
   * Get current undo depth (including any pending snapshot).
   */
  function getUndoDepth() {
    return undoStack.length + (undoPendingSnapshot ? 1 : 0);
  }

  /**
   * Get current redo depth.
   */
  function getRedoDepth() {
    return redoStack.length;
  }

  /**
   * Pop the last entry from the undo stack (used when a mutation is cancelled).
   * Returns the removed entry, or undefined if stack is empty.
   */
  function popUndo() {
    if (undoStack.length === 0) return undefined;
    var entry = undoStack.pop();
    undoTotalBytes -= entry.size;
    return entry;
  }

  /**
   * Clear all undo/redo state (e.g. when switching boards).
   */
  function clear() {
    undoStack = [];
    redoStack = [];
    undoTotalBytes = 0;
    undoPendingSnapshot = null;
  }

  return {
    init: init,
    pushUndo: pushUndo,
    undo: undo,
    redo: redo,
    finalizePendingUndo: finalizePendingUndo,
    getUndoDepth: getUndoDepth,
    getRedoDepth: getRedoDepth,
    popUndo: popUndo,
    clear: clear
  };
}));
