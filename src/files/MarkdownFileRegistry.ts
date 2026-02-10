import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { MarkdownFile, FileChangeEvent } from './MarkdownFile';
import { MainKanbanFile } from './MainKanbanFile';
import { IncludeFile, IncludeFileType } from './IncludeFile';
import { FileSaveService } from '../core/FileSaveService';
import type { KanbanBoard } from '../markdownParser'; // STATE-2: For generateBoard()
import type { IMessageHandler, IFileFactory, CapturedEdit } from './FileInterfaces';
import type { PanelContext } from '../panel/PanelContext';
import { safeDecodeURIComponent } from '../utils/stringUtils';
import { logger } from '../utils/logger';

/**
 * Central registry for all markdown files (main and includes).
 *
 * Provides type-safe access to files, query operations, and bulk operations.
 * Manages file lifecycle and change event subscriptions.
 *
 * This registry is per-panel (not a singleton) to support multiple kanban panels.
 */
export interface RegistryChangeEvent {
    type: 'main-registered' | 'main-removed' | 'cleared';
    mainPath?: string;
    timestamp: Date;
}

export interface RegistryConsistencyIssue {
    code: string;
    severity: 'warning' | 'error';
    message: string;
    details?: Record<string, unknown>;
}

export interface RegistryConsistencyReport {
    checkedAt: string;
    fileCount: number;
    issueCount: number;
    issues: RegistryConsistencyIssue[];
}

export class MarkdownFileRegistry implements vscode.Disposable {
    // ============= FILE STORAGE =============
    private _files: Map<string, MarkdownFile> = new Map();        // Path -> File
    private _filesByRelativePath: Map<string, MarkdownFile> = new Map(); // Relative path -> File

    // ============= PERFORMANCE OPTIMIZATIONS =============
    private _registrationCache = new Set<string>(); // Prevent duplicate registrations

    // ============= CHANGE EVENTS =============
    private _onDidChange = new vscode.EventEmitter<FileChangeEvent>();
    public readonly onDidChange = this._onDidChange.event;
    private _onDidChangeRegistry = new vscode.EventEmitter<RegistryChangeEvent>();
    public readonly onDidChangeRegistry = this._onDidChangeRegistry.event;

    // ============= PANEL REFERENCE (for stopping edit mode during conflicts) =============
    private _messageHandler?: IMessageHandler; // MessageHandler reference for requestStopEditing()

    // ============= UNIFIED SAVE SERVICE =============
    private _fileSaveService: FileSaveService;

    // ============= LIFECYCLE =============
    private _disposables: vscode.Disposable[] = [];

    constructor(panelContext: PanelContext) {
        this._disposables.push(this._onDidChange);
        this._disposables.push(this._onDidChangeRegistry);
        this._fileSaveService = panelContext.fileSaveService;
    }

    // ============= PATH HELPERS =============

    /**
     * Convert an absolute path to relative path from main file's directory
     * Returns the original path if already relative or no main file available
     */
    private _toRelativePath(inputPath: string): string {
        if (!path.isAbsolute(inputPath)) {
            return inputPath;
        }
        const mainFile = this.getMainFile();
        if (!mainFile) {
            return inputPath;
        }
        const baseDir = path.dirname(mainFile.getPath());
        return path.relative(baseDir, inputPath);
    }

    /**
     * Lookup a file by path (handles both absolute and relative paths)
     * Normalizes the path and returns the file from the registry
     */
    private _normalizedLookup(inputPath: string): MarkdownFile | undefined {
        const relativePath = this._toRelativePath(inputPath);
        const normalized = MarkdownFile.normalizeRelativePath(relativePath);
        return this._filesByRelativePath.get(normalized);
    }

    /**
     * Remove every absolute/relative index entry that points to the given file instance.
     * Used before re-registering moved files and when replacing duplicate instances.
     */
    private _removeFileIndexes(file: MarkdownFile): void {
        for (const [absoluteKey, candidate] of Array.from(this._files.entries())) {
            if (candidate === file) {
                this._files.delete(absoluteKey);
            }
        }

        for (const [relativeKey, candidate] of Array.from(this._filesByRelativePath.entries())) {
            if (candidate === file) {
                this._filesByRelativePath.delete(relativeKey);
                this._registrationCache.delete(relativeKey);
            }
        }
    }

