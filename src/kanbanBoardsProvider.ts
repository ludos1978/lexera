/**
 * KanbanBoardsProvider - WebviewViewProvider for the unified Boards sidebar panel
 *
 * Replaces both KanbanSidebarProvider (TreeDataProvider) and KanbanSearchProvider (WebviewView).
 * Provides:
 * - Board file list with per-board config (timeframe, tags, enabled)
 * - Lock toggle for add/remove operations
 * - Drag-drop reorder
 * - Search with regex toggle and scope selection
 * - Recent/pinned searches
 *
 * Uses BoardRegistryService as shared data layer.
 *
 * @module kanbanBoardsProvider
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { BoardRegistryService, RegisteredBoard, SearchEntry } from './services/BoardRegistryService';
import { KanbanWebviewPanel } from './kanbanWebviewPanel';
import { BoardContentScanner, TextMatch } from './services/BoardContentScanner';
import { TextMatcher } from './utils/textMatcher';
import { MarkdownKanbanParser, KanbanBoard } from './markdownParser';
import { DashboardBoardConfig } from './dashboard/DashboardTypes';
import {
    SearchResultItem,
    NavigateToElementMessage
} from './core/bridge/MessageTypes';

/**
 * Represents a board that can be searched
 */
interface SearchableBoard {
    uri: string;
    name: string;
    board: KanbanBoard;
    basePath: string;
}

/**
 * KanbanBoardsProvider - Unified boards + search sidebar panel
 */
