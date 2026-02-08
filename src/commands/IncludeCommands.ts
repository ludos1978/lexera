/**
 * Include Commands
 *
 * Handles include file-related message operations:
 * - confirmDisableIncludeMode
 * - requestIncludeFile, registerInlineInclude
 * - requestIncludeFileName, requestEditIncludeFileName
 * - requestEditTaskIncludeFileName, requestTaskIncludeFileName
 * - reloadAllIncludedFiles
 * - saveIndividualFile, reloadIndividualFile
 *
 * Debug commands (forceWriteAllContent, verifyContentSync, etc.) have been
 * moved to DebugCommands.ts for cleaner separation of concerns.
 *
 * @module commands/IncludeCommands
 */

import { SwitchBasedCommand, CommandContext, CommandMetadata, CommandResult, MessageHandler } from './interfaces';
import {
    ConfirmDisableIncludeModeMessage,
    RequestIncludeFileNameMessage,
    RequestEditIncludeFileNameMessage,
    RequestEditTaskIncludeFileNameMessage
} from '../core/bridge/MessageTypes';
import { PathResolver } from '../services/PathResolver';
import { ExportService } from '../services/export/ExportService';
import { safeFileUri, getErrorMessage, selectMarkdownFile } from '../utils';
import { PanelCommandAccess, hasIncludeFileMethods } from '../types/PanelCommandAccess';
import { showError, showWarning, showInfo } from '../services/NotificationService';
import { MarkdownFile } from '../files/MarkdownFile';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { computeTrackedFilesSnapshotToken } from '../utils/fileStateSnapshot';

type SaveResolutionAction = 'overwrite' | 'overwrite_backup_external';
type ReloadResolutionAction = 'load_external' | 'load_external_backup_mine';

/**
 * Include Commands Handler
 *
 * Processes include file-related messages from the webview.
 */
export class IncludeCommands extends SwitchBasedCommand {
    private _fileActionQueue: Promise<void> = Promise.resolve();

    readonly metadata: CommandMetadata = {
        id: 'include-commands',
        name: 'Include Commands',
        description: 'Handles include file operations, tracking, and synchronization',
        messageTypes: [
            'confirmDisableIncludeMode',
            'requestIncludeFile',
            'registerInlineInclude',
            'requestIncludeFileName',
            'requestEditIncludeFileName',
            'requestEditTaskIncludeFileName',
            'requestTaskIncludeFileName',
            'reloadAllIncludedFiles',
            'saveIndividualFile',
            'reloadIndividualFile'
        ],
        priority: 100
    };

    protected handlers: Record<string, MessageHandler> = {
        'confirmDisableIncludeMode': (msg, ctx) => this.handleConfirmDisableIncludeMode(msg as ConfirmDisableIncludeModeMessage, ctx),
        'requestIncludeFile': (msg, ctx) => this.handleRequestIncludeFile((msg as any).filePath ?? '', ctx),
        'registerInlineInclude': (msg, ctx) => this.handleRegisterInlineInclude((msg as any).filePath, (msg as any).content, ctx),
        'requestIncludeFileName': (msg, ctx) => this.handleRequestIncludeFileName(msg as RequestIncludeFileNameMessage, ctx),
        'requestEditIncludeFileName': (msg, ctx) => this.handleRequestEditIncludeFileName(msg as RequestEditIncludeFileNameMessage, ctx),
        'requestEditTaskIncludeFileName': (msg, ctx) => this.handleRequestEditTaskIncludeFileName(msg as RequestEditTaskIncludeFileNameMessage, ctx),
        'requestTaskIncludeFileName': (msg, ctx) => this.handleRequestTaskIncludeFileName((msg as any).taskId, (msg as any).columnId, ctx),
        'reloadAllIncludedFiles': (_msg, ctx) => this.handleReloadAllIncludedFiles(ctx),
        'saveIndividualFile': (msg, ctx) => this.handleQueuedSaveIndividualFile(msg as any, ctx),
        'reloadIndividualFile': (msg, ctx) => this.handleQueuedReloadIndividualFile(msg as any, ctx)
    };

    // ============= HELPER METHODS =============

