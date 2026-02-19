/**
 * LinkReplacementService - Unified link/path replacement logic
 *
 * Consolidates path replacement functionality that was duplicated between:
 * - PathCommands._replacePaths (mature, file-based implementation)
 * - LinkReplacementHandler (simpler, board-based implementation)
 *
 * This service handles:
 * - Single and batch path replacement
 * - Include file support with context-aware base paths
 * - Path encoding variants (URL encoded, decoded, with/without ./)
 * - Undo state capture
 * - Targeted webview updates
 *
 * @module services/LinkReplacementService
 */

import * as path from 'path';
import * as fs from 'fs';
import { MarkdownFile } from '../files/MarkdownFile';
import { MarkdownFileRegistry } from '../files/MarkdownFileRegistry';
import { BoardStore, UndoCapture, ResolvedTarget } from '../core/stores';
import { WebviewBridge } from '../core/bridge/WebviewBridge';
import { KanbanBoard, KanbanColumn, KanbanCard } from '../markdownParser';
import { LinkOperations, MARKDOWN_PATH_PATTERN, extractPathFromMatch } from '../utils/linkOperations';
import { encodeFilePath, safeDecodeURIComponent, normalizeDirForComparison, escapeRegExp } from '../utils/stringUtils';
import { showInfo, showWarning } from './NotificationService';
import { logger } from '../utils/logger';
import { PathFormat } from './FileSearchWebview';
import { extractIncludeFiles } from '../constants/IncludeConstants';

/**
 * Options for path replacement operations
 */
export interface ReplacementOptions {
    /** 'single' for one path, 'batch' for all paths in same directory */
    mode: 'single' | 'batch';
    /** How to format the new path */
    pathFormat: PathFormat;
    /** Task ID for targeted updates */
    cardId?: string;
    /** Column ID for targeted updates */
    columnId?: string;
    /** Whether the path is in a column title */
    isColumnTitle?: boolean;
    /** Link index for specific occurrence */
    linkIndex?: number;
    /** Custom success message */
    successMessage?: string;
}

/**
 * Result of a replacement operation
 */
export interface ReplacementResult {
    success: boolean;
    replaced: boolean;
    count: number;
    oldPath?: string;
    newPath?: string;
    error?: string;
}

/**
 * Information about a path that needs replacement
 */
interface PathReplacement {
    oldPath: string;
    decodedOldPath: string;
    newAbsolutePath: string;
    sourceFile: MarkdownFile;
}

/**
 * Parameters for include switch operations
 */
export interface IncludeSwitchParams {
    cardId?: string;
    columnId?: string;
    oldFiles: string[];
    newFiles: string[];
    newTitle: string;
}

/**
 * Dependencies required for replacement operations
 */
export interface ReplacementDependencies {
    fileRegistry: MarkdownFileRegistry;
    boardStore: BoardStore;
    webviewBridge: WebviewBridge;
    getBoard: () => KanbanBoard | undefined;
    invalidateCache: () => void;
    /** Optional callback for handling include file switches */
    handleIncludeSwitch?: (params: IncludeSwitchParams) => Promise<void>;
    /** Optional callback to refresh the board after changes */
    refreshBoard?: () => Promise<void>;
}

/**
 * LinkReplacementService - Handles all link/path replacement operations
 */
