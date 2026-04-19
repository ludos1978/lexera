(function () {
  if (typeof LexeraPluginRegistry === 'undefined' || typeof LexeraFileFormatHelpers === 'undefined') return;
  var H = LexeraFileFormatHelpers;

  LexeraPluginRegistry.register({
    kind: 'fileFormat',
    metadata: { id: 'tsv', name: 'TSV table', version: '1.0.0' },
    label: 'TSV table',
    emoji: '&#128451;',
    assetType: 'document',
    editorKind: 'plaintext',
    rendererRequirements: [{
      id: 'csv-builtin',
      label: 'Built-in CSV Renderer',
      available: true,
      version: null,
      path: null,
      details: 'No external CLI is required for CSV/TSV table rendering.'
    }],
    previewPlaceholder: 'TSV preview is rendered into an SVG table for board view and export compatibility.',
    preview: H.buildPreviewConfig('table', 'tsv-cache', 'svg', 'svg', H.pageSuffix('-p')),
    export: H.buildExportConfig('svg', 'svg', H.pageSuffix('-p')),
    matches: function (normalized) {
      return /\.(tsv|tab)$/.test(normalized);
    },
    canRenderFile: function (path) {
      return this.matches(String(path || '').toLowerCase());
    },
    renderFile: H.makeRenderFile('tsv')
  });
})();
