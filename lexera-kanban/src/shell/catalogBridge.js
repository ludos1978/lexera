// Catalog + active-board bridge — shell-side broadcaster for the
// `catalog-snapshot` and `active-board-changed` multiview events.
//
// The main shell (LexeraWorkspaceShell) holds the active catalog
// (boards + remote boards + workspaces) and the active board id.
// Per-view sub-apps that show board lists / picker UIs / per-board
// state subscribe via these events.
//
// Workstream 5 extraction: split out from `multiviewClient.js` so the
// transport file stays focused on raw IPC plumbing. Both bridges live
// here because they share the `wrapShellMethods` integration point
// (single monkey-patch over `LexeraWorkspaceShell`).
//
// Public API (window.LexeraCatalogBridge):
//   - broadcastCatalog(snapshot) → Promise
//   - broadcastActiveBoard(boardId) → Promise
//   - getLastCatalog() → snapshot|null
//   - getLastActiveBoardId() → string|null
//   - wrapShellMethods() — monkey-patch LexeraWorkspaceShell once on init
//   - activate() — flip the gates so subsequent shell calls actually
//     broadcast (off-by-default keeps non-multiview sessions overhead-free)
//   - deactivate()
//   - initListeners() — install the `catalog-request` event listener so
//     freshly-mounted sub-apps can re-fetch the last snapshot

(function () {
  'use strict';

  function tauri() {
    if (typeof window === 'undefined' || !window.__TAURI__) return null;
    return window.__TAURI__;
  }

  function invoke(cmd, args) {
    var t = tauri();
    if (!t || !t.core || typeof t.core.invoke !== 'function') {
      return Promise.reject(new Error('Tauri invoke unavailable'));
    }
    return t.core.invoke(cmd, args || {});
  }

  // ── Catalog snapshot bridge ──────────────────────────────────────

  var lastCatalogSnapshot = null;

  function broadcastCatalog(snapshot) {
    if (!snapshot) return Promise.resolve();
    lastCatalogSnapshot = snapshot;
    return invoke('multiview_broadcast', {
      event: 'catalog-snapshot',
      payload: snapshot
    }).catch(function () { /* ignore */ });
  }

  // ── Active-board bridge ──────────────────────────────────────────

  var lastActiveBoardId = null;

  function broadcastActiveBoard(boardId) {
    if (boardId === lastActiveBoardId) return Promise.resolve();
    lastActiveBoardId = boardId;
    return invoke('multiview_broadcast', {
      event: 'active-board-changed',
      payload: { boardId: boardId || null }
    }).catch(function () {});
  }

  // ── Activation gates ─────────────────────────────────────────────
  //
  // Off by default so non-multiview sessions and tests pay zero IPC
  // overhead. `activate()` flips them after the first sub-app is opened.

  var catalogBridgeActive = false;
  var activeBoardBridgeActive = false;

  function activateCatalog() { catalogBridgeActive = true; }
  function deactivateCatalog() { catalogBridgeActive = false; }
  function activateActiveBoard() { activeBoardBridgeActive = true; }
  function deactivateActiveBoard() { activeBoardBridgeActive = false; }

  function activate() {
    catalogBridgeActive = true;
    activeBoardBridgeActive = true;
  }
  function deactivate() {
    catalogBridgeActive = false;
    activeBoardBridgeActive = false;
  }

  // ── Shell method wrapping ────────────────────────────────────────
  //
  // The shell calls `onCatalogUpdated` when the workspace catalog
  // changes, and `openBoard` when a board is activated. We wrap both
  // to broadcast on the multiview bus when the corresponding gate is
  // open.

  function wrapShellMethods() {
    if (typeof window === 'undefined' || !window.LexeraWorkspaceShell) return;
    var shell = window.LexeraWorkspaceShell;

    if (!window.__lexeraMultiviewCatalogWrapped && typeof shell.onCatalogUpdated === 'function') {
      var origOnCatalog = shell.onCatalogUpdated;
      shell.onCatalogUpdated = function (snapshot) {
        if (catalogBridgeActive) {
          try { broadcastCatalog(snapshot); } catch (_) {}
        }
        return origOnCatalog.apply(this, arguments);
      };
      window.__lexeraMultiviewCatalogWrapped = true;
    }

    if (!window.__lexeraMultiviewOpenBoardWrapped && typeof shell.openBoard === 'function') {
      var origOpenBoard = shell.openBoard;
      shell.openBoard = function (boardId) {
        var result = origOpenBoard.apply(this, arguments);
        if (activeBoardBridgeActive) {
          try { broadcastActiveBoard(boardId); } catch (_) {}
        }
        return result;
      };
      window.__lexeraMultiviewOpenBoardWrapped = true;
    }
  }

  // ── Listeners ────────────────────────────────────────────────────
  //
  // Sub-apps that just mounted may issue a `catalog-request` event so
  // they get the current snapshot without waiting for the next change.

  function initListeners() {
    var t = tauri();
    if (!t || !t.event || typeof t.event.listen !== 'function') return;
    t.event.listen('catalog-request', function () {
      if (lastCatalogSnapshot) broadcastCatalog(lastCatalogSnapshot);
    });
  }

  if (typeof window !== 'undefined') {
    window.LexeraCatalogBridge = {
      // Catalog
      broadcastCatalog: broadcastCatalog,
      getLastCatalog: function () { return lastCatalogSnapshot; },
      activateCatalog: activateCatalog,
      deactivateCatalog: deactivateCatalog,
      // Active board
      broadcastActiveBoard: broadcastActiveBoard,
      getLastActiveBoardId: function () { return lastActiveBoardId; },
      activateActiveBoard: activateActiveBoard,
      deactivateActiveBoard: deactivateActiveBoard,
      // Combined
      activate: activate,
      deactivate: deactivate,
      wrapShellMethods: wrapShellMethods,
      initListeners: initListeners
    };
  }
})();
