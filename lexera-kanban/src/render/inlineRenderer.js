var LexeraInlineRenderer = (function () {
  function createInlineRenderers(deps) {
    deps = deps || {};

    var getActiveBoardId = typeof deps.getActiveBoardId === 'function'
      ? deps.getActiveBoardId
      : function () { return deps.activeBoardId || ''; };

    var extractAngleBracketAutolinks = deps.extractAngleBracketAutolinks;
    var stripHtmlComments = deps.stripHtmlComments;
    var escapeHtml = deps.escapeHtml;
    var stashRenderedHtmlToken = deps.stashRenderedHtmlToken;
    var restoreRenderedHtmlTokens = deps.restoreRenderedHtmlTokens;
    var renderIncludeDirectiveHtml = deps.renderIncludeDirectiveHtml;
    var parseMarkdownTarget = deps.parseMarkdownTarget;
    var escapeAttr = deps.escapeAttr;
    var renderBoardFileLinkHtml = deps.renderBoardFileLinkHtml;
    var renderMarkdownLinkHtml = deps.renderMarkdownLinkHtml;
    var buildAngleBracketAutolinkHtml = deps.buildAngleBracketAutolinkHtml;
    var decodeHtmlEntities = deps.decodeHtmlEntities;
    var renderWikiLinkHtml = deps.renderWikiLinkHtml;
    var renderTagChipHtml = deps.renderTagChipHtml;
    var renderTemporalTagHtml = deps.renderTemporalTagHtml;
    var renderEmojiShortcodes = deps.renderEmojiShortcodes;
    var getHtmlContentRenderMode = deps.getHtmlContentRenderMode;
    var parseLocalFileReference = deps.parseLocalFileReference;
    var normalizeMarkdownAttrValue = deps.normalizeMarkdownAttrValue;
    var parseMarkdownImageAttributes = deps.parseMarkdownImageAttributes;
    var getFileExtension = deps.getFileExtension;
    var isExternalHttpUrl = deps.isExternalHttpUrl;
    var getExternalEmbedConfig = deps.getExternalEmbedConfig;
    var getInlineFileEmbedExtension = deps.getInlineFileEmbedExtension;
    var getMediaCategory = deps.getMediaCategory;
    var inferExternalMediaCategoryFromUrl = deps.inferExternalMediaCategoryFromUrl;
    var LexeraApi = deps.LexeraApi;
    var getMarkdownMediaStyleAttr = deps.getMarkdownMediaStyleAttr;
    var getEmbedPreviewKind = deps.getEmbedPreviewKind;
    var renderInlineFileEmbedHtml = deps.renderInlineFileEmbedHtml;
    var getFileEmbedChipHtml = deps.getFileEmbedChipHtml;
    var getDisplayFileNameFromPath = deps.getDisplayFileNameFromPath;
    var isRenderedSpecialPreviewKind = deps.isRenderedSpecialPreviewKind;
    var applyAbbreviationsToHtml = deps.applyAbbreviationsToHtml;
    var sanitizeCssLength = deps.sanitizeCssLength;
    var peekFileInfoSync = typeof deps.peekFileInfoSync === 'function' ? deps.peekFileInfoSync : null;
    var requestFileInfo = typeof deps.requestFileInfo === 'function' ? deps.requestFileInfo : null;

    // Ported from _ARCHIVE/src/html/markdown-it-enhanced-strikethrough-browser.js.
    // Produces <span class="strikethrough-container" data-strike-id="...">
    // <del class="strikethrough-content">...</del></span> so the UI can attach
    // a delete button to struck-through text (styling is in app.css).
    function wrapEnhancedStrikethrough(_, content) {
      var id = 'strike-' + Math.random().toString(36).slice(2, 11);
      return '<span class="strikethrough-container" data-strike-id="' + id +
        '"><del class="strikethrough-content">' + content + '</del></span>';
    }

    function renderTitleInline(text, boardId, options) {
      boardId = boardId || getActiveBoardId() || '';
      options = options || {};
      var allowIncludeDirectives = !!options.allowIncludeDirectives;
      var htmlTokens = [];
      var autolinkData = extractAngleBracketAutolinks(stripHtmlComments(text));
      var safe = escapeHtml(autolinkData.text);
      var titleIncludeIndex = 0;
      var titleLinkIndex = 0;
      safe = safe.replace(/!\[[^\]]*\]\([^)]+\)(\{[^}]+\})?/g, function (match) {
        return stashRenderedHtmlToken(htmlTokens, match);
      });
      if (allowIncludeDirectives) {
        safe = safe.replace(/!!!include\(([^)]+)\)!!!/g, function (_, rawPath) {
          return stashRenderedHtmlToken(htmlTokens, renderIncludeDirectiveHtml(rawPath, boardId, 'include-filename-link', {
            includeIndex: titleIncludeIndex++,
            allowActions: true
          }));
        });
      }
      safe = safe.replace(/\[([^\]]+)\]\(([^)]+)\)/g, function (_, label, rawHref) {
        var parsed = parseMarkdownTarget(rawHref);
        var href = parsed.path;
        var titleText = parsed.title ? parsed.title.replace(/^(&quot;|")|(&quot;|")$/g, '') : '';
        var isExternal = /^https?:\/\//.test(href);
        var isAnchor = href.indexOf('#') === 0;
        var isMailto = href.indexOf('mailto:') === 0;
        var linkIndex = titleLinkIndex++;
        if (!isExternal && !isAnchor && !isMailto && href) {
          return stashRenderedHtmlToken(htmlTokens, renderBoardFileLinkHtml(href, boardId, label, titleText, '', {
            withMenu: true,
            linkIndex: linkIndex
          }));
        }
        if ((isExternal || isAnchor || isMailto) && href && renderMarkdownLinkHtml) {
          return stashRenderedHtmlToken(htmlTokens, renderMarkdownLinkHtml(href, boardId, label, titleText, '', {
            withMenu: true,
            linkIndex: linkIndex,
            editable: true
          }));
        }
        var titleAttr = titleText ? ' title="' + escapeAttr(titleText) + '"' : '';
        var safeHref = escapeAttr(href);
        var targetAttr = isExternal ? ' target="_blank" rel="noopener noreferrer"' : '';
        return stashRenderedHtmlToken(htmlTokens, '<a href="' + safeHref + '"' + titleAttr + targetAttr + '>' + label + '</a>');
      });
      safe = safe.replace(/@@AUTOLINKTOKEN(\d+)@@/g, function (_, index) {
        var href = autolinkData.links[parseInt(index, 10)] || '';
        if (renderMarkdownLinkHtml && href) {
          return stashRenderedHtmlToken(htmlTokens, renderMarkdownLinkHtml(href, boardId, escapeHtml(href), '', '', {
            withMenu: true,
            editable: false
          }));
        }
        return stashRenderedHtmlToken(htmlTokens, buildAngleBracketAutolinkHtml(href));
      });
      safe = safe.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, function (_, rawDocument, rawTitle) {
        var documentName = decodeHtmlEntities(rawDocument).trim();
        var label = rawTitle ? rawTitle.trim() : rawDocument.trim();
        return stashRenderedHtmlToken(htmlTokens, renderWikiLinkHtml(documentName, label, { withMenu: false }));
      });
      safe = safe.replace(/(^|[\s&|!])(#(?![# ])[^\s&|!]+)/g, function (_, pre, tag) {
        return pre + renderTagChipHtml(tag);
      });
      safe = safe.replace(/(^|\s)([!@](?:today|tomorrow|yesterday|date\([^)]+\)|days[+-]\d+|\d{4}[-.]?(?:w|kw)\d{1,2}|(?:w|kw)\d{1,2}|mon|monday|tue|tuesday|wed|wednesday|thu|thursday|fri|friday|sat|saturday|sun|sunday|:\d{1,2}-:\d{1,2}|\d{1,2}(?::\d{2})?(?:am|pm)?-\d{1,2}(?::\d{2})?(?:am|pm)?|\d{1,4}[./-]\d{1,2}(?:[./-]\d{2,4})?|\d{1,2}(?::\d{2})?(?:am|pm)?))/gi, function (_, pre, tag) {
        return pre + renderTemporalTagHtml(tag);
      });
      safe = safe.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      safe = safe.replace(/\*([^*]+)\*/g, '<em>$1</em>');
      safe = safe.replace(/~~([^~]+)~~/g, wrapEnhancedStrikethrough);
      safe = safe.replace(/==([^=]+)==/g, '<mark>$1</mark>');
      safe = safe.replace(/\+\+([^+]+)\+\+/g, '<ins>$1</ins>');
      safe = safe.replace(/(^|[^\w])_([^_\n]+)_/g, function (_, pre, value) {
        return pre + '<u>' + value + '</u>';
      });
      safe = safe.replace(/(^|[^~])~([^~]+)~(?=[^~]|$)/g, function (_, pre, value) {
        return pre + '<sub>' + value + '</sub>';
      });
      safe = safe.replace(/(^|[^^])\^([^^]+)\^(?=[^^]|$)/g, function (_, pre, value) {
        return pre + '<sup>' + value + '</sup>';
      });
      safe = safe.replace(/`([^`]+)`/g, '<code>$1</code>');
      safe = renderEmojiShortcodes(safe);
      return restoreRenderedHtmlTokens(safe, htmlTokens);
    }

    function renderInline(text, boardId, renderState) {
      renderState = renderState || {};
      if (typeof renderState.embedCounter !== 'number') renderState.embedCounter = 0;
      if (typeof renderState.includeCounter !== 'number') renderState.includeCounter = 0;
      var source = text || '';
      var htmlTokens = [];
      var autolinkData = extractAngleBracketAutolinks(source);
      source = autolinkData.text;
      if (getHtmlContentRenderMode() === 'html') {
        source = source.replace(/<[^>]+>/g, function (match) {
          return stashRenderedHtmlToken(htmlTokens, match);
        });
      }
      var safe = escapeHtml(source);

      safe = safe.replace(/!\[([^\]]*)\]\(([^)]+)\)(\{[^}]+\})?/g, function (_, alt, rawSrc, rawAttrs) {
        var parsedTarget = parseMarkdownTarget(rawSrc);
        var filePath = parsedTarget.path;
        var fileRef = parseLocalFileReference(filePath);
        var titleText = decodeHtmlEntities(normalizeMarkdownAttrValue(parsedTarget.title));
        var imageAttrs = parseMarkdownImageAttributes(rawAttrs);
        var ext = getFileExtension(fileRef.path);
        var isExternalHttp = isExternalHttpUrl(filePath);
        var isExternal = isExternalHttp || filePath.indexOf('data:') === 0;
        var externalEmbedConfig = isExternalHttp ? getExternalEmbedConfig(filePath, imageAttrs) : null;
        var inlineFileExtension = !isExternal ? getInlineFileEmbedExtension(fileRef.path) : '';
        var category = getMediaCategory(ext);
        if (category === 'unknown' && isExternalHttp) {
          category = inferExternalMediaCategoryFromUrl(filePath) || category;
        }

        if (externalEmbedConfig) {
          var embedWidth = sanitizeCssLength(imageAttrs.values.width) || '100%';
          var embedHeight = sanitizeCssLength(imageAttrs.values.height) || '500px';
          var externalCaptionHtml = titleText ? '<figcaption class="media-caption external-embed-caption">' + renderInline(titleText, boardId, renderState) + '</figcaption>' : '';
          var externalEmbedHtml = '<span class="external-embed-container" data-embed-url="' + escapeAttr(externalEmbedConfig.sourceUrl) + '"' +
            ' data-embed-frame-url="' + escapeAttr(externalEmbedConfig.frameUrl) + '"' +
            ' data-embed-probe-url="' + escapeAttr(externalEmbedConfig.probeUrl) + '"' +
            ' data-embed-index="' + escapeAttr(String(renderState.embedCounter++)) + '"' +
            ' data-alt-text="' + escapeAttr(decodeHtmlEntities(alt || titleText || '')) + '"' +
            ' data-embed-caption="' + escapeAttr(titleText || '') + '"' +
            ' data-embed-title="' + escapeAttr(decodeHtmlEntities(alt || titleText || externalEmbedConfig.sourceUrl)) + '"' +
            ' data-embed-width="' + escapeAttr(embedWidth) + '"' +
            ' data-embed-height="' + escapeAttr(embedHeight) + '"' +
            ' style="' + escapeAttr('position:relative;display:block;max-width:100%') + '">' +
            '<span class="external-embed-stage">' +
              '<div class="external-embed-shell external-embed-shell-loading">' +
                '<div class="external-embed-label">External page</div>' +
                '<div class="external-embed-heading">' + escapeHtml(decodeHtmlEntities(alt || titleText || externalEmbedConfig.sourceUrl)) + '</div>' +
                '<div class="external-embed-url">' + escapeHtml(externalEmbedConfig.sourceUrl) + '</div>' +
                '<div class="external-embed-message">Checking whether this page can be embedded…</div>' +
              '</div>' +
            '</span>' +
            '<button class="embed-menu-btn" title="Embed actions" style="opacity:1">&#8942;</button>' +
            '</span>';
          if (externalCaptionHtml) {
            return stashRenderedHtmlToken(htmlTokens, '<figure class="media-figure">' + externalEmbedHtml + externalCaptionHtml + '</figure>');
          }
          return stashRenderedHtmlToken(htmlTokens, externalEmbedHtml);
        }

        if (inlineFileExtension && boardId) {
          return stashRenderedHtmlToken(htmlTokens, renderInlineFileEmbedHtml(
            filePath,
            boardId,
            alt || '',
            titleText || '',
            inlineFileExtension,
            renderState.embedCounter++
          ));
        }

        var src = filePath;
        if (!isExternal && boardId) {
          src = LexeraApi.fileUrl(boardId, fileRef.path);
        }

        // Sync cache peek for local files: if the cache already knows
        // the file is missing, bake the `embed-broken` class into the
        // container HTML so we skip loading the media entirely. If the
        // cache is unknown, kick off an async probe so the next render
        // knows. This prevents 404 spam on every render of a card that
        // references a moved/deleted file.
        var preKnownMissing = false;
        if (!isExternal && boardId && peekFileInfoSync) {
          var cached = peekFileInfoSync(boardId, fileRef.path);
          if (cached && cached.exists === false && !cached.external) {
            preKnownMissing = true;
          } else if (cached === undefined && requestFileInfo) {
            // Fire-and-forget: populates the cache for the next render.
            try { requestFileInfo(boardId, fileRef.path); } catch (_) {}
          }
        }

        var mediaStyleAttr = getMarkdownMediaStyleAttr(imageAttrs, { allowHeightOnImages: true });
        var previewKind = getEmbedPreviewKind(filePath);
        var inner = '';
        if (category === 'image') {
          var imageTitleAttr = titleText ? ' title="' + escapeAttr(titleText) + '"' : '';
          inner = '<img data-lazy-src="' + src + '" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" alt="' + alt + '"' + imageTitleAttr + mediaStyleAttr + ' onerror="if(this.getAttribute(\'data-lazy-src\')){return}this.parentElement.classList.add(\'embed-broken\')">';
        } else if (category === 'video') {
          // data-lazy-src defers the network fetch until the element
          // enters the viewport. contentEnhancerRegistry swaps it into
          // `src` and calls .load() at that point, which then honors
          // `preload="metadata"` to fetch just enough to show duration.
          inner = '<video controls preload="metadata" data-lazy-src="' + src + '"' + mediaStyleAttr + ' onerror="this.parentElement.classList.add(\'embed-broken\')"></video>';
        } else if (category === 'audio') {
          inner = '<audio controls preload="metadata" data-lazy-src="' + src + '"' + mediaStyleAttr + ' onerror="this.parentElement.classList.add(\'embed-broken\')"></audio>';
        } else if (isRenderedSpecialPreviewKind(previewKind)) {
          inner = getFileEmbedChipHtml(previewKind, filePath, mediaStyleAttr);
        } else if (category === 'document') {
          inner = '<span class="embed-file-link"' + mediaStyleAttr + '>&#128196; ' + escapeHtml(getDisplayFileNameFromPath(filePath)) + '</span>';
        } else {
          inner = '<span class="embed-file-link"' + mediaStyleAttr + '>&#128206; ' + escapeHtml(getDisplayFileNameFromPath(filePath)) + '</span>';
        }

        var embedIndex = renderState.embedCounter++;
        var previewPageValue = imageAttrs.values.page || imageAttrs.values.sheet || '';
        var previewPageAttr = /^\d+$/.test(String(previewPageValue || ''))
          ? ' data-preview-page="' + escapeAttr(String(Math.max(1, parseInt(previewPageValue, 10)))) + '"'
          : '';
        var containerClass = 'embed-container' + (preKnownMissing ? ' embed-broken' : '');
        var embedHtml = '<span class="' + containerClass + '" data-file-path="' + escapeHtml(filePath) + '" data-board-id="' + (boardId || '') + '" data-media-type="' + category + '" data-embed-index="' + escapeAttr(String(embedIndex)) + '"' +
          ' data-alt-text="' + escapeAttr(decodeHtmlEntities(alt || '')) + '"' +
          ' data-embed-caption="' + escapeAttr(titleText || '') + '"' +
          previewPageAttr + '>' +
          inner +
          '<button class="embed-menu-btn" title="Embed actions">&#8942;</button>' +
          '</span>';
        if (titleText) {
          return stashRenderedHtmlToken(htmlTokens, '<figure class="media-figure">' +
            embedHtml +
            '<figcaption class="media-caption">' + renderInline(titleText, boardId, renderState) + '</figcaption>' +
            '</figure>');
        }
        return stashRenderedHtmlToken(htmlTokens, embedHtml);
      });

      safe = safe.replace(/\[([^\]]+)\]\(([^)]+)\)/g, function (_, label, rawHref) {
        var parsed = parseMarkdownTarget(rawHref);
        var href = parsed.path;
        var titleText = parsed.title ? parsed.title.replace(/^(&quot;|")|(&quot;|")$/g, '') : '';
        var isExternal = /^https?:\/\//.test(href);
        var isAnchor = href.indexOf('#') === 0;
        var isMailto = href.indexOf('mailto:') === 0;
        var linkIndex = renderState.linkCounter || 0;
        renderState.linkCounter = linkIndex + 1;
        if (!isExternal && !isAnchor && !isMailto && href && boardId) {
          return stashRenderedHtmlToken(htmlTokens, renderBoardFileLinkHtml(href, boardId, label, titleText, '', {
            withMenu: true,
            linkIndex: linkIndex
          }));
        }
        if ((isExternal || isAnchor || isMailto) && href && renderMarkdownLinkHtml) {
          return stashRenderedHtmlToken(htmlTokens, renderMarkdownLinkHtml(href, boardId, label, titleText, '', {
            withMenu: true,
            linkIndex: linkIndex,
            editable: true
          }));
        }
        var titleAttr = titleText ? ' title="' + escapeAttr(titleText) + '"' : '';
        var safeHref = escapeAttr(href);
        var targetAttr = isExternal ? ' target="_blank" rel="noopener noreferrer"' : '';
        return stashRenderedHtmlToken(htmlTokens, '<a href="' + safeHref + '"' + titleAttr + targetAttr + '>' + label + '</a>');
      });

      safe = safe.replace(/@@AUTOLINKTOKEN(\d+)@@/g, function (_, index) {
        var href = autolinkData.links[parseInt(index, 10)] || '';
        if (renderMarkdownLinkHtml && href) {
          return stashRenderedHtmlToken(htmlTokens, renderMarkdownLinkHtml(href, boardId, escapeHtml(href), '', '', {
            withMenu: true,
            editable: false
          }));
        }
        return stashRenderedHtmlToken(htmlTokens, buildAngleBracketAutolinkHtml(href));
      });

      safe = safe.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, function (_, rawDocument, rawTitle) {
        var documentName = decodeHtmlEntities(rawDocument).trim();
        var label = rawTitle ? rawTitle.trim() : rawDocument.trim();
        return stashRenderedHtmlToken(htmlTokens, renderWikiLinkHtml(documentName, label, { withMenu: true }));
      });

      safe = safe.replace(/\[\^([^\]]+)\]/g, function (_, footnoteId) {
        var order = renderState.footnoteOrder || [];
        var idx = order.indexOf(footnoteId);
        var number = idx === -1 ? '?' : String(idx + 1);
        return stashRenderedHtmlToken(htmlTokens, '<sup class="footnote-ref"><a href="#footnote-' + escapeAttr(footnoteId) + '">[' + number + ']</a></sup>');
      });

      safe = safe.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      safe = safe.replace(/\*([^*]+)\*/g, '<em>$1</em>');
      safe = safe.replace(/~~([^~]+)~~/g, wrapEnhancedStrikethrough);
      safe = safe.replace(/==([^=]+)==/g, '<mark>$1</mark>');
      safe = safe.replace(/\+\+([^+]+)\+\+/g, '<ins>$1</ins>');
      safe = safe.replace(/(^|[^\w])_([^_\n]+)_/g, function (_, pre, value) {
        return pre + '<u>' + value + '</u>';
      });
      safe = safe.replace(/(^|[^~])~([^~]+)~(?=[^~]|$)/g, function (_, pre, value) {
        return pre + '<sub>' + value + '</sub>';
      });
      safe = safe.replace(/(^|[^^])\^([^^]+)\^(?=[^^]|$)/g, function (_, pre, value) {
        return pre + '<sup>' + value + '</sup>';
      });
      safe = safe.replace(/\{~~([^~]*?)~&gt;([^~]*?)~~\}/g, '<del class="critic critic-sub">$1</del><ins class="critic critic-sub">$2</ins>');
      safe = safe.replace(/\{\+\+([^+]*?)\+\+\}/g, '<ins class="critic critic-add">$1</ins>');
      safe = safe.replace(/\{--([^-]*?)--\}/g, '<del class="critic critic-del">$1</del>');
      safe = safe.replace(/\{&gt;&gt;([^&]*?)&lt;&lt;\}/g, '<span class="critic critic-comment">$1</span>');
      safe = safe.replace(/\{==([^=]*?)==\}/g, '<mark class="critic critic-highlight">$1</mark>');
      safe = safe.replace(/`([^`]+)`/g, '<code>$1</code>');
      safe = safe.replace(/(^|[\s&|!])(#(?![# ])[^\s&|!]+)/g, function (_, pre, tag) {
        return pre + renderTagChipHtml(tag);
      });
      safe = safe.replace(/(^|\s)([!@](?:today|tomorrow|yesterday|date\([^)]+\)|days[+-]\d+|\d{4}[-.]?(?:w|kw)\d{1,2}|(?:w|kw)\d{1,2}|mon|monday|tue|tuesday|wed|wednesday|thu|thursday|fri|friday|sat|saturday|sun|sunday|:\d{1,2}-:\d{1,2}|\d{1,2}(?::\d{2})?(?:am|pm)?-\d{1,2}(?::\d{2})?(?:am|pm)?|\d{1,4}[./-]\d{1,2}(?:[./-]\d{2,4})?|\d{1,2}(?::\d{2})?(?:am|pm)?))/gi, function (_, pre, tag) {
        return pre + renderTemporalTagHtml(tag);
      });

      safe = renderEmojiShortcodes(safe);
      safe = restoreRenderedHtmlTokens(safe, htmlTokens);
      safe = applyAbbreviationsToHtml(safe, renderState.abbrDefs || {});
      return safe;
    }

    return {
      renderTitleInline: renderTitleInline,
      renderInline: renderInline
    };
  }

  return {
    createInlineRenderers: createInlineRenderers
  };
})();
if (typeof window !== 'undefined') window.LexeraInlineRenderer = LexeraInlineRenderer;
