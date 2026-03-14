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

var EXPORT_UI_STORAGE_KEYS = {
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
var EXPORT_UI_LEGACY_STORAGE_KEYS = {
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

var ACTIVE_EXPORT_AUTO_SETTINGS = null;
var ACTIVE_EXPORT_AUTO_PROMISE = null;
var ACTIVE_EXPORT_AUTO_PENDING = false;

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
    if (normalized === 'dont-modify') return 'no-modify';
    if (normalized === 'no-modify') return 'no-modify';
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

function cloneExportAutoOptions(options) {
    return options ? JSON.parse(JSON.stringify(options)) : null;
}

function getStoredExportUiPreference(key, fallback) {
    var storageKey = EXPORT_UI_STORAGE_KEYS[key];
    if (!storageKey) return fallback;
    var raw = localStorage.getItem(storageKey);
    if ((raw == null || raw === '') && EXPORT_UI_LEGACY_STORAGE_KEYS[key]) {
        raw = localStorage.getItem(EXPORT_UI_LEGACY_STORAGE_KEYS[key]);
    }
    return raw == null || raw === '' ? fallback : raw;
}

function setStoredExportUiPreference(key, value) {
    var storageKey = EXPORT_UI_STORAGE_KEYS[key];
    if (!storageKey) return;
    if (value == null || value === '') localStorage.removeItem(storageKey);
    else localStorage.setItem(storageKey, String(value));
}

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

        lexeraLog('info', '[kanban.export.init] boardId=' + boardId);

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

        this._applyInitialOptions();
        this._applyInitialSelection();

        // Check tool availability and populate themes
        await this.checkToolAvailability();

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
            modal.style.display = 'flex';
        }
    }

    hide() {
        var modal = document.getElementById('export-modal');
        if (modal) {
            modal.style.display = 'none';
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
        options.packAssets = options.linkHandlingMode === 'pack-linked' || options.linkHandlingMode === 'pack-all';
        if (options.packAssets) {
            options.packOptions = {
                fileSizeLimitMB: normalizePackFileSizeLimit(this._val('export-pack-file-size-limit'))
            };
            if (options.linkHandlingMode === 'pack-all') {
                options.packOptions.includeFiles = this._checked('export-pack-files');
                options.packOptions.includeImages = this._checked('export-pack-images');
                options.packOptions.includeVideos = this._checked('export-pack-videos');
                options.packOptions.includeOtherMedia = this._checked('export-pack-other-media');
                options.packOptions.includeDocuments = this._checked('export-pack-documents');
            }
        } else {
            options.packOptions = null;
        }

        return options;
    }

    // ── Export Execution ─────────────────────────────────────────────────

    /**
     * Execute the export with the given mode.
     * @param {'save'|'copy'|'preview'} mode
     */
    async executeExport(mode) {
        var options = this.collectOptions();
        options.mode = mode;

        lexeraLog('info', '[kanban.export.execute] mode=' + mode);

        // Validate selection
        if (!options.selectionScopes || options.selectionScopes.length === 0) {
            this._setStatus('No content selected. Use the selector to pick a board, row, stack, or column.');
            return;
        }

        // Validate target folder for save/preview
        if (mode !== 'copy' && !options.targetFolder) {
            this._setStatus('Please set a target folder.');
            return;
        }

        this._setStatus('Exporting...');
        this._disableButtons(true);

        try {
            var result = await ExportService.export(options);

            if (result.success) {
                var statusMessage = result.message || 'Export completed';
                if (mode === 'copy' && result.content) {
                    await this._copyToClipboard(result.content);
                    statusMessage = 'Copied to clipboard (' + result.content.length + ' chars)';
                } else if (result.exportedPath) {
                    statusMessage = 'Exported: ' + result.exportedPath;
                }
                if (mode === 'save') {
                    var autoExportStatus = this._updateAutoExportStateAfterExport(options, result);
                    if (autoExportStatus) statusMessage += ' ' + autoExportStatus;
                }
                this._setStatus(statusMessage);
            } else {
                this._setStatus('Export failed: ' + (result.message || 'Unknown error'));
            }
        } catch (err) {
            lexeraLog('error', '[kanban.export.execute] ' + (err.message || String(err)));
            this._setStatus('Export error: ' + (err.message || String(err)));
        } finally {
            this._disableButtons(false);
        }
    }

    // ── UI State Handlers ───────────────────────────────────────────────

    onFormatChange() {
        var format = this._val('export-format');

        // Show/hide Marp section
        var marpSection = document.getElementById('export-marp-section');
        if (marpSection) {
            marpSection.style.display = (format === 'presentation') ? '' : 'none';
        }

        // Show/hide Pandoc section
        var pandocSection = document.getElementById('export-pandoc-section');
        if (pandocSection) {
            pandocSection.style.display = (format === 'document') ? '' : 'none';
        }

        // Show/hide transforms section (presentation only)
        var transformSection = document.getElementById('export-transform-section');
        if (transformSection) {
            transformSection.style.display = (format === 'presentation') ? '' : 'none';
        }

        // Update preview button visibility (only for presentation format)
        var previewBtn = document.getElementById('export-btn-preview');
        if (previewBtn) {
            previewBtn.style.display = (format === 'presentation' && this.marpAvailable) ? '' : 'none';
        }

        this.updateExportFolderName();
    }

    onMarpFormatChange() {
        var marpFormat = this._val('export-marp-format');

        // Watch/Preview checkbox: only for html
        var watchEl = document.getElementById('export-marp-watch');
        if (watchEl && watchEl.parentElement) {
            watchEl.parentElement.style.display = (marpFormat === 'html') ? '' : 'none';
        }

        // PPTX Editable checkbox: only for pptx
        var pptxEl = document.getElementById('export-marp-pptx-editable');
        if (pptxEl && pptxEl.parentElement) {
            pptxEl.parentElement.style.display = (marpFormat === 'pptx') ? '' : 'none';
        }

        // Handout options: only for pdf
        var handoutEl = document.getElementById('export-marp-handout');
        if (handoutEl && handoutEl.parentElement) {
            handoutEl.parentElement.style.display = (marpFormat === 'pdf') ? '' : 'none';
        }
        var handoutPreset = document.getElementById('export-marp-handout-preset');
        if (handoutPreset && handoutPreset.parentElement) {
            handoutPreset.parentElement.style.display = (marpFormat === 'pdf') ? '' : 'none';
        }
        var handoutDir = document.getElementById('export-marp-handout-direction');
        if (handoutDir && handoutDir.parentElement) {
            handoutDir.parentElement.style.display = (marpFormat === 'pdf') ? '' : 'none';
        }
    }

    _updateLinkHandlingVisibility() {
        var mode = normalizeLinkHandlingMode(this._val('export-link-handling-mode'));
        var optionsWrap = document.getElementById('export-link-handling-options');
        var packTypes = document.getElementById('export-link-pack-types');
        var fileSize = document.getElementById('export-link-pack-size');
        if (optionsWrap) {
            optionsWrap.style.display = (mode === 'pack-linked' || mode === 'pack-all') ? '' : 'none';
        }
        if (packTypes) {
            packTypes.style.display = mode === 'pack-all' ? '' : 'none';
        }
        if (fileSize) {
            fileSize.style.display = (mode === 'pack-linked' || mode === 'pack-all') ? '' : 'none';
        }
    }

    updateExportFolderName() {
        var input = document.getElementById('export-folder-name');
        if (!input) return;

        var format = this._val('export-format');
        var boardName = this.boardName || 'export';

        // Build timestamp: YYYYMMDD-HHMM
        var now = new Date();
        var ts = now.getFullYear().toString()
            + String(now.getMonth() + 1).padStart(2, '0')
            + String(now.getDate()).padStart(2, '0')
            + '-'
            + String(now.getHours()).padStart(2, '0')
            + String(now.getMinutes()).padStart(2, '0');

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
        input.value = safeName + '-' + ts + '-' + range;
    }

    // ── Tool Availability ───────────────────────────────────────────────

    async checkToolAvailability() {
        // Check Marp
        try {
            var marpStatus = await ExportService.checkMarpStatus();
            this.marpAvailable = marpStatus.available;
            this.marpVersion = marpStatus.version;
            var marpStatusEl = document.getElementById('export-marp-status');
            if (marpStatusEl) {
                marpStatusEl.textContent = marpStatus.available
                    ? 'Marp CLI available' + (marpStatus.version ? ' (v' + marpStatus.version + ')' : '')
                    : 'Marp CLI not found';
            }
            lexeraLog('info', '[kanban.export.tools] Marp available=' + this.marpAvailable);
        } catch (err) {
            lexeraLog('warn', '[kanban.export.tools] Marp check failed: ' + (err.message || String(err)));
            this.marpAvailable = false;
        }

        // Check Pandoc
        try {
            var pandocStatus = await ExportService.checkPandocStatus();
            this.pandocAvailable = pandocStatus.available;
            this.pandocVersion = pandocStatus.version;
            var pandocStatusEl = document.getElementById('export-pandoc-status');
            if (pandocStatusEl) {
                pandocStatusEl.textContent = pandocStatus.available
                    ? 'Pandoc available' + (pandocStatus.version ? ' (v' + pandocStatus.version + ')' : '')
                    : 'Pandoc not found';
            }
            lexeraLog('info', '[kanban.export.tools] Pandoc available=' + this.pandocAvailable);
        } catch (err) {
            lexeraLog('warn', '[kanban.export.tools] Pandoc check failed: ' + (err.message || String(err)));
            this.pandocAvailable = false;
        }

        // Discover Marp themes
        if (this.marpAvailable) {
            try {
                this.marpThemes = await ExportService.getMarpThemes([]);
                this._populateMarpThemes();
            } catch (err) {
                lexeraLog('warn', '[kanban.export.tools] Theme discovery failed: ' + (err.message || String(err)));
                this.marpThemes = [];
            }
        }
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
        this._bindStoredInput('export-exclude-tags', 'excludeTags');
        this._bindStoredInput('export-pack-file-size-limit', 'packFileSizeLimit', normalizePackFileSizeLimit);
        this._bindStoredCheckbox('export-exclude-enabled', 'excludeEnabled', true, function (checked) {
            self._setExcludeControlsEnabled(checked);
        });
        this._bindStoredCheckbox('export-strip-includes', 'stripIncludes', false);
        this._bindStoredCheckbox('export-auto-export-on-save', 'autoExportOnSave', false, function (checked) {
            if (!checked) ExportUI.clearActiveAutoExport(self.boardId);
        });
        this._bindStoredCheckbox('export-pack-files', 'packFiles', true);
        this._bindStoredCheckbox('export-pack-images', 'packImages', true);
        this._bindStoredCheckbox('export-pack-videos', 'packVideos', true);
        this._bindStoredCheckbox('export-pack-other-media', 'packOtherMedia', true);
        this._bindStoredCheckbox('export-pack-documents', 'packDocuments', true);
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
            'export-pack-files',
            'export-pack-images',
            'export-pack-videos',
            'export-pack-other-media',
            'export-pack-documents',
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

        var previewBtn = document.getElementById('export-btn-preview');
        if (previewBtn) {
            previewBtn.addEventListener('click', function () { self.executeExport('preview'); });
        }

        // Browse button for target folder (uses Tauri dialog if available)
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
            : getStoredExportUiPreference('linkHandlingMode', 'rewrite-only');
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
        this._setChecked('export-pack-files', packOptions && typeof packOptions.includeFiles === 'boolean'
            ? packOptions.includeFiles
            : normalizeBooleanPreference(getStoredExportUiPreference('packFiles', true), true));
        this._setChecked('export-pack-images', packOptions && typeof packOptions.includeImages === 'boolean'
            ? packOptions.includeImages
            : normalizeBooleanPreference(getStoredExportUiPreference('packImages', true), true));
        this._setChecked('export-pack-videos', packOptions && typeof packOptions.includeVideos === 'boolean'
            ? packOptions.includeVideos
            : normalizeBooleanPreference(getStoredExportUiPreference('packVideos', true), true));
        this._setChecked('export-pack-other-media', packOptions && typeof packOptions.includeOtherMedia === 'boolean'
            ? packOptions.includeOtherMedia
            : normalizeBooleanPreference(getStoredExportUiPreference('packOtherMedia', true), true));
        this._setChecked('export-pack-documents', packOptions && typeof packOptions.includeDocuments === 'boolean'
            ? packOptions.includeDocuments
            : normalizeBooleanPreference(getStoredExportUiPreference('packDocuments', true), true));
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
            if (typeof this.initialOptions.packOptions.includeFiles === 'boolean') this._setChecked('export-pack-files', this.initialOptions.packOptions.includeFiles);
            if (typeof this.initialOptions.packOptions.includeImages === 'boolean') this._setChecked('export-pack-images', this.initialOptions.packOptions.includeImages);
            if (typeof this.initialOptions.packOptions.includeVideos === 'boolean') this._setChecked('export-pack-videos', this.initialOptions.packOptions.includeVideos);
            if (typeof this.initialOptions.packOptions.includeOtherMedia === 'boolean') this._setChecked('export-pack-other-media', this.initialOptions.packOptions.includeOtherMedia);
            if (typeof this.initialOptions.packOptions.includeDocuments === 'boolean') this._setChecked('export-pack-documents', this.initialOptions.packOptions.includeDocuments);
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
        var nodeId = ExportTreeBuilder.resolveNodeIdForSelection(this.tree, selection) || 'root';
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
                    this._setChecked('export-pack-files', !!nextOptions.packOptions.includeFiles);
                    this._setChecked('export-pack-images', !!nextOptions.packOptions.includeImages);
                    this._setChecked('export-pack-videos', !!nextOptions.packOptions.includeVideos);
                    this._setChecked('export-pack-other-media', !!nextOptions.packOptions.includeOtherMedia);
                    this._setChecked('export-pack-documents', !!nextOptions.packOptions.includeDocuments);
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
        setStoredExportUiPreference('packFiles', this._checked('export-pack-files') ? 'true' : 'false');
        setStoredExportUiPreference('packImages', this._checked('export-pack-images') ? 'true' : 'false');
        setStoredExportUiPreference('packVideos', this._checked('export-pack-videos') ? 'true' : 'false');
        setStoredExportUiPreference('packOtherMedia', this._checked('export-pack-other-media') ? 'true' : 'false');
        setStoredExportUiPreference('packDocuments', this._checked('export-pack-documents') ? 'true' : 'false');
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

    /**
     * Browse for a target folder using Tauri dialog if available.
     */
    async _browseTargetFolder() {
        try {
            if (window.__TAURI__ && window.__TAURI__.dialog && window.__TAURI__.dialog.open) {
                var selected = await window.__TAURI__.dialog.open({
                    directory: true,
                    multiple: false,
                    title: 'Select export target folder',
                });
                if (selected) {
                    var input = document.getElementById('export-target-folder');
                    if (input) input.value = selected;
                }
            } else {
                lexeraLog('warn', '[kanban.export.browse] Tauri dialog not available');
            }
        } catch (err) {
            lexeraLog('warn', '[kanban.export.browse] ' + (err.message || String(err)));
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
            lexeraLog('warn', '[kanban.export.clipboard] Write failed: ' + (err.message || String(err)));
        }
    }

    /**
     * Display a status message in the modal.
     * @param {string} msg
     */
    _setStatus(msg) {
        var el = document.getElementById('export-status');
        if (el) el.textContent = msg;
    }

    /**
     * Enable or disable the action buttons during export.
     * @param {boolean} disabled
     */
    _disableButtons(disabled) {
        var ids = ['export-btn-save', 'export-btn-copy', 'export-btn-preview'];
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
            lexeraLog('error', '[kanban.export.auto] ' + (err.message || String(err)));
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
