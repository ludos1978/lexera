(function () {
  if (typeof LexeraPluginRegistry === 'undefined' || typeof LexeraFileFormatHelpers === 'undefined') return;
  var H = LexeraFileFormatHelpers;

  LexeraPluginRegistry.register({
    kind: 'fileFormat',
    metadata: { id: 'epub', name: 'EPUB file', version: '1.0.0' },
    label: 'EPUB file',
    emoji: '&#128218;',
    assetType: 'document',
    rendererRequirements: [{ id: 'mutool' }],
    previewPlaceholder: 'EPUB preview is rendered through MuPDF into page images.',
    preview: H.buildPreviewConfig('epub', 'epub-cache', 'png', 'png', H.pageSuffix('-p')),
    export: H.buildExportConfig('png', 'png', H.pageSuffix('-p')),
    matches: function (normalized) {
      return normalized.slice(-5) === '.epub';
    },
    canRenderFile: function (path) {
      return this.matches(String(path || '').toLowerCase());
    },
    renderFile: H.makeRenderFile('epub')
  });
})();
