import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { MarkdownKanbanParser, KanbanBoard } from './markdownParser';
import { FileManager } from './fileManager';
import { MarkdownFileRegistry, FileFactory } from './files';
import { BackupManager } from './services/BackupManager';
import { SaveEventDispatcher, SaveEventHandler } from './SaveEventDispatcher';
import { BoardOperations } from './board';
import { FileSaveService } from './core/FileSaveService';
import { getErrorMessage, safeDecodeURIComponent } from './utils/stringUtils';
import { logger } from './utils/logger';
import { PanelContext, WebviewManager } from './panel';
import { BoardStore } from './core/stores';
import { showError, showWarning, showInfo } from './services/NotificationService';
import { SaveOptions } from './files/SaveOptions';
import { MarkdownFile } from './files/MarkdownFile';
import { ConflictDialogBridge, ConflictDialogResult, ConflictFileInfo } from './services/ConflictDialogBridge';

/**
 * Save operation state for hybrid state machine + version tracking
 *
 * Replaces timing-dependent boolean flag with explicit states for reliability
 */
enum SaveState {
    IDLE,        // No save operation in progress
    SAVING       // Save operation active (applying edits, saving files)
}

/**
 * Simplified dependencies for KanbanFileService
 * Direct references instead of callback indirection
 */
export interface KanbanFileServiceDeps {
    boardStore: BoardStore;
    extensionContext: vscode.ExtensionContext;
    getPanel: () => vscode.WebviewPanel;
    getPanelInstance: () => any;
    getWebviewManager: () => WebviewManager | null;
    sendBoardUpdate: (applyDefaultFolding?: boolean, isFullRefresh?: boolean) => Promise<void>;
}

export type SaveScope = 'main' | 'includes' | 'all' | { filePath: string };

export interface SaveUnifiedOptions {
    board?: KanbanBoard;
    scope?: SaveScope;
    force?: boolean;
    source?: SaveOptions['source'];
    syncIncludes?: boolean;
    updateBaselines?: boolean;
    updateUi?: boolean;
    skipValidation?: boolean;
}

/**
 * KanbanFileService
 *
 * Handles all file operations for the Kanban board including:
 * - Loading and reloading markdown files
 * - Saving board state to markdown
 * - File state tracking and conflict detection
 * - File utilities (lock, open, etc.)
 *
 * RELIABILITY UPGRADE: Uses hybrid state machine + version tracking for
 * defense-in-depth change detection (replaces _isUpdatingFromPanel flag)
 */
export class KanbanFileService {
    // State machine for tracking save operations
    private _saveState: SaveState = SaveState.IDLE;

    // NEW ARCHITECTURE COMPONENTS
    private _fileSaveService: FileSaveService;

    // Shared panel context (single source of truth with panel)
    private _context: PanelContext;

    // Dependencies (simplified from callbacks)
    private _deps: KanbanFileServiceDeps;

    // Debounce timer for document change reparse (prevents rapid reparses during undo/redo)

    // Flag to skip undo detection when we are saving the document ourselves
    private _saveToMarkdownInFlight: Promise<void> | null = null;

    constructor(
        private fileManager: FileManager,
        private fileRegistry: MarkdownFileRegistry,
        _fileFactory: FileFactory,  // Reserved for future use
        private backupManager: BackupManager,
        private boardOperations: BoardOperations,
        deps: KanbanFileServiceDeps,
        context: PanelContext,  // Shared panel context
        private panelStates: Map<string, any>,
        private panels: Map<string, any>
    ) {
        this._context = context;
        this._deps = deps;

        // Initialize new architecture components - use panel's file save service
        this._fileSaveService = context.fileSaveService;
    }

