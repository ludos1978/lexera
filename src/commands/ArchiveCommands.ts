/**
 * Archive Commands
 *
 * Handles archive-related message operations:
 * - exportArchivedItems: Export archived items to a separate archive file
 *
 * @module commands/ArchiveCommands
 */

import { SwitchBasedCommand, CommandContext, CommandMetadata, CommandResult, MessageHandler } from './interfaces';
import { getArchivePath, generateTimestamp } from '../constants/FileNaming';
import { getErrorMessage } from '../utils/stringUtils';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ExportArchivedItemsMessage, OpenArchiveFileMessage } from '../core/bridge/MessageTypes';

/**
 * Archive Commands Handler
 *
 * Processes archive-related messages from the webview.
 */
export class ArchiveCommands extends SwitchBasedCommand {
    readonly metadata: CommandMetadata = {
        id: 'archive-commands',
        name: 'Archive Commands',
        description: 'Handles archive export operations',
        messageTypes: [
            'exportArchivedItems',
            'openArchiveFile'
        ],
        priority: 100
    };

    protected handlers: Record<string, MessageHandler> = {
        'exportArchivedItems': (msg, ctx) => this.handleExportArchivedItems(msg as ExportArchivedItemsMessage, ctx),
        'openArchiveFile': (_msg, ctx) => this.handleOpenArchiveFile(ctx)
    };

    /**
     * Handle exportArchivedItems command - exports archived items to a separate archive file
     */
    private async handleExportArchivedItems(message: ExportArchivedItemsMessage, context: CommandContext): Promise<CommandResult> {
        const items = message.items;
        if (!items || items.length === 0) {
            return this.failure('No items to export');
        }

        try {
            // Get the main file path
            const fileRegistry = context.getFileRegistry();
            if (!fileRegistry) {
                return this.failure('File registry not available');
            }

            const mainFile = fileRegistry.getMainFile();
            if (!mainFile) {
                return this.failure('Main file not found');
            }

            const mainFilePath = mainFile.getPath();
            const archivePath = getArchivePath(mainFilePath);
            const timestamp = generateTimestamp();

            // Generate markdown content for the archived items
            const archiveContent = this.generateArchiveContent(items, timestamp);

            // Read existing archive file content if it exists
            let existingContent = '';
            try {
                existingContent = await fs.promises.readFile(archivePath, 'utf8');
            } catch (e) {
                // File doesn't exist yet, that's fine
            }

            // Append new content after YAML header
            let finalContent: string;
            if (existingContent) {
                // Find end of YAML frontmatter (if present)
                const yamlMatch = existingContent.match(/^---\n[\s\S]*?\n---\n?/);
                if (yamlMatch) {
                    const yamlHeader = yamlMatch[0];
                    const restOfContent = existingContent.slice(yamlHeader.length);
                    // Append new content at the end
                    finalContent = yamlHeader + restOfContent.trimEnd() + '\n\n' + archiveContent;
                } else {
                    // No YAML header, just append
                    finalContent = existingContent.trimEnd() + '\n\n' + archiveContent;
                }
            } else {
                // New file - add header and content
                finalContent = this.getArchiveHeader() + archiveContent;
            }

            // Write the archive file
            await fs.promises.writeFile(archivePath, finalContent, 'utf8');

            // Collect IDs of exported items
            const exportedIds = items.map(item => item.id);

            // Send success message back to frontend
            this.postMessage({
                type: 'archivedItemsExported',
                success: true,
                exportedCount: items.length,
                exportedIds: exportedIds,
                archivePath: archivePath
            });

            // Show notification
            vscode.window.showInformationMessage(
                `Exported ${items.length} item(s) to archive file`
            );

            return this.success({ exportedCount: items.length, archivePath });
        } catch (error) {
            const errorMessage = getErrorMessage(error);
            console.error('[ArchiveCommands] Error exporting archived items:', error);

            // Send error message back to frontend
            this.postMessage({
                type: 'archivedItemsExported',
                success: false,
                error: errorMessage
            });

            return this.failure(errorMessage);
        }
    }

