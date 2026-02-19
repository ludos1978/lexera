/**
 * IncludeFileCoordinator - Manages include file lifecycle and content synchronization
 *
 * Handles:
 * - Include file registration and tracking
 * - Async content loading with incremental updates
 * - Include switch operations
 * - Bidirectional editing (saving changes back to include files)
 *
 * @module panel/IncludeFileCoordinator
 */

import { KanbanBoard, KanbanCard, KanbanColumn } from '../markdownParser';
import { MarkdownFileRegistry, FileFactory, MainKanbanFile, IncludeFile, MarkdownFile } from '../files';
import { WebviewBridge } from '../core/bridge';
import {
    UpdateColumnContentExtendedMessage
} from '../core/bridge/MessageTypes';
import { ChangeStateMachine } from '../core/ChangeStateMachine';
import { PanelContext } from './PanelContext';
import { findColumn, findColumnContainingCard } from '../actions/helpers';
import { logger } from '../utils/logger';

/**
 * Dependencies required by IncludeFileCoordinator
 */
export interface IncludeCoordinatorDependencies {
    fileRegistry: MarkdownFileRegistry;
    fileFactory: FileFactory;
    webviewBridge: WebviewBridge;
    stateMachine: ChangeStateMachine;
    state: PanelContext;
    getPanel: () => any | undefined;
    getBoard: () => KanbanBoard | undefined;
    getMainFile: () => MainKanbanFile | undefined;
}

/**
 * IncludeFileCoordinator - Single-responsibility module for include file management
 */
export class IncludeFileCoordinator {
    private _deps: IncludeCoordinatorDependencies;

    constructor(deps: IncludeCoordinatorDependencies) {
        this._deps = deps;
    }

    // ============= INCLUDE FILE REGISTRATION =============

    /**
     * Register all include files from the board into the file registry
     *
     * Scans the board for column includes,
     * and creates IncludeFile instances in the registry for each one.
     * Also removes orphaned include files that are no longer referenced.
     */
    registerBoardIncludeFiles(board: KanbanBoard): void {
        const mainFile = this._deps.fileRegistry.getMainFile();
        if (!mainFile) {
            logger.warn(`[IncludeFileCoordinator] Cannot sync include files - no main file in registry`);
            return;
        }

        // Collect all active include paths (normalized) for cleanup later
        const activeIncludePaths = new Set<string>();

        // Sync column includes
        for (const column of board.columns) {
            if (column.includeFiles && column.includeFiles.length > 0) {
                for (const relativePath of column.includeFiles) {
                    const file = this._deps.fileRegistry.ensureIncludeRegistered(
                        relativePath,
                        'include-column',
                        this._deps.fileFactory,
                        mainFile,
                        { columnId: column.id, columnTitle: column.title }
                    );
                    if (file) {
                        activeIncludePaths.add(file.getNormalizedRelativePath());
                    }
                }
            }
        }

        // Task includes and regular includes are disabled.

        // Clean up orphaned include files that are no longer referenced
        this._deps.fileRegistry.unregisterOrphanedIncludes(activeIncludePaths);

        // NOTE: Content loading is handled by FileSyncHandler.reloadExternallyModifiedFiles()
        // which is called after registration completes.
    }

    // NOTE: The following functions have been migrated to FileSyncHandler:
    // - markIncludesAsLoading() - No longer needed with unified sync approach
    // - loadIncludeContentAsync() - Replaced by FileSyncHandler.reloadExternallyModifiedFiles({ force: true })
    // - _loadColumnIncludes() - Logic now in FileSyncHandler._reloadChangedIncludeFiles()
    // - non-column include loaders removed with include-scope migration
    //
    // INIT and FOCUS now use the SAME unified code path:
    // - INIT: FileSyncHandler.reloadExternallyModifiedFiles({ force: true })  - Load all files
    // - FOCUS: FileSyncHandler.reloadExternallyModifiedFiles({ force: false }) - Check and reload changed

    // ============= INCLUDE SWITCH =============