    /**
     * Prompt user about unsaved changes before switching include files.
     * @returns 'continue' to proceed, 'cancel' to abort the operation
     */
    private async promptUnsavedChanges(
        file: import('../files/MarkdownFile').MarkdownFile,
        currentFile: string,
        context: CommandContext,
        fileType: 'include' | 'task include' = 'include'
    ): Promise<'continue' | 'cancel'> {
        if (!file.hasUnsavedChanges() || !file.exists()) {
            return 'continue';
        }

        const choice = await vscode.window.showWarningMessage(
            `The current ${fileType} file "${currentFile}" has unsaved changes. What would you like to do?`,
            { modal: true },
            'Save and Switch',
            'Discard and Switch',
            'Cancel'
        );

        if (choice === 'Save and Switch') {
            await context.fileSaveService.saveFile(file);
            return 'continue';
        } else if (choice === 'Discard and Switch') {
            file.discardChanges();
            return 'continue';
        }
        return 'cancel';
    }

    /**
     * Get relative path from file selection result.
     * @returns Relative path if file was selected, null otherwise
     */
    private getSelectedRelativePath(fileUris: vscode.Uri[] | undefined, currentDir: string): string | null {
        if (!fileUris || fileUris.length === 0) {
            return null;
        }
        return path.relative(currentDir, fileUris[0].fsPath);
    }

    /**
     * Build default URI for file picker, optionally using current file location.
     */
    private buildDefaultUri(currentDir: string, currentFile: string | undefined, label: string): vscode.Uri {
        if (currentFile) {
            const currentAbsolutePath = path.resolve(currentDir, currentFile);
            if (fs.existsSync(currentAbsolutePath)) {
                return safeFileUri(currentAbsolutePath, `${label}-file`);
            }
        }
        return safeFileUri(currentDir, `${label}-dir`);
    }

    /**
     * Get current file directory or return error result.
     * @returns Object with currentDir if successful, or null if no active file
     */
    private getCurrentDir(context: CommandContext): string | null {
        const currentFilePath = context.fileManager.getFilePath();
        if (!currentFilePath) {
            showError('No active kanban file');
            return null;
        }
        return path.dirname(currentFilePath);
    }

    /**
     * Trigger marpWatch export if active.
     * Used after saving files to trigger automatic export.
     */
    private async triggerMarpWatchExport(context: CommandContext, panelAccess: PanelCommandAccess): Promise<void> {
        const autoExportSettings = context.getAutoExportSettings();
        if (!autoExportSettings?.marpWatch) {
            return;
        }

        let document = context.fileManager.getDocument();
        const filePathForReopen = context.fileManager.getFilePath();

        if (!document && filePathForReopen) {
            try {
                document = await vscode.workspace.openTextDocument(filePathForReopen);
            } catch (error) {
                console.error(`[IncludeCommands] Failed to reopen document:`, error);
                return;
            }
        }

        if (!document) {
            return;
        }

        const fileService = panelAccess._fileService;
        const board = fileService?.board?.();

        try {
            const webviewPanel = context.getWebviewPanel();
            await ExportService.export(document, autoExportSettings, board, webviewPanel);
        } catch (error) {
            console.error('[IncludeCommands] MarpWatch export failed:', error);
        }
    }

    private _isSaveResolutionAction(action: unknown): action is SaveResolutionAction {
        return action === 'overwrite' || action === 'overwrite_backup_external';
    }

    private _isReloadResolutionAction(action: unknown): action is ReloadResolutionAction {
        return action === 'load_external' || action === 'load_external_backup_mine';
    }

    private _resolveTargetFile(filePath: string, isMainFile: boolean, context: CommandContext): MarkdownFile {
        const fileRegistry = this.getFileRegistry();
        if (!fileRegistry) {
            throw new Error('File registry not available');
        }

        if (isMainFile) {
            const mainFile = fileRegistry.getMainFile();
            if (!mainFile) {
                throw new Error('Main file not found in registry');
            }
            return mainFile;
        }

        const document = context.fileManager.getDocument();
        const absolutePath = filePath.startsWith('/')
            ? filePath
            : document
                ? path.join(path.dirname(document.uri.fsPath), filePath)
                : filePath;

        const file = fileRegistry.findByPath(filePath) || fileRegistry.get(absolutePath);
        if (!file) {
            throw new Error(`File not found in registry: ${filePath}`);
        }

        // CRITICAL FIX: Type guard to prevent accidental treatment of MainKanbanFile as include
        if (file.getFileType() === 'main') {
            throw new Error(`Cannot access main file as include: ${filePath}`);
        }

        return file;
    }

