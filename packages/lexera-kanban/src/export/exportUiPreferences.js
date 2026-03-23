const LexeraExportUiPreferences = (function () {
  const EXPORT_UI_STORAGE_KEYS = {
    preset: 'lexera-export-preset',
    marpTheme: 'lexera-export-marp-theme',
    marpBrowser: 'lexera-export-marp-browser',
    speakerNotes: 'lexera-export-speaker-notes',
    htmlComments: 'lexera-export-html-comments',
    htmlContent: 'lexera-export-html-content',
    embedHandling: 'lexera-export-embed-handling',
    pandocFormat: 'lexera-export-pandoc-format',
    pandocPageBreaks: 'lexera-export-pandoc-page-breaks',
    excludeEnabled: 'lexera-export-exclude-enabled',
    excludeTags: 'lexera-export-exclude-tags',
    stripIncludes: 'lexera-export-strip-includes',
    autoExportOnSave: 'lexera-export-auto-export-on-save',
    linkHandlingMode: 'lexera-export-link-handling-mode',
    packFiles: 'lexera-export-pack-files',
    packImages: 'lexera-export-pack-images',
    packVideos: 'lexera-export-pack-videos',
    packOtherMedia: 'lexera-export-pack-other-media',
    packDocuments: 'lexera-export-pack-documents',
    packFileSizeLimit: 'lexera-export-pack-file-size-limit',
  };

  const EXPORT_UI_LEGACY_STORAGE_KEYS = {
    marpTheme: 'kanban-marp-theme',
    marpBrowser: 'kanban-marp-browser',
    speakerNotes: 'kanban-speaker-note-mode',
    htmlComments: 'kanban-html-comment-mode',
    htmlContent: 'kanban-html-content-mode',
    embedHandling: 'kanban-embed-handling',
    excludeTags: 'kanban-export-exclude-tags',
    linkHandlingMode: 'kanban-link-handling-mode',
    packFiles: 'kanban-pack-files',
    packImages: 'kanban-pack-images',
    packVideos: 'kanban-pack-videos',
    packOtherMedia: 'kanban-pack-other-media',
    packDocuments: 'kanban-pack-documents',
    packFileSizeLimit: 'kanban-file-size-limit',
  };

  function normalizeExportDialogFormat(value) {
    var normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'keep' || normalized === 'kanban' || normalized === 'document') return normalized;
    return 'presentation';
  }

  function normalizeExportPreset(value) {
    var normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'marp-presentation' || normalized === 'marp-pdf' || normalized === 'share-content') {
      return normalized;
    }
    return 'custom';
  }

  function normalizePandocExportFormat(value) {
    var normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'odt' || normalized === 'epub') return normalized;
    return 'docx';
  }

  function normalizeDocumentPageBreakPreference(value) {
    var normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'per-task' || normalized === 'pertask') return 'perTask';
    if (normalized === 'per-column' || normalized === 'percolumn') return 'perColumn';
    return 'continuous';
  }

  function normalizeSpeakerNoteMode(value) {
    var normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'keep' || normalized === 'remove') return normalized;
    return 'comment';
  }

  function normalizeKeepRemoveMode(value) {
    return String(value || '').trim().toLowerCase() === 'remove' ? 'remove' : 'keep';
  }

  function normalizeEmbedHandling(value) {
    var normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'fallback' || normalized === 'remove') return normalized;
    return 'url';
  }

  function normalizeMarpBrowser(value) {
    var normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'edge' || normalized === 'firefox' || normalized === 'auto') return normalized;
    return 'chrome';
  }

  function normalizeLinkHandlingMode(value) {
    var normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'pack-linked' || normalized === 'pack-all') return normalized;
    if (normalized === 'dont-modify' || normalized === 'no-modify') return 'no-modify';
    return 'rewrite-only';
  }

  function normalizeBooleanPreference(value, fallback) {
    if (value == null || value === '') return !!fallback;
    if (value === true || value === 'true' || value === '1' || value === 1) return true;
    if (value === false || value === 'false' || value === '0' || value === 0) return false;
    return !!fallback;
  }

  function normalizePackFileSizeLimit(value) {
    var parsed = parseInt(String(value == null ? '' : value).trim(), 10);
    if (!isFinite(parsed) || parsed < 1) return 100;
    if (parsed > 1000) return 1000;
    return parsed;
  }

  function defaultExcludeTagsInput() {
    return '#exclude';
  }

  function normalizeExcludeTagsInput(raw) {
    var value = String(raw || '').trim();
    return value || defaultExcludeTagsInput();
  }

  function applyExportPresetToOptions(baseOptions, preset) {
    var normalizedPreset = normalizeExportPreset(preset);
    var next = Object.assign({}, baseOptions || {});
    next.preset = normalizedPreset;

    if (normalizedPreset === 'marp-presentation') {
      next.format = 'presentation';
      next.tagVisibility = 'none';
      next.stripIncludes = false;
      next.autoExportOnSave = true;
      next.runMarp = true;
      next.marpFormat = 'html';
      next.marpBrowser = 'chrome';
      next.marpWatch = true;
      next.marpPptxEditable = false;
      next.marpHandout = false;
      next.runPandoc = false;
      next.linkHandlingMode = 'rewrite-only';
      next.packAssets = false;
      next.packOptions = null;
    } else if (normalizedPreset === 'marp-pdf') {
      next.format = 'presentation';
      next.tagVisibility = 'none';
      next.stripIncludes = false;
      next.autoExportOnSave = true;
      next.runMarp = true;
      next.marpFormat = 'pdf';
      next.marpBrowser = 'chrome';
      next.marpWatch = false;
      next.marpPptxEditable = false;
      next.marpHandout = false;
      next.speakerNoteMode = 'keep';
      next.runPandoc = false;
      next.linkHandlingMode = 'rewrite-only';
      next.packAssets = false;
      next.packOptions = null;
    } else if (normalizedPreset === 'share-content') {
      next.format = 'keep';
      next.tagVisibility = 'all';
      next.stripIncludes = false;
      next.autoExportOnSave = false;
      next.runMarp = false;
      next.marpWatch = false;
      next.runPandoc = false;
      next.linkHandlingMode = 'pack-all';
      next.packAssets = true;
      next.packOptions = {
        includeFiles: true,
        includeImages: true,
        includeVideos: true,
        includeOtherMedia: true,
        includeDocuments: true,
        fileSizeLimitMB: 100,
      };
    }

    return next;
  }

  function createExportUiPreferenceHelpers(storage) {
    function getStoredExportUiPreference(key, fallback) {
      var storageKey = EXPORT_UI_STORAGE_KEYS[key];
      if (!storageKey) return fallback;
      var raw = storage.getItem(storageKey);
      if ((raw == null || raw === '') && EXPORT_UI_LEGACY_STORAGE_KEYS[key]) {
        raw = storage.getItem(EXPORT_UI_LEGACY_STORAGE_KEYS[key]);
      }
      return raw == null || raw === '' ? fallback : raw;
    }

    function setStoredExportUiPreference(key, value) {
      var storageKey = EXPORT_UI_STORAGE_KEYS[key];
      if (!storageKey) return;
      if (value == null || value === '') storage.removeItem(storageKey);
      else storage.setItem(storageKey, String(value));
    }

    return {
      EXPORT_UI_STORAGE_KEYS: EXPORT_UI_STORAGE_KEYS,
      EXPORT_UI_LEGACY_STORAGE_KEYS: EXPORT_UI_LEGACY_STORAGE_KEYS,
      normalizeExportDialogFormat: normalizeExportDialogFormat,
      normalizeExportPreset: normalizeExportPreset,
      normalizePandocExportFormat: normalizePandocExportFormat,
      normalizeDocumentPageBreakPreference: normalizeDocumentPageBreakPreference,
      normalizeSpeakerNoteMode: normalizeSpeakerNoteMode,
      normalizeKeepRemoveMode: normalizeKeepRemoveMode,
      normalizeEmbedHandling: normalizeEmbedHandling,
      normalizeMarpBrowser: normalizeMarpBrowser,
      normalizeLinkHandlingMode: normalizeLinkHandlingMode,
      normalizeBooleanPreference: normalizeBooleanPreference,
      normalizePackFileSizeLimit: normalizePackFileSizeLimit,
      defaultExcludeTagsInput: defaultExcludeTagsInput,
      normalizeExcludeTagsInput: normalizeExcludeTagsInput,
      applyExportPresetToOptions: applyExportPresetToOptions,
      getStoredExportUiPreference: getStoredExportUiPreference,
      setStoredExportUiPreference: setStoredExportUiPreference
    };
  }

  return {
    EXPORT_UI_STORAGE_KEYS: EXPORT_UI_STORAGE_KEYS,
    EXPORT_UI_LEGACY_STORAGE_KEYS: EXPORT_UI_LEGACY_STORAGE_KEYS,
    normalizeExportDialogFormat: normalizeExportDialogFormat,
    normalizeExportPreset: normalizeExportPreset,
    normalizePandocExportFormat: normalizePandocExportFormat,
    normalizeDocumentPageBreakPreference: normalizeDocumentPageBreakPreference,
    normalizeSpeakerNoteMode: normalizeSpeakerNoteMode,
    normalizeKeepRemoveMode: normalizeKeepRemoveMode,
    normalizeEmbedHandling: normalizeEmbedHandling,
    normalizeMarpBrowser: normalizeMarpBrowser,
    normalizeLinkHandlingMode: normalizeLinkHandlingMode,
    normalizeBooleanPreference: normalizeBooleanPreference,
    normalizePackFileSizeLimit: normalizePackFileSizeLimit,
    defaultExcludeTagsInput: defaultExcludeTagsInput,
    normalizeExcludeTagsInput: normalizeExcludeTagsInput,
    applyExportPresetToOptions: applyExportPresetToOptions,
    createExportUiPreferenceHelpers: createExportUiPreferenceHelpers
  };
})();
