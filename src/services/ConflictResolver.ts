import * as vscode from 'vscode';
import { confirmSaveOnClose } from './NotificationService';

export type ConflictType = 'panel_close' | 'external_main' | 'external_include' | 'presave_check' | 'watcher_failure' | 'permission_denied' | 'file_missing' | 'circular_dependency' | 'batch_conflict' | 'network_timeout' | 'crash_recovery';
/**
 * File type for conflict resolution context.
 * Note: This is different from IncludeConstants.FileType which has specific include subtypes.
 * ConflictFileType is simpler: just 'main' vs any kind of 'include'.
 */
export type ConflictFileType = 'main' | 'include';

export interface ConflictContext {
    type: ConflictType;
    fileType: ConflictFileType;
    filePath: string;
    fileName: string;
    hasMainUnsavedChanges: boolean;
    hasIncludeUnsavedChanges: boolean;
    hasExternalChanges?: boolean;
    changedIncludeFiles: string[];
    isClosing?: boolean;
    isInEditMode?: boolean;  // User is actively editing (cursor in editor)
}

export interface ConflictResolution {
    action: 'save' | 'discard_local' | 'discard_external' | 'ignore' | 'cancel' | 'backup_and_reload' | 'backup_external_and_save';
    shouldProceed: boolean;
    shouldCreateBackup: boolean;
    shouldBackupExternal?: boolean;  // Optional: backup external file before saving
    shouldSave: boolean;
    shouldReload: boolean;
    shouldIgnore: boolean;
    customAction?: string;
}

/**
 * Centralized conflict resolution system that handles all file change protection scenarios
 * with consistent dialogs and unified logic to prevent multiple dialog appearances.
 *
 * PANEL ISOLATION:
 * Each panel gets its own ConflictResolver instance via PanelContext.
 * This ensures conflict dialogs from one panel don't interfere with another.
 *
 * NOTE: External change dialogs (external_main, external_include) are now handled
 * by the batched import system in UnifiedChangeHandler. This class only handles:
 * - panel_close: Unsaved changes when closing panel
 * - presave_check: Pre-save conflict dialog (Scenario 2)
 */
export class ConflictResolver {
    private readonly _panelId: string;
    private activeDialogs = new Set<string>();
    private pendingResolutions = new Map<string, Promise<ConflictResolution>>();

    constructor(panelId: string) {
        this._panelId = panelId;
    }

    get panelId(): string {
        return this._panelId;
    }

    /**
     * Resolve a conflict with deduplication to prevent multiple dialogs
     */
    public async resolveConflict(context: ConflictContext): Promise<ConflictResolution> {
        const dialogKey = this.generateDialogKey(context);

        // Check if a dialog for this context is already active
        if (this.activeDialogs.has(dialogKey)) {
            const existing = this.pendingResolutions.get(dialogKey);
            if (existing) {
                return await existing;
            }
        }

        // Mark dialog as active and create resolution promise
        this.activeDialogs.add(dialogKey);
        const resolutionPromise = this.showConflictDialog(context);
        this.pendingResolutions.set(dialogKey, resolutionPromise);

        try {
            const resolution = await resolutionPromise;
            return resolution;
        } finally {
            // Clean up tracking
            this.activeDialogs.delete(dialogKey);
            this.pendingResolutions.delete(dialogKey);
        }
    }

    /**
     * Generate a unique key for dialog deduplication
     */
    private generateDialogKey(context: ConflictContext): string {
        const fileIdentifier = context.fileType === 'main' ? 'main' : context.filePath;
        return `${context.type}_${fileIdentifier}`;
    }

    /**
     * Show appropriate conflict dialog based on context.
     *
     * external_main and external_include are now handled by the batched import
     * system in UnifiedChangeHandler — they no-op here.
     */
    private async showConflictDialog(context: ConflictContext): Promise<ConflictResolution> {
        switch (context.type) {
            case 'panel_close':
                return this.showPanelCloseDialog(context);
            case 'presave_check':
                return this.showPresaveCheckDialog(context);
            case 'external_main':
            case 'external_include':
                // Handled by batched import system in UnifiedChangeHandler — ignore here
                return {
                    action: 'ignore',
                    shouldProceed: true,
                    shouldCreateBackup: false,
                    shouldBackupExternal: false,
                    shouldSave: false,
                    shouldReload: false,
                    shouldIgnore: true
                };
            default:
                throw new Error(`Unknown conflict type: ${context.type}`);
        }
    }

