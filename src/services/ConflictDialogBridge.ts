/**
 * ConflictDialogBridge - Promise-based bridge for webview conflict dialogs
 *
 * Bridges async/await backend patterns with webview message passing.
 * The backend calls showConflict() which sends a message to the frontend,
 * then awaits the promise. When the frontend sends back a resolution message,
 * handleResolution() resolves the pending promise.
 *
 * PANEL ISOLATION:
 * Each panel gets its own ConflictDialogBridge instance via PanelContext.
 *
 * @module services/ConflictDialogBridge
 */

import { logger } from '../utils/logger';

// ============= TYPES =============

export type ConflictDialogType = 'external_changes' | 'presave_conflict';

export type PerFileAction =
    | 'overwrite'
    | 'overwrite_backup_external'
    | 'load_external'
    | 'load_external_backup_mine'
    | 'import'
    | 'ignore'
    | 'skip';

export interface ConflictFileInfo {
    path: string;
    relativePath: string;
    fileType: 'main' | 'include-column' | 'include-task' | 'include-regular';
    hasExternalChanges: boolean;
    hasUnsavedChanges: boolean;
    isInEditMode: boolean;
    contentPreview?: string;
}

export type OpenMode = 'browse' | 'save_conflict' | 'reload_request' | 'external_change';

export interface ConflictDialogRequest {
    conflictType: ConflictDialogType;
    files: ConflictFileInfo[];
    openMode?: OpenMode;
}

export interface PerFileResolution {
    path: string;
    action: PerFileAction;
}

export interface ConflictDialogResult {
    cancelled: boolean;
    perFileResolutions: PerFileResolution[];
}

interface PendingConflict {
    resolve: (result: ConflictDialogResult) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
}

// ============= MAIN CLASS =============

/** Timeout for conflict dialog response (2 minutes) */
const CONFLICT_DIALOG_TIMEOUT_MS = 120_000;

/**
 * ConflictDialogBridge
 *
 * Sends conflict info to the webview and awaits user resolution.
 * The caller provides a postMessage callback to decouple from WebviewBridge.
 */
export class ConflictDialogBridge {
    private readonly _panelId: string;
    private _pending = new Map<string, PendingConflict>();
    private _nextId = 1;

    constructor(panelId: string) {
        this._panelId = panelId;
    }

    /**
     * Show a conflict dialog in the webview.
     *
     * @param postMessage - callback to send a message to the webview
     * @param request - conflict info (type + files)
     * @returns Promise that resolves when the user makes a choice
     */
    async showConflict(
        postMessage: (message: any) => boolean,
        request: ConflictDialogRequest
    ): Promise<ConflictDialogResult> {
        const conflictId = `conflict_${this._panelId}_${this._nextId++}`;

        return new Promise<ConflictDialogResult>((resolve, reject) => {
            const timeout = setTimeout(() => {
                this._pending.delete(conflictId);
                reject(new Error(`[ConflictDialogBridge] Conflict dialog timed out: ${conflictId}`));
            }, CONFLICT_DIALOG_TIMEOUT_MS);

            this._pending.set(conflictId, { resolve, reject, timeout });

            const sent = postMessage({
                type: 'showConflictDialog',
                conflictId,
                conflictType: request.conflictType,
                files: request.files,
                openMode: request.openMode
            });

            if (!sent) {
                clearTimeout(timeout);
                this._pending.delete(conflictId);
                reject(new Error(`[ConflictDialogBridge] Failed to send conflict dialog message: ${conflictId}`));
            }
        });
    }

    /**
     * Handle a resolution message from the webview.
     * Called by the message handler when the frontend sends 'conflictResolution'.
     */
    handleResolution(conflictId: string, result: ConflictDialogResult): void {
        const pending = this._pending.get(conflictId);
        if (!pending) {
            logger.warn(`[ConflictDialogBridge] No pending conflict for ID: ${conflictId}`);
            return;
        }

        clearTimeout(pending.timeout);
        this._pending.delete(conflictId);
        pending.resolve(result);
    }

    /**
     * Cancel all pending conflict dialogs.
     * Called when the panel is being disposed.
     */
    cancelAll(): void {
        for (const [conflictId, pending] of this._pending) {
            clearTimeout(pending.timeout);
            pending.resolve({ cancelled: true, perFileResolutions: [] });
        }
        this._pending.clear();
    }

    /**
     * Check if there is an active conflict dialog.
     */
    get hasActiveDialog(): boolean {
        return this._pending.size > 0;
    }
}
