/**
 * Debug Commands
 *
 * Handles debug and diagnostic operations for the kanban board:
 * - forceWriteAllContent: Emergency force write of all files
 * - verifyContentSync: Verify content synchronization between registry and saved file
 * - getTrackedFilesDebugInfo: Get debug info about tracked files
 * - clearTrackedFilesCache: Clear tracked file caches
 *
 * These commands are used by the file manager UI for troubleshooting
 * file synchronization issues.
 *
 * @module commands/DebugCommands
 */

import { SwitchBasedCommand, CommandContext, CommandMetadata, CommandResult, MessageHandler } from './interfaces';
import { getErrorMessage, safeDecodeURIComponent, normalizePathForLookup } from '../utils/stringUtils';
import { PanelCommandAccess, hasConflictService } from '../types/PanelCommandAccess';
import { MarkdownKanbanParser } from '../markdownParser';
import { KanbanBoard } from '../board/KanbanTypes';
import type {
    VerifyContentSyncMessage,
    GetMediaTrackingStatusMessage,
    SetDebugModeMessage,
    ApplyBatchFileActionsMessage,
    ConflictResolutionMessage,
    OpenFileDialogMessage,
    OpenVscodeDiffMessage,
    CloseVscodeDiffMessage,
    VerifyContentSyncFileResult,
    VerifyContentSyncFrontendSnapshot,
    DuplicationVerificationResult,
    DuplicationVerificationIssue,
    DuplicationCopyState
} from '../core/bridge/MessageTypes';
import { IncludeFile } from '../files/IncludeFile';
import { MarkdownFile } from '../files/MarkdownFile';
import { MarkdownFileRegistry } from '../files/MarkdownFileRegistry';
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { KanbanDiffService } from '../services/KanbanDiffService';
import { ConflictDialogResult, toConflictFileInfo } from '../services/ConflictDialogBridge';
import { logger } from '../utils/logger';
import { computeTrackedFilesSnapshotToken } from '../utils/fileStateSnapshot';

/**
 * Include file debug info
 */
interface IncludeFileDebugInfo {
    path: string;
    type: string;
    exists: boolean;
    lastAccessErrorCode?: string | null;
    lastModified: string;
    size: string;
    hasInternalChanges: boolean;
    hasAnyUnsavedChanges: boolean;
    hasExternalChanges: boolean;
    isUnsavedInEditor: boolean;
    contentLength: number;
    baselineLength: number;
    contentHash: string;
    baselineHash: string;
}

/**
 * Tracked files debug info structure
 */
interface TrackedFilesDebugInfo {
    mainFile: string;
    mainFileLastModified: string;
    snapshotToken: string | null;
    fileWatcherActive: boolean;
    includeFiles: IncludeFileDebugInfo[];
    conflictManager: {
        healthy: boolean;
        trackedFiles: number;
        activeWatchers: number;
        pendingConflicts: number;
        watcherFailures: number;
        listenerEnabled: boolean;
        documentSaveListenerActive: boolean;
    };
    systemHealth: {
        overall: string;
        extensionState: string;
        memoryUsage: string;
        lastError: string | null;
    };
    hasUnsavedChanges: boolean;
    timestamp: string;
    watcherDetails: {
        path: string;
        lastModified: string;
        exists: boolean;
        lastAccessErrorCode?: string | null;
        watcherActive: boolean;
        hasInternalChanges: boolean;
        hasAnyUnsavedChanges: boolean;
        hasExternalChanges: boolean;
        documentVersion: number;
        lastDocumentVersion: number;
        isUnsavedInEditor: boolean;
        baselineLength: number;
        baselineHash: string;
    };
}

type BatchFileAction = 'overwrite' | 'overwrite_backup_external' | 'load_external' | 'load_external_backup_mine' | 'skip';

interface BatchFileActionResult {
    path: string;
    action: BatchFileAction;
    status: 'applied' | 'skipped' | 'failed';
    error?: string;
    backupCreated?: boolean;
}

/**
 * Debug Commands Handler
 *
 * Processes debug-related messages from the webview.
 */
export class DebugCommands extends SwitchBasedCommand {
    readonly metadata: CommandMetadata = {
        id: 'debug-commands',
        name: 'Debug Commands',
        description: 'Handles debug operations for file synchronization and diagnostics',
        messageTypes: [
            'forceWriteAllContent',
            'verifyContentSync',
            'getTrackedFilesDebugInfo',
            'clearTrackedFilesCache',
            'setDebugMode',
            'getMediaTrackingStatus',
            'applyBatchFileActions',
            'conflictResolution',
            'openFileDialog',
            'openVscodeDiff',
            'closeVscodeDiff',
            'closeAllVscodeDiffs'
        ],
        priority: 50
    };

    protected handlers: Record<string, MessageHandler> = {
        'forceWriteAllContent': (_msg, ctx) => this.handleForceWriteAllContent(ctx),
        'verifyContentSync': (msg, ctx) => this.handleVerifyContentSync(msg as VerifyContentSyncMessage, ctx),
        'getTrackedFilesDebugInfo': (_msg, ctx) => this.handleGetTrackedFilesDebugInfo(ctx),
        'clearTrackedFilesCache': (_msg, ctx) => this.handleClearTrackedFilesCache(ctx),
        'setDebugMode': (msg, ctx) => this.handleSetDebugMode(msg as SetDebugModeMessage, ctx),
        'getMediaTrackingStatus': (msg, ctx) => this.handleGetMediaTrackingStatus(msg as GetMediaTrackingStatusMessage, ctx),
        'applyBatchFileActions': (msg, ctx) => this.handleApplyBatchFileActions(msg as ApplyBatchFileActionsMessage, ctx),
        'conflictResolution': (msg, ctx) => this.handleConflictResolution(msg as ConflictResolutionMessage, ctx),
        'openFileDialog': (msg, ctx) => this.handleOpenFileDialog(msg as OpenFileDialogMessage, ctx),
        'openVscodeDiff': (msg, ctx) => this.handleOpenVscodeDiff(msg as OpenVscodeDiffMessage, ctx),
        'closeVscodeDiff': (msg, ctx) => this.handleCloseVscodeDiff(msg as CloseVscodeDiffMessage, ctx),
        'closeAllVscodeDiffs': (_msg, _ctx) => this.handleCloseAllVscodeDiffs()
    };

    private async handleSetDebugMode(message: SetDebugModeMessage, context: CommandContext): Promise<CommandResult> {
        const panel = context.getWebviewPanel() as PanelCommandAccess | undefined;
        if (!panel || typeof panel.setDebugMode !== 'function') {
            return this.success();
        }

        panel.setDebugMode(message.enabled);
        return this.success();
    }

    private _validateSnapshotToken(snapshotToken: string | undefined, fileRegistry: MarkdownFileRegistry): string | null {
        if (!snapshotToken) {
            return 'Action blocked: file-state snapshot missing. Refresh File Manager and review file states again.';
        }

        const currentToken = computeTrackedFilesSnapshotToken(fileRegistry);
        if (snapshotToken !== currentToken) {
            return 'Action blocked: file states changed since the last refresh. Refresh File Manager and review actions again.';
        }

        return null;
    }

    private _hasPendingConflictActions(
        resolutions: Array<{ action: 'overwrite' | 'overwrite_backup_external' | 'load_external' | 'load_external_backup_mine' | 'import' | 'ignore' | 'skip' }>
    ): boolean {
        return resolutions.some(resolution => resolution.action !== 'skip');
    }

