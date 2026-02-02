import * as vscode from 'vscode';
import { MarkdownFile } from '../files/MarkdownFile';

/**
 * Unified External Change Handler — Batched import system
 *
 * Replaces per-file conflict dialogs with a coalesced, batched approach:
 * - File modifications are collected per-panel in a 500ms coalescing window
 * - After the window closes, ONE dialog is shown for all changed files
 * - Single file: showWarningMessage ("Import / Ignore")
 * - Multiple files: showQuickPick with canPickMany (select files to import)
 *
 * Files with unsaved kanban changes are unchecked by default (safe default).
 * Files without unsaved changes are pre-selected for import.
 *
 * NOTE: Legitimate saves (our own writes) are filtered out by _onFileSystemChange()
 * using the _skipReloadCounter flag. This handler only receives TRUE external changes.
 *
 * NOTE: Deleted and created files are handled immediately (not batched).
 */

const COALESCE_WINDOW_MS = 500;

export class UnifiedChangeHandler {
    private static instance: UnifiedChangeHandler | undefined;

    // Coalescing state: keyed by panelId
    private _pendingFiles = new Map<string, MarkdownFile[]>();
    private _coalesceTimers = new Map<string, ReturnType<typeof setTimeout>>();

    private constructor() {}

    public static getInstance(): UnifiedChangeHandler {
        if (!UnifiedChangeHandler.instance) {
            UnifiedChangeHandler.instance = new UnifiedChangeHandler();
        }
        return UnifiedChangeHandler.instance;
    }

    /**
     * Unified external change handling for all file types.
     * Deleted and created files are handled immediately.
     * Modified files are batched in a coalescing window per panel.
     */
    public async handleExternalChange(
        file: MarkdownFile,
        changeType: 'modified' | 'deleted' | 'created'
    ): Promise<void> {
        if (changeType === 'deleted') {
            await this._handleFileDeleted(file);
            return;
        }

        if (changeType === 'created') {
            await this._handleFileCreated(file);
            return;
        }

        // Modified: add to coalescing batch
        this._addToPending(file);
    }

    // ============= IMMEDIATE HANDLERS =============

    private async _handleFileDeleted(file: MarkdownFile): Promise<void> {
        file.setExists(false);
    }

    private async _handleFileCreated(file: MarkdownFile): Promise<void> {
        file.setExists(true);
        await file.reload();
    }

    // ============= COALESCING BATCH SYSTEM =============

    /**
     * Add a file to the coalescing batch for its panel.
     * Resets the coalesce timer so rapid changes are grouped together.
     */
    private _addToPending(file: MarkdownFile): void {
        const panelId = file.getConflictResolver().panelId;

        if (!this._pendingFiles.has(panelId)) {
            this._pendingFiles.set(panelId, []);
        }

        const pending = this._pendingFiles.get(panelId)!;

        // Avoid duplicates (same file path)
        const alreadyPending = pending.some(f => f.getPath() === file.getPath());
        if (!alreadyPending) {
            pending.push(file);
        }

        // Reset coalesce timer for this panel
        const existingTimer = this._coalesceTimers.get(panelId);
        if (existingTimer) {
            clearTimeout(existingTimer);
        }

        this._coalesceTimers.set(panelId, setTimeout(async () => {
            const files = this._pendingFiles.get(panelId) || [];
            this._pendingFiles.delete(panelId);
            this._coalesceTimers.delete(panelId);

            if (files.length > 0) {
                await this._showBatchedImportDialog(files);
            }
        }, COALESCE_WINDOW_MS));
    }

    // ============= BATCHED IMPORT DIALOG (Scenario 1) =============

    /**
     * Show import dialog for a batch of externally changed files.
     *
     * Single file: simple showWarningMessage with Import/Ignore.
     * Multiple files: showQuickPick with canPickMany.
     *
     * Files without unsaved kanban changes are pre-selected (safe to import).
     * Files with unsaved kanban changes are unchecked by default.
     */
    private async _showBatchedImportDialog(files: MarkdownFile[]): Promise<void> {
        if (files.length === 1) {
            await this._showSingleFileImportDialog(files[0]);
            return;
        }

        await this._showMultiFileImportDialog(files);
    }

    /**
     * Single file: simple warning message with Import/Ignore
     */
    private async _showSingleFileImportDialog(file: MarkdownFile): Promise<void> {
        const fileName = file.getFileName();
        const hasUnsaved = file.hasAnyUnsavedChanges();

        let message = `"${fileName}" has been modified externally.`;
        if (hasUnsaved) {
            message += `\n\n⚠️ Importing will discard your unsaved kanban edits.`;
        }

        const importChanges = 'Import changes';
        const ignore = 'Ignore';

        const choice = await vscode.window.showWarningMessage(
            message,
            importChanges,
            ignore
        );

        if (choice === importChanges) {
            await this._importFile(file);
        }
        // Ignore or ESC: keep _hasFileSystemChanges = true, do nothing
    }

    /**
     * Multiple files: QuickPick with canPickMany
     */
    private async _showMultiFileImportDialog(files: MarkdownFile[]): Promise<void> {
        const someHaveUnsaved = files.some(f => f.hasAnyUnsavedChanges());
        const allHaveUnsaved = files.every(f => f.hasAnyUnsavedChanges());

        // Build QuickPick items
        const items: (vscode.QuickPickItem & { file: MarkdownFile })[] = files.map(file => {
            const hasUnsaved = file.hasAnyUnsavedChanges();
            const label = file.getFileType() === 'main'
                ? file.getFileName()
                : file.getRelativePath();

            return {
                label: hasUnsaved ? `${label}  ⚠️ unsaved edits` : label,
                picked: !hasUnsaved, // Pre-select files without unsaved changes
                file
            };
        });

        let placeholder: string;
        if (allHaveUnsaved) {
            placeholder = 'Select files to import — ⚠️ importing will discard your unsaved kanban edits';
        } else if (someHaveUnsaved) {
            placeholder = 'Select files to import — ⚠️ files with unsaved edits will lose those edits';
        } else {
            placeholder = 'Select files to import (unselected = ignore)';
        }

        const selected = await vscode.window.showQuickPick(items, {
            canPickMany: true,
            title: 'External changes detected',
            placeHolder: placeholder
        }) as (vscode.QuickPickItem & { file: MarkdownFile })[] | undefined;

        if (!selected) {
            // Cancel / ESC: ignore all
            return;
        }

        // Import selected files
        const selectedPaths = new Set(selected.map(s => s.file.getPath()));

        for (const file of files) {
            if (selectedPaths.has(file.getPath())) {
                await this._importFile(file);
            }
            // Unselected: keep _hasFileSystemChanges = true
        }
    }

    // ============= FILE IMPORT =============

    /**
     * Import external changes for a file:
     * - Reload from disk (updates _content, _baseline)
     * - Clear _hasFileSystemChanges
     * - If main file: clear _cachedBoardFromWebview, re-parse board, emit 'reloaded'
     * - If include file: emit 'reloaded', propagation handled by file registry
     */
    private async _importFile(file: MarkdownFile): Promise<void> {
        try {
            // Clear edit mode if active
            if (file.isInEditMode()) {
                file.setEditMode(false);
            }

            // Reload from disk handles everything:
            // - Updates _content and _baseline
            // - Clears _hasFileSystemChanges
            // - MainKanbanFile.reload() also re-parses board and emits 'reloaded'
            // - MarkdownFile.reload() also emits 'reloaded' for include files
            await file.reload();
        } catch (error) {
            console.error(`[UnifiedChangeHandler] Failed to import file ${file.getRelativePath()}:`, error);
        }
    }
}
