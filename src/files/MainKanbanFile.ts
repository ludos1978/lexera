import * as fs from 'fs';
import * as path from 'path';
import { MarkdownFile } from './MarkdownFile';
import { IMarkdownFileRegistry, CapturedEdit } from './FileInterfaces';
import { KanbanBoard, KanbanTask } from '../board/KanbanTypes';
import { findColumn, findTaskById, findTaskInColumn } from '../actions/helpers';
import { MarkdownKanbanParser } from '../markdownParser';
import { ConflictResolver } from '../services/ConflictResolver';
import { BackupManager } from '../services/BackupManager';
import { FileManager } from '../fileManager';
import { UnifiedChangeHandler } from '../core/UnifiedChangeHandler';
import { SaveOptions } from './SaveOptions';
import { writeFileAtomically } from '../utils/atomicWrite';
import { sortColumnsByRow } from '../utils/columnUtils';
import { normalizeTaskContent } from '../utils/taskContent';

/**
 * Represents the main kanban markdown file.
 *
 * Responsibilities:
 * - Manage the primary kanban.md file
 * - Parse markdown <-> KanbanBoard structure
 * - Handle YAML frontmatter and footer
 * - Coordinate with VS Code document when open
 * - Handle main file conflicts and external changes
 */
export class MainKanbanFile extends MarkdownFile {
    // ============= BOARD STATE =============
    private _board?: KanbanBoard;
    private _includedFiles: string[] = []; // Regular includes (!!!include(file)!!!)
    private _cachedBoardFromWebview?: KanbanBoard; // Cached board from webview for conflict detection

    // ============= DEPENDENCIES =============
    private _fileManager: FileManager;
    private _fileRegistry: IMarkdownFileRegistry;
    private _parser: typeof MarkdownKanbanParser;

    constructor(
        filePath: string,
        fileManager: FileManager,
        conflictResolver: ConflictResolver,
        backupManager: BackupManager,
        fileRegistry: IMarkdownFileRegistry
    ) {
        // FOUNDATION-1: For main file, use basename as relative path
        // Main file doesn't have a "parent", so relative path = filename
        const relativePath = path.basename(filePath);

        super(filePath, relativePath, conflictResolver, backupManager);
        this._fileManager = fileManager;
        this._fileRegistry = fileRegistry;
        this._parser = MarkdownKanbanParser;
    }

    // ============= FILE TYPE =============

    public getFileType(): 'main' {
        return 'main';
    }

    public getFileRegistry(): IMarkdownFileRegistry | undefined {
        return this._fileRegistry;
    }

    // ============= BOARD OPERATIONS =============

    /**
     * Get the parsed board (cached)
     *
     * @param existingBoard Optional existing board to preserve IDs during re-parsing.
     *                      When provided, triggers re-parse with ID preservation.
     */
    public getBoard(existingBoard?: KanbanBoard): KanbanBoard | undefined {
        // If existingBoard provided, re-parse to preserve IDs
        if (existingBoard) {
            return this.parseToBoard(existingBoard);
        }
        return this._board;
    }

    /**
     * Parse current content into board structure
     *
     * @param existingBoard Optional existing board to preserve task/column IDs during re-parse
     */
    public parseToBoard(existingBoard?: KanbanBoard): KanbanBoard {

        // Pass existing board to preserve task/column IDs during re-parse
        // Priority: provided existingBoard > cached _board
        const boardForIdPreservation = existingBoard || this._board;

        // CRITICAL FIX: Pass basePath for resolving relative include paths
        const basePath = path.dirname(this._path);
        const parseResult = this._parser.parseMarkdown(this._content, basePath, boardForIdPreservation, this._path);
        this._board = parseResult.board;
        this._includedFiles = parseResult.includedFiles || [];


        // Extract YAML and footer if present
        // (This would use the existing parsing logic)
        return parseResult.board;
    }

    /**
     * Get regular include files (!!!include(file)!!!)
     */
    public getIncludedFiles(): string[] {
        return this._includedFiles;
    }

    /**
     * Update content from board structure
     *
     * @param board The board to generate content from
     * @param preserveYaml Whether to preserve YAML frontmatter (default: true)
     * @param updateBaseline Whether to update the baseline (default: false)
     *                       Set to true when called after save to mark content as saved
     */
    public updateFromBoard(board: KanbanBoard, _preserveYaml: boolean = true, updateBaseline: boolean = false): void {

        this._board = board;

        // Generate markdown from board
        // (This would use the existing generation logic from kanbanFileService)
        // For now, we'll just mark that this needs to be implemented
        const generatedContent = this._generateMarkdownFromBoard(board);

        // Update content and optionally baseline
        this.setContent(generatedContent, updateBaseline);
    }

