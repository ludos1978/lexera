import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createHash } from 'crypto';
import { ConflictResolver } from '../services/ConflictResolver';
import { BackupManager } from '../services/BackupManager';
import { SaveOptions } from './SaveOptions';
import { SaveTransactionManager } from './SaveTransactionManager';
import { WatcherCoordinator } from './WatcherCoordinator';
import { normalizePathForLookup, isSamePath, getErrorMessage } from '../utils/stringUtils';
import { CapturedEdit, IMarkdownFileRegistry } from './FileInterfaces';
import { getVisibleConflictPath } from '../constants/FileNaming';
import { SAVE_VERIFICATION_MAX_ATTEMPTS, SAVE_VERIFICATION_RETRY_DELAY_MS } from '../constants/TimeoutConstants';

/**
 * File change event emitted when file state changes
 */
export interface FileChangeEvent {
    file: MarkdownFile;
    changeType: 'content' | 'external' | 'saved' | 'reloaded' | 'conflict';
    timestamp: Date;
}

interface PendingSelfSaveMarker {
    id: string;
    fingerprint: string;
    length: number;
    expiresAt: number;
}

const SELF_SAVE_MARKER_TTL_MS = 10000;
const SELF_SAVE_EVENT_READ_RETRIES = 3;
const SELF_SAVE_EVENT_RETRY_DELAY_MS = 30;

/**
 * Abstract base class for all markdown files in the Kanban system.
 * Encapsulates file state, operations, and change detection.
 *
 * Key Responsibilities:
 * - Track file content (current, baseline, unsaved changes)
 * - Detect external file changes via file watchers
 * - Handle conflicts between local and external changes
 * - Provide read/write operations
 * - Emit events for state changes
 */
export abstract class MarkdownFile implements vscode.Disposable {
    // ============= FILE IDENTITY =============
    protected _path: string;                  // Absolute file path
    protected _relativePath: string;          // Relative path (for includes, same as _path for main) - ORIGINAL CASING
    protected _normalizedRelativePath: string; // Normalized relative path (lowercase, forward slashes) - FOR LOOKUPS

    // ============= CONTENT STATE =============
    protected _content: string = '';          // Current content in memory
    protected _baseline: string = '';         // Last known saved content (snapshot)

    // ============= BACKEND STATE (File System & VS Code Editor) =============
    protected _exists: boolean = true;
    protected _lastAccessErrorCode: string | null = null;
    protected _lastModified: Date | null = null;
    protected _documentVersion: number = 0;
    protected _hasFileSystemChanges: boolean = false;  // File changed on disk outside VS Code

    // ============= FRONTEND STATE (Kanban UI) =============
    protected _isInEditMode: boolean = false;          // User actively editing in task/column editor
    protected _preserveRawContent: boolean = false;    // Raw content should not be regenerated (edited via diff view)

    // ============= SAVE STATE (Instance-level, no global registry!) =============
    // Tracks fingerprints of our own writes so watcher events can be matched
    // deterministically to self-saves (instead of timing/counter heuristics).
    private _pendingSelfSaveMarkers: PendingSelfSaveMarker[] = [];
    private _nextSelfSaveMarkerId = 0;

    // ============= CHANGE DETECTION =============
    protected _fileWatcher?: vscode.FileSystemWatcher;
    protected _watcherDisposable?: vscode.Disposable;
    protected _watcherSubscriptions: vscode.Disposable[] = []; // Store event listener disposables
    protected _isWatching: boolean = false;

    // PERFORMANCE: Shared watcher registry to prevent duplicates
    private static _activeWatchers = new Map<string, { watcher: vscode.FileSystemWatcher; refCount: number; lastActivity: Date }>();

    // PERFORMANCE: Transaction-based save operations (extracted to SaveTransactionManager.ts)
    protected static get _saveTransactionManager(): SaveTransactionManager {
        return SaveTransactionManager.getInstance();
    }

    // PERFORMANCE: Centralized watcher coordination (extracted to WatcherCoordinator.ts)
    protected static get _watcherCoordinator(): WatcherCoordinator {
        return WatcherCoordinator.getInstance();
    }

    // ============= EVENT EMITTER =============
    protected _onDidChange = new vscode.EventEmitter<FileChangeEvent>();
    public readonly onDidChange = this._onDidChange.event;

    // ============= CANCELLATION (FOUNDATION-2) =============
    private _currentReloadSequence: number = 0;     // Sequence counter for reload operations

    // ============= DEPENDENCIES =============
    protected _conflictResolver: ConflictResolver;
    protected _backupManager: BackupManager;
    protected _disposables: vscode.Disposable[] = [];

    constructor(
        path: string,
        relativePath: string,
        conflictResolver: ConflictResolver,
        backupManager: BackupManager
    ) {
        // FOUNDATION-1: Validate relative path before normalization
        this._validateRelativePath(relativePath);

        this._path = path;
        this._relativePath = relativePath;

        // FOUNDATION-1: Normalize and cache the normalized path
        this._normalizedRelativePath = MarkdownFile.normalizeRelativePath(relativePath);

        this._conflictResolver = conflictResolver;
        this._backupManager = backupManager;

        this._disposables.push(this._onDidChange);
    }

    // ============= ABSTRACT METHODS (must be implemented by subclasses) =============