    // ============= MESSAGE HANDLER ACCESS =============

    /**
     * Set the message handler reference (used for stopping edit mode during conflicts)
     */
    public setMessageHandler(messageHandler: IMessageHandler): void {
        this._messageHandler = messageHandler;
    }

    /**
     * Request frontend to stop editing and return the captured edit value
     * Used during conflict resolution to preserve user's edit in baseline
     */
    public async requestStopEditing(): Promise<CapturedEdit | undefined> {
        if (this._messageHandler) {
            return await this._messageHandler.requestStopEditing();
        }
        return undefined;
    }

    // ============= REGISTRATION =============

    /**
     * Check if file is already being registered (fast lookup to prevent duplicates)
     */
    public isBeingRegistered(relativePath: string): boolean {
        const normalized = MarkdownFile.normalizeRelativePath(relativePath);
        return this._registrationCache.has(normalized);
    }

    /**
     * Register a file in the registry
     *
     * FOUNDATION-1: Uses normalized relative path as key for case-insensitive lookups
     */
    public register(file: MarkdownFile): void {
        const path = file.getPath();
        const normalizedRelativePath = file.getNormalizedRelativePath();

        const existingAbsolute = this._files.get(path);
        const existingRelative = this._filesByRelativePath.get(normalizedRelativePath);
        if (existingAbsolute === file && existingRelative === file) {
            this._registrationCache.add(normalizedRelativePath);
            return;
        }

        // Remove displaced files first so stale indexes do not survive replacements.
        const displacedFiles = new Set<MarkdownFile>();
        if (existingAbsolute && existingAbsolute !== file) {
            displacedFiles.add(existingAbsolute);
        }
        if (existingRelative && existingRelative !== file) {
            displacedFiles.add(existingRelative);
        }

        for (const displaced of displacedFiles) {
            console.warn(`[MarkdownFileRegistry] Replacing duplicate file registration: ${displaced.getRelativePath()}`);
            this._removeFileIndexes(displaced);
            displaced.dispose();
        }

        // Clear any stale indexes for the same file instance (e.g. file move/path refresh).
        this._removeFileIndexes(file);

        // PERFORMANCE: Add to registration cache
        this._registrationCache.add(normalizedRelativePath);

        // Store by absolute path (unchanged) and NORMALIZED relative path
        this._files.set(path, file);
        this._filesByRelativePath.set(normalizedRelativePath, file);

        // Subscribe to file changes and forward them
        const subscription = file.onDidChange((event) => {
            this._onDidChange.fire(event);
        });

        this._disposables.push(subscription);

        if (file.getFileType() === 'main') {
            this._onDidChangeRegistry.fire({
                type: 'main-registered',
                mainPath: file.getPath(),
                timestamp: new Date()
            });
        }
    }

    /**
     * Unregister a file from the registry
     *
     * FOUNDATION-1: Uses normalized relative path for map key deletion
     */
    public unregister(path: string): void {
        const file = this._files.get(path);
        if (!file) {
            console.warn(`[MarkdownFileRegistry] File not found for unregister: ${path}`);
            return;
        }

        const normalizedRelativePath = file.getNormalizedRelativePath();

        this._files.delete(path);
        this._filesByRelativePath.delete(normalizedRelativePath); // FOUNDATION-1: Use normalized key
        this._registrationCache.delete(normalizedRelativePath); // Allow re-registration after unregister

        // Dispose the file
        file.dispose();

        if (file.getFileType() === 'main') {
            this._onDidChangeRegistry.fire({
                type: 'main-removed',
                mainPath: file.getPath(),
                timestamp: new Date()
            });
        }
    }