    // Convenience accessors for dependencies
    private get board() { return () => this._deps.boardStore.getBoard(); }
    private get setBoard() { return (board: KanbanBoard) => this._deps.boardStore.setBoard(board); }
    private get sendBoardUpdate() { return this._deps.sendBoardUpdate; }
    private get panel() { return this._deps.getPanel; }
    private get extensionContext() { return this._deps.extensionContext; }
    private get updateWebviewPermissions() { return () => this._deps.getWebviewManager()?.updatePermissions(); }
    private get undoRedoManagerClear() { return () => this._deps.boardStore.clearHistory(); }
    private get getPanelInstance() { return this._deps.getPanelInstance; }
    private get setOriginalTaskOrder() { return (board: KanbanBoard) => this._deps.boardStore.setOriginalTaskOrder(board); }

    /**
     * Get current state values for syncing back to panel
     * NOTE: Document state (version, uri) is now shared via PanelContext
     */
    public getState(): {
        isUpdatingFromPanel: boolean;
        hasUnsavedChanges: boolean;
    } {
        // Query main file for unsaved changes (single source of truth)
        const mainFile = this.fileRegistry.getMainFile();
        const hasUnsavedChanges = mainFile?.hasUnsavedChanges() || false;

        // STATE MACHINE: Convert to boolean
        const isUpdatingFromPanel = this._saveState !== SaveState.IDLE;

        return {
            isUpdatingFromPanel,
            hasUnsavedChanges: hasUnsavedChanges
        };
    }

    /**
     * Ensure board is loaded and send update to webview
     */
    public async ensureBoardAndSendUpdate(): Promise<void> {
        const stack = new Error().stack?.split('\n').slice(1, 6).join('\n') || 'no stack';
        logger.debug('[KanbanFileService.ensureBoardAndSendUpdate] START - CALLER:\n' + stack);
        if (this.fileManager.getDocument()) {
            try {
                const document = this.fileManager.getDocument()!;

                // Parse board from file on disk (NOT VS Code buffer)
                // The kanban only cares about file data on disk, never the editor buffer state
                const filePath = document.uri.fsPath;
                const basePath = path.dirname(filePath);
                const diskContent = await fs.promises.readFile(filePath, 'utf-8');
                const normalizedContent = diskContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
                const parseResult = MarkdownKanbanParser.parseMarkdown(normalizedContent, basePath, undefined, filePath);
                this.setBoard(parseResult.board);

                const currentBoard = this.board();
                if (currentBoard) {
                    this.setOriginalTaskOrder(currentBoard);
                }
            } catch (error) {
                this.setBoard({
                    valid: false,
                    title: 'Error Loading Board',
                    columns: [],
                    yamlHeader: null,
                    kanbanFooter: null
                });
            }
        }

        logger.debug('[KanbanFileService.ensureBoardAndSendUpdate] Calling sendBoardUpdate');
        await this.sendBoardUpdate();
        logger.debug('[KanbanFileService.ensureBoardAndSendUpdate] DONE');
    }