    private async _notifyBackupCreated(backupPath: string, prefix: string): Promise<void> {
        const fileName = path.basename(backupPath);
        const choice = await vscode.window.showInformationMessage(
            `${prefix}: ${fileName}`,
            'Open Backup'
        );
        if (choice === 'Open Backup') {
            const document = await vscode.workspace.openTextDocument(backupPath);
            await vscode.window.showTextDocument(document);
        }
    }

    private _validateSnapshotToken(snapshotToken: string | undefined, context: CommandContext): string | null {
        const fileRegistry = this.getFileRegistry();
        if (!fileRegistry) {
            return 'File registry not available';
        }

        if (!snapshotToken) {
            return 'Action blocked: file-state snapshot missing. Refresh File Manager and try again.';
        }

        const currentToken = computeTrackedFilesSnapshotToken(fileRegistry);
        if (snapshotToken !== currentToken) {
            return 'Action blocked: file states changed since the last refresh. Refresh File Manager and review actions again.';
        }

        return null;
    }

    private _enqueueFileAction(action: () => Promise<CommandResult>): Promise<CommandResult> {
        const queued = this._fileActionQueue.then(action, action);
        this._fileActionQueue = queued.then(() => undefined, () => undefined);
        return queued;
    }

    private handleQueuedSaveIndividualFile(message: any, context: CommandContext): Promise<CommandResult> {
        return this._enqueueFileAction(async () => {
            const snapshotValidationError = this._validateSnapshotToken(message.snapshotToken, context);
            if (snapshotValidationError) {
                this.postMessage({
                    type: 'individualFileSaved',
                    filePath: message.filePath,
                    isMainFile: message.isMainFile,
                    success: false,
                    forceSave: message.forceSave,
                    action: message.action,
                    error: snapshotValidationError
                });
                return this.success();
            }

            return this.handleSaveIndividualFile(
                message.filePath,
                message.isMainFile,
                message.forceSave,
                message.action,
                context
            );
        });
    }

    private handleQueuedReloadIndividualFile(message: any, context: CommandContext): Promise<CommandResult> {
        return this._enqueueFileAction(async () => {
            const snapshotValidationError = this._validateSnapshotToken(message.snapshotToken, context);
            if (snapshotValidationError) {
                this.postMessage({
                    type: 'individualFileReloaded',
                    filePath: message.filePath,
                    isMainFile: message.isMainFile,
                    success: false,
                    action: message.action,
                    error: snapshotValidationError
                });
                return this.success();
            }

            return this.handleReloadIndividualFile(
                message.filePath,
                message.isMainFile,
                message.action,
                context
            );
        });
    }

    // ============= INCLUDE MODE HANDLERS =============

    private async handleConfirmDisableIncludeMode(message: ConfirmDisableIncludeModeMessage, _context: CommandContext): Promise<CommandResult> {
        const confirmation = await vscode.window.showWarningMessage(
            message.message,
            { modal: true },
            'Disable Include Mode',
            'Cancel'
        );

        if (confirmation === 'Disable Include Mode') {
            this.postMessage({
                type: 'proceedDisableIncludeMode',
                columnId: message.columnId
            });
        }
        return this.success();
    }

    private async handleRequestIncludeFile(filePath: string, context: CommandContext): Promise<CommandResult> {
        if (!this.getPanel()) {
            return this.failure('No webview panel available');
        }

        const document = context.fileManager.getDocument();
        if (!document) {
            return this.failure('No current document available');
        }

        const basePath = path.dirname(document.uri.fsPath);
        const absolutePath = PathResolver.resolve(basePath, filePath);

        try {
            if (!fs.existsSync(absolutePath)) {
                this.postMessage({
                    type: 'includeFileContent',
                    filePath: filePath,
                    content: null,
                    error: `File not found: ${filePath}`
                });
                return this.success();
            }

            const content = fs.readFileSync(absolutePath, 'utf8');
            this.postMessage({
                type: 'includeFileContent',
                filePath: filePath,
                content: content
            });
        } catch (fileError) {
            this.postMessage({
                type: 'includeFileContent',
                filePath: filePath,
                content: null,
                error: `Error reading file: ${filePath}`
            });
        }
        return this.success();
    }

