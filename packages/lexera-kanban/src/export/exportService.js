/**
 * Export Service — main export orchestrator for lexera-kanban.
 *
 * 3-phase pipeline:
 *   Phase 1 (Extract):   REST API call to backend based on export format
 *   Phase 2 (Transform): Content transforms via REST + local embed transforms
 *   Phase 3 (Output):    Copy / save file / preview via Tauri commands
 */

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
            lexeraLog('info', '[ExportService] Starting export ' + options.format + ' ' + options.mode);

            const extracted = await ExportService._extract(options);
            if (!extracted) {
                return { success: false, message: 'Phase 1 (Extract) returned no content' };
            }

            const transformed = await ExportService._transform(extracted, options);
            return await ExportService._output(transformed, options);
        } catch (err) {
            lexeraLog('error', '[ExportService] Export failed: ' + (err.message || String(err)));
            return { success: false, message: err.message || String(err) };
        }
    }

    static async checkMarpStatus() {
        const result = await window.__TAURI__.core.invoke('check_marp_available');
        return { available: result.available, version: result.version || null };
    }

    static async checkPandocStatus() {
        const result = await window.__TAURI__.core.invoke('check_pandoc_available');
        return { available: result.available, version: result.version || null };
    }

    static async getMarpThemes(dirs) {
        return await window.__TAURI__.core.invoke('discover_marp_themes', { dirs: dirs || [] });
    }

    static async getMarpClasses(dirs) {
        return await window.__TAURI__.core.invoke('discover_marp_classes', { dirs: dirs || [] });
    }

    static async stopAllWatches() {
        return await window.__TAURI__.core.invoke('marp_stop_all_watches');
    }

    static async openExportFolder(path) {
        await window.__TAURI__.core.invoke('open_export_folder', { path });
    }

    // ── Phase 1: Extract ────────────────────────────────────────────────

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
                columnIds: options.columnIds || [],
                columnIndexes: options.columnIndexes || [],
            };
        } else if (options.format === 'document') {
            endpoint = url + '/boards/' + boardId + '/export/document';
            body = {
                tagVisibility: options.tagVisibility || 'all',
                excludeTags: options.excludeTags || [],
                stripIncludes: options.stripIncludes || false,
                pageBreaks: options.documentPageBreaks || 'continuous',
                columnIds: options.columnIds || [],
                columnIndexes: options.columnIndexes || [],
            };
        } else {
            endpoint = url + '/boards/' + boardId + '/export/filter';
            body = {
                tagVisibility: options.tagVisibility || 'all',
                excludeTags: options.excludeTags || [],
                columnIds: options.columnIds || [],
                columnIndexes: options.columnIndexes || [],
            };
        }

        lexeraLog('info', '[ExportService] Phase 1: POST ' + endpoint);

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

    static async _transform(content, options) {
        if (options.format !== 'presentation') return content;

        const speakerNoteMode = options.speakerNoteMode || 'comment';
        const htmlCommentMode = options.htmlCommentMode || 'keep';
        const htmlContentMode = options.htmlContentMode || 'keep';
        const needsRestTransform = !(speakerNoteMode === 'comment' && htmlCommentMode === 'keep' && htmlContentMode === 'keep');

        let transformed = content;

        if (needsRestTransform) {
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

            lexeraLog('info', '[ExportService] Phase 2: POST ' + endpoint);

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
            transformed = data.content || content;
        }

        return ExportService.applyLocalPresentationTransforms(transformed, options);
    }

    static applyLocalPresentationTransforms(content, options) {
        if (!options || options.format !== 'presentation' || (options.mode || 'copy') === 'copy') {
            return content;
        }
        const embedMode = ExportService.resolveEmbedExportMode(options);
        if (!embedMode) return content;
        return ExportService.transformEmbedsForExport(content, embedMode);
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
            lexeraLog('info', '[ExportService] Phase 3: copy (' + content.length + ' chars)');
            return { success: true, content, message: 'Content ready for clipboard' };
        }

        const createdFiles = [];

        try {
            const mdPath = ExportService.generateExportPath(
                options.targetFolder,
                options.exportFolderName,
                '.md'
            );
            const prepared = await ExportService.prepareContentForOutput(content, options, mdPath);
            const finalContent = prepared && typeof prepared.content === 'string' ? prepared.content : content;
            if (prepared && Array.isArray(prepared.createdFiles)) {
                Array.prototype.push.apply(createdFiles, prepared.createdFiles);
            }

            lexeraLog('info', '[ExportService] Phase 3: writing markdown to ' + mdPath);
            await window.__TAURI__.core.invoke('write_export_file', { path: mdPath, content: finalContent });
            createdFiles.push(mdPath);

            if (mode === 'preview') {
                lexeraLog('info', '[ExportService] Phase 3: starting Marp preview');
                const watchResult = await window.__TAURI__.core.invoke('marp_watch', {
                    opts: {
                        inputPath: mdPath,
                        format: 'html',
                        outputPath: '',
                        theme: options.marpTheme || null,
                        themeDirs: null,
                        enginePath: null,
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
                    message: watchResult.message || 'Preview started',
                };
            }

            if (options.runMarp && options.format === 'presentation' && options.marpFormat !== 'markdown') {
                const marpOutputPath = ExportService.generateExportPath(
                    options.targetFolder,
                    options.exportFolderName,
                    '.' + options.marpFormat
                );

                lexeraLog('info', '[ExportService] Phase 3: running Marp export to ' + marpOutputPath);
                const marpResult = await window.__TAURI__.core.invoke('marp_export', {
                    opts: {
                        inputPath: mdPath,
                        format: options.marpFormat,
                        outputPath: marpOutputPath,
                        enginePath: null,
                        theme: options.marpTheme || null,
                        themeDirs: null,
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
                };
            }

            if (options.runPandoc && options.format === 'document') {
                const pandocOutputPath = ExportService.generateExportPath(
                    options.targetFolder,
                    options.exportFolderName,
                    '.' + options.pandocFormat
                );

                lexeraLog('info', '[ExportService] Phase 3: running Pandoc export to ' + pandocOutputPath);
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

            return { success: true, exportedPath: mdPath, message: 'Markdown file saved' };
        } catch (err) {
            if (createdFiles.length > 0) {
                lexeraLog('warn', '[ExportService] Cleaning up partial output: ' + createdFiles.join(', '));
                try {
                    await window.__TAURI__.core.invoke('remove_export_files', { paths: createdFiles });
                } catch (cleanupErr) {
                    lexeraLog('error', '[ExportService] Cleanup failed: ' + (cleanupErr.message || String(cleanupErr)));
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
        const packedFolderPrefix = fileBasename + '-Media/';
        const linkHandlingMode = ExportService.normalizeLinkHandlingMode(options.linkHandlingMode);
        let nextContent = content;
        let createdFiles = [];

        if (ExportService.shouldRenderFileEmbedsForExport(options)) {
            const renderedEmbeds = await ExportService.renderFileEmbedsForExport(
                nextContent,
                sourceFilePath,
                exportDir,
                fileBasename
            );
            nextContent = renderedEmbeds.content;
            if (renderedEmbeds.createdFiles.length > 0) {
                createdFiles = createdFiles.concat(renderedEmbeds.createdFiles);
            }
        }

        if (options.packAssets && (linkHandlingMode === 'pack-linked' || linkHandlingMode === 'pack-all')) {
            const plan = ExportService.prepareAssetPackingPlan(nextContent, sourceFilePath, exportDir, fileBasename, linkHandlingMode, options.packOptions, packedFolderPrefix);
            if (plan.items.length > 0) {
                const results = await window.__TAURI__.core.invoke('copy_export_assets', { items: plan.items });
                const packed = ExportService.applyPackedAssetResults(nextContent, plan, results);
                nextContent = packed.content;
                createdFiles = createdFiles.concat(packed.createdFiles);
            }
        }

        if (linkHandlingMode !== 'no-modify') {
            nextContent = ExportService.rewriteLinksForExport(nextContent, sourceFilePath, mdPath, packedFolderPrefix);
        }

        return {
            content: nextContent,
            createdFiles,
        };
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

    static async renderFileEmbedsForExport(content, sourceFilePath, exportDir, fileBasename) {
        const registry = ExportService.getFileFormatRegistry();
        if (!registry || !window.__TAURI__ || !window.__TAURI__.core || typeof window.__TAURI__.core.invoke !== 'function') {
            return { content, createdFiles: [] };
        }

        const protectedCode = ExportService.protectCodeBlocks(content);
        const sourceDir = ExportService.dirnamePath(sourceFilePath);
        const imagePattern = /!\[([^\]]*)\]\(([^)]+)\)(\{[^}]+\})?/g;
        const matches = [];
        const jobs = {};
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
            if (!plugin || !registry.getExportRenderConfig) {
                continue;
            }

            const attrs = ExportService.parseAttributeBlock(attrsBlock);
            const pageNumber = ExportService.resolvePluginRenderPageNumber(pathMeta.anchorPart, attrs);
            const renderConfig = registry.getExportRenderConfig(filePath, { pageNumber: pageNumber });
            if (!renderConfig || renderConfig.supportsRuntimeRender === false) {
                continue;
            }

            const absoluteSourcePath = ExportService.isAbsolutePath(filePath)
                ? ExportService.normalizePath(filePath)
                : ExportService.resolvePath(sourceDir, filePath);
            const relativeTarget = ExportService.buildRenderedEmbedTargetRelativePath(fileBasename, absoluteSourcePath, plugin, renderConfig);
            const absoluteTarget = ExportService.joinPath(exportDir, relativeTarget);
            const jobKey = plugin.id + '::' + ExportService.normalizePathKey(absoluteSourcePath) + '::' + String(renderConfig.outputFormat || '') + '::' + String(pageNumber || 1);

            if (!jobs[jobKey]) {
                jobs[jobKey] = {
                    key: jobKey,
                    pluginId: plugin.id,
                    sourcePath: absoluteSourcePath,
                    targetPath: absoluteTarget,
                    relativeTarget: relativeTarget,
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

        for (let i = 0; i < jobList.length; i++) {
            const job = jobList[i];
            try {
                const result = await window.__TAURI__.core.invoke('render_embedded_file', {
                    opts: {
                        pluginId: job.pluginId,
                        sourcePath: job.sourcePath,
                        targetPath: job.targetPath,
                        pageNumber: job.pageNumber,
                        outputFormat: job.outputFormat,
                    },
                });
                if (result && result.success) {
                    renderedTargets[job.key] = job.relativeTarget;
                    createdFiles.push(job.targetPath);
                } else {
                    lexeraLog('warn', '[ExportService] Rendered embed export skipped for ' + job.sourcePath + ': ' + ((result && result.error) || 'unknown renderer failure'));
                }
            } catch (err) {
                lexeraLog('warn', '[ExportService] Rendered embed export failed for ' + job.sourcePath + ': ' + (err && err.message ? err.message : String(err)));
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
            const assetType = ExportService.getAssetType(absoluteSource);
            if (!ExportService.shouldPackAsset(assetType, linkHandlingMode, packOptions)) {
                continue;
            }

            const sourceKey = ExportService.normalizePathKey(absoluteSource);
            if (!sourceMap[sourceKey]) {
                const fileName = ExportService.basename(absoluteSource) || 'asset';
                const uniqueName = ExportService.allocateUniqueTargetName(fileName, usedNames);
                const relativeTarget = fileBasename + '-Media/' + uniqueName;
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

    static shouldPackAsset(assetType, linkHandlingMode, packOptions) {
        if (linkHandlingMode === 'pack-linked') return true;
        const opts = packOptions || {};
        switch (assetType) {
            case 'markdown': return !!opts.includeFiles;
            case 'image': return !!opts.includeImages;
            case 'video': return !!opts.includeVideos;
            case 'audio': return !!opts.includeOtherMedia;
            case 'document': return !!opts.includeDocuments;
            case 'diagram': return !!opts.includeImages;
            case 'file': return !!opts.includeFiles;
            default: return false;
        }
    }

    static getAssetType(filePath) {
        const lower = String(filePath || '').toLowerCase();
        const ext = ExportService.getFileExtension(lower);
        if (ext === '.md') return 'markdown';
        if (ext === '.drawio' || ext === '.dio' || ext === '.excalidraw' || lower.indexOf('.excalidraw.json') >= 0 || lower.indexOf('.excalidraw.svg') >= 0) return 'diagram';
        const registry = ExportService.getFileFormatRegistry();
        if (registry && typeof registry.findByFilePath === 'function') {
            const plugin = registry.findByFilePath(filePath);
            if (plugin && plugin.preview && plugin.preview.kind === 'diagram') return 'diagram';
            if (plugin && (plugin.id === 'pdf' || plugin.id === 'document' || plugin.id === 'epub' || plugin.id === 'xlsx')) return 'document';
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

    static normalizeLinkHandlingMode(value) {
        const normalized = String(value || '').trim().toLowerCase();
        if (normalized === 'pack-linked' || normalized === 'pack-all' || normalized === 'no-modify') return normalized;
        if (normalized === 'dont-modify') return 'no-modify';
        return 'rewrite-only';
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