    /**
     * Load markdown file and parse into board structure
     */
    public async loadMarkdownFile(document: vscode.TextDocument, forceReload: boolean = false): Promise<void> {

        // STATE MACHINE: Don't reload during save operations
        if (this._saveState !== SaveState.IDLE) {
            return;
        }

        // Store document URI for serialization (in shared PanelContext)
        this._context.setLastDocumentUri(document.uri.toString());

        // Store panel state for serialization in VSCode context
        const panelId = this._context.panelId;
        this.panelStates.set(panelId, {
            documentUri: document.uri.toString(),
            panelId: panelId
        });

        // Also store in VSCode's global state for persistence across restarts
        // Use documentUri hash as stable key so panels can find their state after restart
        const stableKey = `kanban_doc_${Buffer.from(document.uri.toString()).toString('base64').replace(/[^a-zA-Z0-9]/g, '_')}`;
        this.extensionContext.globalState.update(stableKey, {
            documentUri: document.uri.toString(),
            lastAccessed: Date.now(),
            panelId: panelId  // Store for cleanup but don't use for lookup
        });

        const currentDocumentUri = this.fileManager.getDocument()?.uri.toString();
        const isDifferentDocument = currentDocumentUri !== document.uri.toString();

        // STRICT POLICY: Only reload board in these specific cases:
        // 1. Initial panel creation (no existing board)
        // 2. Switching to a different document
        // 3. User explicitly forces reload via dialog
        const isInitialLoad = !this.board();

        if (!isInitialLoad && !isDifferentDocument && !forceReload) {
            // 🚫 NEVER auto-reload: Preserve existing board state
            // External changes are handled by the unified file watcher system
            // (UnifiedChangeHandler and individual file watchers detect and resolve conflicts)
            this._context.setLastDocumentVersion(document.version);
            return;
        }

        const previousDocument = this.fileManager.getDocument();
        const documentChanged = previousDocument?.uri.toString() !== document.uri.toString();
        const isFirstDocumentLoad = !previousDocument;

        // If document changed or this is the first document, update panel tracking
        if (documentChanged || isFirstDocumentLoad) {
            // Remove this panel from old document tracking
            const oldDocUri = this._context.trackedDocumentUri || previousDocument?.uri.toString();
            const panelInstance = this.getPanelInstance();
            if (oldDocUri && this.panels.get(oldDocUri) === panelInstance) {
                this.panels.delete(oldDocUri);
            }

            // Add to new document tracking
            const newDocUri = document.uri.toString();
            this._context.setTrackedDocumentUri(newDocUri);  // Remember this URI for cleanup
            this.panels.set(newDocUri, panelInstance);

            // Update panel title
            const fileName = path.basename(document.fileName);
            const currentPanel = this.panel();
            if (currentPanel) {
                currentPanel.title = `Kanban: ${fileName}`;
            }
        }

        this.fileManager.setDocument(document);

        // Register save handler now that document is available
        this.registerSaveHandler();

        if (documentChanged) {
            this.updateWebviewPermissions();

            // Create initial backup
            await this.backupManager.createBackup(document);

            // Start periodic backup timer
            this.backupManager.startPeriodicBackup(document);
        }

        try {
            // ALLOWED: Loading board (initial load, different document, or force reload)
            // Read from disk, NOT VS Code buffer — kanban only cares about file data on disk
            const filePath = document.uri.fsPath;
            const basePath = path.dirname(filePath);
            const diskContent = await fs.promises.readFile(filePath, 'utf-8');
            const normalizedContent = diskContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
            const parseResult = MarkdownKanbanParser.parseMarkdown(normalizedContent, basePath, undefined, filePath);

            // Update version tracking (in shared PanelContext)
            this._context.setLastDocumentVersion(document.version);

            // Handle undo/redo history
            const isUndoRedoOperation = false; // This would need to be passed as parameter if needed
            if (isDifferentDocument && !isUndoRedoOperation && this._saveState === SaveState.IDLE && !forceReload) {
                // Only clear history when switching to completely different documents
                // Don't clear on force reload of same document (e.g., external changes)
                this.undoRedoManagerClear();
            }

            // Update the board
            this.setBoard(parseResult.board);

            // CRITICAL: Check include file existence and set includeError flags BEFORE sending to frontend
            // This runs during initial load when MainKanbanFile may not be initialized yet
            this._checkIncludeFileExistence(parseResult.board, basePath);

            // Clean up any duplicate row tags
            const currentBoard = this.board();
            if (currentBoard) {
                this.boardOperations.cleanupRowTags(currentBoard);
                this.setOriginalTaskOrder(currentBoard);
            }

            // Clear unsaved changes flag after successful reload
            if (forceReload) {
                const mainFile = this.fileRegistry.getMainFile();
                if (mainFile) {
                    // Always discard to reset state
                    // discardChanges() internally checks if content changed before emitting events
                    mainFile.discardChanges();
                }
            }
        } catch (error) {
            showError(`Kanban parsing error: ${getErrorMessage(error)}`);
            this.setBoard({
                valid: false,
                title: 'Error Loading Board',
                columns: [],
                yamlHeader: null,
                kanbanFooter: null
            });
        }

        // DEBUG: Log include error state before sending to frontend
        const boardBeforeSend = this.board();
        if (boardBeforeSend?.columns) {
            for (const col of boardBeforeSend.columns) {
                if (col.includeFiles && col.includeFiles.length > 0) {
                    logger.debug(`[KanbanFileService] BEFORE sendBoardUpdate - column ${col.id}: includeMode=${col.includeMode}, includeError=${col.includeError}, includeFiles=${JSON.stringify(col.includeFiles)}`);
                }
                for (const task of col.tasks || []) {
                    if (task.includeFiles && task.includeFiles.length > 0) {
                        logger.debug(`[KanbanFileService] BEFORE sendBoardUpdate - task ${task.id}: includeMode=${task.includeMode}, includeError=${task.includeError}, includeFiles=${JSON.stringify(task.includeFiles)}`);
                    }
                }
            }
        }

        // Send file info BEFORE board update so that window.currentFilePath is set
        // when the board renders - this is needed for relative path resolution in images
        this.fileManager.sendFileInfo();
        await this.sendBoardUpdate(false, forceReload);
    }