    /**
     * Get the file type identifier
     */
    abstract getFileType(): 'main' | 'include-regular' | 'include-column' | 'include-task';

    /**
     * Read content from disk
     */
    abstract readFromDisk(): Promise<string | null>;

    /**
     * Write content to disk
     */
    abstract writeToDisk(content: string): Promise<void>;

    /**
     * Handle external file change (subclass-specific logic)
     */
    abstract handleExternalChange(changeType: 'modified' | 'deleted' | 'created'): Promise<void>;

    /**
     * Validate file content (format-specific validation)
     */
    abstract validate(content: string): { valid: boolean; errors?: string[] };

    /**
     * Get the file registry (if accessible from this file type)
     * MainKanbanFile returns its _fileRegistry, IncludeFile delegates to parent
     */
    public abstract getFileRegistry(): IMarkdownFileRegistry | undefined;

    // ============= PATH NORMALIZATION (FOUNDATION-1) =============
    // Note: Core path functions are in utils/stringUtils.ts
    // These static methods delegate to the centralized functions

    /**
     * Centralized normalization function for relative paths.
     * Delegates to normalizePathForLookup from stringUtils.
     *
     * @param relativePath The relative path to normalize
     * @returns Normalized path (lowercase, forward slashes, trimmed)
     */
    public static normalizeRelativePath(relativePath: string): string {
        return normalizePathForLookup(relativePath);
    }

    /**
     * Compare two paths for equality (normalized comparison).
     * Delegates to isSamePath from stringUtils.
     *
     * @param path1 First path to compare
     * @param path2 Second path to compare
     * @returns true if paths are equivalent (after normalization)
     */
    public static isSameFile(path1: string, path2: string): boolean {
        return isSamePath(path1, path2);
    }

    // ============= CANCELLATION HELPERS (FOUNDATION-2) =============

    /**
     * Start a new reload operation, invalidating all previous operations
     * FOUNDATION-2: Pattern 2 (Helper Method)
     *
     * @returns The sequence number for this operation
     */
    protected _startNewReload(): number {
        return ++this._currentReloadSequence;
    }

    /**
     * Check if this reload operation has been cancelled by a newer operation
     * FOUNDATION-2: Pattern 2 (Helper Method)
     *
     * @param mySequence - The sequence number of this operation
     * @returns true if cancelled, false if still current
     */
    protected _checkReloadCancelled(mySequence: number): boolean {
        return mySequence !== this._currentReloadSequence;
    }

