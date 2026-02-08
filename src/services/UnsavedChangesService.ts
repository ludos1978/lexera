/**
 * UnsavedChangesService - Handles unsaved changes detection, dialogs, and backups
 *
 * Extracts unsaved changes logic from KanbanWebviewPanel to reduce God class size.
 * This service:
 * 1. Checks if there are unsaved changes in main file or include files
 * 2. Shows dialog asking user what to do
 * 3. Creates backup files for unsaved changes
 *
 * Previously: Parts of KanbanWebviewPanel._handlePanelClose() and saveUnsavedChangesBackup()
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import { MarkdownFileRegistry } from '../files/MarkdownFileRegistry';
import { getUnsavedChangesPath } from '../constants/FileNaming';
import { confirmSaveOnClose } from './NotificationService';

/**
 * Result of showing the unsaved changes dialog
 */
export type UnsavedChangesChoice = 'save' | 'discard' | 'cancel';

/**
 * Information about unsaved changes
 */
export interface UnsavedChangesInfo {
    hasMainFileChanges: boolean;
    hasIncludeFileChanges: boolean;
    changedIncludeFiles: string[];
}

export interface UnsavedBackupResult {
    created: number;
    failed: number;
    errors: string[];
}

export class UnsavedChangesService {
    private _fileRegistry: MarkdownFileRegistry;

    constructor(fileRegistry: MarkdownFileRegistry) {
        this._fileRegistry = fileRegistry;
    }

    /**
     * Check if there are any unsaved changes
     */
    public checkForUnsavedChanges(): UnsavedChangesInfo {
        const mainFile = this._fileRegistry.getMainFile();
        const hasMainFileChanges = mainFile?.hasAnyUnsavedChanges() || false;

        const includeStatus = this._fileRegistry.getIncludeFilesUnsavedStatus();

        return {
            hasMainFileChanges,
            hasIncludeFileChanges: includeStatus.hasChanges,
            changedIncludeFiles: includeStatus.changedFiles
        };
    }

    /**
     * Check if any files have unsaved changes
     */
    public hasAnyUnsavedChanges(): boolean {
        return this._fileRegistry.hasAnyUnsavedChanges();
    }

    /**
     * Show dialog asking user what to do with unsaved changes
     *
     * @returns 'save' | 'discard' | 'cancel'
     */
    public async showUnsavedChangesDialog(info: UnsavedChangesInfo): Promise<UnsavedChangesChoice> {
        // If no unsaved changes, no dialog needed
        if (!info.hasMainFileChanges && !info.hasIncludeFileChanges) {
            return 'discard'; // Nothing to save
        }

        // Build message for unsaved changes
        let message = '';
        if (info.hasMainFileChanges && info.hasIncludeFileChanges) {
            message = `You have unsaved changes in the main file and in column include files:\n${info.changedIncludeFiles.join('\n')}\n\nDo you want to save before closing?`;
        } else if (info.hasMainFileChanges) {
            message = `You have unsaved changes in the main file. Do you want to save before closing?`;
        } else if (info.hasIncludeFileChanges) {
            message = `You have unsaved changes in column include files:\n${info.changedIncludeFiles.join('\n')}\n\nDo you want to save before closing?`;
        }

        return confirmSaveOnClose(message);
    }

    /**
     * Discard all unsaved changes
     */
    public discardAllChanges(): void {
        for (const file of this._fileRegistry.getAll()) {
            if (file.hasUnsavedChanges()) {
                file.discardChanges();
            }
        }
    }

    /**
     * Save unsaved changes to backup files with ".{name}-unsavedchanges" naming (hidden)
     * Creates a safety backup before closing
     *
     * @param mainFileUri - URI of the main kanban file
     */
    public async saveBackups(mainFileUri: vscode.Uri | undefined): Promise<UnsavedBackupResult> {
        const result: UnsavedBackupResult = {
            created: 0,
            failed: 0,
            errors: []
        };

        const writeBackup = async (filePath: string, content: string): Promise<void> => {
            try {
                const backupPath = this._createBackupPath(filePath);
                await fs.promises.writeFile(backupPath, content, 'utf8');
                result.created++;
            } catch (error) {
                result.failed++;
                const errorText = error instanceof Error ? error.message : String(error);
                result.errors.push(`Failed backup for "${filePath}": ${errorText}`);
            }
        };

        // Save main file backup
        const mainFile = this._fileRegistry.getMainFile();
        if (mainFile && mainFile.hasAnyUnsavedChanges()) {
            const filePath = mainFileUri?.fsPath || mainFile.getPath();
            const content = await this._resolveBackupContent(mainFile.getPath(), mainFile.getContent());
            await writeBackup(filePath, content);
        }

        // Save include files backups
        const includeStatus = this._fileRegistry.getIncludeFilesUnsavedStatus();
        if (includeStatus.hasChanges) {
            for (const fileWithChanges of includeStatus.changedFiles) {
                const includeFile = this._fileRegistry.getIncludeFile(fileWithChanges);
                if (includeFile && includeFile.hasAnyUnsavedChanges()) {
                    const filePath = includeFile.getPath();
                    if (filePath) {
                        const content = await this._resolveBackupContent(filePath, includeFile.getContent());
                        await writeBackup(filePath, content);
                    }
                }
            }
        }

        if (result.failed > 0) {
            console.error('[UnsavedChangesService] Failed to save some unsaved changes backups:', result.errors.join('; '));
        }

        return result;
    }

    /**
     * Create backup path for a file
     * "file.md" -> ".file-unsavedchanges.md" (hidden file)
     */
    private _createBackupPath(filePath: string): string {
        return getUnsavedChangesPath(filePath);
    }

    private async _resolveBackupContent(filePath: string, fallbackContent: string): Promise<string> {
        const openDocument = vscode.workspace.textDocuments.find(doc => doc.uri.fsPath === filePath);
        if (openDocument?.isDirty) {
            return openDocument.getText();
        }
        return fallbackContent;
    }
}