    /**
     * Clear all files from the registry
     */
    public clear(): void {
        const mainFile = this.getMainFile();

        // Dispose all files
        for (const file of this._files.values()) {
            file.dispose();
        }

        this._files.clear();
        this._filesByRelativePath.clear();
        this._registrationCache.clear();

        if (mainFile) {
            this._onDidChangeRegistry.fire({
                type: 'cleared',
                mainPath: mainFile.getPath(),
                timestamp: new Date()
            });
        }
    }

    // ============= RETRIEVAL =============

    /**
     * Get file by absolute path
     */
    public get(path: string): MarkdownFile | undefined {
        return this._files.get(path);
    }

    /**
     * Get file by relative path
     *
     * FOUNDATION-1: Normalizes the lookup path for case-insensitive matching
     *
     * @param relativePath The relative path to look up (any casing)
     * @returns The file if found, undefined otherwise
     *
     * @example
     * // These all return the same file:
     * registry.getByRelativePath("Folder/File.md")
     * registry.getByRelativePath("folder/file.md")
     * registry.getByRelativePath("FOLDER/FILE.MD")
     */
    public getByRelativePath(relativePath: string): MarkdownFile | undefined {
        return this._normalizedLookup(relativePath);
    }

    /**
     * Find file by any path format (absolute or relative)
     *
     * Tries multiple lookup strategies:
     * 1. get() - exact absolute path match
     * 2. getByRelativePath() - case-insensitive relative path match
     *
     * @param filePath The path to look up (absolute or relative)
     * @returns The file if found, undefined otherwise
     */
    public findByPath(filePath: string): MarkdownFile | undefined {
        return this.get(filePath) || this.getByRelativePath(filePath);
    }

    /**
     * Get all files
     */
    public getAll(): MarkdownFile[] {
        return Array.from(this._files.values());
    }

    /**
     * Verify registry index consistency and detect duplicated/stale entries.
     * Useful for debug-mode validation and fail-closed diagnostics.
     */
    public getConsistencyReport(): RegistryConsistencyReport {
        const issues: RegistryConsistencyIssue[] = [];
        const uniqueFiles = new Set<MarkdownFile>();
        const fileToAbsoluteKeys = new Map<MarkdownFile, string[]>();

        for (const [absoluteKey, file] of this._files.entries()) {
            uniqueFiles.add(file);
            const keys = fileToAbsoluteKeys.get(file) ?? [];
            keys.push(absoluteKey);
            fileToAbsoluteKeys.set(file, keys);

            const livePath = file.getPath();
            if (absoluteKey !== livePath) {
                issues.push({
                    code: 'absolute-key-stale',
                    severity: 'error',
                    message: 'Absolute file index key diverged from file path.',
                    details: {
                        absoluteKey,
                        livePath,
                        relativePath: file.getRelativePath()
                    }
                });
            }
        }

        for (const [file, absoluteKeys] of fileToAbsoluteKeys.entries()) {
            if (absoluteKeys.length <= 1) {
                continue;
            }
            issues.push({
                code: 'duplicate-absolute-entries',
                severity: 'error',
                message: 'Same file instance is indexed by multiple absolute keys.',
                details: {
                    relativePath: file.getRelativePath(),
                    absoluteKeys
                }
            });
        }

        for (const [normalizedRelativeKey, file] of this._filesByRelativePath.entries()) {
            const expectedRelativeKey = file.getNormalizedRelativePath();
            if (normalizedRelativeKey !== expectedRelativeKey) {
                issues.push({
                    code: 'relative-key-stale',
                    severity: 'warning',
                    message: 'Relative file index key diverged from file normalized relative path.',
                    details: {
                        normalizedRelativeKey,
                        expectedRelativeKey,
                        absolutePath: file.getPath()
                    }
                });
            }

            if (!uniqueFiles.has(file)) {
                issues.push({
                    code: 'orphan-relative-entry',
                    severity: 'error',
                    message: 'Relative index references a file missing from absolute index.',
                    details: {
                        normalizedRelativeKey,
                        absolutePath: file.getPath()
                    }
                });
            }
        }

        return {
            checkedAt: new Date().toISOString(),
            fileCount: uniqueFiles.size,
            issueCount: issues.length,
            issues
        };
    }

