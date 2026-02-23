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
import { BoardRegistryService } from './services/BoardRegistryService';
import { KanbanWebviewPanel } from './kanbanWebviewPanel';
import { MarkdownKanbanParser } from './markdownParser';
import { logger } from './utils/logger';
import { HIDDEN_TAGS } from '@ludos/shared';
import { KanbanCard, KanbanColumn } from './board/KanbanTypes';

/** Check if text contains any hidden tag (parked, deleted, archived) */
function isHiddenItem(text: string): boolean {
    return text.includes(HIDDEN_TAGS.PARKED)
        || text.includes(HIDDEN_TAGS.DELETED)
        || text.includes(HIDDEN_TAGS.ARCHIVED);
}

/** Extract the first visible line from a card for display in the column tree */
function extractCardFirstLine(card: KanbanCard): string {
    if (card.displayTitle) { return stripMarkdownHeading(card.displayTitle); }
    const content = card.content || '';
    const lines = content.split('\n');
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) { return stripMarkdownHeading(trimmed); }
    }
    return '(empty)';
}

/** Strip markdown heading prefix (# ## ### etc.) from a line */
function stripMarkdownHeading(text: string): string {
    return text.replace(/^#{1,6}\s+/, '');
}

/** Clean %INCLUDE_BADGE:filepath% placeholders from a column title for sidebar display */
function cleanColumnTitle(col: KanbanColumn): string {
    const title = col.displayTitle || col.title;
    // Replace %INCLUDE_BADGE:filepath% with just the filename (no extension)
    const cleaned = title.replace(/%INCLUDE_BADGE:([^%]+)%/g, (_match, filePath: string) => {
        return path.basename(filePath, path.extname(filePath));
    });
    return cleaned.trim() || path.basename(col.includeFiles?.[0] || '', '.md') || col.title;
}

/**
 * KanbanBoardsProvider - Boards management sidebar panel
 */
export class KanbanBoardsProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'kanbanBoardsSidebar';

    private _view?: vscode.WebviewView;
    private _extensionUri: vscode.Uri;
    private _registry: BoardRegistryService;
    private _disposables: vscode.Disposable[] = [];
    private _stateDebounceTimer: ReturnType<typeof setTimeout> | undefined;
    private _columnsExpandedBoards: Set<string> = new Set();

    constructor(extensionUri: vscode.Uri) {
        this._extensionUri = extensionUri;
        this._registry = BoardRegistryService.getInstance();

        // Subscribe to registry events
        this._disposables.push(
            this._registry.onBoardsChanged(() => this._sendStateToWebview()),
            KanbanWebviewPanel.onDidChangeActivePanel(() => this._sendStateToWebview()),
            vscode.window.onDidChangeActiveColorTheme(() => this._sendStateToWebview())
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
                        enabled: message.enabled,
                        calendarSharing: message.calendarSharing
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
                case 'setDefaultCalendarSharing':
                    await this._registry.setDefaultCalendarSharing(message.mode);
                    break;
                case 'addDefaultTagFilter':
                    await this._registry.addDefaultTagFilter(message.tag);
                    break;
                case 'removeDefaultTagFilter':
                    await this._registry.removeDefaultTagFilter(message.tag);
                    break;

                // Drop card onto board/column
                case 'dropCard':
                    await this._handleDropCard(message.filePath, message.content, message.columnIndex);
                    break;

                // Column tree expand state
                case 'setColumnsExpanded':
                    if (message.expanded) {
                        this._columnsExpandedBoards.add(message.filePath);
                    } else {
                        this._columnsExpandedBoards.delete(message.filePath);
                    }
                    this._sendStateToWebview();
                    break;

                // Board color
                case 'setBoardColor':
                    await this._handleSetBoardColor(message.filePath, message.color, message.settingKey || 'boardColor');
                    break;

                // Ready
                case 'ready':
                    this._sendStateToWebview();
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
     * Debounced state send - coalesces rapid updates (file watchers, panel switches)
     */
    private _sendStateToWebview(): void {
        if (this._stateDebounceTimer) { clearTimeout(this._stateDebounceTimer); }
        this._stateDebounceTimer = setTimeout(() => {
            this._stateDebounceTimer = undefined;
            this._doSendStateToWebview();
        }, 150);
    }

    /**
     * Send full state to the webview for rendering
     */
    private _doSendStateToWebview(): void {
        if (!this._view) { return; }

        const boards = this._registry.getBoards();
        const colorKeyRegex = /^(boardColor|boardColorDark|boardColorLight):\s*['"]?(#[0-9A-Fa-f]{3,8})['"]?\s*$/gm;
        const boardsData = boards.map(b => {
            let boardColor: string | undefined;
            let boardColorDark: string | undefined;
            let boardColorLight: string | undefined;
            let columns: { title: string; cardCount: number; cards: { title: string; checked: boolean }[]; includeMode?: boolean; includeFiles?: string[]; originalIndex: number }[] | undefined;
            try {
                const content = fs.readFileSync(b.filePath, 'utf8');
                const yamlMatch = content.match(/^---\n([\s\S]*?)\n---/);
                if (yamlMatch) {
                    let m;
                    colorKeyRegex.lastIndex = 0;
                    while ((m = colorKeyRegex.exec(yamlMatch[1])) !== null) {
                        if (m[1] === 'boardColor') { boardColor = m[2]; }
                        else if (m[1] === 'boardColorDark') { boardColorDark = m[2]; }
                        else if (m[1] === 'boardColorLight') { boardColorLight = m[2]; }
                    }
                }

                // Parse column tree data for expanded boards
                if (this._columnsExpandedBoards.has(b.filePath)) {
                    try {
                        const basePath = path.dirname(b.filePath);
                        const parseResult = MarkdownKanbanParser.parseMarkdown(content, basePath, undefined, b.filePath, true);
                        columns = parseResult.board.columns
                            .map((col: KanbanColumn, idx: number) => ({ col, originalIndex: idx }))
                            .filter(({ col }) => !isHiddenItem(col.title))
                            .map(({ col, originalIndex }) => {
                                const visibleCards = col.cards.filter((card: KanbanCard) => !isHiddenItem(card.content));
                                return {
                                    title: cleanColumnTitle(col),
                                    cardCount: visibleCards.length,
                                    cards: visibleCards.map((card: KanbanCard) => ({
                                        title: extractCardFirstLine(card),
                                        checked: !!card.checked
                                    })),
                                    includeMode: col.includeMode,
                                    includeFiles: col.includeFiles,
                                    originalIndex
                                };
                            });
                    } catch (parseErr) {
                        logger.error('[BoardsProvider] Error parsing board for column tree:', parseErr);
                    }
                }
            } catch { /* file unreadable, skip */ }
            return {
                filePath: b.filePath,
                uri: b.uri,
                name: path.basename(b.filePath, '.md'),
                config: b.config,
                boardColor,
                boardColorDark,
                boardColorLight,
                columns
            };
        });

        const activePanel = KanbanWebviewPanel.getActivePanel();
        const activeBoardUri = activePanel?.getCurrentDocumentUri()?.toString();

        const themeKind = vscode.window.activeColorTheme.kind;
        const isDark = themeKind === vscode.ColorThemeKind.Dark || themeKind === vscode.ColorThemeKind.HighContrast;

        this._view.webview.postMessage({
            type: 'state',
            boards: boardsData,
            locked: this._registry.locked,
            searches: this._registry.recentSearches,
            sortMode: this._registry.sortMode,
            defaultTimeframe: this._registry.defaultTimeframe,
            defaultTagFilters: this._registry.defaultTagFilters,
            defaultCalendarSharing: this._registry.defaultCalendarSharing,
            hasActivePanel: KanbanWebviewPanel.getAllPanels().length > 0,
            activeBoardUri,
            isDark
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

    private async _handleSetBoardColor(filePath: string, color: string, settingKey: string = 'boardColor'): Promise<void> {
        const validKeys = ['boardColor', 'boardColorDark', 'boardColorLight'];
        if (!validKeys.includes(settingKey)) { return; }
        try {
            const content = fs.readFileSync(filePath, 'utf8');
            const parseResult = MarkdownKanbanParser.parseMarkdown(content);
            const board = parseResult.board;
            if (!board.boardSettings) { board.boardSettings = {}; }
            if (color) {
                (board.boardSettings as any)[settingKey] = color;
            } else {
                // Set to empty string so updateYamlWithBoardSettings removes the line
                (board.boardSettings as any)[settingKey] = '';
            }
            const updatedYaml = MarkdownKanbanParser.updateYamlWithBoardSettings(board.yamlHeader, board.boardSettings);
            const updatedContent = content.replace(/^---[\s\S]*?---/, updatedYaml);
            fs.writeFileSync(filePath, updatedContent, 'utf8');
            this._sendStateToWebview();
        } catch (error) {
            logger.error('[BoardsProvider] Error setting board color:', error);
        }
    }

    private async _handleDropCard(filePath: string, content: string, columnIndex?: number): Promise<void> {
        if (!content || !filePath) { return; }
        try {
            const fileContent = fs.readFileSync(filePath, 'utf8');
            const basePath = path.dirname(filePath);
            const parseResult = MarkdownKanbanParser.parseMarkdown(fileContent, basePath, undefined, filePath, true);
            const board = parseResult.board;

            // Determine target column index
            let targetIdx: number;
            if (columnIndex !== undefined) {
                targetIdx = columnIndex;
            } else {
                // Board-level drop: first include-column, or first regular column as fallback
                const includeIdx = board.columns.findIndex((col: KanbanColumn) => col.includeMode && !isHiddenItem(col.title));
                targetIdx = includeIdx >= 0 ? includeIdx : board.columns.findIndex((col: KanbanColumn) => !isHiddenItem(col.title));
            }

            if (targetIdx < 0 || targetIdx >= board.columns.length) {
                logger.error('[BoardsProvider.dropCard] No valid target column found');
                return;
            }

            const targetCol = board.columns[targetIdx];

            if (targetCol.includeMode && targetCol.includeFiles && targetCol.includeFiles.length > 0) {
                // Include column: append slide to the include file
                const includeFilePath = targetCol.includeFiles[0];
                const includeContent = fs.readFileSync(includeFilePath, 'utf8');
                const appendContent = includeContent.trimEnd() + '\n\n---\n\n' + content + '\n';
                fs.writeFileSync(includeFilePath, appendContent, 'utf8');
            } else {
                // Regular column: add a new card and regenerate markdown
                const newCard: KanbanCard = {
                    id: 'drop-' + Date.now(),
                    content: content,
                    checked: false
                };
                targetCol.cards.push(newCard);
                const updatedMarkdown = MarkdownKanbanParser.generateMarkdown(board);
                fs.writeFileSync(filePath, updatedMarkdown, 'utf8');
            }
            this._sendStateToWebview();
        } catch (error) {
            logger.error('[BoardsProvider.dropCard] Error handling drop:', error);
        }
    }

    private async _handleOpenBoard(filePath: string): Promise<void> {
        try {
            const uri = vscode.Uri.file(filePath);
            const document = await vscode.workspace.openTextDocument(uri);
            KanbanWebviewPanel.createOrShow(this._extensionUri, this._getExtensionContext(), document);
        } catch (error) {
            logger.error('[BoardsProvider] Error opening board:', error);
        }
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
        const colorUtilsUri = webview.asWebviewUri(
            vscode.Uri.joinPath(assetRoot, 'utils', 'colorUtils.js')
        );
        const colorPickerUri = webview.asWebviewUri(
            vscode.Uri.joinPath(assetRoot, 'utils', 'colorPickerComponent.js')
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
        <!-- Boards Section -->
        <div class="boards-section">
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

    <script nonce="${nonce}" src="${stringUtilsUri}"></script>
    <script nonce="${nonce}" src="${colorUtilsUri}"></script>
    <script nonce="${nonce}" src="${colorPickerUri}"></script>
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