    /**
     * Validate relative path before normalization
     * Detects common issues like pre-normalization, empty paths, etc.
     *
     * @param relativePath The relative path to validate
     * @throws Error if path is invalid
     */
    private _validateRelativePath(relativePath: string): void {
        // Check 1: Empty path
        if (!relativePath || relativePath.trim().length === 0) {
            throw new Error('[MarkdownFile] Relative path cannot be empty');
        }

        // Check 2: Excessive parent directory traversal (potential security concern)
        const normalized = path.normalize(relativePath);
        const parentDirCount = (normalized.match(/\.\.\//g) || []).length;
        if (parentDirCount > 3) {
            console.warn(`[MarkdownFile] ⚠️  Excessive parent directory traversal (${parentDirCount} levels): "${relativePath}"`);
        }
    }

    // ============= IDENTITY & INFO =============

    public getPath(): string {
        return this._path;
    }

    /**
     * Get the original relative path (preserves casing)
     *
     * Use for:
     * - Display in UI
     * - Logging
     * - User messages
     *
     * DO NOT use for:
     * - Path comparisons (use isSameFile() instead)
     * - Registry lookups (use getNormalizedRelativePath() or let registry handle it)
     *
     * @example
     */
    public getRelativePath(): string {
        return this._relativePath;
    }

    /**
     * Get the normalized relative path (lowercase, forward slashes)
     *
     * Use for:
     * - Registry operations (internal use)
     * - Path comparisons (or use isSameFile() helper)
     * - Map keys
     *
     * DO NOT use for:
     * - Display in UI (use getRelativePath() for original casing)
     * - User messages (use getRelativePath())
     *
     * @example
     * const file = registry.getByRelativePath(file.getNormalizedRelativePath());
     */
    public getNormalizedRelativePath(): string {
        return this._normalizedRelativePath;
    }

    public getFileName(): string {
        return path.basename(this._path);
    }

    public exists(): boolean {
        return this._exists;
    }

    public setExists(value: boolean): void {
        this._exists = value;
    }

    public getLastAccessErrorCode(): string | null {
        return this._lastAccessErrorCode;
    }

    /**
     * Probe whether this file can be written before starting a save pipeline.
     * Returns a filesystem error code when blocked (for example EACCES/EPERM/EROFS),
     * otherwise null when writing should be possible.
     */
    public async probeWriteAccess(): Promise<string | null> {
        try {
            await fs.promises.access(this._path, fs.constants.W_OK);
            this._clearAccessError();
            return null;
        } catch (error) {
            const code = this._extractErrorCode(error);
            if (code === 'ENOENT') {
                const parentCode = await this._probeWritableParentDirectory(path.dirname(this._path));
                if (!parentCode) {
                    this._clearAccessError();
                    return null;
                }
                this._lastAccessErrorCode = parentCode;
                return parentCode;
            }
            this._recordAccessError(error);
            return this._lastAccessErrorCode;
        }
    }

    protected _recordAccessError(error: unknown): void {
        if (error && typeof error === 'object' && 'code' in error && typeof (error as { code?: unknown }).code === 'string') {
            this._lastAccessErrorCode = (error as { code: string }).code;
            return;
        }
        this._lastAccessErrorCode = 'UNKNOWN';
    }

    protected _clearAccessError(): void {
        this._lastAccessErrorCode = null;
    }

    private async _probeWritableParentDirectory(startDirectory: string): Promise<string | null> {
        let currentDirectory = startDirectory;

        while (true) {
            try {
                await fs.promises.access(currentDirectory, fs.constants.W_OK);
                return null;
            } catch (error) {
                const code = this._extractErrorCode(error);
                if (code === 'ENOENT') {
                    const parentDirectory = path.dirname(currentDirectory);
                    if (parentDirectory === currentDirectory) {
                        return code;
                    }
                    currentDirectory = parentDirectory;
                    continue;
                }
                return code;
            }
        }
    }

    private _extractErrorCode(error: unknown): string {
        if (error && typeof error === 'object' && 'code' in error && typeof (error as { code?: unknown }).code === 'string') {
            return (error as { code: string }).code;
        }
        return 'UNKNOWN';
    }

    public getLastModified(): Date | null {
        return this._lastModified;
    }

    // ============= CONTENT ACCESS =============

    public getContent(): string {
        return this._content;
    }

    /**
     * Return the safest "my version" content for backup operations.
     * Prefers dirty VS Code editor buffer text when available.
     */
    public getContentForBackup(): string {
        const openDocument = vscode.workspace.textDocuments.find(doc => doc.uri.fsPath === this._path);
        if (openDocument?.isDirty) {
            return openDocument.getText();
        }
        return this._content;
    }

    public getBaseline(): string {
        return this._baseline;
    }

    /**
     * Set content (marks as unsaved unless baseline is updated)
     */
    public setContent(content: string, updateBaseline: boolean = false): void {
        const oldContent = this._content;
        this._content = content;

        if (updateBaseline) {
            this._baseline = content;
            // Do NOT emit 'content' event when updateBaseline=true
            // This is used after saving to update internal state - not an actual change
        } else if (oldContent !== content) {
            this._emitChange('content');
        }
    }

    // ============= STATE QUERIES =============

    public hasUnsavedChanges(): boolean {
        // Computed property: always compare current content to baseline
        // This ensures it's always accurate and can never drift out of sync
        return this._content !== this._baseline;
    }

    public hasExternalChanges(): boolean {
        return this._hasFileSystemChanges;
    }

    public isWatcherActive(): boolean {
        return this._isWatching;
    }

    public isInEditMode(): boolean {
        return this._isInEditMode;
    }

    public setEditMode(inEditMode: boolean): void {
        this._isInEditMode = inEditMode;
    }

    /**
     * Check if raw content should be preserved (not regenerated from tasks)
     * Set when content is edited via diff view to prevent regeneration from overwriting raw edits
     */
    public shouldPreserveRawContent(): boolean {
        return this._preserveRawContent;
    }

    /**
     * Set whether raw content should be preserved
     * @param value true to prevent regeneration from tasks, false to allow normal regeneration
     */
    public setPreserveRawContent(value: boolean): void {
        if (this._preserveRawContent !== value) {
            console.log(`[MarkdownFile.setPreserveRawContent] "${this._relativePath}": ${this._preserveRawContent} → ${value}`);
        }
        this._preserveRawContent = value;
    }

    public isDirtyInEditor(): boolean {
        // Delegates to actual VS Code document dirty check
        return this.isDocumentDirtyInVSCode();
    }

    /**
     * Check if VS Code has this file open and it's dirty (unsaved in text editor)
     * This is the common pattern used by both MainKanbanFile and IncludeFile
     */
    protected isDocumentDirtyInVSCode(): boolean {
        const openDocuments = vscode.workspace.textDocuments;
        return openDocuments.some(doc =>
            doc.uri.fsPath === this._path && doc.isDirty
        );
    }

    /**
     * Check if file has any unsaved changes from any source:
     * - Internal state (kanban UI edits)
     * - Edit mode (user actively editing)
     * - VS Code document dirty (text editor edits)
     */
    public hasAnyUnsavedChanges(): boolean {
        // Check 1: Internal state flag (from kanban UI) - computed from content comparison
        if (this.hasUnsavedChanges()) return true;

        // Check 2: Edit mode (user is actively editing)
        if (this._isInEditMode) return true;

        // Check 3: VSCode document dirty status (text editor edits)
        if (this.isDocumentDirtyInVSCode()) return true;

        return false;
    }

    /**
     * Check if file has a conflict (both local and external changes)
     * Includes VS Code document dirty status in conflict detection
     */
    public hasConflict(): boolean {
        // Base check: kanban UI changes + external changes
        const hasKanbanConflict = (this.hasUnsavedChanges() || this._isInEditMode) && this._hasFileSystemChanges;

        // Also check VS Code document dirty status
        const documentIsDirty = this.isDocumentDirtyInVSCode();
        const hasEditorConflict = documentIsDirty && this._hasFileSystemChanges;

        return hasKanbanConflict || hasEditorConflict;
    }

    /**
     * Check if file needs to be reloaded from disk
     * (has external changes, not editing, no unsaved changes)
     */
    public needsReload(): boolean {
        return this._hasFileSystemChanges && !this._isInEditMode && !this.hasUnsavedChanges();
    }

    // ============= FILE OPERATIONS =============

    /**
     * Reload content from disk and update baseline
     * Verifies content has actually changed before accepting
     * FOUNDATION-2: Protected against race conditions via sequence counter
     */
    public async reload(): Promise<void> {

        // PERFORMANCE: Use watcher coordinator to prevent conflicts
        await MarkdownFile._watcherCoordinator.startOperation(this._path, 'reload');

        try {
            // FOUNDATION-2: Start new reload sequence, invalidating previous operations
            const mySequence = this._startNewReload();

            const content = await this._readFromDiskWithVerification();

            // FOUNDATION-2: Check if this reload was cancelled during async operation
            if (this._checkReloadCancelled(mySequence)) {
                return;
            }

            if (content !== null) {
                // Check if content actually changed (verification returns baseline if unchanged)
                if (content !== this._baseline) {
                    // FOUNDATION-2: Final check before applying changes
                    if (this._checkReloadCancelled(mySequence)) {
                        return;
                    }

                    this._content = content;
                    this._baseline = content;
                    this._hasFileSystemChanges = false;
                    this._preserveRawContent = false; // Clear flag - reloaded content is fresh from disk
                    this._lastModified = await this._getFileModifiedTime();

                    this._emitChange('reloaded');
                } else {
                    // Content unchanged - verification returned baseline, this is a false alarm
                    this._hasFileSystemChanges = false;
                    this._preserveRawContent = false; // Clear flag on reload
                    this._lastModified = await this._getFileModifiedTime();
                }
            } else {
                console.warn(`[${this.getFileType()}] ⚠ Reload failed - null returned`);
            }
        } finally {
            // PERFORMANCE: End operation in coordinator
            MarkdownFile._watcherCoordinator.endOperation(this._path, 'reload');
        }
    }

    /**
     * Read from disk with verification that content has actually changed
     * Retries if file appears unchanged (incomplete write)
     */
    protected async _readFromDiskWithVerification(): Promise<string | null> {
        // Check mtime
        const currentMtime = await this._getFileModifiedTime();
        const mtimeChanged = currentMtime && this._lastModified &&
            currentMtime.getTime() !== this._lastModified.getTime();

        // Check file size
        const currentSize = await this._getFileSize();
        const baselineSize = Buffer.byteLength(this._baseline, 'utf8');
        const sizeChanged = currentSize !== null && currentSize !== baselineSize;

        // CRITICAL: If mtime or size is null, file might be deleted - must call readFromDisk()
        // to properly update _exists flag. Don't short-circuit in this case.
        const fileMightBeDeleted = currentMtime === null || currentSize === null;

        // If BOTH mtime and size are unchanged AND file still exists, no change
        if (!fileMightBeDeleted && !mtimeChanged && !sizeChanged && this._baseline) {
            return this._baseline;
        }

        // Either mtime or size changed, OR file might be deleted - read content
        const content = await this.readFromDisk();
        if (content === null) {
            console.error(`[${this.getFileType()}] Read failed`);
            return null;
        }

        return content;
    }

    /**
     * Save current content to disk and update baseline
     * @param options - Save options (skipReloadDetection, source, etc.)
     */
    public async save(options: SaveOptions = {}): Promise<void> {
        const skipReloadDetection = options.skipReloadDetection ?? true;
        const skipValidation = options.skipValidation ?? false;

        // PERFORMANCE: Use watcher coordinator to prevent conflicts
        await MarkdownFile._watcherCoordinator.startOperation(this._path, 'save');

        // TRANSACTION: Begin save transaction for rollback capability
        const originalState = {
            content: this._content,
            baseline: this._baseline,
            hasFileSystemChanges: this._hasFileSystemChanges,
            lastModified: this._lastModified
        };
        const transactionId = MarkdownFile._saveTransactionManager.beginTransaction(this._path, originalState);
        const attemptedContent = this._content;
        let selfSaveMarkerId: string | null = null;
        let writeAttempted = false;

        try {
            // Validate before saving unless explicitly skipped.
            if (!skipValidation) {
                const validation = this.validate(this._content);
                if (!validation.valid) {
                    const errors = validation.errors?.join(', ') || 'Unknown validation error';
                    throw new Error(`Cannot save ${this._relativePath}: ${errors}`);
                }
            }

            const expectedContent = attemptedContent;
            if (skipReloadDetection) {
                selfSaveMarkerId = this._registerPendingSelfSaveMarker(expectedContent);
            }
            writeAttempted = true;
            await this.writeToDisk(expectedContent);
            await this._verifyContentWasPersisted(expectedContent);

            // Update state after successful write
            this._baseline = this._content;
            this._hasFileSystemChanges = false;
            this._lastModified = await this._getFileModifiedTime() ?? new Date();
            this._preserveRawContent = false; // Clear flag after save - raw content is now the baseline

            // TRANSACTION: Commit the transaction
            MarkdownFile._saveTransactionManager.commitTransaction(this._path, transactionId);

            this._emitChange('saved');
        } catch (error) {
            // TRANSACTION: Rollback on failure
            console.error(`[${this.getFileType()}] Save failed, rolling back:`, error);
            MarkdownFile._saveTransactionManager.rollbackTransaction(this._path, transactionId);

            // Restore original state
            this._content = originalState.content;
            this._baseline = originalState.baseline;
            this._hasFileSystemChanges = originalState.hasFileSystemChanges;
            this._lastModified = originalState.lastModified;

            let reconciliationResult: 'saved' | 'unchanged' | 'diverged' | 'unknown' = 'unchanged';
            if (writeAttempted) {
                reconciliationResult = await this._reconcileDiskStateAfterFailedSave(
                    attemptedContent,
                    originalState.baseline
                );
                if (reconciliationResult === 'saved') {
                    return;
                }
            }
            if (selfSaveMarkerId) {
                this._removePendingSelfSaveMarker(selfSaveMarkerId);
            }

            const saveErrorMessage = getErrorMessage(error);
            let emergencyBackupPath: string | null = null;
            let emergencyBackupError: string | null = null;

            try {
                emergencyBackupPath = await this._persistEmergencyBackup(attemptedContent);
            } catch (backupError) {
                emergencyBackupError = getErrorMessage(backupError);
            }

            if (emergencyBackupPath) {
                this._showBackupNotification(
                    emergencyBackupPath,
                    `Save failed for "${this._relativePath}". Emergency backup created: ${path.basename(emergencyBackupPath)}`
                );
                throw new Error(
                    `Failed to save "${this._relativePath}" to the main file. `
                    + `Emergency backup created at "${emergencyBackupPath}". `
                    + `Original error: ${saveErrorMessage}`
                );
            }

            const backupFailureDetail = emergencyBackupError
                ? ` Backup error: ${emergencyBackupError}`
                : ' Backup creation returned no file path.';
            throw new Error(
                `Failed to save "${this._relativePath}" and failed to create an emergency backup. `
                + `Original error: ${saveErrorMessage}.${backupFailureDetail}`
            );
        } finally {
            // PERFORMANCE: End operation in coordinator
            MarkdownFile._watcherCoordinator.endOperation(this._path, 'save');
        }
    }

    private async _reconcileDiskStateAfterFailedSave(
        expectedContent: string,
        originalBaseline: string
    ): Promise<'saved' | 'unchanged' | 'diverged' | 'unknown'> {
        let diskContent: string | null = null;
        try {
            diskContent = await this.readFromDisk();
        } catch {
            diskContent = null;
        }

        if (diskContent === null) {
            this._hasFileSystemChanges = true;
            return 'unknown';
        }

        const normalizedDisk = this._normalizeLineEndings(diskContent);
        const normalizedExpected = this._normalizeLineEndings(expectedContent);
        if (normalizedDisk === normalizedExpected) {
            this._content = expectedContent;
            this._baseline = expectedContent;
            this._hasFileSystemChanges = false;
            this._lastModified = await this._getFileModifiedTime() ?? new Date();
            this._preserveRawContent = false;
            this._emitChange('saved');
            return 'saved';
        }

        const normalizedOriginalBaseline = this._normalizeLineEndings(originalBaseline);
        if (normalizedDisk === normalizedOriginalBaseline) {
            return 'unchanged';
        }

        const wasExternal = this._hasFileSystemChanges;
        this._hasFileSystemChanges = true;
        this._lastModified = await this._getFileModifiedTime() ?? this._lastModified;
        if (!wasExternal) {
            this._emitChange('external');
        }
        return 'diverged';
    }

    /**
     * Discard unsaved changes and revert to baseline
     */
    public discardChanges(): void {
        this._content = this._baseline;
        // Do not emit 'content' event - we're reverting to baseline, nothing on disk changed
    }

    // ============= BACKUP =============

    /**
     * Create backup of current content
     * (Subclasses can override with specific implementation)
     * @returns The backup file path if successful, null if failed
     */
    public async createBackup(label: string = 'manual'): Promise<string | null> {

        try {
            // Get the VS Code TextDocument for this file
            const document = await vscode.workspace.openTextDocument(this._path);

            if (!document) {
                console.error(`[${this.getFileType()}] Cannot create backup - failed to open document: ${this._relativePath}`);
                return null;
            }

            // Use BackupManager to create the backup
            const backupManager = new BackupManager();
            const backupPath = await backupManager.createBackup(document, {
                label: label,
                forceCreate: true  // Always create backup for conflict resolution
            });

            if (!backupPath) {
                console.warn(`[${this.getFileType()}] Backup creation returned null: ${this._relativePath}`);
            }

            return backupPath;
        } catch (error) {
            console.error(`[${this.getFileType()}] Failed to create backup:`, error);
            return null;
        }
    }

    /**
     * Show notification with link to open backup file
     */
    protected _showBackupNotification(backupPath: string, message?: string): void {
        const fileName = path.basename(backupPath);
        const displayMessage = message || `Your changes have been saved to backup: ${fileName}`;
        const result = vscode.window.showInformationMessage(
            displayMessage,
            'Open Backup'
        );

        if (result && typeof (result as PromiseLike<string | undefined>).then === 'function') {
            result.then(choice => {
                if (choice === 'Open Backup') {
                    vscode.workspace.openTextDocument(backupPath).then(doc => {
                        vscode.window.showTextDocument(doc);
                    });
                }
            });
        }
    }

    /**
     * Persist emergency backup content when a normal save fails.
     * Attempts configured backup location first, then falls back to OS temp.
     */
    protected async _persistEmergencyBackup(content: string): Promise<string | null> {
        const managedBackupPath = await this._backupManager.createBackupFromContent(
            this._path,
            content,
            {
                label: 'save-failed',
                forceCreate: true
            }
        );
        if (managedBackupPath) {
            return managedBackupPath;
        }

        return await this._writeEmergencyBackupToTemp(content);
    }

    private async _writeEmergencyBackupToTemp(content: string): Promise<string | null> {
        try {
            const emergencyDir = path.join(os.tmpdir(), 'markdown-kanban-emergency-backups');
            await fs.promises.mkdir(emergencyDir, { recursive: true });
            const backupPath = path.join(emergencyDir, this._buildEmergencyBackupFileName());
            await fs.promises.writeFile(backupPath, content, 'utf-8');
            return backupPath;
        } catch (error) {
            console.error(`[${this.getFileType()}] Failed to write emergency backup to temp:`, error);
            return null;
        }
    }

    private _buildEmergencyBackupFileName(): string {
        const originalName = path.basename(this._path) || 'kanban.md';
        const sanitizedName = originalName.replace(/[^a-zA-Z0-9._-]/g, '_');
        const extension = path.extname(sanitizedName) || '.md';
        const baseName = extension ? sanitizedName.slice(0, -extension.length) : sanitizedName;
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const randomSuffix = Math.random().toString(36).slice(2, 8);
        return `${baseName}-save-failed-${timestamp}-${randomSuffix}${extension}`;
    }

    // ============= CONFLICT RESOLVER ACCESS =============

    /**
     * Get the conflict resolver for this file (used for panel grouping in batched dialogs)
     */
    public getConflictResolver(): ConflictResolver {
        return this._conflictResolver;
    }

    // ============= VISIBLE CONFLICT FILE =============

    /**
     * Create a visible conflict backup file in the same directory as the source file.
     * Unlike hidden backups (dot-prefixed), these are visible to the user.
     * Used for Scenario 2 (pre-save) conflict resolution.
     *
     * @param content The content to write to the conflict file
     * @returns The conflict file path if successful, null if failed
     */
    public async createVisibleConflictFile(content: string): Promise<string | null> {
        try {
            const MAX_ATTEMPTS = 8;

            for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
                const conflictPath = this._buildVisibleConflictCandidatePath(attempt);
                try {
                    await fs.promises.writeFile(conflictPath, content, { encoding: 'utf-8', flag: 'wx' });
                    return conflictPath;
                } catch (error) {
                    const errorWithCode = error as NodeJS.ErrnoException;
                    if (errorWithCode.code === 'EEXIST') {
                        continue;
                    }
                    throw error;
                }
            }

            throw new Error(`Could not allocate unique visible conflict file path after ${MAX_ATTEMPTS} attempts`);
        } catch (error) {
            console.error(`[${this.getFileType()}] Failed to create conflict file:`, error);
            return null;
        }
    }

    private _buildVisibleConflictCandidatePath(attempt: number): string {
        const timestampBase = new Date().toISOString().replace(/[:.]/g, '-');
        if (attempt === 0) {
            return getVisibleConflictPath(this._path, timestampBase);
        }
        const randomSuffix = Math.random().toString(36).slice(2, 6);
        return getVisibleConflictPath(this._path, `${timestampBase}-${attempt}-${randomSuffix}`);
    }

    // ============= FILE WATCHING & CHANGE DETECTION =============

    /**
     * Start watching file for external changes (with deduplication)
     */
    public startWatching(): void {
        if (this._isWatching) {
            return;
        }

        const watchPath = this._path;

        // BUGFIX: Don't create watcher for non-existent files to prevent listener leaks
        // The _exists flag may not be set yet, so also check file system synchronously
        if (!fs.existsSync(watchPath)) {
            console.warn(`[${this.getFileType()}] Skipping watcher for non-existent file: ${this._relativePath}`);
            this._exists = false;
            return;
        }

        // PERFORMANCE: Check if we already have a watcher for this file
        const existingWatcher = MarkdownFile._activeWatchers.get(watchPath);
        if (existingWatcher) {
            existingWatcher.refCount++;
            this._fileWatcher = existingWatcher.watcher;
            this._setupWatcherSubscriptions();
            this._isWatching = true;
            return;
        }

        const pattern = new vscode.RelativePattern(
            path.dirname(this._path),
            path.basename(this._path)
        );

        this._fileWatcher = vscode.workspace.createFileSystemWatcher(pattern);
        this._setupWatcherSubscriptions();

        // PERFORMANCE: Register in shared watcher registry
        MarkdownFile._activeWatchers.set(watchPath, { watcher: this._fileWatcher, refCount: 1, lastActivity: new Date() });

        this._disposables.push(this._fileWatcher);
        this._isWatching = true;
    }

    /**
     * Setup event subscriptions for the file watcher
     * CRITICAL: Each instance needs its own subscriptions even when sharing a watcher
     */
    private _setupWatcherSubscriptions(): void {
        if (!this._fileWatcher) return;

        this._watcherSubscriptions.push(
            this._fileWatcher.onDidChange(async () => {
                await this._onFileSystemChange('modified');
            }),
            this._fileWatcher.onDidDelete(async () => {
                await this._onFileSystemChange('deleted');
            }),
            this._fileWatcher.onDidCreate(async () => {
                await this._onFileSystemChange('created');
            })
        );
    }

    /**
     * Stop watching file (with reference counting)
     */
    public stopWatching(): void {
        if (!this._isWatching) {
            return;
        }

        // CRITICAL: Dispose event listener subscriptions to prevent memory leak
        this._watcherSubscriptions.forEach(sub => sub.dispose());
        this._watcherSubscriptions = [];

        const watchPath = this._path;
        const existingWatcher = MarkdownFile._activeWatchers.get(watchPath);

        if (existingWatcher) {
            existingWatcher.refCount--;

            if (existingWatcher.refCount <= 0) {
                // Last reference - dispose the watcher
                existingWatcher.watcher.dispose();
                MarkdownFile._activeWatchers.delete(watchPath);
            }
        } else {
            console.warn(`[${this.getFileType()}] No watcher found in registry for: ${this._relativePath}`);
        }

        this._fileWatcher = undefined;
        this._isWatching = false;
    }

    /**
     * Handle file system change detected by watcher
     */
    protected async _onFileSystemChange(changeType: 'modified' | 'deleted' | 'created'): Promise<void> {
        if (await this._isExpectedSelfSaveEvent(changeType)) {
            this._hasFileSystemChanges = false;
            return;
        }

        // All external modifications go through the batched import dialog.
        // No silent reloads — the user always decides whether to import.
        // (Our own saves are already skipped above via fingerprint matching.)

        // CRITICAL: If user is in edit mode, stop editing IMMEDIATELY before any processing
        // This prevents board corruption when external changes occur during editing
        if (this._isInEditMode) {
            await this.requestStopEditing();
            // Keep the edit mode flag true for conflict detection (will be cleared after resolution)
        }

        // Mark as having external changes
        this._hasFileSystemChanges = true;
        console.log(`[MarkdownFile.handleFileSystemEvent] Setting _hasFileSystemChanges=true for "${this._relativePath}" (changeType=${changeType})`);
        this._emitChange('external');

        // Delegate to subclass for specific handling
        await this.handleExternalChange(changeType);
    }

    /**
     * Request the frontend to stop editing and capture the edited value
     * The captured value is applied to the baseline (not saved to disk)
     * This preserves the user's edit as "local state" for conflict resolution
     */
    protected async requestStopEditing(): Promise<void> {
        // Access the file registry to request stop editing and capture value
        const fileRegistry = this.getFileRegistry();
        if (fileRegistry) {
            const capturedEdit = await fileRegistry.requestStopEditing();

            // If we got an edit value, apply it to the baseline (not save to disk)
            if (capturedEdit && capturedEdit.value !== undefined) {

                // Apply the edit to baseline - this becomes the "local state" for conflict
                await this.applyEditToBaseline(capturedEdit);

            }
        }
    }

    /**
     * Apply a captured edit to the baseline (in-memory, not saved to disk)
     * This updates the "local state" to include the user's edit
     * Subclasses override this to handle their specific edit types
     */
    public async applyEditToBaseline(_capturedEdit: CapturedEdit): Promise<void> {
        // Default: do nothing (main file handles via board, includes override)
    }

    /**
     * Get file modified time from disk
     */
    protected async _getFileModifiedTime(): Promise<Date | null> {
        try {
            const stat = await fs.promises.stat(this._path);
            return stat.mtime;
        } catch (error) {
            console.error(`[${this.getFileType()}] Failed to get modified time:`, error);
            return null;
        }
    }

    /**
     * Get file size from disk (fast check for content changes)
     */
    protected async _getFileSize(): Promise<number | null> {
        try {
            const stat = await fs.promises.stat(this._path);
            return stat.size;
        } catch (error) {
            // File might not exist, which is OK
            return null;
        }
    }

    /**
     * Verify that the most recent write was actually persisted to disk.
     * Retries briefly to handle file-system propagation delays.
     */
    private async _verifyContentWasPersisted(expectedContent: string): Promise<void> {
        const normalizedExpected = this._normalizeLineEndings(expectedContent);

        let lastObservedContent: string | null = null;
        let lastReadError: string | null = null;

        for (let attempt = 1; attempt <= SAVE_VERIFICATION_MAX_ATTEMPTS; attempt++) {
            try {
                lastObservedContent = await this.readFromDisk();
                lastReadError = null;
            } catch (error) {
                lastReadError = getErrorMessage(error);
                lastObservedContent = null;
            }

            if (lastObservedContent !== null) {
                const normalizedObserved = this._normalizeLineEndings(lastObservedContent);
                if (normalizedObserved === normalizedExpected) {
                    return;
                }
            }

            if (attempt < SAVE_VERIFICATION_MAX_ATTEMPTS) {
                await this._delay(SAVE_VERIFICATION_RETRY_DELAY_MS);
            }
        }

        const observedLength = lastObservedContent === null ? 'null' : String(lastObservedContent.length);
        const expectedLength = String(normalizedExpected.length);
        const readSuffix = lastReadError ? `; lastReadError="${lastReadError}"` : '';

        throw new Error(
            `[${this.getFileType()}] Post-save verification failed for "${this._relativePath}" `
            + `(expectedLength=${expectedLength}, observedLength=${observedLength}${readSuffix})`
        );
    }

    private _normalizeLineEndings(content: string): string {
        return content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    }

    private async _delay(ms: number): Promise<void> {
        await new Promise(resolve => setTimeout(resolve, ms));
    }

    private _createContentFingerprint(content: string): { fingerprint: string; length: number } {
        const normalized = this._normalizeLineEndings(content);
        const fingerprint = createHash('sha256').update(normalized).digest('hex');
        return {
            fingerprint,
            length: normalized.length
        };
    }

    private _registerPendingSelfSaveMarker(content: string): string {
        this._pruneExpiredSelfSaveMarkers();
        const { fingerprint, length } = this._createContentFingerprint(content);
        const markerId = `self-save-${++this._nextSelfSaveMarkerId}-${Date.now()}`;
        this._pendingSelfSaveMarkers.push({
            id: markerId,
            fingerprint,
            length,
            expiresAt: Date.now() + SELF_SAVE_MARKER_TTL_MS
        });
        return markerId;
    }

    private _removePendingSelfSaveMarker(markerId: string): void {
        const index = this._pendingSelfSaveMarkers.findIndex(marker => marker.id === markerId);
        if (index >= 0) {
            this._pendingSelfSaveMarkers.splice(index, 1);
        }
    }

    private _pruneExpiredSelfSaveMarkers(): void {
        const now = Date.now();
        this._pendingSelfSaveMarkers = this._pendingSelfSaveMarkers.filter(marker => marker.expiresAt > now);
    }

    private async _isExpectedSelfSaveEvent(changeType: 'modified' | 'deleted' | 'created'): Promise<boolean> {
        this._pruneExpiredSelfSaveMarkers();
        if (this._pendingSelfSaveMarkers.length === 0) {
            return false;
        }

        const diskFingerprint = await this._readDiskFingerprintForSelfSaveComparison(changeType);
        if (!diskFingerprint) {
            return false;
        }

        const matchIndex = this._pendingSelfSaveMarkers.findIndex(marker =>
            marker.fingerprint === diskFingerprint.fingerprint
            && marker.length === diskFingerprint.length
        );
        if (matchIndex < 0) {
            return false;
        }

        this._pendingSelfSaveMarkers.splice(matchIndex, 1);
        return true;
    }

    private async _readDiskFingerprintForSelfSaveComparison(
        _changeType: 'modified' | 'deleted' | 'created'
    ): Promise<{ fingerprint: string; length: number } | null> {
        for (let attempt = 0; attempt < SELF_SAVE_EVENT_READ_RETRIES; attempt++) {
            try {
                const content = await fs.promises.readFile(this._path, 'utf-8');
                return this._createContentFingerprint(content);
            } catch {
                // Best effort retries: atomic replace can produce brief transient states.
            }

            if (attempt < SELF_SAVE_EVENT_READ_RETRIES - 1) {
                await this._delay(SELF_SAVE_EVENT_RETRY_DELAY_MS);
            }
        }

        return null;
    }

    /**
     * Check if file content has changed on disk
     */
    public async checkForExternalChanges(): Promise<boolean> {
        const diskContent = await this.readFromDisk();
        if (diskContent === null) {
            return false;
        }

        const hasChanged = diskContent !== this._baseline;
        if (hasChanged) {
            // Only emit if not already marked — the watcher path may have
            // already flagged this file before the focus path runs.
            if (!this._hasFileSystemChanges) {
                this._hasFileSystemChanges = true;
                console.log(`[MarkdownFile.checkForExternalChanges] Setting _hasFileSystemChanges=true for "${this._relativePath}" (disk != baseline, diskLen=${diskContent.length}, baselineLen=${this._baseline.length})`);
                this._emitChange('external');
            }
        }

        return hasChanged;
    }

    /**
     * Force sync baseline with disk content
     *
     * Unlike reload() which uses _readFromDiskWithVerification() (which may return
     * the old baseline in some cases), this method directly reads from disk and
     * updates both content and baseline unconditionally.
     *
     * Use this after checkForExternalChanges() detects a change to ensure the
     * baseline is updated and the same file won't be detected as "changed" again.
     */
    public async forceSyncBaseline(): Promise<void> {
        const diskContent = await this.readFromDisk();
        if (diskContent === null) {
            console.warn(`[${this.getFileType()}] forceSyncBaseline failed - could not read disk`);
            return;
        }

        // Unconditionally update content and baseline to match disk
        this._content = diskContent;
        this._baseline = diskContent;
        this._hasFileSystemChanges = false;
        this._lastModified = await this._getFileModifiedTime();
    }

    // ============= EVENT EMISSION =============

    /**
     * Emit change event
     */
    protected _emitChange(changeType: FileChangeEvent['changeType']): void {
        this._onDidChange.fire({
            file: this,
            changeType,
            timestamp: new Date()
        });
    }

    // ============= CLEANUP =============

    /**
     * Dispose of all resources
     */
    public dispose(): void {

        // FOUNDATION-2: Cancel any in-flight reload operations
        this._currentReloadSequence++;

        this.stopWatching();
        this._disposables.forEach(d => d.dispose());
        this._disposables = [];
    }
}
