/**
 * IncludeLoadingProcessor - Handles include file loading during state machine transitions
 *
 * Extracted from ChangeStateMachine._handleLoadingNew to improve readability.
 * This class handles the complex logic of loading, creating, and updating
 * include files during include switch operations.
 *
 * @module core/IncludeLoadingProcessor
 */

import * as path from 'path';
import * as fs from 'fs';
import { INCLUDE_SYNTAX, createDisplayTitleWithPlaceholders } from '../constants/IncludeConstants';
import { ChangeContext, IncludeSwitchEvent, UserEditEvent } from './ChangeTypes';
import { KanbanBoard, KanbanColumn, KanbanCard } from '../board/KanbanTypes';
import { findColumn, findColumnContainingCard } from '../actions/helpers';
import { MarkdownFileRegistry } from '../files/MarkdownFileRegistry';
import { FileFactory } from '../files/FileFactory';
import { MarkdownFile } from '../files/MarkdownFile';
import { MainKanbanFile } from '../files/MainKanbanFile';
import { IncludeFile } from '../files/IncludeFile';
import { logger } from '../utils/logger';

/**
 * Interface for webview panel dependencies needed by this processor
 */
export interface IWebviewPanelForProcessor {
    getBoard(): KanbanBoard | undefined;
    fileFactory: FileFactory;
    fileRegistry: MarkdownFileRegistry;
}

/**
 * Result of resolving the target column/task for an include switch
 */
export interface TargetResolution {
    targetColumn: KanbanColumn | null;
    targetTask: KanbanCard | null;
    isColumnSwitch: boolean;
    found: boolean;
}

/**
 * Dependencies required by IncludeLoadingProcessor
 */
export interface IncludeLoadingDependencies {
    fileRegistry: MarkdownFileRegistry;
    webviewPanel: IWebviewPanelForProcessor;
}

/**
 * Handles include file loading operations during include switch events.
 * Extracted from ChangeStateMachine for better separation of concerns.
 */
export class IncludeLoadingProcessor {
    private _fileRegistry: MarkdownFileRegistry;
    private _webviewPanel: IWebviewPanelForProcessor;

    constructor(deps: IncludeLoadingDependencies) {
        this._fileRegistry = deps.fileRegistry;
        this._webviewPanel = deps.webviewPanel;
    }

    /**
     * Resolve the target column/task based on the event type
     */
    resolveTarget(event: IncludeSwitchEvent | UserEditEvent, board: KanbanBoard): TargetResolution {
        let targetColumn: KanbanColumn | null = null;
        let targetTask: KanbanCard | null = null;
        let isColumnSwitch = false;

        if (event.type === 'include_switch') {
            if (event.target === 'column') {
                targetColumn = findColumn(board, event.targetId) || null;
                isColumnSwitch = true;
            } else if (event.target === 'task') {
                targetColumn = (event.columnIdForTask ? findColumn(board, event.columnIdForTask) : null) ?? null;
                targetTask = targetColumn?.cards.find(t => t.id === event.targetId) || null;
            }
        } else if (event.type === 'user_edit' && event.params.includeSwitch) {
            if (event.editType === 'column_title') {
                targetColumn = (event.params.columnId ? findColumn(board, event.params.columnId) : null) ?? null;
                isColumnSwitch = true;
            } else if (event.editType === 'task_content') {
                targetColumn = (event.params.taskId ? findColumnContainingCard(board, event.params.taskId) : null) ?? null;
                targetTask = event.params.taskId ? (targetColumn?.cards.find(t => t.id === event.params.taskId) || null) : null;
            }
        }

        return {
            targetColumn,
            targetTask,
            isColumnSwitch,
            found: !!(targetColumn || targetTask)
        };
    }

    // ============= UNIFIED LOADING (SINGLE CODE PATH) =============

