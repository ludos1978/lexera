(function () {
  if (typeof LexeraPluginRegistry === 'undefined' || typeof LexeraFileFormatHelpers === 'undefined') return;
  var H = LexeraFileFormatHelpers;

  // PDF view modes. Picked per-embed via the burger menu and
  // persisted as a `{view=…}` Pandoc-style attribute on the source
  // markdown's `![..](path){…}` embed. Absence of the attribute means
  // scrolled — there is no global default override; scrolled is the
  // hard-coded fallback.
  //
  //   scrolled  — vertical scroll, one page tall, the implicit default.
  //   overview  — every page rendered as a small thumbnail laid out
  //               in a CSS-grid contact-sheet so the whole document
  //               is visible at once.
  //   stacked   — every page rendered at full container width, stacked
  //               vertically with NO inner scroll (the document grows
  //               the parent — useful inside a card body that already
  //               has its own scroll context).
  var DEFAULT_MODE = 'scrolled';
  var VALID_MODES = { scrolled: 1, overview: 1, stacked: 1 };

  // Module-level cache of parsed PDF documents, keyed by the asset
  // URL the plugin fetches from. After the user picks a view mode in
  // the burger menu, applyModeToEmbed → saveCardEdit →
  // persistBoardMutation → refreshTargetedElements re-renders the
  // card, which destroys the embed and re-mounts a fresh viewer.
  // Without this cache the re-mount fetches the file again, re-runs
  // pdfjsLib.getDocument (CPU), and only THEN re-renders pages — the
  // user sees the embed go blank, then partial, then settled "a while
  // after first rendering". Caching pdfDoc skips the network + parse
  // on the re-mount; only the canvas re-render runs.
  //
  // Memory: PDF.js documents hold parsed page objects. For typical
  // boards with 1-5 PDFs in view this is well under a MB; if memory
  // becomes a concern an LRU bound can replace the plain map.
  var _pdfDocCache = {};

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
  //
  // Pages are rendered in parallel and appended in a single
  // DocumentFragment commit so the host's height changes exactly
  // once (one layout reflow) instead of N times as pages stream in.
  // The user reported "modifies the layout quite a bit after first
  // rendered" — that was the per-page reflow chain.
  //
  // Cancellation: the host's parent is detached (e.g. card
  // re-render) — checking `cancelled.flag` before the final commit
  // avoids appending into a dead host. PDF.js itself can't cancel
  // an in-flight `page.render()`, so we let those complete and
  // throw the canvases away.
  function renderPages(pdf, container, mode, cancelled) {
    container.innerHTML = '';
    applyModeClass(container, mode);
    var pageCount = pdf.numPages;
    var loaders = [];
    for (var i = 1; i <= pageCount; i++) loaders.push(pdf.getPage(i));
    return Promise.all(loaders).then(function (pages) {
      var canvasPromises = pages.map(function (page) {
        return renderPageToCanvas(page, RENDER_WIDTH_PX);
      });
      return Promise.all(canvasPromises);
    }).then(function (canvases) {
      if (cancelled.flag) return;
      var frag = document.createDocumentFragment();
      for (var idx = 0; idx < canvases.length; idx++) {
        var pageEl = document.createElement('div');
        pageEl.className = 'pdf-page';
        // Page number — surfaced via the CSS `::after` rule that's
        // active only in overview mode (gives the contact-sheet a
        // clear "page N of M" identity).
        pageEl.setAttribute('data-pdf-page-num', String(idx + 1));
        pageEl.appendChild(canvases[idx]);
        frag.appendChild(pageEl);
      }
      container.appendChild(frag);
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
    // Apply the mode class IMMEDIATELY at mount, BEFORE fetch starts.
    // Without this the host first renders against the legacy
    // `.embed-preview-pdf` rule (`width: min(680px, 100%); height:
    // min(360px, 50vh); overflow: auto`) and only switches to the
    // mode override (e.g. `pdf-mode-stacked { width: 100%; height:
    // auto }`) once `renderPages` runs after fetch+parse — which is
    // a visible host-size jump the user reported as "modifies the
    // layout quite a bit after first rendered".
    applyModeClass(host, initialMode);
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
    // Cache hit: skip fetch + parse, go straight to render. This is
    // the common case after the burger-menu picker triggers a card
    // re-render. The pdfDoc is the EXACT same parsed object that
    // backed the previous mount, so render output is byte-identical.
    var docPromise;
    if (_pdfDocCache[url]) {
      docPromise = Promise.resolve(_pdfDocCache[url]);
    } else {
      docPromise = fetch(url, { cache: 'no-store' }).then(function (response) {
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
        _pdfDocCache[url] = pdf;
        return pdf;
      });
    }

    docPromise.then(function (pdf) {
      pdfDoc = pdf;
      if (loadingEl.parentNode) loadingEl.parentNode.removeChild(loadingEl);
      return renderPages(pdf, host, currentMode, cancelToken);
    }).catch(function (err) {
      // Surface broken PDFs through the unified `.embed-broken` state on
      // the surrounding `.embed-container` so they read the same as a
      // missing image/video/audio: a single CSS pseudo-element message
      // ("Embedded file not found: {path}"). The raw error stays in the
      // log for diagnosis.
      host.innerHTML = '';
      var container = host.parentElement;
      while (container && !(container.classList && container.classList.contains('embed-container'))) {
        container = container.parentElement;
      }
      if (container) container.classList.add('embed-broken');
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
  // carries the picked view mode.
  //
  // Mode semantics — scrolled is the implicit default:
  //   - mode === 'scrolled'           ⇒ REMOVE `view=…` from the attrs
  //                                     block (and remove the whole
  //                                     `{…}` if it becomes empty), so
  //                                     a card without `{view=…}` reads
  //                                     scrolled the way the user wants.
  //   - mode === 'overview' | 'stacked' ⇒ add or replace `view=mode`
  //                                     inside the attrs block,
  //                                     preserving every other attr
  //                                     verbatim.
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
        var inner = attrsBlock ? attrsBlock.slice(1, -1).trim() : '';
        if (mode === DEFAULT_MODE) {
          // Strip any existing `view=…` so the embed falls back to
          // scrolled via the absence-of-attribute rule.
          inner = inner.replace(/(^|\s)view\s*=\s*\S+/g, '').trim();
        } else if (/(^|\s)view\s*=\s*\S+/.test(inner)) {
          inner = inner.replace(
            /(^|\s)view\s*=\s*\S+/,
            function (_m, lead) { return lead + 'view=' + mode; }
          );
        } else {
          inner = (inner ? inner + ' ' : '') + 'view=' + mode;
        }
        var newAttrs = inner ? '{' + inner + '}' : '';
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
    // setMode + the data-view-mode attr update; saveCardEdit handles
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
        embedContainer.setAttribute('data-view-mode', mode);
        writeViewToCardMarkdown(embedContainer, mode);
      },
      // Walk every mounted PDF viewer in the document and tell it to
      // switch to `mode`. Skips embeds with an explicit `data-view-mode`
      // attribute so per-embed `{view=…}` overrides stay pinned.
      // Each viewer keeps a back-reference at `el.__lexeraPdfController`.
      applyModeToAll: function (mode) {
        if (!VALID_MODES[mode]) return;
        var nodes = document.querySelectorAll('.pdf-viewer');
        for (var i = 0; i < nodes.length; i++) {
          var node = nodes[i];
          var parent = node.parentNode;
          var pinnedView = parent && parent.getAttribute
            ? String(parent.getAttribute('data-view-mode') || '').toLowerCase()
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
    // Board view keeps its interactive pdf.js viewer
    // (supportsRuntimeRender:false → embedMenu's preview-cache render is a
    // no-op for PDF). The cacheFolderName + outputExtension are still
    // required so the EXPORT path's getPreviewRenderConfig() returns a
    // config instead of null — without them renderFileEmbedsForExport
    // skips PDF and the embed never becomes an image in Marp/presentation
    // (and other) exports. Mirrors the drawio/excalidraw cache scheme;
    // suffix matches the export config so both target the same cache file.
    preview: {
      kind: 'pdf',
      cacheFolderName: 'pdf-cache',
      outputExtension: 'png',
      outputFormat: 'png',
      supportsRuntimeRender: false,
      buildSuffix: H.pageSuffix('-p')
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
      // by inlineRenderer.js → emitted as `data-view-mode` on the embed
      // container). Absence of the attribute means scrolled — there is
      // no global default-override, scrolled is the hard-coded fallback.
      var perEmbedView = container && container.getAttribute
        ? String(container.getAttribute('data-view-mode') || '').toLowerCase()
        : '';
      var initialMode = VALID_MODES[perEmbedView] ? perEmbedView : DEFAULT_MODE;
      var ctrl = mountPdfViewer(host, url, initialMode);
      host.__lexeraPdfController = ctrl;
      return Promise.resolve(true);
    }
  });
})();
