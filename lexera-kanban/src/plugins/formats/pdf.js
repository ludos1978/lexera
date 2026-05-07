(function () {
  if (typeof LexeraPluginRegistry === 'undefined' || typeof LexeraFileFormatHelpers === 'undefined') return;
  var H = LexeraFileFormatHelpers;

  // PDF view modes — picked by the user from the embed burger menu and
  // persisted via LexeraSettings as a single global preference (per
  // the user's "minimal changes" directive: one setting for all PDFs).
  //
  //   scrolled  — vertical scroll, one page tall, the legacy default.
  //   overview  — every page rendered at a small fixed width and laid
  //               out in a wrap-grid so the whole document is visible
  //               at once (still scrolls if the doc is huge).
  //   stacked   — every page rendered at full container width, stacked
  //               vertically with NO inner scroll (the document grows
  //               the parent — useful inside a card body that already
  //               has its own scroll context).
  //
  // Settings key `pdfViewMode` is registered in core/settingsStore.js
  // (storage key: `lexera-pdf-view-mode`).
  var DEFAULT_MODE = 'scrolled';
  var VALID_MODES = { scrolled: 1, overview: 1, stacked: 1 };

  function settingsApi() {
    return (typeof window !== 'undefined' && window.LexeraSettings) || null;
  }
  function readMode() {
    var s = settingsApi();
    if (s && typeof s.get === 'function') {
      var v = s.get('pdfViewMode');
      if (v && VALID_MODES[v]) return v;
    }
    return DEFAULT_MODE;
  }
  function writeMode(mode) {
    if (!VALID_MODES[mode]) return;
    var s = settingsApi();
    if (s && typeof s.set === 'function') s.set('pdfViewMode', mode);
  }

  // Set the worker source exactly once. The worker file is vendored
  // alongside `pdf.min.js` under `src/vendor/pdfjs/`. Resolved against
  // window.location so subapp webviews under `views/<kind>/` can find
  // it too via the same relative path.
  var _workerConfigured = false;
  function configurePdfjsWorker() {
    if (_workerConfigured) return true;
    if (typeof window === 'undefined' || !window.pdfjsLib) return false;
    try {
      var base = new URL('vendor/pdfjs/pdf.worker.min.js', window.location.href);
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = base.toString();
      _workerConfigured = true;
      return true;
    } catch (_) {
      return false;
    }
  }

  // Render one PDF page into a fresh <canvas> at the requested CSS width.
  // Only the CSS *width* is set inline; height is left to `height: auto`
  // in CSS so the intrinsic `canvas.width × canvas.height` aspect ratio
  // is preserved when the canvas shrinks to fit a narrow container
  // (e.g. a card body smaller than the requested cssWidthPx). Setting
  // both inline width AND inline height was squashing the rendered
  // page when `max-width: 100%` clamped the displayed width.
  function renderPageToCanvas(page, cssWidthPx) {
    var unscaled = page.getViewport({ scale: 1 });
    var scale = cssWidthPx / unscaled.width;
    if (!isFinite(scale) || scale <= 0) scale = 1;
    var dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    var viewport = page.getViewport({ scale: scale * dpr });
    var canvas = document.createElement('canvas');
    canvas.className = 'pdf-page-canvas';
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    canvas.style.width = Math.round(viewport.width / dpr) + 'px';
    var ctx = canvas.getContext('2d');
    return page.render({ canvasContext: ctx, viewport: viewport }).promise.then(function () {
      return canvas;
    });
  }

  // Pixel widths used per mode when sizing each page canvas.
  //   scrolled — single tall column, comfortable read width.
  //   overview — small contact-sheet thumbnails. CSS grid with
  //              `auto-fill, minmax(140px, 1fr)` packs as many columns
  //              as the host can hold, so a wide modal shows a 5-up
  //              grid while a narrow card still gets 2-up — visually
  //              distinct from scrolled even in tight cards.
  //   stacked  — full host width, no inner scroll.
  var PAGE_WIDTH_BY_MODE = {
    scrolled: 720,
    overview: 140,
    stacked: 720
  };

  // Build the page list inside `container` for the given mode. Cancels
  // any in-flight render via the `cancelled` token if the mode flips
  // before the previous render finishes.
  function renderPages(pdf, container, mode, cancelled) {
    container.innerHTML = '';
    container.classList.remove('pdf-mode-scrolled', 'pdf-mode-overview', 'pdf-mode-stacked');
    container.classList.add('pdf-mode-' + mode);
    var width = PAGE_WIDTH_BY_MODE[mode] || PAGE_WIDTH_BY_MODE.scrolled;
    var loaders = [];
    for (var i = 1; i <= pdf.numPages; i++) {
      loaders.push(pdf.getPage(i));
    }
    return Promise.all(loaders).then(function (pages) {
      function next(idx) {
        if (cancelled.flag) return Promise.resolve();
        if (idx >= pages.length) return Promise.resolve();
        return renderPageToCanvas(pages[idx], width).then(function (canvas) {
          if (cancelled.flag) return;
          var pageEl = document.createElement('div');
          pageEl.className = 'pdf-page';
          // Page number is shown as a CSS-positioned label only in
          // overview mode — gives the contact-sheet a clear "page 1
          // of N" identity that scrolled and stacked deliberately
          // omit. Plain `data-` attribute so the CSS rule can pick it
          // up without the JS having to know about styling.
          pageEl.setAttribute('data-pdf-page-num', String(idx + 1));
          pageEl.appendChild(canvas);
          container.appendChild(pageEl);
          return next(idx + 1);
        });
      }
      return next(0);
    });
  }

  // Render one PDF into `host`. Returns a controller with `setMode` so
  // the burger menu can flip modes without re-fetching the document.
  function mountPdfViewer(host, url, initialMode) {
    if (!configurePdfjsWorker()) {
      host.innerHTML = '<div class="pdf-viewer-error">PDF.js library missing — vendor/pdfjs/pdf.min.js not loaded.</div>';
      return { setMode: function () {} };
    }
    host.classList.add('pdf-viewer');
    host.setAttribute('data-pdf-mode', initialMode);
    var loadingEl = document.createElement('div');
    loadingEl.className = 'pdf-viewer-loading';
    loadingEl.textContent = 'Loading PDF…';
    host.appendChild(loadingEl);

    var currentMode = initialMode;
    var cancelToken = { flag: false };
    var pdfDoc = null;

    // Pre-fetch the bytes ourselves and hand PDF.js a Uint8Array via
    // `data:` instead of letting it `fetch()` the URL itself. Reasons:
    //   1. PDF.js's internal fetch performs Range requests (HTTP 206)
    //      to stream large docs. Tauri's `lexera-asset://` custom
    //      protocol returns status 0 for those preflight-style probes
    //      — the user reported "Failed to load PDF: Unexpected server
    //      response (0)" against this protocol.
    //   2. A direct `fetch()` against the same URL DOES work (CSP
    //      allows `connect-src lexera-asset:` and the Rust handler
    //      streams the body in one shot).
    // Bypassing the range-request path keeps the load on the single
    // GET that the protocol already handles for `<img>`/`<video>`.
    fetch(url, { cache: 'no-store' }).then(function (response) {
      if (!response.ok) {
        throw new Error('HTTP ' + response.status + ' ' + (response.statusText || ''));
      }
      return response.arrayBuffer();
    }).then(function (buf) {
      return window.pdfjsLib.getDocument({
        data: new Uint8Array(buf),
        disableRange: true,
        disableStream: true
      }).promise;
    }).then(function (pdf) {
      pdfDoc = pdf;
      if (loadingEl.parentNode) loadingEl.parentNode.removeChild(loadingEl);
      return renderPages(pdf, host, currentMode, cancelToken);
    }).catch(function (err) {
      host.innerHTML = '';
      var errEl = document.createElement('div');
      errEl.className = 'pdf-viewer-error';
      errEl.textContent = 'Failed to load PDF: ' + (err && err.message ? err.message : String(err));
      host.appendChild(errEl);
      if (typeof window.logFrontendIssue === 'function') {
        window.logFrontendIssue('warn', 'pdf.viewer', 'getDocument failed: ' + url, { error: String(err) });
      }
    });

    return {
      setMode: function (mode) {
        if (!VALID_MODES[mode] || mode === currentMode || !pdfDoc) {
          if (VALID_MODES[mode] && mode !== currentMode) currentMode = mode;
          return;
        }
        // Cancel the previous render token, install a fresh one, and
        // re-paint with the new mode against the same loaded doc.
        cancelToken.flag = true;
        cancelToken = { flag: false };
        currentMode = mode;
        host.setAttribute('data-pdf-mode', mode);
        renderPages(pdfDoc, host, mode, cancelToken).catch(function () { /* swallowed: cancelled */ });
      },
      getMode: function () { return currentMode; }
    };
  }

  // Surfaced on window so the burger menu can find the active viewer
  // for a given embed container and tell it to switch modes.
  if (typeof window !== 'undefined') {
    window.LexeraPdfViewer = window.LexeraPdfViewer || {
      VALID_MODES: VALID_MODES,
      DEFAULT_MODE: DEFAULT_MODE,
      readMode: readMode,
      writeMode: writeMode,
      mount: mountPdfViewer,
      // Walk every mounted PDF viewer in the document and tell it to
      // switch to `mode`. Called by the burger menu after writeMode().
      // Each viewer keeps a back-reference at `el.__lexeraPdfController`.
      applyModeToAll: function (mode) {
        if (!VALID_MODES[mode]) return;
        var nodes = document.querySelectorAll('.pdf-viewer');
        for (var i = 0; i < nodes.length; i++) {
          var ctrl = nodes[i].__lexeraPdfController;
          if (ctrl && typeof ctrl.setMode === 'function') {
            try { ctrl.setMode(mode); } catch (_) { /* ignore */ }
          }
        }
      }
    };
  }

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
      var parseLocalFileReference = pathUtils && pathUtils.parseLocalFileReference
        ? pathUtils.parseLocalFileReference
        : function (p) {
            var hashIdx = String(p || '').lastIndexOf('#');
            if (hashIdx === -1) return { path: p, pageNumber: '' };
            return { path: String(p).slice(0, hashIdx), pageNumber: '' };
          };
      var fileRef = parseLocalFileReference(opts.filePath);
      var url = api.fileUrl(opts.boardId, fileRef.path);

      var host = doc.createElement('div');
      host.className = 'embed-preview embed-preview-pdf' +
        (opts.variant === 'modal' ? ' embed-preview-modal file-preview-frame' : '');
      host.setAttribute(
        'title',
        (pathUtils && pathUtils.getDisplayFileNameFromPath
          ? pathUtils.getDisplayFileNameFromPath(opts.filePath)
          : opts.filePath) || 'PDF preview'
      );
      container.appendChild(host);

      var ctrl = mountPdfViewer(host, url, readMode());
      host.__lexeraPdfController = ctrl;
      return Promise.resolve(true);
    }
  });
})();