    private async handleRegisterInlineInclude(filePath: string, content: string | null, context: CommandContext): Promise<CommandResult> {
        const panel = context.getWebviewPanel();
        if (!panel || !hasIncludeFileMethods(panel)) {
            return this.success();
        }
        const panelAccess = panel as PanelCommandAccess;
        if (!panelAccess.ensureIncludeFileRegistered) {
            return this.success();
        }

        let relativePath = filePath;
        if (!path.isAbsolute(relativePath) && !relativePath.startsWith('.')) {
            relativePath = './' + relativePath;
        }

        panelAccess.ensureIncludeFileRegistered(relativePath, 'regular');

        const fileRegistry = this.getFileRegistry();
        const updateInclude = (): boolean => {
            const includeFile = fileRegistry?.getByRelativePath(relativePath);
            if (!includeFile || includeFile.getFileType() === 'main') {
                return false;
            }

            if (content !== null && content !== undefined) {
                includeFile.setContent(content, true);
                includeFile.setExists(true);
            } else if (content === null) {
                includeFile.setExists(false);
            }

            return true;
        };

        if (!updateInclude()) {
            setTimeout(() => {
                updateInclude();
            }, 0);
        }
        return this.success();
    }

    // ============= FILE PICKER HANDLERS =============

    private async handleRequestIncludeFileName(message: RequestIncludeFileNameMessage, context: CommandContext): Promise<CommandResult> {
        const currentDir = this.getCurrentDir(context);
        if (!currentDir) { return this.success(); }

        const fileUris = await selectMarkdownFile({
            defaultUri: safeFileUri(currentDir, 'includeCommands-selectColumnInclude'),
            title: 'Select include file for column'
        });

        const relativePath = this.getSelectedRelativePath(fileUris, currentDir);
        if (relativePath) {
            this.postMessage({
                type: 'proceedEnableIncludeMode',
                columnId: message.columnId,
                fileName: relativePath
            });
        }
        return this.success();
    }

    private async handleRequestEditIncludeFileName(message: RequestEditIncludeFileNameMessage, context: CommandContext): Promise<CommandResult> {
        const currentFile = message.currentFile || '';
        const fileRegistry = this.getFileRegistry();
        const file = fileRegistry?.getByRelativePath(currentFile);

        // Only prompt if file was ever loaded (exists() is cached). Skip for broken includes.
        if (file && await this.promptUnsavedChanges(file, currentFile, context, 'include') === 'cancel') {
            return this.success();
        }

        const currentDir = this.getCurrentDir(context);
        if (!currentDir) { return this.success(); }

        const fileUris = await selectMarkdownFile({
            defaultUri: this.buildDefaultUri(currentDir, currentFile, 'includeCommands-changeColumnInclude'),
            title: 'Select new include file for column'
        });

        const relativePath = this.getSelectedRelativePath(fileUris, currentDir);
        if (relativePath) {
            this.postMessage({
                type: 'proceedUpdateIncludeFile',
                columnId: message.columnId,
                newFileName: relativePath,
                currentFile: currentFile
            });
        }
        return this.success();
    }

    private async handleRequestEditTaskIncludeFileName(message: RequestEditTaskIncludeFileNameMessage, context: CommandContext): Promise<CommandResult> {
        const currentFile = message.currentFile || '';
        const taskId = message.taskId;
        const columnId = message.columnId;

        const fileRegistry = this.getFileRegistry();
        const file = fileRegistry?.getByRelativePath(currentFile);

        // Only prompt if file was ever loaded (exists() is cached). Skip for broken includes.
        if (file && await this.promptUnsavedChanges(file, currentFile, context, 'task include') === 'cancel') {
            return this.success();
        }

        const currentDir = this.getCurrentDir(context);
        if (!currentDir) { return this.success(); }

        const fileUris = await selectMarkdownFile({
            defaultUri: this.buildDefaultUri(currentDir, currentFile, 'includeCommands-changeTaskInclude'),
            title: 'Select new include file for task'
        });

        const relativePath = this.getSelectedRelativePath(fileUris, currentDir);
        if (relativePath) {
            this.postMessage({
                type: 'proceedUpdateTaskIncludeFile',
                taskId: taskId,
                columnId: columnId,
                newFileName: relativePath,
                currentFile: currentFile
            });
        }
        return this.success();
    }

    private async handleRequestTaskIncludeFileName(taskId: string, columnId: string, context: CommandContext): Promise<CommandResult> {
        const currentDir = this.getCurrentDir(context);
        if (!currentDir) { return this.success(); }

        const fileUris = await selectMarkdownFile({
            defaultUri: safeFileUri(currentDir, 'includeCommands-selectTaskInclude'),
            title: 'Select include file for task'
        });

        const relativePath = this.getSelectedRelativePath(fileUris, currentDir);
        if (relativePath) {
            this.postMessage({
                type: 'enableTaskIncludeMode',
                taskId: taskId,
                columnId: columnId,
                fileName: relativePath
            });
        }
        return this.success();
    }