    /**
     * Check if file is registered
     */
    public has(path: string): boolean {
        return this._files.has(path);
    }

    /**
     * Check if file is registered by relative path
     *
     * FOUNDATION-1: Normalizes the check path for case-insensitive matching
     *
     * @param relativePath The relative path to check (any casing)
     * @returns true if file exists in registry
     */
    public hasByRelativePath(relativePath: string): boolean {
        return this._normalizedLookup(relativePath) !== undefined;
    }

    // ============= TYPE-SPECIFIC QUERIES =============

    /**
     * Get files by type (using instanceof check)
     */
    public getByType<T extends MarkdownFile>(type: new (...args: any[]) => T): T[] {
        return this.getAll().filter(f => f instanceof type) as T[];
    }

    /**
     * Get the main kanban file
     */
    public getMainFile(): MainKanbanFile | undefined {
        const mainFiles = this.getByType(MainKanbanFile);
        return mainFiles[0]; // Should only be one main file per panel
    }

    /**
     * Get all include files
     */
    public getIncludeFiles(): IncludeFile[] {
        return this.getByType(IncludeFile);
    }

    // ============= STATE QUERIES =============

    /**
     * Get files with unsaved changes
     */
    public getFilesWithUnsavedChanges(): MarkdownFile[] {
        return this.getAll().filter(f => f.hasUnsavedChanges());
    }

    // ============= BULK OPERATIONS =============

    /**
     * Force write ALL files unconditionally (emergency recovery)
     * This bypasses all change detection and writes every registered file
     * Use ONLY when sync is broken and normal save doesn't work
     */
    public async forceWriteAll(): Promise<{ filesWritten: number; errors: string[] }> {
        const allFiles = this.getAll();
        console.warn(`[MarkdownFileRegistry] FORCE WRITE: Writing ${allFiles.length} files unconditionally`);

        const errors: string[] = [];
        let filesWritten = 0;

        // Write sequentially for deterministic recovery and clearer failure attribution.
        for (const file of allFiles) {
            try {
                await this._fileSaveService.saveFile(file, undefined, { force: true });
                filesWritten++;
            } catch (error) {
                const errorMsg = `Failed to write ${file.getRelativePath()}: ${error}`;
                console.error(`[MarkdownFileRegistry] ${errorMsg}`);
                errors.push(errorMsg);
            }
        }

        return { filesWritten, errors };
    }

    /**
     * Check all files for external changes
     */
    public async checkAllForExternalChanges(): Promise<Map<string, boolean>> {

        const results = new Map<string, boolean>();

        await Promise.all(
            this.getAll().map(async (file) => {
                const hasChanges = await file.checkForExternalChanges();
                results.set(file.getPath(), hasChanges);
            })
        );

        return results;
    }

    // ============= CONVENIENCE METHODS (merged from FileRegistryAdapter) =============

    /**
     * Check if registry has a main file (is ready for operations)
     */
    public isReady(): boolean {
        return this.getMainFile() !== undefined;
    }

    /**
     * Get an include file by relative path (convenience method)
     */
    public getIncludeFile(relativePath: string): IncludeFile | undefined {
        const file = this.getByRelativePath(relativePath);
        if (file && file.getFileType() !== 'main') {
            return file as IncludeFile;
        }
        return undefined;
    }

    /**
     * Get include files unsaved status
     */
    public getIncludeFilesUnsavedStatus(): { hasChanges: boolean; changedFiles: string[] } {
        const includeFiles = this.getAll().filter(f => f.getFileType() !== 'main');
        const changedFiles = includeFiles
            .filter(f => f.hasAnyUnsavedChanges())
            .map(f => f.getRelativePath());

        return {
            hasChanges: changedFiles.length > 0,
            changedFiles
        };
    }

    /**
     * Check if any file has unsaved changes (main or includes)
     */
    public hasAnyUnsavedChanges(): boolean {
        const mainFile = this.getMainFile();
        const mainHasChanges = mainFile?.hasAnyUnsavedChanges() || false;
        const includeStatus = this.getIncludeFilesUnsavedStatus();

        return mainHasChanges || includeStatus.hasChanges;
    }