    /**
     * Unified save pipeline for all save operations (Cmd+S, individual save, save includes)
     */
    public async saveUnified(options: SaveUnifiedOptions = {}): Promise<void> {
        const scope = options.scope ?? 'all';
        const requiresExclusive = scope === 'all' || scope === 'main';

        if (requiresExclusive && this._saveToMarkdownInFlight) {
            return this._saveToMarkdownInFlight;
        }

        const runSave = async () => {
            const board = options.board ?? this.board() ?? undefined;
            const force = options.force ?? false;
            const source = options.source ?? 'ui-edit';
            const syncIncludes = options.syncIncludes ?? (scope === 'all' || scope === 'includes');
            const updateBaselines = options.updateBaselines ?? true;
            const updateUi = options.updateUi ?? true;
            const skipValidation = options.skipValidation ?? false;
            let savedMainFile = false;

            const needsBoard = scope === 'main' || scope === 'all' || syncIncludes;
            if (needsBoard && (!board || !board.valid)) {
                console.warn(`[KanbanFileService.saveUnified] Cannot save - board missing or invalid (scope=${typeof scope === 'string' ? scope : 'file'})`);
                return;
            }

            if (syncIncludes && board) {
                const panelInstance = this.getPanelInstance();
                if (panelInstance?.syncIncludeFilesWithBoard) {
                    panelInstance.syncIncludeFilesWithBoard(board);
                }
                if (panelInstance?.syncIncludesFromBoard) {
                    await panelInstance.syncIncludesFromBoard(board, 'edit');
                }
            }

            // Pre-save: check for files with pending external changes (Scenario 2)
            const presaveCheck = await this._handlePresaveConflictCheck(scope);
            if (presaveCheck.result === 'abort') {
                return;
            }
            const forceWritePaths = presaveCheck.forceWritePaths;

            if (scope === 'main' || scope === 'all') {
                const mainFile = this.fileRegistry.getMainFile();
                if (!mainFile) {
                    console.warn('[KanbanFileService.saveUnified] No main file registered');
                    return;
                }
                if (board) {
                    mainFile.setCachedBoardFromWebview(board);
                }

                const markdown = MarkdownKanbanParser.generateMarkdown(board!);
                const forceMain = force || forceWritePaths.has(mainFile.getPath());
                await this._fileSaveService.saveFile(mainFile, markdown, {
                    source,
                    force: forceMain,
                    skipReloadDetection: true,
                    skipValidation
                });

                if (updateBaselines && board) {
                    mainFile.updateFromBoard(board, true, true);
                }
                savedMainFile = true;
            }

            if (scope === 'includes' || scope === 'all') {
                const includeCandidates = this.fileRegistry.getIncludeFiles()
                    .filter(f => f.exists())
                    .filter(f => f.getFileType() !== 'include-regular');
                const forceIncludeSave = force || syncIncludes;
                const includeFiles = forceIncludeSave
                    ? includeCandidates
                    : includeCandidates.filter(f => f.hasUnsavedChanges());

                if (includeFiles.length > 0) {
                    const saveResults = await Promise.allSettled(
                        includeFiles.map(f => this._fileSaveService.saveFile(f, undefined, {
                            source,
                            force: forceIncludeSave || forceWritePaths.has(f.getPath()),
                            skipReloadDetection: true,
                            skipValidation
                        }))
                    );

                    const failures = saveResults
                        .map((result, index) => ({ result, file: includeFiles[index] }))
                        .filter(({ result }) => result.status === 'rejected');

                    if (failures.length > 0) {
                        failures.forEach(({ result, file }) => {
                            const error = (result as PromiseRejectedResult).reason;
                            console.warn(`[KanbanFileService] Skipping save for ${file.getPath()}: ${error.message || error}`);
                        });
                    }
                }
            }

            if (typeof scope === 'object' && scope.filePath) {
                const file = this._resolveFileFromRegistry(scope.filePath);
                if (!file) {
                    throw new Error(`File not found in registry: ${scope.filePath}`);
                }

                if (file.getFileType() === 'main') {
                    await this.saveUnified({
                        board,
                        scope: 'main',
                        force,
                        source,
                        syncIncludes,
                        updateBaselines,
                        updateUi,
                        skipValidation
                    });
                    return;
                }

                await this._fileSaveService.saveFile(file, undefined, {
                    source,
                    force,
                    skipReloadDetection: true,
                    skipValidation
                });
            }

            if (updateUi && savedMainFile) {
                const panelInstance = this.panel();
                if (panelInstance) {
                    try {
                        panelInstance.webview.postMessage({
                            type: 'saveCompleted',
                            success: true
                        });
                    } catch (e) {
                        // Webview may be disposed during panel close - save already succeeded
                    }
                }
            }
        };

        if (requiresExclusive) {
            const savePromise = runSave();
            this._saveToMarkdownInFlight = savePromise;
            try {
                await savePromise;
            } finally {
                if (this._saveToMarkdownInFlight === savePromise) {
                    this._saveToMarkdownInFlight = null;
                }
            }
            return;
        }

        if (this._saveToMarkdownInFlight) {
            await this._saveToMarkdownInFlight;
        }

        await runSave();
    }

