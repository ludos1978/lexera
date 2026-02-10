/**
 * KanbanSearchProvider - WebviewViewProvider for the Kanban Search sidebar panel
 *
 * Provides two search modes:
 * 1. Find Broken Elements - Detect missing images, includes, links, media, diagrams
 * 2. Text Search - Search for text across column titles, task titles, and descriptions
 *
 * @module kanbanSearchProvider
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { KanbanWebviewPanel } from './kanbanWebviewPanel';
import { BoardContentScanner, BrokenElement, TextMatch } from './services/BoardContentScanner';
import { TextMatcher } from './utils/textMatcher';
import { MarkdownKanbanParser, KanbanBoard } from './markdownParser';
import { DashboardBoardConfig } from './dashboard/DashboardTypes';
import {
    SearchResultItem,
    SearchBrokenElementsMessage,
    SearchTextMessage,
    NavigateToElementMessage,
    SearchResultsMessage,
    ScrollToElementMessage
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
 * KanbanSearchProvider - Sidebar panel for searching kanban boards
 */
export class KanbanSearchProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'kanbanSearch';

    private _view?: vscode.WebviewView;
    private _extensionUri: vscode.Uri;
    private _lastResultsPanel: KanbanWebviewPanel | null = null;
    private _lastResultsBoardUri: string | null = null;  // For multi-board search navigation
    private _pendingQuery: string | null = null;

    constructor(extensionUri: vscode.Uri) {
        this._extensionUri = extensionUri;
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
                case 'searchBrokenElements': {
                    const brokenMsg = message as SearchBrokenElementsMessage;
                    await this._handleBrokenElementsSearch(brokenMsg.searchAllBoards);
                    break;
                }
                case 'searchText': {
                    const searchMsg = message as SearchTextMessage;
                    await this._handleTextSearch(searchMsg.query, {
                        useRegex: searchMsg.useRegex,
                        caseSensitive: searchMsg.caseSensitive,
                        searchAllBoards: searchMsg.searchAllBoards
                    });
                    break;
                }
                case 'navigateToElement':
                    await this._handleNavigateToElement(message as NavigateToElementMessage);
                    break;
                case 'ready':
                    // Webview is ready, check if there's an active panel
                    this._updatePanelStatus();
                    if (this._pendingQuery) {
                        this._view?.webview.postMessage({ type: 'setSearchQuery', query: this._pendingQuery });
                        this._pendingQuery = null;
                    }
                    break;
            }
        });

        // Update panel status when view becomes visible
        webviewView.onDidChangeVisibility(() => {
            if (webviewView.visible) {
                this._updatePanelStatus();
            }
        });
    }

    /**
     * Update the sidebar with current panel status
     */
    private _updatePanelStatus(): void {
        const panels = KanbanWebviewPanel.getAllPanels();
        const hasActivePanel = panels.length > 0;

        this._view?.webview.postMessage({
            type: 'panelStatus',
            hasActivePanel,
            panelCount: panels.length
        });
    }

    /**
     * Handle broken elements search request
     */
    private async _handleBrokenElementsSearch(searchAllBoards?: boolean): Promise<void> {
        if (searchAllBoards) {
            await this._handleBrokenElementsSearchAllBoards();
            return;
        }

        const panel = this._getActivePanel();
        if (!panel) {
            this._sendNoActivePanel();
            return;
        }
        this._lastResultsPanel = panel;
        this._lastResultsBoardUri = null;

        const board = panel.getBoard();
        if (!board) {
            this._sendError('No board data available');
            return;
        }

        const basePath = this._getBasePath(panel);
        if (!basePath) {
            this._sendError('Could not determine document path');
            return;
        }

        try {
            const scanner = new BoardContentScanner(basePath);
            const brokenElements = scanner.findBrokenElements(board);

            const results: SearchResultItem[] = brokenElements.map(elem => ({
                type: elem.type,
                path: elem.path,
                location: elem.location,
                exists: false
            }));

            this._sendSearchResults(results, 'broken');
        } catch (error) {
            console.error('[KanbanSearchProvider] Error scanning for broken elements:', error);
            this._sendError(`Search failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Handle broken elements search across all boards
     */
    private async _handleBrokenElementsSearchAllBoards(): Promise<void> {
        const boards = await this._collectAllBoards();
        if (boards.length === 0) {
            this._sendError('No boards available to search');
            return;
        }

        this._lastResultsPanel = null;
        this._lastResultsBoardUri = null;

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
                    boardUri: searchableBoard.uri,
                    boardName: searchableBoard.name
                }));

                allResults.push(...results);
            }

            this._sendSearchResults(allResults, 'broken');
        } catch (error) {
            console.error('[KanbanSearchProvider] Error scanning all boards for broken elements:', error);
            this._sendError(`Search failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Handle text search request
     */
    private async _handleTextSearch(query: string, options?: { useRegex?: boolean; caseSensitive?: boolean; searchAllBoards?: boolean }): Promise<void> {
        if (!query || query.trim().length === 0) {
            this._sendSearchResults([], 'text');
            return;
        }

        // Validate regex before scanning to surface errors to the user
        if (options?.useRegex) {
            const probe = new TextMatcher(query.trim(), options);
            if (probe.regexError) {
                this._sendError(`Invalid regex: ${probe.regexError}`);
                return;
            }
        }

        if (options?.searchAllBoards) {
            await this._handleTextSearchAllBoards(query, options);
            return;
        }

        const panel = this._getActivePanel();
        if (!panel) {
            this._sendNoActivePanel();
            return;
        }
        this._lastResultsPanel = panel;
        this._lastResultsBoardUri = null;

        const board = panel.getBoard();
        if (!board) {
            this._sendError('No board data available');
            return;
        }

        const basePath = this._getBasePath(panel);
        if (!basePath) {
            this._sendError('Could not determine document path');
            return;
        }

        try {
            const scanner = new BoardContentScanner(basePath);
            const matches = scanner.searchText(
                board,
                query.trim(),
                options
            );

            const results: SearchResultItem[] = matches.map(match => ({
                type: 'text',
                matchText: match.matchText,
                context: match.context,
                location: match.location,
                exists: true
            }));

            this._sendSearchResults(results, 'text');
        } catch (error) {
            console.error('[KanbanSearchProvider] Error during text search:', error);
            this._sendError(`Search failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Handle text search across all boards
     */
    private async _handleTextSearchAllBoards(query: string, options?: { useRegex?: boolean; caseSensitive?: boolean }): Promise<void> {
        const boards = await this._collectAllBoards();
        if (boards.length === 0) {
            this._sendError('No boards available to search');
            return;
        }

        this._lastResultsPanel = null;
        this._lastResultsBoardUri = null;

        try {
            const allResults: SearchResultItem[] = [];

            for (const searchableBoard of boards) {
                const scanner = new BoardContentScanner(searchableBoard.basePath);
                const matches = scanner.searchText(
                    searchableBoard.board,
                    query.trim(),
                    options
                );

                const results: SearchResultItem[] = matches.map(match => ({
                    type: 'text',
                    matchText: match.matchText,
                    context: match.context,
                    location: match.location,
                    exists: true,
                    boardUri: searchableBoard.uri,
                    boardName: searchableBoard.name
                }));

                allResults.push(...results);
            }

            this._sendSearchResults(allResults, 'text');
        } catch (error) {
            console.error('[KanbanSearchProvider] Error during multi-board text search:', error);
            this._sendError(`Search failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Handle navigation to element request
     */
    private async _handleNavigateToElement(message: NavigateToElementMessage): Promise<void> {
        // If boardUri is specified (multi-board search), open that board first
        if (message.boardUri) {
            try {
                const uri = vscode.Uri.parse(message.boardUri);
                // Check if we already have a panel for this board
                let panel = KanbanWebviewPanel.getPanelForDocument(message.boardUri);

                if (!panel) {
                    // Open the document and create a panel
                    const document = await vscode.workspace.openTextDocument(uri);
                    await vscode.window.showTextDocument(document, { preview: false });
                    // Wait a bit for the panel to be created
                    await new Promise(resolve => setTimeout(resolve, 300));
                    panel = KanbanWebviewPanel.getPanelForDocument(message.boardUri);
                }

                if (panel) {
                    // scrollToElement internally reveals the panel
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
                console.error('[KanbanSearchProvider] Error opening board for navigation:', error);
            }
        }

        // Fallback to existing behavior
        const preferredPanel = this._lastResultsPanel && !this._lastResultsPanel.isDisposed()
            ? this._lastResultsPanel
            : undefined;
        const panel = preferredPanel || this._getActivePanel();
        if (!panel) {
            this._sendNoActivePanel();
            return;
        }

        // Use the panel's scrollToElement method which handles timing properly
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

    /**
     * Collect all unique boards from open panels and dashboard config
     */
    private async _collectAllBoards(): Promise<SearchableBoard[]> {
        const boardMap = new Map<string, SearchableBoard>();

        // 1. Collect from open panels
        const panels = KanbanWebviewPanel.getAllPanels();
        for (const panel of panels) {
            const docUri = panel.getCurrentDocumentUri();
            if (!docUri) { continue; }

            const uri = docUri.toString();
            if (boardMap.has(uri)) { continue; }

            const board = panel.getBoard();
            const basePath = this._getBasePath(panel);
            if (!board || !basePath) { continue; }

            boardMap.set(uri, {
                uri,
                name: path.basename(docUri.fsPath, '.md'),
                board,
                basePath
            });
        }

        // 2. Collect from dashboard config
        const config = vscode.workspace.getConfiguration('markdown-kanban');
        const dashboardBoards = config.get<DashboardBoardConfig[]>('dashboard.boards', []);

        for (const boardConfig of dashboardBoards) {
            if (!boardConfig.enabled) { continue; }
            if (boardMap.has(boardConfig.uri)) { continue; }

            try {
                const uri = vscode.Uri.parse(boardConfig.uri);
                const filePath = uri.fsPath;

                // Check if file exists
                if (!fs.existsSync(filePath)) { continue; }

                // Read and parse the file
                const content = fs.readFileSync(filePath, 'utf8');
                const parseResult = MarkdownKanbanParser.parseMarkdown(content, filePath);

                boardMap.set(boardConfig.uri, {
                    uri: boardConfig.uri,
                    name: path.basename(filePath, '.md'),
                    board: parseResult.board,
                    basePath: path.dirname(filePath)
                });
            } catch (error) {
                console.error(`[KanbanSearchProvider] Failed to load board ${boardConfig.uri}:`, error);
            }
        }

        return Array.from(boardMap.values());
    }

    /**
     * Get the currently active kanban panel
     */
    private _getActivePanel(): KanbanWebviewPanel | undefined {
        return KanbanWebviewPanel.getActivePanel();
    }

    /**
     * Get the base path (document directory) for a panel
     */
    private _getBasePath(panel: KanbanWebviewPanel): string | undefined {
        // Get the document URI from the panel
        const documentUri = panel.getCurrentDocumentUri();
        if (documentUri) {
            return path.dirname(documentUri.fsPath);
        }

        // Fallback: Get from workspace folders
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            return workspaceFolders[0].uri.fsPath;
        }

        return undefined;
    }

    /**
     * Send search results to the sidebar webview
     */
    private _sendSearchResults(results: SearchResultItem[], searchType: 'broken' | 'text'): void {
        const message: SearchResultsMessage = {
            type: 'searchResults',
            results,
            searchType
        };
        this._view?.webview.postMessage(message);
    }

    /**
     * Send error message to sidebar
     */
    private _sendError(message: string): void {
        this._view?.webview.postMessage({
            type: 'error',
            message
        });
    }

    /**
     * Send no active panel message
     */
    private _sendNoActivePanel(): void {
        this._view?.webview.postMessage({
            type: 'noActivePanel'
        });
    }

    /**
     * Generate HTML for the sidebar webview
     */
    private _getHtmlForWebview(webview: vscode.Webview): string {
        const srcRoot = vscode.Uri.joinPath(this._extensionUri, 'src', 'html');
        const distRoot = vscode.Uri.joinPath(this._extensionUri, 'dist', 'src', 'html');
        const useSrc = fs.existsSync(vscode.Uri.joinPath(srcRoot, 'searchPanel.js').fsPath);
        const assetRoot = useSrc ? srcRoot : distRoot;

        const styleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(assetRoot, 'searchPanel.css')
        );
        const stringUtilsUri = webview.asWebviewUri(
            vscode.Uri.joinPath(assetRoot, 'utils', 'stringUtils.js')
        );
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(assetRoot, 'searchPanel.js')
        );

        const nonce = this._getNonce();

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <link href="${styleUri}" rel="stylesheet">
    <title>Kanban Search</title>
</head>
<body>
        <div class="search-container">
        <!-- Mode Toggle -->
        <div class="mode-toggle">
            <button class="mode-btn active" data-mode="text" title="Search Text">
                <span class="codicon codicon-search"></span>
                Search
            </button>
            <button class="mode-btn" data-mode="broken" title="Find Broken Elements">
                <span class="codicon codicon-warning"></span>
                Broken
            </button>
        </div>

        <!-- Search Input (for text mode) -->
        <div class="search-input-container">
            <input type="text" class="search-input" placeholder="Search board content..." />
            <button class="regex-toggle-btn" title="Use Regular Expression">
                <span class="regex-icon">.*</span>
            </button>
            <button class="search-btn" title="Search">
                <span class="codicon codicon-search"></span>
            </button>
        </div>

        <!-- Search All Boards Checkbox -->
        <div class="search-options">
            <label class="checkbox-label" title="Search all open boards and boards configured in dashboard">
                <input type="checkbox" class="search-all-checkbox" />
                <span>Search all boards</span>
            </label>
        </div>

        <!-- Find Broken Button (for broken mode) -->
        <div class="find-broken-container" style="display: none;">
            <button class="find-broken-btn">
                <span class="codicon codicon-refresh"></span>
                Find Broken Elements
            </button>
        </div>

        <!-- Status Message -->
        <div class="status-message"></div>

        <!-- Results Container -->
        <div class="results-container">
            <div class="results-empty">
                <span class="codicon codicon-search"></span>
                <p>No results yet</p>
                <p class="hint">Click "Find Broken Elements" to scan the board</p>
            </div>
            <div class="results-list" style="display: none;"></div>
        </div>
    </div>

    <script nonce="${nonce}" src="${stringUtilsUri}"></script>
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }

    /**
     * Generate a nonce for CSP
     */
    private _getNonce(): string {
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }

    /**
     * Set a search query from an external command (e.g. [[#tag]] navigation).
     * If the webview is already visible, sends the query immediately.
     * Otherwise stores it as pending so it's sent on the next 'ready' message.
     */
    public setSearchQuery(query: string): void {
        this._pendingQuery = query;
        if (this._view?.webview) {
            this._view.webview.postMessage({ type: 'setSearchQuery', query });
            this._pendingQuery = null;
        }
    }

    /**
     * Refresh the search results (called externally when board changes)
     */
    public refresh(): void {
        this._updatePanelStatus();
    }
}
