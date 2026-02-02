import { MarkdownFile } from '../files/MarkdownFile';
import { MainKanbanFile } from '../files/MainKanbanFile';

/**
 * Unified External Change Handler - Single logic for all file types
 *
 * Consolidates the conflicting handleExternalChange implementations from:
 * - MainKanbanFile.handleExternalChange()
 * - IncludeFile.handleExternalChange()
 *
 * Provides consistent conflict resolution for all file types.
 *
 * NOTE: Legitimate saves (our own writes) are filtered out by _onFileSystemChange()
 * using the _skipReloadCounter flag (set via SaveOptions). This handler only
 * receives TRUE external changes.
 *
 * NOTE: Parent notification for include files is handled by the file registry change
 * notification system (_handleFileRegistryChange -> _sendIncludeFileUpdateToFrontend).
 * This handler only handles conflict detection and resolution.
 */
export class UnifiedChangeHandler {
    private static instance: UnifiedChangeHandler | undefined;

    private constructor() {
        // No dependencies needed - conflict detection is handled by files themselves
    }

    public static getInstance(): UnifiedChangeHandler {
        if (!UnifiedChangeHandler.instance) {
            UnifiedChangeHandler.instance = new UnifiedChangeHandler();
        }
        return UnifiedChangeHandler.instance;
    }

    /**
     * Unified external change handling for all file types
     * Replaces multiple conflicting implementations
     */
    public async handleExternalChange(
        file: MarkdownFile,
        changeType: 'modified' | 'deleted' | 'created'
    ): Promise<void> {
        // Handle file deletion
        if (changeType === 'deleted') {
            await this.handleFileDeleted(file);
            return;
        }

        // Handle file creation
        if (changeType === 'created') {
            await this.handleFileCreated(file);
            return;
        }

        // Handle file modification - this is where conflicts can occur
        await this.handleFileModified(file);
    }

    /**
     * Handle file deletion
     */
    private async handleFileDeleted(file: MarkdownFile): Promise<void> {
        // Mark file as deleted
        file.setExists(false);
        // Parent notification handled by file registry change notification system
    }

    /**
     * Handle file creation
     */
    private async handleFileCreated(file: MarkdownFile): Promise<void> {
        // Mark file as existing
        file.setExists(true);

        // Reload content
        await file.reload();
        // Parent notification handled by file registry change notification system
    }

    /**
     * Handle file modification - conflict resolution logic
     *
     * Only TRUE external changes reach this point (legitimate saves are
     * filtered out by _onFileSystemChange via _skipReloadCounter).
     *
     * NOTE: We do NOT check file.hasExternalChanges() here because:
     * - For the watcher path, _hasFileSystemChanges is always true (set before this runs)
     * - For the focus path, it may or may not be set
     * - The fact that this method is called already means an external change was detected
     * - hasConflict() catches VS Code editor dirty + external change scenarios
     */
    private async handleFileModified(file: MarkdownFile): Promise<void> {
        // For main file changes, also check include files and cached board state
        const hasAnyUnsavedChanges = file.getFileType() === 'main'
            ? this.hasAnyUnsavedChangesInRegistry(file)
            : file.hasUnsavedChanges();

        // Safe auto-reload: no local changes and no conflict detected
        if (!hasAnyUnsavedChanges && !file.hasConflict()) {
            await file.reload();
            return;
        }

        // Any form of conflict (unsaved + external, or file's own conflict detection)
        await this.showConflictDialog(file);
    }

    /**
     * Show conflict resolution dialog
     */
    private async showConflictDialog(file: MarkdownFile): Promise<void> {
        try {
            // NOTE: Editing is already stopped in MarkdownFile._onFileSystemChange()
            // Just clear the flag here before showing dialog
            if (file.isInEditMode()) {
                file.setEditMode(false);
            }

            await file.showConflictDialog();
            // Parent notification handled by file registry change notification system
        } catch (error) {
            console.error(`[UnifiedChangeHandler] Conflict dialog failed:`, error);
            // If dialog fails, keep current state to prevent data loss
        }
    }

    /**
     * Check if any files in the registry have unsaved changes.
     * Only called for main files - checks the main file itself, include files, and cached board state.
     */
    private hasAnyUnsavedChangesInRegistry(file: MarkdownFile): boolean {
        const fileRegistry = file.getFileRegistry();
        if (!fileRegistry) {
            return file.hasUnsavedChanges();
        }

        // CRITICAL: Check the main file's own unsaved changes too
        // Without this, a main file with _content !== _baseline would be
        // auto-reloaded, silently discarding its unsaved content.
        if (file.hasUnsavedChanges()) {
            return true;
        }

        const hasIncludeChanges = fileRegistry.getIncludeFiles().some(f => f.hasUnsavedChanges());

        // CRITICAL: Also check if there's a cached board from webview (UI edits)
        const mainFile = file as MainKanbanFile;
        const hasCachedBoardChanges = !!mainFile.getCachedBoardFromWebview?.();

        return hasIncludeChanges || hasCachedBoardChanges;
    }
}
