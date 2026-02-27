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
    }

    // ── Public API ──────────────────────────────────────────────────────

    /**
     * Initialize dialog with board data.
     * @param {string} boardId
     * @param {object} boardData - Board data with columns array from REST API.
     */
    async init(boardId, boardData) {
        this.boardId = boardId;
        this.boardData = boardData;
        this.boardName = this._deriveBoardName(boardData);

        console.log('[ExportUI] init boardId=' + boardId);

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

        // Check tool availability and populate themes
        await this.checkToolAvailability();

        // Set initial format state
        this.onFormatChange();

        // Generate initial export folder name
        this.updateExportFolderName();
    }

    show() {
        var modal = document.getElementById('export-modal');
        if (modal) {
            modal.style.display = 'flex';
            console.log('[ExportUI] show');
        }
    }

    hide() {
        var modal = document.getElementById('export-modal');
        if (modal) {
            modal.style.display = 'none';
            console.log('[ExportUI] hide');
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

        // Column selection from tree
        var columnIndexes = this.treeUI ? this.treeUI.getSelectedItems() : [];

        var options = {
            boardId: this.boardId,
            format: format,
            tagVisibility: tagVisibility,
            excludeTags: excludeTags,
            columnIndexes: columnIndexes,
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

        console.log('[ExportUI] executeExport mode=' + mode);

        // Validate selection
        if (!options.columnIndexes || options.columnIndexes.length === 0) {
            this._setStatus('No columns selected. Use the tree selector to pick columns.');
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
            console.log('[ExportUI] executeExport error:', err);
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
            marpSection.style.display = (format === 'presentation' && this.marpAvailable) ? '' : 'none';
        }

        // Show/hide Pandoc section
        var pandocSection = document.getElementById('export-pandoc-section');
        if (pandocSection) {
            pandocSection.style.display = (format === 'document' && this.pandocAvailable) ? '' : 'none';
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

        // Build range label from selected columns
        var range = 'full';
        if (this.treeUI && this.tree) {
            var labels = ExportTreeBuilder.getSelectedColumnLabels(this.tree);
            if (labels.length === 0) {
                range = 'none';
            } else if (this.tree.selected) {
                range = 'full';
            } else if (labels.length <= 3) {
                range = labels.join('-').replace(/\s+/g, '').substring(0, 30);
            } else {
                range = labels.length + 'cols';
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
            console.log('[ExportUI] Marp available=' + this.marpAvailable);
        } catch (err) {
            console.log('[ExportUI] Marp check failed:', err);
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
            console.log('[ExportUI] Pandoc available=' + this.pandocAvailable);
        } catch (err) {
            console.log('[ExportUI] Pandoc check failed:', err);
            this.pandocAvailable = false;
        }

        // Discover Marp themes
        if (this.marpAvailable) {
            try {
                this.marpThemes = await ExportService.getMarpThemes([]);
                this._populateMarpThemes();
                console.log('[ExportUI] Marp themes: ' + this.marpThemes.length);
            } catch (err) {
                console.log('[ExportUI] Theme discovery failed:', err);
                this.marpThemes = [];
            }
        }
    }

    // ── Private Helpers ─────────────────────────────────────────────────

    _bindEvents() {
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
                console.log('[ExportUI] Tauri dialog not available, user must type path manually');
            }
        } catch (err) {
            console.log('[ExportUI] Browse folder error:', err);
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
            console.log('[ExportUI] Clipboard write failed:', err);
        }
    }

    /**
     * Display a status message in the modal.
     * @param {string} msg
     */
    _setStatus(msg) {
        console.log('[ExportUI] status: ' + msg);
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

    /**
     * Get checked state of a checkbox by ID.
     * @param {string} id
     * @returns {boolean}
     */
    _checked(id) {
        var el = document.getElementById(id);
        return el ? el.checked : false;
    }
}

window.ExportUI = ExportUI;
