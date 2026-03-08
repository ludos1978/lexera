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
    speakerNotes: 'lexera-export-speaker-notes',
    htmlComments: 'lexera-export-html-comments',
    htmlContent: 'lexera-export-html-content',
    pandocFormat: 'lexera-export-pandoc-format',
    pandocPageBreaks: 'lexera-export-pandoc-page-breaks',
    excludeEnabled: 'lexera-export-exclude-enabled',
    excludeTags: 'lexera-export-exclude-tags',
    stripIncludes: 'lexera-export-strip-includes',
    autoExportOnSave: 'lexera-export-auto-export-on-save',
};
var EXPORT_UI_LEGACY_STORAGE_KEYS = {
    marpTheme: 'kanban-marp-theme',
    speakerNotes: 'kanban-speaker-note-mode',
    htmlComments: 'kanban-html-comment-mode',
    htmlContent: 'kanban-html-content-mode',
    excludeTags: 'kanban-export-exclude-tags',
};

var ACTIVE_EXPORT_AUTO_SETTINGS = null;
var ACTIVE_EXPORT_AUTO_PROMISE = null;

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

function normalizeBooleanPreference(value, fallback) {
    if (value == null || value === '') return !!fallback;
    if (value === true || value === 'true' || value === '1' || value === 1) return true;
    if (value === false || value === 'false' || value === '0' || value === 0) return false;
    return !!fallback;
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
        next.marpWatch = true;
        next.marpPptxEditable = false;
        next.marpHandout = false;
        next.runPandoc = false;
    } else if (normalizedPreset === 'marp-pdf') {
        next.format = 'presentation';
        next.tagVisibility = 'none';
        next.stripIncludes = false;
        next.autoExportOnSave = true;
        next.runMarp = true;
        next.marpFormat = 'pdf';
        next.marpWatch = false;
        next.marpPptxEditable = false;
        next.marpHandout = false;
        next.speakerNoteMode = 'keep';
        next.runPandoc = false;
    } else if (normalizedPreset === 'share-content') {
        next.format = 'keep';
        next.tagVisibility = 'allexcludinglayout';
        next.stripIncludes = false;
        next.autoExportOnSave = false;
        next.runMarp = false;
        next.marpWatch = false;
        next.runPandoc = false;
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
        var tagVisibility = this._val('export-tag-visibility');
        var excludeTagsRaw = this._val('export-exclude-tags');
        var excludeTags = this._parseExcludeTags(excludeTagsRaw);
        var selection = this.treeUI
            ? this.treeUI.getSelection()
            : ExportTreeBuilder.getSelection(this.tree);
        var columnIndexes = selection ? selection.columnIndexes : [];
        var columnIds = selection ? selection.columnIds : [];

        var options = {
            boardId: this.boardId,
            format: format,
            tagVisibility: tagVisibility,
            excludeTags: excludeTags,
            selectionScopes: selection ? selection.scopes : [],
            columnIndexes: columnIndexes,
            columnIds: columnIds,
        };

        // Marp options (presentation format)
        if (format === 'presentation') {
            options.runMarp = this._checked('export-marp-enabled');
            options.marpFormat = this._val('export-marp-format');
            options.marpTheme = this._val('export-marp-theme') || null;
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
                if (mode === 'copy' && result.content) {
                    await this._copyToClipboard(result.content);
                    this._setStatus('Copied to clipboard (' + result.content.length + ' chars)');
                } else if (result.exportedPath) {
                    this._setStatus('Exported: ' + result.exportedPath);
                } else {
                    this._setStatus(result.message || 'Export completed');
                }
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

        // Marp format change
        var marpFormatSelect = document.getElementById('export-marp-format');
        if (marpFormatSelect) {
            marpFormatSelect.addEventListener('change', function () { self.onMarpFormatChange(); });
        }

        this._bindStoredSelect('export-marp-theme', 'marpTheme');
        this._bindStoredSelect('export-speaker-notes', 'speakerNotes', normalizeSpeakerNoteMode);
        this._bindStoredSelect('export-html-comments', 'htmlComments', normalizeKeepRemoveMode);
        this._bindStoredSelect('export-html-content', 'htmlContent', normalizeKeepRemoveMode);
        this._bindStoredSelect('export-pandoc-format', 'pandocFormat', normalizePandocExportFormat);
        this._bindStoredSelect('export-pandoc-page-breaks', 'pandocPageBreaks', normalizeDocumentPageBreakPreference);
        this._bindStoredInput('export-exclude-tags', 'excludeTags');

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
        this._setValue('export-speaker-notes', normalizeSpeakerNoteMode(getStoredExportUiPreference('speakerNotes', 'comment')));
        this._setValue('export-html-comments', normalizeKeepRemoveMode(getStoredExportUiPreference('htmlComments', 'keep')));
        this._setValue('export-html-content', normalizeKeepRemoveMode(getStoredExportUiPreference('htmlContent', 'keep')));
        this._setValue('export-pandoc-format', normalizePandocExportFormat(getStoredExportUiPreference('pandocFormat', 'docx')));
        this._setValue('export-pandoc-page-breaks', normalizeDocumentPageBreakPreference(getStoredExportUiPreference('pandocPageBreaks', 'continuous')));
        this._setValue('export-exclude-tags', getStoredExportUiPreference('excludeTags', ''));
    }

    _applyInitialOptions() {
        if (!this.initialOptions) return;
        if (this.initialOptions.format) {
            this._setValue('export-format', normalizeExportDialogFormat(this.initialOptions.format));
        }
        if (typeof this.initialOptions.runPandoc === 'boolean') {
            this._setChecked('export-pandoc-enabled', this.initialOptions.runPandoc);
        }
        if (this.initialOptions.pandocFormat) {
            this._setValue('export-pandoc-format', normalizePandocExportFormat(this.initialOptions.pandocFormat));
        }
        if (this.initialOptions.documentPageBreaks) {
            this._setValue('export-pandoc-page-breaks', normalizeDocumentPageBreakPreference(this.initialOptions.documentPageBreaks));
        }
        if (typeof this.initialOptions.marpTheme === 'string') {
            this._setValue('export-marp-theme', this.initialOptions.marpTheme);
        }
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
        var persist = function () {
            setStoredExportUiPreference(key, el.value || '');
        };
        el.addEventListener('input', persist);
        el.addEventListener('change', persist);
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
        if (boardData.file) {
            var parts = boardData.file.replace(/\\/g, '/').split('/');
            var filename = parts[parts.length - 1] || 'export';
            return filename.replace(/\.md$/i, '');
        }
        return 'export';
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
}

window.ExportUI = ExportUI;
