(function () {
  if (typeof LexeraPluginRegistry === 'undefined' || typeof LexeraFileFormatHelpers === 'undefined') return;
  var H = LexeraFileFormatHelpers;

  LexeraPluginRegistry.register({
    kind: 'fileFormat',
    metadata: { id: 'excalidraw', name: 'Excalidraw file', version: '1.0.0' },
    label: 'Excalidraw file',
    emoji: '&#127912;',
    assetType: 'diagram',
    editorKind: 'excalidraw',
    rendererRequirements: [{ id: 'node' }, { id: 'excalidraw-assets' }],
    previewPlaceholder: 'Excalidraw preview is rendered through the integrated export worker when available.',
    preview: H.buildPreviewConfig('diagram', 'excalidraw-cache', 'svg', 'svg'),
    export: H.buildExportConfig('svg', 'svg'),
    matches: function (normalized) {
      return normalized.endsWith('.excalidraw.json') ||
        normalized.endsWith('.excalidraw') ||
        normalized.endsWith('.excalidraw.svg');
    },
    canRenderFile: function (path) {
      return this.matches(String(path || '').toLowerCase());
    },
    renderFile: H.makeRenderFile('excalidraw'),
    emit: H.makeSpecialPreviewEmit(),
    enhance: H.makeSpecialPreviewEnhance('diagram')
  });
})();