export class KanbanBoardsProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'kanbanBoardsSidebar';

    private _view?: vscode.WebviewView;
    private _extensionUri: vscode.Uri;
    private _registry: BoardRegistryService;
    private _pendingQuery: string | null = null;
    private _disposables: vscode.Disposable[] = [];

    constructor(extensionUri: vscode.Uri) {
        this._extensionUri = extensionUri;
        this._registry = BoardRegistryService.getInstance();

        // Subscribe to registry events
        this._disposables.push(
            this._registry.onBoardsChanged(() => this._sendStateToWebview()),
            this._registry.onSearchesChanged(() => this._sendStateToWebview()),
            this._registry.onSortModeChanged(() => this._sendStateToWebview())
        );
    }

    /**
     * Called when the view is first created
     */
    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ): void {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        // Handle messages from the sidebar webview
        webviewView.webview.onDidReceiveMessage(async (message) => {
            switch (message.type) {
                // Board management
                case 'addBoard':
                    await this._handleAddBoard();
                    break;
                case 'removeBoard':
                    await this._registry.removeBoard(message.filePath);
                    break;
                case 'scanWorkspace':
                    await this._registry.scanWorkspace();
                    break;
                case 'clearBoards':
                    await this._registry.clearBoards();
                    break;
                case 'toggleLock':
                    await this._registry.setLocked(!this._registry.locked);
                    break;
                case 'openBoard':
                    await this._handleOpenBoard(message.filePath);
                    break;
                case 'reorderBoards':
                    await this._registry.reorderBoards(message.draggedPaths, message.targetPath);
                    break;

                // Board config
                case 'updateBoardConfig':
                    await this._registry.updateBoardConfig(message.boardUri, {
                        timeframe: message.timeframe,
                        tagFilters: message.tagFilters,
                        enabled: message.enabled
                    });
                    break;
                case 'addTagFilter':
                    await this._registry.addTagFilter(message.boardUri, message.tag);
                    break;
                case 'removeTagFilter':
                    await this._registry.removeTagFilter(message.boardUri, message.tag);
                    break;

                // Default config (All Boards settings)
                case 'setDefaultTimeframe':
                    await this._registry.setDefaultTimeframe(message.timeframe);
                    break;
                case 'addDefaultTagFilter':
                    await this._registry.addDefaultTagFilter(message.tag);
                    break;
                case 'removeDefaultTagFilter':
                    await this._registry.removeDefaultTagFilter(message.tag);
                    break;

                // Search
                case 'searchText':
                    await this._handleTextSearch(message.query, {
                        useRegex: message.useRegex,
                        scope: message.scope
                    });
                    break;
                case 'searchBrokenElements':
                    await this._handleBrokenElementsSearch(message.scope);
                    break;
                case 'navigateToElement':
                    await this._handleNavigateToElement(message as NavigateToElementMessage);
                    break;
                case 'pinSearch':
                    await this._registry.toggleSearchPin(message.query);
                    break;
                case 'removeSearch':
                    await this._registry.removeSearch(message.query);
                    break;

                // Ready
                case 'ready':
                    this._sendStateToWebview();
                    if (this._pendingQuery) {
                        this._view?.webview.postMessage({ type: 'setSearchQuery', query: this._pendingQuery });
                        this._pendingQuery = null;
                    }
                    break;
            }
        });

        webviewView.onDidChangeVisibility(() => {
            if (webviewView.visible) {
                this._sendStateToWebview();
            }
        });
    }

    /**
     * Set a search query from an external command (e.g. [[#tag]] navigation)
     */
    public setSearchQuery(query: string): void {
        this._pendingQuery = query;
        if (this._view?.webview) {
            this._view.webview.postMessage({ type: 'setSearchQuery', query });
            this._pendingQuery = null;
        }
    }

    /**
     * Send full state to the webview for rendering
     */
    private _sendStateToWebview(): void {
        if (!this._view) { return; }

        const boards = this._registry.getBoards();
        const boardsData = boards.map(b => ({
            filePath: b.filePath,
            uri: b.uri,
            name: path.basename(b.filePath, '.md'),
            config: b.config
        }));

        this._view.webview.postMessage({
            type: 'state',
            boards: boardsData,
            locked: this._registry.locked,
            searches: this._registry.recentSearches,
            sortMode: this._registry.sortMode,
            defaultTimeframe: this._registry.defaultTimeframe,
            defaultTagFilters: this._registry.defaultTagFilters,
            hasActivePanel: KanbanWebviewPanel.getAllPanels().length > 0
        });
    }

    // ============= Board Management Handlers =============

    private async _handleAddBoard(): Promise<void> {
        const fileUris = await vscode.window.showOpenDialog({
            canSelectMany: true,
            filters: { 'Markdown': ['md'] },
            openLabel: 'Add Board'
        });

        if (fileUris) {
            for (const uri of fileUris) {
                await this._registry.addBoard(uri);
            }
        }
    }

    private async _handleOpenBoard(filePath: string): Promise<void> {
        try {
            const uri = vscode.Uri.file(filePath);
            const document = await vscode.workspace.openTextDocument(uri);
            KanbanWebviewPanel.createOrShow(this._extensionUri, this._getExtensionContext(), document);
        } catch (error) {
            console.error('[BoardsProvider] Error opening board:', error);
        }
    }

    // ============= Search Handlers (migrated from KanbanSearchProvider) =============

    private async _handleTextSearch(query: string, options?: { useRegex?: boolean; scope?: string }): Promise<void> {
        if (!query || query.trim().length === 0) {
            this._sendSearchResults([], 'text');
            return;
        }

        // Validate regex before scanning
        if (options?.useRegex) {
            const probe = new TextMatcher(query.trim(), { useRegex: true });
            if (probe.regexError) {
                this._sendError(`Invalid regex: ${probe.regexError}`);
                return;
            }
        }

        // Add to recent searches
        await this._registry.addSearch(query, options?.useRegex, options?.scope as any);

        const scope = options?.scope || 'active';
        const boards = await this._collectBoardsForScope(scope);

        if (boards.length === 0) {
            if (scope === 'active') {
                this._sendNoActivePanel();
            } else {
                this._sendError('No boards available to search');
            }
            return;
        }

        try {
            const allResults: SearchResultItem[] = [];

            for (const searchableBoard of boards) {
                const scanner = new BoardContentScanner(searchableBoard.basePath);
                const matches = scanner.searchText(
                    searchableBoard.board,
                    query.trim(),
                    { useRegex: options?.useRegex }
                );

                const results: SearchResultItem[] = matches.map(match => ({
                    type: 'text',
                    matchText: match.matchText,
                    context: match.context,
                    location: match.location,
                    exists: true,
                    boardUri: boards.length > 1 ? searchableBoard.uri : undefined,
                    boardName: boards.length > 1 ? searchableBoard.name : undefined
                }));

                allResults.push(...results);
            }

            this._sendSearchResults(allResults, 'text');
        } catch (error) {
            console.error('[BoardsProvider] Error during text search:', error);
            this._sendError(`Search failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    private async _handleBrokenElementsSearch(scope?: string): Promise<void> {
        const effectiveScope = scope || 'active';
        const boards = await this._collectBoardsForScope(effectiveScope);

        if (boards.length === 0) {
            if (effectiveScope === 'active') {
                this._sendNoActivePanel();
            } else {
                this._sendError('No boards available to search');
            }
            return;
        }

        try {
            const allResults: SearchResultItem[] = [];

            for (const searchableBoard of boards) {
                const scanner = new BoardContentScanner(searchableBoard.basePath);
                const brokenElements = scanner.findBrokenElements(searchableBoard.board);

                const results: SearchResultItem[] = brokenElements.map(elem => ({
                    type: elem.type,
                    path: elem.path,
                    location: elem.location,
                    exists: false,
                    boardUri: boards.length > 1 ? searchableBoard.uri : undefined,
                    boardName: boards.length > 1 ? searchableBoard.name : undefined
                }));

                allResults.push(...results);
            }

            this._sendSearchResults(allResults, 'broken');
        } catch (error) {
            console.error('[BoardsProvider] Error scanning for broken elements:', error);
            this._sendError(`Search failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Collect boards based on search scope
     */
    private async _collectBoardsForScope(scope: string): Promise<SearchableBoard[]> {
        const boardMap = new Map<string, SearchableBoard>();

        if (scope === 'active') {
            // Active board only
            const panel = KanbanWebviewPanel.getActivePanel();
            if (panel) {
                const docUri = panel.getCurrentDocumentUri();
                if (docUri) {
                    const board = panel.getBoard();
                    const basePath = docUri ? path.dirname(docUri.fsPath) : undefined;
                    if (board && basePath) {
                        boardMap.set(docUri.toString(), {
                            uri: docUri.toString(),
                            name: path.basename(docUri.fsPath, '.md'),
                            board,
                            basePath
                        });
                    }
                }
            }
        } else if (scope === 'open') {
            // All open panels
            const panels = KanbanWebviewPanel.getAllPanels();
            for (const panel of panels) {
                const docUri = panel.getCurrentDocumentUri();
                if (!docUri) { continue; }
                const uri = docUri.toString();
                if (boardMap.has(uri)) { continue; }
                const board = panel.getBoard();
                const basePath = path.dirname(docUri.fsPath);
                if (board) {
                    boardMap.set(uri, { uri, name: path.basename(docUri.fsPath, '.md'), board, basePath });
                }
            }
        } else {
            // 'listed' - all registered boards
            // First, add from open panels (live board data)
            const panels = KanbanWebviewPanel.getAllPanels();
            for (const panel of panels) {
                const docUri = panel.getCurrentDocumentUri();
                if (!docUri) { continue; }
                const uri = docUri.toString();
                if (boardMap.has(uri)) { continue; }
                const board = panel.getBoard();
                const basePath = path.dirname(docUri.fsPath);
                if (board) {
                    boardMap.set(uri, { uri, name: path.basename(docUri.fsPath, '.md'), board, basePath });
                }
            }

            // Then, add from registry (parse files that aren't already open)
            const registeredBoards = this._registry.getEnabledBoards();
            for (const regBoard of registeredBoards) {
                if (boardMap.has(regBoard.uri)) { continue; }

                try {
                    const filePath = regBoard.filePath;
                    if (!fs.existsSync(filePath)) { continue; }

                    const content = fs.readFileSync(filePath, 'utf8');
                    const parseResult = MarkdownKanbanParser.parseMarkdown(content, filePath);

                    boardMap.set(regBoard.uri, {
                        uri: regBoard.uri,
                        name: path.basename(filePath, '.md'),
                        board: parseResult.board,
                        basePath: path.dirname(filePath)
                    });
                } catch (error) {
                    console.error(`[BoardsProvider] Failed to load board ${regBoard.uri}:`, error);
                }
            }
        }

        return Array.from(boardMap.values());
    }

    /**
     * Handle navigation to element request (migrated from KanbanSearchProvider)
     */
    private async _handleNavigateToElement(message: NavigateToElementMessage): Promise<void> {
        if (message.boardUri) {
            try {
                const uri = vscode.Uri.parse(message.boardUri);
                let panel = KanbanWebviewPanel.getPanelForDocument(message.boardUri);

                if (!panel) {
                    const document = await vscode.workspace.openTextDocument(uri);
                    KanbanWebviewPanel.createOrShow(this._extensionUri, this._getExtensionContext(), document);
                    // Wait for panel to be created
                    await new Promise(resolve => setTimeout(resolve, 300));
                    panel = KanbanWebviewPanel.getPanelForDocument(message.boardUri);
                }

                if (panel) {
                    panel.scrollToElement(
                        message.columnId,
                        message.taskId,
                        true,
                        message.elementPath,
                        message.elementType,
                        message.field,
                        message.matchText
                    );
                    return;
                }
            } catch (error) {
                console.error('[BoardsProvider] Error opening board for navigation:', error);
            }
        }

        // Fallback: use active panel
        const panel = KanbanWebviewPanel.getActivePanel();
        if (!panel) {
            this._sendNoActivePanel();
            return;
        }

        panel.scrollToElement(
            message.columnId,
            message.taskId,
            true,
            message.elementPath,
            message.elementType,
            message.field,
            message.matchText
        );
    }

    // ============= Message Helpers =============

    private _sendSearchResults(results: SearchResultItem[], searchType: 'broken' | 'text'): void {
        this._view?.webview.postMessage({
            type: 'searchResults',
            results,
            searchType
        });
    }

    private _sendError(message: string): void {
        this._view?.webview.postMessage({ type: 'error', message });
    }

    private _sendNoActivePanel(): void {
        this._view?.webview.postMessage({ type: 'noActivePanel' });
    }

    // ============= Utilities =============

    private _getExtensionContext(): vscode.ExtensionContext {
        // Access the context from the registry (stored during initialization)
        // This is a workaround - the context is passed during extension activation
        return (this._registry as any)._context;
    }

    private _getNonce(): string {
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }

    // ============= HTML Generation =============

    private _getHtmlForWebview(webview: vscode.Webview): string {
        const srcRoot = vscode.Uri.joinPath(this._extensionUri, 'src', 'html');
        const distRoot = vscode.Uri.joinPath(this._extensionUri, 'dist', 'src', 'html');
        const useSrc = fs.existsSync(vscode.Uri.joinPath(srcRoot, 'boardsPanel.js').fsPath);
        const assetRoot = useSrc ? srcRoot : distRoot;

        const styleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(assetRoot, 'boardsPanel.css')
        );
        const stringUtilsUri = webview.asWebviewUri(
            vscode.Uri.joinPath(assetRoot, 'utils', 'stringUtils.js')
        );
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(assetRoot, 'boardsPanel.js')
        );

        const codiconsUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'node_modules', '@vscode/codicons', 'dist', 'codicon.css')
        );

        const nonce = this._getNonce();

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource} https://microsoft.github.io; script-src 'nonce-${nonce}';">
    <link href="${codiconsUri}" rel="stylesheet" />
    <link href="${styleUri}" rel="stylesheet">
    <title>Kanban Boards</title>
