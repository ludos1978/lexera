/**
 * Export Service — main export orchestrator for lexera-kanban.
 *
 * 3-phase pipeline:
 *   Phase 1 (Extract):   REST API call to backend based on export format
 *   Phase 2 (Transform): Content transforms via REST + local embed transforms
 *   Phase 3 (Output):    Copy / save file via Tauri commands
 */

// LexeraApi.request throws `<status>: <body>` on non-2xx, bare error
// message on transport failure, or propagates backend-not-available as
// "Backend not available". Format these consistently as
// `<prefix> (<status>): <body>` when we can parse a status, or
// `<prefix>: <body>` otherwise.
function formatExportApiError(prefix, err) {
    var raw = err && err.message ? err.message : String(err);
    if (err && typeof err.status === 'number') {
        var text = raw;
        var colon = raw.indexOf(':');
        if (colon > 0 && /^\d+$/.test(raw.slice(0, colon).trim())) {
            text = raw.slice(colon + 1).trim();
        }
        return prefix + ' (' + err.status + '): ' + text;
    }
    var m = /^(\d{3}):\s*(.*)$/.exec(raw);
    if (m) return prefix + ' (' + m[1] + '): ' + m[2];
    return prefix + ': ' + raw;
}

// Log bridge — same cross-iframe issue as the Tauri IPC below: the kanban
// UI runs inside a workspace-shell iframe whose lexeraLog() writes to the
// iframe's own frontendLogEntries, but the user watches the shell's Log
// panel. Mirror every call to window.parent.lexeraLog when one exists.
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

