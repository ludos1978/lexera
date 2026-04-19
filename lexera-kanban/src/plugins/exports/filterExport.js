(function () {
  if (typeof LexeraPluginRegistry === 'undefined') return;

  var FORMATS = [
    { id: 'keep', label: 'Keep (filtered markdown)', extension: 'md', mimeType: 'text/markdown' },
    { id: 'kanban', label: 'Kanban (raw markdown)', extension: 'md', mimeType: 'text/markdown' }
  ];

  LexeraPluginRegistry.register({
    kind: 'export',
    metadata: {
      id: 'filter',
      name: 'Filter / Raw Markdown Export',
      version: '1.0.0',
      priority: -10
    },
    baseFormat: null,
    getSupportedFormats: function () { return FORMATS.slice(); },
    canExport: function (formatId) {
      for (var i = 0; i < FORMATS.length; i++) {
        if (FORMATS[i].id === formatId) return true;
      }
      return false;
    },
    isAvailable: function () { return Promise.resolve(true); },
    export: function (data, opts) {
      if (typeof window === 'undefined' || !window.ExportService) {
        return Promise.reject(new Error('ExportService not available'));
      }
      return window.ExportService.export(Object.assign({}, data || {}, opts || {}));
    }
  });
})();