    private _resolveFileFromRegistry(filePath: string) {
        const document = this.fileManager.getDocument();
        const absolutePath = path.isAbsolute(filePath) || !document
            ? filePath
            : path.join(path.dirname(document.uri.fsPath), filePath);

        return this.fileRegistry.findByPath(filePath)
            || this.fileRegistry.get(absolutePath);
    }

    /**
     * Pre-save conflict check (Scenario 2).
     * Collects files with pending external changes and shows the 3-option dialog.
     *
     * @returns result ('continue' or 'abort') plus a set of file paths that need forced writes
     *          (e.g. after "Overwrite (backup external)" where hasUnsavedChanges() is false)
     */
    private async _handlePresaveConflictCheck(scope: SaveScope): Promise<{ result: 'continue' | 'abort'; forceWritePaths: Set<string> }> {
        const filesWithExternalChanges: Array<{ file: MarkdownFile; label: string }> = [];

        const mainFile = this.fileRegistry.getMainFile();

        if ((scope === 'main' || scope === 'all') && mainFile?.hasExternalChanges()) {
            filesWithExternalChanges.push({ file: mainFile, label: mainFile.getFileName() });
        }
        if (scope === 'includes' || scope === 'all') {
            for (const f of this.fileRegistry.getIncludeFiles()) {
                if (f.exists() && f.hasExternalChanges()) {
                    filesWithExternalChanges.push({ file: f, label: f.getRelativePath() });
                }
            }
        }
        if (typeof scope === 'object' && scope.filePath) {
            const file = this._resolveFileFromRegistry(scope.filePath);
            if (file && file.hasExternalChanges()) {
                const label = file.getFileType() === 'main' ? file.getFileName() : file.getRelativePath();
                filesWithExternalChanges.push({ file, label });
            }
        }

        if (filesWithExternalChanges.length === 0) {
            return { result: 'continue', forceWritePaths: new Set() };
        }

        // Show conflict dialog via webview bridge
        const dialogResult = await this._showPresaveConflictDialog(filesWithExternalChanges);

        if (!dialogResult || dialogResult.cancelled) {
            return { result: 'abort', forceWritePaths: new Set() };
        }

        // Build resolution map from per-file results
        const resolutionMap = new Map(dialogResult.perFileResolutions.map(r => [r.path, r.action]));
        const forceWritePaths = new Set<string>();
        let anyReloaded = false;

        for (const { file } of filesWithExternalChanges) {
            const action = resolutionMap.get(file.getPath()) || 'skip';

            switch (action) {
                case 'overwrite': {
                    // Force save kanban content (no backup)
                    forceWritePaths.add(file.getPath());
                    break;
                }
                case 'overwrite_backup_external': {
                    // Backup external version, then force save kanban content
                    const diskContent = await file.readFromDisk();
                    if (diskContent) {
                        const conflictPath = await file.createVisibleConflictFile(diskContent);
                        if (!conflictPath) {
                            showError('Failed to create backup of external changes. Save aborted.');
                            return { result: 'abort', forceWritePaths: new Set() };
                        }
                        this._showConflictFileNotification(conflictPath, 'External changes backed up');
                    }
                    forceWritePaths.add(file.getPath());
                    break;
                }
                case 'load_external': {
                    // Reload from disk (no backup)
                    if (file.isInEditMode()) {
                        file.setEditMode(false);
                    }
                    await file.reload();
                    anyReloaded = true;
                    break;
                }
                case 'load_external_backup_mine': {
                    // Backup kanban content, load external version
                    const kanbanContent = file.getContent();
                    const conflictPath = await file.createVisibleConflictFile(kanbanContent);
                    if (!conflictPath) {
                        showError('Failed to create backup of your changes. Save aborted.');
                        return { result: 'abort', forceWritePaths: new Set() };
                    }
                    this._showConflictFileNotification(conflictPath, 'Your changes backed up');
                    await file.reload();
                    anyReloaded = true;
                    break;
                }
                case 'skip':
                default:
                    // Do nothing for this file
                    break;
            }
        }

        // If any files were reloaded, update the board
        if (anyReloaded) {
            const freshMainFile = this.fileRegistry.getMainFile();
            const freshBoard = freshMainFile?.getBoard();
            if (freshBoard) {
                this.setBoard(freshBoard);
                await this.sendBoardUpdate(false, true);
            }
        }

        // If we have files to force-write, continue the save
        // If only reloads/skips, abort the save (nothing to write)
        if (forceWritePaths.size > 0) {
            return { result: 'continue', forceWritePaths };
        }

        // If all files were either reloaded or skipped, abort save
        return { result: 'abort', forceWritePaths: new Set() };
    }