// Resolve the Tauri IPC bridge — the kanban UI runs inside a workspace-shell iframe,
// and Tauri 2 does NOT inject __TAURI_INTERNALS__ into sub-frames. So we walk up
// to the parent (same-origin) when the current window is bare.
// Mirrors src/menu/embedMenu.js:resolveTauriInternals().
function resolveExportTauriIpc() {
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

function exportInvokeTauri(command, args) {
    var ipc = resolveExportTauriIpc();
    if (ipc) {
        return args === undefined ? ipc.invoke(command) : ipc.invoke(command, args);
    }
    if (window.LexeraBackendDiscovery && typeof window.LexeraBackendDiscovery.invokeTauri === 'function') {
        return args === undefined
            ? window.LexeraBackendDiscovery.invokeTauri(command)
            : window.LexeraBackendDiscovery.invokeTauri(command, args);
    }
    var available = {
        hasIpc: !!ipc,
        hasBackendDiscovery: !!(window.LexeraBackendDiscovery && typeof window.LexeraBackendDiscovery.invokeTauri === 'function'),
        hasInternals: !!(window.__TAURI_INTERNALS__ && typeof window.__TAURI_INTERNALS__.invoke === 'function'),
        hasParentInternals: (function () { try { return !!(window.parent && window.parent.__TAURI_INTERNALS__); } catch (e) { return false; } })(),
        hasGlobalCore: !!(window.__TAURI__ && window.__TAURI__.core && typeof window.__TAURI__.core.invoke === 'function'),
    };
    return Promise.reject(new Error('Tauri invoke unavailable for ' + command + ' (state: ' + JSON.stringify(available) + ')'));
}

function exportCanUseTauri() {
    if (resolveExportTauriIpc()) return true;
    if (window.LexeraBackendDiscovery && typeof window.LexeraBackendDiscovery.canUseTauriInvoke === 'function') {
        return window.LexeraBackendDiscovery.canUseTauriInvoke();
    }
    return false;
}

const EXPORT_LINK_PATTERN = /(!\[[^\]]*\]\([^)]+\)(?:\{[^}]+\})?)|((?<!!)\[[^\]]*\]\([^)]+\))|(<(?:img|video|audio)[^>]+src=["'][^"']+["'][^>]*>)|(\[\[[^\]]+\]\])/g;
const EXPORT_FENCE_BLOCK_PATTERN = /```[\s\S]*?```/g;
const EXPORT_INLINE_CODE_PATTERN = /`[^`]+`/g;
const EXPORT_CODE_PLACEHOLDER = '___LEXERA_EXPORT_CODE_BLOCK___';
const KNOWN_EXTERNAL_EMBED_PATTERNS = [
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

class ExportService {

    // ── Public API ──────────────────────────────────────────────────────

    static async export(options) {
        try {
            exportLexeraLog('info', '[ExportService] Starting export ' + options.format + ' ' + options.mode);

            if (ExportService._wasAborted(options)) return { success: false, aborted: true, message: 'Export cancelled' };
            const extracted = await ExportService._extract(options);
            if (!extracted) {
                return { success: false, message: 'Phase 1 (Extract) returned no content' };
            }

            if (ExportService._wasAborted(options)) return { success: false, aborted: true, message: 'Export cancelled' };
            const transformed = await ExportService._transform(extracted, options);

            if (ExportService._wasAborted(options)) return { success: false, aborted: true, message: 'Export cancelled' };
            return await ExportService._output(transformed, options);
        } catch (err) {
            if (err && (err.name === 'AbortError' || (err.message && err.message.indexOf('abort') >= 0))) {
                exportLexeraLog('warn', '[ExportService] Export aborted by user');
                return { success: false, aborted: true, message: 'Export cancelled' };
            }
            exportLexeraLog('error', '[ExportService] Export failed: ' + (err.message || String(err)));
            return { success: false, message: err.message || String(err) };
        }
    }

    static _wasAborted(options) {
        return !!(options && options.signal && options.signal.aborted);
    }

    // Marp status / discovery / watches — delegated to the Marp export plugin
    // (plugins/exports/marpExport.js). Public API preserved for existing callers.

    static _getMarpPlugin() {
        var reg = (typeof window !== 'undefined' && window.LexeraPluginRegistry) ? window.LexeraPluginRegistry : null;
        return reg ? reg.getById('export', 'marp') : null;
    }

    static _getPandocPlugin() {
        var reg = (typeof window !== 'undefined' && window.LexeraPluginRegistry) ? window.LexeraPluginRegistry : null;
        return reg ? reg.getById('export', 'pandoc') : null;
    }

    static async checkMarpStatus() {
        const plugin = ExportService._getMarpPlugin();
        if (plugin && plugin.checkStatus) return plugin.checkStatus();
        // Fallback: direct invoke if the plugin is not loaded (tests etc.)
        const result = await exportInvokeTauri('check_marp_available');
        return { available: result.available, version: result.version || null };
    }

    static async checkPandocStatus() {
        const plugin = ExportService._getPandocPlugin();
        if (plugin && plugin.checkStatus) return plugin.checkStatus();
        const result = await exportInvokeTauri('check_pandoc_available');
        return { available: result.available, version: result.version || null };
    }

    static async getMarpThemes(dirs) {
        const plugin = ExportService._getMarpPlugin();
        if (plugin && plugin.getThemes) return plugin.getThemes(dirs);
        return await exportInvokeTauri('discover_marp_themes', { dirs: dirs || [] });
    }

    static async getMarpClasses(dirs) {
        const plugin = ExportService._getMarpPlugin();
        if (plugin && plugin.getClasses) return plugin.getClasses(dirs);
        return await exportInvokeTauri('discover_marp_classes', { dirs: dirs || [] });
    }

    static async stopAllWatches() {
        const plugin = ExportService._getMarpPlugin();
        if (plugin && plugin.stopAllWatches) return plugin.stopAllWatches();
        return await exportInvokeTauri('marp_stop_all_watches');
    }

    static async openExportFolder(path) {
        await exportInvokeTauri('open_export_folder', { path });
    }

    // Directory of custom Marp theme CSS files configured in Plugin
    // Settings. Passed to Marp CLI as `--theme-set <dir>` via the
    // themeDirs option so every export picks up the user's templates.
    static async getMarpTemplateDirs() {
        const cfg = await ExportService.getRenderAppsConfig();
        if (cfg && typeof cfg.marpTemplatesPath === 'string' && cfg.marpTemplatesPath.trim()) {
            return [cfg.marpTemplatesPath.trim()];
        }
        return null;
    }

    // Snapshot of the render-apps config (/config/render-apps) — used for
    // marpEnginePath / marpTemplatesPath overrides. Cached per session so
    // each export doesn't re-fetch; callers can clear via _renderAppsConfigCache = undefined.
    //
    // LexeraApi exposes request() (see api.js) — no .get/.put adapters —
    // so we call request() directly. Also handles the iframe case where
    // LexeraApi only lives on window.parent.
    static _resolveLexeraApi() {
        if (typeof window === 'undefined') return null;
        function isUsable(api) {
            return !!(api && (typeof api.request === 'function' || typeof api.get === 'function'));
        }
        if (isUsable(window.LexeraApi)) return window.LexeraApi;
        try {
            if (window.parent && window.parent !== window && isUsable(window.parent.LexeraApi)) {
                return window.parent.LexeraApi;
            }
        } catch (e) { /* cross-origin */ }
        return null;
    }

    static async getRenderAppsConfig() {
        if (ExportService._renderAppsConfigCache !== undefined) {
            return ExportService._renderAppsConfigCache;
        }
        try {
            const api = ExportService._resolveLexeraApi();
            // Tests may stub window.LexeraApi.get() directly — honor that
            // shape too so they don't have to mock request().
            if (api && typeof api.get === 'function') {
                ExportService._renderAppsConfigCache = await api.get('/config/render-apps');
            } else if (api && typeof api.request === 'function') {
                ExportService._renderAppsConfigCache = await api.request('/config/render-apps');
            } else {
                ExportService._renderAppsConfigCache = null;
            }
        } catch (err) {
            exportLexeraLog('warn', '[ExportService] /config/render-apps fetch failed: ' + (err && err.message ? err.message : String(err)));
            ExportService._renderAppsConfigCache = null;
        }
        return ExportService._renderAppsConfigCache;
    }

    // Cached absolute path of packages/marp-engine/engine/engine.js.
    // Resolution order:
    //   1. User-set marpEnginePath in /config/render-apps (Plugin Settings panel)
    //   2. Marp export plugin's own getEnginePath (which wraps get_marp_engine_path)
    //   3. Direct Tauri invoke to get_marp_engine_path
    // Caller can still override via options.marpEnginePath per-export.
    static async getMarpEnginePath() {
        if (ExportService._marpEnginePathCache !== undefined) {
            return ExportService._marpEnginePathCache;
        }
        const cfg = await ExportService.getRenderAppsConfig();
        if (cfg && typeof cfg.marpEnginePath === 'string' && cfg.marpEnginePath.trim()) {
            ExportService._marpEnginePathCache = cfg.marpEnginePath.trim();
            return ExportService._marpEnginePathCache;
        }

        const plugin = ExportService._getMarpPlugin();
        if (plugin && plugin.getEnginePath) {
            ExportService._marpEnginePathCache = await plugin.getEnginePath();
            return ExportService._marpEnginePathCache;
        }
        try {
            const result = await exportInvokeTauri('get_marp_engine_path');
            ExportService._marpEnginePathCache = result || null;
        } catch (err) {
            exportLexeraLog('warn', '[ExportService] get_marp_engine_path failed: ' + (err && err.message ? err.message : String(err)));
            ExportService._marpEnginePathCache = null;
        }
        return ExportService._marpEnginePathCache;
    }

    // ── Phase 1: Extract ────────────────────────────────────────────────

    static async _extract(options) {
        const boardId = options.boardId;
        if (!boardId) throw new Error('No boardId specified');

        let path;
        let body;

        if (options.format === 'presentation') {
            path = '/boards/' + boardId + '/export/presentation';
            body = {
                tagVisibility: options.tagVisibility || 'all',
                excludeTags: options.excludeTags || [],
                stripIncludes: options.stripIncludes || false,
                includeMarpDirectives: options.includeMarpDirectives || false,
                marpTheme: options.marpTheme || null,
                marpGlobalClasses: options.marpGlobalClasses || [],
                marpLocalClasses: options.marpLocalClasses || [],
                columnIds: options.columnIds || [],
                columnIndexes: options.columnIndexes || [],
            };
        } else if (options.format === 'document') {
            path = '/boards/' + boardId + '/export/document';
            body = {
                tagVisibility: options.tagVisibility || 'all',
                excludeTags: options.excludeTags || [],
                stripIncludes: options.stripIncludes || false,
                pageBreaks: options.documentPageBreaks || 'continuous',
                columnIds: options.columnIds || [],
                columnIndexes: options.columnIndexes || [],
            };
        } else {
            path = '/boards/' + boardId + '/export/filter';
            body = {
                tagVisibility: options.tagVisibility || 'all',
                excludeTags: options.excludeTags || [],
                columnIds: options.columnIds || [],
                columnIndexes: options.columnIndexes || [],
            };
        }

        exportLexeraLog('info', '[ExportService] Phase 1: POST ' + path
            + ' (filter: ids=' + (body.columnIds ? body.columnIds.length : 0)
            + ', idx=' + (body.columnIndexes ? body.columnIndexes.length : 0) + ')');

        // Dispatch through LexeraApi.request so the transport layer (HTTP or
        // IPC) is selected uniformly. `LexeraApi.request` throws on non-2xx
        // with the status/body, matching the earlier `!res.ok` branch.
        let data;
        try {
            data = await window.LexeraApi.request(path, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                signal: options && options.signal,
            });
        } catch (e) {
            throw new Error(formatExportApiError('Extract failed', e));
        }
        const md = data.markdown || data.content || '';
        const slideCount = (md.match(/^---\s*$/gm) || []).length + (md ? 1 : 0);
        // keptColumns echoes the column TITLES the backend actually included
        // after selection + duplicate-id-safe intersection. Surfacing it to
        // the caller (and logs) lets the user visually confirm the export
        // scope — e.g. 9 stack columns vs. 94 whole-board columns.
        const kept = Array.isArray(data.keptColumns) ? data.keptColumns : null;
        exportLexeraLog('info', '[ExportService] Phase 1: response ' + md.length + ' chars, ~' + slideCount + ' slides, kept=' + (kept ? JSON.stringify(kept) : 'n/a'));
        options._lastKeptColumns = kept;
        return md;
    }

    // ── Phase 2: Transform ──────────────────────────────────────────────

    static async _transform(content, options) {
        if (options.format !== 'presentation') return content;

        const speakerNoteMode = options.speakerNoteMode || 'comment';
        const htmlCommentMode = options.htmlCommentMode || 'keep';
        const htmlContentMode = options.htmlContentMode || 'keep';
        const needsRestTransform = !(speakerNoteMode === 'comment' && htmlCommentMode === 'keep' && htmlContentMode === 'keep');

        let transformed = content;

        if (needsRestTransform) {
            const body = {
                content,
                speakerNoteMode,
                htmlCommentMode,
                htmlContentMode,
                format: 'presentation',
            };

            exportLexeraLog('info', '[ExportService] Phase 2: POST /export/transform');

            let data;
            try {
                data = await window.LexeraApi.request('/export/transform', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                    signal: options && options.signal,
                });
            } catch (e) {
                throw new Error(formatExportApiError('Transform failed', e));
            }
            transformed = data.content || content;
        }

        return ExportService.applyLocalPresentationTransforms(transformed, options);
    }

    static applyLocalPresentationTransforms(content, options) {
        if (!options || options.format !== 'presentation' || (options.mode || 'copy') === 'copy') {
            return content;
        }
        let transformed = content;
        transformed = ExportService.applyTableWidthTransform(transformed);
        transformed = ExportService.applyImageFigureTransform(transformed);
        transformed = ExportService.applyListSplitSafetyNet(transformed);
        const embedMode = ExportService.resolveEmbedExportMode(options);
        if (embedMode) {
            transformed = ExportService.transformEmbedsForExport(transformed, embedMode);
        }
        return transformed;
    }

    // Pre-render markdown tables with alignment markers (:---: etc) to HTML so Marp
    // preserves proportional widths. Tables without alignment markers remain as markdown.
    // Ported from _ARCHIVE/src/services/export/ExportService.ts:applyTableWidthTransform.
    static applyTableWidthTransform(content) {
        if (!content || content.indexOf('|') < 0) return content;
        if (!window.LexeraMarkdownRenderer || !window.LexeraMarkdownRenderer.isReady()) {
            exportLexeraLog('warn', '[ExportService] markdown-it not loaded; skipping table-widths transform');
            return content;
        }
        if (typeof window.markdownit !== 'function' || !window.markdownitTableWidths) {
            return content;
        }

        const md = window.markdownit({ html: true });
        md.use(window.markdownitTableWidths);

        const lines = content.split('\n');
        const result = [];
        let i = 0;
        while (i < lines.length) {
            if (lines[i].indexOf('|') < 0 || i + 1 >= lines.length) {
                result.push(lines[i]);
                i++;
                continue;
            }
            const sepLine = lines[i + 1];
            if (!sepLine || !/^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(sepLine)) {
                result.push(lines[i]);
                i++;
                continue;
            }
            let cols = sepLine.split('|');
            if (cols.length > 0 && cols[0].trim() === '') cols.shift();
            if (cols.length > 0 && cols[cols.length - 1].trim() === '') cols.pop();
            const hasAlignment = cols.some(function (c) {
                const t = c.trim();
                return t.charAt(0) === ':' || t.charAt(t.length - 1) === ':';
            });
            if (!hasAlignment) {
                result.push(lines[i]);
                i++;
                continue;
            }
            const tableLines = [lines[i], lines[i + 1]];
            let j = i + 2;
            while (j < lines.length && lines[j].indexOf('|') >= 0 && lines[j].trim() !== '') {
                tableLines.push(lines[j]);
                j++;
            }
            try {
                const html = md.render(tableLines.join('\n'));
                result.push(html.replace(/\s+$/, ''));
            } catch (err) {
                exportLexeraLog('warn', '[ExportService] table-widths render failed: ' + (err.message || String(err)));
                for (let k = 0; k < tableLines.length; k++) result.push(tableLines[k]);
            }
            i = j;
        }
        return result.join('\n');
    }

    // Wrap images with a title attribute in <figure>/<figcaption>. Marp's default renderer
    // drops the title text; markdown-it-image-figures preserves it.
    static applyImageFigureTransform(content) {
        if (!content) return content;
        if (!window.markdownit || !window.markdownItImageFigures) return content;

        // Image with title: ![alt](url "title") — URL has no whitespace; title in quotes.
        const blockPattern = /(^|\n)[ \t]*(!\[[^\]]*\]\([^"\s)]+\s+"[^"]*"\))[ \t]*(\n|$)/g;
        if (!blockPattern.test(content)) return content;
        blockPattern.lastIndex = 0;

        const md = window.markdownit({ html: true });
        md.use(window.markdownItImageFigures, { figcaption: 'title' });

        return content.replace(blockPattern, function (match, pre, imgMarkdown, post) {
            try {
                const html = md.render(imgMarkdown).replace(/\s+$/, '');
                return pre + html + post;
            } catch (err) {
                exportLexeraLog('warn', '[ExportService] image-figures render failed: ' + (err.message || String(err)));
                return match;
            }
        });
    }

    // Safety-net: ensure list items separated by blank lines get a <!-- --> breaker
    // even if the backend Rust list-split transform didn't run.
    // Only adds breakers where not already present.
    static applyListSplitSafetyNet(content) {
        if (!content) return content;
        const lines = content.split('\n');
        const out = [];
        let inList = false;
        let listIndent = 0;
        let blankBuffer = [];

        for (let k = 0; k < lines.length; k++) {
            const line = lines[k];
            const isBlank = line.trim() === '';
            const itemMatch = line.match(/^([ \t]*)(?:[-*+]|\d+[.)]) /);
            const isListItem = !!itemMatch;

            if (isBlank) {
                blankBuffer.push(line);
                continue;
            }

            if (isListItem && inList && blankBuffer.length > 0 && itemMatch[1].length <= listIndent) {
                const alreadyBroken = out.length > 0 && /<!--\s*-->/.test(out[out.length - 1]);
                for (let b = 0; b < blankBuffer.length; b++) out.push(blankBuffer[b]);
                if (!alreadyBroken) out.push('<!-- -->');
            } else {
                for (let b = 0; b < blankBuffer.length; b++) out.push(blankBuffer[b]);
            }
            blankBuffer = [];
            out.push(line);

            if (isListItem) {
                inList = true;
                listIndent = itemMatch[1].length;
            } else {
                const lineIndent = (line.match(/^([ \t]*)/) || ['', ''])[1].length;
                if (!inList || lineIndent <= listIndent) inList = false;
            }
        }
        for (let b = 0; b < blankBuffer.length; b++) out.push(blankBuffer[b]);
        return out.join('\n');
    }

    static resolveEmbedExportMode(options) {
        if (!options || options.format !== 'presentation' || (options.mode || 'copy') === 'copy') {
            return '';
        }
        const marpFormat = String(options.marpFormat || '').trim().toLowerCase();
        if (marpFormat === 'html') return 'iframe';
        return ExportService.normalizeEmbedHandling(options.embedHandling);
    }

    // ── Phase 3: Output ─────────────────────────────────────────────────

    static async _output(content, options) {
        const mode = options.mode || 'copy';

        if (mode === 'copy') {
            exportLexeraLog('info', '[ExportService] Phase 3: copy (' + content.length + ' chars)');
            return { success: true, content, message: 'Content ready for clipboard' };
        }

        const createdFiles = [];

        const throwIfAborted = () => {
            if (ExportService._wasAborted(options)) {
                const err = new Error('Export cancelled');
                err.name = 'AbortError';
                throw err;
            }
        };

        try {
            const mdPath = ExportService.generateExportPath(
                options.targetFolder,
                options.exportFolderName,
                '.md'
            );
            throwIfAborted();
            const prepared = await ExportService.prepareContentForOutput(content, options, mdPath);
            const finalContent = prepared && typeof prepared.content === 'string' ? prepared.content : content;
            if (prepared && Array.isArray(prepared.createdFiles)) {
                Array.prototype.push.apply(createdFiles, prepared.createdFiles);
            }
            const preparedReportEntries = prepared && prepared.reportEntries ? prepared.reportEntries : null;
            const preparedReadmePath = prepared && prepared.readmePath ? prepared.readmePath : null;

            throwIfAborted();
            exportLexeraLog('info', '[ExportService] Phase 3: writing markdown to ' + mdPath);
            await exportInvokeTauri('write_export_file', { path: mdPath, content: finalContent });
            createdFiles.push(mdPath);

            throwIfAborted();
            const enginePath = options.marpEnginePath || await ExportService.getMarpEnginePath();
            // Pull the user-configured Marp templates folder (Plugin Settings)
            // so every Marp CLI call gets `--theme-set <dir>` when set.
            const themeDirs = options.themeDirs || await ExportService.getMarpTemplateDirs();

            if (options.runMarp && options.format === 'presentation' && options.marpFormat !== 'markdown') {
                // If the user ticked "Watch / Preview" alongside html output,
                // launch Marp in watch mode (long-running) instead of a one-shot
                // export. Marp serves the HTML, we open the browser, and the
                // watcher rebuilds on edits.
                const wantsWatch = !!options.marpWatch && options.marpFormat === 'html';
                if (wantsWatch) {
                    exportLexeraLog('info', '[ExportService] Phase 3: starting Marp watch (engine=' + (enginePath || 'default') + ')');
                    const watchResult = await exportInvokeTauri('marp_watch', {
                        opts: {
                            inputPath: mdPath,
                            format: 'html',
                            outputPath: '',
                            theme: options.marpTheme || null,
                            themeDirs: themeDirs,
                            enginePath: enginePath,
                            browser: ExportService.normalizeMarpBrowser(options.marpBrowser),
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
                        message: watchResult.message || 'Marp watch started — browser preview should open shortly',
                        reportEntries: preparedReportEntries,
                        readmePath: preparedReadmePath,
                    };
                }

                const marpOutputPath = ExportService.generateExportPath(
                    options.targetFolder,
                    options.exportFolderName,
                    '.' + options.marpFormat
                );

                exportLexeraLog('info', '[ExportService] Phase 3: running Marp export to ' + marpOutputPath + ' (engine=' + (enginePath || 'default') + ')');
                // Wrap the Marp call in its own try. When Marp fails we want
                // the user to keep the preprocessed markdown (for re-running
                // manually / inspecting missing includes) rather than losing
                // it to the outer cleanup block.
                try {
                    const marpResult = await exportInvokeTauri('marp_export', {
                        opts: {
                            inputPath: mdPath,
                            format: options.marpFormat,
                            outputPath: marpOutputPath,
                            enginePath: enginePath,
                            theme: options.marpTheme || null,
                            themeDirs: themeDirs,
                            browser: ExportService.normalizeMarpBrowser(options.marpBrowser),
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
                        reportEntries: preparedReportEntries,
                        readmePath: preparedReadmePath,
                    };
                } catch (marpErr) {
                    const marpMsg = (marpErr && marpErr.message) ? marpErr.message : String(marpErr);
                    exportLexeraLog('error', '[ExportService] Marp export failed (markdown preserved at ' + mdPath + '): ' + marpMsg);
                    return {
                        success: false,
                        exportedPath: mdPath,
                        message: 'Marp export failed — markdown was saved at ' + mdPath + '. ' + marpMsg,
                    };
                }
            }

            if (options.runPandoc && options.format === 'document') {
                const pandocOutputPath = ExportService.generateExportPath(
                    options.targetFolder,
                    options.exportFolderName,
                    '.' + options.pandocFormat
                );

                throwIfAborted();
                exportLexeraLog('info', '[ExportService] Phase 3: running Pandoc export to ' + pandocOutputPath);
                // Same partial-success treatment as Marp: preserve the
                // markdown when Pandoc fails so the user can re-run manually.
                try {
                    const pandocResult = await exportInvokeTauri('pandoc_export', {
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
                        reportEntries: preparedReportEntries,
                        readmePath: preparedReadmePath,
                    };
                } catch (pandocErr) {
                    const pandocMsg = (pandocErr && pandocErr.message) ? pandocErr.message : String(pandocErr);
                    exportLexeraLog('error', '[ExportService] Pandoc export failed (markdown preserved at ' + mdPath + '): ' + pandocMsg);
                    return {
                        success: false,
                        exportedPath: mdPath,
                        message: 'Pandoc export failed — markdown was saved at ' + mdPath + '. ' + pandocMsg,
                    };
                }
            }

            return {
                success: true,
                exportedPath: mdPath,
                message: 'Markdown file saved',
                reportEntries: preparedReportEntries,
                readmePath: preparedReadmePath,
            };
        } catch (err) {
            if (createdFiles.length > 0) {
                exportLexeraLog('warn', '[ExportService] Cleaning up partial output: ' + createdFiles.join(', '));
                try {
                    await exportInvokeTauri('remove_export_files', { paths: createdFiles });
                } catch (cleanupErr) {
                    exportLexeraLog('error', '[ExportService] Cleanup failed: ' + (cleanupErr.message || String(cleanupErr)));
                }
            }
            throw err;
        }
    }

    static async prepareContentForOutput(content, options, mdPath) {
        if (!content || !options || (options.mode || 'copy') === 'copy') {
            return { content, createdFiles: [] };
        }

        const sourceFilePath = String(options.sourceFilePath || '').trim();
        if (!sourceFilePath) {
            return { content, createdFiles: [] };
        }

        const exportDir = ExportService.dirnamePath(mdPath);
        const fileBasename = ExportService.basenameWithoutExtension(mdPath);
        // Phase 2 layout: a single `_Rendered/` folder under the export
        // directory holds every packed asset (both copied source files and
        // rendered-embed copies). The prefix below gates link rewriting to
        // avoid redirecting already-packed paths.
        const packedFolderPrefix = '_Rendered/';
        const linkHandlingMode = ExportService.normalizeLinkHandlingMode(options.linkHandlingMode);
        let nextContent = content;
        let createdFiles = [];

        if (ExportService.shouldRenderFileEmbedsForExport(options)) {
            const renderedEmbeds = await ExportService.renderFileEmbedsForExport(
                nextContent,
                sourceFilePath,
                exportDir,
                fileBasename,
                linkHandlingMode
            );
            nextContent = renderedEmbeds.content;
            if (renderedEmbeds.createdFiles.length > 0) {
                createdFiles = createdFiles.concat(renderedEmbeds.createdFiles);
            }
        }

        if (ExportService.shouldPreprocessDiagramsForExport(options)) {
            const diagramResult = await ExportService.preprocessDiagramsForExport(
                nextContent,
                exportDir,
                fileBasename
            );
            nextContent = diagramResult.content;
            if (diagramResult.createdFiles.length > 0) {
                createdFiles = createdFiles.concat(diagramResult.createdFiles);
            }
        }

        // Phase 3: include-handling dropdown. Backend already strips directives
        // when stripIncludes=true (it stays false for 'merge' and 'keep').
        // For 'merge' we expand the directive contents here, inlining nested
        // markdown files. The report collects skipped/embedded entries for
        // both Readme.txt and the processes popup.
        const reportEntries = { skipped: [], embedded: [] };
        const includeHandling = ExportService.normalizeIncludeHandling(options.includeHandling);
        if (includeHandling === 'merge') {
            const depthCap = ExportService.normalizeMergeIncludesMaxDepth(options.mergeIncludesMaxDepth);
            const mergeResult = await ExportService.mergeIncludesInline(nextContent, sourceFilePath, depthCap, reportEntries);
            nextContent = mergeResult.content;
        }

        // Embed media as data URIs, opt-in via the checkbox in the Output
        // section. Runs BEFORE packing so inlined files aren't also copied.
        // Per-format gating inside the helper keeps the checkbox a no-op for
        // PDF/PPTX/DOCX/ODT/EPUB where the target format embeds natively.
        if (options.embedMedia && ExportService.shouldEmbedMediaForFormat(options)) {
            const sizeLimitBytes = ExportService.normalizePackFileSizeLimit(
                options.packOptions && options.packOptions.fileSizeLimitMB
            ) * 1024 * 1024;
            const outputFormatLabel = ExportService.describeOutputFormat(options);
            const embedResult = await ExportService.embedMediaAsDataUris(
                nextContent,
                sourceFilePath,
                sizeLimitBytes,
                outputFormatLabel,
                reportEntries
            );
            nextContent = embedResult.content;
        }

        if (options.packAssets && linkHandlingMode === 'pack-linked') {
            const plan = ExportService.prepareAssetPackingPlan(nextContent, sourceFilePath, exportDir, fileBasename, linkHandlingMode, options.packOptions, packedFolderPrefix);
            if (plan.items.length > 0) {
                const results = await exportInvokeTauri('copy_export_assets', { items: plan.items });
                const packed = ExportService.applyPackedAssetResults(nextContent, plan, results);
                nextContent = packed.content;
                createdFiles = createdFiles.concat(packed.createdFiles);
            }
        }

        nextContent = ExportService.rewriteLinksForExport(nextContent, sourceFilePath, mdPath, packedFolderPrefix);

        // Write the Readme.txt last so it captures every skip/warning collected
        // during this run. The file is only written when there's at least one
        // entry; otherwise we skip the write entirely.
        const readmePath = await ExportService.writeExportReadme(exportDir, reportEntries);
        if (readmePath) createdFiles.push(readmePath);

        return {
            content: nextContent,
            createdFiles,
            reportEntries,
            readmePath,
        };
    }

    static shouldEmbedMediaForFormat(options) {
        if (!options) return false;
        const format = String(options.format || '').trim().toLowerCase();
        if (format === 'keep' || format === 'kanban') return true;
        if (format === 'presentation') {
            const marpFormat = String(options.marpFormat || '').trim().toLowerCase();
            // Marp PDF/PPTX bake media in already; HTML and markdown flow
            // through our data-URI rewrite so the user gets self-contained
            // output without Marp-specific flags.
            return marpFormat === 'html' || marpFormat === 'markdown' || marpFormat === 'md' || marpFormat === '';
        }
        // document (pandoc) formats embed natively — don't pre-rewrite.
        return false;
    }

    static describeOutputFormat(options) {
        const format = String(options && options.format || '').trim().toLowerCase();
        if (format === 'presentation') {
            const marpFormat = String(options && options.marpFormat || 'html').trim().toLowerCase();
            return 'marp-' + (marpFormat || 'html');
        }
        return format || 'markdown';
    }

    static shouldRenderFileEmbedsForExport(options) {
        if (!options || (options.mode || 'copy') === 'copy') return false;
        const format = String(options.format || '').trim().toLowerCase();
        return format === 'presentation' || format === 'document' || format === 'keep' || format === 'kanban';
    }

    static getFileFormatRegistry() {
        if (typeof window === 'undefined' || !window || !window.LexeraFileFormatRegistry) return null;
        return window.LexeraFileFormatRegistry;
    }

    static getRenderableFileFormatPlugin(filePath) {
        const registry = ExportService.getFileFormatRegistry();
        if (!registry || typeof registry.findByFilePath !== 'function') return null;
        const plugin = registry.findByFilePath(filePath);
        if (!plugin || !plugin.export || !plugin.export.outputExtension) return null;
        return plugin;
    }

    static buildRenderedEmbedTargetRelativePath(fileBasename, filePath, plugin, renderConfig) {
        const stem = ExportService.sanitizeRenderedEmbedStem(ExportService.basenameWithoutExtension(filePath) || plugin.id || 'embed');
        const hash = ExportService.hashString(ExportService.normalizePathKey(filePath || plugin.id || 'embed')).slice(0, 8);
        const suffix = renderConfig && renderConfig.suffix ? renderConfig.suffix : '';
        const ext = renderConfig && renderConfig.outputExtension ? renderConfig.outputExtension : 'png';
        const fileName = stem + '-' + hash + suffix + '.' + ext;
        return ExportService.toForwardSlashes(fileBasename + '-Media/rendered/' + fileName);
    }

    // ── Shared preview/export cache helpers ─────────────────────────────
    // Mirror the embedMenu.js cache-path scheme so preview-cache and
    // export-render write to the SAME file: modifications invalidate by
    // changing the mtime portion of the filename, and the render backend
    // reuses a target whose mtime is >= source.
    static encodeUtf8Base64(value) {
        try {
            return btoa(encodeURIComponent(String(value || '')).replace(/%([0-9A-F]{2})/g, function (_, hex) {
                return String.fromCharCode(parseInt(hex, 16));
            }));
        } catch (e) {
            return '';
        }
    }

    static buildDiagramCachePrefix(sourcePath) {
        const basename = ExportService.basenameWithoutExtension(sourcePath);
        const pathHash = ExportService.encodeUtf8Base64(String(sourcePath || '')).replace(/[/+=]/g, '').slice(0, 8);
        return basename + '-' + pathHash + '-';
    }

    static buildDiagramCacheFileName(sourcePath, mtimeMs, extension, suffix) {
        return ExportService.buildDiagramCachePrefix(sourcePath) + Math.floor(mtimeMs || 0) + (suffix || '') + '.' + extension;
    }

    static buildDiagramCacheDir(boardFilePath, sourcePath, cacheFolderName) {
        const sourceDir = ExportService.dirnamePath(sourcePath);
        if (!sourceDir) return '';
        const boardDir = ExportService.dirnamePath(boardFilePath);
        if (!boardDir || ExportService.normalizePathKey(sourceDir) !== ExportService.normalizePathKey(boardDir)) {
            const sourceDirBase = ExportService.basename(sourceDir);
            if (!sourceDirBase) return '';
            if (/-Media$/i.test(sourceDirBase)) return sourceDir + '/' + cacheFolderName;
            return sourceDir + '/' + sourceDirBase + '-Media/' + cacheFolderName;
        }
        const boardBase = ExportService.basenameWithoutExtension(boardFilePath);
        if (!boardBase) return '';
        return boardDir + '/' + boardBase + '-Media/' + cacheFolderName;
    }

    static async fetchSourceMtimeMs(absoluteSourcePath) {
        if (!exportCanUseTauri()) return 0;
        try {
            const ms = await exportInvokeTauri('get_file_mtime_ms', { path: absoluteSourcePath });
            return typeof ms === 'number' && isFinite(ms) ? ms : 0;
        } catch (err) {
            exportLexeraLog('warn', '[ExportService] get_file_mtime_ms failed for ' + absoluteSourcePath + ': ' + (err && err.message ? err.message : String(err)));
            return 0;
        }
    }

    // Packing applies to rendered embeds in the same mode-driven way as
    // other assets: if the user picked pack-linked we copy the shared cache
    // file into the export's _Rendered/ folder; otherwise links point at the
    // cache file directly via a relative path.
    static shouldCopyRenderedEmbedToPack(linkHandlingMode) {
        return ExportService.normalizeLinkHandlingMode(linkHandlingMode) === 'pack-linked';
    }

    static sanitizeRenderedEmbedStem(value) {
        const normalized = String(value || '')
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9._-]+/g, '-')
            .replace(/^-+|-+$/g, '');
        return normalized || 'embed';
    }

    static hashString(value) {
        const input = String(value || '');
        let hash = 5381;
        for (let i = 0; i < input.length; i++) {
            hash = ((hash << 5) + hash) ^ input.charCodeAt(i);
            hash = hash >>> 0;
        }
        return ('00000000' + hash.toString(16)).slice(-8);
    }

    static resolvePluginRenderPageNumber(anchorPart, attrs) {
        const attrPage = attrs && (attrs.sheet || attrs.page || attrs.slide || attrs.frame);
        const directAnchor = String(anchorPart || '').match(/^#(\d+)$/);
        const parsed = parseInt(attrPage || (directAnchor ? directAnchor[1] : ''), 10);
        return parsed > 0 ? parsed : 1;
    }

    static shouldPreprocessDiagramsForExport(options) {
        if (!options || (options.mode || 'copy') === 'copy') return false;
        const format = String(options.format || '').trim().toLowerCase();
        return format === 'presentation' || format === 'document';
    }

    // Pre-render ```plantuml fenced code blocks to SVG files and replace with image references.
    // Ported from _ARCHIVE/src/services/export/DiagramPreprocessor.ts (plantuml path only;
    // mermaid and file-based diagrams are handled separately by renderFileEmbedsForExport).
    static async preprocessDiagramsForExport(content, exportDir, fileBasename) {
        if (!content || !exportCanUseTauri()) return { content, createdFiles: [] };
        const fencePattern = /```\s*plantuml\s*\n([\s\S]*?)```/g;
        if (!fencePattern.test(content)) return { content, createdFiles: [] };
        fencePattern.lastIndex = 0;

        const blocks = [];
        let match;
        let counter = 0;
        while ((match = fencePattern.exec(content)) !== null) {
            counter += 1;
            blocks.push({
                fullMatch: match[0],
                code: match[1],
                id: 'plantuml-' + counter,
                start: match.index,
            });
        }

        // Render all plantuml blocks in parallel — each targets a distinct
        // SVG file so there's no contention, and this is where large boards
        // spend most of their export time.
        const renderJobs = blocks.map(function (block) {
            const fileName = fileBasename + '-' + block.id + '.svg';
            const targetPath = ExportService.joinPath(exportDir, fileName);
            let wrapped = block.code.trim();
            if (!/@startuml/i.test(wrapped)) wrapped = '@startuml\n' + wrapped + '\n@enduml';
            return exportInvokeTauri('render_plantuml_code', {
                opts: { code: wrapped, targetPath: targetPath },
            }).then(function (result) {
                return { block: block, fileName: fileName, targetPath: targetPath, result: result, error: null };
            }).catch(function (err) {
                return { block: block, fileName: fileName, targetPath: targetPath, result: null, error: err };
            });
        });
        const outcomes = await Promise.all(renderJobs);

        const createdFiles = [];
        const replacements = [];
        for (const o of outcomes) {
            if (o.error) {
                exportLexeraLog('warn', '[ExportService.diagram] PlantUML invoke failed for ' + o.block.id + ': ' + (o.error && o.error.message ? o.error.message : String(o.error)));
                continue;
            }
            if (o.result && o.result.success) {
                replacements.push({
                    original: o.block.fullMatch,
                    replacement: '![' + o.block.id + '](' + o.fileName + ')',
                });
                createdFiles.push(o.targetPath);
            } else {
                exportLexeraLog('warn', '[ExportService.diagram] PlantUML render failed for ' + o.block.id + ': ' + ((o.result && o.result.error) || 'unknown'));
            }
        }

        let nextContent = content;
        for (let j = 0; j < replacements.length; j++) {
            nextContent = nextContent.replace(replacements[j].original, replacements[j].replacement);
        }
        return { content: nextContent, createdFiles: createdFiles };
    }

    static async renderFileEmbedsForExport(content, sourceFilePath, exportDir, fileBasename, linkHandlingMode) {
        const registry = ExportService.getFileFormatRegistry();
        if (!registry || !exportCanUseTauri()) {
            return { content, createdFiles: [] };
        }

        const packCopies = ExportService.shouldCopyRenderedEmbedToPack(linkHandlingMode);
        const protectedCode = ExportService.protectCodeBlocks(content);
        const sourceDir = ExportService.dirnamePath(sourceFilePath);
        const imagePattern = /!\[([^\]]*)\]\(([^)]+)\)(\{[^}]+\})?/g;
        const matches = [];
        const jobs = {};
        const mtimeCache = {};
        let match;

        while ((match = imagePattern.exec(protectedCode.content)) !== null) {
            const raw = match[0];
            const alt = match[1] || '';
            const rawSrc = match[2] || '';
            const attrsBlock = match[3] || '';
            const pathMeta = ExportService.parseLinkPath(rawSrc);
            const filePath = pathMeta.pathPart || '';
            if (!filePath || ExportService.isUrl(filePath)) {
                continue;
            }

            const plugin = ExportService.getRenderableFileFormatPlugin(filePath);
            if (!plugin || !registry.getExportRenderConfig || !registry.getPreviewRenderConfig) {
                continue;
            }

            const attrs = ExportService.parseAttributeBlock(attrsBlock);
            const pageNumber = ExportService.resolvePluginRenderPageNumber(pathMeta.anchorPart, attrs);
            const renderConfig = registry.getExportRenderConfig(filePath, { pageNumber: pageNumber });
            if (!renderConfig || renderConfig.supportsRuntimeRender === false) {
                continue;
            }
            // The export render inherits the preview cache folder so a single
            // render call serves both preview and export. Filename includes
            // extension + mtime so PNG/SVG variants coexist and stale content
            // cannot be reused across source modifications.
            const previewConfig = registry.getPreviewRenderConfig(filePath, { pageNumber: pageNumber });
            if (!previewConfig || !previewConfig.cacheFolderName) {
                continue;
            }

            const absoluteSourcePath = ExportService.isAbsolutePath(filePath)
                ? ExportService.normalizePath(filePath)
                : ExportService.resolvePath(sourceDir, filePath);
            const sourceKey = ExportService.normalizePathKey(absoluteSourcePath);
            let mtimeMs = mtimeCache[sourceKey];
            if (mtimeMs === undefined) {
                mtimeMs = await ExportService.fetchSourceMtimeMs(absoluteSourcePath);
                mtimeCache[sourceKey] = mtimeMs;
            }
            const cacheDir = ExportService.buildDiagramCacheDir(sourceFilePath, absoluteSourcePath, previewConfig.cacheFolderName);
            if (!cacheDir) {
                continue;
            }
            const cacheFileName = ExportService.buildDiagramCacheFileName(
                absoluteSourcePath,
                mtimeMs,
                renderConfig.outputExtension,
                renderConfig.suffix
            );
            const absoluteCacheTarget = ExportService.joinPath(cacheDir, cacheFileName);
            const jobKey = plugin.id + '::' + sourceKey + '::' + String(renderConfig.outputFormat || '') + '::' + String(pageNumber || 1);

            // In pack mode the rendered cache file is copied into
            // _Rendered/; otherwise the link points at the cache file
            // directly via relative path.
            const packRelativeTarget = packCopies
                ? ExportService.toForwardSlashes('_Rendered/' + cacheFileName)
                : '';
            const packAbsoluteTarget = packCopies
                ? ExportService.joinPath(exportDir, packRelativeTarget)
                : '';

            if (!jobs[jobKey]) {
                jobs[jobKey] = {
                    key: jobKey,
                    pluginId: plugin.id,
                    sourcePath: absoluteSourcePath,
                    targetPath: absoluteCacheTarget,
                    cacheAbsolute: absoluteCacheTarget,
                    packAbsolute: packAbsoluteTarget,
                    packRelative: packRelativeTarget,
                    pageNumber: pageNumber,
                    outputFormat: renderConfig.outputFormat || renderConfig.outputExtension || 'png',
                };
            }

            matches.push({
                index: match.index,
                raw: raw,
                alt: alt,
                titleAttr: pathMeta.titleAttr || '',
                attrsBlock: attrsBlock,
                jobKey: jobKey,
            });
        }

        if (!matches.length) {
            return { content, createdFiles: [] };
        }

        const createdFiles = [];
        const renderedTargets = {};
        const jobList = Object.keys(jobs).map(function (key) { return jobs[key]; });

        // Prefer the plugin's renderFile() method if available — this lets each
        // fileFormat plugin own its render dispatch path. Falls back to a
        // direct `render_embedded_file` invoke when the plugin doesn't expose
        // renderFile (tests / older plugins).
        function dispatchRender(job) {
            var plugin = registry && typeof registry.getById === 'function'
                ? registry.getById(job.pluginId)
                : null;
            var renderFn = plugin && typeof plugin.renderFile === 'function'
                ? plugin.renderFile
                : null;
            if (renderFn) {
                return renderFn({
                    sourcePath: job.sourcePath,
                    targetPath: job.targetPath,
                    pageNumber: job.pageNumber,
                    outputFormat: job.outputFormat,
                });
            }
            return exportInvokeTauri('render_embedded_file', {
                opts: {
                    pluginId: job.pluginId,
                    sourcePath: job.sourcePath,
                    targetPath: job.targetPath,
                    pageNumber: job.pageNumber,
                    outputFormat: job.outputFormat,
                },
            });
        }

        // Fan-out: each job writes a distinct target file so concurrency is
        // safe, and the backend tolerates parallel Tauri invokes. This cuts
        // export wall-time dramatically for boards with many embeds.
        const jobResults = await Promise.all(jobList.map(function (job) {
            return Promise.resolve()
                .then(function () { return dispatchRender(job); })
                .then(function (result) { return { job: job, result: result, error: null }; })
                .catch(function (err) { return { job: job, result: null, error: err }; });
        }));
        const successfulJobs = [];
        for (const entry of jobResults) {
            const job = entry.job;
            if (entry.error) {
                exportLexeraLog('warn', '[ExportService] Rendered embed export failed for ' + job.sourcePath + ': ' + (entry.error && entry.error.message ? entry.error.message : String(entry.error)));
                continue;
            }
            if (entry.result && entry.result.success) {
                successfulJobs.push(job);
                createdFiles.push(job.cacheAbsolute);
            } else {
                exportLexeraLog('warn', '[ExportService] Rendered embed export skipped for ' + job.sourcePath + ': ' + ((entry.result && entry.result.error) || 'unknown renderer failure'));
            }
        }

        // Pack mode: copy each rendered cache file into the export's
        // -Media/rendered folder. Reference mode: link directly to the
        // cache via a relative path from exportDir.
        if (packCopies && successfulJobs.length) {
            const copyItems = successfulJobs.map(function (job) {
                return { sourcePath: job.cacheAbsolute, targetPath: job.packAbsolute };
            });
            try {
                const copyResults = await exportInvokeTauri('copy_export_assets', { items: copyItems });
                const rows = Array.isArray(copyResults) ? copyResults : [];
                const copyMap = {};
                for (let i = 0; i < rows.length; i++) {
                    const row = rows[i] || {};
                    if (row.success) {
                        copyMap[ExportService.normalizePathKey(row.sourcePath)] = true;
                        createdFiles.push(row.targetPath);
                    } else {
                        exportLexeraLog('warn', '[ExportService] Rendered embed pack copy failed for ' + (row.sourcePath || '') + ': ' + (row.error || 'unknown'));
                    }
                }
                for (const job of successfulJobs) {
                    if (copyMap[ExportService.normalizePathKey(job.cacheAbsolute)]) {
                        renderedTargets[job.key] = job.packRelative;
                    }
                }
            } catch (err) {
                exportLexeraLog('warn', '[ExportService] copy_export_assets invoke failed: ' + (err && err.message ? err.message : String(err)));
            }
        } else {
            for (const job of successfulJobs) {
                renderedTargets[job.key] = ExportService.relativePath(exportDir, job.cacheAbsolute);
            }
        }

        if (!Object.keys(renderedTargets).length) {
            return { content, createdFiles: [] };
        }

        let cursor = 0;
        let output = '';
        for (let m = 0; m < matches.length; m++) {
            const row = matches[m];
            output += protectedCode.content.slice(cursor, row.index);
            if (renderedTargets[row.jobKey]) {
                output += '![' + row.alt + '](' + renderedTargets[row.jobKey] + (row.titleAttr || '') + ')' + (row.attrsBlock || '');
            } else {
                output += row.raw;
            }
            cursor = row.index + row.raw.length;
        }
        output += protectedCode.content.slice(cursor);

        return {
            content: ExportService.restoreCodeBlocks(output, protectedCode.blocks),
            createdFiles: createdFiles,
        };
    }

    // ── Phase 3: include-merging, media-embedding, skip report ──────────

    // Expand `!!!include(path)!!!` directives recursively, inlining the
    // referenced markdown. Include directives live in card-header content
    // (AGENT-claude.md §Tag Scoping) — we scan the full output content and
    // replace each match with the resolved file body. Depth is capped
    // because nested inclusion is possible in principle; visited-set
    // guards against cycles.
    static async mergeIncludesInline(content, sourceFilePath, maxDepth, reportEntries) {
        if (!exportCanUseTauri() || !content) return { content: content || '' };
        const depthCap = maxDepth > 0 ? maxDepth : 10;
        const visited = Object.create(null);
        const entries = reportEntries || { skipped: [], embedded: [] };
        if (!entries.skipped) entries.skipped = [];
        return { content: await ExportService._expandIncludes(content, sourceFilePath, depthCap, 0, visited, entries) };
    }

    static async _expandIncludes(content, baseFilePath, depthCap, depth, visited, report) {
        if (!content || depth >= depthCap) return content;
        const pattern = /!!!include\(([^)]+)\)!!!/g;
        let cursor = 0;
        let out = '';
        let match;
        const baseDir = ExportService.dirnamePath(baseFilePath);
        while ((match = pattern.exec(content)) !== null) {
            out += content.slice(cursor, match.index);
            const rawPath = String(match[1] || '').trim();
            const resolved = ExportService.isAbsolutePath(rawPath)
                ? ExportService.normalizePath(rawPath)
                : ExportService.resolvePath(baseDir, rawPath);
            const key = ExportService.normalizePathKey(resolved);
            if (visited[key]) {
                report.skipped.push({
                    path: resolved,
                    category: 'include',
                    mimeType: 'text/markdown',
                    sizeBytes: 0,
                    reason: 'cycle detected — include already expanded in this chain',
                });
                out += match[0];
                cursor = match.index + match[0].length;
                continue;
            }
            let fileContent = null;
            try {
                fileContent = await exportInvokeTauri('read_text_file', { path: resolved });
            } catch (err) {
                report.skipped.push({
                    path: resolved,
                    category: 'include',
                    mimeType: 'text/markdown',
                    sizeBytes: 0,
                    reason: 'read failed: ' + (err && err.message ? err.message : String(err)),
                });
                out += match[0];
                cursor = match.index + match[0].length;
                continue;
            }
            if (typeof fileContent !== 'string') {
                report.skipped.push({
                    path: resolved,
                    category: 'include',
                    mimeType: 'text/markdown',
                    sizeBytes: 0,
                    reason: 'include file returned non-string content',
                });
                out += match[0];
                cursor = match.index + match[0].length;
                continue;
            }
            visited[key] = true;
            const expanded = await ExportService._expandIncludes(fileContent, resolved, depthCap, depth + 1, visited, report);
            delete visited[key];
            out += expanded;
            cursor = match.index + match[0].length;
        }
        out += content.slice(cursor);
        return out;
    }

    // Rewrite `![alt](path)` image/video/audio references to base64 data URIs
    // when `embedMedia` is on and the target format benefits from inlining
    // (see shouldEmbedMediaForFormat). Per-file size cap reuses the packing
    // limit so there's one ceiling across the two features. Oversize files
    // keep their original link and are logged as skips; video/audio that
    // *do* embed are logged as "embedded" entries so the report can warn
    // about output-file inflation.
    static async embedMediaAsDataUris(content, sourceFilePath, sizeLimitBytes, outputFormatLabel, reportEntries) {
        if (!exportCanUseTauri() || !content) return { content: content || '' };
        const entries = reportEntries || { skipped: [], embedded: [] };
        if (!entries.skipped) entries.skipped = [];
        if (!entries.embedded) entries.embedded = [];

        const protectedCode = ExportService.protectCodeBlocks(content);
        const imagePattern = /!\[([^\]]*)\]\(([^)\s"]+)(?:\s+"([^"]*)")?\)(\{[^}]+\})?/g;
        const baseDir = ExportService.dirnamePath(sourceFilePath);
        const jobs = [];
        const matches = [];
        const jobIndex = Object.create(null);
        let match;

        while ((match = imagePattern.exec(protectedCode.content)) !== null) {
            const raw = match[0];
            const rawSrc = match[2] || '';
            if (!rawSrc || ExportService.isUrl(rawSrc) || rawSrc.indexOf('data:') === 0) continue;
            const pathMeta = ExportService.parseLinkPath(rawSrc);
            const filePath = pathMeta.pathPart || '';
            if (!filePath) continue;
            const absolute = ExportService.isAbsolutePath(filePath)
                ? ExportService.normalizePath(filePath)
                : ExportService.resolvePath(baseDir, filePath);
            const category = ExportService.embedCategoryForPath(absolute);
            if (!category) continue;
            const jobKey = ExportService.normalizePathKey(absolute);
            if (!(jobKey in jobIndex)) {
                jobIndex[jobKey] = jobs.length;
                jobs.push({ key: jobKey, absolute: absolute, category: category });
            }
            matches.push({ index: match.index, raw: raw, alt: match[1] || '', title: match[3] || '', attrs: match[4] || '', jobKey: jobKey });
        }

        if (!jobs.length) {
            return { content: ExportService.restoreCodeBlocks(protectedCode.content, protectedCode.blocks) };
        }

        // Fan-out: each file is read in parallel. `read_file_as_data_uri`
        // enforces `max_bytes` server-side so oversize files never land in
        // the frontend heap.
        const results = await Promise.all(jobs.map(function (job) {
            return exportInvokeTauri('read_file_as_data_uri', { path: job.absolute, maxBytes: sizeLimitBytes })
                .then(function (r) { return { job: job, result: r, error: null }; })
                .catch(function (err) { return { job: job, result: null, error: err }; });
        }));
        const dataUriByKey = Object.create(null);
        for (const entry of results) {
            const job = entry.job;
            if (entry.error) {
                entries.skipped.push({
                    path: job.absolute,
                    category: job.category,
                    mimeType: 'unknown',
                    sizeBytes: 0,
                    reason: 'read_file_as_data_uri failed: ' + (entry.error && entry.error.message ? entry.error.message : String(entry.error)),
                });
                continue;
            }
            const r = entry.result || {};
            if (r.skipped || !r.dataUri) {
                entries.skipped.push({
                    path: job.absolute,
                    category: job.category,
                    mimeType: r.mimeType || 'unknown',
                    sizeBytes: r.sizeBytes || 0,
                    reason: r.skippedReason || 'oversize',
                    sizeLimitBytes: sizeLimitBytes,
                });
                continue;
            }
            dataUriByKey[job.key] = r.dataUri;
            // Video/audio embedded → size inflates ~33%. Log so the report
            // flags this for the user; images don't need a warning.
            if (job.category === 'video' || job.category === 'audio') {
                entries.embedded.push({
                    path: job.absolute,
                    category: job.category,
                    mimeType: r.mimeType || '',
                    sizeBytes: r.sizeBytes || 0,
                    outputFormat: outputFormatLabel || 'output',
                });
            }
        }

        // Rewrite matches in order; keep original link when the job was
        // skipped so the file-reference fallback still works.
        let cursor = 0;
        let output = '';
        for (const m of matches) {
            output += protectedCode.content.slice(cursor, m.index);
            const dataUri = dataUriByKey[m.jobKey];
            if (dataUri) {
                output += '![' + m.alt + '](' + dataUri + (m.title ? ' "' + m.title + '"' : '') + ')' + (m.attrs || '');
            } else {
                output += m.raw;
            }
            cursor = m.index + m.raw.length;
        }
        output += protectedCode.content.slice(cursor);
        return { content: ExportService.restoreCodeBlocks(output, protectedCode.blocks) };
    }

    static embedCategoryForPath(filePath) {
        const ext = ExportService.getFileExtension(filePath).toLowerCase();
        if (!ext) return '';
        if (['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp', '.ico', '.avif', '.heic', '.heif'].indexOf(ext) >= 0) return 'image';
        if (['.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v'].indexOf(ext) >= 0) return 'video';
        if (['.mp3', '.wav', '.ogg', '.flac', '.m4a', '.aac'].indexOf(ext) >= 0) return 'audio';
        return '';
    }

    // Write the export skip/warning report to `{exportDir}/Readme.txt`.
    // The file is only created when at least one entry exists. Entries are
    // grouped by category (image/video/audio/include) so users can spot
    // missing or oversize files at a glance.
    static async writeExportReadme(exportDir, reportEntries) {
        if (!exportCanUseTauri() || !exportDir || !reportEntries) return null;
        const skipped = Array.isArray(reportEntries.skipped) ? reportEntries.skipped : [];
        const embedded = Array.isArray(reportEntries.embedded) ? reportEntries.embedded : [];
        if (!skipped.length && !embedded.length) return null;

        const lines = [];
        lines.push('# Export report');
        lines.push('');
        const now = new Date();
        const stamp = now.getFullYear() + '-'
            + String(now.getMonth() + 1).padStart(2, '0') + '-'
            + String(now.getDate()).padStart(2, '0') + ' '
            + String(now.getHours()).padStart(2, '0') + ':'
            + String(now.getMinutes()).padStart(2, '0');
        lines.push('Generated: ' + stamp);
        lines.push('');

        function groupByCategory(list) {
            const by = Object.create(null);
            for (const item of list) {
                const cat = item.category || 'other';
                if (!by[cat]) by[cat] = [];
                by[cat].push(item);
            }
            return by;
        }

        function categoryHeading(cat) {
            if (cat === 'image') return 'Images';
            if (cat === 'video') return 'Videos';
            if (cat === 'audio') return 'Audio';
            if (cat === 'include') return 'Includes';
            return 'Other';
        }

        function formatBytes(n) {
            if (!n || n < 1024) return (n || 0) + ' B';
            if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
            if (n < 1024 * 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + ' MB';
            return (n / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
        }

        if (skipped.length) {
            lines.push('## Skipped (kept original link)');
            lines.push('');
            const by = groupByCategory(skipped);
            const cats = Object.keys(by).sort();
            for (const cat of cats) {
                lines.push('### ' + categoryHeading(cat));
                for (const item of by[cat]) {
                    const size = formatBytes(item.sizeBytes || 0);
                    const limit = item.sizeLimitBytes ? formatBytes(item.sizeLimitBytes) : '';
                    const tail = limit ? (size + ' > ' + limit) : (item.reason || size);
                    lines.push(item.path + '  — ' + tail);
                }
                lines.push('');
            }
        }

        if (embedded.length) {
            lines.push('## Embedded media (inflated output size)');
            lines.push('');
            const by = groupByCategory(embedded);
            const cats = Object.keys(by).sort();
            for (const cat of cats) {
                lines.push('### ' + categoryHeading(cat));
                for (const item of by[cat]) {
                    const size = formatBytes(item.sizeBytes || 0);
                    const inflated = formatBytes(Math.round((item.sizeBytes || 0) * 1.33));
                    lines.push(item.path + '  — ' + size + ' embedded in ' + (item.outputFormat || 'output') + ' (~' + inflated + ' as base64)');
                }
                lines.push('');
            }
        }

        const readmePath = ExportService.joinPath(exportDir, 'Readme.txt');
        try {
            await exportInvokeTauri('write_export_file', { path: readmePath, content: lines.join('\n') });
        } catch (err) {
            exportLexeraLog('warn', '[ExportService] Failed to write export Readme.txt: ' + (err && err.message ? err.message : String(err)));
            return null;
        }
        return readmePath;
    }

    static prepareAssetPackingPlan(content, sourceFilePath, exportDir, fileBasename, linkHandlingMode, packOptions, skipPathPrefix) {
        const sourceDir = ExportService.dirnamePath(sourceFilePath);
        const refs = ExportService.collectLinkedAssetRefs(content);
        const items = [];
        const replacements = [];
        const sourceMap = {};
        const usedNames = {};
        const maxBytes = ExportService.normalizePackFileSizeLimit((packOptions && packOptions.fileSizeLimitMB) || 100) * 1024 * 1024;

        for (let i = 0; i < refs.length; i++) {
            const ref = refs[i];
            if (!ref || !ref.pathPart || ExportService.isUrl(ref.pathPart) || ExportService.isAbsolutePath(ref.pathPart)) {
                continue;
            }
            if (skipPathPrefix && ExportService.toForwardSlashes(ref.pathPart).indexOf(skipPathPrefix) === 0) {
                continue;
            }

            const absoluteSource = ExportService.resolvePath(sourceDir, ref.pathPart);
            if (!ExportService.shouldPackAsset(absoluteSource, linkHandlingMode, packOptions)) {
                continue;
            }

            const sourceKey = ExportService.normalizePathKey(absoluteSource);
            if (!sourceMap[sourceKey]) {
                const fileName = ExportService.basename(absoluteSource) || 'asset';
                const uniqueName = ExportService.allocateUniqueTargetName(fileName, usedNames);
                const relativeTarget = '_Rendered/' + uniqueName;
                const absoluteTarget = ExportService.joinPath(exportDir, relativeTarget);
                sourceMap[sourceKey] = {
                    sourcePath: absoluteSource,
                    relativeTarget: relativeTarget,
                    absoluteTarget: absoluteTarget,
                };
                items.push({
                    sourcePath: absoluteSource,
                    targetPath: absoluteTarget,
                    maxBytes: maxBytes,
                });
            }

            replacements.push({
                sourceKey: sourceKey,
                relativeTarget: sourceMap[sourceKey].relativeTarget,
                absoluteTarget: sourceMap[sourceKey].absoluteTarget,
            });
        }

        return {
            items,
            replacements,
            sourceMap,
            sourceDir,
        };
    }

    static applyPackedAssetResults(content, plan, results) {
        let nextContent = content;
        const createdFiles = [];
        const packedMap = {};
        const rows = Array.isArray(results) ? results : [];

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i] || {};
            if (row.success) {
                packedMap[ExportService.normalizePathKey(row.sourcePath)] = row.targetPath;
                createdFiles.push(row.targetPath);
            }
        }

        nextContent = ExportService.transformLinkTargets(nextContent, function (token) {
            if (!token || !token.pathPart || ExportService.isUrl(token.pathPart) || ExportService.isAbsolutePath(token.pathPart)) {
                return null;
            }
            const resolved = ExportService.resolvePath(plan.sourceDir || '', token.pathPart);
            const sourceKey = ExportService.normalizePathKey(resolved);
            if (!packedMap[sourceKey] || !plan.sourceMap[sourceKey]) return null;
            const relativeTarget = ExportService.toForwardSlashes(plan.sourceMap[sourceKey].relativeTarget);
            return relativeTarget;
        });

        return {
            content: nextContent,
            createdFiles: createdFiles,
        };
    }

    static rewriteLinksForExport(content, sourceFilePath, mdPath, skipPathPrefix) {
        const sourceDir = ExportService.dirnamePath(sourceFilePath);
        const exportDir = ExportService.dirnamePath(mdPath);
        return ExportService.transformLinkTargets(content, function (token) {
            if (!token || !token.pathPart) return null;
            if (ExportService.isUrl(token.pathPart) || ExportService.isAbsolutePath(token.pathPart)) return null;
            if (skipPathPrefix && ExportService.toForwardSlashes(token.pathPart).indexOf(skipPathPrefix) === 0) return null;
            const absoluteTarget = ExportService.resolvePath(sourceDir, token.pathPart);
            return ExportService.relativePath(exportDir, absoluteTarget);
        });
    }

    static transformLinkTargets(content, transformPath) {
        const protectedCode = ExportService.protectCodeBlocks(content);
        const transformed = protectedCode.content.replace(EXPORT_LINK_PATTERN, function (match) {
            const token = ExportService.parseLinkToken(match);
            if (!token) return match;
            const nextPath = transformPath(token);
            if (!nextPath || nextPath === token.pathPart) return match;
            return ExportService.rebuildLinkToken(token, nextPath);
        });
        return ExportService.restoreCodeBlocks(transformed, protectedCode.blocks);
    }

    static protectCodeBlocks(content) {
        const blocks = [];
        let protectedContent = String(content || '').replace(EXPORT_FENCE_BLOCK_PATTERN, function (match) {
            blocks.push(match);
            return EXPORT_CODE_PLACEHOLDER + (blocks.length - 1) + EXPORT_CODE_PLACEHOLDER;
        });
        protectedContent = protectedContent.replace(EXPORT_INLINE_CODE_PATTERN, function (match) {
            blocks.push(match);
            return EXPORT_CODE_PLACEHOLDER + (blocks.length - 1) + EXPORT_CODE_PLACEHOLDER;
        });
        return { content: protectedContent, blocks: blocks };
    }

    static restoreCodeBlocks(content, blocks) {
        return String(content || '').replace(new RegExp(EXPORT_CODE_PLACEHOLDER + '(\\d+)' + EXPORT_CODE_PLACEHOLDER, 'g'), function (_, index) {
            return blocks[parseInt(index, 10)] || '';
        });
    }

    static parseLinkToken(raw) {
        if (!raw) return null;
        let match;
        if (raw.indexOf('![') === 0) {
            match = raw.match(/^!\[([^\]]*)\]\(([^)]+)\)(\{[^}]+\})?$/);
            if (!match) return null;
            const pathMeta = ExportService.parseLinkPath(match[2]);
            return {
                kind: 'markdown-image',
                raw: raw,
                prefix: '![' + match[1] + '](',
                suffix: ')' + (match[3] || ''),
                pathPart: pathMeta.pathPart,
                anchorPart: pathMeta.anchorPart,
                titleAttr: pathMeta.titleAttr,
            };
        }
        if (raw.charAt(0) === '[' && raw.indexOf('[[') !== 0) {
            match = raw.match(/^\[([^\]]*)\]\(([^)]+)\)$/);
            if (!match) return null;
            const pathMeta = ExportService.parseLinkPath(match[2]);
            return {
                kind: 'markdown-link',
                raw: raw,
                prefix: '[' + match[1] + '](',
                suffix: ')',
                pathPart: pathMeta.pathPart,
                anchorPart: pathMeta.anchorPart,
                titleAttr: pathMeta.titleAttr,
            };
        }
        if (/^<(?:img|video|audio)/i.test(raw)) {
            match = raw.match(/src=["']([^"']+)["']/i);
            if (!match) return null;
            const pathMeta = ExportService.parseLinkPath(match[1]);
            return {
                kind: 'html',
                raw: raw,
                pathPart: pathMeta.pathPart,
                anchorPart: pathMeta.anchorPart,
                titleAttr: '',
            };
        }
        if (raw.indexOf('[[') === 0) {
            match = raw.match(/^\[\[([^\]]+)\]\]$/);
            if (!match) return null;
            const inner = match[1];
            const pipeIndex = inner.indexOf('|');
            const pathText = pipeIndex >= 0 ? inner.substring(0, pipeIndex) : inner;
            const tail = pipeIndex >= 0 ? inner.substring(pipeIndex) : '';
            const pathMeta = ExportService.parseLinkPath(pathText);
            return {
                kind: 'wiki',
                raw: raw,
                pathPart: pathMeta.pathPart,
                anchorPart: pathMeta.anchorPart,
                titleAttr: '',
                tail: tail,
            };
        }
        return null;
    }

    static parseLinkPath(rawPath) {
        const value = String(rawPath || '');
        const titleMatch = value.match(/\s+("[^"]*"|'[^']*')$/);
        const titleAttr = titleMatch ? titleMatch[0] : '';
        const cleanValue = titleAttr ? value.slice(0, value.length - titleAttr.length) : value;
        const anchorIndex = cleanValue.indexOf('#');
        return {
            pathPart: anchorIndex >= 0 ? cleanValue.substring(0, anchorIndex) : cleanValue,
            anchorPart: anchorIndex >= 0 ? cleanValue.substring(anchorIndex) : '',
            titleAttr: titleAttr,
        };
    }

    static rebuildLinkToken(token, nextPathPart) {
        const nextFullPath = nextPathPart + (token.anchorPart || '') + (token.titleAttr || '');
        if (token.kind === 'markdown-image' || token.kind === 'markdown-link') {
            return token.prefix + nextFullPath + token.suffix;
        }
        if (token.kind === 'html') {
            return token.raw.replace(/src=["'][^"']+["']/i, 'src="' + nextPathPart + (token.anchorPart || '') + '"');
        }
        if (token.kind === 'wiki') {
            return '[[' + nextPathPart + (token.anchorPart || '') + (token.tail || '') + ']]';
        }
        return token.raw;
    }

    static collectLinkedAssetRefs(content) {
        const refs = [];
        ExportService.transformLinkTargets(content, function (token) {
            if (token && token.pathPart) refs.push(token);
            return null;
        });
        return refs;
    }

    // Phase 2: pack filtering is driven by the packOptions.typeMode dropdown.
    //   typeMode='all'    → pack every referenced asset
    //   typeMode='custom' → pack only files whose extension is on the
    //                       comma-separated whitelist (case-insensitive,
    //                       leading dot optional, empty list packs nothing).
    // Legacy callers that pass an `assetType` string as the first argument
    // are handled via the first-arg-is-not-a-path heuristic so existing
    // tests and external call sites keep working until Phase 2 rollout is
    // complete.
    static shouldPackAsset(filePath, linkHandlingMode, packOptions) {
        if (ExportService.normalizeLinkHandlingMode(linkHandlingMode) !== 'pack-linked') return false;
        const opts = packOptions || {};
        const typeMode = ExportService.normalizePackTypeMode(opts.typeMode);
        if (typeMode === 'all') return true;
        const extensions = Array.isArray(opts.extensions)
            ? opts.extensions
            : ExportService.normalizePackCustomExtensions(opts.extensions || '');
        if (!extensions.length) return false;
        const ext = ExportService.getFileExtension(String(filePath || ''));
        return ext ? extensions.indexOf(ext) >= 0 : false;
    }

    static getAssetType(filePath) {
        const lower = String(filePath || '').toLowerCase();
        const ext = ExportService.getFileExtension(lower);
        if (ext === '.md') return 'markdown';
        const registry = ExportService.getFileFormatRegistry();
        if (registry && typeof registry.getAssetType === 'function') {
            const assetType = registry.getAssetType(filePath);
            if (assetType) return assetType;
        }
        if (['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp', '.ico', '.avif', '.heic', '.heif'].indexOf(ext) >= 0) return 'image';
        if (['.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v'].indexOf(ext) >= 0) return 'video';
        if (['.mp3', '.wav', '.ogg', '.flac', '.m4a', '.aac'].indexOf(ext) >= 0) return 'audio';
        if (['.pdf', '.doc', '.docx', '.odt', '.epub', '.ppt', '.pptx', '.xls', '.xlsx', '.csv', '.txt', '.rtf'].indexOf(ext) >= 0) return 'document';
        return 'file';
    }

    // ── Embed transforms ────────────────────────────────────────────────

    static transformEmbedsForExport(content, mode) {
        const normalizedMode = mode === 'iframe' ? 'iframe' : ExportService.normalizeEmbedHandling(mode);
        const imagePattern = /!\[([^\]]*)\]\(([^)\s"]+)(?:\s+"([^"]*)")?\)(\{[^}]+\})?/g;
        return String(content || '').replace(imagePattern, function (match, alt, url, title, attrsBlock) {
            const attrs = ExportService.parseAttributeBlock(attrsBlock);
            const hasEmbedClass = attrs.class && attrs.class.indexOf('embed') >= 0;
            const hasEmbedAttr = Object.prototype.hasOwnProperty.call(attrs, 'embed');
            const isKnownEmbed = ExportService.isKnownExternalEmbedUrl(url);
            if (!hasEmbedClass && !hasEmbedAttr && !isKnownEmbed) {
                return match;
            }

            if (normalizedMode === 'remove') {
                return '';
            }

            const fallbackPath = attrs.fallback || (ExportService.looksLikeImagePath(alt) ? alt : '');
            const displayTitle = title || attrs.title || (alt && !ExportService.looksLikeImagePath(alt) ? alt : '');

            if (normalizedMode === 'iframe') {
                const width = attrs.width || '100%';
                const height = attrs.height || '500px';
                const titleHtml = displayTitle ? '<p><em>' + ExportService.escapeHtml(displayTitle) + '</em></p>\n' : '';
                return titleHtml + '<iframe src="' + ExportService.escapeHtml(url) + '" width="' + ExportService.escapeHtml(width) + '" height="' + ExportService.escapeHtml(height) + '" frameborder="0" allowfullscreen></iframe>';
            }

            if (normalizedMode === 'fallback' && fallbackPath) {
                const labelPrefix = displayTitle ? '**' + displayTitle + '**\n>\n> ' : '';
                return '![](' + fallbackPath + ')\n\n> ' + labelPrefix + '[' + url + '](' + url + ')';
            }

            const urlPrefix = displayTitle ? '**' + displayTitle + '**\n>\n> ' : '';
            return '> ' + urlPrefix + '[' + url + '](' + url + ')';
        });
    }

    static parseAttributeBlock(attrString) {
        const attrs = {};
        if (!attrString) return attrs;
        const content = String(attrString).replace(/^\{|\}$/g, '').trim();
        const classMatches = content.match(/\.(\w[\w-]*)/g);
        if (classMatches) {
            attrs.class = classMatches.map(function (entry) { return entry.slice(1); }).join(' ');
        }
        const idMatch = content.match(/#(\w[\w-]*)/);
        if (idMatch) attrs.id = idMatch[1];
        const kvPattern = /(\w[\w-]*)=["']?([^"'\s}]+)["']?/g;
        let match;
        while ((match = kvPattern.exec(content)) !== null) {
            attrs[match[1]] = match[2];
        }
        return attrs;
    }

    static isKnownExternalEmbedUrl(url) {
        if (!ExportService.isUrl(url)) return false;
        try {
            const parsed = new URL(url);
            const hostPath = (parsed.host + parsed.pathname).toLowerCase();
            for (let i = 0; i < KNOWN_EXTERNAL_EMBED_PATTERNS.length; i++) {
                const pattern = KNOWN_EXTERNAL_EMBED_PATTERNS[i].toLowerCase();
                const regex = new RegExp('^' + ExportService.escapeRegex(pattern).replace(/\\\*/g, '[^/]+'));
                if (regex.test(hostPath)) return true;
            }
        } catch (err) {
            return false;
        }
        return false;
    }

    static looksLikeImagePath(value) {
        const lower = String(value || '').toLowerCase();
        return ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp', '.ico', '.avif'].some(function (ext) {
            return lower.slice(-ext.length) === ext;
        });
    }

    // ── Path helpers ────────────────────────────────────────────────────

    static generateExportPath(targetFolder, folderName, ext) {
        const folder = targetFolder || '';
        const name = folderName || 'export';
        const sep = folder.indexOf('\\') >= 0 ? '\\' : '/';
        return folder + sep + name + sep + name + ext;
    }

    static getExtensionForFormat(format, marpFormat, pandocFormat) {
        if (format === 'presentation') {
            switch (marpFormat) {
                case 'pdf': return '.pdf';
                case 'pptx': return '.pptx';
                case 'html': return '.html';
                default: return '.md';
            }
        }
        if (format === 'document') {
            switch (pandocFormat) {
                case 'docx': return '.docx';
                case 'odt': return '.odt';
                case 'epub': return '.epub';
                default: return '.md';
            }
        }
        return '.md';
    }

    static normalizeEmbedHandling(value) {
        const normalized = String(value || '').trim().toLowerCase();
        if (normalized === 'fallback' || normalized === 'remove') return normalized;
        return 'url';
    }

    static normalizeMarpBrowser(value) {
        const normalized = String(value || '').trim().toLowerCase();
        if (normalized === 'edge' || normalized === 'firefox' || normalized === 'auto') return normalized;
        return 'chrome';
    }

    static normalizeIncludeHandling(value) {
        const normalized = String(value == null ? '' : value).trim().toLowerCase();
        if (normalized === 'strip' || normalized === 'merge' || normalized === 'keep') return normalized;
        if (normalized === 'true') return 'strip';
        if (normalized === 'false') return 'keep';
        return 'keep';
    }

    static normalizeMergeIncludesMaxDepth(value) {
        const parsed = parseInt(String(value == null ? '' : value).trim(), 10);
        if (!isFinite(parsed) || parsed < 1) return 10;
        if (parsed > 50) return 50;
        return parsed;
    }

    // Phase 2 contract: two modes only. Legacy values migrate transparently
    // so older stored prefs and external callers keep working.
    //   pack-all / pack-linked   → pack-linked
    //   rewrite-only / no-modify → rewrite-relative
    static normalizeLinkHandlingMode(value) {
        const normalized = String(value || '').trim().toLowerCase();
        if (normalized === 'pack-linked' || normalized === 'pack-all') return 'pack-linked';
        return 'rewrite-relative';
    }

    static normalizePackTypeMode(value) {
        return String(value || '').trim().toLowerCase() === 'custom' ? 'custom' : 'all';
    }

    static normalizePackCustomExtensions(value) {
        if (Array.isArray(value)) {
            // Already parsed. Re-normalize for consistency.
            return ExportService.normalizePackCustomExtensions(value.join(','));
        }
        const raw = String(value == null ? '' : value);
        const parts = raw.split(/[,\s;]+/);
        const seen = Object.create(null);
        const out = [];
        for (let i = 0; i < parts.length; i++) {
            let t = parts[i].trim().toLowerCase();
            if (!t) continue;
            if (t.charAt(0) !== '.') t = '.' + t;
            if (seen[t]) continue;
            seen[t] = true;
            out.push(t);
        }
        return out;
    }

    static normalizePackFileSizeLimit(value) {
        const parsed = parseInt(String(value == null ? '' : value).trim(), 10);
        if (!isFinite(parsed) || parsed < 1) return 100;
        if (parsed > 1000) return 1000;
        return parsed;
    }

    static normalizePathKey(path) {
        return ExportService.toForwardSlashes(path).replace(/\/+$/, '').toLowerCase();
    }

    static toForwardSlashes(path) {
        return String(path || '').replace(/\\/g, '/');
    }

    static isUrl(path) {
        return /^(https?:\/\/|ftp:\/\/|mailto:)/i.test(String(path || ''));
    }

    static isAbsolutePath(path) {
        const value = String(path || '');
        return value.indexOf('/') === 0 || /^[a-zA-Z]:[\\/]/.test(value) || /^\\\\/.test(value);
    }

    static normalizePath(path) {
        const raw = ExportService.toForwardSlashes(path);
        const driveMatch = raw.match(/^[a-zA-Z]:/);
        const drive = driveMatch ? driveMatch[0] : '';
        const isAbs = raw.indexOf('/') === 0 || !!drive || raw.indexOf('//') === 0;
        const trimmed = raw.replace(/^[a-zA-Z]:/, '');
        const parts = trimmed.split('/');
        const stack = [];
        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            if (!part || part === '.') continue;
            if (part === '..') {
                if (stack.length && stack[stack.length - 1] !== '..') stack.pop();
                else if (!isAbs) stack.push('..');
                continue;
            }
            stack.push(part);
        }
        let prefix = '';
        if (drive) prefix = drive + '/';
        else if (isAbs) prefix = '/';
        return prefix + stack.join('/');
    }

    static dirnamePath(path) {
        const normalized = ExportService.normalizePath(path);
        if (!normalized) return '';
        if (normalized === '/' || /^[a-zA-Z]:\/$/.test(normalized)) return normalized;
        const trimmed = normalized.replace(/\/+$/, '');
        const idx = trimmed.lastIndexOf('/');
        if (idx < 0) return '';
        if (idx === 0) return '/';
        return trimmed.substring(0, idx);
    }

    static basename(path) {
        const normalized = ExportService.normalizePath(path).replace(/\/+$/, '');
        const idx = normalized.lastIndexOf('/');
        return idx >= 0 ? normalized.substring(idx + 1) : normalized;
    }

    static basenameWithoutExtension(path) {
        const name = ExportService.basename(path);
        const idx = name.lastIndexOf('.');
        return idx > 0 ? name.substring(0, idx) : name;
    }

    static getFileExtension(path) {
        const name = ExportService.basename(path).toLowerCase();
        const idx = name.lastIndexOf('.');
        return idx >= 0 ? name.substring(idx) : '';
    }

    static joinPath() {
        const parts = Array.prototype.slice.call(arguments).filter(function (part) {
            return part != null && part !== '';
        });
        if (!parts.length) return '';
        let joined = String(parts[0]);
        for (let i = 1; i < parts.length; i++) {
            joined = joined.replace(/[\\/]+$/, '') + '/' + String(parts[i]).replace(/^[\\/]+/, '');
        }
        return ExportService.normalizePath(joined);
    }

    static resolvePath(baseDir, relativePath) {
        if (!relativePath) return ExportService.normalizePath(baseDir || '');
        if (ExportService.isAbsolutePath(relativePath)) return ExportService.normalizePath(relativePath);
        return ExportService.normalizePath(ExportService.joinPath(baseDir || '', relativePath));
    }

    static relativePath(fromDir, toPath) {
        const fromNorm = ExportService.normalizePath(fromDir || '');
        const toNorm = ExportService.normalizePath(toPath || '');
        const fromDrive = (fromNorm.match(/^[a-zA-Z]:/) || [''])[0].toLowerCase();
        const toDrive = (toNorm.match(/^[a-zA-Z]:/) || [''])[0].toLowerCase();
        if (fromDrive && toDrive && fromDrive !== toDrive) {
            return ExportService.toForwardSlashes(toNorm);
        }

        const fromParts = fromNorm.replace(/^[a-zA-Z]:\//, '').replace(/^\//, '').split('/').filter(Boolean);
        const toParts = toNorm.replace(/^[a-zA-Z]:\//, '').replace(/^\//, '').split('/').filter(Boolean);
        let i = 0;
        while (i < fromParts.length && i < toParts.length && fromParts[i] === toParts[i]) i++;
        const up = new Array(Math.max(0, fromParts.length - i)).fill('..');
        const down = toParts.slice(i);
        const result = up.concat(down).join('/');
        return result || '.';
    }

    static allocateUniqueTargetName(fileName, usedNames) {
        const name = String(fileName || 'asset');
        const lower = name.toLowerCase();
        if (!usedNames[lower]) {
            usedNames[lower] = 1;
            return name;
        }
        const ext = ExportService.getFileExtension(name);
        const base = ext ? name.slice(0, -ext.length) : name;
        let index = usedNames[lower];
        let candidate = base + '-' + index + ext;
        while (usedNames[candidate.toLowerCase()]) {
            index++;
            candidate = base + '-' + index + ext;
        }
        usedNames[lower] = index + 1;
        usedNames[candidate.toLowerCase()] = 1;
        return candidate;
    }

    static escapeRegex(value) {
        return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    static escapeHtml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
}

window.ExportService = ExportService;
