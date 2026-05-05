/**
 * LexeraDevtoolsTitle.deriveSuffix(urlParams, windowLabel) → string
 *
 * Pure helper for app.js's document.title decoration. Picks the most
 * human-readable identifier from the URL params so the WebKit DevTools
 * window chrome — which is driven by the page <title> — names each
 * inspector window after the thing the user actually cares about.
 *
 *   embedded board webview        → "Board <short-board-id>"
 *   workspace-locked main shell   → "ws:<short-workspace-id>"
 *   any other non-main label      → the windowLabel verbatim
 *   the boot main shell           → '' (no decoration; default title)
 *
 * Lives in its own module so the logic is unit-testable without
 * standing up a Tauri + DOM environment.
 */
(function () {
  'use strict';

  function shortHash(value) {
    var s = String(value || '');
    if (s.length <= 12) return s;
    return s.slice(0, 8) + '…' + s.slice(-3);
  }

  function readParam(urlParams, key) {
    if (!urlParams) return '';
    if (typeof urlParams.get === 'function') return String(urlParams.get(key) || '');
    if (typeof urlParams === 'object' && urlParams[key] != null) return String(urlParams[key]);
    return '';
  }

  function deriveSuffix(urlParams, windowLabel) {
    var label = String(windowLabel || '');
    if (readParam(urlParams, 'embedded') === '1') {
      var boardId = readParam(urlParams, 'board');
      if (boardId) return 'Board ' + shortHash(boardId);
      return label;
    }
    var ws = readParam(urlParams, 'workspace');
    if (ws) return 'ws:' + shortHash(ws);
    if (label && label !== 'main') return label;
    return '';
  }

  var api = {
    shortHash: shortHash,
    deriveSuffix: deriveSuffix
  };

  if (typeof window !== 'undefined') window.LexeraDevtoolsTitle = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