    // ============= FILE RELOAD/SAVE HANDLERS =============

    private async handleReloadAllIncludedFiles(context: CommandContext): Promise<CommandResult> {
        const panel = context.getWebviewPanel();
        if (!panel || !hasIncludeFileMethods(panel)) {
            return this.success();
        }
        const panelAccess = panel as PanelCommandAccess;

        let reloadCount = 0;
        const fileRegistry = this.getFileRegistry();
        const includeFiles = fileRegistry?.getIncludeFiles() || [];
        for (const includeFile of includeFiles) {
            try {
                await includeFile.reload();
                reloadCount++;
            } catch (error) {
                console.warn(`[IncludeCommands] Failed to reload include file ${includeFile.getRelativePath()}:`, error);
            }
        }

        const document = context.fileManager.getDocument();
        if (document && panelAccess.loadMarkdownFile) {
            await panelAccess.loadMarkdownFile(document);
        }

        this.postMessage({
            type: 'allIncludedFilesReloaded',
            reloadCount: reloadCount
        });

        return this.success();
    }

    private async handleSaveIndividualFile(
        filePath: string,
        isMainFile: boolean,
        forceSave: boolean = false,
        action: SaveResolutionAction | undefined,
        context: CommandContext
    ): Promise<CommandResult> {
        const panel = context.getWebviewPanel();
        if (!panel) {
            // Still try to send failure message if possible
            this.postMessage({
                type: 'individualFileSaved',
                filePath: filePath,
                isMainFile: isMainFile,
                success: false,
                forceSave: forceSave,
                action: action,
                error: 'No panel available'
            });
            return this.failure('No panel available');
        }
        const panelAccess = panel as PanelCommandAccess;
        const requestedAction: SaveResolutionAction = this._isSaveResolutionAction(action) ? action : 'overwrite';
        let backupPath: string | undefined;

        try {
            if (action && !this._isSaveResolutionAction(action)) {
                throw new Error(`Unsupported save action: ${action}`);
            }
            const targetFile = this._resolveTargetFile(filePath, isMainFile, context);
            const fileService = panelAccess._fileService;
            if (!fileService || typeof fileService.saveUnified !== 'function') {
                throw new Error('File service not available');
            }
            if (targetFile.isDirtyInEditor()) {
                throw new Error(
                    `Cannot save "${targetFile.getRelativePath()}" while it has unsaved text-editor changes. `
                    + 'Save or discard editor changes first.'
                );
            }

            if (targetFile.hasExternalChanges() && requestedAction === 'overwrite') {
                const choice = await vscode.window.showWarningMessage(
                    `"${targetFile.getRelativePath()}" has external changes. Overwrite without creating a backup?`,
                    { modal: true },
                    'Overwrite Without Backup',
                    'Cancel'
                );
                if (choice !== 'Overwrite Without Backup') {
                    this.postMessage({
                        type: 'individualFileSaved',
                        filePath: filePath,
                        isMainFile: isMainFile,
                        success: false,
                        forceSave: forceSave,
                        action: requestedAction,
                        error: 'Overwrite cancelled by user'
                    });
                    return this.success();
                }
            }

            if (targetFile.hasExternalChanges() && requestedAction === 'overwrite_backup_external') {
                const diskContent = await targetFile.readFromDisk();
                if (diskContent === null) {
                    throw new Error(`Failed to read disk content for "${targetFile.getRelativePath()}" before overwrite backup`);
                }
                backupPath = await targetFile.createVisibleConflictFile(diskContent) || undefined;
                if (!backupPath) {
                    throw new Error(`Failed to create backup for "${targetFile.getRelativePath()}" before overwrite`);
                }
                void this._notifyBackupCreated(backupPath, 'External version backed up');
            }

            const saveResult = await fileService.saveUnified({
                scope: isMainFile ? 'main' : { filePath: targetFile.getPath() },
                force: forceSave || targetFile.hasExternalChanges(),
                source: 'ui-edit',
                syncIncludes: false,  // Don't sync all includes when saving individual file
                updateBaselines: isMainFile ? true : undefined,
                updateUi: false
            });
            if (!saveResult?.success) {
                throw new Error(saveResult?.error || 'Save aborted before writing file');
            }

            await this.triggerMarpWatchExport(context, panelAccess);

            this.postMessage({
                type: 'individualFileSaved',
                filePath: filePath,
                isMainFile: isMainFile,
                success: true,
                forceSave: forceSave,
                action: requestedAction,
                backupPath: backupPath
            });

            if (!isMainFile) {
                this.postMessage({ type: 'refreshDebugInfo' });
            }
        } catch (error) {
            console.error(`[IncludeCommands] handleSaveIndividualFile: FAILED -`, error);
            this.postMessage({
                type: 'individualFileSaved',
                filePath: filePath,
                isMainFile: isMainFile,
                success: false,
                forceSave: forceSave,
                action: requestedAction,
                error: getErrorMessage(error)
            });
        }
        return this.success();
    }

