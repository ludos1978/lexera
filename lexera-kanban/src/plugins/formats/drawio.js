(function () {
  if (typeof LexeraPluginRegistry === 'undefined' || typeof LexeraFileFormatHelpers === 'undefined') return;
  var H = LexeraFileFormatHelpers;

  LexeraPluginRegistry.register({
    kind: 'fileFormat',
    metadata: { id: 'drawio', name: 'Draw.io file', version: '1.0.0' },
    label: 'Draw.io file',
    emoji: '&#128202;',
    assetType: 'diagram',
    editorKind: 'drawio',
    rendererRequirements: [{ id: 'drawio' }],
    previewPlaceholder: 'Draw.io preview is rendered through the draw.io CLI when available.',
    preview: H.buildPreviewConfig('diagram', 'drawio-cache', 'png', 'png'),
    export: H.buildExportConfig('svg', 'svg'),
    matches: function (normalized) {
      return normalized.slice(-7) === '.drawio' || normalized.slice(-4) === '.dio';
    },
    canRenderFile: function (path) {
      return this.matches(String(path || '').toLowerCase());
    },
    renderFile: H.makeRenderFile('drawio')
  });
})();