    /**
     * Handle openArchiveFile command - opens the archive file in VS Code editor
     */
    private async handleOpenArchiveFile(context: CommandContext): Promise<CommandResult> {
        try {
            // Get the main file path
            const fileRegistry = context.getFileRegistry();
            if (!fileRegistry) {
                return this.failure('File registry not available');
            }

            const mainFile = fileRegistry.getMainFile();
            if (!mainFile) {
                return this.failure('Main file not found');
            }

            const mainFilePath = mainFile.getPath();
            const archivePath = getArchivePath(mainFilePath);

            // Check if archive file exists
            try {
                await fs.promises.access(archivePath, fs.constants.F_OK);
            } catch {
                // File doesn't exist, show message
                vscode.window.showInformationMessage(
                    'Archive file does not exist yet. Export some items first.'
                );
                return this.success({ exists: false });
            }

            // Open the file in VS Code
            const document = await vscode.workspace.openTextDocument(archivePath);
            await vscode.window.showTextDocument(document, {
                preserveFocus: false,
                preview: false
            });

            return this.success({ archivePath });
        } catch (error) {
            const errorMessage = getErrorMessage(error);
            console.error('[ArchiveCommands] Error opening archive file:', error);
            return this.failure(errorMessage);
        }
    }

    /**
     * Generate the archive file header (only used for new files)
     */
    private getArchiveHeader(): string {
        return `---
archived: true
---

`;
    }

    /**
     * Generate archive tag with formatted date/time
     * Format: #archived !YYYY.MM.DD !HH:MM:SS
     */
    private generateArchiveTag(): string {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const seconds = String(now.getSeconds()).padStart(2, '0');

        return `#archived !${year}.${month}.${day} !${hours}:${minutes}:${seconds}`;
    }

    /**
     * Generate markdown content for archived items
     */
    private generateArchiveContent(items: ExportArchivedItemsMessage['items'], _timestamp: string): string {
        const lines: string[] = [];
        const archiveTag = this.generateArchiveTag();

        // Group items by type
        const tasks = items.filter(item => item.type === 'task');
        const columns = items.filter(item => item.type === 'column');

        // Generate sections for each column
        for (const column of columns) {
            const columnData = column.data as { title?: string; tasks?: Array<{ content?: string; completed?: boolean }> };
            const cleanTitle = this.removeInternalTags(columnData.title || 'Untitled Column');
            lines.push(`## Archived Column: ${cleanTitle} ${archiveTag}`);
            lines.push('');

            // Add tasks from the column
            if (columnData.tasks && columnData.tasks.length > 0) {
                for (const task of columnData.tasks) {
                    lines.push(this.formatTaskForExport(task, archiveTag));
                }
            }
            lines.push('');
        }

        // Generate section for individual tasks (if any)
        if (tasks.length > 0) {
            lines.push(`## Archived Tasks`);
            lines.push('');

            for (const taskItem of tasks) {
                const taskData = taskItem.data as { content?: string; completed?: boolean };
                lines.push(this.formatTaskForExport(taskData, archiveTag));
            }
            lines.push('');
        }

        return lines.join('\n');
    }

    /**
     * Format a single task for export
     * Format: - [ ] Task title #archived !YYYY.MM.DD !HH:MM:SS
     */
    private formatTaskForExport(task: { content?: string; completed?: boolean }, archiveTag: string): string {
        const checkbox = task.completed ? '- [x]' : '- [ ]';
        const lines = (task.content || '').replace(/\r\n/g, '\n').split('\n');

        // First line is summary, rest is description
        const cleanTitle = this.removeInternalTags(lines[0] || '');
        let result = `${checkbox} ${cleanTitle} ${archiveTag}`;

        // Add remaining lines as indented description
        if (lines.length > 1) {
            for (let i = 1; i < lines.length; i++) {
                const cleanLine = this.removeInternalTags(lines[i]);
                result += '\n    ' + cleanLine;
            }
        }

        return result;
    }

    /**
     * Remove internal tags from text
     */
    private removeInternalTags(text: string): string {
        if (!text) return '';
        return text
            .replace(/#hidden-internal-archived/g, '')
            .replace(/#hidden-internal-parked/g, '')
            .replace(/#hidden-internal-deleted/g, '')
            .trim();
    }
}