    /**
     * Show the pre-save conflict dialog via webview ConflictDialogBridge.
     */
    private async _showPresaveConflictDialog(
        filesWithChanges: Array<{ file: MarkdownFile; label: string }>
    ): Promise<ConflictDialogResult | null> {
        const bridge = this._context.conflictDialogBridge;
        const panel = this.panel();

        if (!panel) {
            return null;
        }

        const conflictFileInfos: ConflictFileInfo[] = filesWithChanges.map(({ file }) => ({
            path: file.getPath(),
            relativePath: file.getRelativePath(),
            fileType: file.getFileType() as ConflictFileInfo['fileType'],
            hasExternalChanges: file.hasExternalChanges(),
            hasUnsavedChanges: file.hasAnyUnsavedChanges(),
            isInEditMode: file.isInEditMode()
        }));

        try {
            return await bridge.showConflict(
                (msg) => {
                    try {
                        panel.webview.postMessage(msg);
                        return true;
                    } catch {
                        return false;
                    }
                },
                {
                    conflictType: 'presave_conflict',
                    files: conflictFileInfos,
                    openMode: 'save_conflict'
                }
            );
        } catch (error) {
            logger.warn('[KanbanFileService] Conflict dialog failed:', error);
            return null;
        }
    }

    /**
     * Show notification with link to open a conflict backup file.
     */
    private _showConflictFileNotification(conflictPath: string, prefix: string): void {
        const fileName = path.basename(conflictPath);
        vscode.window.showInformationMessage(
            `${prefix}: ${fileName}`,
            'Open Conflict File'
        ).then(choice => {
            if (choice === 'Open Conflict File') {
                vscode.workspace.openTextDocument(conflictPath).then(doc => {
                    vscode.window.showTextDocument(doc);
                });
            }
        });
    }