    /**
     * Panel close dialog - handles unsaved changes when panel is being closed
     */
    private async showPanelCloseDialog(context: ConflictContext): Promise<ConflictResolution> {
        let message = '';

        // Build include files list if present
        const includeFilesList = context.changedIncludeFiles && context.changedIncludeFiles.length > 0
            ? '\n\nChanged include files:\n' + context.changedIncludeFiles.map(f => `  • ${f}`).join('\n')
            : '';

        if (context.hasMainUnsavedChanges && context.hasIncludeUnsavedChanges) {
            message = `You have unsaved changes in "${context.fileName}" and in column include files.${includeFilesList}\n\nDo you want to save before closing?`;
        } else if (context.hasMainUnsavedChanges) {
            message = `You have unsaved changes in "${context.fileName}". Do you want to save before closing?`;
        } else if (context.hasIncludeUnsavedChanges) {
            message = `You have unsaved changes in column include files.${includeFilesList}\n\nDo you want to save before closing?`;
        } else {
            // No unsaved changes - allow close
            return {
                action: 'ignore',
                shouldProceed: true,
                shouldCreateBackup: false,
                shouldBackupExternal: false,
                shouldSave: false,
                shouldReload: false,
                shouldIgnore: true
            };
        }

        const choice = await confirmSaveOnClose(message);

        switch (choice) {
            case 'cancel':
                return {
                    action: 'cancel',
                    shouldProceed: false,
                    shouldCreateBackup: false,
                    shouldSave: false,
                    shouldReload: false,
                    shouldIgnore: false
                };
            case 'save':
                return {
                    action: 'save',
                    shouldProceed: true,
                    shouldCreateBackup: false,
                    shouldSave: true,
                    shouldReload: false,
                    shouldIgnore: false
                };
            case 'discard':
                return {
                    action: 'discard_local',
                    shouldProceed: true,
                    shouldCreateBackup: false,
                    shouldSave: false,
                    shouldReload: true,
                    shouldIgnore: false
                };
            default:
                return {
                    action: 'cancel',
                    shouldProceed: false,
                    shouldCreateBackup: false,
                    shouldSave: false,
                    shouldReload: false,
                    shouldIgnore: false
                };
        }
    }

    /**
     * Pre-save check dialog (Scenario 2) — shown when saving but external changes are pending.
     *
     * Three options:
     * - "Overwrite (backup external)": Save kanban, backup the external version
     * - "Load external (backup mine)": Backup kanban content, reload from disk
     * - "Skip": Cancel save entirely
     */
    private async showPresaveCheckDialog(context: ConflictContext): Promise<ConflictResolution> {
        const fileList = context.changedIncludeFiles.map(f => `  • ${f}`).join('\n');
        const message = `External changes pending in:\n${fileList}\n\nSaving will overwrite these files.`;

        const overwrite = 'Overwrite (backup external)';
        const loadExternal = 'Load external (backup mine)';
        const skip = 'Skip';

        const choice = await vscode.window.showWarningMessage(
            message,
            { modal: true },
            overwrite,
            loadExternal,
            skip
        );

        switch (choice) {
            case overwrite:
                return {
                    action: 'backup_external_and_save',
                    shouldProceed: true,
                    shouldCreateBackup: false,
                    shouldBackupExternal: true,
                    shouldSave: true,
                    shouldReload: false,
                    shouldIgnore: false
                };
            case loadExternal:
                return {
                    action: 'backup_and_reload',
                    shouldProceed: true,
                    shouldCreateBackup: true,
                    shouldBackupExternal: false,
                    shouldSave: false,
                    shouldReload: true,
                    shouldIgnore: false
                };
            default: // Skip or ESC
                return {
                    action: 'cancel',
                    shouldProceed: false,
                    shouldCreateBackup: false,
                    shouldSave: false,
                    shouldReload: false,
                    shouldIgnore: false
                };
        }
    }
}