    // ============= BOARD GENERATION (STATE-2) =============

    /**
     * STATE-2: Generate complete KanbanBoard from registry files
     *
     * This is the single source of truth for board generation.
     * Replaces dual board state (_board and _cachedBoardFromWebview).
     *
     * Process:
     * 1. Get main file's parsed board
     * 2. For each column with includeFiles, load tasks from IncludeFile (type=include-column)
     * 3. Return complete board
     *
     * @param existingBoard Optional existing board to preserve column/task IDs during regeneration
     * @returns KanbanBoard with all include content loaded, or undefined if main file not ready
     */
    public generateBoard(existingBoard?: KanbanBoard): KanbanBoard | undefined {
        // Step 1: Get main file
        const mainFile = this.getMainFile();
        if (!mainFile) {
            console.warn('[MarkdownFileRegistry] generateBoard() - No main file found');
            return undefined;
        }

        // Step 2: Get parsed board from main file (parser will preserve IDs if existingBoard passed)
        const board = mainFile.getBoard(existingBoard);
        if (!board) {
            console.warn('[MarkdownFileRegistry] generateBoard() - Main file has no board');
            return undefined;
        }

        if (!board.valid) {
            console.warn('[MarkdownFileRegistry] generateBoard() - Board is invalid');
            return board; // Return invalid board so caller can handle
        }


        // Step 3: Load content for column includes
        // Note: A file can be used in multiple contexts (column include in one place,
        // task include in another). Don't check file type - just use the file content.
        const mainFilePath = mainFile.getPath();
        logger.debug(`[MarkdownFileRegistry] generateBoard() - Processing ${board.columns.length} columns`);

        for (const column of board.columns) {
            if (column.includeFiles && column.includeFiles.length > 0) {
                logger.debug(`[MarkdownFileRegistry] generateBoard() - Column ${column.id} has includeFiles:`, column.includeFiles);

                for (const relativePath of column.includeFiles) {
                    const decodedPath = safeDecodeURIComponent(relativePath);
                    const file = this.getByRelativePath(decodedPath)
                        || this.get(decodedPath);

                    // CRITICAL: Check disk existence FIRST, regardless of registry status
                    // This handles the case where user fixes an include path - the new file
                    // exists on disk but isn't registered yet
                    const mainFileDir = path.dirname(mainFile.getPath());
                    const absolutePath = file
                        ? file.getPath()
                        : path.resolve(mainFileDir, decodedPath);
                    const fileExistsOnDisk = fs.existsSync(absolutePath);

                    logger.debug(`[MarkdownFileRegistry] generateBoard() - Column include check: relativePath=${relativePath}, absolutePath=${absolutePath}, fileInRegistry=${!!file}, fileExistsOnDisk=${fileExistsOnDisk}, cachedExists=${file?.exists()}`);

                    if (fileExistsOnDisk) {
                        // File exists on disk - clear error even if not registered yet
                        // Content will be loaded when IncludeLoadingProcessor runs
                        (column as any).includeError = false;
                    }

                    // CRITICAL FIX: Type guard to prevent treating MainKanbanFile as IncludeFile
                    if (file && file.getFileType() === 'main') {
                        console.error(`[MarkdownFileRegistry] generateBoard() BUG: Include path resolved to MainKanbanFile: ${relativePath}`);
                        (column as any).includeError = true;
                        continue;
                    }

                    if (file && fileExistsOnDisk) {
                        // Parse tasks from include file, preserving existing task IDs
                        const includeFile = file as IncludeFile;
                        const tasks = includeFile.parseToTasks(column.tasks, column.id, mainFilePath);
                        column.tasks = tasks;
                        (column as any).includeError = false;
                    } else if (!fileExistsOnDisk) {
                        console.warn(`[MarkdownFileRegistry] generateBoard() - Column include ERROR: ${relativePath}`);
                        // Error details shown on hover via include badge
                        // Don't create error task - just show empty column with error badge
                        column.tasks = [];
                        // Mark column as having include error
                        (column as any).includeError = true;
                    }
                    // else: file exists but not registered - error already cleared above, content loads later
                }
            }
        }

        logger.debug(`[MarkdownFileRegistry] generateBoard() - Finished, returning board`);
        return board;
    }

