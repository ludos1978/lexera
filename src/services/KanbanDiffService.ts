/**
 * Kanban Diff Service
 *
 * Provides VS Code's native diff view for comparing kanban buffer content
 * with disk content. The kanban buffer (left side) is editable and syncs
 * back to the file registry.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { MarkdownFileRegistry } from '../files/MarkdownFileRegistry';

/**
 * Tracks active diff sessions and manages their lifecycle
 */
interface DiffSession {
    filePath: string;
    kanbanDocUri: vscode.Uri;
    diskUri: vscode.Uri;
    tempFilePath?: string;  // Temp file for kanban content
    disposables: vscode.Disposable[];
}

/**
 * Callback type for diff closed notification
 */
export type DiffClosedCallback = (filePath: string) => void;

/**
 * Callback type for kanban content changed notification
 */
export type KanbanContentChangedCallback = (filePath: string, newContent: string) => void;

/**
 * Service for managing kanban diff views
 */
export class KanbanDiffService implements vscode.Disposable {
    private static instance: KanbanDiffService | null = null;

    private activeSessions = new Map<string, DiffSession>();
    private fileRegistry: MarkdownFileRegistry | null = null;
    private disposables: vscode.Disposable[] = [];
    private onDiffClosedCallback: DiffClosedCallback | null = null;
    private onContentChangedCallback: KanbanContentChangedCallback | null = null;
    private contentChangeDebounceTimer: NodeJS.Timeout | null = null;

    private constructor() {
        // Listen for editor tab closes to clean up sessions
        this.disposables.push(
            vscode.window.tabGroups.onDidChangeTabs(e => {
                this.handleTabChanges(e);
            })
        );
    }

    static getInstance(): KanbanDiffService {
        if (!KanbanDiffService.instance) {
            KanbanDiffService.instance = new KanbanDiffService();
        }
        return KanbanDiffService.instance;
    }

    setFileRegistry(registry: MarkdownFileRegistry): void {
        this.fileRegistry = registry;
    }

    /**
     * Set callback to be notified when a diff is closed externally (user closes tab)
     */
    setOnDiffClosedCallback(callback: DiffClosedCallback | null): void {
        this.onDiffClosedCallback = callback;
    }

    /**
     * Set callback to be notified when kanban content is changed in the diff editor
     */
    setOnContentChangedCallback(callback: KanbanContentChangedCallback | null): void {
        this.onContentChangedCallback = callback;
    }

    /**
     * Open a diff view for the given file
     * Left side: kanban buffer content (temp file, editable)
     * Right side: actual file on disk
     */
    async openDiff(filePath: string, kanbanContent: string, _diskContent: string): Promise<void> {
        // Close existing session for this file if any
        await this.closeDiff(filePath);

        const fileName = path.basename(filePath);
        const fileExt = path.extname(filePath);

        // Create temp file for kanban content (left side, editable)
        const tempDir = os.tmpdir();
        const tempFileName = `kanban-buffer-${Date.now()}${fileExt}`;
        const tempFilePath = path.join(tempDir, tempFileName);
        fs.writeFileSync(tempFilePath, kanbanContent, 'utf8');

        const kanbanUri = vscode.Uri.file(tempFilePath);

        // Use the actual file URI for the right side (disk content)
        const diskUri = vscode.Uri.file(filePath);

        const session: DiffSession = {
            filePath,
            kanbanDocUri: kanbanUri,
            diskUri,
            tempFilePath,
            disposables: []
        };

        // Listen for changes to the kanban temp file and sync back to registry
        const changeListener = vscode.workspace.onDidChangeTextDocument(e => {
            if (e.document.uri.fsPath === tempFilePath) {
                this.syncKanbanChangesToRegistry(filePath, e.document.getText());
            }
        });
        session.disposables.push(changeListener);

        this.activeSessions.set(filePath, session);

        // Open diff view to the right of current editor
        // Left (first arg) = kanban buffer, Right (second arg) = disk file
        await vscode.commands.executeCommand(
            'vscode.diff',
            kanbanUri,      // Left: kanban buffer (temp file, editable)
            diskUri,        // Right: disk file
            `${fileName}: Kanban ↔ Disk`,
            {
                viewColumn: vscode.ViewColumn.Beside,
                preserveFocus: false
            }
        );
    }

