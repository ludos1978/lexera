/**
 * BoardRegistryService - Singleton shared data layer for board management
 *
 * Single source of truth for:
 * - Board list + order + lock state (workspaceState)
 * - Board configs: timeframe, tagFilters, enabled (VS Code settings)
 * - Search entries: recent + pinned (workspaceState)
 * - Sort mode (workspaceState)
 *
 * Both the Boards Panel and Dashboard Panel subscribe to events from this service.
 *
 * @module services/BoardRegistryService
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import {
    isUnsavedChangesFile,
    isAutosaveFile,
    isBackupFile,
    isConflictFile
} from '../constants/FileNaming';
import { DashboardBoardConfig } from '../dashboard/DashboardTypes';
import { showWarning, showInfo, notificationService } from './NotificationService';

// ============= Types =============

/**
 * A registered board with its URI, file path, and dashboard config
 */
export interface RegisteredBoard {
    uri: string;
    filePath: string;
    config: DashboardBoardConfig;
}

/**
 * A search entry (recent or pinned)
 */
export interface SearchEntry {
    query: string;
    pinned: boolean;
    useRegex?: boolean;
    scope?: 'active' | 'listed' | 'open';
}

/**
 * Sort mode for dashboard results
 */
export type DashboardSortMode = 'boardFirst' | 'merged';

// ============= Service =============

/**
 * BoardRegistryService - Singleton service consolidating board management data
 */
export class BoardRegistryService implements vscode.Disposable {
    private static _instance: BoardRegistryService | undefined;

    // Board data
    private _boards: Map<string, RegisteredBoard> = new Map(); // filePath -> board
    private _customOrder: string[] = [];
    private _locked: boolean = true;
    private _hasScanned: boolean = false;
    private _validationCache: Map<string, { isValid: boolean; timestamp: number }> = new Map();
    private static readonly CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

    // Search data
    private _recentSearches: SearchEntry[] = [];
    private static readonly MAX_UNPINNED_SEARCHES = 3;

    // Default config (All Boards settings)
    private _defaultTimeframe: 3 | 7 | 30 = 7;
    private _defaultTagFilters: string[] = [];

    // Sort mode
    private _sortMode: DashboardSortMode = 'boardFirst';

    // File watchers
    private _fileWatchers: Map<string, vscode.FileSystemWatcher> = new Map();

    // Events
    private _onBoardsChanged = new vscode.EventEmitter<void>();
    readonly onBoardsChanged: vscode.Event<void> = this._onBoardsChanged.event;

    private _onSearchesChanged = new vscode.EventEmitter<void>();
    readonly onSearchesChanged: vscode.Event<void> = this._onSearchesChanged.event;

    private _onSortModeChanged = new vscode.EventEmitter<DashboardSortMode>();
    readonly onSortModeChanged: vscode.Event<DashboardSortMode> = this._onSortModeChanged.event;

    // VS Code context
    private _context: vscode.ExtensionContext;
    private _disposables: vscode.Disposable[] = [];

    private constructor(context: vscode.ExtensionContext) {
        this._context = context;

        // Migrate old workspace state keys on first load
        this._migrateWorkspaceState();

        // Load persisted state
        this._loadFromWorkspaceState();

        // Load board configs from VS Code settings
        this._loadBoardConfigs();

        // Watch for configuration changes
        this._disposables.push(
            vscode.workspace.onDidChangeConfiguration(e => {
                if (e.affectsConfiguration('markdown-kanban.dashboard')) {
                    this._loadBoardConfigs();
                    this._onBoardsChanged.fire();
                }
            })
        );

        // Listen to workspace folder changes
        this._disposables.push(
            vscode.workspace.onDidChangeWorkspaceFolders(e => {
                this._handleWorkspaceFolderChanges(e);
            })
        );
    }

    /**
     * Initialize the singleton instance
     */
    static initialize(context: vscode.ExtensionContext): BoardRegistryService {
        if (!BoardRegistryService._instance) {
            BoardRegistryService._instance = new BoardRegistryService(context);
        }
        return BoardRegistryService._instance;
    }

    /**
     * Get the singleton instance (must be initialized first)
     */
    static getInstance(): BoardRegistryService {
        if (!BoardRegistryService._instance) {
            throw new Error('BoardRegistryService not initialized. Call initialize() first.');
        }
        return BoardRegistryService._instance;
    }

