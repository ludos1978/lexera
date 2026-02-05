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
import { ExportArchivedItemsMessage } from '../core/bridge/MessageTypes';

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
            'exportArchivedItems'
        ],
        priority: 100
    };

    protected handlers: Record<string, MessageHandler> = {
        'exportArchivedItems': (msg, ctx) => this.handleExportArchivedItems(msg as ExportArchivedItemsMessage, ctx)
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

            // Prepend new content (newest at top)
            const finalContent = existingContent
                ? archiveContent + '\n\n' + existingContent
                : this.getArchiveHeader() + archiveContent;

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
     * Generate the archive file header (only used for new files)
     */
    private getArchiveHeader(): string {
        return `---
archived: true
---

`;
    }

    /**
     * Generate markdown content for archived items
     */
    private generateArchiveContent(items: ExportArchivedItemsMessage['items'], timestamp: string): string {
        const lines: string[] = [];

        // Group items by type
        const tasks = items.filter(item => item.type === 'task');
        const columns = items.filter(item => item.type === 'column');

        // Generate sections for each column
        for (const column of columns) {
            const columnData = column.data as { title?: string; tasks?: Array<{ title?: string; description?: string; completed?: boolean }> };
            const cleanTitle = this.removeInternalTags(columnData.title || 'Untitled Column');
            lines.push(`## Archived Column: ${cleanTitle} ${timestamp}`);
            lines.push('');

            // Add tasks from the column
            if (columnData.tasks && columnData.tasks.length > 0) {
                for (const task of columnData.tasks) {
                    lines.push(this.formatTaskForExport(task));
                }
            }
            lines.push('');
        }

        // Generate section for individual tasks (if any)
        if (tasks.length > 0) {
            lines.push(`## Archived ${timestamp}`);
            lines.push('');

            for (const taskItem of tasks) {
                const taskData = taskItem.data as { title?: string; description?: string; completed?: boolean };
                lines.push(this.formatTaskForExport(taskData));
            }
            lines.push('');
        }

        return lines.join('\n');
    }

    /**
     * Format a single task for export
     */
    private formatTaskForExport(task: { title?: string; description?: string; completed?: boolean }): string {
        const checkbox = task.completed ? '- [x]' : '- [ ]';
        const cleanTitle = this.removeInternalTags(task.title || '');
        const cleanDescription = this.removeInternalTags(task.description || '');

        let result = `${checkbox} ${cleanTitle}`;

        // Add description as indented content if present
        if (cleanDescription) {
            const descriptionLines = cleanDescription.split('\n');
            for (const line of descriptionLines) {
                result += '\n    ' + line;
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