    /**
     * Initialize a new kanban file with header
     */
    public async initializeFile(): Promise<void> {
        const document = this.fileManager.getDocument();
        if (!document) {
            showError('No document loaded');
            return;
        }

        // Check if document is still open
        const isDocumentOpen = vscode.workspace.textDocuments.some(doc =>
            doc.uri.toString() === document.uri.toString()
        );

        if (!isDocumentOpen) {
            showWarning(
                `Cannot initialize: "${path.basename(document.fileName)}" has been closed. Please reopen the file.`,
                'Open File'
            ).then(async selection => {
                if (selection === 'Open File') {
                    await this.openFileWithReuseCheck(document.uri.fsPath);
                }
            });
            return;
        }

        // STATE MACHINE: Transition to SAVING
        this._saveState = SaveState.SAVING;

        const kanbanHeader = "---\n\nkanban-plugin: board\n\n---\n\n";
        const currentContent = document.getText();
        const newContent = kanbanHeader + currentContent;

        const edit = new vscode.WorkspaceEdit();
        edit.replace(
            document.uri,
            new vscode.Range(0, 0, document.lineCount, 0),
            newContent
        );

        try {
            await vscode.workspace.applyEdit(edit);
            await document.save();

            // STATE MACHINE: Transition to IDLE before reload
            this._saveState = SaveState.IDLE;

            // Reload the file after successful initialization (forceReload=true to bypass early-return check)
            await this.loadMarkdownFile(document, true);

            showInfo('Kanban board initialized successfully');
        } catch (error) {
            // STATE MACHINE: Error recovery
            this._saveState = SaveState.IDLE;
            showError(`Failed to initialize file: ${error}`);
        }
    }

    /**
     * Setup document change listener for tracking modifications.
     *
     * IMPORTANT: The kanban does NOT react to VS Code text buffer changes.
     * The kanban only cares about FILE DATA on disk, not editor buffers.
     * Text editor typing, undo, redo — none of these affect the kanban board.
     * Only when a file is SAVED to disk does it matter (detected by file watcher).
     *
     * This listener only sends document state (dirty flag) to the file manager.
     */
    public setupDocumentChangeListener(disposables: vscode.Disposable[]): void {
        const changeDisposable = vscode.workspace.onDidChangeTextDocument((event) => {
            const currentDocument = this.fileManager.getDocument();
            if (currentDocument && event.document === currentDocument) {
                // Notify file manager of document dirty state only
                const currentPanel = this.panel();
                if (currentPanel) {
                    currentPanel.webview.postMessage({
                        type: 'documentStateChanged',
                        isDirty: event.document.isDirty,
                        version: event.document.version
                    });
                }
            }
        });
        disposables.push(changeDisposable);

        // NOTE: SaveEventDispatcher registration moved to loadMarkdownFile()
        // because document is not available yet when this method is called in constructor
    }

