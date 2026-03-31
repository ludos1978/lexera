var LexeraAppUtils = (function () {
  'use strict';
  var _deps = {};
  var _rt = typeof window !== 'undefined' && window.LexeraRuntime ? window.LexeraRuntime : null;

  function init(deps) {
    if (typeof window !== 'undefined' && window.LexeraRuntime) {
      _rt = window.LexeraRuntime;
      _rt.mergeDeps(_deps, deps);
    } else {
      _deps = deps || {};
    }
    _registerDiagrams();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // renderTable / flushPendingDiagramQueues
  // ═══════════════════════════════════════════════════════════════════════════

  function renderTable(lines, startIdx, boardId, renderState) {
    var CCR = typeof window !== 'undefined' ? window.LexeraCardContentRenderer : null;
    if (CCR) return CCR.renderTable(lines, startIdx, boardId, renderState);
    return '';
  }

  function flushPendingDiagramQueues() {
    var DR = typeof window !== 'undefined' ? window.LexeraDiagramRegistry : null;
    if (DR) DR.flush();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Diagram registrations (mermaid + plantuml)
  // ═══════════════════════════════════════════════════════════════════════════

  function _registerDiagrams() {
    var DR = typeof window !== 'undefined' ? window.LexeraDiagramRegistry : null;
    if (!DR) return;

    DR.register({
      id: 'mermaid',
      languages: ['mermaid'],
      _ready: false,
      _loading: false,
      isReady: function () { return this._ready; },
      init: function () {
        var self = this;
        if (self._ready) return Promise.resolve();
        if (self._loading) return new Promise(function (resolve) {
          var check = setInterval(function () { if (self._ready) { clearInterval(check); resolve(); } }, 50);
        });
        self._loading = true;
        return new Promise(function (resolve, reject) {
          var script = document.createElement('script');
          var mermaidUrl = 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js';
          try { var custom = localStorage.getItem('lexera-mermaid-url'); if (custom) mermaidUrl = custom; } catch (_) { /* intentional: localStorage unavailable */ }
          script.src = mermaidUrl;
          script.onload = function () {
            mermaid.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'loose', fontFamily: 'inherit' });
            self._ready = true;
            self._loading = false;
            resolve();
          };
          script.onerror = function () {
            self._loading = false;
            reject(new Error('Failed to load Mermaid library'));
          };
          document.head.appendChild(script);
        });
      },
      render: function (id, code) {
        return mermaid.render(id + '-svg', code).then(function (result) { return result.svg; });
      },
      placeholder: function (id) {
        return '<div class="mermaid-placeholder" id="' + id + '">Loading diagram...</div>';
      },
      menuItems: function () {
        return [
          { id: 'copy-svg', label: 'Copy SVG' },
          { id: 'copy-code', label: 'Copy Mermaid Code' },
        ];
      },
      handleMenuAction: function (action, container) {
        if (_deps.handleDiagramAction) _deps.handleDiagramAction(action, container);
      }
    });

    DR.register({
      id: 'plantuml',
      languages: ['plantuml', 'puml'],
      _ready: true,
      isReady: function () { return true; },
      init: function () { return Promise.resolve(); },
      render: function (id, code, boardId) {
        if (_deps.requestRenderedPlantUmlSvg) return _deps.requestRenderedPlantUmlSvg(boardId, code);
        return Promise.reject(new Error('requestRenderedPlantUmlSvg not available'));
      },
      placeholder: function (id, code) {
        var escaped = _deps.escapeHtml ? _deps.escapeHtml(code) : String(code || '');
        return '<div class="plantuml-placeholder" id="' + id + '"><div class="plantuml-title">PlantUML</div><pre class="code-block"><code class="language-plantuml">' + escaped + '</code></pre></div>';
      },
      menuItems: function () {
        return [
          { id: 'copy-svg', label: 'Copy SVG' },
          { id: 'copy-code', label: 'Copy PlantUML Code' },
        ];
      },
      handleMenuAction: function (action, container) {
        if (_deps.handleDiagramAction) _deps.handleDiagramAction(action, container);
      }
    });
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

  return {
    init: init,
    renderTable: renderTable,
    flushPendingDiagramQueues: flushPendingDiagramQueues,
    escapeRegex: escapeRegex,
    applyAbbreviationsToHtml: applyAbbreviationsToHtml
  };
})();
if (typeof window !== 'undefined') window.LexeraAppUtils = LexeraAppUtils;
