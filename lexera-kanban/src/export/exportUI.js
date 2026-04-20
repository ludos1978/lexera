/**
 * Export Dialog UI for lexera-kanban.
 * Manages the export modal, collects options, and calls ExportService.export().
 *
 * Dependencies (loaded via script tags):
 *   window.ExportTreeBuilder — tree builder
 *   window.ExportTreeUI      — tree UI renderer
 *   window.ExportService      — export orchestrator
 *   window.LexeraApi          — REST API client
 */

// Log bridge — the kanban UI runs inside a workspace-shell iframe. The
// iframe has its own lexeraLog() + frontendLogEntries array, so messages
// logged here never reach the shell's Log panel (which is what the user
// actually watches). Route every call to the parent window's lexeraLog
// when one exists, and also the local one so standalone (non-iframe) runs
// keep working.
function exportLexeraLog(level, message) {
    try {
        if (typeof lexeraLog === 'function') lexeraLog(level, message);
    } catch (e) { /* local logger not ready yet */ }
    try {
        if (window.parent && window.parent !== window
            && typeof window.parent.lexeraLog === 'function') {
            window.parent.lexeraLog(level, message);
        }
    } catch (e) { /* cross-origin — ignore */ }
}

function createFallbackExportUiPreferenceHelpers(storage) {
    var storageKeys = {
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
        packTypeMode: 'lexera-export-pack-type-mode',
        packCustomExtensions: 'lexera-export-pack-custom-extensions',
        packFileSizeLimit: 'lexera-export-pack-file-size-limit',
    };
    var legacyStorageKeys = {
        marpTheme: 'kanban-marp-theme',
        marpBrowser: 'kanban-marp-browser',
        speakerNotes: 'kanban-speaker-note-mode',
        htmlComments: 'kanban-html-comment-mode',
        htmlContent: 'kanban-html-content-mode',
        embedHandling: 'kanban-embed-handling',
        excludeTags: 'kanban-export-exclude-tags',
        linkHandlingMode: 'kanban-link-handling-mode',
        packFileSizeLimit: 'kanban-file-size-limit',
    };

    function normalizeExportDialogFormat(value) {
        var normalized = String(value || '').trim().toLowerCase();
        if (normalized === 'keep' || normalized === 'kanban' || normalized === 'document') return normalized;
        return 'presentation';
    }

    function normalizeExportPreset(value) {
        var normalized = String(value || '').trim().toLowerCase();
        if (normalized === 'marp-presentation' || normalized === 'marp-pdf' || normalized === 'share-content') return normalized;
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
        if (normalized === 'pack-linked' || normalized === 'pack-all') return 'pack-linked';
        return 'rewrite-relative';
    }

    function normalizePackTypeMode(value) {
        return String(value || '').trim().toLowerCase() === 'custom' ? 'custom' : 'all';
    }

    function normalizePackCustomExtensions(value) {
        var raw = String(value == null ? '' : value);
        var parts = raw.split(/[,\s;]+/);
        var seen = Object.create(null);
        var out = [];
        for (var i = 0; i < parts.length; i++) {
            var t = parts[i].trim().toLowerCase();
            if (!t) continue;
            if (t.charAt(0) !== '.') t = '.' + t;
            if (seen[t]) continue;
            seen[t] = true;
            out.push(t);
        }
        return out;
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
            next.linkHandlingMode = 'rewrite-relative';
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
            next.linkHandlingMode = 'rewrite-relative';
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
            next.linkHandlingMode = 'pack-linked';
            next.packAssets = true;
            next.packOptions = {
                typeMode: 'all',
                extensions: [],
                fileSizeLimitMB: 100,
            };
        }

        return next;
    }

    function getStoredExportUiPreference(key, fallback) {
        var storageKey = storageKeys[key];
        if (!storageKey) return fallback;
        var raw = storage.getItem(storageKey);
        if ((raw == null || raw === '') && legacyStorageKeys[key]) {
            raw = storage.getItem(legacyStorageKeys[key]);
        }
        return raw == null || raw === '' ? fallback : raw;
    }

    function setStoredExportUiPreference(key, value) {
        var storageKey = storageKeys[key];
        if (!storageKey) return;
        if (value == null || value === '') storage.removeItem(storageKey);
        else storage.setItem(storageKey, String(value));
    }

    return {
        EXPORT_UI_STORAGE_KEYS: storageKeys,
        EXPORT_UI_LEGACY_STORAGE_KEYS: legacyStorageKeys,
        normalizeExportDialogFormat: normalizeExportDialogFormat,
        normalizeExportPreset: normalizeExportPreset,
        normalizePandocExportFormat: normalizePandocExportFormat,
        normalizeDocumentPageBreakPreference: normalizeDocumentPageBreakPreference,
        normalizeSpeakerNoteMode: normalizeSpeakerNoteMode,
        normalizeKeepRemoveMode: normalizeKeepRemoveMode,
        normalizeEmbedHandling: normalizeEmbedHandling,
        normalizeMarpBrowser: normalizeMarpBrowser,
        normalizeLinkHandlingMode: normalizeLinkHandlingMode,
        normalizePackTypeMode: normalizePackTypeMode,
        normalizePackCustomExtensions: normalizePackCustomExtensions,
        normalizeBooleanPreference: normalizeBooleanPreference,
        normalizePackFileSizeLimit: normalizePackFileSizeLimit,
        defaultExcludeTagsInput: defaultExcludeTagsInput,
        normalizeExcludeTagsInput: normalizeExcludeTagsInput,
        applyExportPresetToOptions: applyExportPresetToOptions,
        getStoredExportUiPreference: getStoredExportUiPreference,
        setStoredExportUiPreference: setStoredExportUiPreference
    };
}

var ExportUiPreferenceModule = window.LexeraExportUiPreferences || null;
var ExportUiPreferenceHelpers = ExportUiPreferenceModule && typeof ExportUiPreferenceModule.createExportUiPreferenceHelpers === 'function'
    ? ExportUiPreferenceModule.createExportUiPreferenceHelpers(localStorage)
    : createFallbackExportUiPreferenceHelpers(localStorage);

var EXPORT_UI_STORAGE_KEYS = ExportUiPreferenceHelpers ? ExportUiPreferenceHelpers.EXPORT_UI_STORAGE_KEYS : {};
var EXPORT_UI_LEGACY_STORAGE_KEYS = ExportUiPreferenceHelpers ? ExportUiPreferenceHelpers.EXPORT_UI_LEGACY_STORAGE_KEYS : {};

var ACTIVE_EXPORT_AUTO_SETTINGS = null;
var ACTIVE_EXPORT_AUTO_PROMISE = null;
var ACTIVE_EXPORT_AUTO_PENDING = false;

var normalizeExportDialogFormat = ExportUiPreferenceHelpers.normalizeExportDialogFormat;
var normalizeExportPreset = ExportUiPreferenceHelpers.normalizeExportPreset;
var normalizePandocExportFormat = ExportUiPreferenceHelpers.normalizePandocExportFormat;
var normalizeDocumentPageBreakPreference = ExportUiPreferenceHelpers.normalizeDocumentPageBreakPreference;
var normalizeSpeakerNoteMode = ExportUiPreferenceHelpers.normalizeSpeakerNoteMode;
var normalizeKeepRemoveMode = ExportUiPreferenceHelpers.normalizeKeepRemoveMode;
var normalizeEmbedHandling = ExportUiPreferenceHelpers.normalizeEmbedHandling;
var normalizeMarpBrowser = ExportUiPreferenceHelpers.normalizeMarpBrowser;
var normalizeLinkHandlingMode = ExportUiPreferenceHelpers.normalizeLinkHandlingMode;
var normalizePackTypeMode = ExportUiPreferenceHelpers.normalizePackTypeMode;
var normalizePackCustomExtensions = ExportUiPreferenceHelpers.normalizePackCustomExtensions;
var normalizeBooleanPreference = ExportUiPreferenceHelpers.normalizeBooleanPreference;
var normalizePackFileSizeLimit = ExportUiPreferenceHelpers.normalizePackFileSizeLimit;
var defaultExcludeTagsInput = ExportUiPreferenceHelpers.defaultExcludeTagsInput;
var normalizeExcludeTagsInput = ExportUiPreferenceHelpers.normalizeExcludeTagsInput;
var applyExportPresetToOptions = ExportUiPreferenceHelpers.applyExportPresetToOptions;