    /**
     * Apply a captured edit to the baseline (in-memory, not saved to disk)
     * This updates the "local state" to include the user's edit for conflict resolution
     */
    public async applyEditToBaseline(capturedEdit: CapturedEdit): Promise<void> {

        // Get the current board (from webview cache or parse from content)
        let board = this._cachedBoardFromWebview;
        if (!board) {
            board = this.parseToBoard();
        }

        // Apply the edit to the board based on type
        if (capturedEdit.type === 'task-content' && capturedEdit.taskId) {
            const task = this._findTaskInBoard(board, capturedEdit.taskId, capturedEdit.columnId);
            if (task) {
                task.content = capturedEdit.value;
            }
        } else if (capturedEdit.type === 'column-title' && capturedEdit.columnId) {
            const column = findColumn(board, capturedEdit.columnId);
            if (column) {
                column.title = capturedEdit.value;
            }
        }

        // Regenerate markdown from the modified board
        const newContent = this._generateMarkdownFromBoard(board);

        // Update content with the edit
        // NOTE: We only update content, NOT baseline, since baseline represents what's on disk
        // hasUnsavedChanges() will now correctly return true since (_content !== _baseline)
        this._content = newContent;
        // Do NOT update baseline - baseline should always reflect what's on disk!

    }

    /**
     * Find a task in the board by ID
     */
    private _findTaskInBoard(board: KanbanBoard, taskId: string, columnId?: string): KanbanTask | null {
        // If columnId provided, search only that column first
        if (columnId) {
            const result = findTaskInColumn(board, columnId, taskId);
            if (result) return result.task;
        }

        // Search all columns
        const result = findTaskById(board, taskId);
        return result?.task ?? null;
    }

    /**
     * Update cached board from webview (for conflict detection)
     */
    public setCachedBoardFromWebview(board: KanbanBoard | undefined): void {
        this._cachedBoardFromWebview = board;
    }

    /**
     * Get cached board from webview (for conflict detection)
     */
    public getCachedBoardFromWebview(): KanbanBoard | undefined {
        return this._cachedBoardFromWebview;
    }

    // ============= FILE I/O =============

