// Leading line comment to dodge slice-13 checkJs duplicate-id quirk.

/**
 * @typedef {Object} LexeraAppUtilsDeps
 * @property {(s: string | null | undefined) => string} [escapeAttr]
 * @property {(...args: unknown[]) => unknown} [handleDiagramAction]
 * @property {(...args: unknown[]) => unknown} [requestRenderedPlantUmlSvg]
 * @property {(s: string | null | undefined) => string} [escapeHtml]
 */

/**
 * @typedef {Object} LexeraAppUtilsApi
 * @property {(deps: LexeraAppUtilsDeps) => void} init
 * @property {(lines: Array<unknown>, startIdx: number, boardId: string, renderState: unknown) => string} renderTable
 * @property {() => void} flushPendingDiagramQueues
 * @property {(str: string | null | undefined) => string} escapeRegex
 * @property {(html: string | null | undefined, abbrDefs: { [k: string]: string } | null | undefined) => string} applyAbbreviationsToHtml
 */

var LexeraAppUtils = (function () {
  'use strict';
  /** @type {LexeraAppUtilsDeps} */
  var _deps = {};
  var _rt = typeof window !== 'undefined' && window.LexeraRuntime ? window.LexeraRuntime : null;
  var _Settings = typeof LexeraSettings !== 'undefined' ? LexeraSettings : null;

  function init(deps) {
    if (typeof window !== 'undefined' && window.LexeraRuntime) {
      _rt = window.LexeraRuntime;
      _rt.mergeDeps(_deps, deps);
    } else {
      _deps = deps || {};
    }
    // Publish deps for diagram plugins that self-registered at script-load time.
    // They read handleDiagramAction, requestRenderedPlantUmlSvg, escapeHtml from
    // `window.LexeraDiagramDeps` lazily (at render / menu-action time, after deps
    // are populated here).
    if (typeof window !== 'undefined') {
      window.LexeraDiagramDeps = _deps;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // renderTable / flushPendingDiagramQueues
  // ═══════════════════════════════════════════════════════════════════════════

  function renderTable(lines, startIdx, boardId, renderState) {
    var CCR = /** @type {any} */ (typeof window !== 'undefined' ? window.LexeraCardContentRenderer : null);
    if (CCR) return CCR.renderTable(lines, startIdx, boardId, renderState);
    return '';
  }

  function flushPendingDiagramQueues() {
    var DR = typeof window !== 'undefined' ? window.LexeraDiagramRegistry : null;
    if (DR) DR.flush();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // escapeRegex / applyAbbreviationsToHtml
  // ═══════════════════════════════════════════════════════════════════════════

  function escapeRegex(str) {
    return String(str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function applyAbbreviationsToHtml(html, abbrDefs) {
    var keys = Object.keys(abbrDefs || {});
    if (!html || keys.length === 0) return html;
    keys.sort(function (a, b) { return b.length - a.length; });
    var parts = String(html).split(/(<[^>]+>)/g);
    for (var i = 0; i < parts.length; i++) {
      if (!parts[i] || parts[i].charAt(0) === '<') continue;
      for (var j = 0; j < keys.length; j++) {
        var key = keys[j];
        var pattern = new RegExp('(^|[^\\w])(' + escapeRegex(key) + ')(?=[^\\w]|$)', 'g');
        parts[i] = parts[i].replace(pattern, function (_, pre, match) {
          var escAttr = _deps.escapeAttr ? _deps.escapeAttr : function (s) { return String(s || ''); };
          return pre + '<abbr title="' + escAttr(abbrDefs[key]) + '">' + match + '</abbr>';
        });
      }
    }
    return parts.join('');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Public API
  // ═══════════════════════════════════════════════════════════════════════════

  /** @type {LexeraAppUtilsApi} */
  var api = {
    init: init,
    renderTable: renderTable,
    flushPendingDiagramQueues: flushPendingDiagramQueues,
    escapeRegex: escapeRegex,
    applyAbbreviationsToHtml: applyAbbreviationsToHtml
  };
  return api;
})();
if (typeof window !== 'undefined') window.LexeraAppUtils = LexeraAppUtils;