export class LinkReplacementService {
    /**
     * Replace a broken path with a new path
     *
     * @param brokenPath - The path that needs to be replaced
     * @param newPath - The new path (absolute path to replacement file)
     * @param basePath - Base directory for resolving relative paths
     * @param deps - Required dependencies
     * @param options - Replacement options
     */
    public async replacePath(
        brokenPath: string,
        newPath: string,
        basePath: string,
        deps: ReplacementDependencies,
        options: ReplacementOptions
    ): Promise<ReplacementResult> {
        logger.debug('[LinkReplacementService.replacePath] START', {
            brokenPath,
            newPath,
            basePath,
            mode: options.mode,
            cardId: options.cardId,
            columnId: options.columnId
        });

        const mainFile = deps.fileRegistry.getMainFile();
        if (!mainFile) {
            return { success: false, replaced: false, count: 0, error: 'No main file found' };
        }

        const allFiles: MarkdownFile[] = [mainFile, ...deps.fileRegistry.getIncludeFiles()];
        const board = deps.getBoard();

        // Resolve context base path
        const contextBasePath = options.mode === 'single'
            ? this._resolveContextBasePath(board, basePath, options.cardId, options.columnId, options.isColumnTitle)
            : basePath;

        // Find paths to replace
        let replacements: Map<string, PathReplacement>;

        if (options.mode === 'single') {
            const variants = this._generatePathVariants(brokenPath);
            replacements = this._findSinglePath(variants, allFiles, newPath, board, options);
        } else {
            const newDir = path.dirname(newPath);
            replacements = this._findBatchPaths(brokenPath, contextBasePath, allFiles, newDir);
        }

        // Save undo entry AFTER we know all affected paths (for batch undo support)
        if (board && replacements.size > 0) {
            const undoEntry = this._createUndoEntry(board, replacements, options);
            deps.boardStore.saveUndoEntry(undoEntry);
        }

        if (replacements.size === 0) {
            if (options.mode === 'batch') {
                showWarning('No matching paths found to replace.');
                return { success: true, replaced: false, count: 0 };
            }
            return { success: false, replaced: false, count: 0, error: 'Path not found in any file' };
        }

        // Execute replacements
        let filesToModify: MarkdownFile[];
        if (options.mode === 'single') {
            const firstReplacement = replacements.values().next().value;
            filesToModify = firstReplacement ? [firstReplacement.sourceFile] : [];
        } else {
            filesToModify = allFiles;
        }

        const modifiedFiles = this._executeReplacements(replacements, filesToModify, options.pathFormat);

        if (modifiedFiles.length === 0 && replacements.size > 0) {
            logger.warn('[LinkReplacementService.replacePath] Replacements found but no files were modified', {
                replacementCount: replacements.size,
                filesToModifyCount: filesToModify.length,
                replacementKeys: Array.from(replacements.keys())
            });
        }

        // Apply board updates
        await this._applyBoardUpdates(deps, board, modifiedFiles, mainFile, replacements, options);

        // Calculate result path — use the replacement for the actual broken path,
        // not just the first Map entry (which could be an unrelated file in the
        // same directory that doesn't need fixing).
        const brokenPathReplacement = replacements.get(brokenPath)
            || Array.from(replacements.values()).find(r =>
                r.decodedOldPath === safeDecodeURIComponent(brokenPath)
            );
        const notificationReplacement = brokenPathReplacement || replacements.values().next().value;
        const resultNewPath = notificationReplacement ? this._computeReplacementPath(
            notificationReplacement.oldPath,
            notificationReplacement.newAbsolutePath,
            path.dirname(mainFile.getPath()),
            options.pathFormat
        ) : '';

        // Send notifications
        if (notificationReplacement) {
            deps.webviewBridge.send({
                type: 'pathReplaced',
                originalPath: brokenPath,
                actualPath: notificationReplacement.oldPath,
                newPath: resultNewPath,
                cardId: options.cardId,
                columnId: options.columnId
            });
        }

        // Show success message
        const message = options.mode === 'batch'
            ? `Replaced ${replacements.size} path${replacements.size > 1 ? 's' : ''}`
            : options.successMessage || 'Path updated';
        showInfo(message);

        return {
            success: true,
            replaced: true,
            count: replacements.size,
            oldPath: brokenPath,
            newPath: resultNewPath
        };
    }

    // ============= PRIVATE HELPER METHODS =============