    /**
     * Unified loading function - SINGLE code path for ALL include loading scenarios.
     *
     * This function:
     * 1. Handles removal (empty includeFiles)
     * 2. ALWAYS reloads content from disk (or uses preloaded content)
     * 3. Parses content to tasks (column) or description (task)
     *
     * There is NO distinction between "new" vs "already loaded" files.
     * This eliminates the bug where cached empty files weren't reloaded.
     */
    async unifiedLoad(params: {
        target: { type: 'column'; column: KanbanColumn } | { type: 'task'; column: KanbanColumn; task: KanbanCard };
        includeFiles: string[];
        preloadedContent?: Map<string, string>;
        newTitle?: string;
        context: ChangeContext;
    }): Promise<void> {
        const { target, includeFiles, preloadedContent, newTitle, context } = params;

        // Handle removal case (empty includeFiles)
        if (includeFiles.length === 0) {
            this._clearTarget(target, newTitle);
            return;
        }

        // Get dependencies
        const fileFactory = this._webviewPanel.fileFactory;
        const mainFile = this._fileRegistry.getMainFile();

        if (!fileFactory || !mainFile) {
            logger.error(`[IncludeLoadingProcessor.unifiedLoad] Missing dependencies`);
            return;
        }

        if (target.type === 'column') {
            await this._loadColumnContent(target.column, includeFiles, preloadedContent, newTitle, mainFile, fileFactory, context);
        } else {
            // Task includes were removed. Keep task content local and clear include flags.
            const task = target.task;
            task.includeMode = false;
            task.includeFiles = [];
            task.includeError = false;
            if (newTitle !== undefined) {
                // Replace first line with new title, preserve rest of content
                const lines = (task.content || '').replace(/\r\n/g, '\n').split('\n');
                lines[0] = newTitle;
                task.content = lines.join('\n');
                task.originalTitle = newTitle;
                task.displayTitle = newTitle;
            }
        }
    }

    /**
     * Clear target when includes are being removed
     */
    private _clearTarget(
        target: { type: 'column'; column: KanbanColumn } | { type: 'task'; column: KanbanColumn; task: KanbanCard },
        newTitle?: string
    ): void {
        if (target.type === 'column') {
            const column = target.column;
            column.includeFiles = [];
            column.includeMode = false;
            column.cards = [];
            if (newTitle !== undefined) {
                column.title = newTitle;
                column.originalTitle = newTitle;
                column.displayTitle = newTitle.replace(INCLUDE_SYNTAX.REGEX, '').trim();
            }
        } else {
            const task = target.task;
            task.includeFiles = [];
            task.includeMode = false;
            task.content = '';
            if (newTitle !== undefined) {
                task.content = newTitle;
                task.originalTitle = newTitle;
                task.displayTitle = newTitle.replace(INCLUDE_SYNTAX.REGEX, '').trim();
            }
        }
    }

