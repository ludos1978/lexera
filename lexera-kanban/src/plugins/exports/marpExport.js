(function () {
  if (typeof LexeraPluginRegistry === 'undefined') return;

  var FORMATS = [
    { id: 'presentation-pdf', label: 'PDF (Marp)', extension: 'pdf', mimeType: 'application/pdf', marpFormat: 'pdf' },
    { id: 'presentation-pptx', label: 'PPTX (Marp)', extension: 'pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', marpFormat: 'pptx' },
    { id: 'presentation-html', label: 'HTML (Marp)', extension: 'html', mimeType: 'text/html', marpFormat: 'html' },
    { id: 'presentation-markdown', label: 'Markdown (Marp)', extension: 'md', mimeType: 'text/markdown', marpFormat: 'markdown' }
  ];

  var enginePathCache;

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
      id: 'marp',
      name: 'Marp Presentation Export',
      version: '1.0.0',
      requires: ['marp']
    },
    baseFormat: 'presentation',
    getSupportedFormats: function () { return FORMATS.slice(); },
    canExport: function (formatId) {
      for (var i = 0; i < FORMATS.length; i++) {
        if (FORMATS[i].id === formatId) return true;
      }
      return formatId === 'presentation';
    },
    checkStatus: function () {
      return invokeOrReject('check_marp_available').then(function (/** @type {any} */ r) {
        return { available: !!(r && r.available), version: (r && r.version) || null };
      });
    },
    getThemes: function (dirs) {
      return invokeOrReject('discover_marp_themes', { dirs: dirs || [] });
    },
    getClasses: function (dirs) {
      return invokeOrReject('discover_marp_classes', { dirs: dirs || [] });
    },
    stopAllWatches: function () {
      return invokeOrReject('marp_stop_all_watches');
    },
    getEnginePath: function () {
      if (enginePathCache !== undefined) return Promise.resolve(enginePathCache);
      return invokeOrReject('get_marp_engine_path').then(function (result) {
        enginePathCache = result || null;
        return enginePathCache;
      }).catch(function () {
        enginePathCache = null;
        return null;
      });
    },
    resetEnginePathCache: function () { enginePathCache = undefined; },
    isAvailable: function () {
      return this.checkStatus().then(function (s) { return s.available; }).catch(function () { return false; });
    },
    export: function (data, opts) {
      if (typeof window === 'undefined' || !window.ExportService) {
        return Promise.reject(new Error('ExportService not available'));
      }
      var options = Object.assign({ format: 'presentation' }, data || {}, opts || {});
      return window.ExportService.export(options);
    }
  });
})();