    private _isBatchFileAction(action: unknown): action is BatchFileAction {
        return action === 'overwrite'
            || action === 'overwrite_backup_external'
            || action === 'load_external'
            || action === 'load_external_backup_mine'
            || action === 'skip';
    }

    // ============= CONFLICT RESOLUTION HANDLER =============

    private async handleConflictResolution(message: ConflictResolutionMessage, context: CommandContext): Promise<CommandResult> {
        const panel = context.getWebviewPanel() as PanelCommandAccess | undefined;
        const bridge = panel?._conflictDialogBridge;
        if (!bridge) {
            logger.warn('[DebugCommands] No ConflictDialogBridge available for conflict resolution');
            return this.success();
        }

        const fileRegistry = this.getFileRegistry();
        if (!fileRegistry) {
            logger.warn('[DebugCommands] conflictResolution blocked: no file registry available');
            bridge.handleResolution(message.conflictId, {
                cancelled: true,
                perFileResolutions: []
            }, message.snapshotToken);
            return this.success();
        }

        if (this._hasPendingConflictActions(message.perFileResolutions)) {
            const snapshotValidationError = this._validateSnapshotToken(message.snapshotToken, fileRegistry);
            if (snapshotValidationError) {
                logger.warn(`[DebugCommands] conflictResolution blocked: ${snapshotValidationError}`);
                this.postMessage({
                    type: 'showMessage',
                    severity: 'warning',
                    message: snapshotValidationError
                });
                bridge.handleResolution(message.conflictId, {
                    cancelled: true,
                    perFileResolutions: []
                }, message.snapshotToken);
                return this.success();
            }
        }

        bridge.handleResolution(message.conflictId, {
            cancelled: message.cancelled,
            perFileResolutions: message.perFileResolutions
        }, message.snapshotToken);

        return this.success();
    }

    // ============= OPEN FILE DIALOG HANDLER =============

    private async handleOpenFileDialog(message: OpenFileDialogMessage, context: CommandContext): Promise<CommandResult> {
        const panel = context.getWebviewPanel() as PanelCommandAccess | undefined;
        const bridge = panel?._conflictDialogBridge;
        const webviewBridge = context.getWebviewBridge();

        if (!bridge || !webviewBridge) {
            logger.warn('[DebugCommands] No ConflictDialogBridge or WebviewBridge available for openFileDialog');
            return this.success();
        }

        const fileRegistry = this.getFileRegistry();
        if (!fileRegistry) {
            logger.warn('[DebugCommands] No file registry available for openFileDialog');
            return this.success();
        }

        const snapshotToken = computeTrackedFilesSnapshotToken(fileRegistry);

        // Build ConflictFileInfo[] from all registered files
        const allFiles = fileRegistry.getAll();
        const conflictFileInfos = allFiles.map(file => toConflictFileInfo(file));

        try {
            const result = await bridge.showConflict(
                (msg) => webviewBridge.send(msg),
                {
                    conflictType: 'external_changes',
                    files: conflictFileInfos,
                    openMode: message.openMode,
                    snapshotToken
                }
            );

            if (result.cancelled) {
                return this.success();
            }

            if (this._hasPendingConflictActions(result.perFileResolutions)) {
                const snapshotValidationError = this._validateSnapshotToken(result.snapshotToken, fileRegistry);
                if (snapshotValidationError) {
                    logger.warn(`[DebugCommands] openFileDialog resolution blocked: ${snapshotValidationError}`);
                    this.postMessage({
                        type: 'showMessage',
                        severity: 'warning',
                        message: snapshotValidationError
                    });
                    return this.success();
                }
            }

            // Apply per-file resolutions
            await this.applyFileResolutions(result, fileRegistry);
        } catch (error) {
            logger.warn('[DebugCommands] openFileDialog failed:', error);
            this.postMessage({
                type: 'showMessage',
                severity: 'error',
                message: `File action failed: ${getErrorMessage(error)}`
            });
        }

        return this.success();
    }

    // ============= BATCH FILE ACTION HANDLER =============

    private async handleApplyBatchFileActions(message: ApplyBatchFileActionsMessage, _context: CommandContext): Promise<CommandResult> {
        const requestedActions = Array.isArray(message.actions) ? message.actions : [];
        const emptyResultPayload = {
            type: 'batchFileActionsResult',
            success: true,
            appliedCount: 0,
            failedCount: 0,
            skippedCount: 0,
            backupCount: 0,
            results: [] as BatchFileActionResult[]
        };

        if (requestedActions.length === 0) {
            this.postMessage(emptyResultPayload);
            return this.success();
        }

        const fileRegistry = this.getFileRegistry();
        if (!fileRegistry) {
            const failureResults = requestedActions.map(request => ({
                path: typeof request.path === 'string' ? request.path : '',
                action: this._isBatchFileAction(request.action) ? request.action : 'skip',
                status: 'failed' as const,
                error: 'File registry not available'
            }));
            this.postMessage({
                type: 'batchFileActionsResult',
                success: false,
                appliedCount: 0,
                failedCount: failureResults.length,
                skippedCount: 0,
                backupCount: 0,
                error: 'File registry not available',
                results: failureResults
            });
            return this.success();
        }

        const snapshotValidationError = this._validateSnapshotToken(message.snapshotToken, fileRegistry);
        if (snapshotValidationError) {
            const failureResults = requestedActions.map(request => ({
                path: typeof request.path === 'string' ? request.path : '',
                action: this._isBatchFileAction(request.action) ? request.action : 'skip',
                status: 'failed' as const,
                error: snapshotValidationError
            }));
            this.postMessage({
                type: 'batchFileActionsResult',
                success: false,
                appliedCount: 0,
                failedCount: failureResults.length,
                skippedCount: 0,
                backupCount: 0,
                error: snapshotValidationError,
                results: failureResults
            });
            return this.success();
        }

        const batchResults = await this._executeBatchFileActions(requestedActions, fileRegistry);
        const appliedCount = batchResults.filter(result => result.status === 'applied').length;
        const failedCount = batchResults.filter(result => result.status === 'failed').length;
        const skippedCount = batchResults.filter(result => result.status === 'skipped').length;
        const backupCount = batchResults.filter(result => result.backupCreated).length;

        this.postMessage({
            type: 'batchFileActionsResult',
            success: failedCount === 0,
            appliedCount,
            failedCount,
            skippedCount,
            backupCount,
            error: failedCount > 0 ? 'One or more file actions failed.' : undefined,
            results: batchResults
        });
        return this.success();
    }