    /**
     * Load column include content - ALWAYS reloads from disk
     */
    private async _loadColumnContent(
        column: KanbanColumn,
        includeFiles: string[],
        preloadedContent: Map<string, string> | undefined,
        newTitle: string | undefined,
        mainFile: MainKanbanFile,
        fileFactory: FileFactory,
        context: ChangeContext
    ): Promise<void> {
        logger.debug(`[IncludeLoadingProcessor] _loadColumnContent called for column ${column.id}, includeFiles:`, includeFiles);

        // Update column properties
        column.includeFiles = includeFiles;
        column.includeMode = true;

        if (newTitle !== undefined) {
            column.title = newTitle;
            column.originalTitle = newTitle;
            column.displayTitle = this._generateColumnDisplayTitle(newTitle, includeFiles);
        }

        // Load all files and collect tasks
        const tasks: KanbanCard[] = [];

        // Initialize error state - will be set to true if ANY file fails
        column.includeError = false;

        for (const relativePath of includeFiles) {
            // Ensure file is registered
            this._fileRegistry.ensureIncludeRegistered(
                relativePath,
                'include-column',
                fileFactory,
                mainFile,
                { columnId: column.id, columnTitle: column.title }
            );

            const file = this._fileRegistry.getByRelativePath(relativePath);
            if (!file) {
                logger.error(`[IncludeLoadingProcessor] File not found after registration: ${relativePath}`);
                // Mark column as having include error (error details shown on hover via include badge)
                // Don't create error task - just show empty column with error badge
                column.includeError = true;
                continue;
            }

            // CRITICAL DEFENSE: Verify this is actually an IncludeFile, not MainKanbanFile
            // This prevents cache corruption if the registry returns the wrong file type
            if (file.getFileType() === 'main') {
                logger.error(`[IncludeLoadingProcessor] BUG: Registry returned MainKanbanFile for include path: ${relativePath}`);
                column.includeError = true;
                continue;
            }

            // ALWAYS load content - NO distinction between "new" vs "already loaded"
            const normalizedPath = MarkdownFile.normalizeRelativePath(relativePath);
            const preloaded = preloadedContent?.get(normalizedPath);

            if (preloaded !== undefined) {
                file.setContent(preloaded, false); // Mark as unsaved
            } else {
                await file.reload(); // ALWAYS reload from disk
            }

            // Parse to tasks
            const includeFile = file as IncludeFile;
            const mainFilePath = mainFile.getPath();

            // CRITICAL: Fresh disk check - don't trust cached _exists flag
            // The _exists flag can be stale if _readFromDiskWithVerification() short-circuited
            const absolutePath = includeFile.getPath();
            const fileExistsOnDisk = fs.existsSync(absolutePath);
            logger.debug(`[IncludeLoadingProcessor] Checking file existence: relativePath=${relativePath}, absolutePath=${absolutePath}, fileExistsOnDisk=${fileExistsOnDisk}, cachedExists=${includeFile.exists()}`);
            if (!fileExistsOnDisk) {
                includeFile.setExists(false);  // Update cached state
                logger.warn(`[IncludeLoadingProcessor] File does not exist: ${relativePath}`);
                // Don't create error task - just show empty column with error badge
                column.includeError = true;
                continue;
            }

            // THEN: Check for empty content (file exists but is empty)
            const contentLength = includeFile.getContent()?.length || 0;
            if (contentLength === 0) {
                logger.warn(`[IncludeLoadingProcessor] File has no content after reload: ${relativePath}`);
                // Don't create error task - just show empty column with error badge
                column.includeError = true;
                continue;
            }

            const fileTasks = includeFile.parseToTasks(column.cards, column.id, mainFilePath);

            // Debug logging
            if (fileTasks.length === 0) {
                logger.warn(`[IncludeLoadingProcessor] File has content (${contentLength} chars) but parsed to 0 tasks: ${relativePath}`);
            }

            tasks.push(...fileTasks);
            context.result.updatedFiles.push(relativePath);
        }

        column.cards = tasks;
        logger.debug(`[IncludeLoadingProcessor] _loadColumnContent finished: columnId=${column.id}, includeError=${column.includeError}, taskCount=${tasks.length}, hasErrorTask=${tasks.some(t => t.includeError)}`);
    }

    // ============= PATH NORMALIZATION HELPERS =============

    /**
     * Calculate files being unloaded with proper path normalization
     */
    calculateUnloadingFiles(oldFiles: string[], newFiles: string[]): string[] {
        const normalizedNew = new Set(newFiles.map(MarkdownFile.normalizeRelativePath));
        return oldFiles.filter(f => !normalizedNew.has(MarkdownFile.normalizeRelativePath(f)));
    }

    /**
     * Calculate files being loaded with proper path normalization
     */
    calculateLoadingFiles(oldFiles: string[], newFiles: string[]): string[] {
        const normalizedOld = new Set(oldFiles.map(MarkdownFile.normalizeRelativePath));
        return newFiles.filter(f => !normalizedOld.has(MarkdownFile.normalizeRelativePath(f)));
    }

    // ============= PRIVATE HELPERS =============

    private _generateColumnDisplayTitle(title: string, files: string[]): string {
        const includeMatches = title.match(INCLUDE_SYNTAX.REGEX);

        if (includeMatches && includeMatches.length > 0) {
            let displayTitle = createDisplayTitleWithPlaceholders(title, files);

            if (!displayTitle && files.length > 0) {
                displayTitle = path.basename(files[0], path.extname(files[0]));
            }

            return displayTitle || 'Included Column';
        }

        return title;
    }
}