    /**
     * Close the diff view for the given file
     */
    async closeDiff(filePath: string): Promise<void> {
        const session = this.activeSessions.get(filePath);
        if (!session) {
            return;
        }

        // Dispose listeners
        session.disposables.forEach(d => d.dispose());

        // Close the diff editor tab
        await this.closeEditorByUri(session.kanbanDocUri);

        // Clean up temp file
        if (session.tempFilePath) {
            try {
                fs.unlinkSync(session.tempFilePath);
            } catch {
                // Ignore errors when cleaning up temp file
            }
        }

        this.activeSessions.delete(filePath);
    }

    /**
     * Close all open diff views
     */
    async closeAllDiffs(): Promise<void> {
        const filePaths = Array.from(this.activeSessions.keys());
        for (const filePath of filePaths) {
            await this.closeDiff(filePath);
        }
    }

    /**
     * Check if a diff is open for the given file
     */
    hasDiffOpen(filePath: string): boolean {
        return this.activeSessions.has(filePath);
    }

    /**
     * Get the file path of the currently open diff (if any)
     */
    getActiveDiffFilePath(): string | null {
        // Return the first active session (typically only one)
        const firstKey = this.activeSessions.keys().next().value;
        return firstKey || null;
    }

    private syncKanbanChangesToRegistry(filePath: string, newContent: string): void {
        if (!this.fileRegistry) {
            return;
        }

        const file = this.fileRegistry.get(filePath) || this.fileRegistry.findByPath(filePath);
        if (file) {
            // Update the file content in the registry (don't update baseline - keep as unsaved change)
            file.setContent(newContent, false);
        }

        // Notify callback with debouncing (300ms) to avoid excessive updates while typing
        if (this.onContentChangedCallback) {
            if (this.contentChangeDebounceTimer) {
                clearTimeout(this.contentChangeDebounceTimer);
            }
            this.contentChangeDebounceTimer = setTimeout(() => {
                this.contentChangeDebounceTimer = null;
                if (this.onContentChangedCallback) {
                    this.onContentChangedCallback(filePath, newContent);
                }
            }, 300);
        }
    }

    private async closeEditorByUri(uri: vscode.Uri): Promise<void> {
        const uriString = uri.toString();

        for (const tabGroup of vscode.window.tabGroups.all) {
            for (const tab of tabGroup.tabs) {
                // Check if this tab contains our document
                const tabInput = tab.input;
                if (tabInput && typeof tabInput === 'object') {
                    // Handle diff editor tabs
                    if ('original' in tabInput && 'modified' in tabInput) {
                        const diffInput = tabInput as { original: vscode.Uri; modified: vscode.Uri };
                        if (diffInput.original?.toString() === uriString ||
                            diffInput.modified?.toString() === uriString) {
                            await vscode.window.tabGroups.close(tab);
                            return;
                        }
                    }
                    // Handle regular editor tabs
                    if ('uri' in tabInput) {
                        const textInput = tabInput as { uri: vscode.Uri };
                        if (textInput.uri?.toString() === uriString) {
                            await vscode.window.tabGroups.close(tab);
                            return;
                        }
                    }
                }
            }
        }
    }

    private handleTabChanges(e: vscode.TabChangeEvent): void {
        // Check if any of our diff sessions were closed externally
        for (const closedTab of e.closed) {
            const tabInput = closedTab.input;
            if (tabInput && typeof tabInput === 'object' && 'original' in tabInput) {
                const diffInput = tabInput as { original: vscode.Uri; modified: vscode.Uri };

                // Find which session this tab belonged to
                for (const [filePath, session] of this.activeSessions) {
                    if (diffInput.original?.toString() === session.kanbanDocUri.toString() ||
                        diffInput.modified?.toString() === session.diskUri.toString()) {
                        // Clean up the session without trying to close the tab again
                        session.disposables.forEach(d => d.dispose());

                        // Clean up temp file
                        if (session.tempFilePath) {
                            try {
                                fs.unlinkSync(session.tempFilePath);
                            } catch {
                                // Ignore errors when cleaning up temp file
                            }
                        }

                        this.activeSessions.delete(filePath);

                        // Notify callback that diff was closed externally
                        if (this.onDiffClosedCallback) {
                            this.onDiffClosedCallback(filePath);
                        }
                        break;
                    }
                }
            }
        }
    }

    dispose(): void {
        // Close all active sessions
        for (const session of this.activeSessions.values()) {
            session.disposables.forEach(d => d.dispose());
        }
        this.activeSessions.clear();

        this.disposables.forEach(d => d.dispose());

        KanbanDiffService.instance = null;
    }
}
