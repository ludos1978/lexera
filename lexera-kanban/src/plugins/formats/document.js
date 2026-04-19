(function () {
  if (typeof LexeraPluginRegistry === 'undefined' || typeof LexeraFileFormatHelpers === 'undefined') return;
  var H = LexeraFileFormatHelpers;

  LexeraPluginRegistry.register({
    kind: 'fileFormat',
    metadata: { id: 'document', name: 'Document file', version: '1.0.0' },
    label: 'Document file',
    emoji: '&#128196;',
    assetType: 'document',
    rendererRequirements: [{ id: 'soffice' }, { id: 'pdftoppm' }],
    previewPlaceholder: 'Document preview is rendered through LibreOffice and Poppler into page images.',
    preview: H.buildPreviewConfig('document', 'document-cache', 'png', 'png', H.pageSuffix('-p')),
    export: H.buildExportConfig('png', 'png', H.pageSuffix('-p')),
    matches: function (normalized) {
      return /\.(doc|docx|odt|rtf)$/.test(normalized);
    },
    canRenderFile: function (path) {
      return this.matches(String(path || '').toLowerCase());
    },
    renderFile: H.makeRenderFile('document')
  });
})();