    private async _executeBatchFileActions(
        requestedActions: ApplyBatchFileActionsMessage['actions'],
        fileRegistry: MarkdownFileRegistry
    ): Promise<BatchFileActionResult[]> {
        const results: BatchFileActionResult[] = requestedActions.map(request => ({
            path: typeof request.path === 'string' ? request.path : '',
            action: this._isBatchFileAction(request.action) ? request.action : 'skip',
            status: 'skipped'
        }));

        const preflightErrors: string[] = [];
        const seenPaths = new Set<string>();
        const plannedActions: Array<{
            resultIndex: number;
            file: MarkdownFile;
            action: Exclude<BatchFileAction, 'skip'>;
            backupContent?: string;
            backupCreated?: boolean;
        }> = [];

        for (let index = 0; index < requestedActions.length; index++) {
            const request = requestedActions[index];
            const requestPath = typeof request.path === 'string' ? request.path : '';
            const requestAction = request.action;

            if (!requestPath) {
                results[index].status = 'failed';
                results[index].error = 'Missing file path for file action.';
                preflightErrors.push('Missing file path for one or more actions.');
                continue;
            }

            if (!this._isBatchFileAction(requestAction)) {
                results[index].status = 'failed';
                results[index].error = `Unsupported file action: ${String(requestAction)}`;
                preflightErrors.push(`Unsupported file action "${String(requestAction)}" for "${requestPath}".`);
                continue;
            }

            results[index].action = requestAction;
            if (requestAction === 'skip') {
                results[index].status = 'skipped';
                continue;
            }

            const file = fileRegistry.get(requestPath) || fileRegistry.findByPath(requestPath);
            if (!file) {
                results[index].status = 'failed';
                results[index].error = `File not found in registry: ${requestPath}`;
                preflightErrors.push(`File not found in registry: ${requestPath}`);
                continue;
            }

            const fileType = file.getFileType();
            const dedupeKey = normalizePathForLookup(file.getPath());
            if (seenPaths.has(dedupeKey)) {
                results[index].status = 'skipped';
                results[index].error = 'Duplicate file action ignored in batch request.';
                continue;
            }
            seenPaths.add(dedupeKey);

            const accessErrorCode = file.getLastAccessErrorCode?.() ?? null;
            if (accessErrorCode === 'EACCES' || accessErrorCode === 'EPERM' || accessErrorCode === 'EROFS') {
                const message = `File "${file.getRelativePath()}" is not accessible (${accessErrorCode}). `
                    + 'Fix file permissions before applying file actions.';
                results[index].status = 'failed';
                results[index].error = message;
                preflightErrors.push(message);
                continue;
            }

            if ((requestAction === 'overwrite' || requestAction === 'overwrite_backup_external') && file.isDirtyInEditor()) {
                const message = `Cannot overwrite "${file.getRelativePath()}" while it has unsaved text-editor changes. Save or discard editor changes first.`;
                results[index].status = 'failed';
                results[index].error = message;
                preflightErrors.push(message);
                continue;
            }

            if (requestAction === 'load_external' && file.hasAnyUnsavedChanges()) {
                const message = `Cannot load disk content for "${file.getRelativePath()}" without backup while unsaved changes exist. `
                    + 'Use "Load from disk (backup kanban)" or save first.';
                results[index].status = 'failed';
                results[index].error = message;
                preflightErrors.push(message);
                continue;
            }

            if (requestAction === 'overwrite_backup_external') {
                const diskContent = await file.readFromDisk();
                if (diskContent === null) {
                    const message = `Failed to read disk content for backup: ${file.getRelativePath()}`;
                    results[index].status = 'failed';
                    results[index].error = message;
                    preflightErrors.push(message);
                    continue;
                }
                plannedActions.push({
                    resultIndex: index,
                    file,
                    action: requestAction,
                    backupContent: diskContent
                });
                continue;
            }

            if (requestAction === 'load_external_backup_mine') {
                plannedActions.push({
                    resultIndex: index,
                    file,
                    action: requestAction,
                    backupContent: file.getContentForBackup()
                });
                continue;
            }

            plannedActions.push({
                resultIndex: index,
                file,
                action: requestAction
            });
        }

        if (preflightErrors.length > 0) {
            for (const plan of plannedActions) {
                if (results[plan.resultIndex].status === 'skipped' && !results[plan.resultIndex].error) {
                    results[plan.resultIndex].status = 'failed';
                    results[plan.resultIndex].error = 'Batch aborted during preflight validation. No actions executed.';
                }
            }
            return results;
        }

        const needsSaveService = plannedActions.some(
            plan => plan.action === 'overwrite' || plan.action === 'overwrite_backup_external'
        );
        const fileSaveService = this._context?.fileSaveService;
        if (needsSaveService && !fileSaveService) {
            for (const plan of plannedActions) {
                results[plan.resultIndex].status = 'failed';
                results[plan.resultIndex].error = 'File save service not available for overwrite actions.';
            }
            return results;
        }

        // Preflight backup creation for all backup-required actions before any save/reload action runs.
        for (const plan of plannedActions) {
            if (plan.action !== 'overwrite_backup_external' && plan.action !== 'load_external_backup_mine') {
                continue;
            }
            const backupContent = plan.backupContent;
            if (backupContent === undefined) {
                results[plan.resultIndex].status = 'failed';
                results[plan.resultIndex].error = `Missing backup content for ${plan.file.getRelativePath()}.`;
                this._markPendingBatchActionsFailed(
                    results,
                    plannedActions,
                    'Batch aborted while preparing backups. No actions executed.'
                );
                return results;
            }

            const backupPath = await plan.file.createVisibleConflictFile(backupContent);
            if (!backupPath) {
                results[plan.resultIndex].status = 'failed';
                results[plan.resultIndex].error = `Failed to create backup before action: ${plan.file.getRelativePath()}`;
                this._markPendingBatchActionsFailed(
                    results,
                    plannedActions,
                    'Batch aborted while preparing backups. No actions executed.'
                );
                return results;
            }
            plan.backupCreated = true;
            results[plan.resultIndex].backupCreated = true;
        }

        let abortReason: string | null = null;

        for (const plan of plannedActions) {
            const result = results[plan.resultIndex];
            if (abortReason) {
                if (result.status === 'skipped' && !result.error) {
                    result.status = 'skipped';
                    result.error = abortReason;
                }
                continue;
            }

            try {
                switch (plan.action) {
                    case 'overwrite':
                    case 'overwrite_backup_external':
                        await fileSaveService!.saveFile(plan.file, undefined, {
                            source: 'ui-edit',
                            force: true,
                            skipReloadDetection: true
                        });
                        break;
                    case 'load_external':
                    case 'load_external_backup_mine':
                        if (plan.file.isInEditMode()) {
                            plan.file.setEditMode(false);
                        }
                        await plan.file.reload();
                        break;
                    default:
                        break;
                }
                result.status = 'applied';
            } catch (error) {
                const errorMessage = getErrorMessage(error);
                result.status = 'failed';
                result.error = errorMessage;
                abortReason = `Batch stopped after "${plan.file.getRelativePath()}" failed.`;
            }
        }

        return results;
    }

    /**
     * Apply per-file resolutions from the unified file dialog.
     * Handles all 5 action types: overwrite, overwrite_backup_external,
     * load_external, load_external_backup_mine, skip.
     */
    private async applyFileResolutions(
        result: ConflictDialogResult,
        fileRegistry: MarkdownFileRegistry
    ): Promise<void> {
        const normalizedActions: ApplyBatchFileActionsMessage['actions'] = result.perFileResolutions.map(
            resolution => ({
                path: resolution.path,
                action: this._isBatchFileAction(resolution.action) ? resolution.action : 'skip'
            })
        );

        const batchResults = await this._executeBatchFileActions(normalizedActions, fileRegistry);
        const firstFailure = batchResults.find(entry => entry.status === 'failed');
        if (firstFailure) {
            throw new Error(firstFailure.error || `Failed to apply file action for "${firstFailure.path}"`);
        }

        const appliedCount = batchResults.filter(entry => entry.status === 'applied').length;
        if (appliedCount > 0) {
            logger.debug(`[DebugCommands] Applied ${appliedCount} file resolution action(s)`);
        }
    }

    // ============= VS CODE DIFF HANDLERS =============