    private async handleReloadIndividualFile(
        filePath: string,
        isMainFile: boolean,
        action: ReloadResolutionAction | undefined,
        context: CommandContext
    ): Promise<CommandResult> {
        const panel = context.getWebviewPanel();
        if (!panel) {
            // Still try to send failure message if possible
            this.postMessage({
                type: 'individualFileReloaded',
                filePath: filePath,
                isMainFile: isMainFile,
                success: false,
                action: action,
                error: 'No panel available'
            });
            return this.failure('No panel available');
        }
        const panelAccess = panel as PanelCommandAccess;
        const requestedAction: ReloadResolutionAction = this._isReloadResolutionAction(action) ? action : 'load_external';
        let backupPath: string | undefined;

        try {
            if (action && !this._isReloadResolutionAction(action)) {
                throw new Error(`Unsupported reload action: ${action}`);
            }
            const fileRegistry = this.getFileRegistry();
            if (!fileRegistry) {
                throw new Error('File registry not available');
            }
            const targetFile = this._resolveTargetFile(filePath, isMainFile, context);

            if (requestedAction === 'load_external_backup_mine') {
                backupPath = await targetFile.createVisibleConflictFile(targetFile.getContentForBackup()) || undefined;
                if (!backupPath) {
                    throw new Error(`Failed to create backup for "${targetFile.getRelativePath()}" before reload`);
                }
                void this._notifyBackupCreated(backupPath, 'Kanban version backed up');
            } else if (targetFile.hasAnyUnsavedChanges()) {
                const choice = await vscode.window.showWarningMessage(
                    `Reload "${targetFile.getRelativePath()}" from disk and discard unsaved Kanban changes?`,
                    { modal: true },
                    'Reload from Disk',
                    'Cancel'
                );
                if (choice !== 'Reload from Disk') {
                    this.postMessage({
                        type: 'individualFileReloaded',
                        filePath: filePath,
                        isMainFile: isMainFile,
                        success: false,
                        action: requestedAction,
                        error: 'Reload cancelled by user'
                    });
                    return this.success();
                }
            }

            await targetFile.reload();

            const requiresFullBoardRefresh = isMainFile || targetFile.getFileType() === 'include-column';

            if (requiresFullBoardRefresh) {
                // Main file and column-include reloads can change board structure.
                const mainFile = fileRegistry.getMainFile();
                if (mainFile) {
                    mainFile.parseToBoard();
                    const freshBoard = mainFile.getBoard();
                    const fileService = panelAccess._fileService;
                    if (freshBoard && freshBoard.valid && fileService) {
                        fileService.setBoard(freshBoard);
                        await fileService.sendBoardUpdate(false, false);
                    }
                }
            } else {
                // Task/regular includes only need include cache updates (avoid full redraw + large payloads).
                this.postMessage({
                    type: 'updateIncludeContent',
                    filePath: targetFile.getRelativePath(),
                    content: targetFile.getContent(),
                    error: targetFile.exists() ? undefined : `File not found: ${targetFile.getRelativePath()}`
                });
            }

            this.postMessage({
                type: 'individualFileReloaded',
                filePath: filePath,
                isMainFile: isMainFile,
                success: true,
                action: requestedAction,
                backupPath: backupPath
            });
        } catch (error) {
            this.postMessage({
                type: 'individualFileReloaded',
                filePath: filePath,
                isMainFile: isMainFile,
                success: false,
                action: requestedAction,
                error: getErrorMessage(error)
            });
        }
        return this.success();
    }
}
