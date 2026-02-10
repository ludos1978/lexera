import * as fs from 'fs';
import * as path from 'path';
import { MarkdownFile } from './MarkdownFile';
import { ConflictResolver } from '../services/ConflictResolver';
import { BackupManager } from '../services/BackupManager';
import { IMainKanbanFile, IMarkdownFileRegistry, CapturedEdit } from './FileInterfaces';
import { UnifiedChangeHandler } from '../core/UnifiedChangeHandler';
import { KanbanTask } from '../board/KanbanTypes';
import { PresentationParser } from '../services/export/PresentationParser';
import { PresentationGenerator } from '../services/export/PresentationGenerator';
import { safeDecodeURIComponent } from '../utils/stringUtils';
import { generateTimestamp } from '../constants/FileNaming';
import { writeFileAtomically } from '../utils/atomicWrite';
import { SaveOptions } from './SaveOptions';

/**
 * Include file types supported by the plugin system
 */
export type IncludeFileType = 'include-column';

/**
 * Include file class for column include files.
 *
 * This class handles column include files (presentation-style include content).
 *
 * Responsibilities:
 * - Manage include file paths (relative to parent)
 * - Resolve absolute paths
 * - Handle parent-child relationship
 * - Coordinate changes with parent file
 * - Handle include-specific conflicts
 * - Parse/generate content based on file type
 */
export class IncludeFile extends MarkdownFile {
    // ============= FILE TYPE =============
    private _fileType: IncludeFileType;

    // ============= PARENT RELATIONSHIP =============
    protected _parentFile: IMainKanbanFile;          // Reference to parent kanban file
    protected _absolutePath: string;                 // Cached absolute path


    constructor(
        relativePath: string,
        parentFile: IMainKanbanFile,
        conflictResolver: ConflictResolver,
        backupManager: BackupManager,
        fileType: IncludeFileType
    ) {
        // Decode URL-encoded characters (e.g., %20 -> space)
        const decodedRelativePath = safeDecodeURIComponent(relativePath);

        const absolutePath = IncludeFile._resolveAbsolutePath(decodedRelativePath, parentFile.getPath());

        super(absolutePath, decodedRelativePath, conflictResolver, backupManager);

        this._fileType = fileType;
        this._parentFile = parentFile;
        this._absolutePath = absolutePath;
    }

    // ============= FILE TYPE =============

    public getFileType(): IncludeFileType {
        return this._fileType;
    }

    public getFileRegistry(): IMarkdownFileRegistry | undefined {
        return this._parentFile.getFileRegistry();
    }

    // ============= PATH RESOLUTION =============

    /**
     * Get the parent file
     */
    public getParentFile(): IMainKanbanFile {
        return this._parentFile;
    }

    public override getPath(): string {
        return this._ensureAbsolutePathCurrent();
    }

    /**
     * Resolve relative path to absolute path
     * Note: URL decoding is handled in constructor before calling this method
     */
    private static _resolveAbsolutePath(relativePath: string, parentPath: string): string {
        if (path.isAbsolute(relativePath)) {
            return relativePath;
        }

        const parentDir = path.dirname(parentPath);
        return path.resolve(parentDir, relativePath);
    }

    private _ensureAbsolutePathCurrent(): string {
        const resolvedPath = IncludeFile._resolveAbsolutePath(this._relativePath, this._parentFile.getPath());
        if (resolvedPath === this._absolutePath) {
            return resolvedPath;
        }

        const hadWatcher = Boolean(this._fileWatcher);
        if (hadWatcher) {
            this.stopWatching();
        }

        this._absolutePath = resolvedPath;
        this._path = resolvedPath;

        if (hadWatcher) {
            this.startWatching();
        }

        return resolvedPath;
    }

    // ============= FILE I/O =============

