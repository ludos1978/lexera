/**
 * File Commands
 *
 * Handles file-related message operations:
 * - openLink (unified: file, wiki, external, image links)
 * - openFile, openIncludeFile
 * - handleFileDrop, handleUriDrop
 * - toggleFileLock, selectFile
 * - requestFileInfo, initializeFile
 *
 * @module commands/FileCommands
 */

import { SwitchBasedCommand, CommandContext, CommandMetadata, CommandResult, MessageHandler } from './interfaces';
import { PathResolver } from '../services/PathResolver';
import { getErrorMessage } from '../utils/stringUtils';
import { showInfo, showWarning } from '../services/NotificationService';
import * as vscode from 'vscode';
import * as path from 'path';
import {
    OpenLinkMessage,
    LinkType,
    OpenFileMessage,
    OpenIncludeFileMessage,
    HandleFileDropMessage,
    HandleUriDropMessage,
    ResolveAndCopyPathMessage,
    RemoveDeletedItemsFromFilesMessage
} from '../core/bridge/MessageTypes';
import { logger } from '../utils/logger';

/**
 * File Commands Handler
 *
 * Processes file-related messages from the webview.
 */
export class FileCommands extends SwitchBasedCommand {
    readonly metadata: CommandMetadata = {
        id: 'file-commands',
        name: 'File Commands',
        description: 'Handles file opening, links, and file management',
        messageTypes: [
            'openLink',
            'openFile',
            'openIncludeFile',
            'handleFileDrop',
            'handleUriDrop',
            'toggleFileLock',
            'selectFile',
            'requestFileInfo',
            'initializeFile',
            'resolveAndCopyPath',
            'removeDeletedItemsFromFiles'
        ],
        priority: 100
    };

    protected handlers: Record<string, MessageHandler> = {
        'openLink': (msg, ctx) => this.handleOpenLink(msg as OpenLinkMessage, ctx),
        'openFile': (msg, ctx) => this.handleOpenFile(msg as OpenFileMessage, ctx),
        'openIncludeFile': (msg, ctx) => this.handleOpenIncludeFile(msg as OpenIncludeFileMessage, ctx),
        'handleFileDrop': (msg, ctx) => this.handleFileDrop(msg as HandleFileDropMessage, ctx),
        'handleUriDrop': (msg, ctx) => this.handleUriDrop(msg as HandleUriDropMessage, ctx),
        'toggleFileLock': (_msg, ctx) => Promise.resolve(this.handleToggleFileLock(ctx)),
        'selectFile': (_msg, ctx) => this.handleSelectFile(ctx),
        'requestFileInfo': (_msg, ctx) => Promise.resolve(this.handleRequestFileInfo(ctx)),
        'initializeFile': (_msg, ctx) => this.handleInitializeFile(ctx),
        'resolveAndCopyPath': (msg, ctx) => this.handleResolveAndCopyPath(msg as ResolveAndCopyPathMessage, ctx),
        'removeDeletedItemsFromFiles': (msg, ctx) => this.handleRemoveDeletedItemsFromFiles(msg as RemoveDeletedItemsFromFilesMessage, ctx)
    };

    // ============= UNIFIED LINK HANDLER =============

    /**
     * Set up tracked files for link handler from file registry.
     * This enables file search to scan all tracked files (main + includes).
     */
    private setupTrackedFiles(context: CommandContext): void {
        const fileRegistry = context.getFileRegistry();
        if (fileRegistry) {
            const allFiles = fileRegistry.getAll();
            const trackedFiles = allFiles.map(file => ({
                path: file.getPath(),
                relativePath: file.getRelativePath(),
                content: file.getContent()
            }));
            context.linkHandler.setTrackedFiles(trackedFiles);
            logger.debug('[FileCommands] Tracked files set', {
                fileCount: allFiles.length,
                hasMainFile: !!fileRegistry.getMainFile()
            });
        }
    }

