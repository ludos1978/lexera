var CardEditor = (function () {
  'use strict';
  var _deps = {};
  var _rt = typeof window !== 'undefined' && window.LexeraRuntime ? window.LexeraRuntime : null;

  // Module-owned state
  var currentCardEditor = null;
  var cardEditorMode = null;
  var cardEditorFontScale = 1;
  var cardEditorPreviewRefreshTimer = null;
  var CARD_EDITOR_PREVIEW_INPUT_DEBOUNCE_MS = 120;

  function init(deps) {
    if (typeof window !== 'undefined' && window.LexeraRuntime) {
      _rt = window.LexeraRuntime;
      _rt.mergeDeps(_deps, deps);
    } else {
      _deps = deps || {};
    }
  }

  function getCurrentEditorBoardId() {
    if (currentCardEditor && currentCardEditor.boardId) return currentCardEditor.boardId;
    return _deps.getActiveBoardId() || '';
  }

  function getCurrentEditorFilePath() {
    var boardId = getCurrentEditorBoardId();
    return _deps.getBoardFilePathForId(boardId) || _deps.getActiveBoardFilePath() || '';
  }

  function safeDecodePath(value) {
    var text = String(value || '');
    try {
      return decodeURIComponent(text);
    } catch (e) {
      return text;
    }
  }

  function isWindowsAbsolutePath(value) {
    return /^[a-zA-Z]:[\\/]/.test(String(value || ''));
  }

  function normalizeWindowsAbsolutePath(value) {
    return _deps.normalizePathForCompare(String(value || ''));
  }

  function isRelativeResourcePath(value) {
    var normalized = String(value || '').trim();
    if (!normalized) return false;
    return normalized.charAt(0) !== '/' &&
      !isWindowsAbsolutePath(normalized) &&
      !/^(https?:\/\/|mailto:|data:|blob:|vscode-webview:\/\/)/i.test(normalized);
  }

  function resolveRelativePath(baseDir, relativePath) {
    return _deps.joinBoardRelativePath(baseDir, relativePath);
  }

  function buildWebviewResourceUrl(pathValue) {
    var resolvedPath = normalizeWindowsAbsolutePath(safeDecodePath(pathValue));
    if (!resolvedPath || /^(https?:\/\/|mailto:|data:|blob:|vscode-webview:\/\/)/i.test(resolvedPath)) {
      return resolvedPath;
    }
    var boardId = getCurrentEditorBoardId();
    if (!boardId) return resolvedPath;
    return _deps.LexeraApi.fileUrl(boardId, resolvedPath);
  }

  function resolveCurrentEditorResourcePath(pathValue, includeDir) {
    var decodedPath = safeDecodePath(pathValue);
    if (!decodedPath) return '';
    if (!isRelativeResourcePath(decodedPath)) {
      return normalizeWindowsAbsolutePath(decodedPath);
    }
    if (includeDir) {
      return resolveRelativePath(safeDecodePath(includeDir), decodedPath);
    }
    var boardDir = _deps.getDirNameFromPath(getCurrentEditorFilePath());
    if (!boardDir) return decodedPath;
    return resolveRelativePath(boardDir, decodedPath);
  }

  function syncCardEditorWysiwygContext(editor) {
    var boardId = editor && editor.boardId ? editor.boardId : (_deps.getActiveBoardId() || '');
    var boardFilePath = _deps.getBoardFilePathForId(boardId) || _deps.getActiveBoardFilePath() || '';
    var includeDir = '';
    var col = editor && editor.colIndex != null ? _deps.getFullColumn(editor.colIndex) : null;
    if (col && col.includeSource && col.includeSource.rawPath) {
      var boardDir = _deps.getDirNameFromPath(boardFilePath);
      includeDir = _deps.getDirNameFromPath(_deps.joinBoardRelativePath(boardDir, col.includeSource.rawPath));
    } else {
      includeDir = _deps.getDirNameFromPath(boardFilePath);
    }
    window.currentTaskIncludeContext = includeDir ? { includeDir: includeDir } : null;
    window.currentFilePath = boardFilePath || '';
  }

  function setCurrentCardEditorMarkdown(nextValue, options) {
    options = options || {};
    if (!currentCardEditor) return;
    var normalizedValue = String(nextValue || '');
    if (currentCardEditor.textarea) currentCardEditor.textarea.value = normalizedValue;
    if (
      currentCardEditor.wysiwyg &&
      !options.skipWysiwygSync &&
      typeof currentCardEditor.wysiwyg.setMarkdown === 'function'
    ) {
      currentCardEditor.suppressWysiwygChange = true;
      try {
        currentCardEditor.wysiwyg.setMarkdown(normalizedValue);
      } finally {
        currentCardEditor.suppressWysiwygChange = false;
      }
    }
    if (!options.skipPreviewRefresh) refreshCardEditorPreview();
  }

  function clearScheduledCardEditorPreviewRefresh() {
    if (cardEditorPreviewRefreshTimer) {
      clearTimeout(cardEditorPreviewRefreshTimer);
      cardEditorPreviewRefreshTimer = null;
    }
  }

  function shouldRenderCardEditorPreview(mode) {
    mode = normalizeCardEditorMode(mode || (currentCardEditor ? currentCardEditor.mode : ''));
    return mode === 'dual' || mode === 'preview';
  }

  function updateCardEditorTitle(value, resolvedContent, options) {
    options = options || {};
    if (!currentCardEditor || !currentCardEditor.dialog) return;
    var titleEl = currentCardEditor.dialog.querySelector('.card-editor-title-text');
    if (!titleEl) return;
    var titleSource;
    if (typeof resolvedContent === 'string') {
      titleSource = resolvedContent;
    } else if (options.preferRaw) {
      titleSource = String(value || '');
    } else {
      titleSource = _deps.getIncludeResolvedContent(String(value || ''), currentCardEditor.colIndex);
    }
    titleEl.textContent = _deps.getCardTitle(_deps.stripInternalHiddenTags(titleSource)).trim() || 'Untitled';
  }

  function scheduleCardEditorPreviewRefresh(options) {
    options = options || {};
    if (!currentCardEditor) return;
    var value = currentCardEditor.textarea ? currentCardEditor.textarea.value : '';
    updateCardEditorTitle(value, null, { preferRaw: true });
    if (!shouldRenderCardEditorPreview()) {
      clearScheduledCardEditorPreviewRefresh();
      return;
    }
    clearScheduledCardEditorPreviewRefresh();
    if (options.immediate) {
      refreshCardEditorPreview({ forceRender: true });
      return;
    }
    cardEditorPreviewRefreshTimer = setTimeout(function () {
      cardEditorPreviewRefreshTimer = null;
      if (!currentCardEditor) return;
      refreshCardEditorPreview({ forceRender: true });
    }, CARD_EDITOR_PREVIEW_INPUT_DEBOUNCE_MS);
  }

  function updateCardEditorWysiwygToolbar(selectionState) {
    if (!currentCardEditor || !currentCardEditor.dialog) return;
    var markMap = {
      bold: 'strong',
      italic: 'em',
      underline: 'underline',
      strike: 'strike',
      mark: 'mark',
      sub: 'sub',
      sup: 'sup',
      code: 'code',
      ins: 'ins'
    };
    var marks = selectionState && selectionState.marks ? selectionState.marks : [];
    var block = selectionState && selectionState.block ? selectionState.block : '';
    var buttons = currentCardEditor.dialog.querySelectorAll('[data-card-editor-fmt]');
    for (var i = 0; i < buttons.length; i++) {
      var fmt = buttons[i].getAttribute('data-card-editor-fmt') || '';
      var isActive = false;
      if (fmt === 'code-block') {
        isActive = block === 'code_block';
      } else if (fmt === 'columns') {
        isActive = block === 'multicolumn_column';
      } else if (markMap[fmt]) {
        isActive = marks.indexOf(markMap[fmt]) !== -1;
      }
      buttons[i].classList.toggle('active', isActive);
      buttons[i].setAttribute('aria-pressed', isActive ? 'true' : 'false');
    }
  }

  function applyCardEditorFontScale(scale, persist) {
    var normalizedScale = normalizeCardEditorFontScale(scale);
    cardEditorFontScale = normalizedScale;
    if (!currentCardEditor || !currentCardEditor.dialog) {
      if (persist !== false) localStorage.setItem('lexera-card-editor-font-scale', String(normalizedScale));
      return;
    }
    currentCardEditor.fontScale = normalizedScale;
    currentCardEditor.dialog.style.setProperty('--task-overlay-font-scale', String(normalizedScale));
    if (currentCardEditor.textarea) currentCardEditor.textarea.style.fontSize = 'calc(14px * ' + normalizedScale + ')';
    if (currentCardEditor.preview) currentCardEditor.preview.style.fontSize = 'calc(14px * ' + normalizedScale + ')';
    if (currentCardEditor.wysiwygWrap) currentCardEditor.wysiwygWrap.style.fontSize = 'calc(1em * ' + normalizedScale + ')';
    if (persist !== false) localStorage.setItem('lexera-card-editor-font-scale', String(normalizedScale));
  }

  function openCardEditorFontScaleMenu(anchorEl) {
    if (!anchorEl || !currentCardEditor) return;
    var rect = anchorEl.getBoundingClientRect();
    var items = [
      { id: 'font-1.0', label: 'Text 100%' },
      { id: 'font-1.2', label: 'Text 120%' },
      { id: 'font-1.4', label: 'Text 140%' }
    ];
    _deps.showNativeMenu(items, rect.right, rect.bottom).then(function (action) {
      if (!action) return;
      var nextScale = action === 'font-1.4' ? 1.4 : (action === 'font-1.2' ? 1.2 : 1);
      applyCardEditorFontScale(nextScale, true);
    });
  }

  // ── File search dialog for card editor ──────────────────────────────
  function openFileSearchDialog(textarea) {
    if (!textarea) return;
    var overlay = document.createElement('div');
    overlay.className = 'dialog-overlay file-search-overlay';
    var dialog = document.createElement('div');
    dialog.className = 'dialog file-search-dialog';
    dialog.innerHTML =
      '<div class="file-search-header">' +
        '<div class="file-search-title">Search Files</div>' +
        '<div class="file-search-categories" role="group">' +
          '<button class="board-action-btn file-search-cat active" type="button" data-cat="">All</button>' +
          '<button class="board-action-btn file-search-cat" type="button" data-cat="image">Images</button>' +
          '<button class="board-action-btn file-search-cat" type="button" data-cat="document">Docs</button>' +
          '<button class="board-action-btn file-search-cat" type="button" data-cat="video">Video</button>' +
          '<button class="board-action-btn file-search-cat" type="button" data-cat="audio">Audio</button>' +
        '</div>' +
        '<button class="btn-small btn-cancel file-search-close" type="button">Close</button>' +
      '</div>' +
      '<input class="file-search-input" type="text" placeholder="Type to search files..." spellcheck="false" />' +
      '<div class="file-search-results"></div>';
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    var input = dialog.querySelector('.file-search-input');
    var resultsEl = dialog.querySelector('.file-search-results');
    var activeCategory = '';
    var searchTimer = null;
    var LexeraApi = _deps.LexeraApi;
    var activeBoardId = _deps.getActiveBoardId();

    function closeDialog() {
      if (searchTimer) clearTimeout(searchTimer);
      overlay.remove();
      textarea.focus();
    }

    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closeDialog();
    });
    dialog.querySelector('.file-search-close').addEventListener('click', closeDialog);
    dialog.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.stopPropagation(); closeDialog(); }
    });

    // Category filter buttons
    dialog.addEventListener('click', function (e) {
      var catBtn = e.target.closest('[data-cat]');
      if (!catBtn) return;
      activeCategory = catBtn.getAttribute('data-cat');
      dialog.querySelectorAll('.file-search-cat').forEach(function (b) {
        b.classList.toggle('active', b.getAttribute('data-cat') === activeCategory);
      });
      doSearch();
    });

    function doSearch() {
      var q = input.value.trim();
      if (q.length < 2) {
        resultsEl.innerHTML = '<div class="file-search-hint">Type at least 2 characters to search</div>';
        return;
      }
      resultsEl.innerHTML = '<div class="file-search-hint">Searching...</div>';
      var body = { query: q };
      if (activeCategory) body.category = activeCategory;
      LexeraApi.request('/search/files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).then(function (data) {
        var results = data && data.results ? data.results : [];
        if (results.length === 0) {
          resultsEl.innerHTML = '<div class="file-search-hint">No files found</div>';
          return;
        }
        var html = '';
        for (var i = 0; i < results.length; i++) {
          var r = results[i];
          var catClass = 'badge-' + (r.category || 'unknown');
          html += '<div class="file-search-item" data-index="' + i + '">' +
            '<span class="file-search-badge ' + catClass + '">' + _deps.escapeHtml(r.category || '?') + '</span>' +
            '<span class="file-search-filename">' + _deps.escapeHtml(r.filename) + '</span>' +
            '<span class="file-search-board">' + _deps.escapeHtml(r.boardName) + '</span>' +
            '<span class="file-search-path">' + _deps.escapeHtml(r.path) + '</span>' +
          '</div>';
        }
        resultsEl.innerHTML = html;
        resultsEl._results = results;
      }).catch(function () {
        resultsEl.innerHTML = '<div class="file-search-hint">Search failed</div>';
      });
    }

    // Click result to insert
    resultsEl.addEventListener('click', function (e) {
      var item = e.target.closest('.file-search-item');
      if (!item || !resultsEl._results) return;
      var idx = parseInt(item.getAttribute('data-index'), 10);
      var r = resultsEl._results[idx];
      if (!r) return;
      var embed = '';
      if (r.category === 'image') {
        embed = '![' + r.filename + '](' + r.path + ')';
      } else {
        embed = '[' + r.filename + '](' + r.path + ')';
      }
      // If the result is from a different board, use the file API URL
      if (r.boardId && activeBoardId && r.boardId !== activeBoardId) {
        var url = LexeraApi.fileUrl(r.boardId, r.path);
        if (r.category === 'image') {
          embed = '![' + r.filename + '](' + url + ')';
        } else {
          embed = '[' + r.filename + '](' + url + ')';
        }
      }
      insertAtCursor(textarea, embed);
      closeDialog();
      textarea.dispatchEvent(new Event('input'));
    });

    input.addEventListener('input', function () {
      if (searchTimer) clearTimeout(searchTimer);
      searchTimer = setTimeout(doSearch, 300);
    });

    input.focus();
  }

  function insertAtCursor(textarea, text) {
    var start = textarea.selectionStart;
    var end = textarea.selectionEnd;
    var before = textarea.value.substring(0, start);
    var after = textarea.value.substring(end);
    textarea.value = before + text + after;
    textarea.selectionStart = textarea.selectionEnd = start + text.length;
  }

  function syncCardEditorTextareaFromWysiwyg() {
    if (
      !currentCardEditor ||
      !currentCardEditor.wysiwyg ||
      typeof currentCardEditor.wysiwyg.getMarkdown !== 'function'
    ) {
      return;
    }
    if (currentCardEditor.textarea) {
      currentCardEditor.textarea.value = currentCardEditor.wysiwyg.getMarkdown() || '';
    }
  }

  function destroyCardEditorWysiwyg(editor) {
    if (!editor || !editor.wysiwyg) return;
    try {
      if (typeof editor.wysiwyg.destroy === 'function') editor.wysiwyg.destroy();
    } catch (err) {
      _deps.lexeraLog('warn', '[card-editor] Failed to destroy WYSIWYG editor: ' + err);
    }
    editor.wysiwyg = null;
    if (editor.wysiwygWrap) editor.wysiwygWrap.innerHTML = '';
  }

  function ensureCardEditorWysiwyg() {
    if (
      !currentCardEditor ||
      !currentCardEditor.wysiwygWrap ||
      typeof window.WysiwygEditor !== 'function'
    ) {
      return null;
    }
    syncCardEditorWysiwygContext(currentCardEditor);
    if (!currentCardEditor.wysiwyg) {
      currentCardEditor.wysiwygWrap.innerHTML = '';
      currentCardEditor.wysiwyg = new window.WysiwygEditor(currentCardEditor.wysiwygWrap, {
        markdown: currentCardEditor.textarea ? currentCardEditor.textarea.value : '',
        temporalPrefix: '!',
        onChange: function (markdown) {
          if (!currentCardEditor || currentCardEditor.suppressWysiwygChange) return;
          if (currentCardEditor.textarea) currentCardEditor.textarea.value = markdown || '';
          scheduleCardEditorPreviewRefresh();
          _deps.queueCardDraftLiveSync(currentCardEditor.colIndex, currentCardEditor.fullCardIdx, markdown || '');
        },
        onSelectionChange: function (selectionState) {
          updateCardEditorWysiwygToolbar(selectionState);
        },
        onSubmit: function () {
          closeCardEditorOverlay({ save: true });
        }
      });
      return currentCardEditor.wysiwyg;
    }
    if (
      currentCardEditor.textarea &&
      typeof currentCardEditor.wysiwyg.getMarkdown === 'function' &&
      currentCardEditor.wysiwyg.getMarkdown() !== currentCardEditor.textarea.value
    ) {
      currentCardEditor.suppressWysiwygChange = true;
      try {
        currentCardEditor.wysiwyg.setMarkdown(currentCardEditor.textarea.value);
      } finally {
        currentCardEditor.suppressWysiwygChange = false;
      }
    }
    return currentCardEditor.wysiwyg;
  }

  function applyCardEditorFormatting(textarea, fmt) {
    if (!currentCardEditor || !fmt) return;
    if (currentCardEditor.mode === 'wysiwyg') {
      var editor = ensureCardEditorWysiwyg();
      if (editor) {
        var command = fmt;
        if (fmt === 'columns') command = 'multicolumn';
        if (fmt === 'code-block' || fmt === 'link' || fmt === 'bold' || fmt === 'italic' ||
          fmt === 'underline' || fmt === 'strike' || fmt === 'mark' || fmt === 'sub' ||
          fmt === 'sup' || fmt === 'code' || fmt === 'ins') {
          if (editor.applyCommand(command)) {
            return;
          }
        }
        var wysiwygFormatSpec = getCardEditorFormatSpec(fmt);
        if (wysiwygFormatSpec) {
          var snippet = '';
          if (wysiwygFormatSpec.snippet != null) snippet = wysiwygFormatSpec.snippet;
          else if (wysiwygFormatSpec.wrap) snippet = wysiwygFormatSpec.wrap + 'text' + wysiwygFormatSpec.wrap;
          else snippet = wysiwygFormatSpec.prefix + 'text' + wysiwygFormatSpec.suffix;
          editor.insertText(snippet);
        }
        return;
      }
    }
    var formatSpec = getCardEditorFormatSpec(fmt);
    if (formatSpec) {
      insertFormatting(textarea, formatSpec);
      textarea.focus();
    }
  }

  function getEmbedOccurrenceRoot(container) {
    if (!container) return null;
    if (
      currentCardEditor &&
      currentCardEditor.wysiwygWrap &&
      currentCardEditor.wysiwygWrap.contains(container)
    ) {
      return currentCardEditor.wysiwygWrap;
    }
    if (
      currentCardEditor &&
      currentCardEditor.preview &&
      currentCardEditor.preview.contains(container)
    ) {
      return currentCardEditor.preview;
    }
    var cardEl = container.closest('.card[data-card-id]');
    if (cardEl) return cardEl;
    return container.closest('.board-header, .board-row, .board-stack, .column') || container.parentElement || null;
  }

  function getRenderedEmbedAbsoluteIndex(container) {
    if (!container) return 0;
    var explicitIndex = parseInt(container.getAttribute('data-embed-index') || '', 10);
    if (isFinite(explicitIndex) && explicitIndex >= 0) return explicitIndex;
    var root = getEmbedOccurrenceRoot(container);
    if (!root) return 0;
    var selector = [
      '.embed-container[data-file-path]',
      '.external-embed-container[data-embed-url]',
      '.inline-file-embed-container[data-file-path]',
      '.image-path-overlay-container[data-file-path]',
      '.video-path-overlay-container[data-file-path]',
      '.wysiwyg-media[data-file-path]',
      '.wysiwyg-media-block[data-file-path]'
    ].join(', ');
    var nodes = root.querySelectorAll(selector);
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i] === container) return i;
    }
    return 0;
  }

  function replaceCurrentEmbedOccurrence(content, container, replacer) {
    return _deps.replaceNthMarkdownEmbed(
      content,
      getRenderedEmbedAbsoluteIndex(container),
      replacer
    );
  }

  function replaceNthIncludeDirective(content, targetIndex, replacer) {
    var matchIndex = 0;
    return String(content || '').replace(/!!!include\(([^)]+)\)!!!/g, function (match, rawPath) {
      var currentIndex = matchIndex++;
      if (currentIndex !== targetIndex) return match;
      return replacer({
        match: match,
        path: String(rawPath || '').trim()
      });
    });
  }

  function normalizeCardEditorMode(mode) {
    if (mode === 'markdown' || mode === 'preview') return mode;
    if (mode === 'wysiwyg' && _deps.isWysiwygEditorEnabled() && typeof window.WysiwygEditor === 'function') return mode;
    return 'dual';
  }

  function normalizeCardEditorFontScale(value) {
    var parsed = parseFloat(value);
    if (Math.abs(parsed - 1.4) < 0.01) return 1.4;
    if (Math.abs(parsed - 1.2) < 0.01) return 1.2;
    return 1;
  }

  function getCardEditorFormatSpec(fmt) {
    if (fmt === 'bold') return { wrap: '**' };
    if (fmt === 'italic') return { wrap: '*' };
    if (fmt === 'underline') return { wrap: '_' };
    if (fmt === 'strike') return { wrap: '~~' };
    if (fmt === 'mark') return { wrap: '==' };
    if (fmt === 'ins') return { wrap: '++' };
    if (fmt === 'sub') return { wrap: '~' };
    if (fmt === 'sup') return { wrap: '^' };
    if (fmt === 'code') return { wrap: '`' };
    if (fmt === 'link') return { prefix: '[', suffix: '](url)' };
    if (fmt === 'image') return { snippet: '![alt](path)' };
    if (fmt === 'heading') return { prefix: '## ', suffix: '' };
    if (fmt === 'quote') return { prefix: '> ', suffix: '' };
    if (fmt === 'bullet-list') return { prefix: '- ', suffix: '' };
    if (fmt === 'numbered-list') return { prefix: '1. ', suffix: '' };
    if (fmt === 'task') return { prefix: '- [ ] ', suffix: '' };
    if (fmt === 'include') return { snippet: '!!!include(path)!!!' };
    if (fmt === 'wiki') return { snippet: '[[Page]]' };
    if (fmt === 'footnote') return { snippet: 'Reference[^1]\n\n[^1]: Footnote text' };
    if (fmt === 'code-block') return { snippet: '```\ncode\n```' };
    if (fmt === 'mermaid') return { snippet: '```mermaid\ngraph TD\n  A[Start] --> B[End]\n```' };
    if (fmt === 'plantuml') return { snippet: '```plantuml\n@startuml\nAlice -> Bob: hello\n@enduml\n```' };
    if (fmt === 'columns') return { snippet: '---:\n\n:--:\n\n:---' };
    if (fmt === 'note') return { snippet: '::: note\n\n:::\n' };
    if (fmt === 'container-comment') return { snippet: '::: comment\n\n:::\n' };
    if (fmt === 'container-highlight') return { snippet: '::: highlight\n\n:::\n' };
    if (fmt === 'container-mark-red') return { snippet: '::: mark-red\n\n:::\n' };
    if (fmt === 'container-mark-green') return { snippet: '::: mark-green\n\n:::\n' };
    if (fmt === 'container-mark-blue') return { snippet: '::: mark-blue\n\n:::\n' };
    if (fmt === 'container-mark-cyan') return { snippet: '::: mark-cyan\n\n:::\n' };
    if (fmt === 'container-mark-magenta') return { snippet: '::: mark-magenta\n\n:::\n' };
    if (fmt === 'container-mark-yellow') return { snippet: '::: mark-yellow\n\n:::\n' };
    if (fmt === 'container-center') return { snippet: '::: center\n\n:::\n' };
    if (fmt === 'container-center100') return { snippet: '::: center100\n\n:::\n' };
    if (fmt === 'container-right') return { snippet: '::: right\n\n:::\n' };
    if (fmt === 'container-caption') return { snippet: '::: caption\n\n:::\n' };
    if (fmt === 'emoji') return { snippet: ':smile:' };
    return null;
  }

  function buildCardEditorSnippetSelectHtml() {
    return '' +
      '<select class="dialog-input card-editor-snippet-select" data-card-editor-snippet="snippet" title="Insert snippet">' +
        '<option value="">Insert...</option>' +
        '<option value="quote">Quote</option>' +
        '<option value="bullet-list">Bullet list</option>' +
        '<option value="numbered-list">Numbered list</option>' +
        '<option value="columns">Multicolumn ---: :--: :---</option>' +
        '<option value="mermaid">Mermaid diagram</option>' +
        '<option value="plantuml">PlantUML diagram</option>' +
        '<option value="note">Container: note</option>' +
        '<option value="container-comment">Container: comment</option>' +
        '<option value="container-highlight">Container: highlight</option>' +
        '<option value="container-mark-red">Container: mark-red</option>' +
        '<option value="container-mark-green">Container: mark-green</option>' +
        '<option value="container-mark-blue">Container: mark-blue</option>' +
        '<option value="container-mark-cyan">Container: mark-cyan</option>' +
        '<option value="container-mark-magenta">Container: mark-magenta</option>' +
        '<option value="container-mark-yellow">Container: mark-yellow</option>' +
        '<option value="container-center">Container: center</option>' +
        '<option value="container-center100">Container: center100</option>' +
        '<option value="container-right">Container: right</option>' +
        '<option value="container-caption">Container: caption</option>' +
        '<option value="footnote">Footnote</option>' +
        '<option value="emoji">Emoji</option>' +
      '</select>';
  }

  function updateCheckboxLineInText(text, lineIndex, checked) {
    var lines = String(text || '').split('\n');
    if (lineIndex < 0 || lineIndex >= lines.length) return String(text || '');
    if (checked) {
      lines[lineIndex] = lines[lineIndex].replace(/\[([ ])\]/, '[x]');
    } else {
      lines[lineIndex] = lines[lineIndex].replace(/\[([xX])\]/, '[ ]');
    }
    return lines.join('\n');
  }

  function renderCardDisplayState(cardEl, content) {
    if (!cardEl) return;
    var colIndex = parseInt(cardEl.getAttribute('data-col-index') || '-1', 10);
    var resolved = _deps.getIncludeResolvedContent(content, colIndex);
    var activeBoardId = _deps.getActiveBoardId();
    var titleEl = cardEl.querySelector('.card-title-display');
    if (titleEl) titleEl.innerHTML = _deps.renderTitleInline(_deps.getCardTitle(resolved), activeBoardId);
    var contentEl = cardEl.querySelector('.card-content');
    if (contentEl) {
      contentEl.innerHTML = _deps.renderCardContent(resolved, activeBoardId, null, { skipFirstLineTagStyle: true });
      _deps.enhanceEmbeddedContent(contentEl);
      _deps.applyRenderedHtmlCommentVisibility(contentEl, _deps.getCurrentHtmlCommentRenderMode());
      _deps.applyRenderedTagVisibility(contentEl, _deps.getCurrentTagVisibilityMode());
    }
    _deps.attachRenderedTagInteractions(cardEl);
  }

  function findVisibleCardElement(colIndex, cardIndex) {
    return _deps.getElColumnsContainer().querySelector('.card[data-col-index="' + colIndex + '"][data-card-index="' + cardIndex + '"]');
  }

  function openCardEditor(cardEl, colIndex, cardIndex, mode) {
    cardEl = findVisibleCardElement(colIndex, cardIndex) || cardEl;
    if (mode === 'overlay' && !_deps.isOverlayEditorEnabled()) mode = 'inline';
    var targetCol = _deps.getFullColumn(colIndex);
    var targetFullIdx = targetCol ? _deps.getFullCardIndex(targetCol, cardIndex) : -1;
    var inlineEditor = _deps.getInlineCardEditor();
    if (inlineEditor) {
      var sameInlineCard = inlineEditor.cardEl === cardEl &&
        inlineEditor.colIndex === colIndex &&
        inlineEditor.fullCardIdx === targetFullIdx;
      if (sameInlineCard && mode !== 'overlay') {
        if (inlineEditor.textarea) inlineEditor.textarea.focus();
        return;
      }
      _deps.closeInlineCardEditor({ save: true }).then(function () {
        openCardEditor(cardEl, colIndex, cardIndex, mode);
      });
      return;
    }
    if (currentCardEditor) {
      var sameOverlayCard = currentCardEditor.cardEl === cardEl &&
        currentCardEditor.colIndex === colIndex &&
        currentCardEditor.fullCardIdx === targetFullIdx;
      if (sameOverlayCard && mode === 'overlay') {
        if (currentCardEditor.textarea) currentCardEditor.textarea.focus();
        return;
      }
      closeCardEditorOverlay({ save: true }).then(function () {
        openCardEditor(cardEl, colIndex, cardIndex, mode);
      });
      return;
    }
    if (mode === 'overlay') {
      enterCardEditMode(cardEl, colIndex, cardIndex);
      return;
    }
    _deps.enterInlineCardEditMode(cardEl, colIndex, cardIndex);
  }

  function applyCardEditorMode(mode) {
    if (!currentCardEditor || !currentCardEditor.dialog) return;
    mode = normalizeCardEditorMode(mode);
    if (currentCardEditor.mode === 'wysiwyg' && mode !== 'wysiwyg') {
      syncCardEditorTextareaFromWysiwyg();
    }
    currentCardEditor.mode = mode;
    currentCardEditor.dialog.setAttribute('data-editor-mode', mode);
    var buttons = currentCardEditor.dialog.querySelectorAll('[data-card-editor-mode]');
    for (var i = 0; i < buttons.length; i++) {
      var isActive = buttons[i].getAttribute('data-card-editor-mode') === mode;
      buttons[i].classList.toggle('active', isActive);
      buttons[i].setAttribute('aria-pressed', isActive ? 'true' : 'false');
    }
    if (mode === 'wysiwyg') {
      ensureCardEditorWysiwyg();
    } else {
      updateCardEditorWysiwygToolbar(null);
    }
    if (shouldRenderCardEditorPreview(mode)) {
      refreshCardEditorPreview({ forceRender: true });
    } else {
      clearScheduledCardEditorPreviewRefresh();
      refreshCardEditorPreview();
    }
    cardEditorMode = mode;
    localStorage.setItem('lexera-card-editor-mode', mode);
  }

  function enterCardEditMode(cardEl, colIndex, cardIndex) {
    if (currentCardEditor || _deps.getInlineCardEditor()) return;
    var fullBoardData = _deps.getFullBoardData();
    if (!fullBoardData) return;
    var col = _deps.getFullColumn(colIndex);
    if (!col) return;
    var fullIdx = _deps.getFullCardIndex(col, cardIndex);
    var card = col.cards[fullIdx];
    if (!card) return;

    _deps.setIsEditing(true);
    cardEl.classList.add('editing');
    cardEl.classList.add('editing-overlay');
    cardEl.classList.remove('editing-inline');
    cardEl.classList.remove('collapsed');
    var overlay = document.createElement('div');
    overlay.className = 'dialog-overlay card-editor-overlay';
    var dialog = document.createElement('div');
    dialog.className = 'dialog card-editor-dialog';
    var allowWysiwygMode = _deps.isWysiwygEditorEnabled() && typeof window.WysiwygEditor === 'function';
    dialog.innerHTML =
      '<div class="card-editor-header">' +
        '<div class="card-editor-header-main">' +
          '<div class="card-editor-title-label">Card Editor</div>' +
          '<div class="card-editor-title-text"></div>' +
        '</div>' +
        '<div class="card-editor-header-actions">' +
          '<div class="card-editor-mode-toggle" role="group" aria-label="Editor mode">' +
            '<button class="board-action-btn" type="button" data-card-editor-mode="markdown" aria-pressed="false">Markdown</button>' +
            '<button class="board-action-btn" type="button" data-card-editor-mode="dual" aria-pressed="false">Dual</button>' +
            '<button class="board-action-btn" type="button" data-card-editor-mode="preview" aria-pressed="false">Preview</button>' +
            (allowWysiwygMode ? '<button class="board-action-btn" type="button" data-card-editor-mode="wysiwyg" aria-pressed="false">WYSIWYG</button>' : '') +
          '</div>' +
          '<button class="board-action-btn" type="button" data-card-editor-action="font-scale">Aa</button>' +
          '<button class="btn-small btn-cancel" data-card-editor-action="cancel">Cancel</button>' +
          '<button class="btn-small btn-primary" data-card-editor-action="save">Save</button>' +
        '</div>' +
      '</div>' +
      '<div class="card-editor-toolbar">' +
        '<button class="board-action-btn" type="button" data-card-editor-fmt="bold" title="Bold">Bold</button>' +
        '<button class="board-action-btn" type="button" data-card-editor-fmt="italic" title="Italic">Italic</button>' +
        '<button class="board-action-btn" type="button" data-card-editor-fmt="underline" title="Underline">Underline</button>' +
        '<button class="board-action-btn" type="button" data-card-editor-fmt="strike" title="Strikethrough">Strike</button>' +
        '<button class="board-action-btn" type="button" data-card-editor-fmt="mark" title="Mark">Mark</button>' +
        '<button class="board-action-btn" type="button" data-card-editor-fmt="ins" title="Inserted text">Ins</button>' +
        '<button class="board-action-btn" type="button" data-card-editor-fmt="sub" title="Subscript">Sub</button>' +
        '<button class="board-action-btn" type="button" data-card-editor-fmt="sup" title="Superscript">Sup</button>' +
        '<button class="board-action-btn" type="button" data-card-editor-fmt="code" title="Inline code">Code</button>' +
        '<button class="board-action-btn" type="button" data-card-editor-fmt="link" title="Link">Link</button>' +
        '<button class="board-action-btn" type="button" data-card-editor-fmt="image" title="Image">Image</button>' +
        '<button class="board-action-btn" type="button" data-card-editor-action="file-search" title="Search files across workspace">Files</button>' +
        '<button class="board-action-btn" type="button" data-card-editor-fmt="heading" title="Heading">H2</button>' +
        '<button class="board-action-btn" type="button" data-card-editor-fmt="quote" title="Quote">Quote</button>' +
        '<button class="board-action-btn" type="button" data-card-editor-fmt="task" title="Checklist item">Task</button>' +
        '<button class="board-action-btn" type="button" data-card-editor-fmt="include" title="Include">Include</button>' +
        '<button class="board-action-btn" type="button" data-card-editor-fmt="wiki" title="Wiki link">Wiki</button>' +
        '<button class="board-action-btn" type="button" data-card-editor-fmt="footnote" title="Footnote">Footnote</button>' +
        '<button class="board-action-btn" type="button" data-card-editor-fmt="code-block" title="Code block">Block</button>' +
        '<button class="board-action-btn" type="button" data-card-editor-fmt="mermaid" title="Mermaid diagram">Mermaid</button>' +
        '<button class="board-action-btn" type="button" data-card-editor-fmt="columns" title="Multi-column block">Columns</button>' +
        '<button class="board-action-btn" type="button" data-card-editor-fmt="note" title="Note container">Note</button>' +
        buildCardEditorSnippetSelectHtml() +
        '<span class="card-editor-hint">Ctrl/Cmd+Enter to save, Esc to cancel</span>' +
      '</div>' +
      '<div class="card-editor-body">' +
        '<div class="card-editor-pane card-editor-text-pane">' +
          '<div class="card-editor-pane-title">Markdown</div>' +
          '<textarea class="card-editor-textarea card-edit-input" spellcheck="false"></textarea>' +
        '</div>' +
        '<div class="card-editor-pane card-editor-preview-pane">' +
          '<div class="card-editor-pane-title">Preview</div>' +
          '<div class="card-editor-preview" tabindex="0"></div>' +
        '</div>' +
        '<div class="card-editor-pane card-editor-wysiwyg-pane">' +
          '<div class="card-editor-pane-title">WYSIWYG</div>' +
          '<div class="card-overlay-wysiwyg"></div>' +
        '</div>' +
      '</div>';
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    function updateCardEditorOverlayHeight() {
      dialog.style.setProperty(
        '--card-overlay-wysiwyg-height',
        Math.max(360, Math.min(window.innerHeight - 320, 720)) + 'px'
      );
    }
    updateCardEditorOverlayHeight();
    window.addEventListener('resize', updateCardEditorOverlayHeight);

    var textarea = dialog.querySelector('.card-editor-textarea');
    var preview = dialog.querySelector('.card-editor-preview');
    var wysiwygWrap = dialog.querySelector('.card-overlay-wysiwyg');
    textarea.value = card.content;

    var activeBoardId = _deps.getActiveBoardId();
    currentCardEditor = {
      overlay: overlay,
      dialog: dialog,
      textarea: textarea,
      preview: preview,
      wysiwygWrap: wysiwygWrap,
      wysiwyg: null,
      resizeHandler: updateCardEditorOverlayHeight,
      cardEl: cardEl,
      colIndex: colIndex,
      fullCardIdx: fullIdx,
      originalContent: card.content || '',
      boardId: activeBoardId || '',
      fontScale: normalizeCardEditorFontScale(cardEditorFontScale),
      mode: normalizeCardEditorMode(cardEditorMode || localStorage.getItem('lexera-card-editor-mode') || 'dual')
    };
    syncCardEditorWysiwygContext(currentCardEditor);
    applyCardEditorFontScale(currentCardEditor.fontScale, false);

    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closeCardEditorOverlay({ save: false });
    });
    dialog.addEventListener('click', function (e) {
      var modeBtn = e.target.closest('[data-card-editor-mode]');
      if (modeBtn) {
        applyCardEditorMode(modeBtn.getAttribute('data-card-editor-mode'));
        if (currentCardEditor && currentCardEditor.textarea && currentCardEditor.mode !== 'preview') {
          currentCardEditor.textarea.focus();
        }
        return;
      }
      var actionBtn = e.target.closest('[data-card-editor-action]');
      if (actionBtn) {
        var action = actionBtn.getAttribute('data-card-editor-action');
        if (action === 'save') closeCardEditorOverlay({ save: true });
        else if (action === 'cancel') closeCardEditorOverlay({ save: false });
        else if (action === 'font-scale') openCardEditorFontScaleMenu(actionBtn);
        else if (action === 'file-search') openFileSearchDialog(textarea);
        return;
      }
      var fmtBtn = e.target.closest('[data-card-editor-fmt]');
      if (!fmtBtn) return;
      applyCardEditorFormatting(textarea, fmtBtn.getAttribute('data-card-editor-fmt'));
    });
    dialog.addEventListener('change', function (e) {
      var snippetSelect = e.target.closest('[data-card-editor-snippet]');
      if (!snippetSelect) return;
      var snippet = snippetSelect.value;
      if (!snippet) return;
      snippetSelect.value = '';
      applyCardEditorFormatting(textarea, snippet);
    });

    // Broadcast editing presence when opening overlay editor
    var LexeraApi = _deps.LexeraApi;
    if (card.kid && typeof _deps.shouldBroadcastEditingPresence === 'function' && _deps.shouldBroadcastEditingPresence()) {
      LexeraApi.sendEditingPresence(card.kid, _deps.getSyncUserName() || _deps.getSyncUserId(), textarea.selectionStart, false);
    }

    textarea.addEventListener('input', function () {
      try {
      scheduleCardEditorPreviewRefresh();
      _deps.queueCardDraftLiveSync(colIndex, fullIdx, textarea.value);
      if (card.kid) _deps.queueEditingPresenceBroadcast(card.kid, textarea.selectionStart, true);
      } catch (err) {
        _deps.logFrontendIssue('error', 'editor.overlay', 'Error in overlay editor input handler', err);
      }
    });
    textarea.addEventListener('keyup', function () {
      if (card.kid) _deps.queueEditingPresenceBroadcast(card.kid, textarea.selectionStart, false);
    });
    textarea.addEventListener('mouseup', function () {
      if (card.kid) _deps.queueEditingPresenceBroadcast(card.kid, textarea.selectionStart, false);
    });
    textarea.addEventListener('paste', function (e) {
      _deps.handleEditorPasteImage(e, textarea);
    });
    preview.addEventListener('change', function (e) {
      if (!e.target.classList.contains('card-checkbox')) return;
      e.preventDefault();
      e.stopPropagation();
      var lineIndex = parseInt(e.target.getAttribute('data-line'), 10);
      if (!isFinite(lineIndex)) return;
      textarea.value = updateCheckboxLineInText(textarea.value, lineIndex, e.target.checked);
      refreshCardEditorPreview({ forceRender: true });
      _deps.queueCardDraftLiveSync(colIndex, fullIdx, textarea.value);
    });
    dialog.addEventListener('dragover', function (e) {
      if (!e.dataTransfer) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });
    dialog.addEventListener('drop', async function (e) {
      if (!e.dataTransfer) return;
      e.preventDefault();
      var markdown = typeof _deps.resolveDropContent === 'function'
        ? await _deps.resolveDropContent(e.dataTransfer)
        : '';
      if (!markdown) return;
      if (currentCardEditor && currentCardEditor.mode === 'wysiwyg') {
        var editor = ensureCardEditorWysiwyg();
        if (editor) {
          editor.insertText(markdown);
          return;
        }
      }
      insertFormatting(textarea, { snippet: markdown });
      textarea.focus();
    });
    dialog.addEventListener('keydown', function (e) {
      try {
      if (e.target === textarea) return;
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        closeCardEditorOverlay({ save: true });
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        closeCardEditorOverlay({ save: true });
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        closeCardEditorOverlay({ save: false });
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey) {
        if (e.key === '1') {
          e.preventDefault();
          applyCardEditorMode('markdown');
        } else if (e.key === '2') {
          e.preventDefault();
          applyCardEditorMode('dual');
        } else if (e.key === '3') {
          e.preventDefault();
          applyCardEditorMode('preview');
        } else if (e.key === '4') {
          if (_deps.isWysiwygEditorEnabled() && typeof window.WysiwygEditor === 'function') {
            e.preventDefault();
            applyCardEditorMode('wysiwyg');
          }
        }
      }
      } catch (err) {
        _deps.logFrontendIssue('error', 'editor.overlay', 'Error in overlay dialog keydown handler', err);
      }
    });
    textarea.addEventListener('keydown', function (e) {
      try {
      if (_deps.handleTextareaTabIndent(e, textarea)) return;
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        closeCardEditorOverlay({ save: true });
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        closeCardEditorOverlay({ save: true });
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        closeCardEditorOverlay({ save: false });
        return;
      }
      // Check user-defined keybindings for editor context
      if (window.LexeraKeybindingRegistry) {
        var kb = window.LexeraKeybindingRegistry.match(e, 'editor');
        if (kb) {
          e.preventDefault();
          window.LexeraKeybindingRegistry.execute(kb, textarea, insertFormatting);
          return;
        }
      }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey) {
        if (e.key === '1') {
          e.preventDefault();
          applyCardEditorMode('markdown');
          return;
        }
        if (e.key === '2') {
          e.preventDefault();
          applyCardEditorMode('dual');
          return;
        }
        if (e.key === '3') {
          e.preventDefault();
          applyCardEditorMode('preview');
          return;
        }
        if (e.key === '4') {
          if (_deps.isWysiwygEditorEnabled() && typeof window.WysiwygEditor === 'function') {
            e.preventDefault();
            applyCardEditorMode('wysiwyg');
          }
          return;
        }
      }
      if (e.ctrlKey || e.metaKey) {
        var fmt = null;
        if (e.key === 'b') fmt = { wrap: '**' };
        else if (e.key === 'i') fmt = { wrap: '*' };
        else if (e.key === '`') fmt = { wrap: '`' };
        else if (e.key === 'k') fmt = { prefix: '[', suffix: '](url)' };
        else if (e.key === 'u') fmt = { wrap: '_' };
        else if (e.key === 'h') fmt = { prefix: '## ', suffix: '' };
        if (fmt) {
          e.preventDefault();
          insertFormatting(textarea, fmt);
        }
      }
      } catch (err) {
        _deps.logFrontendIssue('error', 'editor.overlay', 'Error in overlay textarea keydown handler', err);
      }
    });

    updateCardEditorTitle(textarea.value);
    applyCardEditorMode(currentCardEditor.mode);
    requestAnimationFrame(function () {
      if (currentCardEditor && currentCardEditor.mode === 'wysiwyg') {
        var wysiwyg = ensureCardEditorWysiwyg();
        if (wysiwyg && typeof wysiwyg.focus === 'function') {
          wysiwyg.focus();
        }
      } else if (currentCardEditor && currentCardEditor.mode !== 'preview') {
        textarea.focus();
        textarea.setSelectionRange(textarea.value.length, textarea.value.length);
      } else if (preview) {
        preview.focus();
      }
    });
  }

  function refreshCardEditorPreview(options) {
    options = options || {};
    if (!currentCardEditor) return;
    var value = currentCardEditor.textarea ? currentCardEditor.textarea.value : '';
    var shouldRenderPreview = !!options.forceRender || shouldRenderCardEditorPreview();
    var resolved = null;
    if (shouldRenderPreview && currentCardEditor.preview) {
      resolved = _deps.getIncludeResolvedContent(value, currentCardEditor.colIndex);
      var activeBoardId = _deps.getActiveBoardId();
      currentCardEditor.preview.innerHTML = _deps.renderCardContent(resolved, activeBoardId, null, { skipFirstLineTagStyle: true });
      _deps.enhanceEmbeddedContent(currentCardEditor.preview);
      _deps.applyRenderedHtmlCommentVisibility(currentCardEditor.preview, _deps.getCurrentHtmlCommentRenderMode());
      _deps.applyRenderedTagVisibility(currentCardEditor.preview, _deps.getCurrentTagVisibilityMode());
    }
    updateCardEditorTitle(value, resolved, { preferRaw: !shouldRenderPreview });
  }

  async function closeCardEditorOverlay(options) {
    options = options || {};
    if (!currentCardEditor) return;
    var editor = currentCardEditor;
    currentCardEditor = null;
    _deps.setIsEditing(false);
    // Clear editing presence
    _deps.clearEditingPresenceQueue();
    var LexeraApi = _deps.LexeraApi;
    if (LexeraApi.isSyncConnected()) {
      LexeraApi.sendEditingPresence(null, '', null, false);
    }
    if (editor.wysiwyg && typeof editor.wysiwyg.getMarkdown === 'function' && editor.textarea) {
      editor.textarea.value = editor.wysiwyg.getMarkdown() || editor.textarea.value;
    }
    if (editor.resizeHandler) {
      window.removeEventListener('resize', editor.resizeHandler);
    }
    clearScheduledCardEditorPreviewRefresh();
    destroyCardEditorWysiwyg(editor);
    window.currentTaskIncludeContext = null;
    window.currentFilePath = '';
    if (editor.cardEl && editor.cardEl.classList) {
      editor.cardEl.classList.remove('editing');
      editor.cardEl.classList.remove('editing-inline');
      editor.cardEl.classList.remove('editing-overlay');
    }
    if (editor.overlay && editor.overlay.parentNode) editor.overlay.parentNode.removeChild(editor.overlay);
    if (options.save) {
      _deps.clearPendingCardDraftSync();
      await saveCardEdit(editor.cardEl, editor.colIndex, editor.fullCardIdx, editor.textarea.value);
      return;
    }
    await _deps.revertCardDraftLiveSync(editor.colIndex, editor.fullCardIdx, editor.originalContent).catch(function (err) {
      _deps.logFrontendIssue('warn', 'live-sync.revert', 'Failed to revert overlay editor live-sync draft', err);
      return false;
    });
    await _deps.flushDeferredBoardRefresh({ refreshSidebar: true });
  }

  function insertFormatting(textarea, fmt) {
    var start = textarea.selectionStart;
    var end = textarea.selectionEnd;
    var text = textarea.value;
    var selected = text.substring(start, end);

    var replacement;
    if (fmt.snippet != null) {
      replacement = fmt.snippet;
    } else if (fmt.wrap) {
      replacement = fmt.wrap + (selected || 'text') + fmt.wrap;
    } else {
      replacement = fmt.prefix + (selected || 'text') + fmt.suffix;
    }

    textarea.value = text.substring(0, start) + replacement + text.substring(end);

    if (fmt.snippet != null) {
      textarea.setSelectionRange(start, start + replacement.length);
    } else if (selected) {
      // Place cursor: if there was a selection, select the content between markers
      var contentStart = start + (fmt.wrap ? fmt.wrap.length : fmt.prefix.length);
      textarea.setSelectionRange(contentStart, contentStart + selected.length);
    } else {
      var contentStart = start + (fmt.wrap ? fmt.wrap.length : fmt.prefix.length);
      textarea.setSelectionRange(contentStart, contentStart + 4); // select 'text'
    }
    textarea.dispatchEvent(new Event('input'));
  }

  async function saveCardEdit(cardEl, colIndex, fullCardIdx, newContent) {
    _deps.setIsEditing(false);
    var fullBoardData = _deps.getFullBoardData();
    var activeBoardId = _deps.getActiveBoardId();
    if (!fullBoardData || !activeBoardId) return;
    var col = _deps.getFullColumn(colIndex);
    if (!col || !col.cards[fullCardIdx]) return;

    var oldContent = col.cards[fullCardIdx].content;
    if (newContent === oldContent) {
      if (cardEl && cardEl.classList) cardEl.classList.remove('editing');
      renderCardDisplayState(cardEl, oldContent);
      await _deps.flushDeferredBoardRefresh({ refreshSidebar: true });
      return;
    }

    _deps.pushUndo();
    col.cards[fullCardIdx].content = newContent;
    var visibleIdx = cardEl ? parseInt(cardEl.getAttribute('data-card-index') || '-1', 10) : -1;
    await _deps.persistBoardMutation({ skipRender: true });
    if (visibleIdx >= 0) {
      _deps.updateCardElementInPlace(colIndex, visibleIdx);
    }
    await _deps.flushDeferredBoardRefresh({ refreshSidebar: true });
  }

  function getCurrentCardEditor() {
    return currentCardEditor;
  }

  return {
    init: init,
    getCurrentCardEditor: getCurrentCardEditor,
    getCurrentEditorBoardId: getCurrentEditorBoardId,
    getCurrentEditorFilePath: getCurrentEditorFilePath,
    safeDecodePath: safeDecodePath,
    isWindowsAbsolutePath: isWindowsAbsolutePath,
    normalizeWindowsAbsolutePath: normalizeWindowsAbsolutePath,
    isRelativeResourcePath: isRelativeResourcePath,
    resolveRelativePath: resolveRelativePath,
    buildWebviewResourceUrl: buildWebviewResourceUrl,
    resolveCurrentEditorResourcePath: resolveCurrentEditorResourcePath,
    syncCardEditorWysiwygContext: syncCardEditorWysiwygContext,
    setCurrentCardEditorMarkdown: setCurrentCardEditorMarkdown,
    updateCardEditorWysiwygToolbar: updateCardEditorWysiwygToolbar,
    applyCardEditorFontScale: applyCardEditorFontScale,
    openCardEditorFontScaleMenu: openCardEditorFontScaleMenu,
    openFileSearchDialog: openFileSearchDialog,
    insertAtCursor: insertAtCursor,
    syncCardEditorTextareaFromWysiwyg: syncCardEditorTextareaFromWysiwyg,
    destroyCardEditorWysiwyg: destroyCardEditorWysiwyg,
    ensureCardEditorWysiwyg: ensureCardEditorWysiwyg,
    applyCardEditorFormatting: applyCardEditorFormatting,
    getEmbedOccurrenceRoot: getEmbedOccurrenceRoot,
    getRenderedEmbedAbsoluteIndex: getRenderedEmbedAbsoluteIndex,
    replaceCurrentEmbedOccurrence: replaceCurrentEmbedOccurrence,
    replaceNthIncludeDirective: replaceNthIncludeDirective,
    normalizeCardEditorMode: normalizeCardEditorMode,
    normalizeCardEditorFontScale: normalizeCardEditorFontScale,
    getCardEditorFormatSpec: getCardEditorFormatSpec,
    buildCardEditorSnippetSelectHtml: buildCardEditorSnippetSelectHtml,
    updateCheckboxLineInText: updateCheckboxLineInText,
    renderCardDisplayState: renderCardDisplayState,
    findVisibleCardElement: findVisibleCardElement,
    openCardEditor: openCardEditor,
    applyCardEditorMode: applyCardEditorMode,
    enterCardEditMode: enterCardEditMode,
    closeCardEditorOverlay: closeCardEditorOverlay,
    insertFormatting: insertFormatting,
    saveCardEdit: saveCardEdit
  };
})();

window.CardEditor = CardEditor;
