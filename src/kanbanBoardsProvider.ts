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

/**
 * KanbanBoardsProvider - Boards management sidebar panel
 */
export class KanbanBoardsProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'kanbanBoardsSidebar';

    private _view?: vscode.WebviewView;
    private _extensionUri: vscode.Uri;
    private _registry: BoardRegistryService;
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