function cloneExportAutoOptions(options) {
    if (!options) return null;
    // Strip the per-execution AbortSignal before cloning — AbortSignal is not
    // structured-cloneable in WKWebView and would throw "The object can not be
    // cloned." when this runs after a successful save.
    var signal = options.signal;
    if (signal !== undefined) delete options.signal;
    try {
        return structuredClone(options);
    } finally {
        if (signal !== undefined) options.signal = signal;
    }
}

var getStoredExportUiPreference = ExportUiPreferenceHelpers.getStoredExportUiPreference;
var setStoredExportUiPreference = ExportUiPreferenceHelpers.setStoredExportUiPreference;

class ExportUI {
    constructor() {
        this.boardId = null;
        this.boardData = null;
        this.boardName = '';
        this.treeUI = null;
        this.tree = null;
        this.marpAvailable = false;
        this.marpVersion = null;
        this.pandocAvailable = false;
        this.pandocVersion = null;
        this.marpThemes = [];
        this.initialOptions = null;
        this.eventsBound = false;
        this.suppressPresetReset = false;
        this._userEditedTargetFolder = false;
        this._inFlight = false;
        this._abortController = null;
    }

    // ── Public API ──────────────────────────────────────────────────────

    /**
     * Initialize dialog with board data.
     * @param {string} boardId
     * @param {object} boardData - Board data with columns array from REST API.
     */
    async init(boardId, boardData, initialOptions) {
        this.boardId = boardId;
        this.boardData = boardData;
        this.boardName = this._deriveBoardName(boardData);
        this.initialOptions = initialOptions || null;
        // Per-dialog-open: allow the default target folder to re-apply even if
        // the user edited it in a previous session with this cached instance.
        this._userEditedTargetFolder = false;

        var derivedFilePath = this._deriveSourceFilePath(boardData);
        var derivedFolder = this._deriveBoardFolder(boardData);
        exportLexeraLog('info', '[kanban.export.init] boardId=' + boardId
            + ' filePath=' + (derivedFilePath || '(empty)')
            + ' boardFolder=' + (derivedFolder || '(empty)'));

        // Build tree from board data
        this.tree = ExportTreeBuilder.buildExportTree(boardData);

        // Initialize tree UI renderer
        this.treeUI = new ExportTreeUI('export-tree-container');
        this.treeUI.setSelectionChangeCallback(() => {
            this.updateExportFolderName();
        });
        this.treeUI.render(this.tree);

        // Wire up event listeners
        this._bindEvents();
        this._restoreStoredPreferences();

        // When the restored preset is a non-custom one (e.g.
        // marp-presentation), re-apply it so the preset's opinionated
        // values (runMarp=true, marpFormat=html, marpWatch=true,
        // autoExportOnSave=true, …) take effect even when initialOptions
        // didn't include a `preset` field. Without this, fields like
        // "Watch / Preview" aren't persisted individually and revert to
        // their HTML defaults on dialog re-open.
        var restoredPreset = normalizeExportPreset(this._val('export-preset'));
        if (restoredPreset !== 'custom') {
            this._applyPresetSelection(restoredPreset, { persist: false });
        }

        this._applyInitialOptions();
        this._applyInitialSelection();

        // Populate tool availability + themes from the Plugin Settings
        // cache. Sync read — no CLI spawns on dialog open.
        this.checkToolAvailability();

        // Set initial format state
        this.onFormatChange();
        this.onMarpFormatChange();
        this._updateLinkHandlingVisibility();

        // Generate initial export folder name
        this.updateExportFolderName();
    }

    show() {
        var modal = document.getElementById('export-modal');
        if (modal) {
            modal.hidden = false;
        }
    }

    hide() {
        var modal = document.getElementById('export-modal');
        if (modal) {
            modal.hidden = true;
        }
    }

    // ── Options Collection ──────────────────────────────────────────────

    /**
     * Collect all options from form elements into a single object for ExportService.
     * @returns {object}
     */
    collectOptions() {
        var format = this._val('export-format');
        var preset = normalizeExportPreset(this._val('export-preset'));
        var tagVisibility = this._val('export-tag-visibility');
        var excludeEnabled = this._checked('export-exclude-enabled');
        var excludeTagsRaw = excludeEnabled ? normalizeExcludeTagsInput(this._val('export-exclude-tags')) : '';
        var excludeTags = excludeEnabled ? this._parseExcludeTags(excludeTagsRaw) : [];
        var selection = this.treeUI
            ? this.treeUI.getSelection()
            : ExportTreeBuilder.getSelection(this.tree);
        var columnIndexes = selection ? selection.columnIndexes : [];
        var columnIds = selection ? selection.columnIds : [];
        exportLexeraLog('info', '[kanban.export.collect] selection: isFullBoard=' + !!(selection && selection.isFullBoard)
            + ' hasSelection=' + !!(selection && selection.hasSelection)
            + ' columnIds=' + JSON.stringify(columnIds)
            + ' columnIndexes=' + JSON.stringify(columnIndexes)
            + ' scopes=' + (selection && selection.scopes ? selection.scopes.map(function (s) { return s.scope + '(' + s.nodeId + ')'; }).join(',') : '(none)'));

        var options = {
            boardId: this.boardId,
            preset: preset,
            format: format,
            tagVisibility: tagVisibility,
            excludeEnabled: excludeEnabled,
            excludeTagsInput: excludeTagsRaw,
            excludeTags: excludeTags,
            stripIncludes: this._checked('export-strip-includes'),
            autoExportOnSave: this._checked('export-auto-export-on-save'),
            selectionScopes: selection ? selection.scopes : [],
            columnIndexes: columnIndexes,
            columnIds: columnIds,
            sourceFilePath: this._deriveSourceFilePath(this.boardData),
        };

        // Marp options (presentation format)
        if (format === 'presentation') {
            options.runMarp = this._checked('export-marp-enabled');
            options.marpFormat = this._val('export-marp-format');
            options.marpTheme = this._val('export-marp-theme') || null;
            options.marpBrowser = normalizeMarpBrowser(this._val('export-marp-browser'));
            // marpEnginePath + themeDirs are now sourced per-export by
            // ExportService from /config/render-apps (see Plugin Settings).
            // The dialog no longer exposes a custom-engine field.
            options.marpWatch = this._checked('export-marp-watch');
            options.marpPptxEditable = this._checked('export-marp-pptx-editable');
            options.marpHandout = this._checked('export-marp-handout');
            options.marpHandoutLayout = this._val('export-marp-handout-preset') || null;
            options.marpHandoutDirection = this._val('export-marp-handout-direction') || null;
            options.includeMarpDirectives = options.runMarp;

            // Content transforms
            options.speakerNoteMode = this._val('export-speaker-notes');
            options.htmlCommentMode = this._val('export-html-comments');
            options.htmlContentMode = this._val('export-html-content');
            options.embedHandling = normalizeEmbedHandling(this._val('export-embed-handling'));
        }

        // Pandoc options (document format)
        if (format === 'document') {
            options.runPandoc = this._checked('export-pandoc-enabled');
            options.pandocFormat = this._val('export-pandoc-format');
            options.documentPageBreaks = this._val('export-pandoc-page-breaks');
        }

        // Output
        options.exportFolderName = this._val('export-folder-name');
        options.targetFolder = this._val('export-target-folder');
        options.linkHandlingMode = normalizeLinkHandlingMode(this._val('export-link-handling-mode'));
        options.packAssets = options.linkHandlingMode === 'pack-linked';
        if (options.packAssets) {
            options.packOptions = {
                typeMode: normalizePackTypeMode(this._val('export-pack-type-mode')),
                extensions: normalizePackCustomExtensions(this._val('export-pack-custom-extensions')),
                fileSizeLimitMB: normalizePackFileSizeLimit(this._val('export-pack-file-size-limit'))
            };
        } else {
            options.packOptions = null;
        }

        return options;
    }

    // ── Export Execution ─────────────────────────────────────────────────

