var LexeraFileFormatHelpers = (function () {
  function normalizePageNumber(pageNumber) {
    var parsed = parseInt(pageNumber, 10);
    return parsed > 0 ? parsed : 1;
  }

  function pageSuffix(prefix) {
    return function (pageNumber) { return prefix + normalizePageNumber(pageNumber); };
  }

  function buildPreviewConfig(kind, cacheFolderName, outputExtension, outputFormat, suffixBuilder) {
    return {
      kind: kind,
      cacheFolderName: cacheFolderName,
      outputExtension: outputExtension,
      outputFormat: outputFormat,
      supportsRuntimeRender: true,
      buildSuffix: suffixBuilder || function () { return ''; }
    };
  }

  function buildExportConfig(outputExtension, outputFormat, suffixBuilder) {
    return {
      outputExtension: outputExtension,
      outputFormat: outputFormat,
      supportsRuntimeRender: true,
      buildSuffix: suffixBuilder || function () { return ''; }
    };
  }

  // Default renderFile closure used by file-format plugins whose backend is
  // the `render_embedded_file` Tauri command. Plugins that need a different
  // invoke path can override by providing their own renderFile on the manifest.
  //
  // opts shape:
  //   { sourcePath, targetPath, pageNumber?, outputFormat? }
  function makeRenderFile(pluginId) {
    return function renderFile(opts) {
      opts = opts || {};
      if (!opts.sourcePath || !opts.targetPath) {
        return Promise.reject(new Error(pluginId + '.renderFile: sourcePath and targetPath required'));
      }
      var invoke = null;
      if (typeof window !== 'undefined' && window.LexeraExportTauriInvoke && typeof window.LexeraExportTauriInvoke.invoke === 'function') {
        invoke = window.LexeraExportTauriInvoke.invoke;
      } else if (typeof LexeraExportTauriInvoke !== 'undefined' && typeof LexeraExportTauriInvoke.invoke === 'function') {
        invoke = LexeraExportTauriInvoke.invoke;
      }
      if (!invoke) return Promise.reject(new Error('LexeraExportTauriInvoke unavailable'));
      return invoke('render_embedded_file', {
        opts: {
          pluginId: pluginId,
          sourcePath: opts.sourcePath,
          targetPath: opts.targetPath,
          pageNumber: normalizePageNumber(opts.pageNumber),
          outputFormat: opts.outputFormat || 'png'
        }
      });
    };
  }

  return {
    normalizePageNumber: normalizePageNumber,
    pageSuffix: pageSuffix,
    buildPreviewConfig: buildPreviewConfig,
    buildExportConfig: buildExportConfig,
    makeRenderFile: makeRenderFile
  };
})();