    /**
     * Register handler with SaveEventDispatcher for version tracking
     */
    public registerSaveHandler(): void {
        const dispatcher = SaveEventDispatcher.getInstance();
        const document = this.fileManager.getDocument();
        if (!document) return;

        const handlerId = `panel-${document.uri.fsPath}`;

        const handler: SaveEventHandler = {
            id: handlerId,
            handleSave: async (savedDocument: vscode.TextDocument) => {
                const currentDocument = this.fileManager.getDocument();

                if (currentDocument && savedDocument === currentDocument) {
                    // Document was saved, update version tracking (in shared PanelContext)
                    this._context.setLastDocumentVersion(savedDocument.version);
                    // NOTE: Watcher handles conflict detection and auto-reload via SaveOptions
                }

                // Check if this is an included file
                for (const file of this.fileRegistry.getIncludeFiles()) {
                    if (savedDocument.uri.fsPath === file.getPath()) {
                        // Registry tracks save state automatically

                        // NOTE: Watcher handles everything via SaveOptions - no manual marking needed

                        // Notify file manager to update
                        const currentPanel = this.panel();
                        if (currentPanel) {
                            currentPanel.webview.postMessage({
                                type: 'includeFileStateChanged',
                                filePath: file.getRelativePath(),
                                isUnsavedInEditor: false
                            });
                        }

                        // External changes are handled by ExternalFileWatcher (registered with SaveEventDispatcher)
                        break;
                    }
                }
            }
        };

        dispatcher.registerHandler(handler);
    }

    /**
     * Open a file with reuse check - focuses existing editor if already open
     */
    public async openFileWithReuseCheck(filePath: string): Promise<void> {
        try {
            // Normalize the path for comparison (resolve symlinks, normalize separators)
            const normalizedPath = path.resolve(filePath);

            // Check if the file is already open as a document (even if not visible)
            const existingDocument = vscode.workspace.textDocuments.find(doc => {
                const docPath = path.resolve(doc.uri.fsPath);
                return docPath === normalizedPath;
            });

            if (existingDocument) {
                // File is already open, focus it
                await vscode.window.showTextDocument(existingDocument, {
                    preserveFocus: false,
                    preview: false
                    // Let VS Code find the existing tab location
                });
            } else {
                // File is not open, open it normally
                const fileUri = vscode.Uri.file(filePath);
                const document = await vscode.workspace.openTextDocument(fileUri);
                await vscode.window.showTextDocument(document, {
                    preserveFocus: false,
                    preview: false
                });
            }
        } catch (error) {
            console.error(`[KanbanFileService] Error opening file ${filePath}:`, error);
        }
    }

    /**
     * Check include file existence and set includeError flags on the board
     *
     * This is called during initial load when MainKanbanFile may not be initialized yet.
     * It directly checks the filesystem and sets error flags so the frontend shows warnings.
     */
    private _checkIncludeFileExistence(board: KanbanBoard, basePath: string): void {
        if (!board.columns) return;

        for (const column of board.columns) {
            // Check column includes
            if (column.includeFiles && column.includeFiles.length > 0) {
                for (const relativePath of column.includeFiles) {
                    const decodedPath = safeDecodeURIComponent(relativePath);
                    // Resolve the absolute path
                    const absolutePath = path.isAbsolute(decodedPath)
                        ? decodedPath
                        : path.resolve(basePath, decodedPath);

                    const fileExists = fs.existsSync(absolutePath);
                    logger.debug(`[KanbanFileService] Initial load include check: column=${column.id}, relativePath=${relativePath}, absolutePath=${absolutePath}, exists=${fileExists}`);

                    if (!fileExists) {
                        (column as any).includeMode = true;  // REQUIRED for frontend to show error styling
                        (column as any).includeError = true;
                        // Don't create error task - just show empty column with error badge
                        column.tasks = [];
                    }
                }
            }

            // Check task includes
            for (const task of column.tasks || []) {
                if (task.includeFiles && task.includeFiles.length > 0) {
                    for (const relativePath of task.includeFiles) {
                        const decodedPath = safeDecodeURIComponent(relativePath);
                        const absolutePath = path.isAbsolute(decodedPath)
                            ? decodedPath
                            : path.resolve(basePath, decodedPath);

                        const fileExists = fs.existsSync(absolutePath);
                        logger.debug(`[KanbanFileService] Initial load include check: task=${task.id}, relativePath=${relativePath}, absolutePath=${absolutePath}, exists=${fileExists}`);

                        if (!fileExists) {
                            (task as any).includeMode = true;  // REQUIRED for frontend to show error styling
                            (task as any).includeError = true;
                            task.description = '';  // Error details shown on hover via include badge
                        }
                    }
                }
            }
        }
    }

}
