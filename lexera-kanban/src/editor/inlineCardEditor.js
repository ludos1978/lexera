var InlineCardEditor = (function () {
  'use strict';
  var _deps = {};
  var _rt = typeof window !== 'undefined' && window.LexeraRuntime ? window.LexeraRuntime : null;

  // Module-owned state
  var currentInlineCardEditor = null;
  var inlineTextareaResizeFrame = null;

  function init(deps) {
    if (typeof window !== 'undefined' && window.LexeraRuntime) {
      _rt = window.LexeraRuntime;
      _rt.mergeDeps(_deps, deps);
    } else {
      _deps = deps || {};
    }
  }

  function autoResizeInlineCardTextarea(textarea) {
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = textarea.scrollHeight + 'px';
  }

  function clearScheduledInlineCardTextareaResize() {
    if (inlineTextareaResizeFrame != null) {
      cancelAnimationFrame(inlineTextareaResizeFrame);
      inlineTextareaResizeFrame = null;
    }
  }

  function scheduleInlineCardTextareaResize(textarea) {
    if (!textarea) return;
    clearScheduledInlineCardTextareaResize();
    inlineTextareaResizeFrame = requestAnimationFrame(function () {
      inlineTextareaResizeFrame = null;
      autoResizeInlineCardTextarea(textarea);
    });
  }

  function shouldKeepInlineEditorOpenOnBlur() {
    try {
      return typeof document.hasFocus === 'function' && !document.hasFocus();
    } catch (err) {
      return false;
    }
  }

  function shouldCancelInlineEditorOnEscape(event) {
    return !!event && event.key === 'Escape';
  }

  function enterInlineCardEditMode(cardEl, colIndex, cardIndex) {
    if (_deps.getCurrentCardEditor() || currentInlineCardEditor) return;
    var fullBoardData = _deps.getFullBoardData();
    if (!fullBoardData) return;
    var col = _deps.getFullColumn(colIndex);
    if (!col) return;
    var fullIdx = _deps.getFullCardIndex(col, cardIndex);
    var card = col.cards[fullIdx];
    if (!card) return;

    var contentEl = cardEl ? cardEl.querySelector('.card-content') : null;
    if (!contentEl) return;

    _deps.setIsEditing(true);
    cardEl.classList.add('editing');
    cardEl.classList.add('editing-inline');
    cardEl.classList.remove('editing-overlay');
    cardEl.classList.remove('collapsed');
    contentEl.innerHTML =
      '<textarea class="card-edit-input card-inline-textarea" spellcheck="false" style="' +
        _deps.escapeAttr('display:block;width:100%;resize:vertical;overflow:auto') +
      '"></textarea>';

    var textarea = contentEl.querySelector('.card-inline-textarea');
    if (!textarea) return;
    textarea.value = card.content || '';
    autoResizeInlineCardTextarea(textarea);

    currentInlineCardEditor = {
      cardEl: cardEl,
      colIndex: colIndex,
      fullCardIdx: fullIdx,
      contentEl: contentEl,
      textarea: textarea,
      originalContent: card.content || ''
    };

    function maybeSaveOnBlur() {
      var editor = currentInlineCardEditor;
      if (!editor || editor.textarea !== textarea) return;
      setTimeout(function () {
        if (!currentInlineCardEditor || currentInlineCardEditor.textarea !== textarea) return;
        if (shouldKeepInlineEditorOpenOnBlur()) return;
        closeInlineCardEditor({ save: true });
      }, 0);
    }

    // Broadcast editing presence when opening inline editor
    var LexeraApi = _deps.LexeraApi;
    if (card.kid && typeof _deps.shouldBroadcastEditingPresence === 'function' && _deps.shouldBroadcastEditingPresence()) {
      LexeraApi.sendEditingPresence(card.kid, _deps.getSyncUserName() || _deps.getSyncUserId(), textarea.selectionStart, false);
    }

    textarea.addEventListener('input', function () {
      try {
      scheduleInlineCardTextareaResize(textarea);
      _deps.queueCardDraftLiveSync(colIndex, fullIdx, textarea.value);
      if (card.kid) _deps.queueEditingPresenceBroadcast(card.kid, textarea.selectionStart, true);
      } catch (err) {
        logFrontendIssue('error', 'editor.inline', 'Error in inline editor input handler', err);
      }
    });
    textarea.addEventListener('keyup', function () {
      if (card.kid) _deps.queueEditingPresenceBroadcast(card.kid, textarea.selectionStart, false);
    });
    textarea.addEventListener('mouseup', function () {
      if (card.kid) _deps.queueEditingPresenceBroadcast(card.kid, textarea.selectionStart, false);
    });
    textarea.addEventListener('blur', maybeSaveOnBlur);
    textarea.addEventListener('keydown', function (e) {
      try {
      if (_deps.handleTextareaTabIndent(e, textarea)) return;
      if (shouldCancelInlineEditorOnEscape(e)) {
        e.preventDefault();
        e.stopPropagation();
        closeInlineCardEditor({ save: false });
        return;
      }
      if (e.altKey && e.key === 'Enter') {
        e.preventDefault();
        closeInlineCardEditor({ save: true });
        return;
      }
      // Check user-defined keybindings for editor context
      if (window.LexeraKeybindingRegistry) {
        var kb = window.LexeraKeybindingRegistry.match(e, 'editor');
        if (kb) {
          e.preventDefault();
          window.LexeraKeybindingRegistry.execute(kb, textarea, _deps.insertFormatting);
          return;
        }
      }
      } catch (err) {
        logFrontendIssue('error', 'editor.inline', 'Error in inline editor keydown handler', err);
      }
    });
    textarea.addEventListener('dragover', function (e) {
      if (e.dataTransfer) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }
    });
    textarea.addEventListener('drop', async function (e) {
      if (!e.dataTransfer || !e.dataTransfer.files || e.dataTransfer.files.length === 0) return;
      e.preventDefault();
      var markdown = await _deps.resolveDropContent(e.dataTransfer);
      if (markdown) {
        _deps.insertFormatting(textarea, { snippet: markdown });
        textarea.focus();
      }
    });
    textarea.addEventListener('paste', function (e) {
      _deps.handleEditorPasteImage(e, textarea);
    });

    requestAnimationFrame(function () {
      if (!currentInlineCardEditor || currentInlineCardEditor.textarea !== textarea) return;
      textarea.focus();
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    });
  }

  function closeInlineCardEditor(options) {
    options = options || {};
    if (!currentInlineCardEditor) return Promise.resolve();
    var editor = currentInlineCardEditor;
    currentInlineCardEditor = null;
    clearScheduledInlineCardTextareaResize();
    _deps.setIsEditing(false);
    _deps.clearEditingPresenceQueue();
    var LexeraApi = _deps.LexeraApi;
    if (LexeraApi.isSyncConnected()) {
      LexeraApi.sendEditingPresence(null, '', null, false);
    }
    if (editor.cardEl && editor.cardEl.classList) {
      editor.cardEl.classList.remove('editing');
      editor.cardEl.classList.remove('editing-inline');
      editor.cardEl.classList.remove('editing-overlay');
    }
    if (options.save) {
      _deps.clearPendingCardDraftSync();
      return _deps.saveCardEdit(editor.cardEl, editor.colIndex, editor.fullCardIdx, editor.textarea.value);
    }
    // Cancel path also rebuilds the card via renderCardDisplayState,
    // which has the same horizontal-scroll-jump risk as the save
    // path. Mirror the latch from saveCardEdit so cancel doesn't
    // leak through.
    if (_deps && typeof _deps.lockBoardScrollHorizontal === 'function') {
      _deps.lockBoardScrollHorizontal(400);
    }
    _deps.renderCardDisplayState(editor.cardEl, editor.originalContent);
    return _deps.revertCardDraftLiveSync(editor.colIndex, editor.fullCardIdx, editor.originalContent)
      .catch(function (err) {
        logFrontendIssue('warn', 'live-sync.revert', 'Failed to revert inline editor live-sync draft', err);
        return false;
      })
      .then(function () {
        return _deps.flushDeferredBoardRefresh({ refreshSidebar: true });
      });
  }

  function getCurrentInlineCardEditor() {
    return currentInlineCardEditor;
  }

  function setCurrentInlineCardEditor(val) {
    currentInlineCardEditor = val;
  }

  return {
    init: init,
    enterInlineCardEditMode: enterInlineCardEditMode,
    closeInlineCardEditor: closeInlineCardEditor,
    autoResizeInlineCardTextarea: autoResizeInlineCardTextarea,
    scheduleInlineCardTextareaResize: scheduleInlineCardTextareaResize,
    shouldKeepInlineEditorOpenOnBlur: shouldKeepInlineEditorOpenOnBlur,
    shouldCancelInlineEditorOnEscape: shouldCancelInlineEditorOnEscape,
    getCurrentInlineCardEditor: getCurrentInlineCardEditor,
    setCurrentInlineCardEditor: setCurrentInlineCardEditor
  };
})();

window.InlineCardEditor = InlineCardEditor;