    /**
     * Read content from disk
     * CRITICAL: Normalizes CRLF to LF to ensure consistent line endings
     */
    public async readFromDisk(): Promise<string | null> {

        try {
            const absolutePath = this._ensureAbsolutePathCurrent();
            const content = await fs.promises.readFile(absolutePath, 'utf-8');
            this._exists = true;
            this._clearAccessError();
            // CRITICAL: Normalize CRLF to LF (Windows line endings to Unix)
            // This ensures consistent line endings for all parsing operations
            return content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        } catch (error) {
            this._recordAccessError(error);
            if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
                console.warn(`[${this.getFileType()}] File not found: ${this._absolutePath}`);
                this._exists = false;
            } else {
                console.error(`[${this.getFileType()}] Failed to read file:`, error);
            }
            return null;
        }
    }

    /**
     * Write content to disk
     */
    public async writeToDisk(content: string): Promise<void> {

        try {
            const absolutePath = this._ensureAbsolutePathCurrent();
            // Ensure directory exists
            const dir = path.dirname(absolutePath);
            await fs.promises.mkdir(dir, { recursive: true });

            // Write file atomically to avoid partial/truncated saves.
            await writeFileAtomically(absolutePath, content, { encoding: 'utf-8' });

            this._exists = true;
            this._clearAccessError();
            this._lastModified = new Date();
        } catch (error) {
            this._recordAccessError(error);
            console.error(`[${this.getFileType()}] Failed to write file:`, error);
            throw error;
        }
    }

    // ============= PARSING (for include-column) =============

    /**
     * Parse presentation format into tasks, preserving IDs for existing tasks
     * CRITICAL: Match by POSITION only, never by title/content
     * @param existingTasks Optional array of existing tasks to preserve IDs from
     * @param columnId Optional columnId to use for task ID generation (supports file reuse across columns)
     * @param mainFilePath Optional path to main kanban file (for dynamic image path resolution)
     */
    public parseToTasks(existingTasks?: KanbanTask[], columnId?: string, mainFilePath?: string): KanbanTask[] {
        // Note: A file can be used as different include types in different contexts.
        // Don't restrict parsing based on registered file type - just parse the content.

        // Use PresentationParser to convert slides to tasks
        const slides = PresentationParser.parsePresentation(this._content);
        const tasks = PresentationParser.slidesToTasks(slides, this._ensureAbsolutePathCurrent(), mainFilePath);

        // CRITICAL: Match by POSITION, not title - tasks identified by position
        return tasks.map((task, index) => {
            // Get existing task at SAME POSITION to preserve ID
            const existingTask = existingTasks?.[index];

            return {
                ...task,
                id: existingTask?.id || `task-${columnId}-${index}`,
                includeMode: false, // Tasks from column includes are NOT individual includes
                includeFiles: undefined, // Column has the includeFiles, not individual tasks
                includeContext: task.includeContext // Preserve includeContext for dynamic image resolution
            };
        });
    }

    /**
     * Generate presentation format from tasks (for include-column)
     * Note: A file can be used in multiple contexts - don't restrict based on registered type
     */
    public generateFromTasks(tasks: KanbanTask[]): string {
        // Use unified presentation generator (no YAML for copying)
        return PresentationGenerator.fromTasks(tasks, {
            filterIncludes: true
            // Note: includeMarpDirectives defaults to false (no YAML when copying)
        });
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

    // ============= BACKUP =============

    /**
     * Create backup of current content for include files
     * Since include files don't have TextDocuments, we write directly to a backup file
     */
    public async createBackup(label: string = 'manual'): Promise<string | null> {

        try {
            const timestamp = generateTimestamp();
            const absolutePath = this._ensureAbsolutePathCurrent();
            const backupDir = path.join(path.dirname(absolutePath), '.backups');
            const filename = path.basename(absolutePath);
            const backupPath = path.join(backupDir, `${timestamp}_${label}_${filename}`);

            // Ensure backup directory exists
            if (!fs.existsSync(backupDir)) {
                fs.mkdirSync(backupDir, { recursive: true });
            }

            // Write current content to backup file
            await fs.promises.writeFile(backupPath, this._content, 'utf8');

            return backupPath;
        } catch (error) {
            console.error(`[${this.getFileType()}] Failed to create backup:`, error);
            return null;
        }
    }

    public override async reload(): Promise<void> {
        this._ensureAbsolutePathCurrent();
        await super.reload();
    }

    public override async save(options: SaveOptions = {}): Promise<void> {
        this._ensureAbsolutePathCurrent();
        await super.save(options);
    }

    // ============= BASELINE CAPTURE FOR INCLUDE FILES =============

    /**
     * Apply a captured edit to the baseline for include files.
     * Updates BOTH _content and _baseline so the content/baseline pair stays
     * consistent (baseline is never newer than content).
     */
    public async applyEditToBaseline(capturedEdit: CapturedEdit): Promise<void> {
        this._content = capturedEdit.value;
        this._baseline = capturedEdit.value;
    }

    // ============= SIMPLIFIED CONFLICT DETECTION =============

    // hasAnyUnsavedChanges() and hasConflict() are now implemented in base class MarkdownFile
    // The base class handles VS Code document dirty checks via isDocumentDirtyInVSCode()

    // ============= VALIDATION =============

    /**
     * Validate file content based on file type
     */
    public validate(content: string): { valid: boolean; errors?: string[] } {
        return this._validateColumnContent(content);
    }

    /**
     * Validate presentation format content (for include-column)
     */
    private _validateColumnContent(content: string): { valid: boolean; errors?: string[] } {
        const errors: string[] = [];

        // Parse as presentation
        try {
            const slides = PresentationParser.parsePresentation(content);

            if (slides.length === 0) {
                errors.push('Column include must have at least one slide (task)');
            }

            // Empty slides are allowed (placeholders, separators, etc.)
        } catch (error) {
            errors.push(`Failed to parse presentation: ${error}`);
        }

        return {
            valid: errors.length === 0,
            errors: errors.length > 0 ? errors : undefined
        };
    }

}