    /**
     * Read content from disk (ALWAYS from filesystem, never from VS Code buffer).
     * The kanban only cares about file data on disk, not editor buffer state.
     * CRITICAL: Normalizes CRLF to LF to ensure consistent line endings.
     */
    public async readFromDisk(): Promise<string | null> {
        try {
            const content = await fs.promises.readFile(this._path, 'utf-8');
            this._exists = true;
            this._clearAccessError();
            return content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        } catch (error) {
            this._recordAccessError(error);
            if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
                this._exists = false;
            }
            console.error(`[MainKanbanFile] Failed to read file:`, error);
            return null;
        }
    }

    /**
     * Write content to disk atomically to avoid partial/truncated saves.
     */
    public async writeToDisk(content: string): Promise<void> {

        try {
            await writeFileAtomically(this._path, content, { encoding: 'utf-8' });
            this._exists = true;
            this._clearAccessError();

            // Update document version if document is open
            const document = this._fileManager.getDocument();
            if (document && document.uri.fsPath === this._path) {
                this._documentVersion = document.version;
            }

            this._lastModified = new Date();
        } catch (error) {
            this._recordAccessError(error);
            console.error(`[MainKanbanFile] Failed to write file:`, error);
            throw error;
        }
    }

    // ============= EXTERNAL CHANGE HANDLING =============

    /**
     * Handle external file change using unified change handler
     * This replaces the complex conflict detection logic with a single, consistent system
     */
    public async handleExternalChange(changeType: 'modified' | 'deleted' | 'created'): Promise<void> {
        const changeHandler = UnifiedChangeHandler.getInstance();
        await changeHandler.handleExternalChange(this, changeType);
    }

    // ============= VALIDATION =============

    /**
     * Validate kanban markdown content
     */
    public validate(content: string): { valid: boolean; errors?: string[] } {
        try {
            const basePath = path.dirname(this._path);
            const { board } = this._parser.parseMarkdown(content, basePath, undefined, this._path);

            if (!board.valid) {
                return {
                    valid: false,
                    errors: ['Invalid kanban markdown format']
                };
            }

            return { valid: true };
        } catch (error) {
            return {
                valid: false,
                errors: [`Parse error: ${error}`]
            };
        }
    }

    // ============= SIMPLIFIED CONFLICT DETECTION =============

    // hasAnyUnsavedChanges() and hasConflict() are now implemented in base class MarkdownFile
    // The base class handles VS Code document dirty checks via isDocumentDirtyInVSCode()

    /**
     * Override reload to also parse board and clear cached board.
     * Uses base class concurrency protections (watcher coordinator + sequence counter).
     * OPTIMIZATION: Skip re-parsing if content hasn't actually changed.
     */
    public async reload(): Promise<void> {
        // Clear cached board from webview on any reload
        this._cachedBoardFromWebview = undefined;

        // Use watcher coordinator to prevent conflicts (matches base class pattern)
        await MarkdownFile._watcherCoordinator.startOperation(this._path, 'reload');

        try {
            const mySequence = this._startNewReload();

            const content = await this._readFromDiskWithVerification();

            if (this._checkReloadCancelled(mySequence)) {
                return;
            }

            if (content !== null) {
                // CRITICAL OPTIMIZATION: Skip re-parse if content exactly the same
                // This prevents infinite loops and unnecessary board regeneration
                if (content === this._baseline) {
                    this._hasFileSystemChanges = false;
                    this._lastModified = await this._getFileModifiedTime();
                    return;
                }

                if (this._checkReloadCancelled(mySequence)) {
                    return;
                }

                // Content actually changed - proceed with full reload
                this._content = content;
                this._baseline = content;
                this._hasFileSystemChanges = false;
                this._lastModified = await this._getFileModifiedTime();

                // CRITICAL: Re-parse board BEFORE emitting event
                // This ensures event handlers see the updated board
                this.parseToBoard();

                // Now emit the event
                this._emitChange('reloaded');
            } else {
                console.warn(`[MainKanbanFile] ⚠️ Reload failed - null content returned`);
            }
        } finally {
            MarkdownFile._watcherCoordinator.endOperation(this._path, 'reload');
        }
    }

    /**
     * Override save to validate board before saving.
     * Accepts and forwards SaveOptions to base class so FileSaveService
     * options (skipReloadDetection, force, etc.) are not silently dropped.
     */
    public async save(options?: SaveOptions): Promise<void> {
        // CRITICAL: Use cached board from webview if it exists (current UI state)
        // Otherwise fall back to parsed board
        const boardToSave = this._cachedBoardFromWebview || this._board;

        if (boardToSave) {
            this._assertBoardSnapshotIsSaveable(boardToSave);

            // Snapshot board state to prevent in-flight mutations from changing the save payload.
            const boardSnapshot = this._cloneBoardForSave(boardToSave);
            // Keep one canonical in-memory board snapshot that matches the save payload.
            this._board = boardSnapshot;

            // Regenerate content from board snapshot before saving.
            const content = this._generateMarkdownFromBoard(boardSnapshot);
            this._validateGeneratedMarkdownRoundTrip(boardSnapshot, content);
            this._content = content;
        }

        await super.save(options);

        // CRITICAL: Clear cached board AFTER save completes
        // Note: save() method records self-save fingerprints so watcher events
        // from our own writes are suppressed deterministically.
        this._cachedBoardFromWebview = undefined;
    }

    // ============= PRIVATE HELPERS =============

    /**
     * Generate markdown from board structure using the shared parser logic
     */
    private _generateMarkdownFromBoard(board: KanbanBoard): string {
        // Use the existing markdown generation logic from MarkdownKanbanParser
        // This ensures consistency with how the main save process generates markdown
        return this._parser.generateMarkdown(board);
    }

    private _cloneBoardForSave(board: KanbanBoard): KanbanBoard {
        return JSON.parse(JSON.stringify(board)) as KanbanBoard;
    }

    private _assertBoardSnapshotIsSaveable(board: KanbanBoard): void {
        if (!board || board.valid !== true || !Array.isArray(board.columns)) {
            throw new Error(
                `[MainKanbanFile] Refusing to save invalid board snapshot for "${this.getRelativePath()}".`
            );
        }

        for (const column of board.columns) {
            if (!column || !Array.isArray(column.tasks)) {
                throw new Error(
                    `[MainKanbanFile] Refusing to save malformed board snapshot for "${this.getRelativePath()}".`
                );
            }
        }
    }

    /**
     * Validate round-trip consistency (for debugging only - does NOT block saves).
     * Logs warnings if mismatch detected but allows save to proceed.
     */
    private _validateGeneratedMarkdownRoundTrip(boardSnapshot: KanbanBoard, generatedContent: string): void {
        const basePath = path.dirname(this._path);
        const reparsed = this._parser.parseMarkdown(
            generatedContent,
            basePath,
            undefined,
            this._path,
            false
        ).board;

        if (!reparsed.valid) {
            console.warn('[MainKanbanFile] Generated markdown is invalid after save serialization - proceeding with save anyway.');
            return;
        }

        const expectedShape = this._createPersistedBoardShape(boardSnapshot);
        const actualShape = this._createPersistedBoardShape(reparsed);
        const expectedJson = JSON.stringify(expectedShape);
        const actualJson = JSON.stringify(actualShape);

        if (expectedJson !== actualJson) {
            const diffIndex = this._findFirstDiffIndex(expectedJson, actualJson);

            // DEBUG: Show ±20 characters around the diff with exact escape sequences
            const contextStart = Math.max(0, diffIndex - 20);
            const contextEnd20 = Math.min(Math.max(expectedJson.length, actualJson.length), diffIndex + 20);

            const expectedContext = expectedJson.substring(contextStart, contextEnd20);
            const actualContext = actualJson.substring(contextStart, contextEnd20);

            // Show exact characters at diff point with visible escape sequences
            const expectedAtDiff = expectedJson.substring(diffIndex, diffIndex + 10);
            const actualAtDiff = actualJson.substring(diffIndex, diffIndex + 10);

            console.error('='.repeat(80));
            console.error('[MainKanbanFile] ROUND-TRIP MISMATCH DEBUG');
            console.error('='.repeat(80));
            console.error(`diffIndex: ${diffIndex}`);
            console.error(`expectedLength: ${expectedJson.length}, actualLength: ${actualJson.length}`);
            console.error(`difference: ${expectedJson.length - actualJson.length} characters`);
            console.error('-'.repeat(40));
            console.error('EXPECTED ±20 chars (raw):');
            console.error(expectedContext);
            console.error('-'.repeat(40));
            console.error('ACTUAL ±20 chars (raw):');
            console.error(actualContext);
            console.error('-'.repeat(40));
            console.error('EXPECTED at diff (JSON escaped):', JSON.stringify(expectedAtDiff));
            console.error('ACTUAL at diff (JSON escaped):', JSON.stringify(actualAtDiff));
            console.error('-'.repeat(40));

            // Find which column/task this is in by searching for nearest "content":" before diffIndex
            const beforeDiff = expectedJson.substring(0, diffIndex);
            const lastContentMatch = beforeDiff.lastIndexOf('"content":"');
            if (lastContentMatch !== -1) {
                const contentPreview = expectedJson.substring(lastContentMatch, Math.min(lastContentMatch + 100, expectedJson.length));
                console.error('Nearest task content (expected):', contentPreview);
            }

            console.error('='.repeat(80));

            // WARNING ONLY - do not block save
            console.warn(
                `[MainKanbanFile] Save serialization mismatch for "${this.getRelativePath()}" `
                + `(diffIndex=${diffIndex}, expectedShapeLength=${expectedJson.length}, actualShapeLength=${actualJson.length}). `
                + `Proceeding with save anyway.`
            );
        }
    }

    private _createPersistedBoardShape(board: KanbanBoard): unknown {
        const normalizedYaml = board.yamlHeader || board.boardSettings
            ? this._parser.updateYamlWithBoardSettings(board.yamlHeader, board.boardSettings || {})
            : null;

        const normalizedColumns = sortColumnsByRow(board.columns).map(column => {
            if (column.includeMode) {
                return {
                    title: column.title,
                    includeMode: true,
                    tasks: []
                };
            }

            const tasks = column.tasks.map(task => {
                const persistedContent = task.includeMode && task.originalTitle
                    ? task.originalTitle
                    : task.content;

                return {
                    content: normalizeTaskContent(persistedContent)
                };
            });

            return {
                title: column.title,
                includeMode: false,
                tasks
            };
        });

        return {
            yamlHeader: normalizedYaml,
            kanbanFooter: board.kanbanFooter || null,
            columns: normalizedColumns
        };
    }

    private _findFirstDiffIndex(a: string, b: string): number {
        const max = Math.min(a.length, b.length);
        for (let i = 0; i < max; i++) {
            if (a[i] !== b[i]) {
                return i;
            }
        }
        return max;
    }
}