    // ============= Board List Management (migrated from KanbanSidebarProvider) =============

    /**
     * Get all registered boards in display order
     */
    getBoards(): RegisteredBoard[] {
        const boards = Array.from(this._boards.values());

        if (this._customOrder.length > 0) {
            boards.sort((a, b) => {
                const indexA = this._customOrder.indexOf(a.filePath);
                const indexB = this._customOrder.indexOf(b.filePath);
                if (indexA !== -1 && indexB !== -1) { return indexA - indexB; }
                if (indexA !== -1) { return -1; }
                if (indexB !== -1) { return 1; }
                return path.basename(a.filePath).localeCompare(path.basename(b.filePath));
            });
        } else {
            boards.sort((a, b) => path.basename(a.filePath).localeCompare(path.basename(b.filePath)));
        }

        return boards;
    }

    /**
     * Get enabled boards (for dashboard scanning)
     */
    getEnabledBoards(): RegisteredBoard[] {
        return this.getBoards().filter(b => b.config.enabled);
    }

    /**
     * Get board by file path
     */
    getBoardByPath(filePath: string): RegisteredBoard | undefined {
        return this._boards.get(filePath);
    }

    /**
     * Get board by URI string
     */
    getBoardByUri(uri: string): RegisteredBoard | undefined {
        for (const board of this._boards.values()) {
            if (board.uri === uri) { return board; }
        }
        return undefined;
    }

    /**
     * Add a board file to the registry
     */
    async addBoard(uri: vscode.Uri): Promise<void> {
        const filePath = uri.fsPath;

        if (this._boards.has(filePath)) {
            showWarning('File already in kanban list');
            return;
        }

        // Validate it's a kanban file
        const isValid = await this.isKanbanFile(filePath);
        if (!isValid) {
            const result = await notificationService.confirm(
                'This file does not appear to be a kanban board (missing "kanban-plugin: board" in YAML header). Add anyway?',
                'Yes'
            );
            if (result !== 'confirm') { return; }
        }

        const uriString = uri.toString();

        const board: RegisteredBoard = {
            uri: uriString,
            filePath,
            config: {
                uri: uriString,
                timeframe: 0,
                tagFilters: [],
                enabled: true
            }
        };

        this._boards.set(filePath, board);
        this._watchFile(filePath);

        if (!this._customOrder.includes(filePath)) {
            this._customOrder.push(filePath);
        }

        await this._saveToWorkspaceState();
        await this._saveBoardConfigs();
        this._onBoardsChanged.fire();

        showInfo(`Added ${path.basename(filePath)} to kanban list`);
    }

    /**
     * Remove a board from the registry
     */
    async removeBoard(filePath: string): Promise<void> {
        if (!this._boards.has(filePath)) { return; }

        this._boards.delete(filePath);
        this._unwatchFile(filePath);
        this._validationCache.delete(filePath);
        this._customOrder = this._customOrder.filter(p => p !== filePath);

        await this._saveToWorkspaceState();
        await this._saveBoardConfigs();
        this._onBoardsChanged.fire();

        showInfo(`Removed ${path.basename(filePath)} from kanban list`);
    }

    /**
     * Remove a board by URI string
     */
    async removeBoardByUri(uri: string): Promise<void> {
        const board = this.getBoardByUri(uri);
        if (board) {
            await this.removeBoard(board.filePath);
        }
    }

    /**
     * Clear all boards from the registry
     */
    async clearBoards(): Promise<void> {
        const result = await notificationService.confirm(
            'Remove all kanban boards from sidebar?',
            'Yes'
        );
        if (result !== 'confirm') { return; }

        for (const filePath of this._boards.keys()) {
            this._unwatchFile(filePath);
        }

        this._boards.clear();
        this._validationCache.clear();
        this._customOrder = [];

        await this._saveToWorkspaceState();
        await this._saveBoardConfigs();
        this._onBoardsChanged.fire();

        showInfo('Kanban sidebar cleared');
    }