</head>
<body>
    <div class="boards-container">
        <!-- Search Section -->
        <div class="search-section">
            <div class="search-input-container">
                <input type="text" class="search-input" placeholder="Search board content..." />
                <button class="regex-toggle-btn" title="Use Regular Expression">
                    <span class="regex-icon">.*</span>
                </button>
                <select class="scope-select" title="Search Scope">
                    <option value="active">Active Board</option>
                    <option value="listed">All Listed</option>
                    <option value="open">Open Boards</option>
                </select>
                <button class="search-btn" title="Search">
                    <span class="codicon codicon-search"></span>
                </button>
            </div>
            <div class="recent-searches" id="recent-searches"></div>
        </div>

        <!-- Search Results (hidden by default) -->
        <div class="search-results-section" id="search-results-section" style="display: none;">
            <div class="section-header" data-section="searchResults">
                <div class="tree-twistie collapsible expanded"></div>
                <span class="section-title">Search Results</span>
                <button class="close-results-btn" title="Close results">✕</button>
            </div>
            <div class="section-content" id="search-results-content">
                <div class="results-list" id="results-list"></div>
            </div>
        </div>

        <!-- Boards Section -->
        <div class="boards-section">
            <div class="section-header" data-section="boards">
                <div class="tree-twistie collapsible expanded"></div>
                <span class="section-title">Boards</span>
                <button class="lock-btn" id="lock-btn" title="Toggle lock">
                    <span class="codicon codicon-lock"></span>
                </button>
                <button class="lock-btn" id="all-boards-toggle-btn" title="All boards settings">
                    <span class="codicon codicon-settings-gear"></span>
                </button>
            </div>
            <div class="section-content" id="boards-content">
                <div class="all-boards-config" id="all-boards-config" style="display: none;">
                    <div id="all-boards-config-content"></div>
                </div>
                <div id="boards-list"></div>
                <div class="boards-actions" id="boards-actions">
                    <button class="action-btn" id="add-board-btn" title="Add board">
                        <span class="codicon codicon-add"></span> Add Board
                    </button>
                    <button class="action-btn" id="scan-btn" title="Scan workspace">
                        <span class="codicon codicon-search"></span> Scan Workspace
                    </button>
                </div>
            </div>
        </div>
    </div>

    <script nonce="${nonce}" src="${stringUtilsUri}"></script>
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }

    // ============= Dispose =============

    dispose(): void {
        for (const d of this._disposables) {
            d.dispose();
        }
        this._disposables = [];
    }
}
