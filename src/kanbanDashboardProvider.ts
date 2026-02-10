/**
 * KanbanDashboardProvider - WebviewViewProvider for the Dashboard sidebar panel
 *
 * Results-only panel showing:
 * - Upcoming items (tasks with temporal tags within configurable timeframe)
 * - Tagged items (tasks matching configured tag filters)
 * - Broken elements (missing files, images, includes)
 * - Pinned search results
 *
 * Board configuration is managed by BoardRegistryService + Boards Panel.
 * This panel subscribes to registry events and displays results only.
 *
 * @module kanbanDashboardProvider
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { KanbanWebviewPanel } from './kanbanWebviewPanel';
import { MarkdownKanbanParser } from './markdownParser';
import {
    DashboardData,
    UpcomingItem,
    BoardTagSummary,
    TagSearchResult,
    DashboardBrokenElement,
    DashboardSearchResult,
    DashboardSortMode,
    DashboardIncomingMessage
} from './dashboard/DashboardTypes';
import { DashboardScanner } from './dashboard/DashboardScanner';
import { BoardRegistryService } from './services/BoardRegistryService';
import { BoardContentScanner } from './services/BoardContentScanner';

/**
 * KanbanDashboardProvider - Sidebar panel for kanban dashboard (results only)
 */
export class KanbanDashboardProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'kanbanDashboard';

    private _view?: vscode.WebviewView;
    private _extensionUri: vscode.Uri;
    private _extensionContext: vscode.ExtensionContext;
    private _disposables: vscode.Disposable[] = [];

    constructor(extensionUri: vscode.Uri, context: vscode.ExtensionContext) {
        this._extensionUri = extensionUri;
        this._extensionContext = context;

        // Subscribe to BoardRegistryService events for auto-refresh
        const registry = BoardRegistryService.getInstance();

        this._disposables.push(
            registry.onBoardsChanged(() => {
                this._refreshData();
            })
        );

        this._disposables.push(
            registry.onSearchesChanged(() => {
                this._refreshData();
            })
        );

        this._disposables.push(
            registry.onSortModeChanged(() => {
                this._refreshData();
            })
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
        webviewView.webview.onDidReceiveMessage(async (message: DashboardIncomingMessage) => {
            switch (message.type) {
                case 'dashboardReady':
                    this._refreshData();
                    break;
                case 'dashboardRefresh':
                    this._refreshData();
                    break;
                case 'dashboardNavigate':
                    await this._handleNavigate(message.boardUri, message.columnIndex, message.taskIndex);
                    break;
                case 'dashboardTagSearch':
                    await this._handleTagSearch(message.tag);
                    break;
                case 'dashboardNavigateToElement':
                    await this._handleNavigateToElement(message.boardUri, message.columnId, message.taskId);
                    break;
                case 'dashboardSetSortMode':
                    await BoardRegistryService.getInstance().setSortMode(message.sortMode);
                    break;
                // Board config messages are now handled by Boards Panel via BoardRegistryService
                // Keep handlers for backward compat but route through registry
                case 'dashboardAddBoard':
                    await BoardRegistryService.getInstance().addBoard(vscode.Uri.parse(message.boardUri));
                    break;
                case 'dashboardRemoveBoard':
                    await BoardRegistryService.getInstance().removeBoardByUri(message.boardUri);
                    break;
                case 'dashboardUpdateConfig':
                    await BoardRegistryService.getInstance().updateBoardConfig(message.boardUri, {
                        timeframe: message.timeframe,
                        tagFilters: message.tagFilters,
                        enabled: message.enabled
                    });
                    break;
                case 'dashboardAddTagFilter':
                    await BoardRegistryService.getInstance().addTagFilter(message.boardUri, message.tag);
                    break;
                case 'dashboardRemoveTagFilter':
                    await BoardRegistryService.getInstance().removeTagFilter(message.boardUri, message.tag);
                    break;
            }
        });

        // Update when view becomes visible
        webviewView.onDidChangeVisibility(() => {
            if (webviewView.visible) {
                this._refreshData();
            }
        });
    }

    /**
     * Refresh dashboard data from BoardRegistryService
     */
    private async _refreshData(): Promise<void> {
        if (!this._view) return;

        const registry = BoardRegistryService.getInstance();
        const enabledBoards = registry.getEnabledBoards();
        const sortMode = registry.sortMode;

        const upcomingItems: UpcomingItem[] = [];
        const boardSummaries: BoardTagSummary[] = [];
        const taggedItems: TagSearchResult[] = [];
        const brokenElements: DashboardBrokenElement[] = [];
        const searchResults: DashboardSearchResult[] = [];

        for (const registeredBoard of enabledBoards) {
            try {
                const effectiveTimeframe = registry.getEffectiveTimeframe(registeredBoard);
                const result = await this._scanBoard(registeredBoard.uri, effectiveTimeframe);
                if (!result) continue;

                upcomingItems.push(...result.upcomingItems);
                boardSummaries.push(result.summary);

                // Collect items matching effective tag filters (default + per-board)
                const effectiveTagFilters = registry.getEffectiveTagFilters(registeredBoard);
                if (effectiveTagFilters.length > 0 && result.board) {
                    const boardName = path.basename(vscode.Uri.parse(registeredBoard.uri).fsPath, '.md');
                    for (const tagFilter of effectiveTagFilters) {
                        const matches = DashboardScanner.searchByTag(
                            result.board,
                            registeredBoard.uri,
                            boardName,
                            tagFilter
                        );
                        taggedItems.push(...matches);
                    }
                }

                // Scan for broken elements
                if (result.board) {
                    const boardUri = vscode.Uri.parse(registeredBoard.uri);
                    const basePath = path.dirname(boardUri.fsPath);
                    const scanner = new BoardContentScanner(basePath);
                    const broken = scanner.findBrokenElements(result.board);
                    const boardName = path.basename(boardUri.fsPath, '.md');

                    for (const elem of broken) {
                        brokenElements.push({
                            type: elem.type,
                            path: elem.path,
                            boardUri: registeredBoard.uri,
                            boardName,
                            columnTitle: elem.location.columnTitle,
                            taskSummary: elem.location.taskSummary,
                            columnId: elem.location.columnId,
                            taskId: elem.location.taskId
                        });
                    }
                }

            } catch (error) {
                console.error(`[Dashboard] Error scanning board ${registeredBoard.uri}:`, error);
            }
        }

        // Execute pinned searches across all enabled boards
        const pinnedSearches = registry.getPinnedSearches();
        for (const search of pinnedSearches) {
            for (const registeredBoard of enabledBoards) {
                try {
                    const boardUri = vscode.Uri.parse(registeredBoard.uri);
                    if (!fs.existsSync(boardUri.fsPath)) continue;

                    const content = fs.readFileSync(boardUri.fsPath, 'utf-8');
                    const basePath = path.dirname(boardUri.fsPath);
                    const parseResult = MarkdownKanbanParser.parseMarkdown(content, basePath, undefined, boardUri.fsPath);
                    if (!parseResult?.board) continue;

                    const scanner = new BoardContentScanner(basePath);
                    const matches = scanner.searchText(parseResult.board, search.query, {
                        useRegex: search.useRegex
                    });

                    const boardName = path.basename(boardUri.fsPath, '.md');
                    for (const match of matches) {
                        searchResults.push({
                            query: search.query,
                            pinned: true,
                            boardUri: registeredBoard.uri,
                            boardName,
                            matchText: match.matchText,
                            context: match.context,
                            columnTitle: match.location.columnTitle,
                            taskSummary: match.location.taskSummary,
                            columnId: match.location.columnId,
                            taskId: match.location.taskId
                        });
                    }
                } catch (error) {
                    console.error(`[Dashboard] Error executing pinned search "${search.query}" on ${registeredBoard.uri}:`, error);
                }
            }
        }

        // Sort upcoming items by date
        upcomingItems.sort((a, b) => {
            if (a.date && b.date) {
                return a.date.getTime() - b.date.getTime();
            }
            if (a.date) return -1;
            if (b.date) return 1;
            return 0;
        });

        // Remove duplicate tagged items (same task might match multiple tags)
        const uniqueTaggedItems = taggedItems.filter((item, index, self) =>
            index === self.findIndex(t =>
                t.boardUri === item.boardUri &&
                t.columnIndex === item.columnIndex &&
                t.taskIndex === item.taskIndex
            )
        );

        // Build config from registry for backward compat with existing webview code
        const allBoards = registry.getBoards();
        const config = {
            boards: allBoards.map(b => b.config),
            defaultTimeframe: 7 as 3 | 7 | 30
        };

        const data: DashboardData = {
            upcomingItems,
            boardSummaries,
            config,
            taggedItems: uniqueTaggedItems,
            brokenElements,
            searchResults,
            sortMode
        };

        this._view.webview.postMessage({
            type: 'dashboardData',
            data
        });
    }

    /**
     * Scan a single board for upcoming items and tags
     */
    private async _scanBoard(boardUri: string, timeframe: 3 | 7 | 30): Promise<{
        upcomingItems: UpcomingItem[];
        summary: BoardTagSummary;
        board: import('./markdownParser').KanbanBoard;
    } | null> {
        try {
            const uri = vscode.Uri.parse(boardUri);

            if (!fs.existsSync(uri.fsPath)) {
                return null;
            }

            const content = fs.readFileSync(uri.fsPath, 'utf-8');
            const basePath = path.dirname(uri.fsPath);
            const parseResult = MarkdownKanbanParser.parseMarkdown(content, basePath, undefined, uri.fsPath);

            if (!parseResult || !parseResult.board) {
                return null;
            }

            const board = parseResult.board;
            const boardName = path.basename(uri.fsPath, '.md');

            const scanResult = DashboardScanner.scanBoard(
                board,
                boardUri,
                boardName,
                timeframe
            );

            return {
                ...scanResult,
                board
            };
        } catch (error) {
            console.error(`[Dashboard] Error scanning board ${boardUri}:`, error);
            return null;
        }
    }

    /**
     * Handle navigation to a specific task
     */
    private async _handleNavigate(boardUri: string, columnIndex: number, taskIndex: number): Promise<void> {
        try {
            const uri = vscode.Uri.parse(boardUri);
            const document = await vscode.workspace.openTextDocument(uri);

            KanbanWebviewPanel.createOrShow(this._extensionUri, this._extensionContext, document);

            const panelKey = document.uri.toString();
            const panel = KanbanWebviewPanel.getPanelForDocument(panelKey);

            if (panel) {
                panel.scrollToElementByIndex(columnIndex, taskIndex, true);
            } else {
                console.error(`[Dashboard] Panel not found for document: ${panelKey}`);
            }
        } catch (error) {
            console.error(`[Dashboard] Error navigating to task:`, error);
        }
    }

    /**
     * Handle navigation to a specific element by column/task IDs
     */
    private async _handleNavigateToElement(boardUri: string, columnId: string, taskId?: string): Promise<void> {
        try {
            const uri = vscode.Uri.parse(boardUri);
            const document = await vscode.workspace.openTextDocument(uri);

            KanbanWebviewPanel.createOrShow(this._extensionUri, this._extensionContext, document);

            const panelKey = document.uri.toString();
            const panel = KanbanWebviewPanel.getPanelForDocument(panelKey);

            if (panel) {
                panel.scrollToElement(columnId, taskId, true);
            } else {
                console.error(`[Dashboard] Panel not found for document: ${panelKey}`);
            }
        } catch (error) {
            console.error(`[Dashboard] Error navigating to element:`, error);
        }
    }

    /**
     * Handle tag search request
     */
    private async _handleTagSearch(tag: string): Promise<void> {
        if (!this._view || !tag.trim()) return;

        const registry = BoardRegistryService.getInstance();
        const enabledBoards = registry.getEnabledBoards();
        const results: TagSearchResult[] = [];

        for (const registeredBoard of enabledBoards) {
            try {
                const uri = vscode.Uri.parse(registeredBoard.uri);
                if (!fs.existsSync(uri.fsPath)) continue;

                const content = fs.readFileSync(uri.fsPath, 'utf-8');
                const basePath = path.dirname(uri.fsPath);
                const parseResult = MarkdownKanbanParser.parseMarkdown(content, basePath, undefined, uri.fsPath);

                if (!parseResult?.board) continue;

                const boardName = path.basename(uri.fsPath, '.md');
                const boardResults = DashboardScanner.searchByTag(
                    parseResult.board,
                    registeredBoard.uri,
                    boardName,
                    tag
                );
                results.push(...boardResults);
            } catch (error) {
                console.error(`[Dashboard] Error searching board ${registeredBoard.uri}:`, error);
            }
        }

        this._view.webview.postMessage({
            type: 'dashboardTagSearchResults',
            tag,
            results
        });
    }

    /**
     * Generate HTML for the sidebar webview
     */
    private _getHtmlForWebview(webview: vscode.Webview): string {
        const nonce = this._getNonce();

        const codiconsUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'node_modules', '@vscode/codicons', 'dist', 'codicon.css')
        );

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource} https://microsoft.github.io; script-src 'nonce-${nonce}';">
    <link href="${codiconsUri}" rel="stylesheet" />
    <title>Kanban Dashboard</title>
    <style>
        /* ===========================================
           CSS Custom Properties
           =========================================== */
        :root {
            --dashboard-font-size: 13px;
            --dashboard-font-size-small: 0.9em;
            --dashboard-line-height: 1.3;
            --dashboard-row-height: 22px;
            --dashboard-row-height-2line: 36px;
            --dashboard-indent-width: 8px;
            --dashboard-twistie-width: 8px;
            --dashboard-twistie-width-collapsible: 16px;
        }

        /* ===========================================
           Base Styles
           =========================================== */
        body {
            padding: 0;
            font-family: var(--vscode-font-family);
            font-size: var(--dashboard-font-size);
            color: var(--vscode-foreground);
        }
        .dashboard-container {
            display: flex;
            flex-direction: column;
        }

        /* ===========================================
           Sort Mode Toggle
           =========================================== */
        .sort-mode-bar {
            display: flex;
            gap: 4px;
            padding: 4px 8px;
            border-bottom: 1px solid var(--vscode-panel-border, transparent);
        }
        .sort-mode-btn {
            flex: 1;
            height: 22px;
            padding: 0 6px;
            border: 1px solid var(--vscode-button-secondaryBackground);
            background: transparent;
            color: var(--vscode-foreground);
            border-radius: 2px;
            cursor: pointer;
            font-size: 11px;
            opacity: 0.7;
        }
        .sort-mode-btn:hover {
            opacity: 1;
            background: var(--vscode-list-hoverBackground);
        }
        .sort-mode-btn.active {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border-color: var(--vscode-button-background);
            opacity: 1;
        }

        /* ===========================================
           Tree Structure
           =========================================== */
        .tree-row {
            display: flex;
            align-items: center;
            min-height: var(--dashboard-row-height);
            line-height: var(--dashboard-line-height);
            cursor: pointer;
            box-sizing: border-box;
            overflow: hidden;
            width: 100%;
            position: relative;
        }
        .tree-row:hover {
            background: var(--vscode-list-hoverBackground);
        }
        .tree-row:has(.tree-label-2line) {
            min-height: var(--dashboard-row-height-2line);
        }
        .tree-row:has(.tree-label-2line) .tree-contents {
            padding: 2px 0;
        }

        /* Indent guides */
        .tree-indent {
            display: flex;
            flex-shrink: 0;
            align-self: stretch;
        }
        .indent-guide {
            width: var(--dashboard-indent-width);
            box-sizing: border-box;
            border-right: 1px solid var(--vscode-tree-indentGuidesStroke, rgba(128, 128, 128, 0.4));
        }

        /* Twistie (expand/collapse icon) */
        .tree-twistie {
            width: var(--dashboard-twistie-width);
            display: flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
        }
        .tree-twistie.collapsible {
            width: var(--dashboard-twistie-width-collapsible);
        }
        .tree-twistie.collapsible::before {
            font-family: codicon;
            content: '\\eab6';
            font-size: 16px;
            color: var(--vscode-foreground);
            opacity: 0.8;
            transition: transform 0.1s ease-out;
        }
        .tree-twistie.collapsible.expanded::before {
            transform: rotate(90deg);
        }

        /* Tree contents */
        .tree-contents {
            flex: 1;
            overflow: hidden;
            min-height: var(--dashboard-row-height);
            display: flex;
            flex-direction: column;
            justify-content: center;
        }

        /* ===========================================
           Labels & Text
           =========================================== */
        .tree-label {
            display: flex;
            align-items: baseline;
            overflow: hidden;
            text-overflow: ellipsis;
            width: 100%;
        }
        .tree-label-name {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            flex-shrink: 1;
        }
        .tree-label-description {
            opacity: 0.6;
            margin-left: 0.5em;
            font-size: var(--dashboard-font-size-small);
            white-space: nowrap;
            flex-shrink: 0;
        }

        /* Two-line entry layout */
        .tree-label-2line {
            display: flex;
            flex-direction: column;
            overflow: hidden;
            width: 100%;
            line-height: var(--dashboard-line-height);
        }
        .tree-label-2line .entry-title {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .tree-label-2line .entry-location {
            opacity: 0.6;
            font-size: var(--dashboard-font-size-small);
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        /* Column match indicator */
        .column-match .tree-label-name {
            font-style: italic;
        }

        /* Overdue styling */
        .overdue .entry-title {
            color: var(--vscode-errorForeground);
        }
        .overdue .entry-location {
            color: var(--vscode-errorForeground);
            opacity: 0.8;
        }

        /* ===========================================
           Sections
           =========================================== */
        .section {
            overflow: hidden;
        }
        .section-header {
            padding-left: 4px;
        }
        .section-header h3 {
            margin: 0;
            font-size: var(--dashboard-font-size);
            font-weight: normal;
            color: var(--vscode-foreground);
        }
        .section-content {
            display: block;
            padding-left: 4px;
        }
        .section-content.collapsed {
            display: none;
        }

        /* Tree group for foldable sections */
        .tree-group-items {
            /* Container for child items */
        }

        /* ===========================================
           Tags & Badges
           =========================================== */
        .tag-cloud {
            display: flex;
            flex-wrap: wrap;
            gap: 4px;
        }
        .tag-item {
            padding: 2px 6px;
            background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            border-radius: 10px;
        }
        .tag-item.person {
            background: var(--vscode-terminal-ansiCyan);
        }
        .tag-item.temporal {
            background: var(--vscode-terminal-ansiYellow);
            color: var(--vscode-editor-foreground);
        }

        /* ===========================================
           Buttons
           =========================================== */
        .refresh-btn {
            background: none;
            border: none;
            cursor: pointer;
            padding: 2px 4px;
            color: var(--vscode-foreground);
            padding: 4px;
        }
        .refresh-btn:hover {
            background: var(--vscode-list-hoverBackground);
        }

        /* ===========================================
           Broken elements
           =========================================== */
        .broken-icon {
            color: var(--vscode-errorForeground);
            margin-right: 4px;
            flex-shrink: 0;
        }

        /* ===========================================
           Search results highlight
           =========================================== */
        .search-match-context {
            font-size: var(--dashboard-font-size-small);
            opacity: 0.7;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        /* ===========================================
           Messages & Hints
           =========================================== */
        .empty-message {
            text-align: left;
            padding: 2px 0px 2px 32px;
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
        }
    </style>
</head>
<body>
    <div class="dashboard-container">
        <!-- Sort Mode Toggle -->
        <div class="sort-mode-bar">
            <button class="sort-mode-btn active" data-mode="boardFirst">Board First</button>
            <button class="sort-mode-btn" data-mode="merged">Merged</button>
            <button class="refresh-btn" id="refresh-btn" title="Refresh">↻</button>
        </div>

        <!-- Pinned Search Results Section -->
        <div class="section">
            <div class="tree-row section-header" data-section="search">
                <div class="tree-indent"><div class="indent-guide"></div></div>
                <div class="tree-twistie collapsible expanded"></div>
                <div class="tree-contents">
                    <h3>Search Results</h3>
                </div>
            </div>
            <div class="section-content" id="search-content">
                <div class="empty-message" id="search-empty">No pinned searches</div>
                <div id="search-list"></div>
            </div>
        </div>

        <!-- Upcoming Items Section -->
        <div class="section">
            <div class="tree-row section-header" data-section="upcoming">
                <div class="tree-indent"><div class="indent-guide"></div></div>
                <div class="tree-twistie collapsible expanded"></div>
                <div class="tree-contents">
                    <h3>Upcoming</h3>
                </div>
            </div>
            <div class="section-content" id="upcoming-content">
                <div class="empty-message" id="upcoming-empty">No upcoming items</div>
                <div id="upcoming-list"></div>
            </div>
        </div>

        <!-- Tagged Items Section -->
        <div class="section">
            <div class="tree-row section-header" data-section="tagged">
                <div class="tree-indent"><div class="indent-guide"></div></div>
                <div class="tree-twistie collapsible expanded"></div>
                <div class="tree-contents">
                    <h3>Tagged Items</h3>
                </div>
            </div>
            <div class="section-content" id="tagged-content">
                <div class="empty-message" id="tagged-empty">No tag filters configured</div>
                <div id="tagged-list"></div>
            </div>
        </div>

        <!-- Broken Elements Section -->
        <div class="section">
            <div class="tree-row section-header" data-section="broken">
                <div class="tree-indent"><div class="indent-guide"></div></div>
                <div class="tree-twistie collapsible expanded"></div>
                <div class="tree-contents">
                    <h3>Broken Elements</h3>
                </div>
            </div>
            <div class="section-content" id="broken-content">
                <div class="empty-message" id="broken-empty">No broken elements</div>
                <div id="broken-list"></div>
            </div>
        </div>

        <!-- Hidden datalist for tag suggestions -->
        <datalist id="tag-suggestions"></datalist>
    </div>

    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        let dashboardData = null;

        // Fold state tracking - persists across re-renders
        const collapsedGroups = new Set();

        function groupExpandedClass(key) {
            return collapsedGroups.has(key) ? '' : ' expanded';
        }

        function groupItemsStyle(key) {
            return collapsedGroups.has(key) ? ' style="display: none"' : '';
        }

        // Initialize
        document.addEventListener('DOMContentLoaded', () => {
            // Setup section toggle handlers
            document.querySelectorAll('.section-header[data-section]').forEach(header => {
                header.addEventListener('click', (e) => {
                    if (e.target.closest('button')) return;
                    const sectionId = header.getAttribute('data-section');
                    toggleSection(sectionId);
                });
            });

            // Setup refresh button
            document.getElementById('refresh-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                refresh();
            });

            // Setup sort mode buttons
            document.querySelectorAll('.sort-mode-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const mode = btn.getAttribute('data-mode');
                    setSortMode(mode);
                });
            });

            vscode.postMessage({ type: 'dashboardReady' });
        });

        // Handle messages from backend
        window.addEventListener('message', event => {
            const message = event.data;
            if (message.type === 'dashboardData') {
                dashboardData = message.data;
                renderDashboard();
            }
        });

        function renderDashboard() {
            if (!dashboardData) return;
            updateSortModeButtons();
            renderUpcomingItems();
            renderTaggedItems();
            renderBrokenElements();
            renderSearchResults();
            populateTagSuggestions();
        }

        function updateSortModeButtons() {
            const mode = dashboardData.sortMode || 'boardFirst';
            document.querySelectorAll('.sort-mode-btn').forEach(btn => {
                btn.classList.toggle('active', btn.getAttribute('data-mode') === mode);
            });
        }

        function renderUpcomingItems() {
            const container = document.getElementById('upcoming-list');
            const emptyMsg = document.getElementById('upcoming-empty');
            const items = dashboardData.upcomingItems || [];

            if (items.length === 0) {
                container.innerHTML = '';
                emptyMsg.style.display = 'block';
                return;
            }

            emptyMsg.style.display = 'none';
            const sortMode = dashboardData.sortMode || 'boardFirst';

            if (sortMode === 'boardFirst') {
                renderUpcomingBoardFirst(container, items);
            } else {
                renderUpcomingMerged(container, items);
            }
        }

        function renderUpcomingBoardFirst(container, items) {
            // Group by board, then by date within each board
            const boards = {};
            items.forEach(item => {
                if (!boards[item.boardName]) boards[item.boardName] = [];
                boards[item.boardName].push(item);
            });

            let html = '';
            for (const [boardName, boardItems] of Object.entries(boards)) {
                const boardKey = 'upcoming/board/' + boardName;
                html += '<div class="tree-group">';
                html += '<div class="tree-row tree-group-toggle" data-group-key="' + escapeHtml(boardKey) + '">';
                html += '<div class="tree-indent"><div class="indent-guide"></div><div class="indent-guide"></div></div>';
                html += '<div class="tree-twistie collapsible' + groupExpandedClass(boardKey) + '"></div>';
                html += '<div class="tree-contents"><span class="tree-label-name">' + escapeHtml(boardName) + ' (' + boardItems.length + ')</span></div>';
                html += '</div>';
                html += '<div class="tree-group-items"' + groupItemsStyle(boardKey) + '>';

                // Group by date within board
                const dateGroups = {};
                boardItems.forEach(item => {
                    const dateKey = item.date ? formatDate(new Date(item.date), item.week, item.year, item.weekday) : 'No Date';
                    if (!dateGroups[dateKey]) dateGroups[dateKey] = [];
                    dateGroups[dateKey].push(item);
                });

                for (const [date, dateItems] of Object.entries(dateGroups)) {
                    const dateGroupKey = boardKey + '/' + date;
                    html += '<div class="tree-group">';
                    html += '<div class="tree-row tree-group-toggle" data-group-key="' + escapeHtml(dateGroupKey) + '">';
                    html += '<div class="tree-indent"><div class="indent-guide"></div><div class="indent-guide"></div><div class="indent-guide"></div></div>';
                    html += '<div class="tree-twistie collapsible' + groupExpandedClass(dateGroupKey) + '"></div>';
                    html += '<div class="tree-contents"><span class="tree-label-name">' + escapeHtml(date) + '</span></div>';
                    html += '</div>';
                    html += '<div class="tree-group-items"' + groupItemsStyle(dateGroupKey) + '>';
                    dateItems.forEach(item => {
                        html += renderUpcomingItem(item, 4);
                    });
                    html += '</div></div>';
                }

                html += '</div></div>';
            }

            container.innerHTML = html;
            attachUpcomingListeners(container);
        }

        function renderUpcomingMerged(container, items) {
            // Group by date only (merged across boards)
            const groups = {};
            items.forEach(item => {
                const dateKey = item.date ? formatDate(new Date(item.date), item.week, item.year, item.weekday) : 'No Date';
                if (!groups[dateKey]) groups[dateKey] = [];
                groups[dateKey].push(item);
            });

            let html = '';
            for (const [date, groupItems] of Object.entries(groups)) {
                const gKey = 'upcoming/date/' + date;
                html += '<div class="tree-group">';
                html += '<div class="tree-row date-group-header tree-group-toggle" data-group-key="' + escapeHtml(gKey) + '">';
                html += '<div class="tree-indent"><div class="indent-guide"></div><div class="indent-guide"></div></div>';
                html += '<div class="tree-twistie collapsible' + groupExpandedClass(gKey) + '"></div>';
                html += '<div class="tree-contents"><span class="tree-label-name">' + escapeHtml(date) + '</span></div>';
                html += '</div>';
                html += '<div class="tree-group-items"' + groupItemsStyle(gKey) + '>';
                groupItems.forEach(item => {
                    html += renderUpcomingItem(item, 3);
                });
                html += '</div></div>';
            }

            container.innerHTML = html;
            attachUpcomingListeners(container);
        }

        function renderUpcomingItem(item, indentLevel) {
            const overdueClass = item.isOverdue ? ' overdue' : '';
            let html = '<div class="tree-row upcoming-item' + overdueClass + '" data-board-uri="' + escapeHtml(item.boardUri) + '" ';
            html += 'data-column-index="' + item.columnIndex + '" data-task-index="' + item.taskIndex + '">';
            html += '<div class="tree-indent">';
            for (let i = 0; i < indentLevel; i++) html += '<div class="indent-guide"></div>';
            html += '</div>';
            html += '<div class="tree-twistie"></div>';
            html += '<div class="tree-contents"><div class="tree-label-2line">';
            html += '<span class="entry-title">' + escapeHtml(item.taskSummary) + '</span>';
            html += '<span class="entry-location">' + escapeHtml(item.boardName) + ' / ' + escapeHtml(item.columnTitle) + '</span>';
            html += '</div></div>';
            html += '</div>';
            return html;
        }

        function attachUpcomingListeners(container) {
            container.querySelectorAll('.upcoming-item').forEach(item => {
                item.addEventListener('click', () => {
                    const boardUri = item.getAttribute('data-board-uri');
                    const columnIndex = parseInt(item.getAttribute('data-column-index'), 10);
                    const taskIndex = parseInt(item.getAttribute('data-task-index'), 10);
                    navigateToTask(boardUri, columnIndex, taskIndex);
                });
            });
            attachToggleListeners(container);
        }

        function populateTagSuggestions() {
            const datalist = document.getElementById('tag-suggestions');
            const summaries = dashboardData.boardSummaries || [];

            const allTags = new Map();
            summaries.forEach(summary => {
                (summary.tags || []).forEach(tag => {
                    if (tag.type === 'temporal') return;
                    if (!allTags.has(tag.name)) {
                        allTags.set(tag.name, tag);
                    } else {
                        allTags.get(tag.name).count += tag.count;
                    }
                });
            });

            const sortedTags = Array.from(allTags.values()).sort((a, b) => b.count - a.count);
            datalist.innerHTML = sortedTags.map(tag =>
                '<option value="' + escapeHtml(tag.name) + '">' + escapeHtml(tag.name) + ' (' + tag.count + ')</option>'
            ).join('');
        }

        function renderTaggedItems() {
            const section = document.querySelector('[data-section="tagged"]')?.closest('.section');
            const container = document.getElementById('tagged-list');
            const emptyMsg = document.getElementById('tagged-empty');
            const items = dashboardData.taggedItems || [];

            if (items.length === 0) {
                container.innerHTML = '';
                emptyMsg.textContent = 'No tag filters configured';
                emptyMsg.style.display = 'block';
                if (section) section.style.display = 'block';
                return;
            }

            if (section) section.style.display = 'block';
            emptyMsg.style.display = 'none';
            const sortMode = dashboardData.sortMode || 'boardFirst';

            if (sortMode === 'boardFirst') {
                renderTaggedBoardFirst(container, items);
            } else {
                renderTaggedMerged(container, items);
            }
        }

        function renderTaggedBoardFirst(container, items) {
            // Group by board, then by tag
            const boards = {};
            items.forEach(item => {
                if (!boards[item.boardName]) boards[item.boardName] = {};
                const tagKey = item.matchedTag || 'Other';
                if (!boards[item.boardName][tagKey]) boards[item.boardName][tagKey] = [];
                boards[item.boardName][tagKey].push(item);
            });

            let html = '';
            for (const [boardName, tagGroups] of Object.entries(boards)) {
                const boardKey = 'tagged/board/' + boardName;
                html += '<div class="tree-group">';
                html += '<div class="tree-row tree-group-toggle" data-group-key="' + escapeHtml(boardKey) + '">';
                html += '<div class="tree-indent"><div class="indent-guide"></div><div class="indent-guide"></div></div>';
                html += '<div class="tree-twistie collapsible' + groupExpandedClass(boardKey) + '"></div>';
                html += '<div class="tree-contents"><span class="tree-label-name">' + escapeHtml(boardName) + '</span></div>';
                html += '</div>';
                html += '<div class="tree-group-items"' + groupItemsStyle(boardKey) + '>';

                for (const [tag, tagItems] of Object.entries(tagGroups)) {
                    const tagGroupKey = boardKey + '/' + tag;
                    html += '<div class="tree-group">';
                    html += '<div class="tree-row tree-group-toggle" data-group-key="' + escapeHtml(tagGroupKey) + '">';
                    html += '<div class="tree-indent"><div class="indent-guide"></div><div class="indent-guide"></div><div class="indent-guide"></div></div>';
                    html += '<div class="tree-twistie collapsible' + groupExpandedClass(tagGroupKey) + '"></div>';
                    html += '<div class="tree-contents"><span class="tree-label-name">' + escapeHtml(tag) + ' (' + tagItems.length + ')</span></div>';
                    html += '</div>';
                    html += '<div class="tree-group-items"' + groupItemsStyle(tagGroupKey) + '>';
                    tagItems.forEach(item => {
                        html += renderTaggedItem(item, 4);
                    });
                    html += '</div></div>';
                }

                html += '</div></div>';
            }

            container.innerHTML = html;
            attachTaggedListeners(container);
        }

        function renderTaggedMerged(container, items) {
            // Group by tag only
            const groups = {};
            items.forEach(item => {
                const tagKey = item.matchedTag || 'Other';
                if (!groups[tagKey]) groups[tagKey] = [];
                groups[tagKey].push(item);
            });

            let html = '';
            for (const [tag, groupItems] of Object.entries(groups)) {
                const gKey = 'tagged/tag/' + tag;
                html += '<div class="tree-group">';
                html += '<div class="tree-row tree-group-toggle" data-group-key="' + escapeHtml(gKey) + '">';
                html += '<div class="tree-indent"><div class="indent-guide"></div><div class="indent-guide"></div></div>';
                html += '<div class="tree-twistie collapsible' + groupExpandedClass(gKey) + '"></div>';
                html += '<div class="tree-contents"><span class="tree-label-name">' + escapeHtml(tag) + ' (' + groupItems.length + ')</span></div>';
                html += '</div>';
                html += '<div class="tree-group-items"' + groupItemsStyle(gKey) + '>';
                groupItems.forEach(item => {
                    html += renderTaggedItem(item, 3);
                });
                html += '</div></div>';
            }

            container.innerHTML = html;
            attachTaggedListeners(container);
        }

        function renderTaggedItem(item, indentLevel) {
            const isColumnMatch = item.taskIndex === -1;
            let html = '<div class="tree-row tag-search-result' + (isColumnMatch ? ' column-match' : '') + '" data-board-uri="' + escapeHtml(item.boardUri) + '" ';
            html += 'data-column-index="' + item.columnIndex + '" data-task-index="' + item.taskIndex + '">';
            html += '<div class="tree-indent">';
            for (let i = 0; i < indentLevel; i++) html += '<div class="indent-guide"></div>';
            html += '</div>';
            html += '<div class="tree-twistie"></div>';
            html += '<div class="tree-contents"><div class="tree-label-2line">';
            if (isColumnMatch) {
                html += '<span class="entry-title">[Col] ' + escapeHtml(item.columnTitle) + '</span>';
            } else {
                html += '<span class="entry-title">' + escapeHtml(item.taskSummary) + '</span>';
            }
            html += '<span class="entry-location">' + escapeHtml(item.boardName) + ' / ' + escapeHtml(item.columnTitle) + '</span>';
            html += '</div></div>';
            html += '</div>';
            return html;
        }

        function attachTaggedListeners(container) {
            container.querySelectorAll('.tag-search-result').forEach(item => {
                item.addEventListener('click', () => {
                    const boardUri = item.getAttribute('data-board-uri');
                    const columnIndex = parseInt(item.getAttribute('data-column-index'), 10);
                    const taskIndex = parseInt(item.getAttribute('data-task-index'), 10);
                    navigateToTask(boardUri, columnIndex, taskIndex);
                });
            });
            attachToggleListeners(container);
        }

        function renderBrokenElements() {
            const section = document.querySelector('[data-section="broken"]')?.closest('.section');
            const container = document.getElementById('broken-list');
            const emptyMsg = document.getElementById('broken-empty');
            const items = dashboardData.brokenElements || [];

            if (items.length === 0) {
                container.innerHTML = '';
                emptyMsg.style.display = 'block';
                if (section) section.style.display = 'block';
                return;
            }

            emptyMsg.style.display = 'none';
            const sortMode = dashboardData.sortMode || 'boardFirst';

            if (sortMode === 'boardFirst') {
                renderBrokenBoardFirst(container, items);
            } else {
                renderBrokenMerged(container, items);
            }
        }

        function renderBrokenBoardFirst(container, items) {
            const boards = {};
            items.forEach(item => {
                if (!boards[item.boardName]) boards[item.boardName] = [];
                boards[item.boardName].push(item);
            });

            let html = '';
            for (const [boardName, boardItems] of Object.entries(boards)) {
                const boardKey = 'broken/board/' + boardName;
                html += '<div class="tree-group">';
                html += '<div class="tree-row tree-group-toggle" data-group-key="' + escapeHtml(boardKey) + '">';
                html += '<div class="tree-indent"><div class="indent-guide"></div><div class="indent-guide"></div></div>';
                html += '<div class="tree-twistie collapsible' + groupExpandedClass(boardKey) + '"></div>';
                html += '<div class="tree-contents"><span class="tree-label-name">' + escapeHtml(boardName) + ' (' + boardItems.length + ')</span></div>';
                html += '</div>';
                html += '<div class="tree-group-items"' + groupItemsStyle(boardKey) + '>';
                boardItems.forEach(item => {
                    html += renderBrokenItem(item, 3);
                });
                html += '</div></div>';
            }

            container.innerHTML = html;
            attachBrokenListeners(container);
        }

        function renderBrokenMerged(container, items) {
            // Group by type
            const groups = {};
            items.forEach(item => {
                if (!groups[item.type]) groups[item.type] = [];
                groups[item.type].push(item);
            });

            let html = '';
            for (const [type, groupItems] of Object.entries(groups)) {
                const gKey = 'broken/type/' + type;
                html += '<div class="tree-group">';
                html += '<div class="tree-row tree-group-toggle" data-group-key="' + escapeHtml(gKey) + '">';
                html += '<div class="tree-indent"><div class="indent-guide"></div><div class="indent-guide"></div></div>';
                html += '<div class="tree-twistie collapsible' + groupExpandedClass(gKey) + '"></div>';
                html += '<div class="tree-contents"><span class="tree-label-name">' + escapeHtml(type) + ' (' + groupItems.length + ')</span></div>';
                html += '</div>';
                html += '<div class="tree-group-items"' + groupItemsStyle(gKey) + '>';
                groupItems.forEach(item => {
                    html += renderBrokenItem(item, 3);
                });
                html += '</div></div>';
            }

            container.innerHTML = html;
            attachBrokenListeners(container);
        }

        function renderBrokenItem(item, indentLevel) {
            let html = '<div class="tree-row broken-item" data-board-uri="' + escapeHtml(item.boardUri) + '" ';
            html += 'data-column-id="' + escapeHtml(item.columnId) + '"';
            if (item.taskId) html += ' data-task-id="' + escapeHtml(item.taskId) + '"';
            html += '>';
            html += '<div class="tree-indent">';
            for (let i = 0; i < indentLevel; i++) html += '<div class="indent-guide"></div>';
            html += '</div>';
            html += '<div class="tree-twistie"></div>';
            html += '<div class="tree-contents"><div class="tree-label-2line">';
            html += '<span class="entry-title"><span class="broken-icon">⚠</span>' + escapeHtml(item.type) + ': ' + escapeHtml(item.path) + '</span>';
            html += '<span class="entry-location">' + escapeHtml(item.boardName) + ' / ' + escapeHtml(item.columnTitle);
            if (item.taskSummary) html += ' / ' + escapeHtml(item.taskSummary);
            html += '</span>';
            html += '</div></div>';
            html += '</div>';
            return html;
        }

        function attachBrokenListeners(container) {
            container.querySelectorAll('.broken-item').forEach(item => {
                item.addEventListener('click', () => {
                    const boardUri = item.getAttribute('data-board-uri');
                    const columnId = item.getAttribute('data-column-id');
                    const taskId = item.getAttribute('data-task-id') || undefined;
                    navigateToElement(boardUri, columnId, taskId);
                });
            });
            attachToggleListeners(container);
        }

        function renderSearchResults() {
            const section = document.querySelector('[data-section="search"]')?.closest('.section');
            const container = document.getElementById('search-list');
            const emptyMsg = document.getElementById('search-empty');
            const items = dashboardData.searchResults || [];

            if (items.length === 0) {
                container.innerHTML = '';
                emptyMsg.style.display = 'block';
                return;
            }

            emptyMsg.style.display = 'none';

            // Group by query
            const queries = {};
            items.forEach(item => {
                if (!queries[item.query]) queries[item.query] = [];
                queries[item.query].push(item);
            });

            const sortMode = dashboardData.sortMode || 'boardFirst';
            let html = '';

            for (const [query, queryItems] of Object.entries(queries)) {
                const queryKey = 'search/query/' + query;
                html += '<div class="tree-group">';
                html += '<div class="tree-row tree-group-toggle" data-group-key="' + escapeHtml(queryKey) + '">';
                html += '<div class="tree-indent"><div class="indent-guide"></div><div class="indent-guide"></div></div>';
                html += '<div class="tree-twistie collapsible' + groupExpandedClass(queryKey) + '"></div>';
                html += '<div class="tree-contents"><span class="tree-label-name">"' + escapeHtml(query) + '" (' + queryItems.length + ')</span></div>';
                html += '</div>';
                html += '<div class="tree-group-items"' + groupItemsStyle(queryKey) + '>';

                if (sortMode === 'boardFirst') {
                    // Sub-group by board
                    const boards = {};
                    queryItems.forEach(item => {
                        if (!boards[item.boardName]) boards[item.boardName] = [];
                        boards[item.boardName].push(item);
                    });

                    for (const [boardName, boardItems] of Object.entries(boards)) {
                        const boardKey = queryKey + '/board/' + boardName;
                        html += '<div class="tree-group">';
                        html += '<div class="tree-row tree-group-toggle" data-group-key="' + escapeHtml(boardKey) + '">';
                        html += '<div class="tree-indent"><div class="indent-guide"></div><div class="indent-guide"></div><div class="indent-guide"></div></div>';
                        html += '<div class="tree-twistie collapsible' + groupExpandedClass(boardKey) + '"></div>';
                        html += '<div class="tree-contents"><span class="tree-label-name">' + escapeHtml(boardName) + ' (' + boardItems.length + ')</span></div>';
                        html += '</div>';
                        html += '<div class="tree-group-items"' + groupItemsStyle(boardKey) + '>';
                        boardItems.forEach(item => {
                            html += renderSearchItem(item, 4);
                        });
                        html += '</div></div>';
                    }
                } else {
                    queryItems.forEach(item => {
                        html += renderSearchItem(item, 3);
                    });
                }

                html += '</div></div>';
            }

            container.innerHTML = html;
            attachSearchListeners(container);
        }

        function renderSearchItem(item, indentLevel) {
            let html = '<div class="tree-row search-result-item" data-board-uri="' + escapeHtml(item.boardUri) + '" ';
            html += 'data-column-id="' + escapeHtml(item.columnId) + '"';
            if (item.taskId) html += ' data-task-id="' + escapeHtml(item.taskId) + '"';
            html += '>';
            html += '<div class="tree-indent">';
            for (let i = 0; i < indentLevel; i++) html += '<div class="indent-guide"></div>';
            html += '</div>';
            html += '<div class="tree-twistie"></div>';
            html += '<div class="tree-contents"><div class="tree-label-2line">';
            html += '<span class="entry-title">' + escapeHtml(item.taskSummary || item.columnTitle) + '</span>';
            html += '<span class="entry-location">' + escapeHtml(item.boardName) + ' / ' + escapeHtml(item.columnTitle) + '</span>';
            html += '</div></div>';
            html += '</div>';
            return html;
        }

        function attachSearchListeners(container) {
            container.querySelectorAll('.search-result-item').forEach(item => {
                item.addEventListener('click', () => {
                    const boardUri = item.getAttribute('data-board-uri');
                    const columnId = item.getAttribute('data-column-id');
                    const taskId = item.getAttribute('data-task-id') || undefined;
                    navigateToElement(boardUri, columnId, taskId);
                });
            });
            attachToggleListeners(container);
        }

        // Shared toggle listener for tree groups
        function attachToggleListeners(container) {
            container.querySelectorAll('.tree-group-toggle').forEach(toggle => {
                // Avoid double-binding by checking for marker
                if (toggle._toggleBound) return;
                toggle._toggleBound = true;
                toggle.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const group = toggle.closest('.tree-group');
                    const twistie = toggle.querySelector('.tree-twistie');
                    const items = group.querySelector('.tree-group-items');
                    const groupKey = toggle.getAttribute('data-group-key');
                    if (twistie.classList.contains('expanded')) {
                        twistie.classList.remove('expanded');
                        items.style.display = 'none';
                        if (groupKey) collapsedGroups.add(groupKey);
                    } else {
                        twistie.classList.add('expanded');
                        items.style.display = 'block';
                        if (groupKey) collapsedGroups.delete(groupKey);
                    }
                });
            });
        }

        function toggleSection(sectionId) {
            const header = document.querySelector('.section-header[data-section="' + sectionId + '"]');
            const twistie = header.querySelector('.tree-twistie');
            const content = document.getElementById(sectionId + '-content');
            twistie.classList.toggle('expanded');
            content.classList.toggle('collapsed');
        }

        function refresh() {
            vscode.postMessage({ type: 'dashboardRefresh' });
        }

        function setSortMode(mode) {
            vscode.postMessage({ type: 'dashboardSetSortMode', sortMode: mode });
        }

        function navigateToTask(boardUri, columnIndex, taskIndex) {
            vscode.postMessage({
                type: 'dashboardNavigate',
                boardUri,
                columnIndex,
                taskIndex
            });
        }

        function navigateToElement(boardUri, columnId, taskId) {
            vscode.postMessage({
                type: 'dashboardNavigateToElement',
                boardUri,
                columnId,
                taskId
            });
        }

        function formatDate(date, week, year, weekday) {
            const weekdayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

            if (week !== undefined && week !== null) {
                const currentYear = new Date().getFullYear();
                let result = 'KW ' + week;
                if (year && year !== currentYear) {
                    result += ' ' + year;
                }
                if (weekday !== undefined && weekday !== null) {
                    result += ' ' + weekdayNames[weekday];
                }
                return result;
            }

            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const d = new Date(date);
            d.setHours(0, 0, 0, 0);

            const diff = Math.floor((d - today) / (1000 * 60 * 60 * 24));

            if (diff === 0) return 'Today';
            if (diff === 1) return 'Tomorrow';
            if (diff < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
            return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
        }

        function escapeHtml(text) {
            if (!text) return '';
            return text
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        }
    </script>
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
     * Dispose of resources
     */
    public dispose(): void {
        for (const d of this._disposables) {
            d.dispose();
        }
        this._disposables = [];
    }
}