    /**
     * Reorder boards via drag & drop
     */
    async reorderBoards(draggedPaths: string[], targetPath: string | undefined): Promise<void> {
        const currentOrder = this.getBoards().map(b => b.filePath);
        const withoutDragged = currentOrder.filter(p => !draggedPaths.includes(p));

        let newOrder: string[];
        if (targetPath) {
            const targetIndex = withoutDragged.indexOf(targetPath);
            if (targetIndex !== -1) {
                newOrder = [
                    ...withoutDragged.slice(0, targetIndex),
                    ...draggedPaths,
                    ...withoutDragged.slice(targetIndex)
                ];
            } else {
                newOrder = [...withoutDragged, ...draggedPaths];
            }
        } else {
            newOrder = [...withoutDragged, ...draggedPaths];
        }

        this._customOrder = newOrder;
        await this._saveToWorkspaceState();
        this._onBoardsChanged.fire();
    }

    // ============= Board Config Management (migrated from KanbanDashboardProvider) =============

    /**
     * Update a board's configuration
     */
    async updateBoardConfig(
        uri: string,
        updates: { timeframe?: 0 | 3 | 7 | 30; tagFilters?: string[]; enabled?: boolean }
    ): Promise<void> {
        const board = this.getBoardByUri(uri);
        if (!board) { return; }

        if (updates.timeframe !== undefined) { board.config.timeframe = updates.timeframe; }
        if (updates.tagFilters !== undefined) { board.config.tagFilters = updates.tagFilters; }
        if (updates.enabled !== undefined) { board.config.enabled = updates.enabled; }

        await this._saveBoardConfigs();
        this._onBoardsChanged.fire();
    }

    /**
     * Add a tag filter to a board
     */
    async addTagFilter(uri: string, tag: string): Promise<void> {
        const board = this.getBoardByUri(uri);
        if (!board) { return; }

        if (!board.config.tagFilters) {
            board.config.tagFilters = [];
        }

        if (!board.config.tagFilters.includes(tag)) {
            board.config.tagFilters.push(tag);
            await this._saveBoardConfigs();
            this._onBoardsChanged.fire();
        }
    }

    /**
     * Remove a tag filter from a board
     */
    async removeTagFilter(uri: string, tag: string): Promise<void> {
        const board = this.getBoardByUri(uri);
        if (!board || !board.config.tagFilters) { return; }

        const tagIndex = board.config.tagFilters.indexOf(tag);
        if (tagIndex !== -1) {
            board.config.tagFilters.splice(tagIndex, 1);
            await this._saveBoardConfigs();
            this._onBoardsChanged.fire();
        }
    }

    // ============= Lock State =============

    get locked(): boolean { return this._locked; }

    async setLocked(locked: boolean): Promise<void> {
        this._locked = locked;
        await this._context.workspaceState.update('kanbanBoards.locked', locked);
        this._onBoardsChanged.fire();
    }

    // ============= Default Config (All Boards Settings) =============

    get defaultTimeframe(): 3 | 7 | 30 { return this._defaultTimeframe; }
    get defaultTagFilters(): string[] { return [...this._defaultTagFilters]; }

    async setDefaultTimeframe(timeframe: 3 | 7 | 30): Promise<void> {
        this._defaultTimeframe = timeframe;
        await this._context.workspaceState.update('kanbanBoards.defaultTimeframe', timeframe);
        this._onBoardsChanged.fire();
    }

    async addDefaultTagFilter(tag: string): Promise<void> {
        if (!this._defaultTagFilters.includes(tag)) {
            this._defaultTagFilters.push(tag);
            await this._context.workspaceState.update('kanbanBoards.defaultTagFilters', this._defaultTagFilters);
            this._onBoardsChanged.fire();
        }
    }

    async removeDefaultTagFilter(tag: string): Promise<void> {
        const idx = this._defaultTagFilters.indexOf(tag);
        if (idx !== -1) {
            this._defaultTagFilters.splice(idx, 1);
            await this._context.workspaceState.update('kanbanBoards.defaultTagFilters', this._defaultTagFilters);
            this._onBoardsChanged.fire();
        }
    }

    /**
     * Get the effective timeframe for a board (resolves 0 to default)
     */
    getEffectiveTimeframe(board: RegisteredBoard): 3 | 7 | 30 {
        if (board.config.timeframe === 0) {
            return this._defaultTimeframe;
        }
        return board.config.timeframe;
    }

    /**
     * Get the effective tag filters for a board (default + per-board merged)
     */
    getEffectiveTagFilters(board: RegisteredBoard): string[] {
        const tags = new Set<string>(this._defaultTagFilters);
        if (board.config.tagFilters) {
            for (const tag of board.config.tagFilters) {
                tags.add(tag);
            }
        }
        return Array.from(tags);
    }

