/**
 * Options for save() operation
 * Provides explicit control over save behavior without hidden global state
 */
export interface SaveOptions {
    /**
     * Whether to skip reload detection for this save
     * TRUE = This is our own save, suppress matching watcher events via self-save fingerprinting
     * FALSE = Treat as external change (rare - only for external triggers)
     *
     * Default: true (most saves are our own code)
     */
    skipReloadDetection?: boolean;

    /**
     * Source context for logging and debugging
     */
    source?: 'ui-edit' | 'conflict-resolution' | 'auto-save' | 'include-update' | 'external-trigger' | 'unknown';

    /**
     * Skip validation before save (for performance)
     */
    skipValidation?: boolean;

    /**
     * Force save even if hasUnsavedChanges() returns false
     * Use for emergency recovery (forceWriteAll) only
     *
     * Default: false
     */
    force?: boolean;
}