    private async handleOpenVscodeDiff(message: OpenVscodeDiffMessage, context: CommandContext): Promise<CommandResult> {
        const fileRegistry = this.getFileRegistry();
        if (!fileRegistry) {
            logger.warn('[DebugCommands] openVscodeDiff: No file registry available');
            return this.success();
        }

        // Store original path for frontend communication (relative for includes, absolute for main)
        const frontendPath = message.filePath;

        const file = fileRegistry.get(frontendPath) || fileRegistry.findByPath(frontendPath);
        if (!file) {
            logger.warn(`[DebugCommands] openVscodeDiff: File not found in registry: ${frontendPath}`);
            return this.success();
        }

        // Use absolute path for all file operations
        const absolutePath = file.getPath();
        logger.debug(`[DebugCommands] openVscodeDiff: frontendPath="${frontendPath}", absolutePath="${absolutePath}", type=${file.getFileType()}`);

        const kanbanContent = file.getContent();
        const diskContent = await file.readFromDisk() || '';

        const diffService = KanbanDiffService.getInstance();
        diffService.setFileRegistry(fileRegistry);

        // Set callback to notify webview when diff is closed externally
        const bridge = context.getWebviewBridge();
        if (bridge) {
            diffService.setOnDiffClosedCallback((closedAbsPath) => {
                // Convert absolute path back to frontend format:
                // - Main file: uses absolute path
                // - Include files: uses relative path
                const closedFile = fileRegistry.get(closedAbsPath) || fileRegistry.findByPath(closedAbsPath);
                const closedFrontendPath = closedFile?.getFileType() === 'main'
                    ? closedAbsPath
                    : closedFile?.getRelativePath() || closedAbsPath;

                logger.debug(`[DebugCommands] vscodeDiffClosed: absolutePath="${closedAbsPath}", frontendPath="${closedFrontendPath}"`);

                bridge.send({
                    type: 'vscodeDiffClosed',
                    filePath: closedFrontendPath
                });
            });
        }

        // Set callback to update kanban board when content changes in diff editor
        // NOTE: For include files, we DON'T trigger full board re-parse because that would
        // regenerate the include content from board tasks, losing raw edits like tags.
        // Instead, for includes we send a targeted column content update.
        const panel = context.getWebviewPanel() as PanelCommandAccess | undefined;

        // NOTE: Do NOT capture isIncludeFile here! The callback is shared across all diff sessions
        // (singleton service), so we must determine file type INSIDE the callback based on changedPath.
        logger.debug(`[DebugCommands] openVscodeDiff: Setting content changed callback`);
        diffService.setOnContentChangedCallback(async (changedPath, _newContent) => {
            // Determine file type dynamically based on the changed path
            const changedFile = fileRegistry.get(changedPath) || fileRegistry.findByPath(changedPath);
            const changedFileType = changedFile?.getFileType() || 'unknown';
            const isChangedIncludeFile = changedFileType !== 'main' && changedFileType !== 'unknown';

            logger.debug(`[DebugCommands] onContentChanged: changedPath="${changedPath}", fileType="${changedFileType}", isIncludeFile=${isChangedIncludeFile}`);
            logger.debug(`[DebugCommands] onContentChanged: CALLBACK INVOKED! changedPath="${changedPath}", fileType="${changedFileType}", isIncludeFile=${isChangedIncludeFile}`);

            if (isChangedIncludeFile && changedFile) {
                // For include files: reload from the now-updated file and send targeted update
                // This preserves raw content without going through board regeneration
                logger.debug(`[DebugCommands] onContentChanged: Processing include file change`);

                // Re-parse include file to tasks
                const mainFile = fileRegistry.getMainFile();
                // Get board from fileService - board is a getter that returns a function
                const fileService = panel?._fileService;
                logger.debug(`[DebugCommands] onContentChanged: fileService=${!!fileService}, panel=${!!panel}`);

                // Access board via the boardStore directly since 'board' is private
                const boardStore = (fileService as any)?._deps?.boardStore;
                const board = boardStore?.getBoard?.();
                logger.debug(`[DebugCommands] onContentChanged: boardStore=${!!boardStore}, board=${!!board}, mainFile=${!!mainFile}`);

                if (mainFile && board) {
                    const incFile = changedFile as IncludeFile;
                    const incRelPath = incFile.getRelativePath();
                    const incAbsPath = incFile.getPath();
                    logger.debug(`[DebugCommands] onContentChanged: incRelPath="${incRelPath}", incAbsPath="${incAbsPath}"`);

                    // Find columns using this include file
                    // Note: column.includeFiles may contain absolute OR relative paths depending on board state
                    let columnsUpdated = 0;
                    for (const column of board.columns) {
                        const columnIncludeFiles = column.includeFiles || [];
                        // Debug: log detailed match results for each path comparison
                        const matchResults = columnIncludeFiles.map((inc: string) => {
                            const isSameFileRel = MarkdownFile.isSameFile(inc, incRelPath);
                            const isSameFileAbs = MarkdownFile.isSameFile(inc, incAbsPath);
                            const exactRel = inc === incRelPath;
                            const exactAbs = inc === incAbsPath;
                            return { inc, isSameFileRel, isSameFileAbs, exactRel, exactAbs, any: isSameFileRel || isSameFileAbs || exactRel || exactAbs };
                        });
                        const matches = matchResults.some((r: { any: boolean }) => r.any);
                        logger.debug(`[DebugCommands] onContentChanged: column "${column.id}" matches=${matches}, matchResults=${JSON.stringify(matchResults)}`);

                        if (matches) {
                            // Parse fresh tasks from updated content
                            const freshTasks = incFile.parseToTasks(column.cards, column.id, mainFile.getPath());
                            logger.debug(`[DebugCommands] onContentChanged: parsed ${freshTasks.length} tasks for column "${column.id}"`);
                            column.cards = freshTasks;
                            columnsUpdated++;
                        }
                    }
                    logger.debug(`[DebugCommands] onContentChanged: columnsUpdated=${columnsUpdated}`);

                    // Send targeted board update (not full refresh)
                    if (panel?._fileService && columnsUpdated > 0) {
                        panel._fileService.setBoard(board);
                        await panel._fileService.sendBoardUpdate(false, false);
                        logger.debug(`[DebugCommands] onContentChanged: board update sent`);
                    }
                } else {
                    logger.debug(`[DebugCommands] onContentChanged: SKIP - mainFile=${!!mainFile}, board=${!!board}`);
                }
            } else if (changedFileType === 'main') {
                // For main file: re-parse board and refresh UI
                // CRITICAL: After parsing, must load include files to populate column tasks
                logger.debug(`[DebugCommands] onContentChanged (main): re-parsing board`);
                const mainFile = fileRegistry.getMainFile();
                if (mainFile && panel?._fileService) {
                    mainFile.parseToBoard();
                    const freshBoard = mainFile.getBoard();
                    if (freshBoard && freshBoard.valid) {
                        // Load include file content for columns with includeFiles
                        const mainFilePath = mainFile.getPath();
                        for (const column of freshBoard.columns) {
                            if (column.includeFiles && column.includeFiles.length > 0) {
                                logger.debug(`[DebugCommands] onContentChanged (main): loading includes for column "${column.id}": [${column.includeFiles.join(', ')}]`);
                                // Get include file from registry and parse to tasks
                                for (const relPath of column.includeFiles) {
                                    const incFile = fileRegistry.getByRelativePath(relPath);
                                    if (incFile && incFile.getFileType() !== 'main') {
                                        const tasks = (incFile as IncludeFile).parseToTasks(column.cards, column.id, mainFilePath);
                                        column.cards = tasks;
                                        logger.debug(`[DebugCommands] onContentChanged (main): parsed ${tasks.length} tasks from "${relPath}"`);
                                    }
                                }
                            }
                        }
                        panel._fileService.setBoard(freshBoard);
                        await panel._fileService.sendBoardUpdate(false, false);
                        logger.debug(`[DebugCommands] onContentChanged (main): board update sent`);
                    }
                }
            } else {
                logger.debug(`[DebugCommands] onContentChanged: SKIP - unknown file type "${changedFileType}"`);
            }
        });

        // Use file.getPath() for absolute path - message.filePath may be relative for include files
        await diffService.openDiff(file.getPath(), kanbanContent, diskContent);

        return this.success();
    }

