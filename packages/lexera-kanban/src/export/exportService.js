/**
 * Export Service — main export orchestrator for lexera-kanban.
 *
 * 3-phase pipeline:
 *   Phase 1 (Extract):   REST API call to backend based on export format
 *   Phase 2 (Transform): Content transforms via REST (presentation only)
 *   Phase 3 (Output):    Copy / save file / preview via Tauri commands
 *
 * REST endpoints (on lexera-backend):
 *   POST /boards/{id}/export/presentation  -> { markdown }
 *   POST /boards/{id}/export/document      -> { markdown }
 *   POST /boards/{id}/export/filter        -> { markdown }
 *   POST /export/transform                 -> { content }
 *
 * Tauri commands (on lexera-kanban):
 *   marp_export, marp_watch, marp_stop_watch, marp_stop_all_watches,
 *   pandoc_export, check_marp_available, check_pandoc_available,
 *   discover_marp_themes, write_export_file, open_export_folder
 */

class ExportService {

    // ── Public API ──────────────────────────────────────────────────────

    /**
     * Run the full export pipeline.
     * @param {object} options - Export options from the UI.
     * @returns {{ success: boolean, content?: string, exportedPath?: string, message: string }}
     */
    static async export(options) {
        try {
            console.log('[ExportService] Starting export', options.format, options.mode);

            // Phase 1 — Extract
            const extracted = await ExportService._extract(options);
            if (!extracted) {
                return { success: false, message: 'Phase 1 (Extract) returned no content' };
            }

            // Phase 2 — Transform (presentation only)
            const transformed = await ExportService._transform(extracted, options);

            // Phase 3 — Output
            return await ExportService._output(transformed, options);

        } catch (err) {
            console.log('[ExportService] Export failed:', err);
            return { success: false, message: err.message || String(err) };
        }
    }

    /**
     * Check whether Marp CLI is installed and accessible.
     * @returns {{ available: boolean, version?: string }}
     */
    static async checkMarpStatus() {
        const result = await window.__TAURI__.core.invoke('check_marp_available');
        return { available: result.available, version: result.version || null };
    }

    /**
     * Check whether Pandoc is installed and accessible.
     * @returns {{ available: boolean, version?: string }}
     */
    static async checkPandocStatus() {
        const result = await window.__TAURI__.core.invoke('check_pandoc_available');
        return { available: result.available, version: result.version || null };
    }

    /**
     * Discover available Marp themes from given directories.
     * @param {string[]} dirs - Extra directories to scan for .css / .marp.css files.
     * @returns {Array<{ name: string, path: string, builtin: boolean }>}
     */
    static async getMarpThemes(dirs) {
        return await window.__TAURI__.core.invoke('discover_marp_themes', { dirs: dirs || [] });
    }

    /**
     * Stop all running Marp watch processes.
     * @returns {number} Count of stopped processes.
     */
    static async stopAllWatches() {
        return await window.__TAURI__.core.invoke('marp_stop_all_watches');
    }

    /**
     * Open a folder (or the parent of a file) in the system file manager.
     * @param {string} path - File or folder path.
     */
    static async openExportFolder(path) {
        await window.__TAURI__.core.invoke('open_export_folder', { path });
    }

    // ── Phase 1: Extract ────────────────────────────────────────────────