    /**
     * Handle unified openLink command
     *
     * Routes to appropriate handler based on LinkType:
     * - FILE/IMAGE: Opens file or shows search dialog if not found
     * - WIKI: Searches for wiki document
     * - EXTERNAL: Opens in external browser
     *
     * Triggered when user Alt+clicks a link or image in the board (from boardRenderer.js).
     * Flow: Alt+click → openLink message → LinkHandler method → opens or searches.
     */
    private async handleOpenLink(message: OpenLinkMessage, context: CommandContext): Promise<CommandResult> {
        const { linkType, target, cardId, columnId, linkIndex, includeContext, forceExternal } = message;

        logger.debug('[FileCommands.handleOpenLink] START', JSON.stringify({
            linkType,
            target: target?.slice(-30),
            cardId,
            columnId,
            linkIndex,
            hasIncludeContext: !!includeContext,
            forceExternal
        }));

        // Set up tracked files for all local link types (FILE, IMAGE, WIKI)
        if (linkType !== LinkType.EXTERNAL) {
            this.setupTrackedFiles(context);
        }

        switch (linkType) {
            case LinkType.FILE:
            case LinkType.IMAGE:
                // Include file content is synced in-memory by BoardSyncHandler
                await context.linkHandler.handleFileLink(target, cardId, columnId, linkIndex, includeContext, forceExternal);
                break;

            case LinkType.WIKI:
                await context.linkHandler.handleWikiLink(target, cardId, columnId, linkIndex, includeContext);
                break;

            case LinkType.EXTERNAL:
                await context.linkHandler.handleExternalLink(target);
                break;

            default:
                logger.warn(`[FileCommands.handleOpenLink] Unknown link type: ${linkType}`);
                return this.failure(`Unknown link type: ${linkType}`);
        }

        return this.success();
    }

    /**
     * Handle openFile command - opens a file in VS Code editor
     */
    private async handleOpenFile(message: OpenFileMessage, context: CommandContext): Promise<CommandResult> {
        const filePath = message.filePath;
        if (!filePath) {
            return this.failure('No file path provided');
        }

        try {
            // Resolve the file path to absolute if it's relative
            let absolutePath = filePath;
            if (!path.isAbsolute(filePath)) {
                const document = context.fileManager.getDocument();
                if (document) {
                    const currentDir = path.dirname(document.uri.fsPath);
                    absolutePath = PathResolver.resolve(currentDir, filePath);
                } else {
                    return this.failure('Cannot resolve relative path - no current document');
                }
            }

            // Normalize the path for comparison
            const normalizedPath = path.resolve(absolutePath);

            // Block opening kanban-managed files in text editor
            const fileRegistry = context.getFileRegistry();
            if (fileRegistry?.findByPath(normalizedPath)) {
                logger.warn('[FileCommands.handleOpenFile] Blocked: kanban-managed file');
                return this.failure('This file is managed by the kanban board');
            }

            // Check if the file is already open as a document
            const existingDocument = vscode.workspace.textDocuments.find(doc => {
                const docPath = path.resolve(doc.uri.fsPath);
                return docPath === normalizedPath;
            });

            if (existingDocument) {
                // Check if it's currently visible
                const visibleEditor = vscode.window.visibleTextEditors.find(editor =>
                    path.resolve(editor.document.uri.fsPath) === normalizedPath
                );

                if (visibleEditor) {
                    // Already focused, nothing to do
                    if (vscode.window.activeTextEditor?.document.uri.fsPath === normalizedPath) {
                        return this.success();
                    }
                }

                await vscode.window.showTextDocument(existingDocument, {
                    preserveFocus: false,
                    preview: false
                });
            } else {
                // Open the document first, then show it
                const document = await vscode.workspace.openTextDocument(absolutePath);
                await vscode.window.showTextDocument(document, {
                    preserveFocus: false,
                    preview: false
                });
            }
            return this.success();
        } catch (error) {
            const errorMessage = getErrorMessage(error);
            logger.error(`[FileCommands] Error opening file ${filePath}:`, error);
            return this.failure(errorMessage);
        }
    }

    /**
     * Handle openIncludeFile command
     */
    private async handleOpenIncludeFile(message: OpenIncludeFileMessage, context: CommandContext): Promise<CommandResult> {
        await context.linkHandler.handleFileLink(message.filePath);
        return this.success();
    }

    // ============= FILE DROP HANDLERS =============

    /**
     * Handle handleFileDrop command
     */
    private async handleFileDrop(message: HandleFileDropMessage, context: CommandContext): Promise<CommandResult> {
        await context.fileManager.handleFileDrop(message);
        return this.success();
    }

    /**
     * Handle handleUriDrop command
     */
    private async handleUriDrop(message: HandleUriDropMessage, context: CommandContext): Promise<CommandResult> {
        await context.fileManager.handleUriDrop(message);
        return this.success();
    }

    // ============= FILE MANAGEMENT HANDLERS =============

    /**
     * Handle toggleFileLock command
     */
    private handleToggleFileLock(context: CommandContext): CommandResult {
        context.fileManager.toggleFileLock();
        return this.success();
    }

    /**
     * Handle selectFile command - opens file picker dialog
     */
    private async handleSelectFile(context: CommandContext): Promise<CommandResult> {
        await context.fileManager.selectFile();
        // Note: The selected document is handled by the main panel/extension
        // The fileManager.selectFile() triggers the appropriate flow
        return this.success();
    }

