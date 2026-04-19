(function () {
  if (typeof LexeraPluginRegistry === 'undefined' || typeof LexeraFileFormatHelpers === 'undefined') return;
  var H = LexeraFileFormatHelpers;

  LexeraPluginRegistry.register({
    kind: 'fileFormat',
    metadata: { id: 'pptx', name: 'Presentation file', version: '1.0.0' },
    label: 'Presentation file',
    emoji: '&#128202;',
    assetType: 'document',
    rendererRequirements: [{ id: 'soffice' }, { id: 'pdftoppm' }],
    previewPlaceholder: 'Presentation preview is rendered in the browser or through LibreOffice into page images.',
    preview: H.buildPreviewConfig('document', 'document-cache', 'png', 'png', H.pageSuffix('-p')),
    export: H.buildExportConfig('png', 'png', H.pageSuffix('-p')),
    matches: function (normalized) {
      return /\.(ppt|pptx|odp)$/.test(normalized);
    },
    canRenderFile: function (path) {
      return this.matches(String(path || '').toLowerCase());
    },
    renderFile: H.makeRenderFile('pptx')
  });
})();
