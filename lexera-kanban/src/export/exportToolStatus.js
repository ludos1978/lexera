/**
 * Export Tool Status — manages export tool availability cache, status
 * formatting, refresh logic, and menu item builders for Pandoc and
 * embedded renderers.
 *
 * Dependencies (injected via init()):
 *   deps.tauriInvoke      — function(cmd, args) => Promise
 *   deps.hasTauri          — boolean or function() => boolean
 *   deps.buildModeMenuItems — function(currentValue, actionPrefix, options)
 *   deps.storage           — localStorage-compatible object
 *
 * External modules (read from window at call time):
 *   window.ExportService           — checkPandocStatus()
 *   window.LexeraExportUiPreferences — normalizers
 */
var ExportToolStatus = (function () {

  // Mirror to parent frame's logger — kanban UI runs in a workspace-shell
  // iframe; the user watches the shell's Log panel. Same pattern as
  // exportLexeraLog() in exportService.js.
  function toolStatusLog(level, message) {
    try { if (typeof lexeraLog === 'function') lexeraLog(level, message); }
    catch (e) { /* local logger not ready yet */ }
    try {
      if (window.parent && window.parent !== window
          && typeof window.parent.lexeraLog === 'function') {
        window.parent.lexeraLog(level, message);
      }
    } catch (e) { /* cross-origin — ignore */ }
  }

  // ── Injected dependencies ──────────────────────────────────────────

  var _deps = {};

  function init(deps) {
    if (typeof window !== 'undefined' && window.LexeraRuntime) {
      window.LexeraRuntime.mergeDeps(_deps, deps);
    } else {
      _deps = deps || {};
    }
  }

  function getDeps() {
    return _deps || {};
  }

  // ── Preference normalizers (delegate to LexeraExportUiPreferences) ─

  function getPrefs() {
    return window.LexeraExportUiPreferences || null;
  }

  function normalizeExportDialogFormat(value) {
    var prefs = getPrefs();
    if (prefs && typeof prefs.normalizeExportDialogFormat === 'function') {
      return prefs.normalizeExportDialogFormat(value);
    }
    var normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'keep' || normalized === 'kanban' || normalized === 'document') return normalized;
    return 'presentation';
  }

  function normalizePandocExportFormat(value) {
    var prefs = getPrefs();
    if (prefs && typeof prefs.normalizePandocExportFormat === 'function') {
      return prefs.normalizePandocExportFormat(value);
    }
    var normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'odt' || normalized === 'epub') return normalized;
    return 'docx';
  }

  function normalizeDocumentPageBreakPreference(value) {
    var prefs = getPrefs();
    if (prefs && typeof prefs.normalizeDocumentPageBreakPreference === 'function') {
      return prefs.normalizeDocumentPageBreakPreference(value);
    }
    var normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'per-task' || normalized === 'pertask') return 'perTask';
    if (normalized === 'per-column' || normalized === 'percolumn') return 'perColumn';
    return 'continuous';
  }

  // ── Storage keys and helpers ───────────────────────────────────────

  var EXPORT_DEFAULT_STORAGE_KEYS = {
    marpTheme: 'lexera-export-marp-theme',
    speakerNotes: 'lexera-export-speaker-notes',
    htmlComments: 'lexera-export-html-comments',
    htmlContent: 'lexera-export-html-content',
    pandocFormat: 'lexera-export-pandoc-format',
    pandocPageBreaks: 'lexera-export-pandoc-page-breaks'
  };

  function getStorage() {
    var deps = getDeps();
    return deps.storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  }

  function getStoredExportDefault(key, fallback) {
    var storageKey = EXPORT_DEFAULT_STORAGE_KEYS[key];
    if (!storageKey) return fallback;
    var store = getStorage();
    if (!store) return fallback;
    var raw = store.getItem(storageKey);
    return raw == null || raw === '' ? fallback : raw;
  }

  function setStoredExportDefault(key, value) {
    var storageKey = EXPORT_DEFAULT_STORAGE_KEYS[key];
    if (!storageKey) return;
    var store = getStorage();
    if (!store) return;
    if (value == null || value === '') store.removeItem(storageKey);
    else store.setItem(storageKey, String(value));
  }

  function getStoredPandocDefaults() {
    return {
      format: normalizePandocExportFormat(getStoredExportDefault('pandocFormat', 'docx')),
      pageBreaks: normalizeDocumentPageBreakPreference(getStoredExportDefault('pandocPageBreaks', 'continuous'))
    };
  }

  // ── Tool status cache ──────────────────────────────────────────────

  var exportToolStatusCache = {
    pandoc: { available: false, version: null, checkedAt: 0, pending: null, error: null },
    renderers: { rows: [], checkedAt: 0, pending: null, error: null }
  };

  function getToolStatusCache() {
    return exportToolStatusCache;
  }

  // ── Status formatting ──────────────────────────────────────────────

  function formatExportToolStatusLabel(toolName, status) {
    if (!status) return toolName + ': Unknown';
    if (status.pending) return toolName + ': Checking\u2026';
    if (status.available) return toolName + ': Ready' + (status.version ? ' (v' + status.version + ')' : '');
    if (status.error) return toolName + ': Unavailable';
    return toolName + ': Not Installed';
  }

  function formatEmbeddedRendererStatusSummary(cache) {
    if (!cache) return 'Embedded Renderers: Unknown';
    if (cache.pending) return 'Embedded Renderers: Checking\u2026';
    if (cache.error && (!cache.rows || cache.rows.length === 0)) return 'Embedded Renderers: Unavailable';
    var rows = Array.isArray(cache.rows) ? cache.rows : [];
    if (rows.length === 0) return 'Embedded Renderers: Unknown';
    var readyCount = 0;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i] && rows[i].available) readyCount += 1;
    }
    return 'Embedded Renderers: ' + readyCount + '/' + rows.length + ' Ready';
  }

  function formatEmbeddedRendererStatusItem(status) {
    if (!status) return 'Unknown Renderer';
    var label = (status.label || 'Renderer') + ': ' + (status.available ? 'Ready' : 'Missing');
    if (status.version) label += ' (' + status.version + ')';
    if (!status.available && status.details) label += ' - ' + status.details;
    return label;
  }

  // ── Status refresh ─────────────────────────────────────────────────

  function refreshEmbeddedRendererStatuses(force) {
    var cache = exportToolStatusCache.renderers;
    var maxAgeMs = 30000;
    if (!force && cache.checkedAt > 0 && (Date.now() - cache.checkedAt) < maxAgeMs && !cache.pending) {
      return Promise.resolve(cache);
    }
    if (cache.pending) return cache.pending;
    var deps = getDeps();
    var tauriAvailable = typeof deps.hasTauri === 'function' ? deps.hasTauri() : !!deps.hasTauri;
    if (!tauriAvailable) {
      cache.rows = [];
      cache.error = 'tauri-unavailable';
      cache.checkedAt = Date.now();
      toolStatusLog('warn', '[ExportToolStatus] embedded-renderer check skipped: Tauri unavailable');
      return Promise.resolve(cache);
    }
    var invoke = deps.tauriInvoke;
    if (typeof invoke !== 'function') {
      cache.error = 'no-invoke';
      cache.checkedAt = Date.now();
      toolStatusLog('error', '[ExportToolStatus] embedded-renderer check skipped: deps.tauriInvoke missing despite hasTauri=true');
      return Promise.resolve(cache);
    }
    cache.pending = invoke('check_embedded_renderer_statuses', {})
      .then(function (rows) {
        cache.rows = Array.isArray(rows) ? rows : [];
        cache.error = null;
        cache.checkedAt = Date.now();
        cache.pending = null;
        return cache;
      })
      .catch(function (err) {
        cache.rows = [];
        cache.error = err ? (err.message || String(err)) : 'unknown-error';
        cache.checkedAt = Date.now();
        cache.pending = null;
        toolStatusLog('warn', '[ExportToolStatus] check_embedded_renderer_statuses failed: ' + cache.error);
        return cache;
      });
    return cache.pending;
  }

  function refreshExportToolStatus(toolName, force) {
    var cache = exportToolStatusCache[toolName];
    if (!cache) {
      toolStatusLog('warn', '[ExportToolStatus] refreshExportToolStatus called for unknown tool: ' + toolName);
      return Promise.resolve({ available: false, version: null, checkedAt: 0, pending: null, error: 'unknown-tool' });
    }
    var maxAgeMs = 30000;
    if (!force && cache.checkedAt > 0 && (Date.now() - cache.checkedAt) < maxAgeMs && !cache.pending) {
      return Promise.resolve(cache);
    }
    if (cache.pending) return cache.pending;
    if (toolName !== 'pandoc' || !window.ExportService || typeof window.ExportService.checkPandocStatus !== 'function') {
      cache.error = 'unavailable';
      cache.available = false;
      cache.version = null;
      cache.checkedAt = Date.now();
      toolStatusLog('warn', '[ExportToolStatus] ' + toolName + ' status check unavailable: '
        + (toolName !== 'pandoc' ? 'only pandoc is supported' : 'ExportService.checkPandocStatus missing'));
      return Promise.resolve(cache);
    }
    cache.pending = window.ExportService.checkPandocStatus().then(function (status) {
      cache.available = !!(status && status.available);
      cache.version = status && status.version ? status.version : null;
      cache.error = null;
      cache.checkedAt = Date.now();
      cache.pending = null;
      return cache;
    }).catch(function (err) {
      cache.available = false;
      cache.version = null;
      cache.error = err ? (err.message || String(err)) : 'unknown-error';
      cache.checkedAt = Date.now();
      cache.pending = null;
      toolStatusLog('warn', '[ExportToolStatus] checkPandocStatus failed: ' + cache.error);
      return cache;
    });
    return cache.pending;
  }

  // ── Menu item builders ─────────────────────────────────────────────

  function buildModeMenuItemsInternal(currentValue, actionPrefix, options) {
    var deps = getDeps();
    if (deps.buildModeMenuItems && typeof deps.buildModeMenuItems === 'function') {
      return deps.buildModeMenuItems(currentValue, actionPrefix, options);
    }
    // Inline fallback matching app.js buildModeMenuItems
    var items = [];
    for (var i = 0; i < options.length; i++) {
      var option = options[i];
      if (option && option.separator) { items.push({ separator: true }); continue; }
      items.push({
        id: actionPrefix + ':' + option.value,
        label: (currentValue === option.value ? '\u2713 ' : '') + option.label
      });
    }
    return items;
  }

  function buildPandocOutputFormatItems(actionPrefix) {
    return buildModeMenuItemsInternal(getStoredPandocDefaults().format, actionPrefix, [
      { value: 'docx', label: 'DOCX' },
      { value: 'odt', label: 'ODT' },
      { value: 'epub', label: 'EPUB' }
    ]);
  }

  function buildDocumentPageBreakModeItems(actionPrefix) {
    return buildModeMenuItemsInternal(getStoredPandocDefaults().pageBreaks, actionPrefix, [
      { value: 'continuous', label: 'Continuous' },
      { value: 'perTask', label: 'Per Task' },
      { value: 'perColumn', label: 'Per Column' }
    ]);
  }

  function buildEmbeddedRendererStatusMenuItems() {
    var cache = exportToolStatusCache.renderers;
    var items = [
      { id: 'file-renderer-status-summary', label: formatEmbeddedRendererStatusSummary(cache), disabled: true },
      { id: 'file-renderer-refresh-status', label: 'Refresh Status' }
    ];
    var rows = cache && Array.isArray(cache.rows) ? cache.rows : [];
    if (rows.length > 0) {
      items.push({ separator: true });
      for (var i = 0; i < rows.length; i++) {
        items.push({
          id: 'file-renderer-status-item:' + String(rows[i].id || i),
          label: formatEmbeddedRendererStatusItem(rows[i]),
          disabled: true
        });
      }
    }
    return items;
  }

  function buildFileHeaderPandocMenuItems() {
    var status = exportToolStatusCache.pandoc;
    return [
      { id: 'file-pandoc-status', label: formatExportToolStatusLabel('Pandoc', status), disabled: true },
      { id: 'file-pandoc-refresh-status', label: 'Refresh Status' },
      { separator: true },
      { id: 'file-pandoc-open-export', label: 'Open Document Export' },
      {
        id: 'file-pandoc-output-format',
        label: 'Output Format',
        items: buildPandocOutputFormatItems('file-pandoc-set-format')
      },
      {
        id: 'file-pandoc-page-breaks',
        label: 'Page Breaks',
        items: buildDocumentPageBreakModeItems('file-pandoc-set-page-breaks')
      }
    ];
  }

  // ── Menu action handlers ───────────────────────────────────────────

  function handleBoardPandocMenuAction(action, triggerExportFn) {
    if (action === 'file-pandoc-refresh-status') {
      return refreshExportToolStatus('pandoc', true).then(function () { return true; });
    }
    if (action === 'file-pandoc-open-export') {
      if (typeof triggerExportFn === 'function') {
        return Promise.resolve(triggerExportFn({ format: 'document', runPandoc: true })).then(function () { return true; });
      }
      return Promise.resolve(true);
    }
    if (action.indexOf('file-pandoc-set-format:') === 0) {
      setStoredExportDefault('pandocFormat', normalizePandocExportFormat(action.substring('file-pandoc-set-format:'.length)));
      return Promise.resolve(true);
    }
    if (action.indexOf('file-pandoc-set-page-breaks:') === 0) {
      setStoredExportDefault('pandocPageBreaks', normalizeDocumentPageBreakPreference(action.substring('file-pandoc-set-page-breaks:'.length)));
      return Promise.resolve(true);
    }
    return Promise.resolve(false);
  }

  function handleEmbeddedRendererMenuAction(action) {
    if (action === 'file-renderer-refresh-status') {
      return refreshEmbeddedRendererStatuses(true).then(function () { return true; });
    }
    return Promise.resolve(false);
  }

  // ── Public API ─────────────────────────────────────────────────────

  return {
    init: init,

    // Normalizers (delegating to LexeraExportUiPreferences)
    normalizeExportDialogFormat: normalizeExportDialogFormat,
    normalizePandocExportFormat: normalizePandocExportFormat,
    normalizeDocumentPageBreakPreference: normalizeDocumentPageBreakPreference,

    // Storage helpers
    EXPORT_DEFAULT_STORAGE_KEYS: EXPORT_DEFAULT_STORAGE_KEYS,
    getStoredExportDefault: getStoredExportDefault,
    setStoredExportDefault: setStoredExportDefault,
    getStoredPandocDefaults: getStoredPandocDefaults,

    // Tool status cache
    getToolStatusCache: getToolStatusCache,

    // Status formatting
    formatExportToolStatusLabel: formatExportToolStatusLabel,
    formatEmbeddedRendererStatusSummary: formatEmbeddedRendererStatusSummary,
    formatEmbeddedRendererStatusItem: formatEmbeddedRendererStatusItem,

    // Status refresh
    refreshEmbeddedRendererStatuses: refreshEmbeddedRendererStatuses,
    refreshExportToolStatus: refreshExportToolStatus,

    // Menu builders
    buildPandocOutputFormatItems: buildPandocOutputFormatItems,
    buildDocumentPageBreakModeItems: buildDocumentPageBreakModeItems,
    buildEmbeddedRendererStatusMenuItems: buildEmbeddedRendererStatusMenuItems,
    buildFileHeaderPandocMenuItems: buildFileHeaderPandocMenuItems,

    // Menu action handlers
    handleBoardPandocMenuAction: handleBoardPandocMenuAction,
    handleEmbeddedRendererMenuAction: handleEmbeddedRendererMenuAction
  };
})();

window.ExportToolStatus = ExportToolStatus;