    /**
     * Handle include file switch triggered by user edit
     */
    async handleIncludeSwitch(params: {
        columnId?: string;
        taskId?: string;
        oldFiles: string[];
        newFiles: string[];
        newTitle?: string;
        preloadedContent?: Map<string, string>;
    }): Promise<void> {
        const board = this._deps.getBoard();
        const column = board ? (params.columnId
            ? findColumn(board, params.columnId)
            : findColumnContainingCard(board, params.taskId!)) : undefined;

        const result = await this._deps.stateMachine.processChange({
            type: 'include_switch',
            target: params.columnId ? 'column' : 'task',
            targetId: params.columnId || params.taskId!,
            columnIdForTask: params.columnId ? undefined : column?.id,
            oldFiles: params.oldFiles,
            newFiles: params.newFiles,
            newTitle: params.newTitle,
            preloadedContent: params.preloadedContent
        });

        if (!result.success) {
            logger.error('[IncludeFileCoordinator] Include switch failed:', result.error);
            throw result.error || new Error('Include switch failed');
        }
    }

    // ============= FRONTEND UPDATE BROADCASTING =============

    /**
     * Send updated include file content to frontend
     * Called after file has been reloaded (from external change or manual reload)
     */
    sendIncludeFileUpdateToFrontend(file: MarkdownFile): void {
        const board = this._deps.getBoard();
        if (!board || !this._deps.getPanel()) {
            logger.warn(`[IncludeFileCoordinator] No board or panel available for update`);
            return;
        }

        const relativePath = file.getRelativePath();
        const fileType = file.getFileType();

        if (fileType === 'include-column') {
            this._sendColumnIncludeUpdate(file, board, relativePath);
        }
    }

    /**
     * Send column include file update to frontend
     */
    private _sendColumnIncludeUpdate(file: MarkdownFile, board: KanbanBoard, relativePath: string): void {
        const filePath = file.getPath();
        const isDebug = this._deps.state.debugMode;
        // Find column that uses this include file
        const column = board.columns.find(c =>
            c.includeFiles && c.includeFiles.some(p =>
                MarkdownFile.isSameFile(p, relativePath) || MarkdownFile.isSameFile(p, filePath)
            )
        );

        if (!column) {
            if (isDebug) {
                logger.warn('[kanban.IncludeFileCoordinator.includeColumn.noMatch]', {
                    relativePath,
                    filePath,
                    boardColumns: board.columns.map(c => ({
                        id: c.id,
                        includeFiles: c.includeFiles || []
                    }))
                });
            }
            return;
        }

        if (column) {
            // CRITICAL FIX: Type guard to prevent treating MainKanbanFile as IncludeFile
            if (file.getFileType() === 'main') {
                logger.error(`[IncludeFileCoordinator] BUG: Column include path resolved to MainKanbanFile: ${relativePath}`);
                column.tasks = [];
                column.includeError = true;
                return;
            }

            const columnFile = file as IncludeFile;
            const mainFilePath = this._deps.getMainFile()?.getPath();

            // Check if file exists before using content
            const fileExists = file.exists();
            let tasks: KanbanCard[];
            let includeError: boolean;

            if (isDebug) {
                logger.debug('[kanban.IncludeFileCoordinator.includeColumn.update]', {
                    columnId: column.id,
                    columnTitle: column.title,
                    relativePath,
                    filePath,
                    fileExists,
                    includeFiles: column.includeFiles || [],
                    previousTaskCount: column.tasks?.length ?? 0
                });
            }

            if (fileExists) {
                // Parse tasks from updated file
                tasks = columnFile.parseToTasks(column.tasks, column.id, mainFilePath);
                includeError = false;
            } else {
                // File doesn't exist - error details shown on hover via include badge
                // Don't create error task - just show empty column with error badge
                logger.warn(`[IncludeFileCoordinator] Column include file does not exist: ${relativePath}`);
                tasks = [];
                includeError = true;
            }

            column.tasks = tasks;
            column.includeError = includeError;

            if (isDebug) {
                logger.debug('[kanban.IncludeFileCoordinator.includeColumn.parsed]', {
                    columnId: column.id,
                    relativePath,
                    taskCount: tasks.length,
                    taskIds: tasks.map(task => task.id),
                    includeError
                });
            }

            // Send update to frontend
            const columnMessage: UpdateColumnContentExtendedMessage = {
                type: 'updateColumnContent',
                columnId: column.id,
                tasks: tasks,
                columnTitle: column.title,
                displayTitle: column.displayTitle,
                includeMode: true,
                includeFiles: column.includeFiles,
                includeError: includeError
            };
            this._deps.webviewBridge.send(columnMessage);
        }
    }

    // NOTE: _updateIncludeFilesContent() has been deleted.
    // Content updates during INIT are handled by FileSyncHandler.reloadExternallyModifiedFiles({ force: true })
    // Content updates during EDIT are handled by BoardSyncHandler._propagateEditsToIncludeFiles()
}
