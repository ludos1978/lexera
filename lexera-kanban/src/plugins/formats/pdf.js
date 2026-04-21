(function () {
  if (typeof LexeraPluginRegistry === 'undefined' || typeof LexeraFileFormatHelpers === 'undefined') return;
  var H = LexeraFileFormatHelpers;

  LexeraPluginRegistry.register({
    kind: 'fileFormat',
    metadata: { id: 'pdf', name: 'PDF file', version: '1.0.0' },
    label: 'PDF file',
    emoji: '&#128196;',
    assetType: 'document',
    rendererRequirements: [{ id: 'pdftoppm' }],
    previewPlaceholder: 'PDF preview uses the built-in viewer. Exports can render a page image for compatibility.',
    preview: {
      kind: 'pdf',
      supportsRuntimeRender: false
    },
    export: H.buildExportConfig('png', 'png', H.pageSuffix('-p')),
    matches: function (normalized) {
      return normalized.slice(-4) === '.pdf';
    },
    canRenderFile: function (path) {
      return this.matches(String(path || '').toLowerCase());
    },
    renderFile: H.makeRenderFile('pdf'),
    // PDF preview is rendered inline as an iframe pointing at the backend's
    // file endpoint — no worker, no cache round-trip. Card and modal variants
    // differ only in sizing (class name).
    emit: H.makeSpecialPreviewEmit(),
    enhance: function (container, opts) {
      opts = opts || {};
      var win = typeof window !== 'undefined' ? window : null;
      var doc = typeof document !== 'undefined' ? document : (win && win.document);
      var api = win && win.LexeraApi ? win.LexeraApi : null;
      var pathUtils = win && win.LexeraPathUtils ? win.LexeraPathUtils : null;
      if (!doc || !api || typeof api.fileUrl !== 'function') {
        if (win && typeof win.logFrontendIssue === 'function') {
          win.logFrontendIssue(
            'warn',
            'embed.enhance.dispatch',
            'Plugin pdf.enhance: LexeraApi.fileUrl unavailable',
            { filePath: opts.filePath }
          );
        }
        return Promise.resolve(false);
      }
      var isModal = opts.variant === 'modal';
      var parseLocalFileReference = pathUtils && pathUtils.parseLocalFileReference
        ? pathUtils.parseLocalFileReference
        : function (p) {
            var hashIdx = String(p || '').lastIndexOf('#');
            if (hashIdx === -1) return { path: p, pageNumber: '' };
            var page = String(p).slice(hashIdx + 1);
            var pageMatch = /^page=(\d+)$/i.exec(page);
            return {
              path: String(p).slice(0, hashIdx),
              pageNumber: pageMatch ? pageMatch[1] : ''
            };
          };
      var fileRef = parseLocalFileReference(opts.filePath);
      var iframe = doc.createElement('iframe');
      iframe.className = 'embed-preview embed-preview-pdf' +
        (isModal ? ' embed-preview-modal file-preview-frame' : '');
      iframe.setAttribute('loading', 'lazy');
      iframe.setAttribute(
        'title',
        (pathUtils && pathUtils.getDisplayFileNameFromPath
          ? pathUtils.getDisplayFileNameFromPath(opts.filePath)
          : opts.filePath) || 'PDF preview'
      );
      iframe.setAttribute(
        'src',
        api.fileUrl(opts.boardId, fileRef.path) +
          '#toolbar=0&navpanes=0' +
          (fileRef.pageNumber ? '&page=' + fileRef.pageNumber : '')
      );
      if (typeof iframe.addEventListener === 'function' && win && typeof win.logFrontendIssue === 'function') {
        iframe.addEventListener('error', function () {
          win.logFrontendIssue(
            'warn',
            'embed.preview.image',
            'PDF iframe failed to load: board=' + opts.boardId + ' file=' + opts.filePath
          );
        }, { once: true });
      }
      container.appendChild(iframe);
      return Promise.resolve(true);
    }
  });
})();
