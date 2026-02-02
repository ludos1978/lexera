import { MarkdownFile } from '../files/MarkdownFile';
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
            this._handleFileCreated(file);
            return;
        }

        // Modified: add to coalescing batch
        this._addToPending(file);
    }

    // ============= IMMEDIATE HANDLERS =============

    private _handleFileDeleted(file: MarkdownFile): void {
        file.setExists(false);
    }

    private _handleFileCreated(file: MarkdownFile): void {
        file.setExists(true);
        // Route through the same batched dialog as modified files.
        // NEVER auto-reload — the user must always confirm.
        this._addToPending(file);
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

    // ============= EXTERNAL CHANGE NOTIFICATION =============

    /**
     * Send a non-blocking notification to the webview about externally changed files.
     * The user can click "Review" to open the full file manager dialog.
     * No auto-reload, no modal dialog — just a notification.
     */
    private async _showBatchedImportDialog(files: MarkdownFile[]): Promise<void> {
        const panelId = files[0].getConflictResolver().panelId;

        if (!this._panelLookup) {
            console.warn('[UnifiedChangeHandler] Panel lookup not registered, cannot send notification');
            return;
        }

        const webviewBridge = this._panelLookup.getWebviewBridge(panelId);
        if (!webviewBridge) {
            console.warn('[UnifiedChangeHandler] WebviewBridge not found, panelId:', panelId);
            return;
        }

        const fileNames = files.map(f => f.getRelativePath());

        webviewBridge.send({
            type: 'externalChangesDetected',
            fileCount: files.length,
            fileNames: fileNames
        });
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
