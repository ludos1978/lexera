/**
 * Embed Menu -- embed context menus, embed actions, preview handling,
 * diagram-specific menu items, file embed operations, file editors.
 *
 * Dependencies injected via init().
 */
var LexeraEmbedMenu = (function () {
  'use strict';

  // -- Injected dependencies --
  var _deps = {};

  function _dep(name) {
    var fn = _deps[name];
    if (typeof fn !== 'function') return undefined;
    var args = [];
    for (var i = 1; i < arguments.length; i++) args.push(arguments[i]);
    return fn.apply(null, args);
  }

  // Shorthand accessors for frequently-used deps
  function escapeHtml(s) { return _dep('escapeHtml', s); }
  function escapeAttr(s) { return _dep('escapeAttr', s); }
  function escapeRegex(s) { return _dep('escapeRegex', s); }
  function decodeHtmlEntities(s) { return _dep('decodeHtmlEntities', s); }
  function getDisplayFileNameFromPath(p) { return _dep('getDisplayFileNameFromPath', p); }
  function getDisplayNameFromPath(p) { return _dep('getDisplayNameFromPath', p); }
  function getFileExtension(p) { return _dep('getFileExtension', p); }
  function getFileNameFromPath(p) { return _dep('getFileNameFromPath', p); }
  function getDirNameFromPath(p) { return _dep('getDirNameFromPath', p); }
  function normalizePathForCompare(p) { return _dep('normalizePathForCompare', p); }
  function parseLocalFileReference(p) { return _dep('parseLocalFileReference', p); }
  function showNotification(m) { return _dep('showNotification', m); }
  function showConfirmDialog(m) { return _dep('showConfirmDialog', m); }
  function logFrontendIssue(l, t, c, e) { return _dep('logFrontendIssue', l, t, c, e); }
  function traceFrontendAction(l, t, m, d) { return _dep('traceFrontendAction', l, t, m, d); }
  function getTagColor(t) { return _dep('getTagColor', t); }
  function getContrastingTextColor(c) { return _dep('getContrastingTextColor', c); }
  function buildTagStyleDescriptor(t) { return _dep('buildTagStyleDescriptor', t); }
  function describeTemporalTag(t) { return _dep('describeTemporalTag', t); }
  function renderCardContent(c, b, r, o) { return _dep('renderCardContent', c, b, r, o); }
  function renderInline(t, b, r) { return _dep('renderInline', t, b, r); }
  function applyRenderedHtmlCommentVisibility(r, m) { return _dep('applyRenderedHtmlCommentVisibility', r, m); }
  function applyRenderedTagVisibility(r, m) { return _dep('applyRenderedTagVisibility', r, m); }
  function flushPendingDiagramQueues() { return _dep('flushPendingDiagramQueues'); }
  function getCurrentEditorBoardId() { return _dep('getCurrentEditorBoardId'); }
  function getBoardFilePathForId(b) { return _dep('getBoardFilePathForId', b); }
  function getBoardDisplayName(b) { return _dep('getBoardDisplayName', b); }
  function getFullColumn(i) { return _dep('getFullColumn', i); }
  function getFullCardIndex(c, i) { return _dep('getFullCardIndex', c, i); }
  function findFullDataRow(i) { return _dep('findFullDataRow', i); }
  function findFullDataStack(r, s) { return _dep('findFullDataStack', r, s); }
  function findColumnContainer(i) { return _dep('findColumnContainer', i); }
  function getColumnByLocation(r, s, c) { return _dep('getColumnByLocation', r, s, c); }
  function pushUndo() { return _dep('pushUndo'); }
  function persistBoardMutation(o) { return _dep('persistBoardMutation', o); }
  function resolveWikiDocument(d) { return _dep('resolveWikiDocument', d); }
  function openWikiDocument(d, o) { return _dep('openWikiDocument', d, o); }
  function openWikiSearch(q) { return _dep('openWikiSearch', q); }
  function setCurrentCardEditorMarkdown(v, o) { return _dep('setCurrentCardEditorMarkdown', v, o); }
  function ensureCardEditorWysiwyg() { return _dep('ensureCardEditorWysiwyg'); }
  function refreshCardEditorPreview() { return _dep('refreshCardEditorPreview'); }
  function triggerBoardExport(o) { return _dep('triggerBoardExport', o); }
  function resolveCurrentEditorResourcePath(p, i) { return _dep('resolveCurrentEditorResourcePath', p, i); }
  function insertFormatting(t, f) { return _dep('insertFormatting', t, f); }
  function formatEmbeddedRendererStatusItem(s) { return _dep('formatEmbeddedRendererStatusItem', s); }
  function refreshEmbeddedRendererStatuses(f) { return _dep('refreshEmbeddedRendererStatuses', f); }
  function replaceNthIncludeDirective(c, i, r) { return _dep('replaceNthIncludeDirective', c, i, r); }
  function replaceCurrentEmbedOccurrence(c, ct, r) { return _dep('replaceCurrentEmbedOccurrence', c, ct, r); }
  function getInlineFileEmbedExtension(p) { return _dep('getInlineFileEmbedExtension', p); }
  function getMediaCategory(e) { return _dep('getMediaCategory', e); }
  function hasInternalHiddenTag(t, g) { return _dep('hasInternalHiddenTag', t, g); }
  function createBuiltInNamedFile(c, n, m) { return _dep('createBuiltInNamedFile', c, n, m); }
  function decodeBase64BinaryStringToUint8Array(v) { return _dep('decodeBase64BinaryStringToUint8Array', v); }
  function buildPastedEmbedImageFileName(n) { return _dep('buildPastedEmbedImageFileName', n); }
  function getUploadedMediaEmbedTarget(r) { return _dep('getUploadedMediaEmbedTarget', r); }
  function summarizeMenuItems(i) { return _dep('summarizeMenuItems', i); }
  function lexeraLog(l, m) { return _dep('lexeraLog', l, m); }
  function safeDecodePath(p) { return _dep('safeDecodePath', p); }
  function resolveRelativePath(b, r) { return _dep('resolveRelativePath', b, r); }
  function isRelativeResourcePath(p) { return _dep('isRelativeResourcePath', p); }
  function isWindowsAbsolutePath(p) { return _dep('isWindowsAbsolutePath', p); }
  function normalizeWindowsAbsolutePath(p) { return _dep('normalizeWindowsAbsolutePath', p); }
  function buildWebviewResourceUrl(p) { return _dep('buildWebviewResourceUrl', p); }
  // Note: openInSystem, openUrlInSystem, showInFinder, tauriInvoke,
  // showNativeMenu, resolveBoardPath, openBoardFileInSystem, copyTextToClipboard,
  // showHtmlMenu, tauriListen, resolveTauriInternals are defined in the
  // extracted body below and do not need dep-delegation stubs.

  // State getters -- these variables are accessed frequently in the body and
  // shadow the outer IIFE scope.  They are refreshed via _syncState() which
  // is called at every public entry-point.
  var activeBoardId = null;
  var currentCardEditor = null;
  var fullBoardData = null;
  var currentHtmlCommentRenderMode = 'hidden';
  var currentTagVisibilityMode = 'allexcludinglayout';
  var exportToolStatusCache = { renderers: { rows: [] } };
  var embeddedMode = false;
  var includeResolvedContentCache = new Map();
  var MAX_INCLUDE_RESOLVED_CONTENT_CACHE_ENTRIES = 128;
  // hasTauri is defined in the extracted body via resolveTauriInternals()
  var LexeraApi = null;
  var ContentEnhancerRegistry = null;
  var DiagramRegistry = null;

  function _syncState() {
    if (_deps.getActiveBoardId) activeBoardId = _deps.getActiveBoardId();
    if (_deps.getCurrentCardEditor) currentCardEditor = _deps.getCurrentCardEditor();
    if (_deps.getFullBoardData) fullBoardData = _deps.getFullBoardData();
    if (_deps.getCurrentHtmlCommentRenderMode) currentHtmlCommentRenderMode = _deps.getCurrentHtmlCommentRenderMode();
    if (_deps.getCurrentTagVisibilityMode) currentTagVisibilityMode = _deps.getCurrentTagVisibilityMode();
    if (_deps.getExportToolStatusCache) exportToolStatusCache = _deps.getExportToolStatusCache();
    if (_deps.isEmbeddedMode) embeddedMode = _deps.isEmbeddedMode();
    if (_deps.getLexeraApi) LexeraApi = _deps.getLexeraApi();
    if (_deps.getContentEnhancerRegistry) ContentEnhancerRegistry = _deps.getContentEnhancerRegistry();
    if (_deps.getDiagramRegistry) DiagramRegistry = _deps.getDiagramRegistry();
  }

  // -- Extracted code begins --

  var PathUtils = (typeof window !== 'undefined' && window.LexeraPathUtils) || {};

  var activeEmbedMenu = null;
  var embedPreviewCache = {};
  var externalEmbedPolicyCache = {};
  var pendingExternalEmbedPolicyCache = {};
  var fileInfoCache = {};
  var pendingFileInfoCache = {};
  var pendingSpecialPreviewRenderCache = {};
  var pendingPlantUmlRenderCache = {};
  var specialPreviewErrorCache = {};
  var activeSpecialFileEditor = null;
  var MAX_INCLUDE_PREVIEW_DEPTH = 2;

  function isMarkdownPreviewExtension(ext) {
    return ext === 'md' || ext === 'markdown';
  }

  function isTextPreviewExtension(ext) {
    return isMarkdownPreviewExtension(ext) || ext === 'txt' || ext === 'log' || ext === 'json' || ext === 'csv';
  }

  function normalizeFilePathForDetection(path) {
    var value = String(path || '').trim();
    if (!value) return '';
    try {
      if (isExternalHttpUrl(value)) value = new URL(value).pathname || '';
    } catch (e) {
      // Fall back to simple path parsing below.
    }
    return value.split('#')[0].split('?')[0].toLowerCase();
  }

  function getFileFormatRegistry() {
    if (typeof window === 'undefined' || !window || !window.LexeraFileFormatRegistry) return null;
    return window.LexeraFileFormatRegistry;
  }

  function getFileFormatPlugin(filePath) {
    var registry = getFileFormatRegistry();
    if (!registry || typeof registry.findByFilePath !== 'function') return null;
    return registry.findByFilePath(filePath);
  }

  function getSpecialPreviewType(filePath) {
    var plugin = getFileFormatPlugin(filePath);
    if (plugin && plugin.id) return plugin.id;
    var normalized = normalizeFilePathForDetection(filePath);
    if (!normalized) return '';
    if (normalized.endsWith('.excalidraw.json') || normalized.endsWith('.excalidraw') || normalized.endsWith('.excalidraw.svg')) return 'excalidraw';
    if (normalized.endsWith('.drawio') || normalized.endsWith('.dio')) return 'drawio';
    if (/\.(xlsx|xls|ods)$/.test(normalized)) return 'xlsx';
    if (normalized.endsWith('.csv')) return 'csv';
    if (normalized.slice(-5) === '.epub') return 'epub';
    if (/\.(ppt|pptx|odp)$/.test(normalized)) return 'pptx';
    if (/\.(doc|docx|odt|rtf)$/.test(normalized)) return 'document';
    if (normalized.slice(-4) === '.pdf') return 'pdf';
    return '';
  }

  function getPreviewKindMeta(kind, filePath) {
    var registry = getFileFormatRegistry();
    if (registry && typeof registry.getPreviewMeta === 'function') {
      return registry.getPreviewMeta(kind, filePath);
    }
    if (kind === 'diagram') {
      if (getSpecialPreviewType(filePath) === 'excalidraw') {
        return { label: 'Excalidraw file', emoji: '&#127912;' };
      }
      return { label: 'Draw.io file', emoji: '&#128202;' };
    }
    if (kind === 'spreadsheet') return { label: 'Spreadsheet file', emoji: '&#128200;' };
    if (kind === 'epub') return { label: 'EPUB file', emoji: '&#128218;' };
    if (kind === 'document') return { label: 'Document file', emoji: '&#128196;' };
    if (kind === 'pdf') return { label: 'PDF file', emoji: '&#128196;' };
    return { label: 'File', emoji: '&#128196;' };
  }

  function buildFilePreviewPlaceholderHtml(kind, filePath, description) {
    var meta = getPreviewKindMeta(kind, filePath);
    var filename = getDisplayFileNameFromPath(filePath) || filePath;
    return '<div class="embed-diagram-file">' +
      '<div class="embed-diagram-label">' + meta.emoji + ' ' + escapeHtml(meta.label) + '</div>' +
      '<div class="embed-diagram-path">' + escapeHtml(filename) + '</div>' +
      '<div class="embed-preview-loading" style="padding:8px 0 0;">' + escapeHtml(description || 'Preview is not available in this view yet.') + '</div>' +
    '</div>';
  }

  function getFileEmbedChipHtml(kind, filePath, extraStyleAttr) {
    var meta = getPreviewKindMeta(kind, filePath);
    var filename = getDisplayFileNameFromPath(filePath) || filePath;
    return '<span class="embed-file-link"' + (extraStyleAttr || '') + '>' + meta.emoji + ' ' + escapeHtml(filename) + '</span>';
  }

  function getSpecialPreviewPlaceholderText(previewKind, filePath) {
    var registry = getFileFormatRegistry();
    if (registry && typeof registry.getPreviewPlaceholder === 'function') {
      return registry.getPreviewPlaceholder(previewKind, filePath || '');
    }
    if (previewKind === 'diagram') return 'Open the source file in a dedicated app for full diagram editing.';
    if (previewKind === 'spreadsheet') return 'Spreadsheet rendering is not available in this view yet.';
    if (previewKind === 'table') return 'Table rendering is not available in this view yet.';
    if (previewKind === 'epub') return 'EPUB rendering is not available in this view yet.';
    if (previewKind === 'document') return 'Document rendering is not available in this view yet.';
    return 'Preview is not available in this view yet.';
  }

  function isRenderedSpecialPreviewKind(previewKind) {
    return previewKind === 'diagram' ||
      previewKind === 'spreadsheet' ||
      previewKind === 'table' ||
      previewKind === 'text' ||
      previewKind === 'epub' ||
      previewKind === 'document';
  }

  function getEmbedPreviewKind(filePath) {
    var ext = getFileExtension(filePath);
    if (isMarkdownPreviewExtension(ext)) return 'markdown';
    var registry = getFileFormatRegistry();
    if (registry && typeof registry.getPreviewKind === 'function') {
      var registryKind = registry.getPreviewKind(filePath);
      if (registryKind) return registryKind;
    }
    if (isTextPreviewExtension(ext)) return 'text';
    var special = getSpecialPreviewType(filePath);
    if (special === 'pdf') return 'pdf';
    if (special === 'drawio' || special === 'excalidraw') return 'diagram';
    if (special === 'xlsx') return 'spreadsheet';
    if (special === 'csv') return 'table';
    if (special === 'epub') return 'epub';
    if (special === 'pptx') return 'document';
    if (special === 'document') return 'document';
    return '';
  }

  function getEmbedPreviewCacheKey(boardId, filePath) {
    return String(boardId || '') + '::' + String(filePath || '');
  }

  function getFileInfoCacheKey(boardId, filePath) {
    return String(boardId || '') + '::' + String(filePath || '');
  }

  function setSpecialPreviewError(boardId, filePath, errorText) {
    var cacheKey = getEmbedPreviewCacheKey(boardId, filePath);
    if (!cacheKey) return;
    if (errorText) {
      specialPreviewErrorCache[cacheKey] = String(errorText);
    } else {
      delete specialPreviewErrorCache[cacheKey];
    }
  }

  function getSpecialPreviewError(boardId, filePath) {
    var cacheKey = getEmbedPreviewCacheKey(boardId, filePath);
    return cacheKey ? specialPreviewErrorCache[cacheKey] || '' : '';
  }

  function buildSpecialPreviewPlaceholderMessage(previewKind, boardId, filePath) {
    var base = getSpecialPreviewPlaceholderText(previewKind, filePath);
    var errorText = getSpecialPreviewError(boardId, filePath);
    return errorText ? (base + ' ' + errorText) : base;
  }

  function shortenMenuStatusText(value, maxLength) {
    var text = String(value || '').trim();
    var limit = maxLength || 96;
    if (text.length <= limit) return text;
    return text.substring(0, Math.max(0, limit - 3)).trim() + '...';
  }

  function getRendererStatusRowsById() {
    var rows = exportToolStatusCache.renderers && Array.isArray(exportToolStatusCache.renderers.rows)
      ? exportToolStatusCache.renderers.rows
      : [];
    var map = {};
    for (var i = 0; i < rows.length; i++) {
      if (rows[i] && rows[i].id) map[rows[i].id] = rows[i];
    }
    return map;
  }

  function getRendererStatusRequirementsForFile(filePath) {
    var registry = getFileFormatRegistry();
    var requirements = registry && typeof registry.getRendererRequirements === 'function'
      ? registry.getRendererRequirements(filePath)
      : [];
    if (!Array.isArray(requirements) || requirements.length === 0) return [];
    var rowMap = getRendererStatusRowsById();
    var out = [];
    for (var i = 0; i < requirements.length; i++) {
      var requirement = requirements[i];
      if (!requirement) continue;
      if (typeof requirement.available === 'boolean') {
        out.push(requirement);
        continue;
      }
      if (requirement.id && rowMap[requirement.id]) out.push(rowMap[requirement.id]);
    }
    return out;
  }

  function formatRendererStatusSummaryForFile(boardId, filePath) {
    var rows = getRendererStatusRequirementsForFile(filePath);
    if (rows.length === 0) return 'Renderer Status: No extra renderer required';
    var readyCount = 0;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i] && rows[i].available) readyCount += 1;
    }
    var errorText = getSpecialPreviewError(boardId, filePath);
    if (errorText) return 'Renderer Status: Last render failed';
    return 'Renderer Status: ' + readyCount + '/' + rows.length + ' Ready';
  }

  function buildFileRendererStatusMenuItems(boardId, filePath) {
    var items = [{
      id: 'renderer-status-summary',
      label: formatRendererStatusSummaryForFile(boardId, filePath),
      disabled: true
    }];
    var errorText = getSpecialPreviewError(boardId, filePath);
    if (errorText) {
      items.push({
        id: 'renderer-status-last-error',
        label: 'Last Error: ' + shortenMenuStatusText(errorText, 120),
        disabled: true
      });
    }
    var rows = getRendererStatusRequirementsForFile(filePath);
    if (rows.length > 0) {
      items.push({ separator: true });
      for (var i = 0; i < rows.length; i++) {
        items.push({
          id: 'renderer-status-row:' + String(rows[i].id || i),
          label: formatEmbeddedRendererStatusItem(rows[i]),
          disabled: true
        });
      }
    }
    return items;
  }

  async function showFileRendererStatusMenu(boardId, filePath, trigger) {
    if (!filePath) return;
    await refreshEmbeddedRendererStatuses(false);
    var x = 0;
    var y = 0;
    if (trigger && typeof trigger.clientX === 'number' && typeof trigger.clientY === 'number') {
      x = trigger.clientX;
      y = trigger.clientY;
    } else if (trigger && typeof trigger.getBoundingClientRect === 'function') {
      var rect = trigger.getBoundingClientRect();
      x = rect.right;
      y = rect.bottom;
    }
    await showNativeMenu(buildFileRendererStatusMenuItems(boardId, filePath), x, y);
  }

  function getSpecialFileEditorKind(filePath) {
    var registry = getFileFormatRegistry();
    if (registry && typeof registry.getEditorKind === 'function') {
      var editorKind = registry.getEditorKind(filePath);
      if (editorKind) return editorKind;
    }
    var normalized = normalizeFilePathForDetection(filePath);
    if (!normalized) return '';
    if (normalized.endsWith('.excalidraw') || normalized.endsWith('.excalidraw.json')) return 'excalidraw';
    if (normalized.endsWith('.drawio') || normalized.endsWith('.dio')) return 'drawio';
    if (/\.(txt|text|log|cfg|ini|conf|csv|tsv|tab)$/.test(normalized)) return 'plaintext';
    return '';
  }

  function getSpecialFileEditorAssetPath(kind) {
    if (kind === 'excalidraw') return 'excalidraw-overlay.html';
    return '';
  }

  async function resolveAbsoluteBoardFilePath(boardId, filePath) {
    var fileRef = parseLocalFileReference(filePath);
    if (!fileRef.path) return '';
    if (isAbsoluteFilePath(fileRef.path) || !boardId) return fileRef.path;
    return resolveBoardPath(boardId, fileRef.path, 'absolute');
  }

  function parseSpecialFileEditorInitialData(kind, content) {
    if (kind !== 'excalidraw') return null;
    var parsed = JSON.parse(String(content || '').trim() || '{}');
    if (!parsed || parsed.type !== 'excalidraw' || !Array.isArray(parsed.elements)) {
      throw new Error('Invalid Excalidraw JSON file');
    }
    return {
      elements: parsed.elements || [],
      appState: parsed.appState || { viewBackgroundColor: '#ffffff', gridSize: null },
      files: parsed.files || {}
    };
  }

  function refreshSpecialFileEditorActionState(editor) {
    if (!editor || !editor.dialog) return;
    var titleEl = editor.dialog.querySelector('.modal-title');
    var saveBtn = editor.dialog.querySelector('[data-special-file-editor-action="save"]');
    var reloadBtn = editor.dialog.querySelector('[data-special-file-editor-action="reload"]');
    if (titleEl) {
      titleEl.textContent = (getDisplayFileNameFromPath(editor.filePath) || editor.filePath) + (editor.dirty ? ' *' : '');
    }
    if (saveBtn) saveBtn.disabled = !editor.ready;
    if (reloadBtn) reloadBtn.disabled = !editor.ready;
  }

  function postMessageToSpecialFileEditor(editor, type, payload) {
    if (!editor || !editor.iframe || !editor.iframe.contentWindow) return;
    editor.iframe.contentWindow.postMessage({
      source: 'lexera-excalidraw-parent',
      type: type,
      payload: payload || {}
    }, '*');
  }

  async function closeSpecialFileEditorOverlay(editor, force) {
    editor = editor || activeSpecialFileEditor;
    if (!editor) return true;
    if (!force && editor.dirty && !(await showConfirmDialog('Discard unsaved changes?'))) {
      return false;
    }
    if (editor.overlay && editor.overlay.parentNode) editor.overlay.parentNode.removeChild(editor.overlay);
    if (activeSpecialFileEditor === editor) activeSpecialFileEditor = null;
    return true;
  }

  function handleSpecialFileEditorMessage(event) {
    var message = event && event.data ? event.data : null;
    var editor = activeSpecialFileEditor;
    if (!editor || !message || message.source !== 'lexera-excalidraw-frame') return;
    if (!editor.iframe || event.source !== editor.iframe.contentWindow) return;

    if (message.type === 'frame-loaded') {
      postMessageToSpecialFileEditor(editor, 'init', editor.initialScene || {});
      return;
    }
    if (message.type === 'ready') {
      editor.ready = true;
      refreshSpecialFileEditorActionState(editor);
      return;
    }
    if (message.type === 'dirty') {
      editor.dirty = true;
      refreshSpecialFileEditorActionState(editor);
      return;
    }
    if (message.type === 'save-response') {
      if (editor.pendingSaveResolve) {
        editor.pendingSaveResolve(String(message.payload && message.payload.content ? message.payload.content : ''));
        editor.pendingSaveResolve = null;
        editor.pendingSaveReject = null;
      }
      return;
    }
    if (message.type === 'error') {
      var errorMessage = message.payload && message.payload.message ? message.payload.message : 'Editor error';
      if (editor.pendingSaveReject) {
        editor.pendingSaveReject(new Error(errorMessage));
        editor.pendingSaveResolve = null;
        editor.pendingSaveReject = null;
      }
      showNotification(errorMessage);
    }
  }

  var _messageListenerRegistered = false;

  function requestSpecialFileEditorSaveContent(editor) {
    return new Promise(function (resolve, reject) {
      if (!editor || !editor.ready) {
        reject(new Error('Editor not ready'));
        return;
      }
      editor.pendingSaveResolve = resolve;
      editor.pendingSaveReject = reject;
      postMessageToSpecialFileEditor(editor, 'request-save', {});
      setTimeout(function () {
        if (editor.pendingSaveReject === reject) {
          editor.pendingSaveResolve = null;
          editor.pendingSaveReject = null;
          reject(new Error('Timed out waiting for editor save response'));
        }
      }, 5000);
    });
  }

  async function reloadSpecialFileEditorOverlay(editor) {
    if (!editor) return;
    if (editor.dirty && !(await showConfirmDialog('Reload the file and discard unsaved changes?'))) return;
    var content = await tauriInvoke('read_text_file', { path: editor.absolutePath });
    editor.initialScene = parseSpecialFileEditorInitialData(editor.kind, content);
    editor.dirty = false;
    editor.ready = false;
    refreshSpecialFileEditorActionState(editor);
    postMessageToSpecialFileEditor(editor, 'init', editor.initialScene || {});
  }

  function refreshVisibleBoardFileEmbeds(boardId, filePath) {
    if (!boardId || !filePath) return;
    var containers = document.querySelectorAll('.embed-container[data-file-path][data-board-id]');
    for (var i = 0; i < containers.length; i++) {
      var container = containers[i];
      if ((container.getAttribute('data-board-id') || '') !== boardId) continue;
      if ((container.getAttribute('data-file-path') || '') !== filePath) continue;
      container.classList.remove('embed-broken');
      container.removeAttribute('data-embed-enhanced');
      var preview = container.querySelector('.embed-preview');
      if (preview) preview.remove();
      enhanceSingleEmbedContainer(container);
    }
  }

  function refreshVisibleIncludePreviews(boardId, filePath) {
    if (!boardId || !filePath) return;
    var containers = document.querySelectorAll('.include-inline-container[data-file-path][data-board-id]');
    for (var i = 0; i < containers.length; i++) {
      var container = containers[i];
      if ((container.getAttribute('data-board-id') || '') !== boardId) continue;
      if ((container.getAttribute('data-file-path') || '') !== filePath) continue;
      container.classList.remove('include-broken');
      container.removeAttribute('data-include-enhanced');
      var body = container.querySelector('.include-inline-body');
      if (body) body.innerHTML = '<div class="embed-preview-loading">Loading include...</div>';
      enhanceSingleIncludeDirective(container);
    }
  }

  async function saveSpecialFileEditorOverlay(editor) {
    if (!editor) return;
    var content = await requestSpecialFileEditorSaveContent(editor);
    await tauriInvoke('write_text_file', {
      path: editor.absolutePath,
      content: content
    });
    editor.dirty = false;
    refreshSpecialFileEditorActionState(editor);
    clearCachedFilePreviewState(editor.boardId, editor.filePath);
    refreshVisibleBoardFileEmbeds(editor.boardId, editor.filePath);
    showNotification('Excalidraw file saved');
  }

  async function openPlaintextEditorOverlay(boardId, filePath, absolutePath, content) {
    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    var dialog = document.createElement('div');
    dialog.className = 'modal-dialog plaintext-editor-dialog';
    dialog.setAttribute('tabindex', '-1');
    var displayName = getDisplayFileNameFromPath(filePath) || filePath;
    dialog.innerHTML =
      '<div class="modal-title">' + escapeHtml(displayName) + '</div>' +
      '<div class="special-file-editor-path">' + escapeHtml(filePath) + '</div>' +
      '<div class="plaintext-editor-wrap">' +
        '<textarea class="plaintext-editor-textarea" spellcheck="false"></textarea>' +
      '</div>' +
      '<div class="hidden-items-footer">' +
        '<button class="board-action-btn" data-plaintext-action="save">Save</button>' +
        '<button class="board-action-btn" data-plaintext-action="reload">Reload</button>' +
        '<button class="board-action-btn" data-plaintext-action="open-system">Open in System App</button>' +
        '<button class="board-action-btn" data-plaintext-action="close">Close</button>' +
      '</div>';
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    var textarea = dialog.querySelector('.plaintext-editor-textarea');
    textarea.value = content || '';
    var savedContent = content || '';

    var editor = {
      kind: 'plaintext',
      boardId: boardId,
      filePath: filePath,
      absolutePath: absolutePath,
      overlay: overlay,
      dialog: dialog,
      iframe: null,
      initialScene: null,
      ready: true,
      dirty: false,
      pendingSaveResolve: null,
      pendingSaveReject: null,
      isPlaintextEditor: true
    };
    activeSpecialFileEditor = editor;

    function updateDirtyState() {
      var isDirty = textarea.value !== savedContent;
      if (isDirty !== editor.dirty) {
        editor.dirty = isDirty;
        refreshSpecialFileEditorActionState(editor);
      }
    }

    textarea.addEventListener('input', updateDirtyState);

    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closeSpecialFileEditorOverlay(editor, false);
    });

    dialog.addEventListener('click', async function (e) {
      var button = e.target.closest('[data-plaintext-action]');
      if (!button) return;
      var action = button.getAttribute('data-plaintext-action');
      if (action === 'save') {
        tauriInvoke('write_text_file', { path: absolutePath, content: textarea.value }).then(function () {
          savedContent = textarea.value;
          editor.dirty = false;
          refreshSpecialFileEditorActionState(editor);
          clearCachedFilePreviewState(boardId, filePath);
          refreshVisibleBoardFileEmbeds(boardId, filePath);
          showNotification('File saved');
        }).catch(function (err) {
          showNotification('Failed to save: ' + (err && err.message ? err.message : String(err)));
        });
      } else if (action === 'reload') {
        if (editor.dirty && !(await showConfirmDialog('Reload and discard unsaved changes?'))) return;
        tauriInvoke('read_text_file', { path: absolutePath }).then(function (reloaded) {
          textarea.value = reloaded || '';
          savedContent = reloaded || '';
          editor.dirty = false;
          refreshSpecialFileEditorActionState(editor);
        }).catch(function (err) {
          showNotification('Failed to reload: ' + (err && err.message ? err.message : String(err)));
        });
      } else if (action === 'open-system') {
        openInSystem(absolutePath);
      } else if (action === 'close') {
        closeSpecialFileEditorOverlay(editor, false);
      }
    });

    dialog.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !e.target.closest('.plaintext-editor-textarea')) {
        e.preventDefault();
        closeSpecialFileEditorOverlay(editor, false);
      }
      if (e.key === 's' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        dialog.querySelector('[data-plaintext-action="save"]').click();
      }
    });

    textarea.focus();
  }

  async function openExternalEditBridgeOverlay(boardId, filePath, absolutePath, kind) {
    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay external-edit-bridge-overlay';
    var dialog = document.createElement('div');
    dialog.className = 'modal-dialog external-edit-bridge-dialog';
    dialog.setAttribute('tabindex', '-1');
    var displayName = getDisplayFileNameFromPath(filePath) || filePath;
    var kindLabel = kind === 'drawio' ? 'Draw.io' : kind;
    dialog.innerHTML =
      '<div class="modal-title">' + escapeHtml(displayName) + '</div>' +
      '<div class="special-file-editor-path">' + escapeHtml(filePath) + '</div>' +
      '<div class="external-edit-bridge-status">Editing in ' + escapeHtml(kindLabel) + '. Save the file externally, then refresh the preview below.</div>' +
      '<div class="hidden-items-footer">' +
        '<button class="board-action-btn" data-external-edit-action="refresh">Refresh Preview</button>' +
        '<button class="board-action-btn" data-external-edit-action="reopen">Reopen in App</button>' +
        '<button class="board-action-btn" data-external-edit-action="done">Done</button>' +
      '</div>';
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    var editor = {
      kind: kind,
      boardId: boardId,
      filePath: filePath,
      absolutePath: absolutePath,
      overlay: overlay,
      dialog: dialog,
      iframe: null,
      initialScene: null,
      ready: true,
      dirty: false,
      pendingSaveResolve: null,
      pendingSaveReject: null,
      isExternalBridge: true
    };
    activeSpecialFileEditor = editor;

    openInSystem(absolutePath);

    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closeSpecialFileEditorOverlay(editor, true);
    });
    dialog.addEventListener('click', function (e) {
      var button = e.target.closest('[data-external-edit-action]');
      if (!button) return;
      var action = button.getAttribute('data-external-edit-action');
      if (action === 'refresh') {
        clearCachedFilePreviewState(boardId, filePath);
        refreshVisibleBoardFileEmbeds(boardId, filePath);
        showNotification('Preview refreshed');
      } else if (action === 'reopen') {
        openInSystem(absolutePath);
      } else if (action === 'done') {
        clearCachedFilePreviewState(boardId, filePath);
        refreshVisibleBoardFileEmbeds(boardId, filePath);
        closeSpecialFileEditorOverlay(editor, true);
      }
    });
    dialog.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        clearCachedFilePreviewState(boardId, filePath);
        refreshVisibleBoardFileEmbeds(boardId, filePath);
        closeSpecialFileEditorOverlay(editor, true);
      }
    });
    dialog.focus();
  }

  async function openSpecialFileEditorOverlay(boardId, filePath) {
    var kind = getSpecialFileEditorKind(filePath);
    if (!kind) {
      openBoardFileInSystem(boardId, filePath);
      return;
    }
    if (activeSpecialFileEditor && activeSpecialFileEditor.boardId === boardId && activeSpecialFileEditor.filePath === filePath) {
      if (activeSpecialFileEditor.dialog && typeof activeSpecialFileEditor.dialog.focus === 'function') {
        activeSpecialFileEditor.dialog.focus();
      }
      return;
    }
    if (activeSpecialFileEditor && !(await closeSpecialFileEditorOverlay(activeSpecialFileEditor, false))) {
      return;
    }

    var absolutePath = await resolveAbsoluteBoardFilePath(boardId, filePath);
    if (!absolutePath) {
      showNotification('Could not resolve file path for editor');
      return;
    }

    if (kind === 'drawio') {
      openExternalEditBridgeOverlay(boardId, filePath, absolutePath, kind);
      return;
    }

    if (kind === 'plaintext') {
      var textContent = await tauriInvoke('read_text_file', { path: absolutePath });
      openPlaintextEditorOverlay(boardId, filePath, absolutePath, textContent);
      return;
    }

    var rawContent = await tauriInvoke('read_text_file', { path: absolutePath });
    var initialScene = parseSpecialFileEditorInitialData(kind, rawContent);
    var editorPage = getSpecialFileEditorAssetPath(kind);
    if (!editorPage) {
      showNotification('No editor is available for this file type');
      return;
    }

    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    var dialog = document.createElement('div');
    dialog.className = 'modal-dialog special-file-editor-dialog';
    dialog.setAttribute('tabindex', '-1');
    dialog.innerHTML =
      '<div class="modal-title">' + escapeHtml(getDisplayFileNameFromPath(filePath) || filePath) + '</div>' +
      '<div class="special-file-editor-path">' + escapeHtml(filePath) + '</div>' +
      '<div class="special-file-editor-frame-wrap">' +
        '<iframe class="special-file-editor-frame" src="' + escapeAttr(editorPage) + '" title="Excalidraw editor"></iframe>' +
      '</div>' +
      '<div class="hidden-items-footer">' +
        '<button class="board-action-btn" data-special-file-editor-action="save" disabled>Save</button>' +
        '<button class="board-action-btn" data-special-file-editor-action="reload" disabled>Reload</button>' +
        '<button class="board-action-btn" data-special-file-editor-action="open-system">Open in System App</button>' +
        '<button class="board-action-btn" data-special-file-editor-action="close">Close</button>' +
      '</div>';
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    var iframe = dialog.querySelector('.special-file-editor-frame');
    var editor = {
      kind: kind,
      boardId: boardId,
      filePath: filePath,
      absolutePath: absolutePath,
      overlay: overlay,
      dialog: dialog,
      iframe: iframe,
      initialScene: initialScene,
      ready: false,
      dirty: false,
      pendingSaveResolve: null,
      pendingSaveReject: null
    };
    activeSpecialFileEditor = editor;
    refreshSpecialFileEditorActionState(editor);

    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closeSpecialFileEditorOverlay(editor, false);
    });
    dialog.addEventListener('click', function (e) {
      var button = e.target.closest('[data-special-file-editor-action]');
      if (!button) return;
      var action = button.getAttribute('data-special-file-editor-action');
      if (action === 'save') {
        saveSpecialFileEditorOverlay(editor).catch(function (err) {
          showNotification(err && err.message ? err.message : 'Failed to save Excalidraw file');
        });
      } else if (action === 'reload') {
        reloadSpecialFileEditorOverlay(editor).catch(function (err) {
          showNotification(err && err.message ? err.message : 'Failed to reload Excalidraw file');
        });
      } else if (action === 'open-system') {
        openBoardFileInSystem(boardId, filePath);
      } else if (action === 'close') {
        closeSpecialFileEditorOverlay(editor, false);
      }
    });
    dialog.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeSpecialFileEditorOverlay(editor, false);
      }
    });
    dialog.focus();
  }

  function requestFileInfo(boardId, filePath) {
    var cacheKey = getFileInfoCacheKey(boardId, filePath);
    if (Object.prototype.hasOwnProperty.call(fileInfoCache, cacheKey)) {
      return Promise.resolve(fileInfoCache[cacheKey]);
    }
    if (pendingFileInfoCache[cacheKey]) return pendingFileInfoCache[cacheKey];
    pendingFileInfoCache[cacheKey] = LexeraApi.fileInfo(boardId, filePath)
      .then(function (info) {
        fileInfoCache[cacheKey] = info || null;
        delete pendingFileInfoCache[cacheKey];
        return fileInfoCache[cacheKey];
      })
      .catch(function (err) {
        logFrontendIssue(
          'warn',
          'file.info',
          'Failed to fetch file info for board ' + boardId + ' path ' + filePath,
          err
        );
        delete pendingFileInfoCache[cacheKey];
        return null;
      });
    return pendingFileInfoCache[cacheKey];
  }

  // Synchronous peek at the file-info cache. Used by HTML-generation
  // paths to bake in `broken` state immediately when we already know
  // the file is missing. Returns undefined if the file info has never
  // been fetched, a truthy info object if we know it exists, or `null`
  // if we know the fetch failed / the file does not exist.
  //
  // The async `requestFileInfo` is still the source of truth — this
  // peek only reads the cache it populated. During a re-render (e.g.
  // test teardown restoring a snapshot), previously-probed files are
  // already in the cache and we can bake the broken marker into the
  // HTML straight away, so the enhance pass doesn't have to swap in
  // visible class/title changes after the fact.
  function peekFileInfoSync(boardId, filePath) {
    var cacheKey = getFileInfoCacheKey(boardId, filePath);
    if (Object.prototype.hasOwnProperty.call(fileInfoCache, cacheKey)) {
      return fileInfoCache[cacheKey];
    }
    return undefined;
  }

  function clearCachedFilePreviewState(boardId, filePath) {
    var cacheKey = getEmbedPreviewCacheKey(boardId, filePath);
    var infoKey = getFileInfoCacheKey(boardId, parseLocalFileReference(filePath).path);
    delete embedPreviewCache[cacheKey];
    delete specialPreviewErrorCache[cacheKey];
    delete fileInfoCache[infoKey];
    delete pendingFileInfoCache[infoKey];
  }

  function clearBoardPreviewCaches(boardId) {
    var prefix = String(boardId || '') + '::';
    if (!prefix || prefix === '::') return;
    Object.keys(embedPreviewCache).forEach(function (key) {
      if (key.indexOf(prefix) === 0) delete embedPreviewCache[key];
    });
    Object.keys(fileInfoCache).forEach(function (key) {
      if (key.indexOf(prefix) === 0) delete fileInfoCache[key];
    });
    Object.keys(pendingFileInfoCache).forEach(function (key) {
      if (key.indexOf(prefix) === 0) delete pendingFileInfoCache[key];
    });
    Object.keys(specialPreviewErrorCache).forEach(function (key) {
      if (key.indexOf(prefix) === 0) delete specialPreviewErrorCache[key];
    });
  }

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
    var embedWidth = sanitizeCssLength(container.getAttribute('data-embed-width')) || '100%';
    var embedHeight = sanitizeCssLength(container.getAttribute('data-embed-height')) || '500px';
    var titleText = decodeHtmlEntities(
      container.getAttribute('data-embed-title') ||
      container.getAttribute('data-alt-text') ||
      embedUrl
    );
    return '<iframe class="external-embed-frame" src="' + escapeAttr(embedUrl) + '"' +
      ' title="' + escapeAttr(titleText || embedUrl) + '"' +
      ' loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen frameborder="0"' +
      ' style="' + escapeAttr('width:100%;max-width:' + embedWidth + ';height:' + embedHeight) + '"></iframe>';
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
    var titleText = decodeHtmlEntities(container.getAttribute('data-embed-title') || '');
    var heading = titleText || displayUrl || 'External page';
    var buttonHtml = '';
    var reasonHtml = '';
    if (state && state.ready) {
      buttonHtml = '<button class="external-embed-open-btn" type="button" data-external-embed-action="' +
        escapeAttr(getExternalEmbedPolicyButtonAction(state.policy)) + '">' +
        escapeHtml(getExternalEmbedPolicyButtonLabel(state.policy)) +
        '</button>';
      if (state.policy && state.policy.reason) {
        reasonHtml = '<div class="external-embed-reason">' + escapeHtml(state.policy.reason) + '</div>';
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
      '<div class="external-embed-shell external-embed-shell-' + escapeAttr((state && state.mode) || 'loading') + '">' +
        '<div class="external-embed-label">External page</div>' +
        '<div class="external-embed-heading">' + escapeHtml(heading) + '</div>' +
        '<div class="external-embed-url">' + escapeHtml(embedUrl) + '</div>' +
        '<div class="external-embed-message">' + escapeHtml((state && state.message) || 'Checking whether the page can be embedded…') + '</div>' +
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
    pendingExternalEmbedPolicyCache[cacheKey] = LexeraApi.probeExternalEmbed(normalizedUrl, parentOrigin, forceRefresh)
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

  function encodeUtf8Base64(value) { return PathUtils.encodeUtf8Base64(value); }

  function getPathStem(path) {
    var fileName = getFileNameFromPath(path);
    return fileName ? fileName.replace(/\.[^.]+$/, '') : '';
  }

  function buildDiagramCachePrefix(sourcePath) {
    var basename = getPathStem(sourcePath);
    var pathHash = encodeUtf8Base64(String(sourcePath || '')).replace(/[/+=]/g, '').slice(0, 8);
    return basename + '-' + pathHash + '-';
  }

  function buildDiagramCacheFileName(sourcePath, mtimeMs, extension, suffix) {
    return buildDiagramCachePrefix(sourcePath) + Math.floor(mtimeMs) + (suffix || '') + '.' + extension;
  }

  function buildDiagramCacheDir(boardFilePath, sourcePath, cacheFolderName) {
    var sourceDir = getDirNameFromPath(sourcePath);
    if (!sourceDir) return '';
    var boardDir = getDirNameFromPath(boardFilePath);
    if (!boardDir || normalizePathForCompare(sourceDir) !== normalizePathForCompare(boardDir)) {
      var sourceDirBase = getFileNameFromPath(sourceDir);
      if (!sourceDirBase) return '';
      return sourceDir + '/' + sourceDirBase + '-Media/' + cacheFolderName;
    }
    var boardBase = getPathStem(boardFilePath);
    if (!boardBase) return '';
    return boardDir + '/' + boardBase + '-Media/' + cacheFolderName;
  }

  function getEmbedPreviewPageNumber(previewKind, pageValue) {
    var pageNumber = parseInt(pageValue, 10);
    if (!(pageNumber > 0)) return 1;
    if (previewKind === 'spreadsheet' || previewKind === 'table' || previewKind === 'text' || previewKind === 'epub' || previewKind === 'document') {
      return pageNumber;
    }
    return 1;
  }

  function getSpecialPreviewRenderConfig(previewKind, filePath, pageNumber) {
    var registry = getFileFormatRegistry();
    if (!registry || typeof registry.getPreviewRenderConfig !== 'function') return null;
    return registry.getPreviewRenderConfig(filePath, {
      pageNumber: getEmbedPreviewPageNumber(previewKind, pageNumber)
    });
  }

  async function requestRenderedSpecialPreviewAsset(boardId, filePath, absoluteSourcePath, cachePath, config, renderOptions) {
    if (!hasTauri || !absoluteSourcePath || !cachePath || !config || config.supportsRuntimeRender === false) {
      var reason = !hasTauri ? 'Tauri runtime not available'
        : !absoluteSourcePath ? 'Could not resolve absolute source path'
        : !cachePath ? 'Could not build cache path'
        : !config ? 'No render config'
        : 'Plugin does not support runtime render';
      setSpecialPreviewError(boardId, filePath, reason);
      logFrontendIssue('warn', 'embed.preview.render', reason + ' (' + (config && config.pluginId || '?') + ')', { filePath: filePath });
      return false;
    }
    var force = !!(renderOptions && renderOptions.force);
    var renderKey = String(config.pluginId || '') + '::' + cachePath;
    if (!force && pendingSpecialPreviewRenderCache[renderKey]) {
      return pendingSpecialPreviewRenderCache[renderKey];
    }
    pendingSpecialPreviewRenderCache[renderKey] = tauriInvoke('render_embedded_file', {
      opts: {
        pluginId: config.pluginId,
        sourcePath: absoluteSourcePath,
        targetPath: cachePath,
        pageNumber: config.pageNumber || 1,
        outputFormat: config.outputFormat || config.extension || 'png',
        force: force
      }
    }).then(function (result) {
      delete pendingSpecialPreviewRenderCache[renderKey];
      if (!result || !result.success) {
        var errMsg = result && result.error ? result.error : 'Renderer unavailable.';
        setSpecialPreviewError(boardId, filePath, errMsg);
        logFrontendIssue('warn', 'embed.preview.render',
          config.pluginId + ' render failed for ' + absoluteSourcePath + ': ' + errMsg);
        return false;
      }
      setSpecialPreviewError(boardId, filePath, '');
      return true;
    }).catch(function (err) {
      delete pendingSpecialPreviewRenderCache[renderKey];
      setSpecialPreviewError(boardId, filePath, err && err.message ? err.message : String(err));
      logFrontendIssue(
        'warn',
        'embed.preview.render',
        'Failed to render preview asset for ' + absoluteSourcePath,
        err
      );
      return false;
    });
    return pendingSpecialPreviewRenderCache[renderKey];
  }

  async function resolveCachedSpecialPreviewAsset(boardId, filePath, previewKind, options) {
    if (!boardId || !filePath) {
      logFrontendIssue('warn', 'embed.preview.resolve', 'Missing boardId or filePath for preview', { boardId: boardId, filePath: filePath });
      return null;
    }
    var config = getSpecialPreviewRenderConfig(previewKind, filePath, options && options.pageNumber);
    if (!config) {
      logFrontendIssue('warn', 'embed.preview.resolve', 'No render config for previewKind=' + previewKind, { filePath: filePath });
      return null;
    }

    var boardFilePath = getBoardFilePathForId(boardId);
    if (!boardFilePath) {
      logFrontendIssue('warn', 'embed.preview.resolve', 'No board file path for boardId=' + boardId);
      return null;
    }

    var fileRef = parseLocalFileReference(filePath);
    var sourceInfo = await requestFileInfo(boardId, fileRef.path);
    if (!sourceInfo || !sourceInfo.exists) {
      var missingMsg = 'Source file not found: ' + fileRef.path;
      setSpecialPreviewError(boardId, filePath, missingMsg);
      logFrontendIssue('warn', 'embed.preview.resolve', missingMsg);
      return null;
    }

    var mtimeMs = 0;
    if (typeof sourceInfo.lastModifiedMs === 'number' && isFinite(sourceInfo.lastModifiedMs)) {
      mtimeMs = sourceInfo.lastModifiedMs;
    } else if (typeof sourceInfo.lastModified === 'number' && isFinite(sourceInfo.lastModified)) {
      mtimeMs = sourceInfo.lastModified * 1000;
    }
    if (!(mtimeMs > 0)) {
      var mtimeMsg = 'Source file has no valid mtime: ' + fileRef.path;
      setSpecialPreviewError(boardId, filePath, mtimeMsg);
      logFrontendIssue('warn', 'embed.preview.resolve', mtimeMsg);
      return null;
    }

    var absoluteSourcePath = fileRef.path;
    if (!isAbsoluteFilePath(absoluteSourcePath)) {
      absoluteSourcePath = await resolveBoardPath(boardId, fileRef.path, 'absolute');
    }
    if (!isAbsoluteFilePath(absoluteSourcePath)) {
      var pathMsg = 'Could not resolve absolute path for: ' + fileRef.path;
      setSpecialPreviewError(boardId, filePath, pathMsg);
      logFrontendIssue('warn', 'embed.preview.resolve', pathMsg);
      return null;
    }

    var cacheDir = buildDiagramCacheDir(boardFilePath, absoluteSourcePath, config.cacheFolderName);
    if (!cacheDir) return null;
    var cachePath = cacheDir + '/' + buildDiagramCacheFileName(absoluteSourcePath, mtimeMs, config.extension, config.suffix);
    var forceRerender = !!(options && options.forceRerender);
    var cacheInfo = forceRerender ? null : await requestFileInfo(boardId, cachePath);
    if (!cacheInfo || !cacheInfo.exists) {
      var rendered = await requestRenderedSpecialPreviewAsset(boardId, filePath, absoluteSourcePath, cachePath, config, { force: forceRerender });
      if (!rendered) return null;
      delete fileInfoCache[getFileInfoCacheKey(boardId, cachePath)];
      delete pendingFileInfoCache[getFileInfoCacheKey(boardId, cachePath)];
      cacheInfo = await requestFileInfo(boardId, cachePath);
      if (!cacheInfo || !cacheInfo.exists) return null;
    }

    return {
      path: cachePath,
      url: LexeraApi.fileUrl(boardId, cachePath) + (forceRerender ? '?t=' + Date.now() : ''),
      alt: getDisplayFileNameFromPath(filePath) || filePath
    };
  }

  async function renderCachedSpecialPreview(containerEl, boardId, filePath, previewKind, options) {
    var asset = await resolveCachedSpecialPreviewAsset(boardId, filePath, previewKind, options);
    if (!asset) return false;

    if (options && options.modal) {
      containerEl.innerHTML = '<div class="file-preview-media"><img class="file-preview-image" src="' + escapeAttr(asset.url) + '" alt="' + escapeAttr(asset.alt) + '"></div>';
    } else {
      containerEl.innerHTML = '<img class="file-preview-image" src="' + escapeAttr(asset.url) + '" alt="' + escapeAttr(asset.alt) + '" style="margin:0 auto;max-height:420px;">';
    }
    return true;
  }

  function utf8EncodeBytes(value) { return PathUtils.utf8EncodeBytes(value); }

  function md5Hex(value) { return PathUtils.md5Hex(value); }

  function buildPlantUmlCachePath(boardFilePath, codeHash) {
    var boardDir = getDirNameFromPath(boardFilePath);
    var boardBase = getPathStem(boardFilePath);
    if (!boardDir || !boardBase || !codeHash) return '';
    return boardDir + '/' + boardBase + '-Media/plantuml-cache/' + codeHash + '.svg';
  }

  function requestRenderedPlantUmlSvg(boardId, code) {
    if (!hasTauri) return Promise.reject(new Error('PlantUML renderer requires the desktop backend'));
    var source = String(code || '');
    if (!source) return Promise.reject(new Error('PlantUML source is empty'));
    var codeHash = md5Hex(source).slice(0, 12);
    var cacheKey = String(boardId || '') + '::' + codeHash;
    if (pendingPlantUmlRenderCache[cacheKey]) {
      return pendingPlantUmlRenderCache[cacheKey];
    }
    var targetPath = null;
    if (boardId) {
      var boardFilePath = getBoardFilePathForId(boardId);
      if (boardFilePath) {
        targetPath = buildPlantUmlCachePath(boardFilePath, codeHash) || null;
      }
    }
    pendingPlantUmlRenderCache[cacheKey] = tauriInvoke('render_plantuml_code', {
      opts: {
        code: source,
        targetPath: targetPath
      }
    }).then(function (result) {
      delete pendingPlantUmlRenderCache[cacheKey];
      if (!result || !result.success || !result.svg) {
        throw new Error(result && result.error ? result.error : 'PlantUML render unavailable');
      }
      return String(result.svg || '');
    }).catch(function (err) {
      delete pendingPlantUmlRenderCache[cacheKey];
      throw err;
    });
    return pendingPlantUmlRenderCache[cacheKey];
  }

  function isAbsoluteFilePath(value) { return PathUtils.isAbsoluteFilePath(value); }

  function isBoardRelativePath(value) { return PathUtils.isBoardRelativePath(value); }

  function joinBoardRelativePath(baseDir, relativePath) { return PathUtils.joinBoardRelativePath(baseDir, relativePath); }

  function computeRelativePath(fromDir, toPath) { return PathUtils.computeRelativePath(fromDir, toPath); }

  function getIncludePreviewContextPath(container) {
    var includeBody = container ? container.closest('.include-inline-body') : null;
    if (!includeBody) return '';
    var includeContainer = includeBody.closest('.include-inline-container[data-file-path]');
    if (!includeContainer) return '';
    return String(includeContainer.getAttribute('data-file-path') || '').trim();
  }

  /// If the container is inside an include column, convert a board-relative path
  /// to be relative to the include file's directory instead.
  function adjustPathForIncludeContext(container, boardRelPath) {
    var includePath = getIncludePreviewContextPath(container);
    if (!includePath) {
      var cardEl = container ? container.closest('.card[data-card-id]') : null;
      if (!cardEl) return boardRelPath;
      var cardRef = findCardRefById(cardEl.getAttribute('data-card-id'));
      if (!cardRef) return boardRelPath;
      var col = cardRef.column;
      if (!col || !col.includeSource || !col.includeSource.rawPath) return boardRelPath;
      includePath = col.includeSource.rawPath;
    }
    var includeDir = getDirNameFromPath(includePath);
    if (!includeDir) return boardRelPath;
    return computeRelativePath(includeDir, boardRelPath);
  }

  function resolveMarkdownRelativeTargets(content, includeFilePath) {
    var baseDir = getDirNameFromPath(includeFilePath);
    if (!baseDir) return String(content || '');

    var rewritten = String(content || '');

    rewritten = rewritten.replace(/!\[([^\]]*)\]\(([^)]+)\)(\{[^}]+\})?/g, function (match, alt, rawTarget, rawAttrs) {
      var parsed = parseMarkdownTarget(rawTarget);
      if (!isBoardRelativePath(parsed.path)) return match;
      return buildMarkdownEmbed(
        alt,
        joinBoardRelativePath(baseDir, parsed.path),
        parsed.title,
        rawAttrs || ''
      );
    });

    rewritten = rewritten.replace(/\[([^\]]+)\]\(([^)]+)\)/g, function (match, label, rawTarget) {
      var parsed = parseMarkdownTarget(rawTarget);
      if (!isBoardRelativePath(parsed.path)) return match;
      var nextPath = joinBoardRelativePath(baseDir, parsed.path);
      return '[' + label + '](' + nextPath + (parsed.title ? ' ' + parsed.title : '') + ')';
    });

    rewritten = rewritten.replace(/!!!include\(([^)]+)\)!!!/g, function (match, rawPath) {
      if (!isBoardRelativePath(rawPath)) return match;
      return '!!!include(' + joinBoardRelativePath(baseDir, rawPath) + ')!!!';
    });

    return rewritten;
  }

  function getCachedIncludeResolvedContent(content, includeFilePath) {
    var cacheKey = String(includeFilePath || '') + '\n@@\n' + String(content || '');
    if (includeResolvedContentCache.has(cacheKey)) {
      return includeResolvedContentCache.get(cacheKey);
    }
    var resolved = resolveMarkdownRelativeTargets(content, includeFilePath);
    includeResolvedContentCache.set(cacheKey, resolved);
    if (includeResolvedContentCache.size > MAX_INCLUDE_RESOLVED_CONTENT_CACHE_ENTRIES) {
      var firstKey = includeResolvedContentCache.keys().next();
      if (!firstKey.done) includeResolvedContentCache.delete(firstKey.value);
    }
    return resolved;
  }

  function getIncludeResolvedContent(content, colIndex) {
    var col = getFullColumn(colIndex);
    if (col && col.includeSource && col.includeSource.rawPath) {
      return getCachedIncludeResolvedContent(content, col.includeSource.rawPath);
    }
    return content;
  }

  function applyFileLinkInfo(link, info, filePath) {
    if (!link) return;
    var isMissing = !!(info && info.exists === false && !info.external);
    link.classList.toggle('link-broken', isMissing);
    var container = link.closest('.link-path-overlay-container');
    if (container) container.classList.toggle('link-broken', isMissing);
    if (isMissing) {
      link.setAttribute('title', 'Missing file: ' + String(filePath || ''));
    }
  }

  function buildBoardFileLinkWrapper(filePath, boardId, linkHtml, options) {
    options = options || {};
    var indexAttr = options.linkIndex != null
      ? ' data-link-index="' + escapeAttr(String(options.linkIndex)) + '"'
      : '';
    var editableAttr = options.editable === false ? ' data-link-editable="0"' : ' data-link-editable="1"';
    var wrapperStyle = 'display:inline-flex;align-items:center;gap:2px;vertical-align:baseline;max-width:100%';
    var buttonStyle = 'position:static;top:auto;right:auto;opacity:1;margin:0 0 0 2px';
    var buttonTitle = options.buttonTitle || 'Path options';
    // `preKnownMissing` is set by `renderBoardFileLinkHtml` when the
    // sync file-info cache peek already tells us the file is missing.
    // Bake in `link-broken` so we don't flicker on re-render.
    var wrapperClass = 'link-path-overlay-container' + (options.preKnownMissing ? ' link-broken' : '');
    return '<span class="' + wrapperClass + '" data-board-id="' + escapeAttr(boardId || '') + '"' +
      ' data-file-path="' + escapeAttr(filePath || '') + '"' +
      ' style="' + escapeAttr(wrapperStyle) + '"' +
      editableAttr +
      indexAttr + '>' +
      linkHtml +
      '<button class="embed-menu-btn link-menu-btn" data-action="link-menu" title="' + escapeAttr(buttonTitle) + '" style="' + escapeAttr(buttonStyle) + '">&#8942;</button>' +
      '</span>';
  }

  function buildIncludeDirectiveWrapper(filePath, boardId, linkHtml, options) {
    options = options || {};
    var wrapperClass = options.expandPreview ? 'include-inline-container' : 'include-link-container';
    var depthAttr = options.expandPreview
      ? ' data-include-depth="' + escapeAttr(String(options.depth || 0)) + '"'
      : '';
    var indexAttr = options.includeIndex != null
      ? ' data-include-index="' + escapeAttr(String(options.includeIndex)) + '"'
      : '';
    var actionButton = options.allowActions === false
      ? ''
      : '<button class="embed-menu-btn include-menu-btn" type="button" title="Include actions">&#8942;</button>';
    return '<span class="' + wrapperClass + '" data-board-id="' + escapeAttr(boardId || '') + '"' +
      ' data-file-path="' + escapeAttr(filePath || '') + '"' +
      depthAttr +
      indexAttr + '>' +
      '<span style="display:inline-flex;align-items:center;gap:4px;max-width:100%">' +
      linkHtml +
      actionButton +
      '</span>' +
      (options.expandPreview ? '<span class="include-inline-body"></span>' : '') +
      '</span>';
  }

  function getIncludePreviewMarkup(filePath, boardId, depth, includeIndex) {
    var linkHtml = renderBoardFileLinkHtml(
      filePath,
      boardId,
      '!(' + escapeHtml(getDisplayNameFromPath(filePath) || filePath) + ')!',
      'Include: ' + filePath,
      'include-filename-link'
    );
    return buildIncludeDirectiveWrapper(filePath, boardId, linkHtml, {
      expandPreview: true,
      depth: depth,
      includeIndex: includeIndex,
      allowActions: true
    });
  }

  function findCardRefById(cardId) {
    if (!fullBoardData || !fullBoardData.rows || !cardId) return null;
    for (var r = 0; r < fullBoardData.rows.length; r++) {
      var row = fullBoardData.rows[r];
      if (!row || !row.stacks) continue;
      for (var s = 0; s < row.stacks.length; s++) {
        var stack = row.stacks[s];
        if (!stack || !stack.columns) continue;
        for (var c = 0; c < stack.columns.length; c++) {
          var col = stack.columns[c];
          if (!col || !col.cards) continue;
          for (var i = 0; i < col.cards.length; i++) {
            var card = col.cards[i];
            if (String(card.id) === String(cardId)) {
              return {
                rowIndex: r,
                stackIndex: s,
                colIndex: c,
                cardIndex: i,
                column: col,
                card: card
              };
            }
          }
        }
      }
    }
    return null;
  }

  function parseMarkdownTarget(rawTarget) {
    var trimmed = String(rawTarget || '').trim();
    var title = '';
    var titleMatch = trimmed.match(/^(.*?)(\s+(&quot;|")[^"]*(&quot;|"))$/);
    if (titleMatch) {
      trimmed = titleMatch[1].trim();
      title = titleMatch[2].trim();
    }
    return {
      path: trimmed,
      title: title
    };
  }

  function normalizeMarkdownAttrValue(value) {
    return String(value || '').trim().replace(/^['"]|['"]$/g, '');
  }

  function sanitizeCssLength(value) {
    var normalized = normalizeMarkdownAttrValue(value);
    if (!normalized) return '';
    if (/^\d+(?:\.\d+)?$/.test(normalized)) return normalized + 'px';
    if (/^\d+(?:\.\d+)?(?:px|%|vh|vw|rem|em)$/.test(normalized)) return normalized;
    if (normalized === 'auto') return normalized;
    return '';
  }

  function parseMarkdownImageAttributes(attrText) {
    var raw = String(attrText || '').trim();
    var parsed = {
      raw: raw,
      values: {},
      classes: []
    };
    if (!raw) return parsed;

    var body = raw.replace(/^\{\s*|\s*\}$/g, '');
    body.replace(/(^|\s)\.([a-zA-Z0-9_-]+)/g, function (_, __, className) {
      parsed.classes.push(className.toLowerCase());
      return _;
    });
    body.replace(/([a-zA-Z_:][\w:-]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s}]+))/g, function (_, key, __, doubleQuoted, singleQuoted, bareValue) {
      parsed.values[key.toLowerCase()] = normalizeMarkdownAttrValue(doubleQuoted || singleQuoted || bareValue || '');
      return _;
    });
    return parsed;
  }

  var KNOWN_EXTERNAL_EMBED_PATTERNS = [
    'miro.com/app/live-embed',
    'miro.com/app/embed',
    'figma.com/embed',
    'figma.com/file',
    'figma.com/proto',
    'youtube.com/embed',
    'youtube-nocookie.com/embed',
    'youtu.be',
    'vimeo.com/video',
    'player.vimeo.com',
    'codepen.io/*/embed',
    'codesandbox.io/embed',
    'codesandbox.io/s',
    'stackblitz.com/edit',
    'jsfiddle.net/*/embedded',
    'docs.google.com/presentation',
    'docs.google.com/document',
    'docs.google.com/spreadsheets',
    'notion.so',
    'airtable.com/embed',
    'loom.com/embed',
    'loom.com/share',
    'prezi.com/p/embed',
    'prezi.com/v/embed',
    'ars.particify.de/present'
  ];

  function isExternalHttpUrl(value) {
    return /^https?:\/\//i.test(String(value || ''));
  }

  function isKnownExternalEmbedUrl(url) {
    if (!isExternalHttpUrl(url)) return false;
    try {
      var parsed = new URL(url);
      var hostPath = (parsed.host + parsed.pathname).toLowerCase();
      for (var i = 0; i < KNOWN_EXTERNAL_EMBED_PATTERNS.length; i++) {
        var pattern = KNOWN_EXTERNAL_EMBED_PATTERNS[i].toLowerCase();
        var regex = new RegExp('^' + escapeRegex(pattern).replace(/\\\*/g, '[^/]+'));
        if (regex.test(hostPath)) return true;
      }
    } catch (e) {
      return false;
    }
    return false;
  }

  function hasForcedExternalEmbedFlag(imageAttrs) {
    if (!imageAttrs) return false;
    if (imageAttrs.classes.indexOf('embed') !== -1) return true;
    var embedValue = imageAttrs.values.embed;
    return embedValue != null && embedValue !== '' && embedValue !== 'false' && embedValue !== '0';
  }

  function parseExternalEmbedStartSeconds(rawValue) {
    var value = String(rawValue || '').trim();
    if (!value) return 0;
    if (/^\d+$/.test(value)) return Math.max(0, parseInt(value, 10));
    var match = value.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/i);
    if (!match) return 0;
    var hours = parseInt(match[1] || '0', 10);
    var minutes = parseInt(match[2] || '0', 10);
    var seconds = parseInt(match[3] || '0', 10);
    return Math.max(0, (hours * 3600) + (minutes * 60) + seconds);
  }

  function buildYouTubeEmbedUrl(parsedUrl, videoId) {
    if (!videoId) return '';
    var embedUrl = new URL('https://www.youtube.com/embed/' + encodeURIComponent(videoId));
    var listValue = parsedUrl && parsedUrl.searchParams ? parsedUrl.searchParams.get('list') : '';
    var startSeconds = parsedUrl && parsedUrl.searchParams
      ? parseExternalEmbedStartSeconds(parsedUrl.searchParams.get('start') || parsedUrl.searchParams.get('t'))
      : 0;
    if (listValue) embedUrl.searchParams.set('list', listValue);
    if (startSeconds > 0) embedUrl.searchParams.set('start', String(startSeconds));
    return embedUrl.toString();
  }

  function getCanonicalExternalEmbedFrameUrl(url) {
    if (!isExternalHttpUrl(url)) return '';
    try {
      var parsed = new URL(url);
      var host = (parsed.hostname || '').toLowerCase();
      var pathname = parsed.pathname || '';
      var pathParts = pathname.split('/').filter(Boolean);
      var videoId = '';

      if (host === 'youtu.be') {
        videoId = pathParts[0] || '';
        return buildYouTubeEmbedUrl(parsed, videoId);
      }

      if (
        host === 'youtube.com' ||
        host === 'www.youtube.com' ||
        host === 'm.youtube.com' ||
        host === 'music.youtube.com' ||
        host === 'youtube-nocookie.com' ||
        host === 'www.youtube-nocookie.com'
      ) {
        if (pathParts[0] === 'embed' && pathParts[1]) {
          return parsed.toString();
        }
        if (pathParts[0] === 'watch') {
          videoId = parsed.searchParams.get('v') || '';
          return buildYouTubeEmbedUrl(parsed, videoId);
        }
        if ((pathParts[0] === 'shorts' || pathParts[0] === 'live') && pathParts[1]) {
          return buildYouTubeEmbedUrl(parsed, pathParts[1]);
        }
      }

      if (host === 'vimeo.com' || host === 'www.vimeo.com') {
        if (pathParts.length === 1 && /^\d+$/.test(pathParts[0])) {
          return 'https://player.vimeo.com/video/' + pathParts[0];
        }
      }

      if ((host === 'loom.com' || host === 'www.loom.com') && pathParts[0] === 'share' && pathParts[1]) {
        return 'https://www.loom.com/embed/' + encodeURIComponent(pathParts[1]);
      }
    } catch (err) {
      return '';
    }
    return '';
  }

  function getExternalEmbedConfig(url, imageAttrs) {
    if (!isExternalHttpUrl(url)) return null;
    var normalizedSourceUrl = normalizeExternalEmbedUrlForCache(url) || String(url || '').trim();
    var frameUrl = getCanonicalExternalEmbedFrameUrl(normalizedSourceUrl);
    if (frameUrl) {
      return {
        sourceUrl: normalizedSourceUrl,
        frameUrl: frameUrl,
        probeUrl: frameUrl
      };
    }
    if (isKnownExternalEmbedUrl(normalizedSourceUrl) || hasForcedExternalEmbedFlag(imageAttrs)) {
      return {
        sourceUrl: normalizedSourceUrl,
        frameUrl: normalizedSourceUrl,
        probeUrl: normalizedSourceUrl
      };
    }
    return null;
  }

  function shouldRenderExternalEmbed(url, imageAttrs) {
    return !!getExternalEmbedConfig(url, imageAttrs);
  }

  function renderInlineFileEmbedHtml(filePath, boardId, altText, titleText, extension, embedIndex) {
    var label = decodeHtmlEntities(String(altText || '').trim()) || getDisplayFileNameFromPath(filePath) || filePath;
    var typeLabel = String(extension || 'file').replace(/^\./, '').toUpperCase();
    var wrapperStyle = 'display:block;margin:8px 0;border:1px solid var(--border);border-radius:8px;background:var(--bg-secondary);overflow:hidden';
    var headerStyle = 'display:flex;align-items:center;gap:8px;padding:6px 8px;border-bottom:1px solid var(--border);background:var(--bg-tertiary)';
    var typeStyle = 'font-size:10px;font-weight:700;letter-spacing:0.04em;color:var(--text-muted)';
    var labelStyle = 'font-size:12px;font-weight:600;color:var(--accent);cursor:pointer;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
    var buttonStyle = 'position:static;top:auto;right:auto;opacity:1';
    var captionHtml = titleText
      ? '<div class="media-caption" style="padding:6px 8px 8px">' + renderInline(titleText, boardId, { footnoteDefs: {}, footnoteOrder: [], abbrDefs: {}, embedCounter: 0, linkCounter: 0 }) + '</div>'
      : '';
    return '<div class="inline-file-embed-container" data-file-path="' + escapeAttr(filePath) + '" data-board-id="' + escapeAttr(boardId || '') + '"' +
      ' data-inline-type="' + escapeAttr(String(extension || '').toLowerCase()) + '"' +
      ' data-embed-index="' + escapeAttr(String(embedIndex)) + '"' +
      ' data-media-type="inline-file" style="' + escapeAttr(wrapperStyle) + '">' +
      '<div class="inline-file-embed-header" style="' + escapeAttr(headerStyle) + '">' +
      '<span class="inline-file-embed-type" style="' + escapeAttr(typeStyle) + '">' + escapeHtml(typeLabel) + '</span>' +
      '<span class="inline-file-embed-label" data-action="open-inline-file" style="' + escapeAttr(labelStyle) + '">' + escapeHtml(label) + '</span>' +
      '<button class="embed-menu-btn inline-file-menu-btn" data-action="inline-file-menu" title="File options" style="' + escapeAttr(buttonStyle) + '">&#8942;</button>' +
      '</div>' +
      '<div class="inline-file-embed-body" style="padding:8px"><div class="embed-preview-loading">Loading preview...</div></div>' +
      captionHtml +
      '</div>';
  }

  function renderBoardFileLinkHtml(filePath, boardId, labelHtml, titleText, extraClass, options) {
    options = options || {};
    var normalizedPath = decodeHtmlEntities(String(filePath || '').trim());
    if (!normalizedPath) return labelHtml || '';
    // Synchronously check whether we already know this file is missing.
    // If so, bake the `link-broken` class + title directly into the
    // generated HTML so the enhance pass doesn't produce a visible
    // "broken file appeared" flicker on every re-render. Skip the peek
    // for absolute URLs, mailto:, #anchors — those don't live in the
    // board file tree and the cache will never have them.
    var isLocalFile = normalizedPath && !/^(https?:\/\/|mailto:|#)/i.test(normalizedPath);
    var preKnownMissing = false;
    var preKnownInfo;
    if (isLocalFile && boardId) {
      preKnownInfo = peekFileInfoSync(boardId, parseLocalFileReference(normalizedPath).path);
      preKnownMissing = !!(preKnownInfo && preKnownInfo.exists === false && !preKnownInfo.external);
    }
    var className = 'markdown-file-link';
    if (extraClass) className += ' ' + extraClass;
    if (preKnownMissing) className += ' link-broken';
    var boardAttr = boardId ? ' data-board-id="' + escapeAttr(boardId) + '"' : '';
    // If we know the file is missing, override the caller's title with
    // the standard "Missing file: ..." title used by `applyFileLinkInfo`.
    // Otherwise preserve the caller's title (e.g. "Include: path").
    var effectiveTitle = preKnownMissing
      ? ('Missing file: ' + normalizedPath)
      : titleText;
    var titleAttr = effectiveTitle ? ' title="' + escapeAttr(effectiveTitle) + '"' : '';
    var linkHtml = '<a href="#" class="' + className + '"' + boardAttr +
      ' data-file-path="' + escapeAttr(normalizedPath) + '"' +
      ' data-original-href="' + escapeAttr(normalizedPath) + '"' +
      titleAttr + '>' + labelHtml + '</a>';
    if (!options.withMenu) return linkHtml;
    // Pass preKnownMissing so the wrapper picks up `link-broken` too —
    // applyFileLinkInfo normally toggles it on both the <a> and the
    // parent `.link-path-overlay-container`.
    var wrapperOptions = options;
    if (preKnownMissing) {
      wrapperOptions = {};
      for (var _k in options) if (Object.prototype.hasOwnProperty.call(options, _k)) wrapperOptions[_k] = options[_k];
      wrapperOptions.preKnownMissing = true;
    }
    return buildBoardFileLinkWrapper(normalizedPath, boardId, linkHtml, wrapperOptions);
  }

  function renderMarkdownLinkHtml(targetHref, boardId, labelHtml, titleText, extraClass, options) {
    options = options || {};
    var normalizedHref = decodeHtmlEntities(String(targetHref || '').trim());
    if (!normalizedHref) return labelHtml || '';
    var className = 'markdown-inline-link';
    if (extraClass) className += ' ' + extraClass;
    var boardAttr = boardId ? ' data-board-id="' + escapeAttr(boardId) + '"' : '';
    var titleAttr = titleText ? ' title="' + escapeAttr(titleText) + '"' : '';
    var targetAttr = /^https?:\/\//i.test(normalizedHref) ? ' target="_blank" rel="noopener noreferrer"' : '';
    var linkHtml = '<a href="' + escapeAttr(normalizedHref) + '" class="' + className + '"' + boardAttr +
      ' data-original-href="' + escapeAttr(normalizedHref) + '"' +
      titleAttr + targetAttr + '>' + labelHtml + '</a>';
    if (!options.withMenu) return linkHtml;
    return buildBoardFileLinkWrapper(normalizedHref, boardId, linkHtml, {
      linkIndex: options.linkIndex,
      editable: options.editable !== false,
      buttonTitle: options.buttonTitle || 'Link options'
    });
  }

  function renderIncludeDirectiveHtml(rawPath, boardId, extraClass, options) {
    options = options || {};
    var includePath = decodeHtmlEntities(String(rawPath || '').trim());
    if (!includePath) return '<span class="broken-include-placeholder">!()!</span>';
    if (options.expandPreview) {
      return getIncludePreviewMarkup(
        includePath,
        boardId,
        options.depth || 0,
        options.includeIndex
      );
    }
    var displayName = getDisplayNameFromPath(includePath) || includePath;
    var linkHtml = renderBoardFileLinkHtml(
      includePath,
      boardId,
      '!(' + escapeHtml(displayName) + ')!',
      'Include: ' + includePath,
      extraClass || 'include-filename-link'
    );
    return buildIncludeDirectiveWrapper(includePath, boardId, linkHtml, {
      includeIndex: options.includeIndex,
      allowActions: options.allowActions
    });
  }

  function renderWikiLinkHtml(documentName, labelHtml, options) {
    options = options || {};
    var resolved = resolveWikiDocument(documentName);
    var containerClass = 'wiki-link-container';
    var boardAttr = '';
    if (resolved.kind === 'missing') containerClass += ' wiki-broken';
    if (resolved.boardId) boardAttr = ' data-board-id="' + escapeAttr(resolved.boardId) + '"';
    return '<span class="' + containerClass + '" data-document="' + escapeAttr(documentName) + '"' + boardAttr + '>' +
      '<a href="#" class="wiki-link" data-document="' + escapeAttr(documentName) + '"' + boardAttr + ' title="Wiki link: ' + escapeAttr(documentName) + '">' + labelHtml + '</a>' +
      (options.withMenu ? '<button class="wiki-menu-btn" data-action="wiki-menu" title="Wiki link options">☰</button>' : '') +
      '</span>';
  }

  function isGenericMarkdownLinkTarget(target) {
    return /^(https?:\/\/|mailto:|#)/i.test(String(target || '').trim());
  }

  function openMarkdownLinkTarget(target) {
    var href = String(target || '').trim();
    if (!href) return;
    if (/^(https?:\/\/|mailto:)/i.test(href)) {
      openUrlInSystem(href);
      return;
    }
    if (href.charAt(0) === '#') {
      if (href.indexOf('#footnote-') === 0) {
        var footnoteTarget = null;
        try { footnoteTarget = document.querySelector(href); } catch (_) { footnoteTarget = null; }
        if (footnoteTarget && typeof footnoteTarget.scrollIntoView === 'function') {
          footnoteTarget.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
      } else {
        openWikiSearch(href);
      }
    }
  }

  function renderTemporalTagHtml(tag) {
    var temporal = describeTemporalTag(tag);
    if (!temporal) return escapeHtml(tag);
    return '<span class="temporal-tag kanban-temporal-tag kanban-temporal-' + temporal.type + '" data-temporal-type="' + temporal.type + '" title="' + escapeAttr(temporal.resolved) + '">' + escapeHtml(tag) + '</span>';
  }

  function normalizeCssColorString(value) {
    return String(value || '').trim().toLowerCase();
  }

  function resolveTagChipBorderColor(backgroundColor, textColor, explicitBorderColor) {
    var normalizedBackground = normalizeCssColorString(backgroundColor);
    var normalizedBorder = normalizeCssColorString(explicitBorderColor);
    if (normalizedBorder && normalizedBorder !== normalizedBackground) return explicitBorderColor;
    return String(textColor || '').trim().toLowerCase() === '#fff'
      ? 'rgba(255, 255, 255, 0.34)'
      : 'rgba(0, 0, 0, 0.26)';
  }

  function renderTagChipHtml(tag) {
    var descriptor = buildTagStyleDescriptor(tag) || {};
    var backgroundColor = descriptor.badge && descriptor.badge.color
      ? descriptor.badge.color
      : (descriptor.color || getTagColor(tag));
    var textColor = descriptor.badge && descriptor.badge.labelColor
      ? descriptor.badge.labelColor
      : getContrastingTextColor(backgroundColor);
    var border = descriptor.border || {};
    var declarations = [
      'background:' + backgroundColor,
      'color:' + textColor,
      '--tag-chip-border-color:' + resolveTagChipBorderColor(backgroundColor, textColor, border.color),
      '--tag-chip-border-width:' + (border.width || '1px'),
      '--tag-chip-border-style:' + (border.style || 'solid')
    ];
    return '<span class="tag" data-tag="' + escapeAttr(tag) + '" style="' + escapeAttr(declarations.join(';')) + '">' + escapeHtml(tag) + '</span>';
  }

  function getMarkdownMediaStyleAttr(imageAttrs, options) {
    options = options || {};
    if (!imageAttrs) return '';
    var styles = [];
    var width = sanitizeCssLength(imageAttrs.values.width);
    var height = sanitizeCssLength(imageAttrs.values.height);
    if (width) styles.push('width:' + width);
    if (height) styles.push('height:' + height);
    if (!options.allowHeightOnImages && height && styles.length === 1) {
      return ' style="' + escapeAttr('max-height:' + height) + '"';
    }
    if (height && !options.allowHeightOnImages) {
      styles.push('max-height:' + height);
    }
    return styles.length > 0 ? ' style="' + escapeAttr(styles.join(';')) + '"' : '';
  }

  function buildMarkdownEmbed(alt, path, title, attrsText) {
    return '![' + (alt || '') + '](' + path + (title ? ' ' + title : '') + ')' + (attrsText || '');
  }

  function replaceNthMarkdownEmbed(content, targetIndex, replacer) {
    var matchIndex = 0;
    return String(content || '').replace(/!\[([^\]]*)\]\(([^)]+)\)(\{[^}]+\})?/g, function (match, alt, rawTarget, rawAttrs) {
      var currentIndex = matchIndex++;
      if (currentIndex !== targetIndex) return match;
      var parsed = parseMarkdownTarget(rawTarget);
      return replacer({
        match: match,
        alt: alt,
        rawTarget: rawTarget,
        rawAttrs: rawAttrs || '',
        imageAttrs: parseMarkdownImageAttributes(rawAttrs),
        path: parsed.path,
        title: parsed.title
      });
    });
  }

  function replaceNthMarkdownLink(content, targetIndex, replacer) {
    var matchIndex = 0;
    return String(content || '').replace(/\[([^\]]+)\]\(([^)]+)\)/g, function (match, label, rawTarget) {
      var currentIndex = matchIndex++;
      if (currentIndex !== targetIndex) return match;
      var parsed = parseMarkdownTarget(rawTarget);
      return replacer({
        match: match,
        label: label,
        rawTarget: rawTarget,
        path: parsed.path,
        title: parsed.title
      });
    });
  }

  function normalizeCardContentAfterInlineMutation(content) {
    return String(content || '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/^\s+$/gm, '');
  }

  async function mutateEmbedSource(container, contentMutator) {
    if (!container || typeof contentMutator !== 'function') return false;
    var includePath = getIncludePreviewContextPath(container);
    if (includePath) {
      if (!hasTauri) return false;
      var includeBoardId = activeBoardId || '';
      var includeContainer = container.closest('.include-inline-container[data-file-path][data-board-id]');
      if (includeContainer) {
        includeBoardId = includeContainer.getAttribute('data-board-id') || includeBoardId;
      }
      if (!includeBoardId) return false;
      var includeAbsolutePath = await resolveBoardPath(includeBoardId, includePath, 'absolute');
      var includeContent;
      try {
        includeContent = await tauriInvoke('read_text_file', { path: includeAbsolutePath });
      } catch (err) {
        logFrontendIssue('warn', 'embed.include-source', 'Failed to read included file ' + includePath, err);
        return false;
      }
      var nextIncludeContent = contentMutator(includeContent || '');
      if (typeof nextIncludeContent !== 'string' || nextIncludeContent === includeContent) return false;
      try {
        await tauriInvoke('write_text_file', {
          path: includeAbsolutePath,
          content: normalizeCardContentAfterInlineMutation(nextIncludeContent)
        });
      } catch (err) {
        logFrontendIssue('warn', 'embed.include-source', 'Failed to write included file ' + includePath, err);
        return false;
      }
      clearCachedFilePreviewState(includeBoardId, includePath);
      refreshVisibleBoardFileEmbeds(includeBoardId, includePath);
      refreshVisibleIncludePreviews(includeBoardId, includePath);
      if (currentCardEditor && currentCardEditor.preview && currentCardEditor.preview.contains(container)) {
        refreshCardEditorPreview();
      }
      return true;
    }
    if (currentCardEditor && currentCardEditor.wysiwygWrap && currentCardEditor.wysiwygWrap.contains(container)) {
      var currentWysiwygValue = currentCardEditor.wysiwyg &&
        typeof currentCardEditor.wysiwyg.getMarkdown === 'function'
        ? (currentCardEditor.wysiwyg.getMarkdown() || '')
        : (currentCardEditor.textarea ? currentCardEditor.textarea.value : '');
      var nextWysiwygValue = contentMutator(currentWysiwygValue);
      if (typeof nextWysiwygValue !== 'string' || nextWysiwygValue === currentWysiwygValue) return false;
      setCurrentCardEditorMarkdown(normalizeCardContentAfterInlineMutation(nextWysiwygValue));
      if (currentCardEditor && currentCardEditor.mode === 'wysiwyg') {
        var editor = ensureCardEditorWysiwyg();
        if (editor && typeof editor.focus === 'function') editor.focus();
      }
      return true;
    }
    if (currentCardEditor && currentCardEditor.preview && currentCardEditor.preview.contains(container)) {
      var currentValue = currentCardEditor.textarea ? currentCardEditor.textarea.value : '';
      var nextEditorValue = contentMutator(currentValue);
      if (typeof nextEditorValue !== 'string' || nextEditorValue === currentValue) return false;
      setCurrentCardEditorMarkdown(normalizeCardContentAfterInlineMutation(nextEditorValue));
      return true;
    }

    var cardEl = container.closest('.card[data-card-id]');
    if (!cardEl) return false;
    var cardRef = findCardRefById(cardEl.getAttribute('data-card-id'));
    if (!cardRef || !cardRef.card) return false;
    var nextValue = contentMutator(cardRef.card.content || '');
    if (typeof nextValue !== 'string' || nextValue === cardRef.card.content) return false;
    pushUndo();
    cardRef.card.content = normalizeCardContentAfterInlineMutation(nextValue);
    var colIndex = parseInt(cardEl.getAttribute('data-col-index'), 10);
    var cardIndex = parseInt(cardEl.getAttribute('data-card-index'), 10);
    return persistBoardMutation({
      targets: [{ type: 'card-content', colIndex: colIndex, cardIndex: cardIndex }]
    });
  }

  // ── Browser-based Office document rendering (docx-preview, SheetJS) ──

  async function renderOfficeBrowserPreview(previewEl, boardId, filePath, previewKind) {
    var ext = getFileExtension(filePath).toLowerCase();
    var fileRef = parseLocalFileReference(filePath);

    // docx rendering via docx-preview
    if ((ext === 'docx' || ext === 'doc') && typeof window.docx !== 'undefined' && typeof window.docx.renderAsync === 'function') {
      previewEl.innerHTML = '<div class="embed-preview-loading">Loading document...</div>';
      try {
        var response = await fetch(LexeraApi.fileUrl(boardId, fileRef.path));
        if (!response.ok) throw new Error('Failed to fetch docx');
        var buf = await response.arrayBuffer();
        previewEl.innerHTML = '';
        var bodyEl = document.createElement('div');
        bodyEl.className = 'office-docx-body';
        var styleEl = document.createElement('style');
        previewEl.appendChild(styleEl);
        previewEl.appendChild(bodyEl);
        await window.docx.renderAsync(buf, bodyEl, styleEl, {
          className: 'docx',
          inWrapper: true,
          ignoreWidth: true,
          ignoreHeight: true,
          breakPages: false,
          renderHeaders: true,
          renderFooters: true
        });
        return true;
      } catch (err) {
        logFrontendIssue('warn', 'office.docx', 'Failed to render docx: ' + filePath, err);
        return false;
      }
    }

    // xlsx rendering via SheetJS
    if ((ext === 'xlsx' || ext === 'xls' || ext === 'ods' || ext === 'csv') && typeof window.XLSX !== 'undefined') {
      previewEl.innerHTML = '<div class="embed-preview-loading">Loading spreadsheet...</div>';
      try {
        var response = await fetch(LexeraApi.fileUrl(boardId, fileRef.path));
        if (!response.ok) throw new Error('Failed to fetch spreadsheet');
        var buf = await response.arrayBuffer();
        var workbook = window.XLSX.read(buf);
        if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
          previewEl.innerHTML = '<div class="embed-preview-error">No sheets found</div>';
          return true;
        }
        var sheetName = workbook.SheetNames[0];
        var html = window.XLSX.utils.sheet_to_html(workbook.Sheets[sheetName]);
        previewEl.innerHTML = '<div class="office-xlsx-body">' + html + '</div>';
        if (workbook.SheetNames.length > 1) {
          var tabs = '<div class="office-sheet-tabs">';
          for (var si = 0; si < workbook.SheetNames.length; si++) {
            tabs += '<button class="office-sheet-tab' + (si === 0 ? ' active' : '') + '" data-sheet-index="' + si + '">' +
              escapeHtml(workbook.SheetNames[si]) + '</button>';
          }
          tabs += '</div>';
          previewEl.insertAdjacentHTML('afterbegin', tabs);
          previewEl.addEventListener('click', function (e) {
            var tab = e.target.closest('.office-sheet-tab[data-sheet-index]');
            if (!tab) return;
            var idx = parseInt(tab.getAttribute('data-sheet-index'), 10);
            var name = workbook.SheetNames[idx];
            if (!name) return;
            var body = previewEl.querySelector('.office-xlsx-body');
            if (body) body.innerHTML = window.XLSX.utils.sheet_to_html(workbook.Sheets[name]);
            var allTabs = previewEl.querySelectorAll('.office-sheet-tab');
            for (var ti = 0; ti < allTabs.length; ti++) allTabs[ti].classList.remove('active');
            tab.classList.add('active');
          });
        }
        return true;
      } catch (err) {
        logFrontendIssue('warn', 'office.xlsx', 'Failed to render spreadsheet: ' + filePath, err);
        return false;
      }
    }

    // pptx rendering via @jvmr/pptx-to-html
    if ((ext === 'pptx' || ext === 'ppt') && typeof window.pptxToHtml === 'function') {
      previewEl.innerHTML = '<div class="embed-preview-loading">Loading presentation...</div>';
      try {
        var response = await fetch(LexeraApi.fileUrl(boardId, fileRef.path));
        if (!response.ok) throw new Error('Failed to fetch pptx');
        var buf = await response.arrayBuffer();
        var slides = await window.pptxToHtml(buf, {
          width: 960,
          height: 540,
          scaleToFit: true,
          letterbox: true
        });
        if (!slides || slides.length === 0) {
          previewEl.innerHTML = '<div class="embed-preview-error">No slides found</div>';
          return true;
        }
        var currentSlide = 0;
        var bodyHtml = '<div class="office-pptx-body">';
        for (var si = 0; si < slides.length; si++) {
          bodyHtml += '<div class="office-pptx-slide' + (si === 0 ? '' : ' office-pptx-slide-hidden') + '" data-slide-index="' + si + '">' + slides[si] + '</div>';
        }
        bodyHtml += '</div>';
        previewEl.innerHTML = bodyHtml;
        if (slides.length > 1) {
          var nav = '<div class="office-pptx-nav">' +
            '<button class="office-pptx-nav-btn office-pptx-prev" title="Previous slide">&#9664;</button>' +
            '<span class="office-pptx-counter">1 / ' + slides.length + '</span>' +
            '<button class="office-pptx-nav-btn office-pptx-next" title="Next slide">&#9654;</button>' +
            '</div>';
          previewEl.insertAdjacentHTML('afterbegin', nav);
          previewEl.addEventListener('click', function (e) {
            var btn = e.target.closest('.office-pptx-nav-btn');
            if (!btn) return;
            var allSlides = previewEl.querySelectorAll('.office-pptx-slide');
            var isPrev = btn.classList.contains('office-pptx-prev');
            var next = isPrev ? currentSlide - 1 : currentSlide + 1;
            if (next < 0 || next >= allSlides.length) return;
            allSlides[currentSlide].classList.add('office-pptx-slide-hidden');
            allSlides[next].classList.remove('office-pptx-slide-hidden');
            currentSlide = next;
            var counter = previewEl.querySelector('.office-pptx-counter');
            if (counter) counter.textContent = (currentSlide + 1) + ' / ' + allSlides.length;
          });
        }
        return true;
      } catch (err) {
        logFrontendIssue('warn', 'office.pptx', 'Failed to render pptx: ' + filePath, err);
        return false;
      }
    }

    return false;
  }

  function renderEmbedPreviewContent(kind, boardId, filePath, content) {
    var safeContent = String(content || '');
    if (safeContent.length > 12000) {
      safeContent = safeContent.slice(0, 12000) + '\n\n[Preview truncated]';
    }
    if (kind === 'markdown') {
      safeContent = resolveMarkdownRelativeTargets(safeContent, filePath);
      return '<div class="embed-inline-markdown">' +
        renderCardContent(safeContent, boardId, {
          footnoteDefs: {},
          footnoteOrder: [],
          abbrDefs: {},
          embedCounter: 0
        }, { nested: true }) +
        '</div>';
    }
    return '<pre class="embed-text-preview">' + escapeHtml(safeContent) + '</pre>';
  }

  async function enhanceEmbeddedContent(root) {
    if (ContentEnhancerRegistry) {
      ContentEnhancerRegistry.enhance(root, { boardId: activeBoardId });
    }
  }

  /**
   * Run the standard preview enhancement sequence on a preview body element.
   * This is the single source of truth for embed/include preview enhancement.
   * Preview contexts don't need virtual scroll or tag interactions — only
   * content enhancement + visibility modes.
   */
  function enhancePreviewElement(el) {
    applyRenderedHtmlCommentVisibility(el, currentHtmlCommentRenderMode);
    applyRenderedTagVisibility(el, currentTagVisibilityMode);
    enhanceEmbeddedContent(el);
    flushPendingDiagramQueues();
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
      message: 'Checking whether this page can be embedded…'
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
    var boardId = link.getAttribute('data-board-id') || activeBoardId || '';
    var filePath = link.getAttribute('data-file-path') || link.getAttribute('data-original-href') || '';
    if (!boardId || !filePath || /^(https?:\/\/|mailto:|#)/.test(filePath)) return;
    var fileRef = parseLocalFileReference(filePath);
    link.setAttribute('data-link-enhanced', '1');
    var info = await requestFileInfo(boardId, fileRef.path);
    applyFileLinkInfo(link, info, fileRef.path);
  }

  async function enhanceSingleInlineFileEmbed(container) {
    if (!container || container.getAttribute('data-inline-enhanced') === '1') return;
    var boardId = container.getAttribute('data-board-id') || activeBoardId || '';
    var filePath = container.getAttribute('data-file-path') || '';
    var ext = container.getAttribute('data-inline-type') || getInlineFileEmbedExtension(filePath);
    var body = container.querySelector('.inline-file-embed-body');
    if (!boardId || !filePath || !ext || !body) return;

    container.setAttribute('data-inline-enhanced', '1');
    body.innerHTML = '<div class="embed-preview-loading">Loading preview...</div>';

    var fileRef = parseLocalFileReference(filePath);
    var info = await requestFileInfo(boardId, fileRef.path);
    var isMissing = !info || info.exists === false;
    container.classList.toggle('embed-broken', isMissing);
    if (isMissing) {
      body.innerHTML = '<div class="broken-include-placeholder">Inline file unavailable</div>';
      return;
    }

    try {
      var response = await fetch(LexeraApi.fileUrl(boardId, fileRef.path));
      if (!response.ok) throw new Error('Failed to load inline file preview');
      var text = await response.text();
      var previewPath = filePath;
      if (isBoardRelativePath(filePath)) {
        previewPath = await resolveBoardPath(boardId, filePath, 'absolute');
      }
      var kind = (ext === 'md' || ext === 'markdown') ? 'markdown' : 'text';
      body.innerHTML = renderEmbedPreviewContent(kind, boardId, previewPath, text);
      enhancePreviewElement(body);
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
    var boardId = activeBoardId || '';
    var includePath = badge.getAttribute('data-include-path') || '';
    if (!boardId || !includePath) return;
    badge.setAttribute('data-include-enhanced', '1');
    var resolvedPath = includePath;
    if (isBoardRelativePath(includePath)) {
      resolvedPath = await resolveBoardPath(boardId, includePath, 'absolute');
    }
    var info = await requestFileInfo(boardId, resolvedPath || includePath);
    var isMissing = !info || info.exists === false;
    badge.classList.toggle('include-broken', isMissing);
    if (isMissing) {
      badge.setAttribute('title', 'Missing include: ' + includePath);
    }
  }

  async function enhanceSingleIncludeDirective(container) {
    if (!container || container.getAttribute('data-include-enhanced') === '1') return;
    var boardId = container.getAttribute('data-board-id') || activeBoardId || '';
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
    if (isBoardRelativePath(rawPath)) {
      resolvedPath = await resolveBoardPath(boardId, rawPath, 'absolute');
    }
    if (resolvedPath && link) {
      link.setAttribute('data-file-path', resolvedPath);
      link.setAttribute('data-original-href', resolvedPath);
    }

    var info = await requestFileInfo(boardId, resolvedPath || rawPath);
    applyFileLinkInfo(link, info, resolvedPath || rawPath);
    var isMissing = !info || info.exists === false;
    if (isMissing) {
      container.classList.add('include-broken');
      body.innerHTML = '<div class="broken-include-placeholder">Included content unavailable</div>';
      return;
    }

    try {
      var response = await fetch(LexeraApi.fileUrl(boardId, resolvedPath || rawPath));
      if (!response.ok) throw new Error('Failed to load include');
      var text = await response.text();
      var rewritten = resolveMarkdownRelativeTargets(text, resolvedPath || rawPath);
      body.innerHTML = '<div class="included-content-block">' +
        renderCardContent(rewritten, boardId, {
          footnoteDefs: {},
          footnoteOrder: [],
          abbrDefs: {},
          embedCounter: 0
        }, { nested: true }) +
        '</div>';
      var nested = body.querySelectorAll('.include-inline-container[data-file-path]');
      for (var i = 0; i < nested.length; i++) {
        nested[i].setAttribute('data-include-depth', String(depth + 1));
      }

      enhancePreviewElement(body);
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
    var boardId = container.getAttribute('data-board-id') || activeBoardId || '';
    var filePath = container.getAttribute('data-file-path') || '';
    if (!boardId || !filePath) return;
    var fileRef = parseLocalFileReference(filePath);
    var previewKind = getEmbedPreviewKind(filePath);
    if (!previewKind) return;

    container.setAttribute('data-embed-enhanced', '1');
    var cacheKey = getEmbedPreviewCacheKey(boardId, filePath);
    var previewEl = document.createElement(previewKind === 'pdf' ? 'iframe' : 'div');
    previewEl.className = 'embed-preview embed-preview-' + previewKind;

    if (previewKind === 'pdf') {
      previewEl.setAttribute('loading', 'lazy');
      previewEl.setAttribute('title', getDisplayFileNameFromPath(filePath) || 'PDF preview');
      previewEl.setAttribute(
        'src',
        LexeraApi.fileUrl(boardId, fileRef.path) +
          '#toolbar=0&navpanes=0' +
          (fileRef.pageNumber ? '&page=' + fileRef.pageNumber : '')
      );
      container.appendChild(previewEl);
      return;
    }

    if (isRenderedSpecialPreviewKind(previewKind)) {
      container.appendChild(previewEl);
      var previewPage = container.getAttribute('data-preview-page') || '';
      var rendered = await renderCachedSpecialPreview(previewEl, boardId, filePath, previewKind, { pageNumber: previewPage, forceRerender: !!enhanceOpts.forceRerender });
      if (!rendered) {
        // Try browser-based Office doc rendering (docx-preview, SheetJS)
        var browserRendered = await renderOfficeBrowserPreview(previewEl, boardId, filePath, previewKind);
        if (!browserRendered) {
          previewEl.innerHTML = buildFilePreviewPlaceholderHtml(
            previewKind,
            filePath,
            buildSpecialPreviewPlaceholderMessage(previewKind, boardId, filePath)
          );
        }
      }
      return;
    }

    previewEl.innerHTML = '<div class="embed-preview-loading">Loading preview...</div>';
    container.appendChild(previewEl);
    try {
      var cached = embedPreviewCache[cacheKey];
      if (!cached) {
        var response = await fetch(LexeraApi.fileUrl(boardId, fileRef.path));
        if (!response.ok) throw new Error('Failed to load file preview');
        var text = await response.text();
        var previewPath = filePath;
        if (previewKind === 'markdown' && isBoardRelativePath(filePath)) {
          previewPath = await resolveBoardPath(boardId, filePath, 'absolute');
        }
        cached = renderEmbedPreviewContent(previewKind, boardId, previewPath, text);
        embedPreviewCache[cacheKey] = cached;
      }
      previewEl.innerHTML = cached;
      enhancePreviewElement(previewEl);
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

  function resolveBoardPath(boardId, filePath, toMode) {
    return LexeraApi.request('/boards/' + boardId + '/convert-path', {
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

  function openBoardFileInSystem(boardId, filePath) {
    if (!filePath) return;
    var fileRef = parseLocalFileReference(filePath);
    if (isAbsoluteFilePath(fileRef.path) || !boardId) {
      openInSystem(fileRef.path);
      return;
    }
    resolveBoardPath(boardId, fileRef.path, 'absolute').then(function (absPath) {
      openInSystem(absPath);
    });
  }

  async function showBoardFilePreview(boardId, filePath, options) {
    var fileRef = parseLocalFileReference(filePath);
    var ext = getFileExtension(fileRef.path);
    var mediaCategory = getMediaCategory(ext);
    var previewKind = getEmbedPreviewKind(filePath);
    var supportsRenderRetry = isRenderedSpecialPreviewKind(previewKind);
    var specialEditorKind = getSpecialFileEditorKind(filePath);
    if (!filePath || !boardId) return;
    if (!(previewKind === 'pdf' || isRenderedSpecialPreviewKind(previewKind) || isTextPreviewExtension(ext) || mediaCategory === 'image' || mediaCategory === 'video' || mediaCategory === 'audio')) {
      openBoardFileInSystem(boardId, filePath);
      return;
    }

    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    var dialog = document.createElement('div');
    dialog.className = 'modal-dialog file-preview-dialog';
    dialog.innerHTML =
      '<div class="modal-title">' + escapeHtml(getDisplayFileNameFromPath(filePath) || filePath) + '</div>' +
      '<div class="file-preview-body"><div class="embed-preview-loading">Loading preview...</div></div>' +
      '<div class="hidden-items-footer">' +
        (specialEditorKind ? '<button class="board-action-btn" data-file-preview-action="edit-overlay">Edit Overlay</button>' : '') +
        (supportsRenderRetry ? '<button class="board-action-btn" data-file-preview-action="retry-render">Retry Render</button>' : '') +
        (supportsRenderRetry ? '<button class="board-action-btn" data-file-preview-action="renderer-status">Renderer Status</button>' : '') +
        '<button class="board-action-btn" data-file-preview-action="open-system">Open in System App</button>' +
        '<button class="board-action-btn" data-file-preview-action="close">Close</button>' +
      '</div>';
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    var body = dialog.querySelector('.file-preview-body');
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) overlay.remove();
    });
    dialog.addEventListener('click', function (e) {
      var actionBtn = e.target.closest('[data-file-preview-action]');
      if (!actionBtn) return;
      var action = actionBtn.getAttribute('data-file-preview-action');
      if (action === 'close') {
        overlay.remove();
      } else if (action === 'edit-overlay') {
        overlay.remove();
        openSpecialFileEditorOverlay(boardId, filePath).catch(function (err) {
          showNotification(err && err.message ? err.message : 'Failed to open overlay editor');
        });
      } else if (action === 'retry-render') {
        clearCachedFilePreviewState(boardId, filePath);
        body.innerHTML = '<div class="embed-preview-loading">Loading preview...</div>';
        renderPreviewBody({ forceRerender: true });
      } else if (action === 'renderer-status') {
        showFileRendererStatusMenu(boardId, filePath, actionBtn);
      } else if (action === 'open-system') {
        openBoardFileInSystem(boardId, filePath);
      }
    });

    async function renderPreviewBody(renderOpts) {
      renderOpts = renderOpts || {};
      if (previewKind === 'pdf') {
        body.innerHTML =
          '<iframe class="file-preview-frame" src="' +
          LexeraApi.fileUrl(boardId, fileRef.path) +
          '#toolbar=0&navpanes=0' +
          (fileRef.pageNumber ? '&page=' + fileRef.pageNumber : '') +
          '"></iframe>';
        return;
      }

      if (isRenderedSpecialPreviewKind(previewKind)) {
        var modalPage = options && options.pageNumber ? options.pageNumber : '';
        var rendered = await renderCachedSpecialPreview(body, boardId, filePath, previewKind, {
          modal: true,
          pageNumber: modalPage,
          forceRerender: !!renderOpts.forceRerender
        });
        if (!rendered) {
          body.innerHTML = buildFilePreviewPlaceholderHtml(
            previewKind,
            filePath,
            buildSpecialPreviewPlaceholderMessage(previewKind, boardId, filePath)
          );
        }
        return;
      }

      if (mediaCategory === 'image') {
        body.innerHTML = '<div class="file-preview-media"><img class="file-preview-image" src="' + escapeAttr(LexeraApi.fileUrl(boardId, fileRef.path)) + '" alt="' + escapeAttr(getDisplayFileNameFromPath(filePath) || filePath) + '"></div>';
        return;
      }

      if (mediaCategory === 'video') {
        body.innerHTML = '<div class="file-preview-media"><video class="file-preview-video" controls preload="metadata" src="' + escapeAttr(LexeraApi.fileUrl(boardId, fileRef.path)) + '"></video></div>';
        return;
      }

      if (mediaCategory === 'audio') {
        body.innerHTML = '<div class="file-preview-media"><audio class="file-preview-audio" controls preload="metadata" src="' + escapeAttr(LexeraApi.fileUrl(boardId, fileRef.path)) + '"></audio></div>';
        return;
      }

      try {
        var response = await fetch(LexeraApi.fileUrl(boardId, fileRef.path));
        if (!response.ok) throw new Error('Failed to load preview');
        var text = await response.text();
        if (isMarkdownPreviewExtension(ext)) {
          var previewPath = filePath;
          if (isBoardRelativePath(filePath)) {
            previewPath = await resolveBoardPath(boardId, filePath, 'absolute');
          }
          body.innerHTML = '<div class="file-preview-markdown">' +
            renderCardContent(resolveMarkdownRelativeTargets(text, previewPath), boardId, {
              footnoteDefs: {},
              footnoteOrder: [],
              abbrDefs: {},
              embedCounter: 0
            }, { nested: true }) +
            '</div>';
          enhancePreviewElement(body);
        } else {
          body.innerHTML = '<pre class="file-preview-text">' + escapeHtml(text) + '</pre>';
        }
      } catch (err) {
        logFrontendIssue(
          'warn',
          'file.preview',
          'Failed to render file preview for board ' + boardId + ' path ' + filePath,
          err
        );
        body.innerHTML = '<div class="embed-preview-error">Preview unavailable</div>';
      }
    }

    await renderPreviewBody();
  }

  function _registerContentEnhancers() {
    if (!ContentEnhancerRegistry) return;
    ContentEnhancerRegistry.register({
      id: 'external-embed',
      selector: '.external-embed-container[data-embed-url]',
      priority: 10,
      lazy: true,
      enhance: function (el) { enhanceSingleExternalEmbedContainer(el); }
    });
    ContentEnhancerRegistry.register({
      id: 'file-embed',
      selector: '.embed-container[data-file-path][data-board-id]',
      priority: 20,
      lazy: true,
      enhance: function (el) { enhanceSingleEmbedContainer(el); }
    });
    ContentEnhancerRegistry.register({
      id: 'inline-file-embed',
      selector: '.inline-file-embed-container[data-file-path][data-board-id]',
      priority: 30,
      lazy: true,
      enhance: function (el) { enhanceSingleInlineFileEmbed(el); }
    });
    ContentEnhancerRegistry.register({
      id: 'file-link',
      selector: '.markdown-file-link[data-file-path]',
      priority: 40,
      enhance: function (el) { enhanceSingleFileLink(el); }
    });
    ContentEnhancerRegistry.register({
      id: 'column-include-badge',
      selector: '.column-include-badge[data-include-path]',
      priority: 50,
      enhance: function (el) { enhanceSingleColumnIncludeBadge(el); }
    });
    ContentEnhancerRegistry.register({
      id: 'include-directive',
      selector: '.include-inline-container[data-file-path]',
      priority: 60,
      lazy: true,
      enhance: function (el) { enhanceSingleIncludeDirective(el); }
    });
    ContentEnhancerRegistry.register({
      id: 'diagram-flush',
      selector: null,
      priority: 100,
      enhance: function () { flushPendingDiagramQueues(); }
    });
  }

  function closeEmbedMenu() {
    if (activeEmbedMenu) {
      activeEmbedMenu.remove();
      activeEmbedMenu = null;
    }
  }

  function _registerEventListeners() {
    if (!_messageListenerRegistered) {
      _messageListenerRegistered = true;
      window.addEventListener('message', handleSpecialFileEditorMessage);
    }

  document.addEventListener('click', function (e) {
    // Alt+Click: open links in system browser, images/embeds in system app
    if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      var cardContent = e.target.closest('.card-content');
      if (cardContent) {
        // Alt+click on an anchor link → open URL in system browser
        var altLink = e.target.closest('a[href]');
        if (altLink) {
          e.preventDefault();
          e.stopPropagation();
          var href = altLink.getAttribute('data-original-href') || altLink.getAttribute('href') || '';
          if (/^https?:\/\//i.test(href) || /^mailto:/i.test(href)) {
            openUrlInSystem(href);
          } else if (href && href.charAt(0) !== '#') {
            openBoardFileInSystem(activeBoardId, href);
          }
          return;
        }
        // Alt+click on an image → open image file in system app
        var altImg = e.target.closest('img');
        if (altImg) {
          e.preventDefault();
          e.stopPropagation();
          var imgSrc = altImg.getAttribute('data-original-src') || altImg.getAttribute('src') || '';
          if (imgSrc) openBoardFileInSystem(activeBoardId, imgSrc);
          return;
        }
        // Alt+click on an embed container → open embedded file
        var altEmbed = e.target.closest('.embed-container[data-file-path]');
        if (altEmbed) {
          e.preventDefault();
          e.stopPropagation();
          openBoardFileInSystem(
            altEmbed.getAttribute('data-board-id') || activeBoardId || '',
            altEmbed.getAttribute('data-file-path') || ''
          );
          return;
        }
        // Alt+click on an inline file embed → open the file
        var altInline = e.target.closest('.inline-file-embed-container[data-file-path]');
        if (altInline) {
          e.preventDefault();
          e.stopPropagation();
          openBoardFileInSystem(
            altInline.getAttribute('data-board-id') || activeBoardId || '',
            altInline.getAttribute('data-file-path') || ''
          );
          return;
        }
        // Alt+click on an external embed → open URL in browser
        var altExternal = e.target.closest('.external-embed-container[data-embed-url]');
        if (altExternal) {
          e.preventDefault();
          e.stopPropagation();
          openUrlInSystem(altExternal.getAttribute('data-embed-url') || '');
          return;
        }
      }
    }

    var wikiMenuBtn = e.target.closest('.wiki-menu-btn');
    if (wikiMenuBtn) {
      e.preventDefault();
      e.stopPropagation();
      var wikiMenuContainer = wikiMenuBtn.closest('.wiki-link-container');
      if (wikiMenuContainer) showWikiMenu(wikiMenuContainer, wikiMenuBtn);
      return;
    }

    var wikiLink = e.target.closest('.wiki-link');
    if (wikiLink) {
      e.preventDefault();
      e.stopPropagation();
      openWikiDocument(wikiLink.getAttribute('data-document') || wikiLink.textContent || '');
      return;
    }

    var anchorLink = e.target.closest('a[href]');
    if (anchorLink) {
      var hrefValue = anchorLink.getAttribute('data-original-href') || anchorLink.getAttribute('href') || '';
      if (hrefValue.charAt(0) === '#' && hrefValue.length > 1 && hrefValue.indexOf('#footnote-') !== 0) {
        e.preventDefault();
        e.stopPropagation();
        openWikiSearch(hrefValue);
        return;
      }
    }

    var fileLink = e.target.closest('.markdown-file-link');
    if (fileLink) {
      // Prevent anchor navigation on single click; preview opens on dblclick
      e.preventDefault();
      return;
    }

    var embedFileLink = e.target.closest('.embed-file-link');
    if (embedFileLink) {
      var embedContainer = embedFileLink.closest('.embed-container');
      if (embedContainer) {
        e.preventDefault();
        e.stopPropagation();
        showBoardFilePreview(
          embedContainer.getAttribute('data-board-id') || activeBoardId || '',
          embedContainer.getAttribute('data-file-path') || '',
          { pageNumber: embedContainer.getAttribute('data-preview-page') || '' }
        );
        return;
      }
    }

    var inlineFileLabel = e.target.closest('.inline-file-embed-label[data-action="open-inline-file"]');
    if (inlineFileLabel) {
      var inlineFileContainer = inlineFileLabel.closest('.inline-file-embed-container[data-file-path]');
      if (inlineFileContainer) {
        e.preventDefault();
        e.stopPropagation();
        openBoardFileInSystem(
          inlineFileContainer.getAttribute('data-board-id') || activeBoardId || '',
          inlineFileContainer.getAttribute('data-file-path') || ''
        );
        return;
      }
    }

    var externalEmbedActionBtn = e.target.closest('.external-embed-open-btn, .external-embed-secondary-btn');
    if (externalEmbedActionBtn) {
      var externalEmbedContainer = externalEmbedActionBtn.closest('.external-embed-container[data-embed-url]');
      if (externalEmbedContainer) {
        e.preventDefault();
        e.stopPropagation();
        var externalAction = externalEmbedActionBtn.getAttribute('data-external-embed-action') || '';
        if (externalAction === 'open-page') {
          openExternalEmbedInPlace(externalEmbedContainer);
        } else if (externalAction === 'open-browser') {
          openUrlInSystem(externalEmbedContainer.getAttribute('data-embed-url') || '');
        }
        return;
      }
    }

    var diagramMenuBtn = e.target.closest('.diagram-menu-btn');
    if (diagramMenuBtn) {
      e.preventDefault();
      e.stopPropagation();
      var diagramContainer = diagramMenuBtn.closest('.diagram-overlay-container[data-diagram-type]');
      if (!diagramContainer) return;
      showDiagramMenu(diagramContainer, diagramMenuBtn);
      return;
    }

    var linkMenuBtn = e.target.closest('.link-menu-btn');
    if (linkMenuBtn) {
      e.preventDefault();
      e.stopPropagation();
      var linkContainer = linkMenuBtn.closest('.link-path-overlay-container[data-file-path]');
      if (!linkContainer) return;
      showBoardFileLinkMenu(linkContainer, linkMenuBtn);
      return;
    }

    // Handle burger menu button clicks for embeds/includes
    if (e.target.classList.contains('embed-menu-btn') || e.target.classList.contains('include-menu-btn')) {
      e.preventDefault();
      e.stopPropagation();
      var container = e.target.closest(
        '.embed-container, .external-embed-container, .inline-file-embed-container, ' +
        '.include-link-container[data-file-path], .include-inline-container[data-file-path]'
      );
      if (!container) return;
      if (isIncludeDirectiveContainer(container)) showIncludeMenu(container, e.target);
      else showEmbedMenu(container, e.target);
      return;
    }

    // Handle action clicks in info/path-fix panels (still DOM-based)
    var actionEl = e.target.closest('[data-action]');
    if (actionEl && activeEmbedMenu && activeEmbedMenu.contains(actionEl)) {
      e.stopPropagation();
      var action = actionEl.getAttribute('data-action');
      var embedContainer = activeEmbedMenu._embedContainer;
      if (embedContainer && embedContainer.classList && embedContainer.classList.contains('link-path-overlay-container')) {
        handleBoardFileLinkAction(action, embedContainer);
      } else if (isIncludeDirectiveContainer(embedContainer)) {
        handleIncludeAction(action, embedContainer);
      } else {
        handleEmbedAction(action, embedContainer);
      }
      return;
    }

    // Click outside closes info/path-fix panel
    if (activeEmbedMenu && !activeEmbedMenu.contains(e.target)) {
      closeEmbedMenu();
    }
  }, true);

  // Double-click on file links → open preview
  document.addEventListener('dblclick', function (e) {
    var fileLink = e.target.closest('.markdown-file-link');
    if (fileLink) {
      e.preventDefault();
      e.stopPropagation();
      showBoardFilePreview(
        fileLink.getAttribute('data-board-id') || activeBoardId || '',
        fileLink.getAttribute('data-file-path') || fileLink.getAttribute('data-original-href') || ''
      );
    }
  });

  // Right-click on embeds and file links → native context menu
  document.addEventListener('contextmenu', function (e) {
    var wikiContainer = e.target.closest('.wiki-link-container');
    if (wikiContainer) {
      var wikiLink = wikiContainer.querySelector('.wiki-link');
      if (!wikiLink) return;
      e.preventDefault();
      e.stopPropagation();
      showWikiMenu(wikiContainer, wikiLink);
      return;
    }

    var linkContainer = e.target.closest('.link-path-overlay-container[data-file-path]');
    if (linkContainer) {
      e.preventDefault();
      e.stopPropagation();
      showBoardFileLinkMenu(linkContainer, e);
      return;
    }

    var diagramContainer = e.target.closest('.diagram-overlay-container[data-diagram-type]');
    if (diagramContainer) {
      e.preventDefault();
      e.stopPropagation();
      showDiagramMenu(diagramContainer, e);
      return;
    }

    var container = e.target.closest(
      '.embed-container, .external-embed-container, .inline-file-embed-container, ' +
      '.include-link-container[data-file-path], .include-inline-container[data-file-path], ' +
      '.image-path-overlay-container[data-file-path], .video-path-overlay-container[data-file-path], ' +
      '.wysiwyg-media[data-file-path], .wysiwyg-media-block[data-file-path]'
    );
    var link = !container ? e.target.closest('.markdown-file-link, a[href]') : null;
    if (!container && !link) return;

    var filePath = container
      ? getEmbedActionTarget(container)
      : (link.getAttribute('data-file-path') || link.getAttribute('data-original-href') || link.getAttribute('href'));
    if (!filePath) return;

    e.preventDefault();
    e.stopPropagation();

    var isExternalEmbed = !!container && isExternalEmbedContainer(container);
    var isIncludeContainer = !!container && isIncludeDirectiveContainer(container);
    var externalPolicyAction = isExternalEmbed
      ? (container.getAttribute('data-external-policy-action') || '')
      : '';
    var menuItems = isIncludeContainer
      ? [
          { id: 'preview', label: 'Preview Include File' },
          { separator: true },
          { id: 'open-system', label: 'Open in System App' },
          { id: 'show-finder', label: 'Show in Finder' },
          { id: 'copy-path', label: 'Copy Path' },
          { id: 'path-fix', label: 'Automatic Path Fix' },
          { id: 'path-manual', label: 'Manual Path Fix' },
          { id: 'path-web-search', label: 'Web-Search File' },
          { id: 'convert-path', label: isAbsoluteFilePath(parseLocalFileReference(filePath).path) ? 'Convert to Relative' : 'Convert to Absolute' },
          { separator: true },
          { id: 'delete', label: 'Delete Include' },
        ]
      : isExternalEmbed
      ? [
          { id: 'open-page', label: 'Open Page Here', disabled: externalPolicyAction !== 'open_page' },
          { id: 'open-url', label: 'Open URL in Browser' },
          { id: 'copy-url', label: 'Copy URL' },
          { id: 'recheck-policy', label: 'Recheck Embed Permission' },
          { separator: true },
          { id: 'edit-url', label: 'Edit URL' },
          { id: 'delete', label: 'Delete Embed' },
        ]
      : container
      ? [
          { id: 'open-system', label: 'Open in System App' },
          { id: 'show-finder', label: 'Show in Finder' },
          { id: 'copy-path', label: 'Copy Path' },
          { separator: true },
          { id: 'path-fix', label: 'Automatic Path Fix' },
          { id: 'path-manual', label: 'Manual Path Fix' },
          { id: 'convert-path', label: isAbsoluteFilePath(parseLocalFileReference(filePath).path) ? 'Convert to Relative' : 'Convert to Absolute' },
          { separator: true },
          { id: 'delete', label: 'Delete Embed' },
        ]
      : [
          { id: 'file-open', label: 'Open in System App' },
          { id: 'file-finder', label: 'Show in Finder' },
        ];

    if (!isExternalEmbed && /^(https?:\/\/|mailto:|#)/.test(filePath)) return;

    showNativeMenu(menuItems, e.clientX, e.clientY).then(function (action) {
      if (!action) return;
      if (container) {
        if (isIncludeDirectiveContainer(container)) handleIncludeAction(action, container);
        else handleEmbedAction(action, container);
        return;
      }
      var fileRef = parseLocalFileReference(filePath);
      var boardId = container
        ? container.getAttribute('data-board-id')
        : (activeBoardId || '');

      function resolveAndRun(fn) {
        if (!isAbsoluteFilePath(fileRef.path) && boardId) {
          resolveBoardPath(boardId, fileRef.path, 'absolute').then(function (resolvedPath) { fn(resolvedPath); });
        } else {
          fn(fileRef.path);
        }
      }

      if (action === 'file-open') resolveAndRun(openInSystem);
      else if (action === 'file-finder') resolveAndRun(showInFinder);
    });
  }, true);

  } // end _registerEventListeners

  // Resolve the Tauri IPC bridge — prefer the current window, fall back to
  // the parent frame so that workspace-shell iframes (same origin) can still
  // invoke Tauri commands even when __TAURI_INTERNALS__ isn't injected into
  // sub-frames.
  function resolveTauriInternals() {
    if (window.__TAURI_INTERNALS__) return window.__TAURI_INTERNALS__;
    if (window.__TAURI__ && window.__TAURI__.core) return window.__TAURI__.core;
    try {
      if (window.parent && window.parent !== window) {
        if (window.parent.__TAURI_INTERNALS__) return window.parent.__TAURI_INTERNALS__;
        if (window.parent.__TAURI__ && window.parent.__TAURI__.core) return window.parent.__TAURI__.core;
      }
    } catch (e) { /* cross-origin access blocked — ignore */ }
    return null;
  }

  var tauriIpc = resolveTauriInternals();
  var hasTauri = !!tauriIpc;

  function tauriInvoke(cmd, args) {
    var ipc = resolveTauriInternals();
    if (ipc && typeof ipc.invoke === 'function') {
      return ipc.invoke(cmd, args);
    }
    return Promise.reject(new Error('Tauri not available'));
  }

  function tauriListen(eventName, callback) {
    var ipc = resolveTauriInternals();
    if (ipc && typeof ipc.transformCallback === 'function') {
      var handler = ipc.transformCallback(callback, false);
      ipc.invoke('plugin:event|listen', {
        event: eventName,
        target: { kind: 'Any' },
        handler: handler,
      });
      return;
    }
    if (window.__TAURI__ && window.__TAURI__.event) {
      window.__TAURI__.event.listen(eventName, callback);
      return;
    }
    try {
      if (window.parent && window.parent !== window && window.parent.__TAURI__ && window.parent.__TAURI__.event) {
        window.parent.__TAURI__.event.listen(eventName, callback);
      }
    } catch (e) { /* cross-origin — ignore */ }
  }

  /**
   * Show a native OS context menu via Tauri. Returns selected action ID or null.
   * items: array of { id, label, separator, disabled, items (for submenus) }
   */
  var activeHtmlMenu = null;
  var activeHtmlMenuClickOutside = null;

  function closeHtmlMenu() {
    if (activeHtmlMenuClickOutside) {
      document.removeEventListener('mousedown', activeHtmlMenuClickOutside, true);
      activeHtmlMenuClickOutside = null;
    }
    if (activeHtmlMenu) { activeHtmlMenu.remove(); activeHtmlMenu = null; }
  }

  function showHtmlMenu(items, x, y) {
    closeHtmlMenu();
    return new Promise(function (resolve) {
      var host = document.createElement('div');
      host.className = 'html-context-menu-host';
      document.body.appendChild(host);
      activeHtmlMenu = host;

      var openPanels = [];
      var gap = 4;

      function clampMenuTop(top, height) {
        var maxTop = Math.max(4, window.innerHeight - height - 4);
        return Math.min(Math.max(4, top), maxTop);
      }

      function positionMenuPanel(panel, px, py, anchorRect) {
        panel.style.left = '0px';
        panel.style.top = '0px';
        host.appendChild(panel);
        var rect = panel.getBoundingClientRect();
        var left = px;
        var top = py;
        if (anchorRect) {
          if (left + rect.width > window.innerWidth - 4) {
            left = Math.max(4, anchorRect.left - rect.width - gap);
          }
          if (left < 4) {
            left = Math.min(window.innerWidth - rect.width - 4, anchorRect.right + gap);
          }
          top = clampMenuTop(anchorRect.top - 4, rect.height);
        } else {
          if (left + rect.width > window.innerWidth - 4) left = Math.max(4, window.innerWidth - rect.width - 4);
          top = clampMenuTop(top, rect.height);
        }
        panel.style.left = left + 'px';
        panel.style.top = top + 'px';
      }

      function closePanelsFrom(level) {
        while (openPanels.length > level) {
          var closing = openPanels.pop();
          if (closing && closing.parentNode) closing.parentNode.removeChild(closing);
        }
      }

      function buildMenuPanel(itemList, level) {
        var panel = document.createElement('div');
        panel.className = 'html-context-menu';
        panel.setAttribute('role', 'menu');
        for (var i = 0; i < itemList.length; i++) {
          var item = itemList[i];
          if (item.separator) {
            var sep = document.createElement('div');
            sep.className = 'html-menu-separator';
            sep.setAttribute('role', 'separator');
            panel.appendChild(sep);
            continue;
          }
          var el = document.createElement('div');
          el.className = 'html-menu-item' + (item.disabled ? ' disabled' : '') + (item.checked ? ' checked' : '');
          el.setAttribute('role', 'menuitem');
          if (item.disabled) el.setAttribute('aria-disabled', 'true');
          var labelText = item.label || '';
          if (typeof item.checked === 'boolean') {
            labelText = (item.checked ? '\u2611 ' : '\u2610 ') + labelText;
          }
          el.textContent = labelText;
          if (item.items && item.items.length > 0) {
            el.classList.add('has-submenu');
            (function (submenuItems, itemEl, itemLevel) {
              itemEl.addEventListener('mouseenter', function () {
                closePanelsFrom(itemLevel + 1);
                var itemRect = itemEl.getBoundingClientRect();
                var submenuPanel = buildMenuPanel(submenuItems, itemLevel + 1);
                openPanels[itemLevel + 1] = submenuPanel;
                positionMenuPanel(submenuPanel, itemRect.right + gap, itemRect.top - 4, itemRect);
              });
            })(item.items, el, level);
          } else if (!item.disabled) {
            el.addEventListener('mouseenter', function () {
              closePanelsFrom(level + 1);
            });
            (function (id) {
              el.addEventListener('click', function (e) {
                e.stopPropagation();
                closeHtmlMenu();
                resolve(id);
              });
            })(item.id);
          } else {
            el.addEventListener('mouseenter', function () {
              closePanelsFrom(level + 1);
            });
          }
          panel.appendChild(el);
        }
        panel.addEventListener('mouseleave', function (event) {
          if (!event.relatedTarget || !host.contains(event.relatedTarget)) {
            closePanelsFrom(level + 1);
          }
        });
        return panel;
      }

      var rootPanel = buildMenuPanel(items, 0);
      openPanels[0] = rootPanel;
      positionMenuPanel(rootPanel, x, y, null);

      // Close on click outside
      function onClickOutside(e) {
        if (!host.contains(e.target)) {
          closeHtmlMenu();
          resolve(null);
        }
      }
      activeHtmlMenuClickOutside = onClickOutside;
      setTimeout(function () {
        if (activeHtmlMenuClickOutside === onClickOutside) {
          document.addEventListener('mousedown', onClickOutside, true);
        }
      }, 0);
    });
  }

  function showNativeMenu(items, x, y, traceTarget) {
    var target = traceTarget || 'menu.native';
    var summary = {
      x: x,
      y: y,
      itemIds: summarizeMenuItems(items),
      mode: hasTauri ? 'tauri' : 'html'
    };
    if (!hasTauri) {
      traceFrontendAction('info', target, 'Opening HTML menu', summary);
      return showHtmlMenu(items, x, y).then(function (result) {
        if (result) {
          traceFrontendAction('info', target, 'HTML menu selected action', { action: result });
        } else {
          traceFrontendAction('warn', target, 'HTML menu closed without selection', summary);
        }
        return result;
      });
    }
    traceFrontendAction('info', target, 'Opening native menu', summary);
    return tauriInvoke('show_context_menu', { items: items, x: x, y: y }).then(function (result) {
      if (result) {
        traceFrontendAction('info', target, 'Native menu selected action', { action: result });
      } else {
        traceFrontendAction('warn', target, 'Native menu closed without selection', summary);
      }
      return result;
    }).catch(function (err) {
      logFrontendIssue('error', target, 'Native menu failed, falling back to HTML menu', err);
      traceFrontendAction('info', target, 'Opening HTML fallback menu', summary);
      return showHtmlMenu(items, x, y).then(function (result) {
        if (result) {
          traceFrontendAction('info', target, 'HTML fallback menu selected action', { action: result });
        } else {
          traceFrontendAction('warn', target, 'HTML fallback menu closed without selection', summary);
        }
        return result;
      });
    });
  }

  function showWikiMenu(container, btn) {
    if (!container || !btn) return;
    var documentName = container.getAttribute('data-document') || '';
    var resolved = resolveWikiDocument(documentName);
    var btnRect = btn.getBoundingClientRect();
    var menuItems = [];

    if (resolved.kind === 'board' && resolved.boardId) {
      menuItems.push({ label: getBoardDisplayName(resolved.board) || resolved.document, disabled: true });
      menuItems.push({ id: 'open', label: 'Open Linked Board' });
      if (!embeddedMode) {
        menuItems.push({ id: 'open-new-tab', label: 'Open in New Tab' });
      }
      menuItems.push({ id: 'search', label: 'Search Reference In Dashboard' });
    } else if (resolved.kind === 'tag') {
      menuItems.push({ label: resolved.document, disabled: true });
      menuItems.push({ id: 'search', label: 'Search Tag In Dashboard' });
    } else {
      menuItems.push({ label: 'No matching board', disabled: true });
      menuItems.push({ id: 'search', label: 'Search Matching Board In Dashboard' });
    }

    menuItems.push({ separator: true });
    menuItems.push({ id: 'copy', label: 'Copy Wiki Target' });

    showNativeMenu(menuItems, btnRect.right, btnRect.bottom).then(function (action) {
      if (action) handleWikiAction(action, container);
    });
  }

  function handleWikiAction(action, container) {
    if (!container || !action) return;
    var documentName = container.getAttribute('data-document') || '';
    if (!documentName) return;
    if (action === 'open') {
      openWikiDocument(documentName);
      return;
    }
    if (action === 'open-new-tab') {
      openWikiDocument(documentName, { duplicate: true });
      return;
    }
    if (action === 'search') {
      openWikiSearch(documentName);
      return;
    }
    if (action === 'copy' && navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(documentName).then(function () {
        showNotification('Wiki target copied to clipboard');
      }).catch(function (err) {
        logFrontendIssue('warn', 'clipboard.copy', 'Failed to copy wiki target to clipboard', err);
        showNotification('Failed to copy wiki target');
      });
    }
  }

  function isIncludeDirectiveContainer(container) {
    return !!(container && container.classList && (
      container.classList.contains('include-link-container') ||
      container.classList.contains('include-inline-container')
    ));
  }

  function updateIncludeTarget(container, nextTarget) {
    if (!container) return Promise.resolve(false);
    var includeIndex = parseInt(container.getAttribute('data-include-index'), 10);
    var nextValue = String(nextTarget || '').trim();
    if (!nextValue) return Promise.resolve(false);
    return mutateEmbedSource(container, function (content) {
      return replaceNthIncludeDirective(content, isFinite(includeIndex) ? includeIndex : 0, function () {
        return '!!!include(' + nextValue + ')!!!';
      });
    });
  }

  function deleteIncludeFromSource(container) {
    if (!container) return Promise.resolve(false);
    var includeIndex = parseInt(container.getAttribute('data-include-index'), 10);
    return mutateEmbedSource(container, function (content) {
      return replaceNthIncludeDirective(content, isFinite(includeIndex) ? includeIndex : 0, function () {
        return '';
      });
    });
  }

  function showBoardFileLinkMenu(container, trigger) {
    if (!container) return;
    var filePath = container.getAttribute('data-file-path') || '';
    var boardId = container.getAttribute('data-board-id') || activeBoardId || '';
    if (!filePath) return;
    var isGenericLink = isGenericMarkdownLinkTarget(filePath);
    var isEditable = container.getAttribute('data-link-editable') !== '0';
    var x = 0;
    var y = 0;
    if (trigger && typeof trigger.clientX === 'number' && typeof trigger.clientY === 'number') {
      x = trigger.clientX;
      y = trigger.clientY;
    } else if (trigger && typeof trigger.getBoundingClientRect === 'function') {
      var rect = trigger.getBoundingClientRect();
      x = rect.right;
      y = rect.bottom;
    } else {
      var containerRect = container.getBoundingClientRect();
      x = containerRect.right;
      y = containerRect.bottom;
    }

    if (isGenericLink) {
      var openLabel = 'Open Link';
      if (/^mailto:/i.test(filePath)) openLabel = 'Open Mail Link';
      else if (filePath.indexOf('#footnote-') === 0) openLabel = 'Jump to Footnote';
      else if (filePath.charAt(0) === '#') openLabel = 'Open Target';
      var genericItems = [
        { id: 'open-link', label: openLabel },
        { id: 'copy-link', label: 'Copy Link' }
      ];
      if (isEditable) {
        genericItems.push({ separator: true });
        genericItems.push({ id: 'edit-link', label: 'Edit Link' });
      }
      showNativeMenu(genericItems, x, y).then(function (action) {
        if (action) handleBoardFileLinkAction(action, container);
      });
      return;
    }

    if (!boardId) return;
    var fileRef = parseLocalFileReference(filePath);
    var isAbsolute = isAbsoluteFilePath(fileRef.path);
    showNativeMenu([
      { id: 'preview', label: 'Preview File' },
      { separator: true },
      { id: 'open-system', label: 'Open in System App' },
      { id: 'show-finder', label: 'Show in Finder' },
      { id: 'copy-path', label: 'Copy Path' },
      { id: 'path-fix', label: 'Automatic Path Fix' },
      { id: 'path-manual', label: 'Manual Path Fix' },
      { id: 'path-web-search', label: 'Web-Search File' },
      { id: 'convert-path', label: isAbsolute ? 'Convert to Relative' : 'Convert to Absolute' },
    ], x, y).then(function (action) {
      if (action) handleBoardFileLinkAction(action, container);
    });
  }

  function showDiagramMenu(container, trigger) {
    if (!container) return;
    var x = 0;
    var y = 0;
    if (trigger && typeof trigger.clientX === 'number' && typeof trigger.clientY === 'number') {
      x = trigger.clientX;
      y = trigger.clientY;
    } else if (trigger && typeof trigger.getBoundingClientRect === 'function') {
      var rect = trigger.getBoundingClientRect();
      x = rect.right;
      y = rect.bottom;
    } else {
      var containerRect = container.getBoundingClientRect();
      x = containerRect.right;
      y = containerRect.top;
    }
    var diagramType = container.getAttribute('data-diagram-type') || 'diagram';
    var plugin = DiagramRegistry ? DiagramRegistry.getById(diagramType) : null;
    var menuItems = plugin && plugin.menuItems ? plugin.menuItems(container.getAttribute('data-diagram-code') || '') : [
      { id: 'copy-svg', label: 'Copy SVG' },
      { id: 'copy-code', label: 'Copy Code' },
    ];
    showNativeMenu(menuItems, x, y).then(function (action) {
      if (!action) return;
      if (plugin && plugin.handleMenuAction) {
        plugin.handleMenuAction(action, container);
      } else {
        handleDiagramAction(action, container);
      }
    });
  }

  function handleDiagramAction(action, container) {
    if (!container) return;
    if (action === 'copy-code') {
      copyTextToClipboard(
        container.getAttribute('data-diagram-code') || '',
        'Diagram code copied to clipboard',
        'Failed to copy diagram code'
      );
      return;
    }
    if (action === 'copy-svg') {
      var svg = container.querySelector('svg');
      if (!svg) {
        showNotification('SVG not available yet');
        return;
      }
      copyTextToClipboard(
        svg.outerHTML || '',
        'Diagram SVG copied to clipboard',
        'Failed to copy diagram SVG'
      );
    }
  }

  function handleBoardFileLinkAction(action, container) {
    if (!container) {
      closeEmbedMenu();
      return;
    }
    var filePath = container.getAttribute('data-file-path') || '';
    var boardId = container.getAttribute('data-board-id') || activeBoardId || '';
    var isGenericLink = isGenericMarkdownLinkTarget(filePath);
    if (!filePath || (!boardId && !isGenericLink)) return;

    if (isGenericLink) {
      closeEmbedMenu();
      if (action === 'open-link') {
        openMarkdownLinkTarget(filePath);
        return;
      }
      if (action === 'copy-link') {
        copyTextToClipboard(filePath, 'Link copied to clipboard', 'Failed to copy link');
        return;
      }
      if (action === 'edit-link') {
        if (container.getAttribute('data-link-editable') === '0') return;
        var nextLinkTarget = promptForEmbedTarget(filePath, 'Update link target');
        if (!nextLinkTarget || nextLinkTarget === filePath) return;
        updateBoardFileLinkTarget(container, nextLinkTarget).then(function (changed) {
          if (changed) showNotification('Link updated');
          else showNotification('Unable to update link');
        });
      }
      return;
    }

    var fileRef = parseLocalFileReference(filePath);

    if (action === 'preview') {
      closeEmbedMenu();
      showBoardFilePreview(boardId, filePath);

    } else if (action === 'open-system') {
      closeEmbedMenu();
      openBoardFileInSystem(boardId, filePath);

    } else if (action === 'show-finder') {
      closeEmbedMenu();
      if (isAbsoluteFilePath(fileRef.path)) {
        showInFinder(fileRef.path);
      } else {
        resolveBoardPath(boardId, fileRef.path, 'absolute').then(function (absPath) {
          showInFinder(absPath);
        });
      }

    } else if (action === 'copy-path') {
      closeEmbedMenu();
      copyTextToClipboard(filePath, 'File path copied to clipboard', 'Failed to copy file path');

    } else if (action === 'path-fix') {
      closeEmbedMenu();
      LexeraApi.request('/boards/' + boardId + '/find-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: getDisplayFileNameFromPath(fileRef.path) }),
      }).then(function (res) {
        applyAutomaticPathFix(container, res && res.matches ? res.matches : []);
      }).catch(function (err) {
        logFrontendIssue('warn', 'path.fix', 'Automatic path fix failed for file link ' + filePath, err);
      });

    } else if (action === 'path-manual') {
      closeEmbedMenu();
      var nextPath = promptForEmbedTarget(filePath, 'Manual path fix');
      if (!nextPath || nextPath === filePath) return;
      updateBoardFileLinkTarget(container, nextPath);

    } else if (action === 'path-web-search') {
      closeEmbedMenu();
      openEmbedWebSearch(container, filePath);

    } else if (action === 'convert-path') {
      closeEmbedMenu();
      resolveBoardPath(boardId, fileRef.path, isAbsoluteFilePath(fileRef.path) ? 'relative' : 'absolute').then(function (nextPath) {
        var nextTarget = nextPath ? nextPath + (fileRef.suffix || '') : '';
        if (!nextTarget || nextTarget === filePath) return;
        updateBoardFileLinkTarget(container, nextTarget);
      }).catch(function (err) {
        logFrontendIssue('warn', 'path.convert', 'Path conversion failed for file link ' + filePath, err);
      });

    } else if (action && action.indexOf('pick-path:') === 0) {
      closeEmbedMenu();
      var pickedPath = adjustPathForIncludeContext(container, action.substring(10));
      updateBoardFileLinkTarget(container, pickedPath + (fileRef.suffix || ''));

    } else if (action === 'close-info') {
      closeEmbedMenu();
    }
  }

  function showReplaceDocumentOverlay(container) {
    var filePath = container.getAttribute('data-file-path') || '';
    var boardId = container.getAttribute('data-board-id') || activeBoardId || '';
    var isInclude = isIncludeDirectiveContainer(container);
    if (!filePath || !boardId) return;

    var fileRef = parseLocalFileReference(filePath);
    var filename = getDisplayFileNameFromPath(fileRef.path) || filePath;
    var mediaCategory = getMediaCategory(getFileExtension(fileRef.path));

    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.setAttribute('tabindex', '-1');
    var dialog = document.createElement('div');
    dialog.className = 'modal-dialog replace-doc-dialog';

    var currentPreviewHtml = '';
    if (mediaCategory === 'image') {
      currentPreviewHtml =
        '<div class="replace-doc-current-preview">' +
          '<img src="' + escapeAttr(LexeraApi.fileUrl(boardId, fileRef.path)) + '" alt="' + escapeAttr(filename) + '" />' +
        '</div>';
    }

    dialog.innerHTML =
      '<div class="modal-title">Replace Document</div>' +
      '<div class="replace-doc-subtitle">' + escapeHtml(filename) + '</div>' +
      currentPreviewHtml +
      '<div class="replace-doc-matches-section">' +
        '<div class="replace-doc-section-title">Files with same name</div>' +
        '<div class="replace-doc-matches"><div class="embed-preview-loading">Searching...</div></div>' +
      '</div>' +
      '<div class="replace-doc-drop-zone">' +
        '<div class="replace-doc-drop-label">Drop replacement file here, or paste from clipboard</div>' +
      '</div>' +
      '<div class="replace-doc-path-mode">' +
        '<label class="replace-doc-path-mode-label">Path mode:</label>' +
        '<button class="board-action-btn replace-doc-path-mode-btn' + (isAbsoluteFilePath(fileRef.path) ? '' : ' active') + '" data-path-mode="relative">Relative</button>' +
        '<button class="board-action-btn replace-doc-path-mode-btn' + (isAbsoluteFilePath(fileRef.path) ? ' active' : '') + '" data-path-mode="absolute">Absolute</button>' +
      '</div>' +
      '<div class="hidden-items-footer">' +
        (hasTauri ? '<button class="board-action-btn" data-replace-action="browse">Browse\u2026</button>' : '') +
        '<button class="board-action-btn" data-replace-action="web-search">Web Search</button>' +
        '<button class="board-action-btn" data-replace-action="cancel">Cancel</button>' +
      '</div>';

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    var matchesEl = dialog.querySelector('.replace-doc-matches');
    var dropZone = dialog.querySelector('.replace-doc-drop-zone');

    // Path mode toggle (relative vs absolute)
    var pathMode = isAbsoluteFilePath(fileRef.path) ? 'absolute' : 'relative';
    dialog.addEventListener('click', function (e) {
      var modeBtn = e.target.closest('[data-path-mode]');
      if (!modeBtn) return;
      pathMode = modeBtn.getAttribute('data-path-mode');
      var allBtns = dialog.querySelectorAll('[data-path-mode]');
      for (var b = 0; b < allBtns.length; b++) {
        allBtns[b].classList.toggle('active', allBtns[b].getAttribute('data-path-mode') === pathMode);
      }
    });

    // Search for files with the same filename
    LexeraApi.request('/boards/' + boardId + '/find-file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: filename }),
    }).then(function (res) {
      var matches = res && res.matches ? res.matches : [];
      if (matches.length === 0) {
        matchesEl.innerHTML = '<div class="replace-doc-hint">No matching files found</div>';
      } else {
        var html = '';
        for (var i = 0; i < matches.length; i++) {
          var short = matches[i].split('/').slice(-3).join('/');
          html += '<div class="replace-doc-match-item" data-path="' + escapeAttr(matches[i]) + '" title="' + escapeAttr(matches[i]) + '">' + escapeHtml(short) + '</div>';
        }
        matchesEl.innerHTML = html;
      }
    }).catch(function () {
      matchesEl.innerHTML = '<div class="replace-doc-hint">Search failed</div>';
    });

    function closeAndApply(newPath) {
      overlay.remove();
      // Convert path to the user's chosen mode (relative or absolute)
      var convertedPath = newPath;
      if (pathMode === 'relative' && isAbsoluteFilePath(newPath)) {
        // Absolute → relative: use adjustPathForIncludeContext (handles include-relative paths)
        convertedPath = adjustPathForIncludeContext(container, newPath);
      }
      // If pathMode is 'absolute' and path is already absolute, keep as-is.
      // If pathMode is 'absolute' and path is relative, resolve to absolute via API.
      var applyTarget = function (finalPath) {
        if (isInclude) {
          updateIncludeTarget(container, finalPath + (fileRef.suffix || ''));
        } else {
          updateEmbedTarget(container, finalPath + (fileRef.suffix || ''));
        }
      };
      if (pathMode === 'absolute' && !isAbsoluteFilePath(convertedPath)) {
        resolveBoardPath(boardId, convertedPath, 'absolute').then(function (absPath) {
          applyTarget(absPath);
        });
      } else {
        applyTarget(convertedPath);
      }
    }

    function applyUploadedFile(file) {
      if (!file) return;
      LexeraApi.uploadMedia(boardId, file).then(function (result) {
        var target = getUploadedMediaEmbedTarget(result);
        if (!target) { showNotification('Upload failed'); return; }
        closeAndApply(target);
      }).catch(function (err) {
        logFrontendIssue('error', 'replace-doc', 'Failed to upload replacement file', err);
        showNotification('Failed to upload replacement file');
      });
    }

    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) overlay.remove();
    });
    dialog.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.stopPropagation(); overlay.remove(); }
    });

    matchesEl.addEventListener('click', function (e) {
      var item = e.target.closest('.replace-doc-match-item');
      if (!item) return;
      closeAndApply(item.getAttribute('data-path'));
    });

    dropZone.addEventListener('dragover', function (e) {
      e.preventDefault();
      dropZone.classList.add('drag-over');
    });
    dropZone.addEventListener('dragleave', function () {
      dropZone.classList.remove('drag-over');
    });
    dropZone.addEventListener('drop', function (e) {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
      var files = e.dataTransfer && e.dataTransfer.files;
      if (files && files.length > 0) applyUploadedFile(files[0]);
    });

    overlay.addEventListener('paste', function (e) {
      var items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      for (var i = 0; i < items.length; i++) {
        if (items[i].kind === 'file') {
          var file = items[i].getAsFile();
          if (file) {
            e.preventDefault();
            e.stopPropagation();
            applyUploadedFile(file);
            return;
          }
        }
      }
    });

    // Focus overlay so paste events fire in Tauri WKWebView
    overlay.focus();

    // Tauri external file drop — OS drops bypass web 'drop' events in Tauri
    // Flag prevents the global app.js drag-drop handler from also processing
    window.__lexeraReplaceDocDropActive = true;
    var tauriDragUnlisteners = [];
    if (hasTauri) {
      var listenFn = (window.__TAURI__ && window.__TAURI__.event && window.__TAURI__.event.listen) ||
        (window.parent && window.parent !== window && window.parent.__TAURI__ && window.parent.__TAURI__.event && window.parent.__TAURI__.event.listen);
      if (listenFn) {
        listenFn('tauri://drag-over', function (event) {
          var pos = event.payload && event.payload.position;
          if (pos && dropZone) {
            var inside = false;
            var rect = dropZone.getBoundingClientRect();
            if (pos.x >= rect.left && pos.x <= rect.right && pos.y >= rect.top && pos.y <= rect.bottom) inside = true;
            dropZone.classList.toggle('drag-over', inside);
          }
        }).then(function (u) { tauriDragUnlisteners.push(u); });
        listenFn('tauri://drag-leave', function () {
          if (dropZone) dropZone.classList.remove('drag-over');
        }).then(function (u) { tauriDragUnlisteners.push(u); });
        listenFn('tauri://drag-drop', function (event) {
          if (dropZone) dropZone.classList.remove('drag-over');
          var paths = event.payload && event.payload.paths;
          if (paths && paths.length > 0) {
            closeAndApply(paths[0]);
          }
        }).then(function (u) { tauriDragUnlisteners.push(u); });
      }
    }

    // Clean up Tauri listeners when overlay is removed
    var origRemove = overlay.remove.bind(overlay);
    overlay.remove = function () {
      window.__lexeraReplaceDocDropActive = false;
      for (var i = 0; i < tauriDragUnlisteners.length; i++) {
        if (typeof tauriDragUnlisteners[i] === 'function') tauriDragUnlisteners[i]();
      }
      tauriDragUnlisteners = [];
      origRemove();
    };

    dialog.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-replace-action]');
      if (!btn) return;
      var action = btn.getAttribute('data-replace-action');
      if (action === 'cancel') {
        overlay.remove();
      } else if (action === 'browse') {
        // Resolve the embed file path; fall back to the board file's directory
        resolveAbsoluteBoardFilePath(boardId, filePath).then(function (absPath) {
          if (absPath && isAbsoluteFilePath(absPath)) return absPath;
          // Fall back: resolve the board file itself to get its directory
          var boardPath = getBoardFilePathForId(boardId);
          if (boardPath && isAbsoluteFilePath(boardPath)) return boardPath;
          if (boardPath) return resolveBoardPath(boardId, boardPath, 'absolute');
          return '';
        }).then(function (startPath) {
          return tauriInvoke('browse_files', {
            title: 'Replace Document',
            defaultPath: startPath || undefined,
          });
        }).then(function (paths) {
          if (paths && paths.length > 0) closeAndApply(paths[0]);
        }).catch(function (err) {
          logFrontendIssue('warn', 'replace-doc.browse', 'File browser failed', err);
        });
      } else if (action === 'web-search') {
        openEmbedWebSearch(container, filePath);
      }
    });
  }

  function showIncludeMenu(container, btn) {
    var filePath = container.getAttribute('data-file-path') || '';
    var boardId = container.getAttribute('data-board-id') || activeBoardId || '';
    if (!filePath || !boardId) return;
    var btnRect = btn.getBoundingClientRect();
    showNativeMenu([
      { id: 'open-system', label: 'Open in System App' },
      { id: 'show-finder', label: 'Show in Finder' },
      { id: 'copy-path', label: 'Copy Path' },
      { separator: true },
      { id: 'replace-document', label: 'Replace Document' },
      { id: 'refresh', label: 'Force Refresh' },
      { id: 'convert-path', label: 'Convert to Relative Path' },
      { separator: true },
      { id: 'info', label: 'Info' },
      { id: 'delete', label: 'Delete Include' },
    ], btnRect.right, btnRect.bottom).then(function (action) {
      if (action) handleIncludeAction(action, container);
    });
  }

  function handleIncludeAction(action, container) {
    if (!container) { closeEmbedMenu(); return; }
    var filePath = container.getAttribute('data-file-path') || '';
    var boardId = container.getAttribute('data-board-id') || activeBoardId || '';
    var fileRef = parseLocalFileReference(filePath);

    if (action === 'replace-document') {
      closeEmbedMenu();
      showReplaceDocumentOverlay(container);

    } else if (action === 'refresh') {
      closeEmbedMenu();
      container.removeAttribute('data-include-enhanced');
      var includeBody = container.querySelector('.include-inline-body');
      if (includeBody) includeBody.innerHTML = '<div class="embed-preview-loading">Loading include...</div>';
      enhanceSingleIncludeDirective(container);

    } else if (action === 'info') {
      closeEmbedMenu();
      if (!boardId || !filePath) return;
      LexeraApi.fileInfo(boardId, fileRef.path).then(function (info) {
        var infoMenu = document.createElement('div');
        infoMenu.className = 'embed-menu embed-info-panel';
        var sizeStr = info.size ? formatFileSize(info.size) : 'unknown';
        var dateStr = info.lastModified ? new Date(info.lastModified * 1000).toLocaleString() : 'unknown';
        infoMenu.innerHTML =
          '<div class="embed-info-title">File Info</div>' +
          '<div class="embed-info-row"><span>Name:</span> ' + escapeHtml(info.filename || '') + '</div>' +
          '<div class="embed-info-row"><span>Path:</span> ' + escapeHtml(info.path || '') + '</div>' +
          '<div class="embed-info-row"><span>Exists:</span> ' + (info.exists ? 'Yes' : 'No') + '</div>' +
          (info.exists ? (
            '<div class="embed-info-row"><span>Size:</span> ' + sizeStr + '</div>' +
            '<div class="embed-info-row"><span>Type:</span> ' + escapeHtml(info.mediaCategory || '') + '</div>' +
            '<div class="embed-info-row"><span>Modified:</span> ' + dateStr + '</div>'
          ) : '') +
          '<div class="embed-menu-item" data-action="close-info" style="margin-top:6px;text-align:center">Close</div>';
        infoMenu._embedContainer = container;
        document.body.appendChild(infoMenu);
        var cr = container.getBoundingClientRect();
        var ir = infoMenu.getBoundingClientRect();
        var ix = cr.right, iy = cr.top;
        if (ix + ir.width > window.innerWidth) ix = window.innerWidth - ir.width - 4;
        if (iy + ir.height > window.innerHeight) iy = window.innerHeight - ir.height - 4;
        if (ix < 0) ix = 4; if (iy < 0) iy = 4;
        infoMenu.style.left = ix + 'px';
        infoMenu.style.top = iy + 'px';
        activeEmbedMenu = infoMenu;
      }).catch(function (err) {
        logFrontendIssue('warn', 'embed.info', 'Failed to load include file info for ' + filePath, err);
      });

    } else if (action === 'preview') {
      closeEmbedMenu();
      showBoardFilePreview(boardId, filePath);

    } else if (action === 'open-system') {
      closeEmbedMenu();
      openBoardFileInSystem(boardId, filePath);

    } else if (action === 'show-finder') {
      closeEmbedMenu();
      if (fileRef.path.charAt(0) !== '/' && boardId) {
        resolveBoardPath(boardId, fileRef.path, 'absolute').then(function (absPath) {
          showInFinder(absPath);
        });
      } else {
        showInFinder(fileRef.path);
      }

    } else if (action === 'copy-path') {
      closeEmbedMenu();
      copyTextToClipboard(filePath, 'Include path copied to clipboard', 'Failed to copy include path');

    } else if (action === 'path-fix') {
      closeEmbedMenu();
      var filename = getDisplayFileNameFromPath(fileRef.path);
      LexeraApi.request('/boards/' + boardId + '/find-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: filename }),
      }).then(function (res) {
        applyAutomaticPathFix(container, res && res.matches ? res.matches : []);
      }).catch(function (err) {
        logFrontendIssue('warn', 'path.fix', 'Automatic path fix failed for include ' + filePath, err);
      });

    } else if (action === 'path-manual') {
      closeEmbedMenu();
      var nextPath = promptForEmbedTarget(filePath, 'Manual path fix');
      if (!nextPath || nextPath === filePath) return;
      updateIncludeTarget(container, nextPath);

    } else if (action === 'path-web-search') {
      closeEmbedMenu();
      openEmbedWebSearch(container, filePath);

    } else if (action === 'convert-path') {
      closeEmbedMenu();
      if (!isAbsoluteFilePath(fileRef.path)) {
        showNotification('Path is already relative');
        return;
      }
      resolveBoardPath(boardId, fileRef.path, 'relative').then(function (nextPath) {
        var nextTarget = nextPath ? nextPath + (fileRef.suffix || '') : '';
        if (!nextTarget || nextTarget === filePath) return;
        updateIncludeTarget(container, nextTarget);
      }).catch(function (err) {
        logFrontendIssue('warn', 'path.convert', 'Path conversion failed for include ' + filePath, err);
      });

    } else if (action === 'delete') {
      closeEmbedMenu();
      deleteIncludeFromSource(container);

    } else if (action && action.indexOf('pick-path:') === 0) {
      closeEmbedMenu();
      var pickedIncPath = adjustPathForIncludeContext(container, action.substring(10));
      updateIncludeTarget(container, pickedIncPath + (fileRef.suffix || ''));

    } else if (action === 'close-info') {
      closeEmbedMenu();
    }
  }

  async function showEmbedMenu(container, btn) {
    var filePath = container.getAttribute('data-file-path') || '';
    var embedUrl = container.getAttribute('data-embed-url') || '';
    var isExternal = isExternalEmbedContainer(container);
    var externalPolicyAction = container.getAttribute('data-external-policy-action') || '';
    var boardId = container.getAttribute('data-board-id') || activeBoardId || '';
    var previewKind = getEmbedPreviewKind(filePath);
    var supportsRenderRetry = !isExternal && !!filePath && isRenderedSpecialPreviewKind(previewKind);
    var specialEditorKind = !isExternal ? getSpecialFileEditorKind(filePath) : '';
    var btnRect = btn.getBoundingClientRect();
    if (supportsRenderRetry) {
      refreshEmbeddedRendererStatuses(false).catch(function () {});
    }
    var items = isExternal
      ? [
          { id: 'open-page', label: 'Open Page Here', disabled: externalPolicyAction !== 'open_page' },
          { id: 'open-url', label: 'Open URL in Browser' },
          { id: 'copy-url', label: 'Copy URL' },
          { id: 'recheck-policy', label: 'Recheck Embed Permission' },
          { separator: true },
          { id: 'edit-url', label: 'Edit URL' },
          { id: 'delete', label: 'Delete Embed' },
        ]
      : [
          { id: 'open-system', label: 'Open in System App' },
          { id: 'show-finder', label: 'Show in Finder' },
          { id: 'copy-path', label: 'Copy Path' },
          { separator: true },
          { id: 'replace-document', label: 'Replace Document' },
          { id: 'refresh', label: 'Force Refresh' },
          { id: 'convert-path', label: 'Convert to Relative Path' },
          { separator: true },
          { id: 'info', label: 'Info' },
          { id: 'delete', label: 'Delete Embed' },
        ];
    if (!isExternal) {
      items = items.filter(Boolean);
    }
    if (!isExternal && !filePath) return;
    if (isExternal && !embedUrl) return;
    showNativeMenu(items, btnRect.right, btnRect.bottom).then(function (action) {
      if (action) handleEmbedAction(action, container, btn);
    });
  }

  function handleEmbedAction(action, container, triggerEl) {
    if (!container) { closeEmbedMenu(); return; }
    if (isIncludeDirectiveContainer(container)) {
      handleIncludeAction(action, container);
      return;
    }
    var filePath = container.getAttribute('data-file-path') || '';
    var embedUrl = getExternalEmbedSourceUrl(container);
    var probeUrl = getExternalEmbedProbeUrl(container);
    var boardId = container.getAttribute('data-board-id') || activeBoardId || '';
    var isExternal = isExternalEmbedContainer(container);
    var fileRef = parseLocalFileReference(filePath);

    if (action === 'replace-document') {
      closeEmbedMenu();
      showReplaceDocumentOverlay(container);

    } else if (action === 'open-page') {
      closeEmbedMenu();
      if (!isExternal || !embedUrl) return;
      openExternalEmbedInPlace(container);

    } else if (action === 'open-url') {
      closeEmbedMenu();
      openUrlInSystem(embedUrl);

    } else if (action === 'copy-url') {
      closeEmbedMenu();
      copyTextToClipboard(embedUrl, 'Embed URL copied to clipboard', 'Failed to copy embed URL');

    } else if (action === 'recheck-policy') {
      closeEmbedMenu();
      clearExternalEmbedPolicyCache(probeUrl || embedUrl);
      container.removeAttribute('data-external-enhanced');
      container.removeAttribute('data-external-opened');
      enhanceSingleExternalEmbedContainer(container, { forceRefresh: true });

    } else if (action === 'edit-url') {
      closeEmbedMenu();
      var nextUrl = promptForEmbedTarget(embedUrl, 'Edit embed URL');
      if (!nextUrl || nextUrl === embedUrl) return;
      updateEmbedTarget(container, nextUrl);

    } else if (action === 'edit-overlay') {
      closeEmbedMenu();
      if (!boardId || !filePath) return;
      openSpecialFileEditorOverlay(boardId, filePath).catch(function (err) {
        showNotification(err && err.message ? err.message : 'Failed to open overlay editor');
      });

    } else if (action === 'refresh') {
      clearCachedFilePreviewState(boardId || '', filePath || '');
      var media = container.querySelector('img, video, audio');
      if (media) {
        var src = media.getAttribute('src').split('?')[0];
        media.setAttribute('src', src + '?t=' + Date.now());
      } else if (container.classList.contains('inline-file-embed-container')) {
        container.removeAttribute('data-inline-enhanced');
        var inlineBody = container.querySelector('.inline-file-embed-body');
        if (inlineBody) inlineBody.innerHTML = '<div class="embed-preview-loading">Loading preview...</div>';
        enhanceSingleInlineFileEmbed(container);
      }
      container.classList.remove('embed-broken');
      container.removeAttribute('data-embed-enhanced');
      var preview = container.querySelector('.embed-preview');
      if (preview) preview.remove();
      enhanceSingleEmbedContainer(container, { forceRerender: true });
      closeEmbedMenu();

    } else if (action === 'render-status') {
      closeEmbedMenu();
      if (!boardId || !filePath) return;
      showFileRendererStatusMenu(boardId, filePath, triggerEl || container);

    } else if (action === 'info') {
      closeEmbedMenu();
      if (!boardId || !filePath) return;
      LexeraApi.fileInfo(boardId, fileRef.path).then(function (info) {
        var infoMenu = document.createElement('div');
        infoMenu.className = 'embed-menu embed-info-panel';
        var sizeStr = info.size ? formatFileSize(info.size) : 'unknown';
        var dateStr = info.lastModified ? new Date(info.lastModified * 1000).toLocaleString() : 'unknown';
        infoMenu.innerHTML =
          '<div class="embed-info-title">File Info</div>' +
          '<div class="embed-info-row"><span>Name:</span> ' + escapeHtml(info.filename || '') + '</div>' +
          '<div class="embed-info-row"><span>Path:</span> ' + escapeHtml(info.path || '') + '</div>' +
          '<div class="embed-info-row"><span>Exists:</span> ' + (info.exists ? 'Yes' : 'No') + '</div>' +
          (info.exists ? (
            '<div class="embed-info-row"><span>Size:</span> ' + sizeStr + '</div>' +
            '<div class="embed-info-row"><span>Type:</span> ' + escapeHtml(info.mediaCategory || '') + '</div>' +
            '<div class="embed-info-row"><span>Modified:</span> ' + dateStr + '</div>'
          ) : '') +
          '<div class="embed-menu-item" data-action="close-info" style="margin-top:6px;text-align:center">Close</div>';
        infoMenu._embedContainer = container;
        document.body.appendChild(infoMenu);
        // Position near the container
        var cr = container.getBoundingClientRect();
        var ir = infoMenu.getBoundingClientRect();
        var ix = cr.right;
        var iy = cr.top;
        if (ix + ir.width > window.innerWidth) ix = window.innerWidth - ir.width - 4;
        if (iy + ir.height > window.innerHeight) iy = window.innerHeight - ir.height - 4;
        if (ix < 0) ix = 4;
        if (iy < 0) iy = 4;
        infoMenu.style.left = ix + 'px';
        infoMenu.style.top = iy + 'px';
        activeEmbedMenu = infoMenu;
      }).catch(function (err) {
        logFrontendIssue('warn', 'embed.info', 'Failed to load embed file info for ' + filePath, err);
      });

    } else if (action === 'close-info') {
      closeEmbedMenu();

    } else if (action === 'open-system') {
      closeEmbedMenu();
      if (!filePath) return;
      openBoardFileInSystem(boardId, filePath);

    } else if (action === 'show-finder') {
      closeEmbedMenu();
      if (!filePath) return;
      if (fileRef.path.charAt(0) !== '/' && boardId) {
        resolveBoardPath(boardId, fileRef.path, 'absolute').then(function (absPath) {
          showInFinder(absPath);
        });
      } else {
        showInFinder(fileRef.path);
      }

    } else if (action === 'copy-path') {
      closeEmbedMenu();
      copyTextToClipboard(filePath, 'Embed path copied to clipboard', 'Failed to copy embed path');

    } else if (action === 'path-fix') {
      closeEmbedMenu();
      if (!boardId || !filePath) return;
      var filename = getDisplayFileNameFromPath(fileRef.path);
      LexeraApi.request('/boards/' + boardId + '/find-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: filename }),
      }).then(function (res) {
        applyAutomaticPathFix(container, res && res.matches ? res.matches : []);
      }).catch(function (err) {
        logFrontendIssue('warn', 'path.fix', 'Automatic path fix failed for embed ' + filePath, err);
      });

    } else if (action === 'path-manual') {
      closeEmbedMenu();
      if (!filePath) return;
      var nextPath = promptForEmbedTarget(filePath, 'Manual path fix');
      if (!nextPath || nextPath === filePath) return;
      updateEmbedTarget(container, nextPath);

    } else if (action === 'paste-image') {
      closeEmbedMenu();
      pasteClipboardImageIntoEmbed(container).catch(function (err) {
        logFrontendIssue('error', 'embed.paste-image', 'Paste Image action failed', err);
        showNotification('Failed to paste image into embed');
      });

    } else if (action === 'path-web-search') {
      closeEmbedMenu();
      openEmbedWebSearch(container, filePath);

    } else if (action === 'convert-path') {
      closeEmbedMenu();
      if (!boardId || !filePath) return;
      if (!isAbsoluteFilePath(fileRef.path)) {
        showNotification('Path is already relative');
        return;
      }
      resolveBoardPath(boardId, fileRef.path, 'relative').then(function (nextPath) {
        var nextTarget = nextPath ? nextPath + (fileRef.suffix || '') : '';
        if (!nextTarget || nextTarget === filePath) return;
        updateEmbedTarget(container, nextTarget);
      }).catch(function (err) {
        logFrontendIssue('warn', 'path.convert', 'Path conversion failed for embed ' + filePath, err);
      });

    } else if (action === 'delete') {
      closeEmbedMenu();
      deleteEmbedFromSource(container);

    } else if (action && action.indexOf('pick-path:') === 0) {
      var newPath = adjustPathForIncludeContext(container, action.substring(10));
      closeEmbedMenu();
      updateEmbedTarget(container, newPath + (fileRef.suffix || ''));
    }
  }

  function _registerWindowGlobals() {

  window.togglePathMenu = function (container, filePath, mediaType) {
    if (!container) return;
    if (filePath) container.setAttribute('data-file-path', filePath);
    container.setAttribute('data-board-id', getCurrentEditorBoardId() || activeBoardId || '');
    if (mediaType) container.setAttribute('data-media-type', mediaType);
    var button = container.querySelector('.image-menu-btn, .video-menu-btn, .embed-menu-btn');
    showEmbedMenu(container, button || container);
  };

  window.handleMediaNotFound = function (element, originalSrc, mediaType) {
    var host = element && element.closest
      ? element.closest('.image-path-overlay-container, .video-path-overlay-container, .wysiwyg-media, .wysiwyg-media-block')
      : null;
    if (!host) host = element && element.parentElement ? element.parentElement : null;
    if (!host) return;
    var resolvedPath = originalSrc || host.getAttribute('data-file-path') || host.getAttribute('data-src') || '';
    var isVideoLike = mediaType === 'video' || mediaType === 'audio';
    var menuClass = isVideoLike ? 'video-menu-btn' : 'image-menu-btn';
    var icon = isVideoLike ? '&#127909;' : '&#128247;';
    host.classList.add('image-broken');
    host.setAttribute('data-file-path', resolvedPath);
    host.setAttribute('data-board-id', getCurrentEditorBoardId() || activeBoardId || '');
    host.setAttribute('data-media-type', mediaType || 'image');
    host.innerHTML =
      '<span class="image-not-found" data-original-src="' + escapeAttr(resolvedPath) + '" title="' + escapeAttr('Failed to load: ' + resolvedPath) + '">' +
        '<span class="image-not-found-text">' + icon + ' ' + escapeHtml(getDisplayFileNameFromPath(resolvedPath) || resolvedPath || 'Missing media') + '</span>' +
        '<button class="' + menuClass + '" type="button" title="Path options" data-action="toggle-menu">&#9776;</button>' +
      '</span>';
    var btn = host.querySelector('.' + menuClass);
    if (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        window.togglePathMenu(host, resolvedPath, mediaType || 'image');
      });
    }
  };

  window.queueMermaidRender = function (id, code) {
    if (DiagramRegistry) {
      DiagramRegistry.enqueue('mermaid', id, code, getCurrentEditorBoardId() || activeBoardId || '');
      DiagramRegistry.flush();
    }
  };

  window.queuePlantUMLRender = function (id, code) {
    if (DiagramRegistry) {
      DiagramRegistry.enqueue('plantuml', id, code, getCurrentEditorBoardId() || activeBoardId || '');
      DiagramRegistry.flush();
    }
  };

  window.processDiagramQueue = flushPendingDiagramQueues;
  window.safeDecodePath = safeDecodePath;
  window.resolveRelativePath = resolveRelativePath;
  window.isRelativeResourcePath = isRelativeResourcePath;
  window.isWindowsAbsolutePath = isWindowsAbsolutePath;
  window.normalizeWindowsAbsolutePath = normalizeWindowsAbsolutePath;
  window.buildWebviewResourceUrl = buildWebviewResourceUrl;

  window.queueDiagramRender = function (id, filePath, diagramType, includeDir) {
    var host = document.getElementById(id);
    var boardId = getCurrentEditorBoardId() || activeBoardId || '';
    var resolvedPath = resolveCurrentEditorResourcePath(filePath, includeDir);
    if (!host || !boardId || !resolvedPath) return;
      renderCachedSpecialPreview(host, boardId, resolvedPath, 'diagram')
        .then(function (rendered) {
          if (!rendered && host) {
            host.innerHTML = buildFilePreviewPlaceholderHtml(
              'diagram',
              resolvedPath,
              buildSpecialPreviewPlaceholderMessage('diagram', boardId, resolvedPath)
            );
          }
        })
      .catch(function (err) {
        logFrontendIssue('warn', 'diagram.preview', 'Failed to render queued diagram preview for ' + resolvedPath, err);
        if (host) {
          host.innerHTML = buildFilePreviewPlaceholderHtml(
            'diagram',
            resolvedPath,
            buildSpecialPreviewPlaceholderMessage('diagram', boardId, resolvedPath)
          );
        }
      });
  };

  window.queuePDFPageRender = function (id, filePath, pageNumber, includeDir) {
    var host = document.getElementById(id);
    var boardId = getCurrentEditorBoardId() || activeBoardId || '';
    var resolvedPath = resolveCurrentEditorResourcePath(filePath, includeDir);
    if (!host || !boardId || !resolvedPath) return;
    var fileRef = parseLocalFileReference(String(resolvedPath || '') + '#' + String(pageNumber || '1'));
    host.innerHTML = '<iframe class="file-preview-frame" src="' +
      escapeAttr(
        LexeraApi.fileUrl(boardId, fileRef.path) +
        '#toolbar=0&navpanes=0&page=' + String(fileRef.pageNumber || 1)
      ) +
      '" style="width:100%;min-height:320px;border:0;border-radius:6px;"></iframe>';
  };

  window.queuePDFSlideshow = function (id, filePath, includeDir) {
    var host = document.getElementById(id);
    var boardId = getCurrentEditorBoardId() || activeBoardId || '';
    var resolvedPath = resolveCurrentEditorResourcePath(filePath, includeDir);
    if (!host || !boardId || !resolvedPath) return;
    var fileRef = parseLocalFileReference(resolvedPath);
    host.innerHTML = '<iframe class="file-preview-frame" src="' +
      escapeAttr(LexeraApi.fileUrl(boardId, fileRef.path) + '#toolbar=0&navpanes=0') +
      '" style="width:100%;min-height:320px;border:0;border-radius:6px;"></iframe>';
  };

  } // end _registerWindowGlobals

  var IMAGE_EMBED_EXTENSIONS = /\.(png|jpg|jpeg|gif|webp|avif|svg)$/i;

  async function uploadFileAndBuildMarkdown(file) {
    if (!activeBoardId) return '';
    var result = await LexeraApi.uploadMedia(activeBoardId, file);
    var target = getUploadedMediaEmbedTarget(result);
    if (!target) return '';
    var name = file.name || 'file';
    if (IMAGE_EMBED_EXTENSIONS.test(name)) {
      return '![' + name + '](' + target + ')';
    }
    return '[' + name + '](' + target + ')';
  }

  async function resolveDropContent(dataTransfer) {
    if (!dataTransfer || !dataTransfer.files || dataTransfer.files.length === 0) return '';
    if (!activeBoardId) return '';
    var parts = [];
    for (var i = 0; i < dataTransfer.files.length; i++) {
      try {
        var md = await uploadFileAndBuildMarkdown(dataTransfer.files[i]);
        if (md) parts.push(md);
      } catch (err) {
        logFrontendIssue('error', 'editor.drop', 'Failed to upload dropped file', err);
      }
    }
    return parts.join('\n');
  }

  async function handleEditorPasteImage(e, textarea) {
    if (!e.clipboardData) return false;
    var imageFile = null;
    var items = e.clipboardData.items;
    if (items) {
      for (var i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image/') === 0) {
          imageFile = items[i].getAsFile();
          break;
        }
      }
    }
    if (!imageFile && e.clipboardData.files) {
      for (var i = 0; i < e.clipboardData.files.length; i++) {
        if (e.clipboardData.files[i].type.indexOf('image/') === 0) {
          imageFile = e.clipboardData.files[i];
          break;
        }
      }
    }
    if (!imageFile) return false;
    if (!activeBoardId) return false;
    e.preventDefault();
    var fileName = buildPastedEmbedImageFileName(imageFile.name);
    var namedFile = createBuiltInNamedFile(imageFile, fileName, imageFile.type || 'image/png');
    try {
      var md = await uploadFileAndBuildMarkdown(namedFile);
      if (md) {
        insertFormatting(textarea, { snippet: md });
        textarea.focus();
      }
    } catch (err) {
      logFrontendIssue('error', 'editor.paste', 'Failed to upload pasted image', err);
    }
    return true;
  }

  async function handleFileDrop(files, targetEl) {
    if (!activeBoardId) return;
    // Find which column the drop target is in
    var colIndex = 0;
    if (targetEl) {
      var colEl = targetEl.closest('.column');
      if (colEl) {
        var ci = colEl.getAttribute('data-col-index');
        if (ci !== null) colIndex = parseInt(ci, 10);
      }
    }
    var hasNewCards = false;
    var undoPushed = false;
    for (var i = 0; i < files.length; i++) {
      var file = files[i];
      try {
        var result = await LexeraApi.uploadMedia(activeBoardId, file);
        if (result && result.filename) {
          var embedSyntax = '![' + file.name + '](' + result.filename + ')';
          var col = getFullColumn(colIndex);
          if (col) {
            if (!undoPushed) {
              pushUndo();
              undoPushed = true;
            }
            col.cards.push({ id: 'card-' + Date.now() + '-' + i, content: embedSyntax, checked: false, kid: null });
            hasNewCards = true;
          }
        }
      } catch (err) {
        lexeraLog('error', '[fileUpload] File upload failed: ' + err);
      }
    }
    if (hasNewCards) {
      await persistBoardMutation({ targets: [{ type: 'column', colIndex: colIndex }] });
    }
  }

  function openInSystem(path) {
    lexeraLog('info', 'Opening in system: ' + path);
    if (hasTauri) {
      tauriInvoke('open_in_system', { path: path }).then(function () {
        lexeraLog('info', 'Opened: ' + path);
      }).catch(function (e) {
        lexeraLog('error', 'open_in_system failed: ' + e);
        showNotification('Failed to open file');
      });
    } else {
      window.open('file://' + path, '_blank');
    }
  }

  function openUrlInSystem(url) {
    if (!url) return;
    if (hasTauri) {
      tauriInvoke('open_url', { url: url }).catch(function (err) {
        logFrontendIssue('warn', 'open.url', 'Tauri URL open failed, falling back to browser open for ' + url, err);
        window.open(url, '_blank', 'noopener,noreferrer');
      });
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  function showInFinder(path) {
    if (hasTauri) {
      tauriInvoke('show_in_folder', { path: path }).then(function (result) {
        lexeraLog('info', 'Revealed in Finder: ' + result);
      }).catch(function (e) {
        lexeraLog('error', 'Show in Finder failed: ' + e);
        showNotification('Failed to reveal in folder');
      });
    }
  }

  function copyTextToClipboard(text, successMessage, failureMessage) {
    if (!text || !navigator.clipboard || !navigator.clipboard.writeText) {
      if (failureMessage) showNotification(failureMessage);
      return Promise.resolve(false);
    }
    return navigator.clipboard.writeText(text).then(function () {
      if (successMessage) showNotification(successMessage);
      return true;
    }).catch(function (err) {
      logFrontendIssue('warn', 'clipboard.copy', 'Clipboard write failed', err);
      if (failureMessage) showNotification(failureMessage);
      return false;
    });
  }

  function copyElementAsMarkdown(elementType, indices) {
    if (!fullBoardData || !activeBoardId) return;
    var md = '';
    if (elementType === 'card') {
      var col = getFullColumn(indices.colIndex);
      if (!col) return;
      var fullIdx = getFullCardIndex(col, indices.cardIndex);
      if (fullIdx === -1) return;
      md = col.cards[fullIdx].content || '';
    } else if (elementType === 'column') {
      var col = getFullColumn(indices.colIndex);
      if (!col) return;
      md = '## ' + (col.title || '') + '\n\n';
      for (var k = 0; k < col.cards.length; k++) {
        md += (col.cards[k].content || '') + '\n\n';
      }
    } else if (elementType === 'row') {
      var row = findFullDataRow(indices.rowIdx);
      if (!row) return;
      md = '# ' + (row.title || '') + '\n\n';
      for (var s = 0; s < row.stacks.length; s++) {
        for (var c = 0; c < row.stacks[s].columns.length; c++) {
          var rcol = row.stacks[s].columns[c];
          md += '## ' + (rcol.title || '') + '\n\n';
          for (var k = 0; k < rcol.cards.length; k++) {
            md += (rcol.cards[k].content || '') + '\n\n';
          }
        }
      }
    } else if (elementType === 'stack') {
      var stack = findFullDataStack(indices.rowIdx, indices.stackIdx);
      if (!stack) return;
      md = '# ' + (stack.title || '') + '\n\n';
      for (var c = 0; c < stack.columns.length; c++) {
        var scol = stack.columns[c];
        md += '## ' + (scol.title || '') + '\n\n';
        for (var k = 0; k < scol.cards.length; k++) {
          md += (scol.cards[k].content || '') + '\n\n';
        }
      }
    } else if (elementType === 'board') {
      if (!fullBoardData.rows) return;
      for (var r = 0; r < fullBoardData.rows.length; r++) {
        var brow = fullBoardData.rows[r];
        if (fullBoardData.rows.length > 1 || (brow.title && brow.title.trim())) {
          md += '# ' + (brow.title || '') + '\n\n';
        }
        for (var s = 0; s < brow.stacks.length; s++) {
          for (var c = 0; c < brow.stacks[s].columns.length; c++) {
            var bcol = brow.stacks[s].columns[c];
            md += '## ' + (bcol.title || '') + '\n\n';
            for (var k = 0; k < bcol.cards.length; k++) {
              var cardContent = bcol.cards[k].content || '';
              if (hasInternalHiddenTag(cardContent, '#hidden-internal-incoming') ||
                  hasInternalHiddenTag(cardContent, '#hidden-internal-parked') ||
                  hasInternalHiddenTag(cardContent, '#hidden-internal-archived') ||
                  hasInternalHiddenTag(cardContent, '#hidden-internal-deleted')) continue;
              md += cardContent + '\n\n';
            }
          }
        }
      }
    }
    md = md.trim();
    if (md) copyTextToClipboard(md, 'Copied as markdown', 'Copy failed');
  }

  function buildExportSelectionForColumn(colIndex) {
    var selection = {
      scope: 'column',
      flatColumnIndex: colIndex
    };
    var col = getFullColumn(colIndex);
    if (col && col.id) selection.columnId = col.id;
    var container = findColumnContainer(colIndex);
    if (container) {
      selection.rowIndex = container.rowIdx;
      selection.stackIndex = container.stackIdx;
      selection.columnIndex = container.localIdx;
    }
    return selection;
  }

  async function exportColumn(colIndex) {
    await triggerBoardExport({
      selection: buildExportSelectionForColumn(colIndex)
    });
  }

  function isExternalEmbedContainer(container) {
    if (!container) return false;
    var embedUrl = container.getAttribute('data-embed-url') || '';
    return !!embedUrl || container.classList.contains('external-embed-container');
  }

  function getEmbedActionTarget(container) {
    if (!container) return '';
    if (isExternalEmbedContainer(container)) {
      return container.getAttribute('data-embed-url') || '';
    }
    return container.getAttribute('data-file-path') || '';
  }

  function getEmbedSearchQuery(container, fallbackPath) {
    if (!container) return getDisplayNameFromPath(fallbackPath || '') || String(fallbackPath || '');
    var label = container.getAttribute('data-alt-text') ||
      container.getAttribute('data-embed-caption') ||
      '';
    label = decodeHtmlEntities(String(label || '').trim());
    return label || getDisplayNameFromPath(fallbackPath || '') || getDisplayFileNameFromPath(fallbackPath || '') || String(fallbackPath || '');
  }

  function mutateBoardTitleSource(node, titleMutator) {
    if (!node || typeof titleMutator !== 'function') return Promise.resolve(false);
    var columnEl = node.closest('.column[data-row-index][data-stack-index][data-col-local-index]');
    if (!columnEl) return Promise.resolve(false);
    var rowIndex = parseInt(columnEl.getAttribute('data-row-index') || '', 10);
    var stackIndex = parseInt(columnEl.getAttribute('data-stack-index') || '', 10);
    var colIndex = parseInt(columnEl.getAttribute('data-col-local-index') || '', 10);
    if (!isFinite(rowIndex) || !isFinite(stackIndex) || !isFinite(colIndex)) return Promise.resolve(false);
    var column = getColumnByLocation(rowIndex, stackIndex, colIndex);
    if (!column) return Promise.resolve(false);
    var nextTitle = titleMutator(column.title || '');
    if (typeof nextTitle !== 'string' || nextTitle === column.title) return Promise.resolve(false);
    pushUndo();
    column.title = normalizeCardContentAfterInlineMutation(nextTitle);
    return persistBoardMutation({ targets: [{ type: 'board' }, { type: 'sidebar' }] });
  }

  function updateBoardFileLinkTarget(container, nextTarget) {
    if (!container) return Promise.resolve(false);
    var linkIndex = parseInt(container.getAttribute('data-link-index'), 10);
    var nextValue = String(nextTarget || '').trim();
    if (!nextValue) return Promise.resolve(false);
    var linkMutator = function (content) {
      return replaceNthMarkdownLink(content, isFinite(linkIndex) ? linkIndex : 0, function (link) {
        return '[' + link.label + '](' + nextValue + (link.title ? ' ' + link.title : '') + ')';
      });
    };
    return Promise.resolve(mutateEmbedSource(container, linkMutator)).then(function (changed) {
      if (changed) return true;
      return mutateBoardTitleSource(container, linkMutator);
    });
  }

  function updateEmbedTarget(container, nextTarget) {
    if (!container) return Promise.resolve(false);
    var embedIndex = parseInt(container.getAttribute('data-embed-index'), 10);
    var nextValue = String(nextTarget || '').trim();
    if (!nextValue) return Promise.resolve(false);
    var embedMutator = function (content) {
      if (!isFinite(embedIndex)) {
        return replaceCurrentEmbedOccurrence(content, container, function (embed) {
          return buildMarkdownEmbed(embed.alt, nextValue, embed.title, embed.rawAttrs);
        });
      }
      return replaceNthMarkdownEmbed(content, isFinite(embedIndex) ? embedIndex : 0, function (embed) {
        return buildMarkdownEmbed(embed.alt, nextValue, embed.title, embed.rawAttrs);
      });
    };
    return Promise.resolve(mutateEmbedSource(container, embedMutator)).then(function (changed) {
      if (changed) return true;
      return mutateBoardTitleSource(container, embedMutator);
    });
  }

  function deleteEmbedFromSource(container) {
    if (!container) return Promise.resolve(false);
    var embedIndex = parseInt(container.getAttribute('data-embed-index'), 10);
    return mutateEmbedSource(container, function (content) {
      if (!isFinite(embedIndex)) {
        return replaceCurrentEmbedOccurrence(content, container, function () {
          return '';
        });
      }
      return replaceNthMarkdownEmbed(content, isFinite(embedIndex) ? embedIndex : 0, function () {
        return '';
      });
    });
  }

  function promptForEmbedTarget(initialValue, titleText) {
    var currentValue = String(initialValue || '').trim();
    if (!currentValue) return '';
    var nextValue = window.prompt(titleText || 'Update embed target', currentValue);
    if (nextValue == null) return '';
    return String(nextValue).trim();
  }

  function openEmbedWebSearch(container, filePath) {
    var query = getEmbedSearchQuery(container, filePath);
    if (!query) return;
    var mediaType = container ? (container.getAttribute('data-media-type') || '') : '';
    var searchUrl = mediaType === 'image'
      ? 'https://www.google.com/search?tbm=isch&q=' + encodeURIComponent(query)
      : 'https://www.google.com/search?q=' + encodeURIComponent(query);
    openUrlInSystem(searchUrl);
  }

  async function pasteClipboardImageIntoEmbed(container) {
    if (!container) return false;
    if (!hasTauri) {
      showNotification('Paste Image requires the desktop app');
      return false;
    }
    var boardId = container.getAttribute('data-board-id') || activeBoardId || '';
    if (!boardId) {
      showNotification('No active board selected');
      return false;
    }
    var imgResult;
    try {
      imgResult = await tauriInvoke('read_clipboard_image');
    } catch (err) {
      logFrontendIssue('warn', 'embed.paste-image', 'Failed to read clipboard image', err);
      showNotification('No image found in clipboard');
      return false;
    }
    if (!imgResult || !imgResult.data) {
      showNotification('No image found in clipboard');
      return false;
    }
    var bytes = decodeBase64BinaryStringToUint8Array(imgResult.data);
    if (!bytes || bytes.length === 0) {
      showNotification('Clipboard image is empty');
      return false;
    }
    var fileName = buildPastedEmbedImageFileName(imgResult.filename);
    var file = createBuiltInNamedFile(bytes, fileName, 'image/png');
    var uploadResult;
    try {
      uploadResult = await LexeraApi.uploadMedia(boardId, file);
    } catch (err) {
      logFrontendIssue('error', 'embed.paste-image', 'Failed to upload pasted clipboard image', err);
      showNotification('Failed to upload pasted image');
      return false;
    }
    var nextTarget = getUploadedMediaEmbedTarget(uploadResult);
    if (!nextTarget) {
      showNotification('Failed to upload pasted image');
      return false;
    }
    var changed = await updateEmbedTarget(container, nextTarget);
    if (changed) {
      showNotification('Pasted image into embed');
      return true;
    }
    showNotification('Failed to update embed target');
    return false;
  }

  function applyAutomaticPathFix(container, matches) {
    var resolvedMatches = Array.isArray(matches) ? matches.filter(Boolean) : [];
    showPathFixResults(container, resolvedMatches);
  }

  function showPathFixResults(container, matches) {
    var menu = document.createElement('div');
    menu.className = 'embed-menu embed-info-panel';
    if (matches.length === 0) {
      menu.innerHTML =
        '<div class="embed-info-title">Path Fix</div>' +
        '<div class="embed-info-row">No matching files found</div>' +
        '<div class="embed-menu-item" data-action="close-info" style="margin-top:6px;text-align:center">Close</div>';
    } else {
      var html = '<div class="embed-info-title">Found ' + matches.length + ' match(es)</div>';
      for (var i = 0; i < matches.length; i++) {
        var short = matches[i].split('/').slice(-3).join('/');
        html += '<div class="embed-menu-item" data-action="pick-path:' + escapeHtml(matches[i]) + '" title="' + escapeHtml(matches[i]) + '">' + escapeHtml(short) + '</div>';
      }
      html += '<div class="embed-menu-divider"></div>';
      html += '<div class="embed-menu-item" data-action="close-info" style="text-align:center">Cancel</div>';
      menu.innerHTML = html;
    }
    menu._embedContainer = container;
    document.body.appendChild(menu);
    var cr = container.getBoundingClientRect();
    var mr = menu.getBoundingClientRect();
    var px = cr.right;
    var py = cr.top;
    if (px + mr.width > window.innerWidth) px = window.innerWidth - mr.width - 4;
    if (py + mr.height > window.innerHeight) py = window.innerHeight - mr.height - 4;
    if (px < 0) px = 4;
    if (py < 0) py = 4;
    menu.style.left = px + 'px';
    menu.style.top = py + 'px';
    activeEmbedMenu = menu;
  }

  function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }


  // -- Extracted code ends --

  // Helper: wrap a function so _syncState() runs before each call
  function _w(fn) {
    return function () { _syncState(); return fn.apply(this, arguments); };
  }

  function init(deps) {
    if (typeof window !== 'undefined' && window.LexeraRuntime) {
      window.LexeraRuntime.mergeDeps(_deps, deps);
    } else {
      _deps = deps || {};
    }
    includeResolvedContentCache.clear();
    _syncState();
  }

  return {
    init: init,

    // Pure utilities (no state sync needed)
    isMarkdownPreviewExtension: isMarkdownPreviewExtension,
    isTextPreviewExtension: isTextPreviewExtension,
    normalizeFilePathForDetection: normalizeFilePathForDetection,
    getSpecialPreviewType: getSpecialPreviewType,
    getPreviewKindMeta: getPreviewKindMeta,
    buildFilePreviewPlaceholderHtml: _w(buildFilePreviewPlaceholderHtml),
    getFileEmbedChipHtml: _w(getFileEmbedChipHtml),
    getSpecialPreviewPlaceholderText: getSpecialPreviewPlaceholderText,
    isRenderedSpecialPreviewKind: isRenderedSpecialPreviewKind,
    getEmbedPreviewKind: getEmbedPreviewKind,
    getEmbedPreviewCacheKey: getEmbedPreviewCacheKey,
    getFileInfoCacheKey: getFileInfoCacheKey,
    getSpecialFileEditorKind: getSpecialFileEditorKind,
    getSpecialFileEditorAssetPath: getSpecialFileEditorAssetPath,
    parseSpecialFileEditorInitialData: parseSpecialFileEditorInitialData,
    normalizeExternalEmbedUrlForCache: normalizeExternalEmbedUrlForCache,
    getExternalEmbedParentOrigin: getExternalEmbedParentOrigin,
    isExternalHttpUrl: isExternalHttpUrl,
    isKnownExternalEmbedUrl: isKnownExternalEmbedUrl,
    hasForcedExternalEmbedFlag: hasForcedExternalEmbedFlag,
    getCanonicalExternalEmbedFrameUrl: getCanonicalExternalEmbedFrameUrl,
    getExternalEmbedConfig: getExternalEmbedConfig,
    shouldRenderExternalEmbed: shouldRenderExternalEmbed,
    sanitizeCssLength: sanitizeCssLength,
    normalizeMarkdownAttrValue: normalizeMarkdownAttrValue,
    parseMarkdownImageAttributes: parseMarkdownImageAttributes,
    parseMarkdownTarget: parseMarkdownTarget,
    getMarkdownMediaStyleAttr: getMarkdownMediaStyleAttr,
    buildMarkdownEmbed: buildMarkdownEmbed,
    getEmbedPreviewPageNumber: getEmbedPreviewPageNumber,

    // Path utilities
    encodeUtf8Base64: encodeUtf8Base64,
    getPathStem: getPathStem,
    buildDiagramCachePrefix: buildDiagramCachePrefix,
    buildDiagramCacheFileName: buildDiagramCacheFileName,
    buildDiagramCacheDir: _w(buildDiagramCacheDir),
    buildPlantUmlCachePath: buildPlantUmlCachePath,
    isAbsoluteFilePath: isAbsoluteFilePath,
    isBoardRelativePath: isBoardRelativePath,
    joinBoardRelativePath: joinBoardRelativePath,
    computeRelativePath: computeRelativePath,

    // Rendering
    renderInlineFileEmbedHtml: _w(renderInlineFileEmbedHtml),
    renderBoardFileLinkHtml: _w(renderBoardFileLinkHtml),
    renderMarkdownLinkHtml: _w(renderMarkdownLinkHtml),
    renderIncludeDirectiveHtml: _w(renderIncludeDirectiveHtml),
    renderWikiLinkHtml: _w(renderWikiLinkHtml),
    renderTagChipHtml: _w(renderTagChipHtml),
    renderTemporalTagHtml: renderTemporalTagHtml,
    renderEmbedPreviewContent: _w(renderEmbedPreviewContent),

    // State-dependent operations
    setSpecialPreviewError: _w(setSpecialPreviewError),
    getSpecialPreviewError: _w(getSpecialPreviewError),
    buildSpecialPreviewPlaceholderMessage: _w(buildSpecialPreviewPlaceholderMessage),
    requestFileInfo: _w(requestFileInfo),
    peekFileInfoSync: _w(peekFileInfoSync),
    clearCachedFilePreviewState: _w(clearCachedFilePreviewState),
    clearBoardPreviewCaches: _w(clearBoardPreviewCaches),
    clearExternalEmbedPolicyCache: _w(clearExternalEmbedPolicyCache),
    renderCachedSpecialPreview: _w(renderCachedSpecialPreview),
    requestRenderedPlantUmlSvg: _w(requestRenderedPlantUmlSvg),
    resolveCachedSpecialPreviewAsset: _w(resolveCachedSpecialPreviewAsset),
    resolveAbsoluteBoardFilePath: _w(resolveAbsoluteBoardFilePath),

    // Preview / editor overlays
    showBoardFilePreview: _w(showBoardFilePreview),
    openSpecialFileEditorOverlay: _w(openSpecialFileEditorOverlay),
    closeSpecialFileEditorOverlay: _w(closeSpecialFileEditorOverlay),
    showFileRendererStatusMenu: _w(showFileRendererStatusMenu),
    refreshVisibleBoardFileEmbeds: _w(refreshVisibleBoardFileEmbeds),
    refreshVisibleIncludePreviews: _w(refreshVisibleIncludePreviews),

    // Enhancement
    enhanceEmbeddedContent: _w(enhanceEmbeddedContent),
    enhanceSingleEmbedContainer: _w(enhanceSingleEmbedContainer),
    enhanceSingleExternalEmbedContainer: _w(enhanceSingleExternalEmbedContainer),
    enhanceSingleFileLink: _w(enhanceSingleFileLink),
    enhanceSingleInlineFileEmbed: _w(enhanceSingleInlineFileEmbed),
    enhanceSingleColumnIncludeBadge: _w(enhanceSingleColumnIncludeBadge),
    enhanceSingleIncludeDirective: _w(enhanceSingleIncludeDirective),

    // Menus & actions
    closeEmbedMenu: _w(closeEmbedMenu),
    showEmbedMenu: _w(showEmbedMenu),
    showIncludeMenu: _w(showIncludeMenu),
    showBoardFileLinkMenu: _w(showBoardFileLinkMenu),
    showDiagramMenu: _w(showDiagramMenu),
    showWikiMenu: _w(showWikiMenu),
    handleEmbedAction: _w(handleEmbedAction),
    handleIncludeAction: _w(handleIncludeAction),
    handleBoardFileLinkAction: _w(handleBoardFileLinkAction),
    handleDiagramAction: _w(handleDiagramAction),
    handleWikiAction: _w(handleWikiAction),

    // Embed source mutations
    mutateEmbedSource: _w(mutateEmbedSource),
    updateEmbedTarget: _w(updateEmbedTarget),
    deleteEmbedFromSource: _w(deleteEmbedFromSource),
    updateIncludeTarget: _w(updateIncludeTarget),
    deleteIncludeFromSource: _w(deleteIncludeFromSource),
    updateBoardFileLinkTarget: _w(updateBoardFileLinkTarget),
    replaceNthMarkdownEmbed: replaceNthMarkdownEmbed,
    replaceNthMarkdownLink: replaceNthMarkdownLink,
    normalizeCardContentAfterInlineMutation: normalizeCardContentAfterInlineMutation,
    resolveMarkdownRelativeTargets: resolveMarkdownRelativeTargets,
    getIncludeResolvedContent: _w(getIncludeResolvedContent),
    adjustPathForIncludeContext: _w(adjustPathForIncludeContext),
    findCardRefById: _w(findCardRefById),
    mutateBoardTitleSource: _w(mutateBoardTitleSource),

    // DOM utilities
    isExternalEmbedContainer: isExternalEmbedContainer,
    isIncludeDirectiveContainer: isIncludeDirectiveContainer,
    getEmbedActionTarget: getEmbedActionTarget,
    getEmbedSearchQuery: getEmbedSearchQuery,
    promptForEmbedTarget: promptForEmbedTarget,
    applyAutomaticPathFix: _w(applyAutomaticPathFix),
    formatFileSize: formatFileSize,
    showPathFixResults: _w(showPathFixResults),
    openEmbedWebSearch: _w(openEmbedWebSearch),
    pasteClipboardImageIntoEmbed: _w(pasteClipboardImageIntoEmbed),

    // Upload / drop / paste
    uploadFileAndBuildMarkdown: _w(uploadFileAndBuildMarkdown),
    resolveDropContent: _w(resolveDropContent),
    handleEditorPasteImage: _w(handleEditorPasteImage),
    handleFileDrop: _w(handleFileDrop),

    // Clipboard / export
    copyTextToClipboard: _w(copyTextToClipboard),
    copyElementAsMarkdown: _w(copyElementAsMarkdown),
    exportColumn: _w(exportColumn),
    buildExportSelectionForColumn: _w(buildExportSelectionForColumn),

    // External embed
    openExternalEmbedInPlace: _w(openExternalEmbedInPlace),
    requestExternalEmbedPolicy: _w(requestExternalEmbedPolicy),
    buildExternalEmbedFrameHtml: buildExternalEmbedFrameHtml,
    renderExternalEmbedPrompt: renderExternalEmbedPrompt,

    // Tauri / system
    resolveTauriInternals: resolveTauriInternals,
    tauriInvoke: tauriInvoke,
    tauriListen: tauriListen,
    showNativeMenu: showNativeMenu,
    showHtmlMenu: showHtmlMenu,
    closeHtmlMenu: closeHtmlMenu,

    // KNOWN_EXTERNAL_EMBED_PATTERNS exposed for tests
    KNOWN_EXTERNAL_EMBED_PATTERNS: KNOWN_EXTERNAL_EMBED_PATTERNS,
    IMAGE_EMBED_EXTENSIONS: IMAGE_EMBED_EXTENSIONS,

    // Register content enhancers and event listeners
    _registerContentEnhancers: _w(_registerContentEnhancers),
    _registerEventListeners: _w(_registerEventListeners),
    _registerWindowGlobals: _w(_registerWindowGlobals)
  };
})();

if (typeof window !== 'undefined') window.LexeraEmbedMenu = LexeraEmbedMenu;
