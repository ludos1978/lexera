(function () {
  if (typeof LexeraPluginRegistry === 'undefined') return;

  var FORMATS = [
    { id: 'document-docx', label: 'DOCX (Pandoc)', extension: 'docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', pandocFormat: 'docx' },
    { id: 'document-odt', label: 'ODT (Pandoc)', extension: 'odt', mimeType: 'application/vnd.oasis.opendocument.text', pandocFormat: 'odt' },
    { id: 'document-epub', label: 'EPUB (Pandoc)', extension: 'epub', mimeType: 'application/epub+zip', pandocFormat: 'epub' },
    { id: 'document-rtf', label: 'RTF (Pandoc)', extension: 'rtf', mimeType: 'application/rtf', pandocFormat: 'rtf' }
  ];

  function getInvoker() {
    if (typeof window !== 'undefined' && window.LexeraExportTauriInvoke && typeof window.LexeraExportTauriInvoke.invoke === 'function') {
      return window.LexeraExportTauriInvoke.invoke;
    }
    if (typeof LexeraExportTauriInvoke !== 'undefined' && typeof LexeraExportTauriInvoke.invoke === 'function') {
      return LexeraExportTauriInvoke.invoke;
    }
    return null;
  }

  function invokeOrReject(command, args) {
    var invoke = getInvoker();
    if (!invoke) return Promise.reject(new Error('LexeraExportTauriInvoke unavailable'));
    return invoke(command, args);
  }

  LexeraPluginRegistry.register({
    kind: 'export',
    metadata: {
      id: 'pandoc',
      name: 'Pandoc Document Export',
      version: '1.0.0',
      requires: ['pandoc']
    },
    baseFormat: 'document',
    getSupportedFormats: function () { return FORMATS.slice(); },
    canExport: function (formatId) {
      for (var i = 0; i < FORMATS.length; i++) {
        if (FORMATS[i].id === formatId) return true;
      }
      return formatId === 'document';
    },
    checkStatus: function () {
      return invokeOrReject('check_pandoc_available').then(function (/** @type {any} */ r) {
        return { available: !!(r && r.available), version: (r && r.version) || null };
      });
    },
    isAvailable: function () {
      return this.checkStatus().then(function (s) { return s.available; }).catch(function () { return false; });
    },
    export: function (data, opts) {
      if (typeof window === 'undefined' || !window.ExportService) {
        return Promise.reject(new Error('ExportService not available'));
      }
      var options = Object.assign({ format: 'document' }, data || {}, opts || {});
      return window.ExportService.export(options);
    }
  });
})();
