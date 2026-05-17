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

  // `appliesToFormat` (optional) is a predicate `(targetFormat) => bool`.
  // When present and it returns false for the export's resolved target
  // sub-format ('html' | 'pdf' | 'pptx' | 'markdown' | …), the registry's
  // getExportRenderConfig() returns null so renderFileEmbedsForExport skips
  // conversion for that target — used by video/audio, which stay playable
  // <video>/<audio> in Marp HTML but must become a still image for
  // PDF/PPTX. Absent predicate ⇒ always applies (pdf/drawio/xlsx/… behaviour
  // unchanged).
  function buildExportConfig(outputExtension, outputFormat, suffixBuilder, appliesToFormat) {
    var config = {
      outputExtension: outputExtension,
      outputFormat: outputFormat,
      supportsRuntimeRender: true,
      buildSuffix: suffixBuilder || function () { return ''; }
    };
    if (typeof appliesToFormat === 'function') {
      config.appliesToFormat = appliesToFormat;
    }
    return config;
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

  // Shared emit function for all "rendered-special" preview plugins.
  // Called by `inlineRenderer` during markdown → HTML generation (sync)
  // to produce the inner HTML that lives inside `.embed-container` before
  // the enhance phase replaces it with a live preview. Delegates to
  // `LexeraEmbedMenu.getFileEmbedChipHtml` which already consults the
  // registry for label/emoji metadata.
  //
  // ctx shape (provided by the inlineRenderer dispatcher):
  //   { filePath, mediaStyleAttr, previewKind }
  function makeSpecialPreviewEmit() {
    return function emit(ctx) {
      ctx = ctx || {};
      var win = typeof window !== 'undefined' ? window : null;
      var embedMenu = win && win.LexeraEmbedMenu ? win.LexeraEmbedMenu : null;
      if (!embedMenu || typeof embedMenu.getFileEmbedChipHtml !== 'function') return '';
      return embedMenu.getFileEmbedChipHtml(ctx.previewKind || '', ctx.filePath || '', ctx.mediaStyleAttr || '');
    };
  }

  // Emit factory for plain-media plugins (image / video / audio). Each
  // plugin declares its element template via `elementTemplate`; the ctx
  // brings the resolved `src`, `mediaStyleAttr`, and `alt`/`title`.
  //
  // elementKind: 'image' | 'video' | 'audio'
  function makePlainMediaEmit(elementKind) {
    return function emit(ctx) {
      ctx = ctx || {};
      var escapeAttr = (ctx.helpers && ctx.helpers.escapeAttr) ? ctx.helpers.escapeAttr : defaultEscapeAttr;
      var src = ctx.src || '';
      var mediaStyleAttr = ctx.mediaStyleAttr || '';
      if (elementKind === 'image') {
        var alt = ctx.alt || '';
        var titleAttr = ctx.titleText ? ' title="' + escapeAttr(ctx.titleText) + '"' : '';
        return '<img data-lazy-src="' + src + '" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" alt="' + alt + '"' + titleAttr + mediaStyleAttr + ' onerror="if(this.getAttribute(\'data-lazy-src\')){return}this.parentElement.classList.add(\'embed-broken\')">';
      }
      if (elementKind === 'video') {
        return '<video controls preload="metadata" data-lazy-src="' + src + '"' + mediaStyleAttr + ' onerror="this.parentElement.classList.add(\'embed-broken\')"></video>';
      }
      if (elementKind === 'audio') {
        return '<audio controls preload="metadata" data-lazy-src="' + src + '"' + mediaStyleAttr + ' onerror="this.parentElement.classList.add(\'embed-broken\')"></audio>';
      }
      return '';
    };
  }

  function defaultEscapeAttr(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Shared enhance function for all "rendered-special" preview plugins:
  // creates the <div class="embed-preview"> child inside the provided
  // container, then delegates to LexeraEmbedMenu.renderCachedSpecialPreview
  // which owns URL resolution, cache checking, worker invocation, and
  // onerror logging. Plugins that need custom behaviour (PDF iframe,
  // markdown fetch+render) skip this factory and implement their own
  // `enhance`.
  //
  // `container` is the `.embed-container` element. `opts` is the shape
  // passed by LexeraFileFormatRegistry.enhance:
  //   { boardId, filePath, forceRerender, variant }
  function makeSpecialPreviewEnhance(previewKind) {
    return function enhance(container, opts) {
      opts = opts || {};
      var win = typeof window !== 'undefined' ? window : null;
      var embedMenu = win && win.LexeraEmbedMenu ? win.LexeraEmbedMenu : null;
      var doc = typeof document !== 'undefined' ? document : (win && win.document);
      if (!embedMenu || !doc || typeof embedMenu.renderCachedSpecialPreview !== 'function') {
        if (win && typeof win.logFrontendIssue === 'function') {
          win.logFrontendIssue(
            'warn',
            'embed.enhance.dispatch',
            'Plugin ' + previewKind + '.enhance: LexeraEmbedMenu.renderCachedSpecialPreview unavailable',
            { filePath: opts.filePath }
          );
        }
        return Promise.resolve(false);
      }
      var isModal = opts.variant === 'modal';
      var previewEl = doc.createElement('div');
      previewEl.className = 'embed-preview embed-preview-' + previewKind +
        (isModal ? ' embed-preview-modal file-preview-frame' : '');
      container.appendChild(previewEl);
      var previewPage = (typeof container.getAttribute === 'function')
        ? (container.getAttribute('data-preview-page') || '') : '';
      return embedMenu.renderCachedSpecialPreview(previewEl, opts.boardId, opts.filePath, previewKind, {
        pageNumber: previewPage,
        forceRerender: !!opts.forceRerender,
        modal: isModal
      });
    };
  }

  return {
    normalizePageNumber: normalizePageNumber,
    pageSuffix: pageSuffix,
    buildPreviewConfig: buildPreviewConfig,
    buildExportConfig: buildExportConfig,
    makeRenderFile: makeRenderFile,
    makeSpecialPreviewEnhance: makeSpecialPreviewEnhance,
    makeSpecialPreviewEmit: makeSpecialPreviewEmit,
    makePlainMediaEmit: makePlainMediaEmit
  };
})();