    /**
     * Execute the export with the given mode.
     * @param {'save'|'copy'} mode
     */
    async executeExport(mode) {
        var options = this.collectOptions();
        options.mode = mode;

        exportLexeraLog('info', '[kanban.export.execute] mode=' + mode
            + ' ids.count=' + (options.columnIds ? options.columnIds.length : 0)
            + ' idx.count=' + (options.columnIndexes ? options.columnIndexes.length : 0)
            + ' isFullBoard-ish=' + (!!options.selectionScopes && options.selectionScopes.length === 1 && options.selectionScopes[0].scope === 'board')
            + ' scopes=' + (options.selectionScopes ? options.selectionScopes.map(function (s) { return s.scope; }).join(',') : ''));

        // Validate selection
        if (!options.selectionScopes || options.selectionScopes.length === 0) {
            this._setStatus('No content selected. Use the selector to pick a board, row, stack, or column.', 'warn');
            return;
        }

        // Validate target folder for save
        if (mode !== 'copy' && !options.targetFolder) {
            this._setStatus('Please set a target folder.', 'warn');
            return;
        }

        // Install an AbortController so the Cancel button can interrupt long
        // fetches / pipelines mid-export.
        this._abortController = (typeof AbortController === 'function') ? new AbortController() : null;
        if (this._abortController) options.signal = this._abortController.signal;
        this._inFlight = true;

        var selSummary = (options.selectionScopes && options.selectionScopes.length > 0)
            ? options.selectionScopes.map(function (s) { return s.scope + (s.nodeId ? '=' + s.nodeId : ''); }).join(', ')
            : 'none';
        this._setStatus('Exporting ' + (options.columnIds ? options.columnIds.length : 0) + ' columns ('
            + selSummary + ') — click Cancel to abort', 'info');
        this._disableButtons(true);
        this._setCancelMode('abort');

        try {
            var result = await ExportService.export(options);

            if (result.aborted) {
                this._setStatus('Export cancelled.', 'warn');
                return;
            }
            if (result.success) {
                var statusMessage = result.message || 'Export completed';
                if (mode === 'copy' && result.content) {
                    await this._copyToClipboard(result.content);
                    statusMessage = 'Copied to clipboard (' + result.content.length + ' chars)';
                } else if (result.exportedPath) {
                    statusMessage = 'Exported: ' + result.exportedPath;
                }
                // Append the backend's kept-columns echo so the user can
                // visually verify the scope ("9 stack columns" vs the
                // whole board) without opening the file or the log panel.
                if (Array.isArray(options._lastKeptColumns)) {
                    var kept = options._lastKeptColumns;
                    statusMessage += '\nExported ' + kept.length + ' column(s): ' + kept.join(' · ');
                }
                if (mode === 'save') {
                    var autoExportStatus = this._updateAutoExportStateAfterExport(options, result);
                    if (autoExportStatus) statusMessage += ' ' + autoExportStatus;
                }
                this._setStatus(statusMessage, 'info');
                if (mode === 'save' && result.exportedPath) {
                    this._notifyExportDone(result.exportedPath);
                }
            } else {
                this._setStatus('Export failed: ' + (result.message || 'Unknown error') + ' — see Logs panel for details', 'error');
            }
        } catch (err) {
            if (err && err.name === 'AbortError') {
                this._setStatus('Export cancelled.', 'warn');
            } else {
                var msg = (err && err.message) ? err.message : String(err);
                exportLexeraLog('error', '[kanban.export.execute] ' + msg);
                this._setStatus('Export error: ' + msg + ' — see Logs panel for details', 'error');
            }
        } finally {
            this._inFlight = false;
            this._abortController = null;
            this._disableButtons(false);
            this._setCancelMode('close');
        }
    }

    // Cancel button has two states: "close" (no export in flight → closes the dialog)
    // and "abort" (export in flight → aborts the in-flight operation).
    _setCancelMode(mode) {
        var btn = document.getElementById('export-btn-cancel');
        if (!btn) return;
        if (mode === 'abort') {
            btn.textContent = 'Cancel';
            btn.dataset.mode = 'abort';
            btn.classList.add('export-action-cancel-active');
        } else {
            btn.textContent = 'Cancel';
            btn.dataset.mode = 'close';
            btn.classList.remove('export-action-cancel-active');
        }
    }

    // Toast-style notification after a successful save-mode export with an
    // action button that reveals the output file in Finder / Explorer.
    // Falls back to a plain status line when window.showNotification isn't
    // available (tests, embedded contexts).
    _notifyExportDone(exportedPath) {
        if (!exportedPath || typeof window.showNotification !== 'function') return;
        var self = this;
        var fileName = String(exportedPath).split(/[/\\]/).pop() || exportedPath;
        var isHtml = /\.html?$/i.test(exportedPath);
        var primaryLabel = isHtml ? 'Open in browser' : 'Reveal in Finder';
        window.showNotification('Exported: ' + fileName, {
            variant: 'success',
            duration: 8000,
            action: {
                label: primaryLabel,
                callback: function () {
                    // For HTML use open_with_default_app (launches browser); for
                    // everything else reveal the file in Finder/Explorer so the
                    // user can inspect the whole export folder.
                    var cmd = isHtml ? 'open_with_default_app' : 'show_in_folder';
                    self._invokeTauriCommand(cmd, { path: exportedPath }).catch(function (err) {
                        exportLexeraLog('warn', '[kanban.export.notify] ' + cmd + ' failed: ' + (err && err.message ? err.message : String(err)));
                    });
                },
            },
        });
    }

    // Shared Tauri invoke helper for the dialog's own side-actions (browse,
    // reveal-in-finder, open-in-browser). Mirrors the parent-window fallback
    // in exportService.js so iframe-embedded runs still reach the backend.
    async _invokeTauriCommand(command, args) {
        var ipc = this._resolveTauriIpc();
        if (!ipc) throw new Error('Tauri IPC unavailable');
        return args === undefined ? ipc.invoke(command) : ipc.invoke(command, args);
    }

    _handleCancelClick() {
        var btn = document.getElementById('export-btn-cancel');
        var mode = btn && btn.dataset.mode ? btn.dataset.mode : 'close';
        if (mode === 'abort' && this._inFlight) {
            exportLexeraLog('warn', '[kanban.export.cancel] user aborted export');
            this._setStatus('Cancelling… cleaning up partial output', 'warn');
            if (this._abortController) {
                try { this._abortController.abort(); } catch (e) {}
            }
            // Ask the backend to stop any running Marp watches spawned by this export.
            if (ExportService && typeof ExportService.stopAllWatches === 'function') {
                ExportService.stopAllWatches().catch(function () {});
            }
        } else {
            this.hide();
        }
    }

    // ── UI State Handlers ───────────────────────────────────────────────

    onFormatChange() {
        var format = this._val('export-format');

        // Show/hide Marp section
        var marpSection = document.getElementById('export-marp-section');
        if (marpSection) {
            marpSection.hidden = format !== 'presentation';
        }

        // Show/hide Pandoc section
        var pandocSection = document.getElementById('export-pandoc-section');
        if (pandocSection) {
            pandocSection.hidden = format !== 'document';
        }

        // Show/hide transforms section (presentation only)
        var transformSection = document.getElementById('export-transform-section');
        if (transformSection) {
            transformSection.hidden = format !== 'presentation';
        }

        this.updateExportFolderName();
    }

    onMarpFormatChange() {
        var marpFormat = this._val('export-marp-format');

        // Watch/Preview checkbox: only for html
        var watchEl = document.getElementById('export-marp-watch');
        if (watchEl && watchEl.parentElement) {
            watchEl.parentElement.hidden = marpFormat !== 'html';
        }

        // PPTX Editable checkbox: only for pptx
        var pptxEl = document.getElementById('export-marp-pptx-editable');
        if (pptxEl && pptxEl.parentElement) {
            pptxEl.parentElement.hidden = marpFormat !== 'pptx';
        }

        // Handout options: only for pdf
        var handoutEl = document.getElementById('export-marp-handout');
        if (handoutEl && handoutEl.parentElement) {
            handoutEl.parentElement.hidden = marpFormat !== 'pdf';
        }
        var handoutPreset = document.getElementById('export-marp-handout-preset');
        if (handoutPreset && handoutPreset.parentElement) {
            handoutPreset.parentElement.hidden = marpFormat !== 'pdf';
        }
        var handoutDir = document.getElementById('export-marp-handout-direction');
        if (handoutDir && handoutDir.parentElement) {
            handoutDir.parentElement.hidden = marpFormat !== 'pdf';
        }
    }

    _updateLinkHandlingVisibility() {
        var mode = normalizeLinkHandlingMode(this._val('export-link-handling-mode'));
        var typeMode = normalizePackTypeMode(this._val('export-pack-type-mode'));
        var optionsWrap = document.getElementById('export-link-handling-options');
        var customField = document.getElementById('export-pack-custom-extensions-field');
        if (optionsWrap) optionsWrap.hidden = mode !== 'pack-linked';
        if (customField) customField.hidden = !(mode === 'pack-linked' && typeMode === 'custom');
    }