    // ============= Scan (migrated from KanbanSidebarProvider) =============

    get hasScanned(): boolean { return this._hasScanned; }

    /**
     * Scan workspace for kanban files using ripgrep for fast text search
     */
    async scanWorkspace(): Promise<void> {
        if (!vscode.workspace.workspaceFolders) {
            showWarning('No workspace folder opened');
            return;
        }

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Scanning workspace for kanban boards...',
            cancellable: true
        }, async (progress, token) => {
            const foundFiles: string[] = [];
            const candidateFiles = new Set<string>();

            progress.report({ message: 'Searching for kanban markers...' });

            const workspaceFolders = vscode.workspace.workspaceFolders || [];
            for (const folder of workspaceFolders) {
                if (token.isCancellationRequested) { break; }

                try {
                    const files = await this._searchWithRipgrep(folder.uri.fsPath, token);
                    files.forEach(f => candidateFiles.add(f));
                } catch (error) {
                    console.error(`[BoardRegistry] Error searching in ${folder.name}:`, error);
                    const fallbackFiles = await this._traditionalSearch(folder.uri.fsPath, token);
                    fallbackFiles.forEach(f => candidateFiles.add(f));
                }
            }

            if (token.isCancellationRequested) { return; }

            progress.report({ message: `Validating ${candidateFiles.size} candidates...` });

            let processed = 0;
            let skippedSpecial = 0;
            const totalCandidates = candidateFiles.size;

            for (const filePath of candidateFiles) {
                if (token.isCancellationRequested) { break; }

                processed++;
                if (processed % 10 === 0) {
                    progress.report({
                        message: `Validating ${processed}/${totalCandidates}...`,
                        increment: (10 / totalCandidates) * 100
                    });
                }

                if (isBackupFile(filePath) || isConflictFile(filePath) ||
                    isAutosaveFile(filePath) || isUnsavedChangesFile(filePath)) {
                    skippedSpecial++;
                    continue;
                }

                if (await this._hasYamlHeader(filePath)) {
                    if (!this._boards.has(filePath)) {
                        const uri = vscode.Uri.file(filePath);
                        const uriString = uri.toString();
                        this._boards.set(filePath, {
                            uri: uriString,
                            filePath,
                            config: {
                                uri: uriString,
                                timeframe: 0,
                                tagFilters: [],
                                enabled: true
                            }
                        });
                        this._watchFile(filePath);
                        foundFiles.push(filePath);
                    }

                    this._validationCache.set(filePath, {
                        isValid: true,
                        timestamp: Date.now()
                    });
                }
            }

            this._hasScanned = true;
            await this._context.workspaceState.update('kanbanBoards.hasScanned', true);
            await this._saveToWorkspaceState();
            await this._saveBoardConfigs();
            this._onBoardsChanged.fire();

            if (!token.isCancellationRequested) {
                const newCount = foundFiles.length;
                const totalCount = this._boards.size;
                const skippedMsg = skippedSpecial > 0 ? ` (skipped ${skippedSpecial} backup/special files)` : '';
                if (newCount > 0) {
                    showInfo(`Found ${newCount} new kanban board(s). Total: ${totalCount}${skippedMsg}`);
                } else {
                    showInfo(`No new boards found. Total: ${totalCount}${skippedMsg}`);
                }
            }
        });
    }

    /**
     * Check if file is a kanban board (with caching)
     */
    async isKanbanFile(filePath: string): Promise<boolean> {
        const cached = this._validationCache.get(filePath);
        if (cached) {
            const age = Date.now() - cached.timestamp;
            if (age < BoardRegistryService.CACHE_TTL) {
                return cached.isValid;
            }
        }

        try {
            const stats = await fs.promises.stat(filePath);
            if (!stats.isFile()) { return false; }

            const content = await fs.promises.readFile(filePath, 'utf8');
            const hasYamlHeader = content.includes('---');
            const hasKanbanMarker = content.includes('kanban-plugin: board');
            const isValid = hasYamlHeader && hasKanbanMarker;

            this._validationCache.set(filePath, { isValid, timestamp: Date.now() });
            return isValid;
        } catch (error) {
            console.error(`[BoardRegistry] Failed to validate ${filePath}:`, error);
            return false;
        }
    }

    // ============= Search Management =============

    get recentSearches(): SearchEntry[] {
        return [...this._recentSearches];
    }

    /**
     * Add a search entry (manages max unpinned limit)
     */
    async addSearch(query: string, useRegex?: boolean, scope?: 'active' | 'listed' | 'open'): Promise<void> {
        // Don't add duplicates
        const existing = this._recentSearches.findIndex(s => s.query === query);
        if (existing !== -1) {
            // Move to front if not pinned
            if (!this._recentSearches[existing].pinned) {
                const entry = this._recentSearches.splice(existing, 1)[0];
                entry.useRegex = useRegex;
                entry.scope = scope;
                this._recentSearches.unshift(entry);
            }
        } else {
            this._recentSearches.unshift({ query, pinned: false, useRegex, scope });
        }

        // Trim unpinned entries to max
        const unpinned = this._recentSearches.filter(s => !s.pinned);
        if (unpinned.length > BoardRegistryService.MAX_UNPINNED_SEARCHES) {
            // Remove oldest unpinned entries
            let removeCount = unpinned.length - BoardRegistryService.MAX_UNPINNED_SEARCHES;
            for (let i = this._recentSearches.length - 1; i >= 0 && removeCount > 0; i--) {
                if (!this._recentSearches[i].pinned) {
                    this._recentSearches.splice(i, 1);
                    removeCount--;
                }
            }
        }

        await this._context.workspaceState.update('kanbanBoards.searches', this._recentSearches);
        this._onSearchesChanged.fire();
    }

    /**
     * Toggle pin state of a search entry
     */
    async toggleSearchPin(query: string): Promise<void> {
        const entry = this._recentSearches.find(s => s.query === query);
        if (!entry) { return; }

        entry.pinned = !entry.pinned;
        await this._context.workspaceState.update('kanbanBoards.searches', this._recentSearches);
        this._onSearchesChanged.fire();
    }

    /**
     * Remove a search entry
     */
    async removeSearch(query: string): Promise<void> {
        this._recentSearches = this._recentSearches.filter(s => s.query !== query);
        await this._context.workspaceState.update('kanbanBoards.searches', this._recentSearches);
        this._onSearchesChanged.fire();
    }

    /**
     * Get pinned searches only (for dashboard re-execution)
     */
    getPinnedSearches(): SearchEntry[] {
        return this._recentSearches.filter(s => s.pinned);
    }

    // ============= Sort Mode =============

    get sortMode(): DashboardSortMode { return this._sortMode; }

    async setSortMode(mode: DashboardSortMode): Promise<void> {
        this._sortMode = mode;
        await this._context.workspaceState.update('kanbanBoards.sortMode', mode);
        this._onSortModeChanged.fire(mode);
    }

    // ============= Private: Ripgrep Search (migrated from KanbanSidebarProvider) =============

    private async _searchWithRipgrep(folderPath: string, token: vscode.CancellationToken): Promise<string[]> {
        const { spawn } = await import('child_process');

        return new Promise((resolve, reject) => {
            const files: string[] = [];

            const rg = spawn('rg', [
                '-l',
                '-g', '*.md',
                '--hidden',
                '--no-heading',
                'kanban-plugin: board',
                folderPath
            ], {
                cwd: folderPath,
                shell: process.platform === 'win32'
            });

            let stdout = '';
            let stderr = '';

            rg.stdout.on('data', (data: Buffer) => {
                stdout += data.toString();
            });

            rg.stderr.on('data', (data: Buffer) => {
                stderr += data.toString();
            });

            const cancelHandler = token.onCancellationRequested(() => {
                rg.kill();
                resolve([]);
            });

            rg.on('close', (code: number | null) => {
                cancelHandler.dispose();
                if (code === 0 || code === 1) {
                    const lines = stdout.trim().split('\n').filter(line => line.length > 0);
                    lines.forEach(line => {
                        const filePath = path.isAbsolute(line) ? line : path.join(folderPath, line);
                        if (filePath.endsWith('.md')) {
                            files.push(filePath);
                        }
                    });
                    resolve(files);
                } else {
                    reject(new Error(`ripgrep exited with code ${code}: ${stderr}`));
                }
            });

            rg.on('error', (err: Error) => {
                cancelHandler.dispose();
                reject(err);
            });
        });
    }

    private async _traditionalSearch(folderPath: string, token: vscode.CancellationToken): Promise<string[]> {
        const files: string[] = [];
        const pattern = new vscode.RelativePattern(folderPath, '**/*.md');
        const mdFiles = await vscode.workspace.findFiles(pattern, '**/node_modules/**', 1000);

        for (const file of mdFiles) {
            if (token.isCancellationRequested) { break; }
            if (await this.isKanbanFile(file.fsPath)) {
                files.push(file.fsPath);
            }
        }

        return files;
    }

    private async _hasYamlHeader(filePath: string): Promise<boolean> {
        try {
            const fd = await fs.promises.open(filePath, 'r');
            try {
                const buffer = Buffer.alloc(100);
                await fd.read(buffer, 0, 100, 0);
                const start = buffer.toString('utf8');
                return start.trimStart().startsWith('---');
            } finally {
                await fd.close();
            }
        } catch {
            return false;
        }
    }

    // ============= Private: File Watching =============

    private _watchFile(filePath: string): void {
        if (this._fileWatchers.has(filePath)) { return; }

        const watcher = vscode.workspace.createFileSystemWatcher(filePath);

        watcher.onDidChange(() => {
            this._validationCache.delete(filePath);
            this._onBoardsChanged.fire();
        });

        watcher.onDidDelete(() => {
            this._boards.delete(filePath);
            this._unwatchFile(filePath);
            this._saveToWorkspaceState();
            this._onBoardsChanged.fire();
        });

        this._fileWatchers.set(filePath, watcher);
        this._context.subscriptions.push(watcher);
    }

    private _unwatchFile(filePath: string): void {
        const watcher = this._fileWatchers.get(filePath);
        if (watcher) {
            watcher.dispose();
            this._fileWatchers.delete(filePath);
        }
    }

    // ============= Private: Workspace Folder Changes =============

    private _handleWorkspaceFolderChanges(e: vscode.WorkspaceFoldersChangeEvent): void {
        for (const removed of e.removed) {
            const removedPath = removed.uri.fsPath;
            const filesToRemove: string[] = [];
            for (const filePath of this._boards.keys()) {
                if (filePath.startsWith(removedPath)) {
                    filesToRemove.push(filePath);
                }
            }
            for (const filePath of filesToRemove) {
                this._boards.delete(filePath);
                this._unwatchFile(filePath);
                this._validationCache.delete(filePath);
            }
        }

        if (e.added.length > 0) {
            this.scanWorkspace().catch(err => {
                console.error('[BoardRegistry] Auto-scan of new folders failed:', err);
            });
        }

        this._saveToWorkspaceState();
        this._onBoardsChanged.fire();
    }

    // ============= Private: Persistence =============

    /**
     * Migrate old workspace state keys to new keys
     */
    private _migrateWorkspaceState(): void {
        const oldFiles = this._context.workspaceState.get<string[]>('kanbanSidebar.files');
        if (oldFiles !== undefined) {
            // Old state exists, migrate
            const newFiles = this._context.workspaceState.get<string[]>('kanbanBoards.files');
            if (newFiles === undefined) {
                this._context.workspaceState.update('kanbanBoards.files', oldFiles);
            }

            const oldOrder = this._context.workspaceState.get<string[]>('kanbanSidebar.order');
            if (oldOrder !== undefined) {
                const newOrder = this._context.workspaceState.get<string[]>('kanbanBoards.order');
                if (newOrder === undefined) {
                    this._context.workspaceState.update('kanbanBoards.order', oldOrder);
                }
            }

            const oldScanned = this._context.workspaceState.get<boolean>('kanbanSidebar.hasScanned');
            if (oldScanned !== undefined) {
                const newScanned = this._context.workspaceState.get<boolean>('kanbanBoards.hasScanned');
                if (newScanned === undefined) {
                    this._context.workspaceState.update('kanbanBoards.hasScanned', oldScanned);
                }
            }

            // Clean up old keys
            this._context.workspaceState.update('kanbanSidebar.files', undefined);
            this._context.workspaceState.update('kanbanSidebar.order', undefined);
            this._context.workspaceState.update('kanbanSidebar.hasScanned', undefined);
        }
    }

    /**
     * Load from workspace state (board file list, order, lock, searches, sort mode)
     */
    private _loadFromWorkspaceState(): void {
        const storedFiles = this._context.workspaceState.get<string[]>('kanbanBoards.files', []);
        const storedOrder = this._context.workspaceState.get<string[]>('kanbanBoards.order', []);
        this._hasScanned = this._context.workspaceState.get<boolean>('kanbanBoards.hasScanned', false);
        this._locked = this._context.workspaceState.get<boolean>('kanbanBoards.locked', true);
        this._recentSearches = this._context.workspaceState.get<SearchEntry[]>('kanbanBoards.searches', []);
        this._sortMode = this._context.workspaceState.get<DashboardSortMode>('kanbanBoards.sortMode', 'boardFirst');

        // Load default config (All Boards settings)
        const configDefault = this._getDefaultTimeframe();
        this._defaultTimeframe = this._context.workspaceState.get<3 | 7 | 30>('kanbanBoards.defaultTimeframe', configDefault);
        this._defaultTagFilters = this._context.workspaceState.get<string[]>('kanbanBoards.defaultTagFilters', []);

        // Build boards map from stored file paths
        for (const filePath of storedFiles) {
            const uri = vscode.Uri.file(filePath);
            const uriString = uri.toString();
            this._boards.set(filePath, {
                uri: uriString,
                filePath,
                config: {
                    uri: uriString,
                    timeframe: 0,
                    tagFilters: [],
                    enabled: true
                }
            });
            this._watchFile(filePath);
        }

        this._customOrder = storedOrder.filter(p => this._boards.has(p));
    }

    /**
     * Load board configs from VS Code settings and merge with registered boards
     */
    private _loadBoardConfigs(): void {
        const config = vscode.workspace.getConfiguration('markdown-kanban');
        const dashboardBoards = config.get<DashboardBoardConfig[]>('dashboard.boards', []);

        // Merge settings configs into registered boards
        for (const dashConfig of dashboardBoards) {
            try {
                const uri = vscode.Uri.parse(dashConfig.uri);
                const filePath = uri.fsPath;
                const board = this._boards.get(filePath);
                if (board) {
                    // Update config from settings
                    board.config.timeframe = dashConfig.timeframe;
                    board.config.tagFilters = dashConfig.tagFilters || [];
                    board.config.enabled = dashConfig.enabled;
                } else {
                    // Board in settings but not in file list - add it
                    this._boards.set(filePath, {
                        uri: dashConfig.uri,
                        filePath,
                        config: { ...dashConfig }
                    });
                    this._watchFile(filePath);
                    if (!this._customOrder.includes(filePath)) {
                        this._customOrder.push(filePath);
                    }
                }
            } catch (error) {
                console.error(`[BoardRegistry] Failed to load board config for ${dashConfig.uri}:`, error);
            }
        }
    }

    /**
     * Save board file list and order to workspace state
     */
    private async _saveToWorkspaceState(): Promise<void> {
        const filePaths = Array.from(this._boards.keys());
        await this._context.workspaceState.update('kanbanBoards.files', filePaths);
        await this._context.workspaceState.update('kanbanBoards.order', this._customOrder);
    }

    /**
     * Save board configs to VS Code settings
     */
    private async _saveBoardConfigs(): Promise<void> {
        const configs: DashboardBoardConfig[] = [];
        for (const board of this._boards.values()) {
            configs.push({ ...board.config });
        }

        const config = vscode.workspace.getConfiguration('markdown-kanban');
        await config.update('dashboard.boards', configs, vscode.ConfigurationTarget.Workspace);
    }

    /**
     * Get default timeframe from settings
     */
    private _getDefaultTimeframe(): 3 | 7 | 30 {
        const config = vscode.workspace.getConfiguration('markdown-kanban');
        return config.get<3 | 7 | 30>('dashboard.defaultTimeframe', 7);
    }

    // ============= Dispose =============

    dispose(): void {
        for (const watcher of this._fileWatchers.values()) {
            watcher.dispose();
        }
        this._fileWatchers.clear();
        this._onBoardsChanged.dispose();
        this._onSearchesChanged.dispose();
        this._onSortModeChanged.dispose();
        for (const d of this._disposables) {
            d.dispose();
        }
        this._disposables = [];
        BoardRegistryService._instance = undefined;
    }
}