    // ============= INCLUDE FILE OPERATIONS =============
    // (Migrated from IncludeFileManager - these are the active methods)

    /**
     * Ensure an include file is registered with the correct type.
     * Handles type mismatch by replacing the existing registration.
     *
     * This is the consolidated registration method used by both:
     * - IncludeLoadingProcessor (for include switch operations)
     * - IncludeFileCoordinator (for board sync operations)
     *
     * @param relativePath - Relative path to the include file
     * @param fileType - Include type
     * @param fileFactory - FileFactory instance for creating files
     * @param mainFile - Parent main kanban file
     * @param context - Column/task context for setting IDs and titles
     * @returns The registered include file, or undefined if registration failed
     */
    public ensureIncludeRegistered(
        inputPath: string,
        fileType: IncludeFileType,
        fileFactory: { createIncludeDirect: (path: string, mainFile: MainKanbanFile, type: IncludeFileType) => IncludeFile },
        mainFile: MainKanbanFile,
        _context: {
            columnId?: string;
            columnTitle?: string;
            taskId?: string;
            taskSummary?: string;
        }
    ): IncludeFile | undefined {
        const baseDir = path.dirname(mainFile.getPath());
        const decodedInput = safeDecodeURIComponent(inputPath);
        const absolutePath = path.isAbsolute(decodedInput)
            ? path.resolve(decodedInput)
            : path.resolve(baseDir, decodedInput);
        const relativePath = path.relative(baseDir, absolutePath);
        const normalizedRelativePath = MarkdownFile.normalizeRelativePath(relativePath);

        // First, try to find by relative path (normalized)
        const existingByRelative = this.getByRelativePath(relativePath);
        if (existingByRelative) {
            // CRITICAL FIX: Type guard to prevent returning MainKanbanFile as IncludeFile
            // This prevents cache corruption where include content would overwrite main file content
            if (existingByRelative.getFileType() === 'main') {
                console.warn(`[MarkdownFileRegistry] Cannot include the main kanban file itself: ${relativePath}`);
                return undefined;
            }
            if (existingByRelative.getFileType() !== fileType
                || existingByRelative.getNormalizedRelativePath() !== normalizedRelativePath) {
                return this._replaceIncludeRegistration(existingByRelative, relativePath, fileType, fileFactory, mainFile);
            }
            return existingByRelative as IncludeFile;
        }

        // CRITICAL: Also check by absolute path to prevent duplicate registrations
        // when the same file is referenced with different path formats
        // (e.g., relative "../foo.md" vs absolute "/path/to/foo.md")
        const existingByAbsolute = this.get(absolutePath);
        if (existingByAbsolute) {
            // CRITICAL FIX: Type guard to prevent returning MainKanbanFile as IncludeFile
            // This can happen if include path resolves to the same file as the main kanban file
            if (existingByAbsolute.getFileType() === 'main') {
                console.warn(`[MarkdownFileRegistry] Cannot include the main kanban file itself (resolved path): ${relativePath} -> ${absolutePath}`);
                return undefined;
            }
            // File already exists under a different relative path key
            // Return the existing instance to prevent duplicates
            if (existingByAbsolute.getFileType() !== fileType
                || existingByAbsolute.getNormalizedRelativePath() !== normalizedRelativePath) {
                return this._replaceIncludeRegistration(existingByAbsolute, relativePath, fileType, fileFactory, mainFile);
            }
            return existingByAbsolute as IncludeFile;
        }

        // Create and register new include file with relative path
        const includeFile = fileFactory.createIncludeDirect(relativePath, mainFile, fileType);

        this.register(includeFile);
        includeFile.startWatching();

        return includeFile;
    }