    /**
     * Call the appropriate REST endpoint to extract markdown from the board.
     * @param {object} options
     * @returns {string} Extracted markdown content.
     */
    static async _extract(options) {
        const baseUrl = window.LexeraApi.baseUrl;
        if (!baseUrl) {
            await window.LexeraApi.discover();
        }
        const url = window.LexeraApi.baseUrl || (await window.LexeraApi.discover());
        if (!url) throw new Error('Backend not available');

        const boardId = options.boardId;
        if (!boardId) throw new Error('No boardId specified');

        let endpoint;
        let body;

        if (options.format === 'presentation') {
            endpoint = url + '/boards/' + boardId + '/export/presentation';
            body = {
                tagVisibility: options.tagVisibility || 'all',
                excludeTags: options.excludeTags || [],
                stripIncludes: options.stripIncludes || false,
                includeMarpDirectives: options.includeMarpDirectives || false,
                marpTheme: options.marpTheme || null,
                marpGlobalClasses: options.marpGlobalClasses || [],
                marpLocalClasses: options.marpLocalClasses || [],
                columnIndexes: options.columnIndexes || [],
            };
        } else if (options.format === 'document') {
            endpoint = url + '/boards/' + boardId + '/export/document';
            body = {
                tagVisibility: options.tagVisibility || 'all',
                excludeTags: options.excludeTags || [],
                stripIncludes: options.stripIncludes || false,
                pageBreaks: options.documentPageBreaks || 'continuous',
                columnIndexes: options.columnIndexes || [],
            };
        } else {
            // 'keep' or 'kanban' — filtered kanban markdown
            endpoint = url + '/boards/' + boardId + '/export/filter';
            body = {
                tagVisibility: options.tagVisibility || 'all',
                excludeTags: options.excludeTags || [],
                columnIndexes: options.columnIndexes || [],
            };
        }

        console.log('[ExportService] Phase 1: POST', endpoint);

        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });

        if (!res.ok) {
            const text = await res.text().catch(() => res.statusText);
            throw new Error('Extract failed (' + res.status + '): ' + text);
        }

        const data = await res.json();
        return data.markdown || '';
    }

    // ── Phase 2: Transform ──────────────────────────────────────────────

    /**
     * Apply content transforms to extracted markdown (presentation format only).
     * @param {string} content - Raw extracted markdown.
     * @param {object} options
     * @returns {string} Transformed content.
     */
    static async _transform(content, options) {
        if (options.format !== 'presentation') return content;

        // Only call transform if any mode is non-default
        const speakerNoteMode = options.speakerNoteMode || 'comment';
        const htmlCommentMode = options.htmlCommentMode || 'keep';
        const htmlContentMode = options.htmlContentMode || 'keep';

        if (speakerNoteMode === 'comment' && htmlCommentMode === 'keep' && htmlContentMode === 'keep') {
            return content;
        }

        const url = window.LexeraApi.baseUrl || (await window.LexeraApi.discover());
        if (!url) throw new Error('Backend not available');

        const endpoint = url + '/export/transform';
        const body = {
            content,
            speakerNoteMode,
            htmlCommentMode,
            htmlContentMode,
            format: 'presentation',
        };

        console.log('[ExportService] Phase 2: POST', endpoint);

        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });

        if (!res.ok) {
            const text = await res.text().catch(() => res.statusText);
            throw new Error('Transform failed (' + res.status + '): ' + text);
        }

        const data = await res.json();
        return data.content || content;
    }

    // ── Phase 3: Output ─────────────────────────────────────────────────

    /**
     * Deliver the final content: copy to caller, save as file, or launch preview.
     * @param {string} content - Final markdown content.
     * @param {object} options
     * @returns {{ success: boolean, content?: string, exportedPath?: string, message: string }}
     */
    static async _output(content, options) {
        const mode = options.mode || 'copy';

        // ── Copy mode: return content for the caller to put on clipboard ──
        if (mode === 'copy') {
            console.log('[ExportService] Phase 3: copy (' + content.length + ' chars)');
            return { success: true, content, message: 'Content ready for clipboard' };
        }

        // ── Save / Preview: write markdown file first ──
        const ext = ExportService.getExtensionForFormat(options.format, options.marpFormat, options.pandocFormat);
        const mdPath = ExportService.generateExportPath(
            options.targetFolder,
            options.exportFolderName,
            '.md'
        );

        console.log('[ExportService] Phase 3: writing markdown to', mdPath);
        await window.__TAURI__.core.invoke('write_export_file', { path: mdPath, content });

        // ── Preview mode: start Marp watch ──
        if (mode === 'preview') {
            console.log('[ExportService] Phase 3: starting Marp preview');
            const watchResult = await window.__TAURI__.core.invoke('marp_watch', {
                opts: {
                    inputPath: mdPath,
                    format: 'html',
                    outputPath: '',
                    theme: options.marpTheme || null,
                    themeDirs: null,
                    enginePath: null,
                    browser: null,
                    pptxEditable: null,
                    additionalArgs: null,
                    handout: null,
                    handoutLayout: null,
                    handoutSlidesPerPage: null,
                    handoutDirection: null,
                },
            });
            return {
                success: watchResult.success,
                exportedPath: mdPath,
                message: watchResult.message || 'Preview started',
            };
        }

        // ── Save mode ──
        if (options.runMarp && options.format === 'presentation' && options.marpFormat !== 'markdown') {
            const marpOutputPath = ExportService.generateExportPath(
                options.targetFolder,
                options.exportFolderName,
                '.' + options.marpFormat
            );

            console.log('[ExportService] Phase 3: running Marp export to', marpOutputPath);
            const marpResult = await window.__TAURI__.core.invoke('marp_export', {
                opts: {
                    inputPath: mdPath,
                    format: options.marpFormat,
                    outputPath: marpOutputPath,
                    enginePath: null,
                    theme: options.marpTheme || null,
                    themeDirs: null,
                    browser: null,
                    pptxEditable: options.marpPptxEditable || false,
                    additionalArgs: null,
                    handout: options.marpHandout || false,
                    handoutLayout: options.marpHandoutLayout || null,
                    handoutSlidesPerPage: options.marpHandoutSlidesPerPage || null,
                    handoutDirection: options.marpHandoutDirection || null,
                },
            });

            return {
                success: marpResult.success,
                exportedPath: marpResult.outputPath,
                message: marpResult.message || 'Marp export completed',
            };
        }

        if (options.runPandoc && options.format === 'document') {
            const pandocOutputPath = ExportService.generateExportPath(
                options.targetFolder,
                options.exportFolderName,
                '.' + options.pandocFormat
            );

            console.log('[ExportService] Phase 3: running Pandoc export to', pandocOutputPath);
            const pandocResult = await window.__TAURI__.core.invoke('pandoc_export', {
                opts: {
                    inputPath: mdPath,
                    outputPath: pandocOutputPath,
                    format: options.pandocFormat,
                    additionalArgs: null,
                },
            });

            return {
                success: pandocResult.success,
                exportedPath: pandocResult.outputPath,
                message: pandocResult.message || 'Pandoc export completed',
            };
        }

        // Save mode without Marp/Pandoc — the .md file itself is the output
        return { success: true, exportedPath: mdPath, message: 'Markdown file saved' };
    }

    // ── Helpers ──────────────────────────────────────────────────────────

    /**
     * Build a full file path for an export output.
     * @param {string} targetFolder - Base directory for exports.
     * @param {string} folderName - Subfolder name (usually board name or custom).
     * @param {string} ext - File extension including the dot, e.g. '.md', '.pdf'.
     * @returns {string} Full file path.
     */
    static generateExportPath(targetFolder, folderName, ext) {
        const folder = targetFolder || '';
        const name = folderName || 'export';
        // Use path separator based on platform hint (Tauri runs on the local OS)
        const sep = folder.includes('\\') ? '\\' : '/';
        return folder + sep + name + sep + name + ext;
    }

    /**
     * Determine the output file extension for the given format combination.
     * @param {string} format - 'keep' | 'kanban' | 'presentation' | 'document'
     * @param {string} marpFormat - 'markdown' | 'html' | 'pdf' | 'pptx'
     * @param {string} pandocFormat - 'docx' | 'odt' | 'epub'
     * @returns {string} Extension with leading dot.
     */
    static getExtensionForFormat(format, marpFormat, pandocFormat) {
        if (format === 'presentation') {
            switch (marpFormat) {
                case 'pdf':  return '.pdf';
                case 'pptx': return '.pptx';
                case 'html': return '.html';
                default:     return '.md';
            }
        }
        if (format === 'document') {
            switch (pandocFormat) {
                case 'docx': return '.docx';
                case 'odt':  return '.odt';
                case 'epub': return '.epub';
                default:     return '.md';
            }
        }
        // 'keep' or 'kanban'
        return '.md';
    }
}

window.ExportService = ExportService;
