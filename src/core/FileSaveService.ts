import { MarkdownFile } from '../files/MarkdownFile';
import { SaveOptions } from '../files/SaveOptions';

/**
 * FileSaveService - Unified service for all file save operations
 *
 * Uses SaveOptions interface for consistent, parameter-based save handling.
 * NO timing-based heuristics - uses instance-level flags instead (SaveOptions.skipReloadDetection).
 *
 * ARCHITECTURE:
 * - All saves go through FileSaveService.saveFile()
 * - FileSaveService calls file.save(SaveOptions)
 * - SaveOptions.skipReloadDetection (default: true) sets instance flag _skipReloadCounter
 * - File watcher checks instance flag and skips reload if true
 * - No global state, no timing windows, just clean parameter-based design
 *
 * NOTE: This handles actual FILE SAVE OPERATIONS.
 * For VS Code save events (onDidSaveTextDocument), see SaveEventDispatcher.
 *
 * PANEL ISOLATION:
 * Each panel gets its own FileSaveService instance via PanelContext.
 * This ensures save operations from one panel don't interfere with another.
 */
export class FileSaveService {
    private readonly _panelId: string;
    private activeSaves = new Map<string, Promise<void>>();

    constructor(panelId: string) {
        this._panelId = panelId;
    }

    get panelId(): string {
        return this._panelId;
    }

    /**
     * Unified save method for all file types
     * Uses SaveOptions for consistent, parameter-based save handling
     *
     * IMPORTANT: This is THE ONLY entry point for all file saves.
     * All saves MUST go through this method to ensure:
     * - Hash-based unsaved detection is respected
     * - Concurrent saves are prevented
     * - SaveOptions are applied consistently
     */
    public async saveFile(file: MarkdownFile, content?: string, options?: SaveOptions): Promise<void> {
        // Hard guard: never overwrite dirty editor buffers unless explicitly forced.
        if (!options?.force && file.isDirtyInEditor()) {
            throw new Error(
                `Cannot save "${file.getRelativePath()}" while it has unsaved text-editor changes. `
                + 'Save the editor document first or use explicit conflict resolution.'
            );
        }

        // HASH CHECK: Skip save if no unsaved changes (unless forced)
        // This prevents unnecessary disk writes and ensures hash-based state is respected
        if (!options?.force && !file.hasUnsavedChanges() && content === undefined) {
            return; // No changes to save
        }

        const filePath = file.getPath();
        const saveKey = `${file.getFileType()}:${filePath}`;

        // If a save is already in-flight for this file, wait for it to finish
        // then retry if the file still has unsaved changes (the in-flight save
        // may not have included our newer content).
        if (this.activeSaves.has(saveKey)) {
            await this.activeSaves.get(saveKey);
            if (!file.hasUnsavedChanges() && content === undefined) {
                return; // In-flight save covered our content
            }
            // Fall through to save again with the newer content
        }

        const savePromise = this.performSave(file, content, options);
        this.activeSaves.set(saveKey, savePromise);

        try {
            await savePromise;
        } finally {
            this.activeSaves.delete(saveKey);
        }
    }

    /**
     * Perform the actual save operation using SaveOptions
     */
    private async performSave(file: MarkdownFile, content?: string, options?: SaveOptions): Promise<void> {
        // If content is provided, update file content first
        // IMPORTANT: Never update baseline before a successful disk write.
        // Otherwise failed writes can be misreported as saved.
        if (content !== undefined) {
            file.setContent(content, false);
        }

        const saveOptions: SaveOptions = {
            skipReloadDetection: options?.skipReloadDetection ?? true,
            source: options?.source ?? 'auto-save',
            skipValidation: options?.skipValidation ?? false
        };

        await file.save(saveOptions);
    }
}