    private _replaceIncludeRegistration(
        existing: MarkdownFile,
        relativePath: string,
        fileType: IncludeFileType,
        fileFactory: { createIncludeDirect: (path: string, mainFile: MainKanbanFile, type: IncludeFileType) => IncludeFile },
        mainFile: MainKanbanFile
    ): IncludeFile | undefined {
        const existingContent = existing.getContent();
        const existingBaseline = existing.getBaseline();
        const existedOnDisk = existing.exists();

        this.unregister(existing.getPath());

        const includeFile = fileFactory.createIncludeDirect(relativePath, mainFile, fileType);
        this.register(includeFile);
        includeFile.setExists(existedOnDisk);
        includeFile.setContent(existingBaseline, true);
        if (existingContent !== existingBaseline) {
            includeFile.setContent(existingContent, false);
        }
        includeFile.startWatching();

        return includeFile;
    }

    /**
     * Ensure an include file is registered (lazy registration)
     *
     * @param relativePath - Relative path to the include file
     * @param type - Include type ('column')
     * @param fileFactory - FileFactory instance for creating files
     */
    public ensureIncludeFileRegistered(
        relativePath: string,
        _type: 'column',
        fileFactory: IFileFactory
    ): void {
        // Convert absolute path to relative and normalize ./ prefix
        let normalizedPath = this._toRelativePath(relativePath);
        if (normalizedPath.startsWith('./')) {
            normalizedPath = normalizedPath.substring(2);
        }
        relativePath = normalizedPath;

        // Fast check using registration cache
        if (this.isBeingRegistered(relativePath)) {
            return;
        }

        // Check if file is already registered
        if (this.hasByRelativePath(relativePath)) {
            return;
        }

        // Schedule actual registration for next tick (lazy loading)
        setTimeout(() => {
            this._performLazyRegistration(relativePath, _type, fileFactory);
        }, 0);
    }

    /**
     * Perform the actual lazy registration
     */
    private async _performLazyRegistration(
        relativePath: string,
        _type: 'column',
        fileFactory: IFileFactory
    ): Promise<void> {
        try {
            // Double-check if file is still needed
            if (this.hasByRelativePath(relativePath)) {
                return;
            }

            const mainFile = this.getMainFile();
            if (!mainFile) {
                console.error(`[MarkdownFileRegistry] Cannot lazy-register - no main file`);
                return;
            }

            // Map type to IncludeFileType
            const fileType: IncludeFileType = 'include-column';

            // Create and register (cast to IncludeFile for full type support)
            const includeFile = fileFactory.createIncludeDirect(relativePath, mainFile, fileType) as IncludeFile;
            this.register(includeFile);
            includeFile.startWatching();
        } catch (error) {
            console.error(`[MarkdownFileRegistry] Error during lazy registration:`, error);
        }
    }

    // ============= CLEANUP =============

    /**
     * Unregister include files that are no longer referenced by the board.
     *
     * Compares currently registered include files against a set of paths
     * that are still in use. Any include files not in the active set are removed.
     *
     * @param activePaths Set of normalized relative paths that are still referenced
     * @returns Array of paths that were unregistered
     */
    public unregisterOrphanedIncludes(activePaths: Set<string>): string[] {
        const unregistered: string[] = [];
        const includeFiles = this.getIncludeFiles();

        for (const file of includeFiles) {
            const normalizedPath = file.getNormalizedRelativePath();
            if (!activePaths.has(normalizedPath)) {
                logger.debug(`[MarkdownFileRegistry] Unregistering orphaned include: ${normalizedPath}`);
                this.unregister(file.getPath());
                unregistered.push(normalizedPath);
            }
        }

        if (unregistered.length > 0) {
            logger.debug(`[MarkdownFileRegistry] Unregistered ${unregistered.length} orphaned include file(s)`);
        }

        return unregistered;
    }

    /**
     * Dispose of all resources
     */
    public dispose(): void {
        this.clear();
        this._disposables.forEach(d => d.dispose());
        this._disposables = [];
    }
}
