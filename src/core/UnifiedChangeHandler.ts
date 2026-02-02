import { MarkdownFile } from '../files/MarkdownFile';
import { ConflictDialogBridge, ConflictFileInfo } from '../services/ConflictDialogBridge';
import { WebviewBridge } from './bridge/WebviewBridge';

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

/**
 * Interface for looking up panel resources by panelId.
 * Avoids circular dependency with KanbanWebviewPanel.
 */
export interface PanelLookup {
    getConflictDialogBridge(panelId: string): ConflictDialogBridge | undefined;
    getWebviewBridge(panelId: string): WebviewBridge | undefined;
}

export class UnifiedChangeHandler {
    private static instance: UnifiedChangeHandler | undefined;

    // Coalescing state: keyed by panelId
    private _pendingFiles = new Map<string, MarkdownFile[]>();
    private _coalesceTimers = new Map<string, ReturnType<typeof setTimeout>>();
    private _panelLookup: PanelLookup | undefined;

    private constructor() {}

    public static getInstance(): UnifiedChangeHandler {
        if (!UnifiedChangeHandler.instance) {
            UnifiedChangeHandler.instance = new UnifiedChangeHandler();
        }
        return UnifiedChangeHandler.instance;
    }

    /**
     * Register a panel lookup implementation.
     * Called once during extension activation to avoid circular imports.
     */
    public setPanelLookup(lookup: PanelLookup): void {
        this._panelLookup = lookup;
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
            this._handleFileDeleted(file);
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

    private _handleFileDeleted(file: MarkdownFile): void {
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

        let pending = this._pendingFiles.get(panelId);
        if (!pending) {
            pending = [];
            this._pendingFiles.set(panelId, pending);
        }

        // Avoid duplicates (same file path)
        if (!pending.some(f => f.getPath() === file.getPath())) {
            pending.push(file);
        }

        // Reset coalesce timer for this panel
        clearTimeout(this._coalesceTimers.get(panelId));

        this._coalesceTimers.set(panelId, setTimeout(() => {
            const files = this._pendingFiles.get(panelId) || [];
            this._pendingFiles.delete(panelId);
            this._coalesceTimers.delete(panelId);

            if (files.length > 0) {
                this._showBatchedImportDialog(files).catch(error => {
                    console.error('[UnifiedChangeHandler] Failed to show batched import dialog:', error);
                });
            }
        }, COALESCE_WINDOW_MS));
    }

    // ============= BATCHED IMPORT DIALOG (Scenario 1) =============

    /**
     * Show import dialog for a batch of externally changed files.
     * Uses the webview-based ConflictDialogBridge for per-file resolution.
     */
    private async _showBatchedImportDialog(files: MarkdownFile[]): Promise<void> {
        const panelId = files[0].getConflictResolver().panelId;

        if (!this._panelLookup) {
            console.warn('[UnifiedChangeHandler] Panel lookup not registered, cannot show conflict dialog');
            return;
        }

        const bridge = this._panelLookup.getConflictDialogBridge(panelId);
        const webviewBridge = this._panelLookup.getWebviewBridge(panelId);

        if (!bridge || !webviewBridge) {
            console.warn('[UnifiedChangeHandler] Panel not found for batched import dialog, panelId:', panelId);
            return;
        }

        // Build file info for the dialog
        const conflictFileInfos: ConflictFileInfo[] = files.map(file => ({
            path: file.getPath(),
            relativePath: file.getRelativePath(),
            fileType: file.getFileType() as ConflictFileInfo['fileType'],
            hasExternalChanges: file.hasExternalChanges(),
            hasUnsavedChanges: file.hasAnyUnsavedChanges(),
            isInEditMode: file.isInEditMode()
        }));

        try {
            const result = await bridge.showConflict(
                (msg) => webviewBridge.send(msg),
                {
                    conflictType: 'external_changes',
                    files: conflictFileInfos,
                    openMode: 'external_change'
                }
            );

            if (result.cancelled) {
                return;
            }

            // Apply per-file resolutions
            const resolutionMap = new Map(result.perFileResolutions.map(r => [r.path, r.action]));

            for (const file of files) {
                const action = resolutionMap.get(file.getPath());
                switch (action) {
                    case 'import':
                    case 'load_external':
                        await this._importFile(file);
                        break;
                    case 'load_external_backup_mine': {
                        const kanbanContent = file.getContent();
                        await file.createVisibleConflictFile(kanbanContent);
                        await this._importFile(file);
                        break;
                    }
                    case 'overwrite': {
                        // Force save kanban content over disk (no backup)
                        await file.save({ force: true, skipReloadDetection: true });
                        break;
                    }
                    case 'overwrite_backup_external': {
                        const diskContent = await file.readFromDisk();
                        if (diskContent) {
                            await file.createVisibleConflictFile(diskContent);
                        }
                        await file.save({ force: true, skipReloadDetection: true });
                        break;
                    }
                    case 'ignore':
                    case 'skip':
                    default:
                        // keep _hasFileSystemChanges = true
                        break;
                }
            }
        } catch (error) {
            console.error('[UnifiedChangeHandler] Conflict dialog failed:', error);
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