    /**
     * Resolve the context-aware base path for path resolution
     */
    private _resolveContextBasePath(
        board: KanbanBoard | null | undefined,
        basePath: string,
        cardId?: string,
        columnId?: string,
        isColumnTitle?: boolean
    ): string {
        if (!board) {
            return basePath;
        }

        const column = columnId ? board.columns.find((c: KanbanColumn) => c.id === columnId) : undefined;
        let includePath: string | undefined;

        if (isColumnTitle && column?.includeFiles?.length) {
            includePath = column.includeFiles[0];
        } else if (cardId && column) {
            const task = column.cards.find((t: KanbanCard) => t.id === cardId);
            includePath = task?.includeContext?.includeFilePath
                || task?.includeFiles?.[0]
                || column?.includeFiles?.[0];
        }

        if (!includePath) {
            return basePath;
        }

        const absoluteIncludePath = path.isAbsolute(includePath)
            ? includePath
            : path.resolve(basePath, includePath);
        return path.dirname(absoluteIncludePath);
    }

    /**
     * Create an undo entry with all affected targets for batch undo support.
     * In batch mode, this collects all tasks/columns that contain paths being replaced.
     * In single mode, it just captures the specified target.
     */
    private _createUndoEntry(
        board: KanbanBoard,
        replacements: Map<string, PathReplacement>,
        options: ReplacementOptions
    ): import('../core/stores').UndoEntry {
        // For single mode, use the existing targeted undo capture
        if (options.mode === 'single') {
            if (options.cardId && options.columnId) {
                return UndoCapture.forTask(board, options.cardId, options.columnId, 'path-replace');
            } else if (options.columnId) {
                return UndoCapture.forColumn(board, options.columnId, 'path-replace');
            }
            return UndoCapture.forFullBoard(board, 'path-replace');
        }

        // For batch mode, collect all affected targets from the board
        const targets: ResolvedTarget[] = [];
        const replacementPaths = Array.from(replacements.keys());
        const seenTargets = new Set<string>(); // Deduplicate targets

        for (const column of board.columns) {
            // Check column title
            const columnTitle = column.title || '';
            if (replacementPaths.some(p => columnTitle.includes(p))) {
                const key = `column:${column.id}`;
                if (!seenTargets.has(key)) {
                    seenTargets.add(key);
                    targets.push({ type: 'column', id: column.id });
                }
            }

            // Check tasks in this column
            for (const task of column.cards) {
                const taskContent = task.content || '';
                if (replacementPaths.some(p => taskContent.includes(p))) {
                    const key = `task:${task.id}`;
                    if (!seenTargets.has(key)) {
                        seenTargets.add(key);
                        targets.push({ type: 'card', id: task.id, columnId: column.id });
                    }
                }
            }
        }

        // If we found specific targets, use forMultiple for batch undo
        if (targets.length > 0) {
            return UndoCapture.forMultiple(board, targets, 'path-replace-batch');
        }

        // Fallback to full board undo
        return UndoCapture.forFullBoard(board, 'path-replace');
    }

    /**
     * Generate all possible variants of a path for matching
     */
    private _generatePathVariants(pathStr: string): string[] {
        if (!pathStr || typeof pathStr !== 'string' || pathStr.trim().length === 0) {
            return [];
        }

        const normalizeSlashes = (value: string) => value.replace(/\\/g, '/');
        const stripDotPrefix = (value: string) => value.startsWith('./') ? value.slice(2) : value;
        const addDotPrefix = (value: string) => {
            if (value.startsWith('./') || value.startsWith('/') || /^[a-zA-Z]:/.test(value)) {
                return value;
            }
            return './' + value;
        };
        const decodeHtmlEntities = (value: string) =>
            value.replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&amp;/g, '&');

        const pathVariants: string[] = [pathStr];

        // Add decoded version
        const decodedPath = safeDecodeURIComponent(pathStr);
        if (decodedPath !== pathStr) {
            pathVariants.push(decodedPath);
        }

