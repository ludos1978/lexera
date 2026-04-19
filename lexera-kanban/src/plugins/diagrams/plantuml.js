(function () {
  if (typeof window === 'undefined' || !window.LexeraDiagramRegistry) return;

  function getDeps() {
    return window.LexeraDiagramDeps || {};
  }

  window.LexeraDiagramRegistry.register({
    id: 'plantuml',
    metadata: { id: 'plantuml', name: 'PlantUML Diagram', version: '1.0.0', requires: ['plantuml-backend'] },
    languages: ['plantuml', 'puml'],
    _ready: true,
    isReady: function () { return true; },
    init: function () { return Promise.resolve(); },
    render: function (id, code, boardId) {
      var deps = getDeps();
      if (deps.requestRenderedPlantUmlSvg) return deps.requestRenderedPlantUmlSvg(boardId, code);
      return Promise.reject(new Error('requestRenderedPlantUmlSvg not available'));
    },
    placeholder: function (id, code) {
      var deps = getDeps();
      var escaped = deps.escapeHtml ? deps.escapeHtml(code) : String(code || '');
      return '<div class="plantuml-placeholder" id="' + id + '"><div class="plantuml-title">PlantUML</div><pre class="code-block"><code class="language-plantuml">' + escaped + '</code></pre></div>';
    },
    menuItems: function () {
      return [
        { id: 'copy-svg', label: 'Copy SVG' },
        { id: 'copy-code', label: 'Copy PlantUML Code' }
      ];
    },
    handleMenuAction: function (action, container) {
      var deps = getDeps();
      if (deps.handleDiagramAction) deps.handleDiagramAction(action, container);
    }
  });
})();
