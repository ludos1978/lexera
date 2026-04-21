(function () {
  if (typeof LexeraPluginRegistry === 'undefined' || typeof LexeraFileFormatHelpers === 'undefined') return;
  var H = LexeraFileFormatHelpers;

  LexeraPluginRegistry.register({
    kind: 'fileFormat',
    metadata: { id: 'xlsx', name: 'Spreadsheet file', version: '1.0.0' },
    label: 'Spreadsheet file',
    emoji: '&#128200;',
    assetType: 'document',
    rendererRequirements: [{ id: 'soffice' }],
    previewPlaceholder: 'Spreadsheet preview is rendered through LibreOffice into a sheet image.',
    preview: H.buildPreviewConfig('spreadsheet', 'xlsx-cache', 'png', 'png', H.pageSuffix('-s')),
    export: H.buildExportConfig('png', 'png', H.pageSuffix('-s')),
    matches: function (normalized) {
      return /\.(xlsx|xls|ods)$/.test(normalized);
    },
    canRenderFile: function (path) {
      return this.matches(String(path || '').toLowerCase());
    },
    renderFile: H.makeRenderFile('xlsx'),
    emit: H.makeSpecialPreviewEmit(),
    enhance: H.makeSpecialPreviewEnhance('spreadsheet')
  });
})();