    private async handleCloseVscodeDiff(message: CloseVscodeDiffMessage, _context: CommandContext): Promise<CommandResult> {
        const fileRegistry = this.getFileRegistry();
        const diffService = KanbanDiffService.getInstance();

        // Look up file to get absolute path (message.filePath may be relative for include files)
        const file = fileRegistry?.get(message.filePath) || fileRegistry?.findByPath(message.filePath);
        const absolutePath = file?.getPath() || message.filePath;

        logger.debug(`[DebugCommands] closeVscodeDiff: frontendPath="${message.filePath}", absolutePath="${absolutePath}", fileFound=${!!file}`);

        await diffService.closeDiff(absolutePath);
        return this.success();
    }

    private async handleCloseAllVscodeDiffs(): Promise<CommandResult> {
        const diffService = KanbanDiffService.getInstance();
        await diffService.closeAllDiffs();
        return this.success();
    }

    // ============= FORCE WRITE / VERIFICATION HANDLERS =============

    private async handleForceWriteAllContent(context: CommandContext): Promise<CommandResult> {
        const panel = context.getWebviewPanel();
        if (!panel) {
            return this.success();
        }

        logger.warn('[DebugCommands] FORCE WRITE ALL: Starting emergency file write operation');

        let backupPath: string | undefined;
        try {
            const document = context.fileManager.getDocument();
            if (document && hasConflictService(panel)) {
                backupPath = await panel._conflictService.createUnifiedBackup(
                    document.uri.fsPath,
                    'force-write',
                    true
                );
            }
        } catch (error) {
            logger.error('[DebugCommands] Failed to create backup before force write:', error);
        }

        try {
            const fileRegistry = this.getFileRegistry();
            if (!fileRegistry?.forceWriteAll) {
                throw new Error('File registry not available or forceWriteAll method not found');
            }
            if (!fileRegistry.getMainFile()) {
                throw new Error('No main file registered - cannot force write');
            }

            const result = await fileRegistry.forceWriteAll();

            this.postMessage({
                type: 'forceWriteAllResult',
                success: result.errors.length === 0,
                filesWritten: result.filesWritten,
                errors: result.errors,
                backupCreated: !!backupPath,
                backupPath: backupPath,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            this.postMessage({
                type: 'forceWriteAllResult',
                success: false,
                filesWritten: 0,
                errors: [getErrorMessage(error)],
                backupCreated: false,
                timestamp: new Date().toISOString()
            });
        }
        return this.success();
    }

    private async handleVerifyContentSync(
        message: VerifyContentSyncMessage,
        _context: CommandContext
    ): Promise<CommandResult> {
        const frontendBoard = message.frontendBoard;
        if (!this.getPanel()) {
            return this.success();
        }

        try {
            const panel = this.getPanel() as PanelCommandAccess | undefined;
            await panel?.refreshMainFileContext?.('other');

            const fileRegistry = this.getFileRegistry();
            if (!fileRegistry) {
                throw new Error('File registry not available');
            }

            const allFiles = fileRegistry.getAll();
            const fileResults: VerifyContentSyncFileResult[] = [];
            let matchingFiles = 0;
            let mismatchedFiles = 0;
            let frontendSnapshot: VerifyContentSyncFrontendSnapshot | null = null;
            let duplicationVerification: DuplicationVerificationResult | null = null;
            let normalizedRegistryMainHash: string | null = null;
            let normalizedRegistryMainLength: number | null = null;
            let registryRawMainHash: string | null = null;
            let registryRawMainLength: number | null = null;
            if (frontendBoard && fileRegistry.getMainFile()) {
                try {
                    const registryMain = fileRegistry.getMainFile();
                    const registryContent = registryMain?.getContent() ?? '';
                    const frontendContent = MarkdownKanbanParser.generateMarkdown(frontendBoard as KanbanBoard);
                    const registryHash = this.computeHash(registryContent);
                    const frontendHash = this.computeHash(frontendContent);
                    registryRawMainHash = registryHash;
                    registryRawMainLength = registryContent.length;
                    const normalizedRegistry = this.normalizeMainContent(registryContent, registryMain?.getPath());
                    if (normalizedRegistry) {
                        normalizedRegistryMainHash = this.computeHash(normalizedRegistry.content);
                        normalizedRegistryMainLength = normalizedRegistry.content.length;
                    }
                    const compareHash = normalizedRegistryMainHash ?? registryHash;
                    const compareLength = normalizedRegistryMainLength ?? registryContent.length;
                    const matchesRaw = frontendHash === registryHash;
                    const matchesNormalized = normalizedRegistryMainHash ? frontendHash === normalizedRegistryMainHash : false;
                    const matchKind: 'raw' | 'normalized' | 'none' = matchesRaw
                        ? 'raw'
                        : (matchesNormalized ? 'normalized' : 'none');
                    frontendSnapshot = {
                        hash: frontendHash.substring(0, 8),
                        contentLength: frontendContent.length,
                        matchesRegistry: compareHash === frontendHash,
                        diffChars: Math.abs(frontendContent.length - compareLength),
                        registryLength: compareLength,
                        registryRawHash: registryRawMainHash?.substring(0, 8) ?? undefined,
                        registryRawLength: registryRawMainLength ?? undefined,
                        registryNormalizedHash: normalizedRegistryMainHash?.substring(0, 8) ?? undefined,
                        registryNormalizedLength: normalizedRegistryMainLength ?? undefined,
                        registryIsNormalized: normalizedRegistryMainHash !== null,
                        matchKind: matchKind
                    };
                } catch (error) {
                    logger.warn('[DebugCommands] Failed to generate frontend snapshot hash:', error);
                }
            }

            duplicationVerification = this.collectDuplicationVerification(fileRegistry, frontendBoard);

            for (const file of allFiles) {
                let canonicalContent: string;
                let savedFileContent: string | null = null;
                let frontendContent: string | null = null;
                let savedNormalizedHash: string | null = null;
                let savedNormalizedLength: number | null = null;
                let normalizedRegistryContent: string | null = null;
                let normalizedSavedContent: string | null = null;

                try {
                    if (fs.existsSync(file.getPath())) {
                        savedFileContent = fs.readFileSync(file.getPath(), 'utf8');
                    }
                } catch (error) {
                    logger.error(`[DebugCommands] Could not read saved file ${file.getPath()}:`, error);
                }

                canonicalContent = file.getContent();

                if (file.getFileType() === 'main' && frontendBoard) {
                    try {
                        frontendContent = MarkdownKanbanParser.generateMarkdown(frontendBoard as KanbanBoard);
                    } catch (error) {
                        logger.warn('[DebugCommands] Failed to generate frontend main markdown:', error);
                    }
                } else if (file.getFileType() !== 'main' && frontendBoard) {
                    frontendContent = this.resolveIncludeFrontendContentFromBoard(
                        frontendBoard as KanbanBoard,
                        file as IncludeFile
                    );
                }

                if (file.getFileType() === 'main') {
                    const normalizedRegistry = this.normalizeMainContent(canonicalContent, file.getPath());
                    normalizedRegistryContent = normalizedRegistry?.content ?? null;
                }

                const canonicalHash = this.computeHash(canonicalContent);
                const savedHash = savedFileContent !== null ? this.computeHash(savedFileContent) : null;
                const frontendHash = frontendContent ? this.computeHash(frontendContent) : null;

                const canonicalSavedMatch = savedHash ? canonicalHash === savedHash : true;
                let frontendRegistryMatch = frontendHash ? frontendHash === canonicalHash : null;
                let frontendRegistryDiff = frontendContent ? Math.abs(frontendContent.length - canonicalContent.length) : null;
                let frontendMatchesRaw = frontendHash ? frontendHash === canonicalHash : null;
                let frontendMatchesNormalized: boolean | null = null;
                if (file.getFileType() === 'main' && normalizedRegistryMainHash && frontendHash) {
                    frontendRegistryMatch = frontendHash === normalizedRegistryMainHash;
                    if (frontendContent && normalizedRegistryMainLength !== null) {
                        frontendRegistryDiff = Math.abs(frontendContent.length - normalizedRegistryMainLength);
                    }
                    frontendMatchesNormalized = frontendHash === normalizedRegistryMainHash;
                }
                if (file.getFileType() === 'main' && savedFileContent) {
                    const normalizedSaved = this.normalizeMainContent(savedFileContent, file.getPath());
                    if (normalizedSaved) {
                        savedNormalizedHash = this.computeHash(normalizedSaved.content);
                        savedNormalizedLength = normalizedSaved.content.length;
                        normalizedSavedContent = normalizedSaved.content;
                    }
                }
                const allMatch = canonicalSavedMatch;

                if (allMatch) {
                    matchingFiles++;
                } else {
                    mismatchedFiles++;
                }

                fileResults.push({
                    path: file.getPath(),
                    relativePath: file.getRelativePath(),
                    isMainFile: file.getFileType() === 'main',
                    matches: allMatch,
                    canonicalSavedMatch,
                    canonicalContentLength: canonicalContent.length,
                    savedContentLength: savedFileContent?.length ?? null,
                    canonicalSavedDiff: savedFileContent ? Math.abs(canonicalContent.length - savedFileContent.length) : null,
                    canonicalHash: canonicalHash.substring(0, 8),
                    savedHash: savedHash?.substring(0, 8) ?? null,
                    registryNormalizedHash: file.getFileType() === 'main' && normalizedRegistryMainHash
                        ? normalizedRegistryMainHash.substring(0, 8)
                        : null,
                    registryNormalizedLength: file.getFileType() === 'main' && normalizedRegistryMainLength !== null
                        ? normalizedRegistryMainLength
                        : null,
                    frontendHash: frontendHash ? frontendHash.substring(0, 8) : null,
                    frontendContentLength: frontendContent ? frontendContent.length : null,
                    frontendRegistryMatch: frontendRegistryMatch,
                    frontendRegistryDiff: frontendRegistryDiff,
                    frontendMatchesRaw: frontendMatchesRaw,
                    frontendMatchesNormalized: frontendMatchesNormalized,
                    savedNormalizedHash: savedNormalizedHash ? savedNormalizedHash.substring(0, 8) : null,
                    savedNormalizedLength: savedNormalizedLength,
                    frontendAvailable: !!frontendContent
                });

                if (file.getFileType() === 'main' && frontendContent) {
                    const panelDebug = panel?.getDebugMode?.() ?? false;
                    if (panelDebug) {
                        this.logContentDiff('[DebugCommands] main.raw vs normalized', canonicalContent, normalizedRegistryContent);
                        if (savedFileContent) {
                            this.logContentDiff('[DebugCommands] main.saved raw vs normalized', savedFileContent, normalizedSavedContent);
                        }
                        this.logContentDiff('[DebugCommands] main.frontend vs normalized', frontendContent, normalizedRegistryContent);
                        this.logContentDiff('[DebugCommands] main.frontend vs saved raw', frontendContent, savedFileContent);
                    }
                }
            }

            this.postMessage({
                type: 'verifyContentSyncResult',
                success: true,
                timestamp: new Date().toISOString(),
                totalFiles: allFiles.length,
                matchingFiles: matchingFiles,
                mismatchedFiles: mismatchedFiles,
                missingFiles: 0,
                fileResults: fileResults,
                frontendSnapshot: frontendSnapshot,
                duplicationVerification,
                summary: `${matchingFiles} files match, ${mismatchedFiles} differ`
            });
        } catch (error) {
            this.postMessage({
                type: 'verifyContentSyncResult',
                success: false,
                timestamp: new Date().toISOString(),
                totalFiles: 0,
                matchingFiles: 0,
                mismatchedFiles: 0,
                missingFiles: 0,
                fileResults: [],
                duplicationVerification: null,
                summary: `Verification failed: ${getErrorMessage(error)}`
            });
        }
        return this.success();
    }

    // ============= DEBUG INFO HANDLERS =============

    private async handleGetTrackedFilesDebugInfo(context: CommandContext): Promise<CommandResult> {
        if (!this.getPanel()) {
            return this.success();
        }

        const debugData = await this.collectTrackedFilesDebugInfo(context);
        this.postMessage({
            type: 'trackedFilesDebugInfo',
            data: debugData
        });
        return this.success();
    }

    private async handleClearTrackedFilesCache(context: CommandContext): Promise<CommandResult> {
        const panel = context.getWebviewPanel();
        if (!panel) {
            return this.success();
        }

        try {
            const fileRegistry = this.getFileRegistry();
            if (fileRegistry) {
                const includeFiles = fileRegistry.getIncludeFiles();
                for (const file of includeFiles) {
                    fileRegistry.unregister(file.getPath());
                }
            }

            const document = context.fileManager.getDocument();
            const panelAccess = panel as PanelCommandAccess;
            if (document && panelAccess.loadMarkdownFile) {
                await panelAccess.loadMarkdownFile(document, false);
            }
        } catch (error) {
            logger.warn('[DebugCommands] Error clearing panel caches:', error);
        }

        this.postMessage({
            type: 'debugCacheCleared'
        });
        return this.success();
    }

    private async handleGetMediaTrackingStatus(
        message: GetMediaTrackingStatusMessage,
        context: CommandContext
    ): Promise<CommandResult> {
        const filePath = message.filePath;
        const mediaTracker = context.getMediaTracker?.();
        const fileName = filePath ? path.basename(filePath) : '';

        if (!mediaTracker) {
            this.postMessage({
                type: 'mediaTrackingStatus',
                filePath,
                tracked: false,
                error: 'MediaTracker not available',
                trackedFiles: []
            });
            return this.success();
        }

        const trackedFiles = mediaTracker.getTrackedFiles();

        // Find matching entries (by exact path or filename match)
        const matches = trackedFiles.filter(f => {
            const trackedName = path.basename(f.path);
            return f.path === filePath || trackedName === fileName;
        });

        // Get current disk mtime for matched files
        const matchDetails = matches.map(m => {
            let currentMtime: number | null = null;
            try {
                const absPath = path.isAbsolute(m.path)
                    ? m.path
                    : path.resolve(path.dirname(context.fileManager.getDocument()?.uri.fsPath || ''), m.path);
                const stats = fs.statSync(absPath);
                currentMtime = stats.mtimeMs;
            } catch { /* file may not exist */ }

            return {
                path: m.path,
                type: m.type,
                cachedMtime: m.mtime,
                currentMtime,
                mtimeDiffers: currentMtime !== null && currentMtime !== m.mtime,
                mtimeDiffMs: currentMtime !== null ? currentMtime - m.mtime : null
            };
        });

        this.postMessage({
            type: 'mediaTrackingStatus',
            filePath,
            tracked: matches.length > 0,
            matches: matchDetails,
            totalTrackedFiles: trackedFiles.length,
            allTrackedPaths: trackedFiles.map(f => `${f.path} (${f.type})`)
        });

        return this.success();
    }

    // ============= HELPER METHODS =============

    private _markPendingBatchActionsFailed(
        results: BatchFileActionResult[],
        plannedActions: Array<{ resultIndex: number }>,
        reason: string
    ): void {
        for (const pendingPlan of plannedActions) {
            const pendingResult = results[pendingPlan.resultIndex];
            if (pendingResult.status === 'skipped' && !pendingResult.error) {
                pendingResult.status = 'failed';
                pendingResult.error = reason;
            }
        }
    }

    private computeHash(content: string): string {
        return createHash('sha256').update(content, 'utf8').digest('hex');
    }

    private collectDuplicationVerification(
        fileRegistry: MarkdownFileRegistry,
        frontendBoard: unknown
    ): DuplicationVerificationResult {
        const issues: DuplicationVerificationIssue[] = [];
        const copies: DuplicationCopyState[] = [];

        const registryConsistency = fileRegistry.getConsistencyReport();
        registryConsistency.issues.forEach(issue => {
            issues.push({
                code: issue.code,
                severity: issue.severity,
                message: issue.message,
                details: issue.details
            });
        });

        const mainFile = fileRegistry.getMainFile();
        const frontendCopy = this.createBoardCopyState('frontend-board', frontendBoard);
        const cachedCopy = this.createBoardCopyState('main-cached-board', mainFile?.getCachedBoardFromWebview?.());
        const parsedCopy = this.createBoardCopyState('main-parsed-board', mainFile?.getBoard?.());
        const registryContentCopy = this.createContentCopyState('main-registry-content', mainFile?.getContent?.() ?? null);

        copies.push(frontendCopy, cachedCopy, parsedCopy, registryContentCopy);

        this.addCopyMismatchIssue(issues, 'frontend-vs-main-cache', frontendCopy, cachedCopy);
        this.addCopyMismatchIssue(issues, 'frontend-vs-main-parsed', frontendCopy, parsedCopy);
        this.addCopyMismatchIssue(issues, 'frontend-vs-main-content', frontendCopy, registryContentCopy);
        this.addCopyMismatchIssue(issues, 'main-cache-vs-main-content', cachedCopy, registryContentCopy);
        this.addCopyMismatchIssue(issues, 'main-cache-vs-main-parsed', cachedCopy, parsedCopy);
        this.addCopyMismatchIssue(issues, 'main-parsed-vs-main-content', parsedCopy, registryContentCopy);

        return {
            copies,
            issueCount: issues.length,
            issues
        };
    }

    private createBoardCopyState(id: string, board: unknown): DuplicationCopyState {
        const markdown = this.tryGenerateMarkdownFromBoard(board);
        if (markdown === null) {
            return {
                id,
                available: false,
                hash: null,
                length: null
            };
        }
        return this.createContentCopyState(id, markdown);
    }

    private createContentCopyState(id: string, content: string | null): DuplicationCopyState {
        if (content === null) {
            return {
                id,
                available: false,
                hash: null,
                length: null
            };
        }

        return {
            id,
            available: true,
            hash: this.computeHash(content),
            length: content.length
        };
    }

    private addCopyMismatchIssue(
        issues: DuplicationVerificationIssue[],
        code: string,
        left: DuplicationCopyState,
        right: DuplicationCopyState
    ): void {
        if (!left.available || !right.available) {
            return;
        }
        if (left.hash === right.hash) {
            return;
        }

        issues.push({
            code,
            severity: 'warning',
            message: `State copies diverged (${left.id} != ${right.id}).`,
            details: {
                left: { id: left.id, hash: left.hash, length: left.length },
                right: { id: right.id, hash: right.hash, length: right.length }
            }
        });
    }

    private tryGenerateMarkdownFromBoard(board: unknown): string | null {
        if (!board || typeof board !== 'object') {
            return null;
        }
        const candidate = board as Partial<KanbanBoard>;
        if (!Array.isArray(candidate.columns)) {
            return null;
        }

        try {
            return MarkdownKanbanParser.generateMarkdown(candidate as KanbanBoard);
        } catch {
            return null;
        }
    }

    private resolveIncludeFrontendContentFromBoard(
        frontendBoard: KanbanBoard,
        file: IncludeFile
    ): string | null {
        const fileType = file.getFileType();
        const candidates = this.buildIncludePathCandidates(file.getRelativePath(), file.getPath());

        if (fileType === 'include-column') {
            const matches = frontendBoard.columns.filter(column =>
                column.includeFiles?.some(includePath => this.matchesIncludePath(includePath, candidates))
            );
            if (matches.length === 0) {
                return null;
            }
            const contents = matches.map(column => file.generateFromTasks(column.cards));
            return this.ensureConsistentIncludeContent(contents, 'include-column', file.getRelativePath());
        }

        return null;
    }

    private buildIncludePathCandidates(relativePath: string, absolutePath: string): Set<string> {
        const candidates = new Set<string>();
        const decodedRelative = safeDecodeURIComponent(relativePath || '');
        const decodedAbsolute = safeDecodeURIComponent(absolutePath || '');
        const normalizedRelative = this.normalizePath(decodedRelative);
        const normalizedAbsolute = this.normalizePath(decodedAbsolute);

        if (relativePath) candidates.add(relativePath);
        if (absolutePath) candidates.add(absolutePath);
        if (decodedRelative) candidates.add(decodedRelative);
        if (decodedAbsolute) candidates.add(decodedAbsolute);
        if (normalizedRelative) candidates.add(normalizedRelative);
        if (normalizedAbsolute) candidates.add(normalizedAbsolute);

        const baseName = normalizedRelative.split('/').pop() || normalizedAbsolute.split('/').pop();
        if (baseName) {
            candidates.add(baseName);
        }

        return candidates;
    }

    private matchesIncludePath(includePath: string, candidates: Set<string>): boolean {
        const decoded = safeDecodeURIComponent(includePath || '');
        const normalized = this.normalizePath(decoded);
        if (candidates.has(includePath) || candidates.has(decoded) || candidates.has(normalized)) {
            return true;
        }
        const baseName = normalized.split('/').pop();
        if (baseName && candidates.has(baseName)) {
            return true;
        }
        return false;
    }

    private ensureConsistentIncludeContent(contents: string[], fileType: string, relativePath: string): string {
        if (contents.length === 0) {
            return '';
        }
        const unique = new Set(contents);
        if (unique.size > 1) {
            logger.warn(`[DebugCommands] ${fileType} include has inconsistent frontend content: ${relativePath}`);
        }
        return contents[0];
    }

    private normalizeMainContent(content: string, mainFilePath?: string): { content: string } | null {
        try {
            const basePath = mainFilePath ? path.dirname(mainFilePath) : undefined;
            const parsed = MarkdownKanbanParser.parseMarkdown(content, basePath, undefined, mainFilePath);
            if (!parsed.board?.valid) {
                return null;
            }
            return { content: MarkdownKanbanParser.generateMarkdown(parsed.board) };
        } catch (error) {
            logger.warn('[DebugCommands] Failed to normalize registry content:', error);
            return null;
       }
    }

    private logContentDiff(label: string, left: string | null, right: string | null): void {
        if (left === null || right === null) {
            return;
        }
        if (left === right) {
            return;
        }
        const diff = this.getFirstDiffSnippet(left, right);
        if (!diff) {
            return;
        }
        const leftLine = this.getLineAtIndex(left, diff.index);
        const rightLine = this.getLineAtIndex(right, diff.index);
        logger.debug(label, {
            leftLength: left.length,
            rightLength: right.length,
            diffIndex: diff.index,
            leftSnippet: diff.leftSnippet,
            rightSnippet: diff.rightSnippet,
            leftLine: leftLine ? { line: leftLine.line, text: JSON.stringify(leftLine.text) } : null,
            rightLine: rightLine ? { line: rightLine.line, text: JSON.stringify(rightLine.text) } : null,
            leftTrailing: this.getTrailingBlankInfo(left),
            rightTrailing: this.getTrailingBlankInfo(right),
            leftTailLines: this.getTailLines(left, 3),
            rightTailLines: this.getTailLines(right, 3)
        });
    }

    private getFirstDiffSnippet(left: string, right: string, context = 40): { index: number; leftSnippet: string; rightSnippet: string } | null {
        const minLen = Math.min(left.length, right.length);
        let index = 0;
        while (index < minLen && left.charCodeAt(index) === right.charCodeAt(index)) {
            index++;
        }
        if (index === minLen && left.length === right.length) {
            return null;
        }
        const start = Math.max(0, index - context);
        const leftEnd = Math.min(left.length, index + context);
        const rightEnd = Math.min(right.length, index + context);
        return {
            index,
            leftSnippet: JSON.stringify(left.slice(start, leftEnd)),
            rightSnippet: JSON.stringify(right.slice(start, rightEnd))
        };
    }

    private getLineAtIndex(content: string, index: number): { line: number; text: string } | null {
        if (index < 0 || index > content.length) {
            return null;
        }
        let line = 1;
        let lastBreak = -1;
        for (let i = 0; i < index; i++) {
            if (content.charCodeAt(i) === 10) {
                line++;
                lastBreak = i;
            }
        }
        const nextBreak = content.indexOf('\n', index);
        const lineEnd = nextBreak === -1 ? content.length : nextBreak;
        const lineText = content.slice(lastBreak + 1, lineEnd);
        return { line, text: lineText };
    }

    private getTrailingBlankInfo(content: string): { trailingBlankLines: number; trailingIndentBlankLines: number; trailingWhitespaceChars: number } {
        const lines = content.split('\n');
        let trailingBlankLines = 0;
        let trailingIndentBlankLines = 0;
        for (let i = lines.length - 1; i >= 0; i--) {
            const line = lines[i];
            if (line.trim() === '') {
                trailingBlankLines++;
                if (line === '  ') {
                    trailingIndentBlankLines++;
                }
            } else {
                break;
            }
        }
        const match = content.match(/\s+$/);
        const trailingWhitespaceChars = match ? match[0].length : 0;
        return {
            trailingBlankLines,
            trailingIndentBlankLines,
            trailingWhitespaceChars
        };
    }

    private getTailLines(content: string, count: number): string[] {
        const lines = content.split('\n');
        const tail = lines.slice(Math.max(0, lines.length - count));
        return tail.map(line => JSON.stringify(line));
    }

    private normalizePath(filePath: string): string {
        return filePath.replace(/\\/g, '/').replace(/^\.\//, '');
    }

    private async collectTrackedFilesDebugInfo(context: CommandContext): Promise<TrackedFilesDebugInfo> {
        const document = context.fileManager.getDocument();
        const panel = context.getWebviewPanel?.() as PanelCommandAccess | undefined;
        await panel?.refreshMainFileContext?.('other');
        const fileRegistry = this.getFileRegistry();
        const mainFile = fileRegistry?.getMainFile();

        const mainFilePath = panel?.getCanonicalMainFilePath?.() || mainFile?.getPath() || 'Unknown';
        const mainBaseline = mainFile?.getBaseline() || '';
        const trackedFiles = fileRegistry?.getAll() || [];
        const activeWatcherCount = trackedFiles.filter(file => file.isWatcherActive()).length;
        const lastDocumentVersion = panel?.getLastDocumentVersion?.() ?? -1;

        const mainFileInfo = {
            path: mainFilePath,
            lastModified: mainFile?.getLastModified()?.toISOString() || 'Unknown',
            exists: mainFile?.exists() ?? false,
            lastAccessErrorCode: mainFile?.getLastAccessErrorCode?.() ?? null,
            watcherActive: mainFile?.isWatcherActive() ?? false,
            hasInternalChanges: mainFile?.hasUnsavedChanges() ?? false,
            hasAnyUnsavedChanges: mainFile?.hasAnyUnsavedChanges() ?? false,
            hasExternalChanges: mainFile?.hasExternalChanges() ?? false,
            documentVersion: document?.version ?? 0,
            lastDocumentVersion: lastDocumentVersion,
            isUnsavedInEditor: mainFile?.isDirtyInEditor() ?? document?.isDirty ?? false,
            baselineLength: mainBaseline.length,
            baselineHash: this.computeHash(mainBaseline).substring(0, 8)
        };

        const includeFiles: IncludeFileDebugInfo[] = [];
        const allIncludeFiles = fileRegistry?.getIncludeFiles() || [];
        const snapshotToken = fileRegistry
            ? computeTrackedFilesSnapshotToken(fileRegistry)
            : null;

        for (const file of allIncludeFiles) {
            const fileContent = file.getContent();
            const fileBaseline = file.getBaseline();
            includeFiles.push({
                path: file.getRelativePath(),
                type: file.getFileType(),
                exists: file.exists(),
                lastAccessErrorCode: file.getLastAccessErrorCode?.() ?? null,
                lastModified: file.getLastModified()?.toISOString() || 'Unknown',
                size: 'Unknown',
                hasInternalChanges: file.hasUnsavedChanges(),
                hasAnyUnsavedChanges: file.hasAnyUnsavedChanges(),
                hasExternalChanges: file.hasExternalChanges(),
                isUnsavedInEditor: file.isDirtyInEditor(),
                contentLength: fileContent.length,
                baselineLength: fileBaseline.length,
                contentHash: this.computeHash(fileContent).substring(0, 8),
                baselineHash: this.computeHash(fileBaseline).substring(0, 8)
            });
        }

        const conflictManager = {
            healthy: true,
            trackedFiles: trackedFiles.length,
            activeWatchers: activeWatcherCount,
            pendingConflicts: 0,
            watcherFailures: 0,
            listenerEnabled: true,
            documentSaveListenerActive: true
        };

        const systemHealth = {
            overall: includeFiles.length > 0 ? 'good' : 'warn',
            extensionState: 'active',
            memoryUsage: 'normal',
            lastError: null
        };

        // Check for unsaved changes via file registry
        const hasUnsavedChanges = fileRegistry
            ? fileRegistry.getAll().some(file => file.hasAnyUnsavedChanges())
            : false;

        return {
            mainFile: mainFileInfo.path,
            mainFileLastModified: mainFileInfo.lastModified,
            snapshotToken,
            fileWatcherActive: mainFileInfo.watcherActive,
            includeFiles: includeFiles,
            conflictManager: conflictManager,
            systemHealth: systemHealth,
            hasUnsavedChanges: hasUnsavedChanges,
            timestamp: new Date().toISOString(),
            watcherDetails: mainFileInfo
        };
    }
}
