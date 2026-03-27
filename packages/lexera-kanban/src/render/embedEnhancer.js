var EmbedEnhancer = (function () {
  'use strict';
  var _deps = {};
  var _rt = typeof window !== 'undefined' && window.LexeraRuntime ? window.LexeraRuntime : null;

  // --- Cache state ---
  var embedPreviewCache = {};
  var externalEmbedPolicyCache = {};
  var pendingExternalEmbedPolicyCache = {};
  var MAX_INCLUDE_PREVIEW_DEPTH = 2;

  function init(deps) {
    if (typeof window !== 'undefined' && window.LexeraRuntime) {
      _rt = window.LexeraRuntime;
      _rt.mergeDeps(_deps, deps);
    } else {
      _deps = deps || {};
    }
  }

  // --- External embed URL helpers ---

  function normalizeExternalEmbedUrlForCache(url) {
    var value = String(url || '').trim();
    if (!value) return '';
    try {
      var parsed = new URL(value);
      parsed.hash = '';
      return parsed.toString();
    } catch (err) {
      return value;
    }
  }

  function getExternalEmbedParentOrigin() {
    try {
      if (window.location && typeof window.location.origin === 'string') {
        return window.location.origin || '';
      }
    } catch (err) {
      // Fall through to empty origin.
    }
    return '';
  }

  function getExternalEmbedPolicyCacheKey(url, parentOrigin) {
    return String(parentOrigin || '') + '::' + normalizeExternalEmbedUrlForCache(url);
  }

  function clearExternalEmbedPolicyCache(url, parentOrigin) {
    var cacheKey = getExternalEmbedPolicyCacheKey(url, parentOrigin || getExternalEmbedParentOrigin());
    delete externalEmbedPolicyCache[cacheKey];
    delete pendingExternalEmbedPolicyCache[cacheKey];
  }

  function getExternalEmbedPolicyButtonLabel(policy) {
    return policy && policy.action === 'open_page' ? 'Open page' : 'Open in browser';
  }

  function getExternalEmbedPolicyButtonAction(policy) {
    return policy && policy.action === 'open_page' ? 'open-page' : 'open-browser';
  }

  function getExternalEmbedSourceUrl(container) {
    if (!container) return '';
    return container.getAttribute('data-embed-url') || '';
  }

  function getExternalEmbedFrameUrl(container) {
    if (!container) return '';
    return container.getAttribute('data-embed-frame-url') || getExternalEmbedSourceUrl(container);
  }

  function getExternalEmbedProbeUrl(container) {
    if (!container) return '';
    return container.getAttribute('data-embed-probe-url') || getExternalEmbedFrameUrl(container) || getExternalEmbedSourceUrl(container);
  }

  function buildExternalEmbedFrameHtml(container) {
    var embedUrl = getExternalEmbedFrameUrl(container);
    var embedWidth = _deps.sanitizeCssLength(container.getAttribute('data-embed-width')) || '100%';
    var embedHeight = _deps.sanitizeCssLength(container.getAttribute('data-embed-height')) || '500px';
    var titleText = _deps.decodeHtmlEntities(
      container.getAttribute('data-embed-title') ||
      container.getAttribute('data-alt-text') ||
      embedUrl
    );
    return '<iframe class="external-embed-frame" src="' + _deps.escapeAttr(embedUrl) + '"' +
      ' title="' + _deps.escapeAttr(titleText || embedUrl) + '"' +
      ' loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen frameborder="0"' +
      ' style="' + _deps.escapeAttr('width:100%;max-width:' + embedWidth + ';height:' + embedHeight) + '"></iframe>';
  }

  function getExternalEmbedStage(container) {
    if (!container) return null;
    var stage = container.querySelector('.external-embed-stage');
    if (stage) return stage;
    stage = document.createElement('span');
    stage.className = 'external-embed-stage';
    container.insertBefore(stage, container.firstChild || null);
    return stage;
  }

  // --- Render & policy functions ---

  function renderExternalEmbedPrompt(container, state) {
    if (!container) return;
    var stage = getExternalEmbedStage(container);
    if (!stage) return;
    var embedUrl = getExternalEmbedSourceUrl(container);
    var displayUrl = embedUrl;
    try {
      displayUrl = (new URL(embedUrl)).hostname || embedUrl;
    } catch (err) {
      displayUrl = embedUrl;
    }
    var titleText = _deps.decodeHtmlEntities(container.getAttribute('data-embed-title') || '');
    var heading = titleText || displayUrl || 'External page';
    var buttonHtml = '';
    var reasonHtml = '';
    if (state && state.ready) {
      buttonHtml = '<button class="external-embed-open-btn" type="button" data-external-embed-action="' +
        _deps.escapeAttr(getExternalEmbedPolicyButtonAction(state.policy)) + '">' +
        _deps.escapeHtml(getExternalEmbedPolicyButtonLabel(state.policy)) +
        '</button>';
      if (state.policy && state.policy.reason) {
        reasonHtml = '<div class="external-embed-reason">' + _deps.escapeHtml(state.policy.reason) + '</div>';
      }
      container.setAttribute('data-external-policy-action', state.policy && state.policy.action ? state.policy.action : '');
      if (state.policy && state.policy.reason) {
        container.setAttribute('data-external-policy-reason', state.policy.reason);
      } else {
        container.removeAttribute('data-external-policy-reason');
      }
    } else {
      container.removeAttribute('data-external-policy-action');
      container.removeAttribute('data-external-policy-reason');
    }
    stage.innerHTML =
      '<div class="external-embed-shell external-embed-shell-' + _deps.escapeAttr((state && state.mode) || 'loading') + '">' +
        '<div class="external-embed-label">External page</div>' +
        '<div class="external-embed-heading">' + _deps.escapeHtml(heading) + '</div>' +
        '<div class="external-embed-url">' + _deps.escapeHtml(embedUrl) + '</div>' +
        '<div class="external-embed-message">' + _deps.escapeHtml((state && state.message) || 'Checking whether the page can be embedded\u2026') + '</div>' +
        (buttonHtml ? '<div class="external-embed-actions">' + buttonHtml + '</div>' : '') +
        reasonHtml +
      '</div>';
  }

  function openExternalEmbedInPlace(container) {
    if (!container) return;
    var embedUrl = getExternalEmbedFrameUrl(container);
    if (!embedUrl) return;
    container.setAttribute('data-external-opened', '1');
    var stage = getExternalEmbedStage(container);
    if (!stage) return;
    stage.innerHTML =
      buildExternalEmbedFrameHtml(container) +
      '<div class="external-embed-inline-actions">' +
        '<button class="external-embed-secondary-btn" type="button" data-external-embed-action="open-browser">Open in browser</button>' +
      '</div>';
    traceFrontendAction('info', 'embed.external.open', 'Opened external page inside embed', {
      url: getExternalEmbedSourceUrl(container),
      frameUrl: embedUrl
    });
  }

  function requestExternalEmbedPolicy(url, options) {
    options = options || {};
    var normalizedUrl = normalizeExternalEmbedUrlForCache(url);
    var parentOrigin = options.parentOrigin || getExternalEmbedParentOrigin();
    var forceRefresh = !!options.forceRefresh;
    var cacheKey = getExternalEmbedPolicyCacheKey(normalizedUrl, parentOrigin);
    if (!forceRefresh && Object.prototype.hasOwnProperty.call(externalEmbedPolicyCache, cacheKey)) {
      return Promise.resolve(externalEmbedPolicyCache[cacheKey]);
    }
    if (!forceRefresh && pendingExternalEmbedPolicyCache[cacheKey]) {
      return pendingExternalEmbedPolicyCache[cacheKey];
    }
    pendingExternalEmbedPolicyCache[cacheKey] = _deps.LexeraApi.probeExternalEmbed(normalizedUrl, parentOrigin, forceRefresh)
      .then(function (policy) {
        externalEmbedPolicyCache[cacheKey] = policy || null;
        delete pendingExternalEmbedPolicyCache[cacheKey];
        traceFrontendAction('info', 'embed.external.policy', 'Resolved external embed policy', {
          url: normalizedUrl,
          parentOrigin: parentOrigin,
          action: policy && policy.action,
          embeddable: !!(policy && policy.embeddable),
          fromCache: !!(policy && policy.fromCache),
          reason: policy && policy.reason
        });
        return externalEmbedPolicyCache[cacheKey];
      })
      .catch(function (err) {
        delete pendingExternalEmbedPolicyCache[cacheKey];
        logFrontendIssue('warn', 'embed.external.policy', 'Failed to probe external embed policy for ' + normalizedUrl, err);
        var fallback = {
          url: normalizedUrl,
          parentOrigin: parentOrigin,
          embeddable: false,
          action: 'open_in_browser',
          reason: 'Could not verify iframe policy. Open in browser instead.'
        };
        externalEmbedPolicyCache[cacheKey] = fallback;
        return fallback;
      });
    return pendingExternalEmbedPolicyCache[cacheKey];
  }

  function renderEmbedPreviewContent(kind, boardId, filePath, content) {
    var safeContent = String(content || '');
    if (safeContent.length > 12000) {
      safeContent = safeContent.slice(0, 12000) + '\n\n[Preview truncated]';
    }
    if (kind === 'markdown') {
      safeContent = _deps.resolveMarkdownRelativeTargets(safeContent, filePath);
      return '<div class="embed-inline-markdown">' +
        _deps.renderCardContent(safeContent, boardId, {
          footnoteDefs: {},
          footnoteOrder: [],
          abbrDefs: {},
          embedCounter: 0
        }, { nested: true }) +
        '</div>';
    }
    return '<pre class="embed-text-preview">' + _deps.escapeHtml(safeContent) + '</pre>';
  }

  function resolveBoardPath(boardId, filePath, toMode) {
    return _deps.LexeraApi.request('/boards/' + boardId + '/convert-path', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cardId: '', path: filePath, to: toMode }),
    }).then(function (res) {
      return res && res.path ? res.path : filePath;
    }).catch(function (err) {
      logFrontendIssue(
        'warn',
        'path.resolve',
        'Failed to resolve ' + toMode + ' path for board ' + boardId + ' path ' + filePath,
        err
      );
      return filePath;
    });
  }

  // --- Enhance functions ---

  async function enhanceEmbeddedContent(root) {
    if (_deps.ContentEnhancerRegistry) {
      _deps.ContentEnhancerRegistry.enhance(root, { boardId: _deps.getActiveBoardId() });
    }
  }

  async function enhanceSingleExternalEmbedContainer(container, options) {
    options = options || {};
    if (!container) return;
    var embedUrl = getExternalEmbedSourceUrl(container);
    var probeUrl = getExternalEmbedProbeUrl(container);
    var lastEnhancedUrl = container.getAttribute('data-external-enhanced-url') || '';
    var lastEnhancedProbeUrl = container.getAttribute('data-external-enhanced-probe-url') || '';
    if (
      !options.forceRefresh &&
      container.getAttribute('data-external-enhanced') === '1' &&
      lastEnhancedUrl === embedUrl &&
      lastEnhancedProbeUrl === probeUrl
    ) return;
    if (!embedUrl || !probeUrl) return;
    container.setAttribute('data-external-enhanced', '1');
    container.setAttribute('data-external-enhanced-url', embedUrl);
    container.setAttribute('data-external-enhanced-probe-url', probeUrl);
    container.removeAttribute('data-external-opened');
    traceFrontendAction('info', 'embed.external.prepare', 'Preparing external embed check', {
      url: embedUrl,
      frameUrl: getExternalEmbedFrameUrl(container),
      probeUrl: probeUrl,
      forceRefresh: !!options.forceRefresh
    });
    renderExternalEmbedPrompt(container, {
      mode: 'loading',
      ready: false,
      message: 'Checking whether this page can be embedded\u2026'
    });
    var currentUrl = embedUrl;
    var currentProbeUrl = probeUrl;
    var policy = await requestExternalEmbedPolicy(probeUrl, {
      forceRefresh: !!options.forceRefresh
    });
    if (!container.isConnected) return;
    if (getExternalEmbedSourceUrl(container) !== currentUrl) return;
    if (getExternalEmbedProbeUrl(container) !== currentProbeUrl) return;
    renderExternalEmbedPrompt(container, {
      mode: policy && policy.action === 'open_page' ? 'ready' : 'browser',
      ready: true,
      policy: policy,
      message: policy && policy.action === 'open_page'
        ? 'This page appears to allow embedding. It will only load after you confirm.'
        : 'This page should be opened in your browser instead of being embedded here.'
    });
  }

  async function enhanceSingleFileLink(link) {
    if (!link || link.getAttribute('data-link-enhanced') === '1') return;
    var boardId = link.getAttribute('data-board-id') || _deps.getActiveBoardId() || '';
    var filePath = link.getAttribute('data-file-path') || link.getAttribute('data-original-href') || '';
    if (!boardId || !filePath || /^(https?:\/\/|mailto:|#)/.test(filePath)) return;
    var fileRef = _deps.parseLocalFileReference(filePath);
    link.setAttribute('data-link-enhanced', '1');
    var info = await _deps.requestFileInfo(boardId, fileRef.path);
    _deps.applyFileLinkInfo(link, info, fileRef.path);
  }

  async function enhanceSingleInlineFileEmbed(container) {
    if (!container || container.getAttribute('data-inline-enhanced') === '1') return;
    var boardId = container.getAttribute('data-board-id') || _deps.getActiveBoardId() || '';
    var filePath = container.getAttribute('data-file-path') || '';
    var ext = container.getAttribute('data-inline-type') || _deps.getInlineFileEmbedExtension(filePath);
    var body = container.querySelector('.inline-file-embed-body');
    if (!boardId || !filePath || !ext || !body) return;

    container.setAttribute('data-inline-enhanced', '1');
    body.innerHTML = '<div class="embed-preview-loading">Loading preview...</div>';

    var fileRef = _deps.parseLocalFileReference(filePath);
    var info = await _deps.requestFileInfo(boardId, fileRef.path);
    var isMissing = !info || info.exists === false;
    container.classList.toggle('embed-broken', isMissing);
    if (isMissing) {
      body.innerHTML = '<div class="broken-include-placeholder">Inline file unavailable</div>';
      return;
    }

    try {
      var response = await fetch(_deps.LexeraApi.fileUrl(boardId, fileRef.path));
      if (!response.ok) throw new Error('Failed to load inline file preview');
      var text = await response.text();
      var previewPath = filePath;
      if (_deps.isBoardRelativePath(filePath)) {
        previewPath = await resolveBoardPath(boardId, filePath, 'absolute');
      }
      var kind = (ext === 'md' || ext === 'markdown') ? 'markdown' : 'text';
      body.innerHTML = renderEmbedPreviewContent(kind, boardId, previewPath, text);
      _deps.applyRenderedHtmlCommentVisibility(body, _deps.getCurrentHtmlCommentRenderMode());
      _deps.applyRenderedTagVisibility(body, _deps.getCurrentTagVisibilityMode());
      enhanceEmbeddedContent(body);
    } catch (err) {
      logFrontendIssue(
        'warn',
        'embed.inline-file',
        'Failed to render inline file preview for board ' + boardId + ' path ' + filePath,
        err
      );
      container.classList.add('embed-broken');
      body.innerHTML = '<div class="broken-include-placeholder">Inline file unavailable</div>';
    }
  }

  async function enhanceSingleColumnIncludeBadge(badge) {
    if (!badge || badge.getAttribute('data-include-enhanced') === '1') return;
    var boardId = _deps.getActiveBoardId() || '';
    var includePath = badge.getAttribute('data-include-path') || '';
    if (!boardId || !includePath) return;
    badge.setAttribute('data-include-enhanced', '1');
    var resolvedPath = includePath;
    if (_deps.isBoardRelativePath(includePath)) {
      resolvedPath = await resolveBoardPath(boardId, includePath, 'absolute');
    }
    var info = await _deps.requestFileInfo(boardId, resolvedPath || includePath);
    var isMissing = !info || info.exists === false;
    badge.classList.toggle('include-broken', isMissing);
    if (isMissing) {
      badge.setAttribute('title', 'Missing include: ' + includePath);
    }
  }

  async function enhanceSingleIncludeDirective(container) {
    if (!container || container.getAttribute('data-include-enhanced') === '1') return;
    var boardId = container.getAttribute('data-board-id') || _deps.getActiveBoardId() || '';
    var rawPath = container.getAttribute('data-file-path') || '';
    var depth = parseInt(container.getAttribute('data-include-depth') || '0', 10);
    var link = container.querySelector('.markdown-file-link[data-file-path]');
    var body = container.querySelector('.include-inline-body');
    if (!boardId || !rawPath || !body) return;

    container.setAttribute('data-include-enhanced', '1');
    if (!isFinite(depth)) depth = 0;
    if (depth >= MAX_INCLUDE_PREVIEW_DEPTH) {
      body.innerHTML = '';
      return;
    }

    body.innerHTML = '<div class="embed-preview-loading">Loading include...</div>';

    var resolvedPath = rawPath;
    if (_deps.isBoardRelativePath(rawPath)) {
      resolvedPath = await resolveBoardPath(boardId, rawPath, 'absolute');
    }
    if (resolvedPath && link) {
      link.setAttribute('data-file-path', resolvedPath);
      link.setAttribute('data-original-href', resolvedPath);
    }

    var info = await _deps.requestFileInfo(boardId, resolvedPath || rawPath);
    _deps.applyFileLinkInfo(link, info, resolvedPath || rawPath);
    var isMissing = !info || info.exists === false;
    if (isMissing) {
      container.classList.add('include-broken');
      body.innerHTML = '<div class="broken-include-placeholder">Included content unavailable</div>';
      return;
    }

    try {
      var response = await fetch(_deps.LexeraApi.fileUrl(boardId, resolvedPath || rawPath));
      if (!response.ok) throw new Error('Failed to load include');
      var text = await response.text();
      var rewritten = _deps.resolveMarkdownRelativeTargets(text, resolvedPath || rawPath);
      body.innerHTML = '<div class="included-content-block">' +
        _deps.renderCardContent(rewritten, boardId, {
          footnoteDefs: {},
          footnoteOrder: [],
          abbrDefs: {},
          embedCounter: 0
        }, { nested: true }) +
        '</div>';
      _deps.applyRenderedHtmlCommentVisibility(body, _deps.getCurrentHtmlCommentRenderMode());
      _deps.applyRenderedTagVisibility(body, _deps.getCurrentTagVisibilityMode());

      var nested = body.querySelectorAll('.include-inline-container[data-file-path]');
      for (var i = 0; i < nested.length; i++) {
        nested[i].setAttribute('data-include-depth', String(depth + 1));
      }

      enhanceEmbeddedContent(body);
    } catch (err) {
      logFrontendIssue(
        'warn',
        'embed.include',
        'Failed to render include preview for board ' + boardId + ' path ' + rawPath,
        err
      );
      container.classList.add('include-broken');
      body.innerHTML = '<div class="broken-include-placeholder">Included content unavailable</div>';
    }
  }

  async function enhanceSingleEmbedContainer(container, enhanceOpts) {
    enhanceOpts = enhanceOpts || {};
    if (!container || (!enhanceOpts.forceRerender && container.getAttribute('data-embed-enhanced') === '1')) return;
    var boardId = container.getAttribute('data-board-id') || _deps.getActiveBoardId() || '';
    var filePath = container.getAttribute('data-file-path') || '';
    if (!boardId || !filePath) return;
    var fileRef = _deps.parseLocalFileReference(filePath);
    var previewKind = _deps.getEmbedPreviewKind(filePath);
    if (!previewKind) return;

    container.setAttribute('data-embed-enhanced', '1');
    var cacheKey = _deps.getEmbedPreviewCacheKey(boardId, filePath);
    var previewEl = document.createElement(previewKind === 'pdf' ? 'iframe' : 'div');
    previewEl.className = 'embed-preview embed-preview-' + previewKind;

    if (previewKind === 'pdf') {
      previewEl.setAttribute('loading', 'lazy');
      previewEl.setAttribute('title', _deps.getDisplayFileNameFromPath(filePath) || 'PDF preview');
      previewEl.setAttribute(
        'src',
        _deps.LexeraApi.fileUrl(boardId, fileRef.path) +
          '#toolbar=0&navpanes=0' +
          (fileRef.pageNumber ? '&page=' + fileRef.pageNumber : '')
      );
      container.appendChild(previewEl);
      return;
    }

    if (_deps.isRenderedSpecialPreviewKind(previewKind)) {
      container.appendChild(previewEl);
      var previewPage = container.getAttribute('data-preview-page') || '';
      var rendered = await _deps.renderCachedSpecialPreview(previewEl, boardId, filePath, previewKind, { pageNumber: previewPage, forceRerender: !!enhanceOpts.forceRerender });
      if (!rendered) {
        previewEl.innerHTML = _deps.buildFilePreviewPlaceholderHtml(
          previewKind,
          filePath,
          _deps.buildSpecialPreviewPlaceholderMessage(previewKind, boardId, filePath)
        );
      }
      return;
    }

    previewEl.innerHTML = '<div class="embed-preview-loading">Loading preview...</div>';
    container.appendChild(previewEl);
    try {
      var cached = embedPreviewCache[cacheKey];
      if (!cached) {
        var response = await fetch(_deps.LexeraApi.fileUrl(boardId, fileRef.path));
        if (!response.ok) throw new Error('Failed to load file preview');
        var text = await response.text();
        var previewPath = filePath;
        if (previewKind === 'markdown' && _deps.isBoardRelativePath(filePath)) {
          previewPath = await resolveBoardPath(boardId, filePath, 'absolute');
        }
        cached = renderEmbedPreviewContent(previewKind, boardId, previewPath, text);
        embedPreviewCache[cacheKey] = cached;
      }
      previewEl.innerHTML = cached;
      _deps.applyRenderedHtmlCommentVisibility(previewEl, _deps.getCurrentHtmlCommentRenderMode());
      _deps.applyRenderedTagVisibility(previewEl, _deps.getCurrentTagVisibilityMode());
      _deps.flushPendingDiagramQueues();
    } catch (err) {
      logFrontendIssue(
        'warn',
        'embed.preview',
        'Failed to render embed preview for board ' + boardId + ' path ' + filePath,
        err
      );
      previewEl.innerHTML = '<div class="embed-preview-error">Preview unavailable</div>';
    }
  }

  // --- Logging helpers (delegate to global) ---

  function traceFrontendAction(level, target, message, details) {
    if (typeof window.traceFrontendAction === 'function') {
      window.traceFrontendAction(level, target, message, details);
    }
  }

  function logFrontendIssue(level, target, context, error) {
    if (typeof window.logFrontendIssue === 'function') {
      window.logFrontendIssue(level, target, context, error);
    }
  }

  // --- Cache management ---

  function clearEmbedPreviewCache(boardId, filePath) {
    if (boardId && filePath) {
      var cacheKey = _deps.getEmbedPreviewCacheKey(boardId, filePath);
      delete embedPreviewCache[cacheKey];
    } else {
      embedPreviewCache = {};
    }
  }

  return {
    init: init,
    // External embed URL getters
    getExternalEmbedSourceUrl: getExternalEmbedSourceUrl,
    getExternalEmbedFrameUrl: getExternalEmbedFrameUrl,
    getExternalEmbedProbeUrl: getExternalEmbedProbeUrl,
    // External embed helpers
    normalizeExternalEmbedUrlForCache: normalizeExternalEmbedUrlForCache,
    getExternalEmbedParentOrigin: getExternalEmbedParentOrigin,
    getExternalEmbedPolicyCacheKey: getExternalEmbedPolicyCacheKey,
    clearExternalEmbedPolicyCache: clearExternalEmbedPolicyCache,
    getExternalEmbedPolicyButtonLabel: getExternalEmbedPolicyButtonLabel,
    getExternalEmbedPolicyButtonAction: getExternalEmbedPolicyButtonAction,
    buildExternalEmbedFrameHtml: buildExternalEmbedFrameHtml,
    getExternalEmbedStage: getExternalEmbedStage,
    renderExternalEmbedPrompt: renderExternalEmbedPrompt,
    openExternalEmbedInPlace: openExternalEmbedInPlace,
    requestExternalEmbedPolicy: requestExternalEmbedPolicy,
    // Embed preview
    renderEmbedPreviewContent: renderEmbedPreviewContent,
    clearEmbedPreviewCache: clearEmbedPreviewCache,
    // Path resolution
    resolveBoardPath: resolveBoardPath,
    // Enhance functions
    enhanceEmbeddedContent: enhanceEmbeddedContent,
    enhanceSingleExternalEmbedContainer: enhanceSingleExternalEmbedContainer,
    enhanceSingleFileLink: enhanceSingleFileLink,
    enhanceSingleInlineFileEmbed: enhanceSingleInlineFileEmbed,
    enhanceSingleColumnIncludeBadge: enhanceSingleColumnIncludeBadge,
    enhanceSingleIncludeDirective: enhanceSingleIncludeDirective,
    enhanceSingleEmbedContainer: enhanceSingleEmbedContainer
  };
})();

window.EmbedEnhancer = EmbedEnhancer;
