(function () {
  if (typeof LexeraPluginRegistry === 'undefined' || typeof LexeraFileFormatHelpers === 'undefined') return;
  var H = LexeraFileFormatHelpers;

  LexeraPluginRegistry.register({
    kind: 'fileFormat',
    metadata: { id: 'plaintext', name: 'Text file', version: '1.0.0' },
    label: 'Text file',
    emoji: '&#128196;',
    assetType: 'document',
    editorKind: 'plaintext',
    previewPlaceholder: 'Text file preview is rendered into an SVG page for board view and export compatibility.',
    preview: H.buildPreviewConfig('text', 'text-cache', 'svg', 'svg', H.pageSuffix('-p')),
    export: H.buildExportConfig('svg', 'svg', H.pageSuffix('-p')),
    matches: function (normalized) {
      return /\.(txt|text|log|cfg|ini|conf)$/.test(normalized);
    },
    canRenderFile: function (path) {
      return this.matches(String(path || '').toLowerCase());
    },
    renderFile: H.makeRenderFile('plaintext')
  });
})();
