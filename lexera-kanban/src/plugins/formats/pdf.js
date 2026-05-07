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

  // Single intrinsic-resolution constant for ALL modes. Each page is
  // rasterized to canvas at this width once, then CSS sizes it down
  // (overview = ~100-200 px grid cell) or up (stacked = host width)
  // for display. Switching modes therefore does not require a re-
  // render — the burger menu's setMode just swaps CSS classes, which
  // is what makes the mode change feel immediate. 720 px covers
  // scrolled mode at native resolution and stays sharp when scaled
  // down to overview thumbnail size; modal stacked mode wider than
  // 720 px loses some sharpness but typical card stacks are < 720 px
  // so the trade-off lands on the right side for the common case.
  var RENDER_WIDTH_PX = 720;

  // Apply mode-class to `container` without touching the rendered
  // canvases. Used both at first render (just before renderPages
  // starts appending pages) and on every subsequent mode switch.
  function applyModeClass(container, mode) {
    container.classList.remove('pdf-mode-scrolled', 'pdf-mode-overview', 'pdf-mode-stacked');
    container.classList.add('pdf-mode-' + mode);
  }

  // Build the page list inside `container`. Pages are always
  // rasterized at RENDER_WIDTH_PX intrinsic — CSS sizes the canvas
  // for display in each mode, so this only runs once per PDF (per
  // mount) regardless of how many times the user switches modes.
  // Cancels any in-flight render via the `cancelled` token if the
  // host is destroyed mid-render.
  function renderPages(pdf, container, mode, cancelled) {
    container.innerHTML = '';
    applyModeClass(container, mode);
    var loaders = [];
    for (var i = 1; i <= pdf.numPages; i++) {
      loaders.push(pdf.getPage(i));
    }
    return Promise.all(loaders).then(function (pages) {
      function next(idx) {
        if (cancelled.flag) return Promise.resolve();
        if (idx >= pages.length) return Promise.resolve();
        return renderPageToCanvas(pages[idx], RENDER_WIDTH_PX).then(function (canvas) {
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
        if (!VALID_MODES[mode] || mode === currentMode) return;
        // Mode switch is JUST a CSS class swap — every page is already
        // rendered at RENDER_WIDTH_PX intrinsic resolution, so the
        // browser handles the layout flip + per-mode sizing for free.
        // No re-render, no progressive page-by-page repaint, no flash
        // of "stacked → side-by-side" transition. The user sees the
        // new layout in the next paint frame.
        currentMode = mode;
        host.setAttribute('data-pdf-mode', mode);
        applyModeClass(host, mode);
      },
      getMode: function () { return currentMode; }
    };
  }

  // Rewrite the source markdown of `card.cards[fullIdx].content` so the
  // `targetIndex`-th `![alt](path){…}` whose path matches `filePath`
  // carries `view=mode` in its attribute block. Used by the burger
  // menu's per-embed picker to persist the user's choice in the
  // markdown itself, so the mode survives reloads + appears in
  // exported markdown. Existing attributes other than `view=` are
  // preserved verbatim.
  function rewriteEmbedView(content, filePath, targetIndex, mode) {
    var idx = -1;
    return String(content).replace(
      /!\[([^\]]*)\]\(([^)]+)\)(\{[^}]*\})?/g,
      function (match, alt, rawSrc, attrsBlock) {
        idx++;
        if (idx !== targetIndex) return match;
        // rawSrc may carry a `path "title"` suffix — strip the title
        // for the equality check, but emit rawSrc verbatim in the
        // output so the title (and any escapes) are preserved.
        var srcPath = rawSrc;
        var titleMatch = rawSrc.match(/^(.+?)\s+["'][^"']*["']\s*$/);
        if (titleMatch) srcPath = titleMatch[1].trim();
        if (srcPath !== filePath) return match;
        var newAttrs;
        if (attrsBlock) {
          var inner = attrsBlock.slice(1, -1).trim();
          if (/(^|\s)view\s*=\s*\S+/.test(inner)) {
            inner = inner.replace(
              /(^|\s)view\s*=\s*\S+/,
              function (_m, lead) { return lead + 'view=' + mode; }
            );
          } else {
            inner = (inner ? inner + ' ' : '') + 'view=' + mode;
          }
          newAttrs = '{' + inner + '}';
        } else {
          newAttrs = '{view=' + mode + '}';
        }
        return '![' + alt + '](' + rawSrc + ')' + newAttrs;
      }
    );
  }

  // Persist the picked view-mode by rewriting the card's markdown
  // source and dispatching the existing card-save flow. The local
  // viewer was already updated by `applyModeToEmbed`, so this is a
  // background persistence step — the UI doesn't wait on it.
  // Every silent failure path logs to the in-app Log panel via
  // lexeraLog('warn', 'pdf.viewmode.persist', …) so the user can see
  // exactly why a save did not land instead of having to guess.
  function writeViewToCardMarkdown(embedContainer, mode) {
    function bail(reason, extra) {
      if (typeof window !== 'undefined' && typeof window.lexeraLog === 'function') {
        var msg = '[pdf-view-persist] ' + reason;
        if (extra) {
          try { msg += ' ' + JSON.stringify(extra); } catch (_) { /* ignore */ }
        }
        window.lexeraLog('warn', msg);
      }
    }
    if (typeof window === 'undefined') return;
    if (!VALID_MODES[mode] || !embedContainer) return bail('invalid args', { mode: mode, hasContainer: !!embedContainer });
    var cardEl = embedContainer.closest && embedContainer.closest('.card');
    if (!cardEl) return bail('no .card ancestor');
    var bds = window.LexeraBoardDataStore;
    var ce = window.CardEditor;
    if (!bds) return bail('window.LexeraBoardDataStore missing');
    if (!ce || typeof ce.saveCardEdit !== 'function') return bail('window.CardEditor.saveCardEdit missing');
    var colIndex = parseInt(cardEl.getAttribute('data-col-index') || '-1', 10);
    var visibleIdx = parseInt(cardEl.getAttribute('data-card-index') || '-1', 10);
    if (colIndex < 0 || visibleIdx < 0) return bail('card data attrs missing', { colIndex: colIndex, visibleIdx: visibleIdx });
    var col = typeof bds.getFullColumn === 'function' ? bds.getFullColumn(colIndex) : null;
    if (!col || !col.cards) return bail('full column not resolvable', { colIndex: colIndex });
    var fullIdx = typeof bds.getFullCardIndex === 'function' ? bds.getFullCardIndex(col, visibleIdx) : visibleIdx;
    if (fullIdx < 0 || !col.cards[fullIdx]) return bail('full card index not resolvable', { colIndex: colIndex, visibleIdx: visibleIdx, fullIdx: fullIdx });
    var oldContent = col.cards[fullIdx].content || '';
    var embedIndex = parseInt(embedContainer.getAttribute('data-embed-index') || '0', 10);
    var filePath = embedContainer.getAttribute('data-file-path') || '';
    if (!filePath) return bail('embed has no data-file-path');
    var newContent = rewriteEmbedView(oldContent, filePath, embedIndex, mode);
    if (newContent === oldContent) {
      return bail('rewrite produced no change — embedIndex / filePath did not match the source markdown',
        { embedIndex: embedIndex, filePath: filePath, contentSnippet: oldContent.slice(0, 200) });
    }
    // The user already sees the visual change from the local viewer's
    // setMode + the data-pdf-view attr update; saveCardEdit handles
    // the CRDT write + sibling-window broadcast. saveCardEdit is
    // ASYNC, so the previous try/catch only caught synchronous
    // throws — a rejected promise was silently swallowed. Log both
    // paths so a real "save did not land" failure surfaces in the
    // Log panel + a notification (which the user will actually see
    // even without opening the panel).
    function notifyFailure(reason) {
      if (typeof window.showNotification === 'function') {
        try { window.showNotification('PDF view-mode save failed: ' + reason); } catch (_) {}
      }
    }
    try {
      var saveResult = ce.saveCardEdit(cardEl, colIndex, fullIdx, newContent);
      if (typeof window.lexeraLog === 'function') {
        window.lexeraLog('info', '[pdf-view-persist] dispatched save: view=' + mode +
          ' for ' + filePath + ' (col=' + colIndex + ' card=' + fullIdx + ')');
      }
      if (saveResult && typeof saveResult.then === 'function') {
        saveResult.then(function () {
          if (typeof window.lexeraLog === 'function') {
            window.lexeraLog('info', '[pdf-view-persist] save completed for ' + filePath);
          }
        }).catch(function (err) {
          var msg = String(err && err.message ? err.message : err);
          bail('saveCardEdit promise rejected', { error: msg });
          notifyFailure(msg);
        });
      }
    } catch (e) {
      var syncMsg = String(e && e.message ? e.message : e);
      bail('saveCardEdit threw synchronously', { error: syncMsg });
      notifyFailure(syncMsg);
    }
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
      _test_rewriteEmbedView: rewriteEmbedView,
      // Apply a mode to ONE specific embed and persist the choice into
      // the card's markdown source as a `{view=…}` attribute. Called
      // by the burger menu's per-embed picker.
      applyModeToEmbed: function (embedContainer, mode) {
        if (!VALID_MODES[mode] || !embedContainer) return;
        var viewer = embedContainer.querySelector('.pdf-viewer');
        if (viewer && viewer.__lexeraPdfController &&
            typeof viewer.__lexeraPdfController.setMode === 'function') {
          try { viewer.__lexeraPdfController.setMode(mode); } catch (_) {}
        }
        embedContainer.setAttribute('data-pdf-view', mode);
        writeViewToCardMarkdown(embedContainer, mode);
      },
      // Walk every mounted PDF viewer in the document and tell it to
      // switch to `mode`. Skips embeds with an explicit `data-pdf-view`
      // attribute so per-embed `{view=…}` overrides stay pinned.
      // Each viewer keeps a back-reference at `el.__lexeraPdfController`.
      applyModeToAll: function (mode) {
        if (!VALID_MODES[mode]) return;
        var nodes = document.querySelectorAll('.pdf-viewer');
        for (var i = 0; i < nodes.length; i++) {
          var node = nodes[i];
          var parent = node.parentNode;
          var pinnedView = parent && parent.getAttribute
            ? String(parent.getAttribute('data-pdf-view') || '').toLowerCase()
            : '';
          if (VALID_MODES[pinnedView]) continue;
          var ctrl = node.__lexeraPdfController;
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

      // Per-embed `{view=…}` attribute (parsed from the source markdown
      // by inlineRenderer.js → emitted as `data-pdf-view` on the embed
      // container) overrides the global default. Falls back to
      // LexeraSettings.pdfViewMode for embeds without an explicit view.
      var perEmbedView = container && container.getAttribute
        ? String(container.getAttribute('data-pdf-view') || '').toLowerCase()
        : '';
      var initialMode = VALID_MODES[perEmbedView] ? perEmbedView : readMode();
      var ctrl = mountPdfViewer(host, url, initialMode);
      host.__lexeraPdfController = ctrl;
      return Promise.resolve(true);
    }
  });
})();
