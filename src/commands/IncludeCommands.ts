/**
 * Include Commands
 *
 * Handles include file-related message operations:
 * - confirmDisableIncludeMode
 * - requestIncludeFile, registerInlineInclude
 * - requestIncludeFileName, requestEditIncludeFileName
 * - requestEditTaskIncludeFileName, requestTaskIncludeFileName
 * - reloadAllIncludedFiles
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
import { safeFileUri, selectMarkdownFile } from '../utils';
import { PanelCommandAccess, hasIncludeFileMethods } from '../types/PanelCommandAccess';
import { showError } from '../services/NotificationService';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Include Commands Handler
 *
 * Processes include file-related messages from the webview.
 */
export class IncludeCommands extends SwitchBasedCommand {
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
            'reloadAllIncludedFiles'
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
        'reloadAllIncludedFiles': (_msg, ctx) => this.handleReloadAllIncludedFiles(ctx)
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

    // ============= FILE RELOAD HANDLERS =============

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

}