        // Add encoded version
        const encodedPath = encodeFilePath(decodedPath);
        if (encodedPath !== pathStr && encodedPath !== decodedPath) {
            pathVariants.push(encodedPath);
        }

        // Expand with normalization transformations
        const expandedVariants: string[] = [];
        for (const variant of pathVariants) {
            if (!variant) continue;
            const normalized = normalizeSlashes(variant);
            const htmlDecoded = decodeHtmlEntities(normalized);
            const stripped = stripDotPrefix(htmlDecoded);
            const withDot = addDotPrefix(stripped);
            expandedVariants.push(variant, normalized, htmlDecoded, stripped, withDot);
        }

        return [...new Set(expandedVariants.filter(p => p))];
    }

    /**
     * Compute the replacement path based on format preference
     */
    private _computeReplacementPath(
        _oldPath: string,
        newAbsolutePath: string,
        fileBasePath: string,
        pathFormat: PathFormat
    ): string {
        let result: string;
        if (pathFormat === 'absolute') {
            result = newAbsolutePath;
        } else {
            // 'relative' or 'auto' - use relative
            result = path.relative(fileBasePath, newAbsolutePath);
        }
        logger.debug('[LinkReplacementService._computeReplacementPath]', {
            pathFormat,
            newAbsolutePath,
            fileBasePath,
            result
        });
        return result;
    }

    /**
     * Build the encoded replacement path, preserving the original filename exactly.
     * Only the directory portion is re-encoded; the filename stays as it appeared
     * in the markdown to avoid changing e.g. spaces, parens, or unicode encoding.
     *
     * @param newRelativePath - The computed new relative (or absolute) path (decoded)
     * @param originalPathInMarkdown - The path string as it appeared in the markdown
     */
    private _buildEncodedPath(newRelativePath: string, originalPathInMarkdown: string): string {
        // Extract the original filename exactly as it appeared in markdown
        const normalized = originalPathInMarkdown.replace(/\\/g, '/');
        const lastSlash = normalized.lastIndexOf('/');
        const originalFilename = lastSlash >= 0
            ? originalPathInMarkdown.substring(lastSlash + 1)
            : originalPathInMarkdown;

        // Compute the new directory portion (everything except the filename)
        const newBasename = path.basename(newRelativePath);
        const newDirPortion = newRelativePath.slice(0, newRelativePath.length - newBasename.length);

        // Encode only the directory portion, then append the preserved filename
        if (!newDirPortion) {
            return originalFilename;
        }
        // Strip trailing separator before encoding, then add it back
        const dirToEncode = newDirPortion.replace(/[/\\]+$/, '');
        const encodedDir = encodeFilePath(dirToEncode);
        return encodedDir + '/' + originalFilename;
    }

    /**
     * Find a single path in the files
     */
    private _findSinglePath(
        variants: string[],
        files: MarkdownFile[],
        newAbsolutePath: string,
        board: KanbanBoard | null | undefined,
        options: ReplacementOptions
    ): Map<string, PathReplacement> {
        const replacements = new Map<string, PathReplacement>();

        // Strategy 1: Search in board structure first
        if (board && (options.cardId || options.columnId)) {
            const column = options.columnId
                ? board.columns.find((c: KanbanColumn) => c.id === options.columnId)
                : undefined;

            let textToSearch = '';
            if (options.isColumnTitle && column) {
                textToSearch = column.title || '';
            } else if (options.cardId && column) {
                const task = column.cards.find((t: KanbanCard) => t.id === options.cardId);
                if (task) {
                    textToSearch = task.content || '';
                }
            }

            for (const variant of variants) {
                if (textToSearch.includes(variant)) {
                    for (const file of files) {
                        if (file.getContent().includes(variant)) {
                            replacements.set(variant, {
                                oldPath: variant,
                                decodedOldPath: safeDecodeURIComponent(variant),
                                newAbsolutePath,
                                sourceFile: file
                            });
                            return replacements;
                        }
                    }
                }
            }
        }

        // Strategy 2: Fall back to file content search
        for (const file of files) {
            const content = file.getContent();
            for (const variant of variants) {
                if (content.includes(variant)) {
                    replacements.set(variant, {
                        oldPath: variant,
                        decodedOldPath: safeDecodeURIComponent(variant),
                        newAbsolutePath,
                        sourceFile: file
                    });
                    return replacements;
                }
            }
        }

        // Log diagnostic info when no variant was found
        if (replacements.size === 0) {
            logger.warn('[LinkReplacementService._findSinglePath] No variant found in any file', {
                variants,
                fileCount: files.length,
                filePaths: files.map(f => f.getPath()),
                boardAvailable: !!board,
                cardId: options.cardId,
                columnId: options.columnId
            });
        }

        return replacements;
    }

    /**
     * Find all paths with the same directory for batch replacement
     */
    private _findBatchPaths(
        brokenPath: string,
        contextBasePath: string,
        files: MarkdownFile[],
        newDir: string
    ): Map<string, PathReplacement> {
        const replacements = new Map<string, PathReplacement>();

        const decodedBrokenPath = safeDecodeURIComponent(brokenPath);
        const absoluteBrokenPath = path.isAbsolute(decodedBrokenPath)
            ? decodedBrokenPath
            : path.resolve(contextBasePath, decodedBrokenPath);
        const brokenDir = normalizeDirForComparison(path.dirname(absoluteBrokenPath));

        // Use shared pattern for matching all path types
        const pathPattern = new RegExp(MARKDOWN_PATH_PATTERN.source, 'g');

        for (const file of files) {
            const content = file.getContent();
            const fileDir = path.dirname(file.getPath());
            let match;
            pathPattern.lastIndex = 0;

            while ((match = pathPattern.exec(content)) !== null) {
                const matchedPath = extractPathFromMatch(match);
                if (!matchedPath || replacements.has(matchedPath)) continue;

                const decodedPath = safeDecodeURIComponent(matchedPath);
                const absolutePath = path.isAbsolute(decodedPath)
                    ? decodedPath
                    : path.resolve(fileDir, decodedPath);
                const pathDir = normalizeDirForComparison(path.dirname(absolutePath));

                const matchedRelativeDir = normalizeDirForComparison(path.dirname(decodedPath));
                const brokenRelativeDir = normalizeDirForComparison(path.dirname(decodedBrokenPath));
                const relativeDirMatch = matchedRelativeDir === brokenRelativeDir;

                if (pathDir === brokenDir || relativeDirMatch) {
                    const filename = path.basename(decodedPath);
                    const newAbsPath = path.join(newDir, filename);

                    // Skip if old and new resolve to the same absolute path (no-op).
                    // This prevents non-broken paths from polluting the replacements map
                    // and causing wrong notifications to the webview.
                    if (path.normalize(absolutePath) === path.normalize(newAbsPath)) {
                        continue;
                    }

                    try {
                        if (fs.existsSync(newAbsPath)) {
                            replacements.set(matchedPath, {
                                oldPath: matchedPath,
                                decodedOldPath: decodedPath,
                                newAbsolutePath: newAbsPath,
                                sourceFile: file
                            });
                        }
                    } catch {
                        // File doesn't exist, skip
                    }
                }
            }
        }

        // Fallback: add original broken path if no others found
        if (replacements.size === 0) {
            const filename = path.basename(decodedBrokenPath);
            const newAbsPath = path.join(newDir, filename);

            try {
                if (fs.existsSync(newAbsPath)) {
                    replacements.set(brokenPath, {
                        oldPath: brokenPath,
                        decodedOldPath: decodedBrokenPath,
                        newAbsolutePath: newAbsPath,
                        sourceFile: files[0]
                    });
                }
            } catch {
                // File doesn't exist
            }
        }

        return replacements;
    }

    /**
     * Execute the path replacements in files
     */
    private _executeReplacements(
        replacements: Map<string, PathReplacement>,
        files: MarkdownFile[],
        pathFormat: PathFormat
    ): MarkdownFile[] {
        const modifiedFiles: MarkdownFile[] = [];

        for (const file of files) {
            let content = file.getContent();
            let modified = false;
            const fileDir = path.dirname(file.getPath());

            for (const [oldPath, replacement] of replacements) {
                const newRelativePath = this._computeReplacementPath(
                    oldPath,
                    replacement.newAbsolutePath,
                    fileDir,
                    pathFormat
                );
                // Preserve the original filename exactly as it appeared in markdown.
                // Only re-encode the directory portion to avoid changing filename encoding
                // (e.g. spaces, parens, unicode characters).
                const encodedNewPath = this._buildEncodedPath(newRelativePath, oldPath);

                let newContent = LinkOperations.replaceSingleLink(content, oldPath, encodedNewPath, 0);

                if (newContent === content && replacement.decodedOldPath !== oldPath) {
                    // Fallback: match using decoded path, but preserve decoded filename
                    const decodedEncodedNewPath = this._buildEncodedPath(newRelativePath, replacement.decodedOldPath);
                    newContent = LinkOperations.replaceSingleLink(content, replacement.decodedOldPath, decodedEncodedNewPath, 0);
                }

                // Fallback: if replaceSingleLink didn't match any link pattern,
                // try a broader regex that matches the path in any image/link context.
                // This handles edge cases where the primary regex fails due to
                // unexpected formatting, encoding differences, or special characters.
                if (newContent === content && content.includes(oldPath)) {
                    logger.warn('[LinkReplacementService._executeReplacements] replaceSingleLink failed, trying fallback regex', {
                        oldPath,
                        encodedNewPath,
                        file: file.getPath()
                    });
                    const escapedOld = escapeRegExp(oldPath);
                    // Try replacing in image syntax: ![...](oldPath...)
                    const imgFallback = new RegExp(`(!\\[[^\\]]*\\]\\()${escapedOld}((?:\\s+"[^"]*")?\\s*\\))`, 'g');
                    newContent = content.replace(imgFallback, `$1${encodedNewPath}$2`);
                    // Also try replacing in link syntax: [...](oldPath...)
                    if (newContent === content) {
                        const linkFallback = new RegExp(`(\\[[^\\]]*\\]\\()${escapedOld}((?:\\s+"[^"]*")?\\s*\\))`, 'g');
                        newContent = content.replace(linkFallback, `$1${encodedNewPath}$2`);
                    }
                    // Also try wiki links: [[oldPath...]]
                    if (newContent === content) {
                        const wikiFallback = new RegExp(`(\\[\\[)${escapedOld}((?:\\|[^\\]]*)?\\]\\])`, 'g');
                        newContent = content.replace(wikiFallback, `$1${encodedNewPath}$2`);
                    }
                    // Also try include syntax: !!!include(oldPath)!!!
                    if (newContent === content) {
                        const includeFallback = new RegExp(`(!!!include\\()${escapedOld}(\\)!!!)`, 'g');
                        newContent = content.replace(includeFallback, `$1${encodedNewPath}$2`);
                    }
                    if (newContent !== content) {
                        logger.warn('[LinkReplacementService._executeReplacements] Fallback regex succeeded');
                    }
                }

                if (newContent !== content) {
                    content = newContent;
                    modified = true;
                }
            }

            if (modified) {
                file.setContent(content);
                modifiedFiles.push(file);
            }
        }

        return modifiedFiles;
    }

    /**
     * Check if a path was an include path and handle the include switch if needed.
     * Returns true if an include switch was handled, false otherwise.
     */
    private async _handleIncludeSwitchIfNeeded(
        deps: ReplacementDependencies,
        oldTitle: string,
        newTitle: string,
        cardId?: string,
        columnId?: string,
        isColumnTitle?: boolean
    ): Promise<boolean> {
        if (!deps.handleIncludeSwitch || !isColumnTitle) return false;

        const oldIncludePaths = extractIncludeFiles(oldTitle);
        const newIncludePaths = extractIncludeFiles(newTitle);

        // No include files involved
        if (oldIncludePaths.length === 0 && newIncludePaths.length === 0) {
            return false;
        }

        // Check if include paths actually changed (using normalized comparison)
        const normalizeForCompare = (p: string) => safeDecodeURIComponent(p).toLowerCase();
        const oldNormalized = new Set(oldIncludePaths.map(normalizeForCompare));
        const newNormalized = new Set(newIncludePaths.map(normalizeForCompare));

        const includesChanged = oldNormalized.size !== newNormalized.size ||
            [...oldNormalized].some(p => !newNormalized.has(p));

        if (!includesChanged) {
            return false;
        }

        // Include paths changed - trigger include switch for column headers only.
        if (columnId) {
            await deps.handleIncludeSwitch({
                columnId,
                oldFiles: oldIncludePaths,
                newFiles: newIncludePaths,
                newTitle
            });
            return true;
        }

        // Can't determine context, fall back to full refresh
        if (deps.refreshBoard) {
            await deps.refreshBoard();
        }
        return true;
    }

    /**
     * Apply board updates - either targeted or full refresh
     */
    private async _applyBoardUpdates(
        deps: ReplacementDependencies,
        board: KanbanBoard | null | undefined,
        modifiedFiles: MarkdownFile[],
        mainFile: MarkdownFile,
        replacements: Map<string, PathReplacement>,
        options: ReplacementOptions
    ): Promise<void> {
        const mainFileDir = path.dirname(mainFile.getPath());
        const mainFileModified = modifiedFiles.some(f => f.getPath() === mainFile.getPath());
        const includeFilesModified = modifiedFiles.some(f => f.getPath() !== mainFile.getPath());

        if (!board || (!mainFileModified && !includeFilesModified)) {
            return;
        }

        // For batch mode, find and update all affected items
        if (options.mode === 'batch' && replacements.size >= 1) {
            const replacementPaths = Array.from(replacements.keys());

            for (const column of board.columns) {
                // Check column title
                const oldColumnTitle = column.title || '';
                if (replacementPaths.some(p => oldColumnTitle.includes(p))) {
                    const newTitle = this._applyAllReplacements(oldColumnTitle, replacements, mainFileDir, options.pathFormat);
                    if (oldColumnTitle !== newTitle) {
                        // Check for include switch
                        const hadIncludeSwitch = await this._handleIncludeSwitchIfNeeded(
                            deps, oldColumnTitle, newTitle, undefined, column.id, true
                        );
                        if (!hadIncludeSwitch) {
                            column.title = newTitle;
                            deps.webviewBridge.send({
                                type: 'updateColumnContent',
                                columnId: column.id,
                                column: column,
                                imageMappings: {}
                            });
                        }
                    }
                }

                // Check tasks
                for (const task of column.cards) {
                    const oldTaskContent = task.content || '';
                    const taskHasPath = replacementPaths.some(p => oldTaskContent.includes(p));

                    if (taskHasPath) {
                        const taskBaseDir = task.includeContext?.includeDir || mainFileDir;
                        const newTaskContent = this._applyAllReplacements(oldTaskContent, replacements, taskBaseDir, options.pathFormat);
                        if (newTaskContent !== oldTaskContent) {
                            task.content = newTaskContent;
                            deps.webviewBridge.send({
                                type: 'updateCardContent',
                                cardId: task.id,
                                columnId: column.id,
                                task: task,
                                imageMappings: {}
                            });
                        }
                    }
                }
            }

            deps.invalidateCache();
            return;
        }

        // Single mode - targeted updates
        if (options.cardId && options.columnId) {
            const column = board.columns.find((c: KanbanColumn) => c.id === options.columnId);
            const task = column?.cards.find((t: KanbanCard) => t.id === options.cardId);
            if (task) {
                const taskBaseDir = task.includeContext?.includeDir || mainFileDir;
                const oldContent = task.content || '';
                const newContent = this._applyAllReplacements(oldContent, replacements, taskBaseDir, options.pathFormat);
                // Get first line as title for include switch detection
                const oldTitle = oldContent.replace(/\r\n/g, '\n').split('\n')[0] || '';
                const newTitle = newContent.replace(/\r\n/g, '\n').split('\n')[0] || '';

                // Check for include switch
                const hadIncludeSwitch = await this._handleIncludeSwitchIfNeeded(
                    deps, oldTitle, newTitle, options.cardId, options.columnId, false
                );
                if (hadIncludeSwitch) return;

                task.content = newContent;

                deps.webviewBridge.send({
                    type: 'updateCardContent',
                    cardId: options.cardId,
                    columnId: options.columnId,
                    task: task,
                    imageMappings: {}
                });
                deps.invalidateCache();
                return;
            }
        } else if (options.columnId && options.isColumnTitle) {
            const column = board.columns.find((c: KanbanColumn) => c.id === options.columnId);
            if (column) {
                const oldTitle = column.title || '';
                const newTitle = this._applyAllReplacements(oldTitle, replacements, mainFileDir, options.pathFormat);

                // Check for include switch
                const hadIncludeSwitch = await this._handleIncludeSwitchIfNeeded(
                    deps, oldTitle, newTitle, undefined, options.columnId, true
                );
                if (hadIncludeSwitch) return;

                column.title = newTitle;
                deps.webviewBridge.send({
                    type: 'updateColumnContent',
                    columnId: options.columnId,
                    column: column,
                    imageMappings: {}
                });
                deps.invalidateCache();
                return;
            }
        }

        // Fallback: invalidate cache (caller should refresh)
        deps.invalidateCache();
    }

    /**
     * Apply all replacements to a text string
     */
    private _applyAllReplacements(
        text: string,
        replacements: Map<string, PathReplacement>,
        baseDir: string,
        pathFormat: PathFormat
    ): string {
        let result = text;
        for (const [, replacement] of replacements) {
            const newRelativePath = this._computeReplacementPath(
                replacement.oldPath,
                replacement.newAbsolutePath,
                baseDir,
                pathFormat
            );
            // Preserve original filename exactly — only re-encode directory portion
            const encodedNewPath = this._buildEncodedPath(newRelativePath, replacement.oldPath);
            let newResult = LinkOperations.replaceSingleLink(result, replacement.oldPath, encodedNewPath, 0);
            if (newResult === result && replacement.decodedOldPath !== replacement.oldPath) {
                const decodedEncodedNewPath = this._buildEncodedPath(newRelativePath, replacement.decodedOldPath);
                newResult = LinkOperations.replaceSingleLink(result, replacement.decodedOldPath, decodedEncodedNewPath, 0);
            }
            // Fallback: broader regex replacement for board model text
            if (newResult === result && result.includes(replacement.oldPath)) {
                const escapedOld = escapeRegExp(replacement.oldPath);
                const imgFallback = new RegExp(`(!\\[[^\\]]*\\]\\()${escapedOld}((?:\\s+"[^"]*")?\\s*\\))`, 'g');
                newResult = result.replace(imgFallback, `$1${encodedNewPath}$2`);
                if (newResult === result) {
                    const linkFallback = new RegExp(`(\\[[^\\]]*\\]\\()${escapedOld}((?:\\s+"[^"]*")?\\s*\\))`, 'g');
                    newResult = result.replace(linkFallback, `$1${encodedNewPath}$2`);
                }
            }
            result = newResult;
        }
        return result;
    }
}

// Export singleton instance
export const linkReplacementService = new LinkReplacementService();