    /**
     * Handle requestFileInfo command
     */
    private handleRequestFileInfo(context: CommandContext): CommandResult {
        context.fileManager.sendFileInfo();
        return this.success();
    }

    /**
     * Handle initializeFile command
     */
    private async handleInitializeFile(context: CommandContext): Promise<CommandResult> {
        await context.onInitializeFile();
        return this.success();
    }

    /**
     * Handle resolveAndCopyPath command
     */
    private async handleResolveAndCopyPath(message: ResolveAndCopyPathMessage, context: CommandContext): Promise<CommandResult> {
        const resolution = await context.fileManager.resolveFilePath(message.path);
        if (resolution && resolution.exists) {
            await vscode.env.clipboard.writeText(resolution.resolvedPath);
            showInfo('Full path copied: ' + resolution.resolvedPath);
        } else {
            showWarning('Could not resolve path: ' + message.path);
        }
        return this.success();
    }

    // ============= REMOVE DELETED ITEMS =============

    /**
     * Handle removeDeletedItemsFromFiles command
     *
     * Permanently removes items tagged with #hidden-internal-deleted from markdown files.
     * Only removes deleted items, NOT parked items (#hidden-internal-parked).
     */
    private async handleRemoveDeletedItemsFromFiles(message: RemoveDeletedItemsFromFilesMessage, context: CommandContext): Promise<CommandResult> {
        const DELETED_TAG = '#hidden-internal-deleted';
        const fileRegistry = context.getFileRegistry();
        let removedCount = 0;
        let filesModified = 0;

        try {
            // Process each tracked file
            const allFiles = fileRegistry?.getAll() || [];

            for (const file of allFiles) {
                const content = file.getContent();
                if (!content || !content.includes(DELETED_TAG)) {
                    continue;
                }

                // Split content into lines
                const lines = content.split('\n');
                const filteredLines: string[] = [];
                let inDeletedColumn = false;
                let deletedColumnIndent = 0;
                let itemsRemovedFromFile = 0;

                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i];

                    // Check if this is a column header (## heading)
                    const columnMatch = line.match(/^(#{2,})\s+/);
                    if (columnMatch) {
                        // Check if the column has deleted tag
                        if (line.includes(DELETED_TAG)) {
                            inDeletedColumn = true;
                            deletedColumnIndent = columnMatch[1].length;
                            itemsRemovedFromFile++;
                            continue; // Skip deleted column header
                        } else {
                            // New column without deleted tag - end deleted section
                            inDeletedColumn = false;
                        }
                    }

                    // If we're in a deleted column, skip all lines until next same-level heading
                    if (inDeletedColumn) {
                        // Check if we've hit a new column at same or higher level
                        const newColumnMatch = line.match(/^(#{2,})\s+/);
                        if (newColumnMatch && newColumnMatch[1].length <= deletedColumnIndent) {
                            // New column at same or higher level - end deleted section
                            inDeletedColumn = false;
                            if (!line.includes(DELETED_TAG)) {
                                filteredLines.push(line);
                            } else {
                                // This new column is also deleted
                                inDeletedColumn = true;
                                deletedColumnIndent = newColumnMatch[1].length;
                                itemsRemovedFromFile++;
                            }
                        }
                        // Otherwise skip the line (inside deleted column)
                        continue;
                    }

                    // Check if this is a task with deleted tag
                    if (line.includes(DELETED_TAG)) {
                        // Check if it's a task line (starts with - [ ] or - [x])
                        if (/^\s*-\s*\[[ xX]\]/.test(line)) {
                            itemsRemovedFromFile++;
                            continue; // Skip deleted task
                        }
                        // Also check for description lines following tasks
                        if (line.trim().startsWith('-') || line.trim() === '') {
                            // Not a task checkbox - could be a continuation, keep checking
                        }
                    }

                    filteredLines.push(line);
                }

                // Only update if content changed
                if (itemsRemovedFromFile > 0) {
                    const newContent = filteredLines.join('\n');
                    file.setContent(newContent);
                    removedCount += itemsRemovedFromFile;
                    filesModified++;
                }
            }

            // Save changes and refresh board
            if (filesModified > 0) {
                // Trigger save to markdown
                await context.onSaveToMarkdown();

                // Refresh board
                await this.refreshBoard(context);

                showInfo(`Removed ${removedCount} deleted item(s) from ${filesModified} file(s)`);
            } else {
                showInfo('No deleted items found to remove');
            }

            return this.success();
        } catch (error) {
            const errorMsg = getErrorMessage(error);
            logger.error('[FileCommands] Failed to remove deleted items:', errorMsg);
            return this.failure(`Failed to remove deleted items: ${errorMsg}`);
        }
    }
}