    updateExportFolderName() {
        var input = document.getElementById('export-folder-name');
        if (!input) return;

        var format = this._val('export-format');
        var boardName = this.boardName || 'export';

        // Build range label from selected export scopes
        var range = 'full';
        var selection = this.treeUI
            ? this.treeUI.getSelection()
            : ExportTreeBuilder.getSelection(this.tree);
        if (selection) {
            if (!selection.hasSelection) {
                range = 'none';
            } else if (selection.isFullBoard) {
                range = 'full';
            } else {
                range = (selection.summary && selection.summary.key) || 'selection';
            }
        }

        var safeName = boardName.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 40);
        input.value = safeName + '-' + range;

        // Set default target folder to {board-folder}/_Export if user hasn't manually edited it
        if (!this._userEditedTargetFolder) {
            var targetInput = document.getElementById('export-target-folder');
            if (targetInput) {
                var boardFolder = this._deriveBoardFolder(this.boardData);
                if (boardFolder) {
                    var sep = boardFolder.indexOf('\\') >= 0 ? '\\' : '/';
                    targetInput.value = boardFolder + sep + '_Export';
                    exportLexeraLog('info', '[kanban.export.folder] default set: ' + targetInput.value);
                } else if (!targetInput.value) {
                    // Fallback: board file path was not provided. Leave a visible hint
                    // so the user knows they need to pick a folder, and log the gap.
                    exportLexeraLog('warn', '[kanban.export.folder] boardData has no filePath — default target folder not set. boardData keys=' +
                        Object.keys(this.boardData || {}).join(','));
                }
            }
        }
    }

    // ── Tool Availability ───────────────────────────────────────────────

    // Reads tool availability + themes from the Plugin Settings cache
    // (src/settings/renderAppsSettings.js). The cache is populated once at
    // app startup (see app.js:warmRenderAppsCache) and refreshed when the
    // user saves Plugin Settings, so this function never blocks on CLI
    // spawns or filesystem scans — the export dialog opens immediately.
    // If the cache is not yet populated (e.g. a fresh install where the
    // user hasn't opened Plugin Settings), the status lines show
    // "Not checked" and the user can click "Configure plugins…" to open
    // the settings panel and run the checks there.
    checkToolAvailability() {
        var self = this;
        var settings = (typeof window !== 'undefined') ? window.LexeraRenderAppsSettings : null;
        var status = (settings && settings.getCachedStatus && settings.getCachedStatus()) || {};
        var themes = (settings && settings.getCachedThemes && settings.getCachedThemes()) || null;

        function applyStatus() {
            var marpInfo = status.marp || null;
            var pandocInfo = status.pandoc || null;
            self.marpAvailable = !!(marpInfo && marpInfo.available);
            self.marpVersion = marpInfo ? marpInfo.version : null;
            self.pandocAvailable = !!(pandocInfo && pandocInfo.available);
            self.pandocVersion = pandocInfo ? pandocInfo.version : null;
            self.marpThemes = Array.isArray(themes) ? themes : [];
            self._renderToolStatusLine('export-marp-status', 'Marp CLI', marpInfo);
            self._renderToolStatusLine('export-pandoc-status', 'Pandoc', pandocInfo);
            self._populateMarpThemes();
            exportLexeraLog('info',
                '[kanban.export.tools] cache-read marpAvailable=' + self.marpAvailable
                + ' pandocAvailable=' + self.pandocAvailable
                + ' themes=' + self.marpThemes.length);
        }

        applyStatus();

        // If the cache was empty, kick off discovery in the background and
        // re-render once it finishes. The dialog is already usable — this
        // just upgrades the "Not checked" labels to real values without
        // blocking the open.
        if (settings && typeof settings.ensureDiscovery === 'function'
            && (!status.marp || !status.pandoc || !Array.isArray(themes))) {
            settings.ensureDiscovery().then(function () {
                status = settings.getCachedStatus() || {};
                themes = settings.getCachedThemes() || [];
                applyStatus();
            }).catch(function (err) {
                exportLexeraLog('warn', '[kanban.export.tools] background discovery failed: '
                    + (err && err.message ? err.message : String(err)));
            });
        }
    }

    _renderToolStatusLine(elId, label, info) {
        var el = document.getElementById(elId);
        if (!el) return;
        el.innerHTML = '';
        var text = document.createElement('span');
        if (!info) {
            text.textContent = label + ': not checked';
        } else if (info.available) {
            text.textContent = label + ' available' + (info.version ? ' (v' + info.version + ')' : '');
        } else {
            text.textContent = label + ' not found';
        }
        el.appendChild(text);
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'export-configure-plugins';
        btn.textContent = 'Configure plugins\u2026';
        btn.addEventListener('click', function () {
            if (typeof window !== 'undefined' && window.lexeraApp
                && typeof window.lexeraApp.openManagementPanel === 'function') {
                window.lexeraApp.openManagementPanel({ section: 'renderApps' });
            }
        });
        el.appendChild(btn);
    }

    // ── Private Helpers ─────────────────────────────────────────────────

    _bindEvents() {
        if (this.eventsBound) return;
        this.eventsBound = true;
        var self = this;

        // Close button
        var closeBtn = document.getElementById('export-btn-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', function () { self.hide(); });
        }

        // Click overlay to close
        var modal = document.getElementById('export-modal');
        if (modal) {
            modal.addEventListener('click', function (e) {
                if (e.target === modal) self.hide();
            });
        }

        // Format change
        var formatSelect = document.getElementById('export-format');
        if (formatSelect) {
            formatSelect.addEventListener('change', function () { self.onFormatChange(); });
        }

        var presetSelect = document.getElementById('export-preset');
        if (presetSelect && presetSelect.dataset.lexeraPresetBound !== 'true') {
            presetSelect.dataset.lexeraPresetBound = 'true';
            presetSelect.addEventListener('change', function () {
                self._applyPresetSelection(presetSelect.value);
            });
        }

        // Marp format change
        var marpFormatSelect = document.getElementById('export-marp-format');
        if (marpFormatSelect) {
            marpFormatSelect.addEventListener('change', function () { self.onMarpFormatChange(); });
        }

        var linkHandlingSelect = document.getElementById('export-link-handling-mode');
        if (linkHandlingSelect) {
            linkHandlingSelect.addEventListener('change', function () { self._updateLinkHandlingVisibility(); });
        }
        var packTypeModeSelect = document.getElementById('export-pack-type-mode');
        if (packTypeModeSelect) {
            packTypeModeSelect.addEventListener('change', function () { self._updateLinkHandlingVisibility(); });
        }

        this._bindStoredSelect('export-preset', 'preset', normalizeExportPreset);
        this._bindStoredSelect('export-marp-theme', 'marpTheme');
        this._bindStoredSelect('export-marp-browser', 'marpBrowser', normalizeMarpBrowser);
        this._bindStoredSelect('export-speaker-notes', 'speakerNotes', normalizeSpeakerNoteMode);
        this._bindStoredSelect('export-html-comments', 'htmlComments', normalizeKeepRemoveMode);
        this._bindStoredSelect('export-html-content', 'htmlContent', normalizeKeepRemoveMode);
        this._bindStoredSelect('export-embed-handling', 'embedHandling', normalizeEmbedHandling);
        this._bindStoredSelect('export-pandoc-format', 'pandocFormat', normalizePandocExportFormat);
        this._bindStoredSelect('export-pandoc-page-breaks', 'pandocPageBreaks', normalizeDocumentPageBreakPreference);
        this._bindStoredSelect('export-link-handling-mode', 'linkHandlingMode', normalizeLinkHandlingMode);
        this._bindStoredSelect('export-pack-type-mode', 'packTypeMode', normalizePackTypeMode);
        this._bindStoredInput('export-exclude-tags', 'excludeTags');
        this._bindStoredInput('export-pack-custom-extensions', 'packCustomExtensions');
        this._bindStoredInput('export-pack-file-size-limit', 'packFileSizeLimit', normalizePackFileSizeLimit);
        this._bindStoredCheckbox('export-exclude-enabled', 'excludeEnabled', true, function (checked) {
            self._setExcludeControlsEnabled(checked);
        });
        this._bindStoredCheckbox('export-strip-includes', 'stripIncludes', false);
        this._bindStoredCheckbox('export-auto-export-on-save', 'autoExportOnSave', false, function (checked) {
            if (!checked) ExportUI.clearActiveAutoExport(self.boardId);
        });
        this._bindPresetResetListeners([
            'export-format',
            'export-tag-visibility',
            'export-exclude-enabled',
            'export-exclude-tags',
            'export-auto-export-on-save',
            'export-strip-includes',
            'export-marp-enabled',
            'export-marp-format',
            'export-marp-theme',
            'export-marp-browser',
            'export-marp-watch',
            'export-marp-pptx-editable',
            'export-marp-handout',
            'export-marp-handout-preset',
            'export-marp-handout-direction',
            'export-speaker-notes',
            'export-html-comments',
            'export-html-content',
            'export-embed-handling',
            'export-pandoc-enabled',
            'export-pandoc-format',
            'export-pandoc-page-breaks',
            'export-link-handling-mode',
            'export-pack-type-mode',
            'export-pack-custom-extensions',
            'export-pack-file-size-limit',
        ]);

        // Select All button
        var selectAllBtn = document.querySelector('#export-tree-container + .export-tree-actions .export-btn-select-all,' +
            '.export-tree-actions .export-btn-select-all');
        if (!selectAllBtn) {
            // Fall back to searching within the modal
            selectAllBtn = document.querySelector('.export-btn-select-all');
        }
        if (selectAllBtn) {
            selectAllBtn.addEventListener('click', function () {
                if (self.treeUI) {
                    self.treeUI.selectAll();
                    self.updateExportFolderName();
                }
            });
        }

        // Clear button
        var clearBtn = document.querySelector('.export-btn-clear');
        if (clearBtn) {
            clearBtn.addEventListener('click', function () {
                if (self.treeUI) {
                    self.treeUI.clearSelection();
                    self.updateExportFolderName();
                }
            });
        }

        // Export action buttons
        var saveBtn = document.getElementById('export-btn-save');
        if (saveBtn) {
            saveBtn.addEventListener('click', function () { self.executeExport('save'); });
        }

        var copyBtn = document.getElementById('export-btn-copy');
        if (copyBtn) {
            copyBtn.addEventListener('click', function () { self.executeExport('copy'); });
        }

        var cancelBtn = document.getElementById('export-btn-cancel');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', function () { self._handleCancelClick(); });
        }

        // Track manual edits to target folder input
        var targetFolderInput = document.getElementById('export-target-folder');
        if (targetFolderInput) {
            targetFolderInput.addEventListener('input', function () {
                self._userEditedTargetFolder = true;
            });
        }

        // Browse button for target folder
        var browseBtn = document.getElementById('export-btn-browse');
        if (browseBtn) {
            browseBtn.addEventListener('click', async function () {
                await self._browseTargetFolder();
            });
        }

        // Escape key to close
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') {
                var m = document.getElementById('export-modal');
                if (m && m.style.display !== 'none') {
                    e.preventDefault();
                    self.hide();
                }
            }
        });
    }

    _populateMarpThemes() {
        var themeSelect = document.getElementById('export-marp-theme');
        if (!themeSelect) return;

        themeSelect.innerHTML = '';

        // Empty option for no theme override
        var emptyOpt = document.createElement('option');
        emptyOpt.value = '';
        emptyOpt.textContent = '(default)';
        themeSelect.appendChild(emptyOpt);

        for (var i = 0; i < this.marpThemes.length; i++) {
            var theme = this.marpThemes[i];
            var opt = document.createElement('option');
            opt.value = theme.builtin ? theme.name : theme.path;
            opt.textContent = theme.name + (theme.builtin ? ' (built-in)' : '');
            themeSelect.appendChild(opt);
        }

        var preferredTheme = this.initialOptions && typeof this.initialOptions.marpTheme === 'string'
            ? this.initialOptions.marpTheme
            : getStoredExportUiPreference('marpTheme', '');
        if (preferredTheme) {
            themeSelect.value = preferredTheme;
            if (themeSelect.value !== preferredTheme) themeSelect.value = '';
        }
    }

    _restoreStoredPreferences() {
        var activeAutoSettings = ExportUI.getActiveAutoExportSettings(this.boardId);
        var preset = activeAutoSettings && activeAutoSettings.preset
            ? normalizeExportPreset(activeAutoSettings.preset)
            : normalizeExportPreset(getStoredExportUiPreference('preset', 'custom'));
        var excludeEnabled = activeAutoSettings && typeof activeAutoSettings.excludeEnabled === 'boolean'
            ? !!activeAutoSettings.excludeEnabled
            : normalizeBooleanPreference(getStoredExportUiPreference('excludeEnabled', true), true);
        var excludeTagsValue = activeAutoSettings && typeof activeAutoSettings.excludeTagsInput === 'string'
            ? activeAutoSettings.excludeTagsInput
            : getStoredExportUiPreference('excludeTags', '');
        var stripIncludes = activeAutoSettings && typeof activeAutoSettings.stripIncludes === 'boolean'
            ? !!activeAutoSettings.stripIncludes
            : normalizeBooleanPreference(getStoredExportUiPreference('stripIncludes', false), false);
        var autoExportOnSave = activeAutoSettings && typeof activeAutoSettings.autoExportOnSave === 'boolean'
            ? !!activeAutoSettings.autoExportOnSave
            : normalizeBooleanPreference(getStoredExportUiPreference('autoExportOnSave', false), false);
        var marpBrowser = activeAutoSettings && activeAutoSettings.marpBrowser
            ? activeAutoSettings.marpBrowser
            : getStoredExportUiPreference('marpBrowser', 'chrome');
        var embedHandling = activeAutoSettings && activeAutoSettings.embedHandling
            ? activeAutoSettings.embedHandling
            : getStoredExportUiPreference('embedHandling', 'url');
        var linkHandlingMode = activeAutoSettings && activeAutoSettings.linkHandlingMode
            ? activeAutoSettings.linkHandlingMode
            : getStoredExportUiPreference('linkHandlingMode', 'rewrite-relative');
        var packOptions = activeAutoSettings && activeAutoSettings.packOptions ? activeAutoSettings.packOptions : null;

        this._setValue('export-preset', preset);
        this._setValue('export-speaker-notes', normalizeSpeakerNoteMode(getStoredExportUiPreference('speakerNotes', 'comment')));
        this._setValue('export-html-comments', normalizeKeepRemoveMode(getStoredExportUiPreference('htmlComments', 'keep')));
        this._setValue('export-html-content', normalizeKeepRemoveMode(getStoredExportUiPreference('htmlContent', 'keep')));
        this._setValue('export-embed-handling', normalizeEmbedHandling(embedHandling));
        this._setValue('export-marp-browser', normalizeMarpBrowser(marpBrowser));
        this._setValue('export-pandoc-format', normalizePandocExportFormat(getStoredExportUiPreference('pandocFormat', 'docx')));
        this._setValue('export-pandoc-page-breaks', normalizeDocumentPageBreakPreference(getStoredExportUiPreference('pandocPageBreaks', 'continuous')));
        this._setValue('export-link-handling-mode', normalizeLinkHandlingMode(linkHandlingMode));
        this._setChecked('export-exclude-enabled', excludeEnabled);
        this._setValue('export-exclude-tags', excludeEnabled ? normalizeExcludeTagsInput(excludeTagsValue) : (excludeTagsValue || ''));
        this._setChecked('export-strip-includes', stripIncludes);
        this._setChecked('export-auto-export-on-save', autoExportOnSave);
        this._setValue('export-pack-type-mode', normalizePackTypeMode(
            packOptions && packOptions.typeMode
                ? packOptions.typeMode
                : getStoredExportUiPreference('packTypeMode', 'all')
        ));
        this._setValue('export-pack-custom-extensions',
            packOptions && Array.isArray(packOptions.extensions) && packOptions.extensions.length
                ? packOptions.extensions.join(', ')
                : String(getStoredExportUiPreference('packCustomExtensions', '') || ''));
        this._setValue('export-pack-file-size-limit', String(normalizePackFileSizeLimit(
            packOptions && packOptions.fileSizeLimitMB != null
                ? packOptions.fileSizeLimitMB
                : getStoredExportUiPreference('packFileSizeLimit', 100)
        )));
        this._setExcludeControlsEnabled(excludeEnabled);
        this._updateLinkHandlingVisibility();
    }

    _applyInitialOptions() {
        if (!this.initialOptions) return;
        var initialPreset = this.initialOptions.preset ? normalizeExportPreset(this.initialOptions.preset) : null;
        if (initialPreset) {
            this._applyPresetSelection(initialPreset, { persist: false });
        }
        var shouldResetPreset = false;
        if (this.initialOptions.format) {
            this._setValue('export-format', normalizeExportDialogFormat(this.initialOptions.format));
            shouldResetPreset = true;
        }
        if (this.initialOptions.tagVisibility) {
            this._setValue('export-tag-visibility', this.initialOptions.tagVisibility);
            shouldResetPreset = true;
        }
        if (typeof this.initialOptions.excludeEnabled === 'boolean') {
            this._setChecked('export-exclude-enabled', this.initialOptions.excludeEnabled);
            this._setExcludeControlsEnabled(this.initialOptions.excludeEnabled);
            shouldResetPreset = true;
        }
        if (typeof this.initialOptions.excludeTagsInput === 'string') {
            this._setValue('export-exclude-tags', this.initialOptions.excludeTagsInput);
            shouldResetPreset = true;
        } else if (Array.isArray(this.initialOptions.excludeTags)) {
            this._setValue('export-exclude-tags', this.initialOptions.excludeTags.join(', '));
            shouldResetPreset = true;
        }
        if (typeof this.initialOptions.stripIncludes === 'boolean') {
            this._setChecked('export-strip-includes', this.initialOptions.stripIncludes);
            shouldResetPreset = true;
        }
        if (typeof this.initialOptions.autoExportOnSave === 'boolean') {
            this._setChecked('export-auto-export-on-save', this.initialOptions.autoExportOnSave);
            shouldResetPreset = true;
        }
        if (typeof this.initialOptions.runMarp === 'boolean') {
            this._setChecked('export-marp-enabled', this.initialOptions.runMarp);
            shouldResetPreset = true;
        }
        if (this.initialOptions.marpFormat) {
            this._setValue('export-marp-format', this.initialOptions.marpFormat);
            shouldResetPreset = true;
        }
        if (typeof this.initialOptions.marpWatch === 'boolean') {
            this._setChecked('export-marp-watch', this.initialOptions.marpWatch);
            shouldResetPreset = true;
        }
        if (typeof this.initialOptions.marpPptxEditable === 'boolean') {
            this._setChecked('export-marp-pptx-editable', this.initialOptions.marpPptxEditable);
            shouldResetPreset = true;
        }
        if (typeof this.initialOptions.marpHandout === 'boolean') {
            this._setChecked('export-marp-handout', this.initialOptions.marpHandout);
            shouldResetPreset = true;
        }
        if (this.initialOptions.marpHandoutLayout) {
            this._setValue('export-marp-handout-preset', this.initialOptions.marpHandoutLayout);
            shouldResetPreset = true;
        }
        if (this.initialOptions.marpHandoutDirection) {
            this._setValue('export-marp-handout-direction', this.initialOptions.marpHandoutDirection);
            shouldResetPreset = true;
        }
        if (typeof this.initialOptions.runPandoc === 'boolean') {
            this._setChecked('export-pandoc-enabled', this.initialOptions.runPandoc);
            shouldResetPreset = true;
        }
        if (this.initialOptions.pandocFormat) {
            this._setValue('export-pandoc-format', normalizePandocExportFormat(this.initialOptions.pandocFormat));
            shouldResetPreset = true;
        }
        if (this.initialOptions.documentPageBreaks) {
            this._setValue('export-pandoc-page-breaks', normalizeDocumentPageBreakPreference(this.initialOptions.documentPageBreaks));
            shouldResetPreset = true;
        }
        if (typeof this.initialOptions.marpTheme === 'string') {
            this._setValue('export-marp-theme', this.initialOptions.marpTheme);
            shouldResetPreset = true;
        }
        if (this.initialOptions.marpBrowser) {
            this._setValue('export-marp-browser', normalizeMarpBrowser(this.initialOptions.marpBrowser));
            shouldResetPreset = true;
        }
        if (this.initialOptions.speakerNoteMode) {
            this._setValue('export-speaker-notes', normalizeSpeakerNoteMode(this.initialOptions.speakerNoteMode));
            shouldResetPreset = true;
        }
        if (this.initialOptions.htmlCommentMode) {
            this._setValue('export-html-comments', normalizeKeepRemoveMode(this.initialOptions.htmlCommentMode));
            shouldResetPreset = true;
        }
        if (this.initialOptions.htmlContentMode) {
            this._setValue('export-html-content', normalizeKeepRemoveMode(this.initialOptions.htmlContentMode));
            shouldResetPreset = true;
        }
        if (this.initialOptions.embedHandling) {
            this._setValue('export-embed-handling', normalizeEmbedHandling(this.initialOptions.embedHandling));
            shouldResetPreset = true;
        }
        if (this.initialOptions.linkHandlingMode) {
            this._setValue('export-link-handling-mode', normalizeLinkHandlingMode(this.initialOptions.linkHandlingMode));
            shouldResetPreset = true;
        }
        if (this.initialOptions.packOptions) {
            if (this.initialOptions.packOptions.typeMode) this._setValue('export-pack-type-mode', normalizePackTypeMode(this.initialOptions.packOptions.typeMode));
            if (Array.isArray(this.initialOptions.packOptions.extensions)) {
                this._setValue('export-pack-custom-extensions', this.initialOptions.packOptions.extensions.join(', '));
            }
            if (this.initialOptions.packOptions.fileSizeLimitMB != null) this._setValue('export-pack-file-size-limit', String(normalizePackFileSizeLimit(this.initialOptions.packOptions.fileSizeLimitMB)));
            shouldResetPreset = true;
        }
        if (!initialPreset && shouldResetPreset) {
            this._resetPresetToCustom();
        }
        this._updateLinkHandlingVisibility();
    }

    _applyInitialSelection() {
        if (!this.treeUI || !this.tree) return;
        var selection = this.initialOptions && this.initialOptions.selection
            ? this.initialOptions.selection
            : { scope: 'board' };
        var resolved = ExportTreeBuilder.resolveNodeIdForSelection(this.tree, selection);
        var nodeId = resolved || 'root';
        exportLexeraLog('info', '[kanban.export.selection] requested=' + JSON.stringify(selection)
            + ' resolved=' + (resolved || '(none, defaulted to root)'));
        if (selection && selection.scope && selection.scope !== 'board' && !resolved) {
            exportLexeraLog('warn', '[kanban.export.selection] Could not resolve ' + selection.scope
                + ' to a tree node — menu passed indexes that do not match the export tree.'
                + ' selection=' + JSON.stringify(selection));
            this._setStatus('Could not pre-select ' + selection.scope
                + ' (' + JSON.stringify(selection) + '); defaulted to full board.', 'warn');
        } else if (selection && selection.scope && selection.scope !== 'board') {
            this._setStatus('Pre-selected ' + selection.scope + ': ' + nodeId, 'info');
        }
        this.treeUI.setOnlySelection(nodeId);
    }

    _bindStoredSelect(id, key, normalizeFn) {
        var el = document.getElementById(id);
        if (!el || el.dataset.lexeraStoredBound === 'true') return;
        el.dataset.lexeraStoredBound = 'true';
        el.addEventListener('change', function () {
            var nextValue = typeof normalizeFn === 'function' ? normalizeFn(el.value) : el.value;
            if (el.value !== nextValue) el.value = nextValue;
            setStoredExportUiPreference(key, nextValue);
        });
    }

    _bindStoredInput(id, key) {
        var el = document.getElementById(id);
        if (!el || el.dataset.lexeraStoredBound === 'true') return;
        el.dataset.lexeraStoredBound = 'true';
        var normalizeFn = arguments.length > 2 ? arguments[2] : null;
        var persist = function () {
            var nextValue = typeof normalizeFn === 'function' ? normalizeFn(el.value) : (el.value || '');
            if (typeof normalizeFn === 'function') el.value = String(nextValue);
            setStoredExportUiPreference(key, nextValue);
        };
        el.addEventListener('input', persist);
        el.addEventListener('change', persist);
    }

    _bindStoredCheckbox(id, key, fallback, onChange) {
        var el = document.getElementById(id);
        if (!el || el.dataset.lexeraStoredBound === 'true') return;
        el.dataset.lexeraStoredBound = 'true';
        el.addEventListener('change', function () {
            var checked = !!el.checked;
            setStoredExportUiPreference(key, checked ? 'true' : 'false');
            if (typeof onChange === 'function') onChange(checked, fallback);
        });
    }

    _bindPresetResetListeners(ids) {
        var self = this;
        for (var i = 0; i < ids.length; i++) {
            var el = document.getElementById(ids[i]);
            if (!el || el.dataset.lexeraPresetResetBound === 'true') continue;
            el.dataset.lexeraPresetResetBound = 'true';
            var handler = function () {
                self._resetPresetToCustom();
            };
            el.addEventListener('input', handler);
            el.addEventListener('change', handler);
        }
    }

    _applyPresetSelection(preset, options) {
        var normalizedPreset = normalizeExportPreset(preset);
        var shouldPersist = !options || options.persist !== false;
        this.suppressPresetReset = true;
        try {
            this._setValue('export-preset', normalizedPreset);
            if (normalizedPreset !== 'custom') {
                var nextOptions = applyExportPresetToOptions(this.collectOptions(), normalizedPreset);
                this._setValue('export-format', normalizeExportDialogFormat(nextOptions.format));
                this._setValue('export-tag-visibility', nextOptions.tagVisibility || 'all');
                this._setChecked('export-strip-includes', !!nextOptions.stripIncludes);
                this._setChecked('export-auto-export-on-save', !!nextOptions.autoExportOnSave);
                this._setChecked('export-marp-enabled', !!nextOptions.runMarp);
                if (nextOptions.marpFormat) this._setValue('export-marp-format', nextOptions.marpFormat);
                if (nextOptions.marpBrowser) this._setValue('export-marp-browser', normalizeMarpBrowser(nextOptions.marpBrowser));
                if (typeof nextOptions.marpWatch === 'boolean') this._setChecked('export-marp-watch', nextOptions.marpWatch);
                if (typeof nextOptions.marpPptxEditable === 'boolean') this._setChecked('export-marp-pptx-editable', nextOptions.marpPptxEditable);
                if (typeof nextOptions.marpHandout === 'boolean') this._setChecked('export-marp-handout', nextOptions.marpHandout);
                if (nextOptions.speakerNoteMode) this._setValue('export-speaker-notes', normalizeSpeakerNoteMode(nextOptions.speakerNoteMode));
                if (typeof nextOptions.runPandoc === 'boolean') this._setChecked('export-pandoc-enabled', nextOptions.runPandoc);
                if (nextOptions.linkHandlingMode) this._setValue('export-link-handling-mode', normalizeLinkHandlingMode(nextOptions.linkHandlingMode));
                if (nextOptions.packOptions) {
                    if (nextOptions.packOptions.typeMode) this._setValue('export-pack-type-mode', normalizePackTypeMode(nextOptions.packOptions.typeMode));
                    if (Array.isArray(nextOptions.packOptions.extensions)) {
                        this._setValue('export-pack-custom-extensions', nextOptions.packOptions.extensions.join(', '));
                    }
                    if (nextOptions.packOptions.fileSizeLimitMB != null) {
                        this._setValue('export-pack-file-size-limit', String(normalizePackFileSizeLimit(nextOptions.packOptions.fileSizeLimitMB)));
                    }
                }
            }
            this._setExcludeControlsEnabled(this._checked('export-exclude-enabled'));
            this.onFormatChange();
            this.onMarpFormatChange();
            this._updateLinkHandlingVisibility();
            this.updateExportFolderName();
            if (shouldPersist) this._persistCurrentPreferences();
        } finally {
            this.suppressPresetReset = false;
        }
    }

    _resetPresetToCustom() {
        if (this.suppressPresetReset) return;
        var presetSelect = document.getElementById('export-preset');
        if (!presetSelect || normalizeExportPreset(presetSelect.value) === 'custom') return;
        presetSelect.value = 'custom';
        setStoredExportUiPreference('preset', 'custom');
    }

    _persistCurrentPreferences() {
        setStoredExportUiPreference('preset', normalizeExportPreset(this._val('export-preset')));
        setStoredExportUiPreference('marpTheme', this._val('export-marp-theme') || '');
        setStoredExportUiPreference('marpBrowser', normalizeMarpBrowser(this._val('export-marp-browser')));
        setStoredExportUiPreference('speakerNotes', normalizeSpeakerNoteMode(this._val('export-speaker-notes')));
        setStoredExportUiPreference('htmlComments', normalizeKeepRemoveMode(this._val('export-html-comments')));
        setStoredExportUiPreference('htmlContent', normalizeKeepRemoveMode(this._val('export-html-content')));
        setStoredExportUiPreference('embedHandling', normalizeEmbedHandling(this._val('export-embed-handling')));
        setStoredExportUiPreference('pandocFormat', normalizePandocExportFormat(this._val('export-pandoc-format')));
        setStoredExportUiPreference('pandocPageBreaks', normalizeDocumentPageBreakPreference(this._val('export-pandoc-page-breaks')));
        setStoredExportUiPreference('excludeEnabled', this._checked('export-exclude-enabled') ? 'true' : 'false');
        setStoredExportUiPreference('excludeTags', this._val('export-exclude-tags') || '');
        setStoredExportUiPreference('stripIncludes', this._checked('export-strip-includes') ? 'true' : 'false');
        setStoredExportUiPreference('autoExportOnSave', this._checked('export-auto-export-on-save') ? 'true' : 'false');
        setStoredExportUiPreference('linkHandlingMode', normalizeLinkHandlingMode(this._val('export-link-handling-mode')));
        setStoredExportUiPreference('packTypeMode', normalizePackTypeMode(this._val('export-pack-type-mode')));
        setStoredExportUiPreference('packCustomExtensions', String(this._val('export-pack-custom-extensions') || ''));
        setStoredExportUiPreference('packFileSizeLimit', normalizePackFileSizeLimit(this._val('export-pack-file-size-limit')));
    }

    _setExcludeControlsEnabled(enabled) {
        var input = document.getElementById('export-exclude-tags');
        if (!input) return;
        input.disabled = !enabled;
        if (enabled && !String(input.value || '').trim()) {
            input.value = defaultExcludeTagsInput();
        }
    }

    _updateAutoExportStateAfterExport(options, result) {
        if (!result || !result.success || !options || options.mode !== 'save') return '';
        if (options.autoExportOnSave) {
            ExportUI.setActiveAutoExportSettings(options);
            return 'Auto-export on save is active.';
        }
        if (ExportUI.clearActiveAutoExport(options.boardId)) {
            return 'Auto-export on save stopped.';
        }
        return '';
    }

    /**
     * Parse comma-separated exclude tags, ensuring each starts with #.
     * @param {string} raw
     * @returns {string[]}
     */
    _parseExcludeTags(raw) {
        if (!raw || !raw.trim()) return [];
        return raw.split(',')
            .map(function (tag) { return tag.trim(); })
            .filter(function (tag) { return tag.length > 0; })
            .map(function (tag) {
                return tag.startsWith('#') ? tag : '#' + tag;
            });
    }

    /**
     * Derive a human-readable board name from board data.
     * @param {object} boardData
     * @returns {string}
     */
    _deriveBoardName(boardData) {
        if (!boardData) return 'export';
        if (boardData.name) return boardData.name;
        var filePath = this._deriveSourceFilePath(boardData);
        if (filePath) {
            var parts = filePath.replace(/\\/g, '/').split('/');
            var filename = parts[parts.length - 1] || 'export';
            return filename.replace(/\.md$/i, '');
        }
        return 'export';
    }

    _deriveSourceFilePath(boardData) {
        if (!boardData) return '';
        return String(boardData.filePath || boardData.file || '').trim();
    }

    _deriveBoardFolder(boardData) {
        var filePath = this._deriveSourceFilePath(boardData);
        if (!filePath) return '';
        var normalized = filePath.replace(/\\/g, '/');
        var lastSlash = normalized.lastIndexOf('/');
        if (lastSlash < 0) return '';
        // Return using original separators
        return filePath.substring(0, lastSlash);
    }

    /**
     * Browse for a target folder using the browse_folder Tauri command.
     */
    // Resolve the Tauri IPC bridge. The kanban UI runs in a workspace-shell
    // iframe; Tauri 2 does not inject __TAURI_INTERNALS__ into sub-frames, so
    // we fall back to window.parent.
    _resolveTauriIpc() {
        if (window.__TAURI_INTERNALS__ && typeof window.__TAURI_INTERNALS__.invoke === 'function') {
            return window.__TAURI_INTERNALS__;
        }
        if (window.__TAURI__ && window.__TAURI__.core && typeof window.__TAURI__.core.invoke === 'function') {
            return window.__TAURI__.core;
        }
        try {
            if (window.parent && window.parent !== window) {
                if (window.parent.__TAURI_INTERNALS__ && typeof window.parent.__TAURI_INTERNALS__.invoke === 'function') {
                    return window.parent.__TAURI_INTERNALS__;
                }
                if (window.parent.__TAURI__ && window.parent.__TAURI__.core && typeof window.parent.__TAURI__.core.invoke === 'function') {
                    return window.parent.__TAURI__.core;
                }
            }
        } catch (e) { /* cross-origin — ignore */ }
        return null;
    }

    async _browseTargetFolder() {
        exportLexeraLog('info', '[kanban.export.browse] click handler entered');
        this._setStatus('Opening folder picker…');

        var ipc = this._resolveTauriIpc();
        if (!ipc) {
            var state;
            try {
                state = {
                    hasInternals: !!(window.__TAURI_INTERNALS__ && typeof window.__TAURI_INTERNALS__.invoke === 'function'),
                    hasGlobalCore: !!(window.__TAURI__ && window.__TAURI__.core && typeof window.__TAURI__.core.invoke === 'function'),
                    hasParentInternals: !!(window.parent && window.parent !== window && window.parent.__TAURI_INTERNALS__),
                    hasParentGlobalCore: !!(window.parent && window.parent !== window && window.parent.__TAURI__ && window.parent.__TAURI__.core),
                };
            } catch (e) {
                state = { crossOrigin: true };
            }
            exportLexeraLog('error', '[kanban.export.browse] Tauri IPC unavailable: ' + JSON.stringify(state));
            this._setStatus('Browse unavailable — Tauri IPC not reachable ' + JSON.stringify(state));
            return;
        }

        var currentValue = this._val('export-target-folder') || '';
        var fallbackPath = currentValue || this._deriveBoardFolder(this.boardData) || null;
        try {
            exportLexeraLog('info', '[kanban.export.browse] invoking browse_folder defaultPath=' + (fallbackPath || '(none)'));
            var selected = await ipc.invoke('browse_folder', {
                title: 'Select export target folder',
                defaultPath: fallbackPath,
            });
            exportLexeraLog('info', '[kanban.export.browse] result=' + (selected || '(cancelled)'));
            if (selected) {
                var input = document.getElementById('export-target-folder');
                if (input) {
                    input.value = selected;
                    this._userEditedTargetFolder = true;
                }
                this._setStatus('Target folder set: ' + selected);
            } else {
                this._setStatus('Browse cancelled');
            }
        } catch (err) {
            var msg = (err && err.message) ? err.message : String(err);
            exportLexeraLog('error', '[kanban.export.browse] invoke threw: ' + msg);
            this._setStatus('Browse failed: ' + msg);
        }
    }

    /**
     * Copy text to clipboard.
     * @param {string} text
     */
    async _copyToClipboard(text) {
        try {
            if (window.__TAURI__ && window.__TAURI__.clipboard && window.__TAURI__.clipboard.writeText) {
                await window.__TAURI__.clipboard.writeText(text);
            } else if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(text);
            } else {
                // Fallback: create temporary textarea
                var ta = document.createElement('textarea');
                ta.value = text;
                ta.style.position = 'fixed';
                ta.style.opacity = '0';
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
            }
        } catch (err) {
            exportLexeraLog('warn', '[kanban.export.clipboard] Write failed: ' + (err.message || String(err)));
        }
    }

    /**
     * Display a status message in the modal, colour it by level, and mirror
     * warnings/errors to the Logs panel so long messages aren't truncated by
     * the narrow status strip.
     * @param {string} msg
     * @param {'info'|'warn'|'error'} [level]
     */
    _setStatus(msg, level) {
        var el = document.getElementById('export-status');
        if (el) {
            el.textContent = msg;
            el.classList.remove('status-warn', 'status-error');
            if (level === 'warn') el.classList.add('status-warn');
            else if (level === 'error') el.classList.add('status-error');
        }
        var logLevel = (level === 'warn' || level === 'error') ? level : 'info';
        if (typeof lexeraLog === 'function') {
            exportLexeraLog(logLevel, '[kanban.export.status] ' + msg);
        }
    }

    /**
     * Enable or disable the action buttons during export.
     * @param {boolean} disabled
     */
    _disableButtons(disabled) {
        var ids = ['export-btn-save', 'export-btn-copy'];
        for (var i = 0; i < ids.length; i++) {
            var btn = document.getElementById(ids[i]);
            if (btn) btn.disabled = disabled;
        }
    }

    /**
     * Get value of an input/select element by ID.
     * @param {string} id
     * @returns {string}
     */
    _val(id) {
        var el = document.getElementById(id);
        return el ? el.value : '';
    }

    _setValue(id, value) {
        var el = document.getElementById(id);
        if (el && value != null) el.value = value;
    }

    /**
     * Get checked state of a checkbox by ID.
     * @param {string} id
     * @returns {boolean}
     */
    _checked(id) {
        var el = document.getElementById(id);
        return el ? el.checked : false;
    }

    _setChecked(id, checked) {
        var el = document.getElementById(id);
        if (el) el.checked = !!checked;
    }

    static setActiveAutoExportSettings(options) {
        if (!options || !options.boardId) return;
        var cloned = cloneExportAutoOptions(options);
        cloned.mode = 'save';
        cloned.autoExportOnSave = true;
        ACTIVE_EXPORT_AUTO_SETTINGS = cloned;
        ACTIVE_EXPORT_AUTO_PENDING = false;
    }

    static getActiveAutoExportSettings(boardId) {
        if (!ACTIVE_EXPORT_AUTO_SETTINGS) return null;
        if (boardId && ACTIVE_EXPORT_AUTO_SETTINGS.boardId !== boardId) return null;
        return cloneExportAutoOptions(ACTIVE_EXPORT_AUTO_SETTINGS);
    }

    static clearActiveAutoExport(boardId) {
        if (!ACTIVE_EXPORT_AUTO_SETTINGS) return false;
        if (boardId && ACTIVE_EXPORT_AUTO_SETTINGS.boardId !== boardId) return false;
        ACTIVE_EXPORT_AUTO_SETTINGS = null;
        ACTIVE_EXPORT_AUTO_PENDING = false;
        return true;
    }

    static async handleBoardSaved(boardId) {
        if (!ACTIVE_EXPORT_AUTO_SETTINGS || !boardId || ACTIVE_EXPORT_AUTO_SETTINGS.boardId !== boardId) {
            return null;
        }
        if (ACTIVE_EXPORT_AUTO_PROMISE) {
            ACTIVE_EXPORT_AUTO_PENDING = true;
            return ACTIVE_EXPORT_AUTO_PROMISE;
        }
        var exportOptions = cloneExportAutoOptions(ACTIVE_EXPORT_AUTO_SETTINGS);
        exportOptions.boardId = boardId;
        exportOptions.mode = 'save';
        ACTIVE_EXPORT_AUTO_PENDING = false;
        ACTIVE_EXPORT_AUTO_PROMISE = ExportService.export(exportOptions).then(function (result) {
            if (!result || !result.success) {
                throw new Error(result && result.message ? result.message : 'Auto-export failed');
            }
            return result;
        }).catch(function (err) {
            exportLexeraLog('error', '[kanban.export.auto] ' + (err.message || String(err)));
            if (typeof window.showNotification === 'function') {
                window.showNotification('Auto-export failed: ' + (err.message || String(err)));
            }
            return null;
        }).finally(async function () {
            ACTIVE_EXPORT_AUTO_PROMISE = null;
            if (ACTIVE_EXPORT_AUTO_PENDING && ACTIVE_EXPORT_AUTO_SETTINGS && ACTIVE_EXPORT_AUTO_SETTINGS.boardId === boardId) {
                ACTIVE_EXPORT_AUTO_PENDING = false;
                await ExportUI.handleBoardSaved(boardId);
            }
        });
        return ACTIVE_EXPORT_AUTO_PROMISE;
    }
}

window.ExportUI = ExportUI;
