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
import { logger } from '../utils/logger';

/**
 * Unique prefix for our diff temp files - used to identify tabs we opened
 */
const DIFF_TEMP_PREFIX = 'kanban-diff-';

/**
 * Tracks active diff sessions and manages their lifecycle
 */
interface DiffSession {
    sessionId: string;      // Unique ID for this session
    filePath: string;
    kanbanDocUri: vscode.Uri;
    diskUri: vscode.Uri;
    tempFilePath: string;   // Temp file for kanban content (includes sessionId)
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
        logger.debug(`[KanbanDiffService] openDiff: filePath="${filePath}"`);

        // Close existing session for this file if any
        await this.closeDiff(filePath);

        const fileName = path.basename(filePath);
        const fileExt = path.extname(filePath);

        // Generate unique session ID
        const sessionId = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

        // Create temp file for kanban content (left side, editable)
        // Use our unique prefix so we can identify tabs we opened
        const tempDir = os.tmpdir();
        const tempFileName = `${DIFF_TEMP_PREFIX}${sessionId}${fileExt}`;
        const tempFilePath = path.join(tempDir, tempFileName);
        fs.writeFileSync(tempFilePath, kanbanContent, 'utf8');

        const kanbanUri = vscode.Uri.file(tempFilePath);

        // Use the actual file URI for the right side (disk content)
        const diskUri = vscode.Uri.file(filePath);

        const session: DiffSession = {
            sessionId,
            filePath,
            kanbanDocUri: kanbanUri,
            diskUri,
            tempFilePath,
            disposables: []
        };

        // Listen for changes to the kanban temp file and sync back to registry
        const changeListener = vscode.workspace.onDidChangeTextDocument(e => {
            const isMatch = e.document.uri.fsPath === tempFilePath;
            console.log(`[KanbanDiffService] onDidChangeTextDocument: match=${isMatch}, tempFilePath="${tempFilePath}"`);
            if (isMatch) {
                console.log(`[KanbanDiffService] onDidChangeTextDocument: calling syncKanbanChangesToRegistry for "${filePath}"`);
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
            console.log(`[KanbanDiffService] closeDiff: No session for "${filePath}". Active sessions: [${Array.from(this.activeSessions.keys()).join(', ')}]`);
            return;
        }
        console.log(`[KanbanDiffService] closeDiff: Closing session ${session.sessionId} for "${filePath}"`);

        // Dispose listeners
        session.disposables.forEach(d => d.dispose());

        // Close the diff editor tab using session ID for reliable matching
        await this.closeEditorBySession(session);

        // Clean up temp file
        try {
            fs.unlinkSync(session.tempFilePath);
        } catch {
            // Ignore errors when cleaning up temp file
        }

        // NOTE: Do NOT clear preserveRawContent flag here!
        // The flag should persist until the file is saved, so raw edits aren't lost
        // when the diff view is closed before saving.

        this.activeSessions.delete(filePath);
    }

    /**
     * Close all open diff views
     */
    async closeAllDiffs(): Promise<void> {
        const filePaths = Array.from(this.activeSessions.keys());
        console.log(`[KanbanDiffService] closeAllDiffs: Closing ${filePaths.length} diff session(s): [${filePaths.join(', ')}]`);
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
            console.warn(`[KanbanDiffService] syncKanbanChangesToRegistry: No file registry`);
            return;
        }

        const file = this.fileRegistry.get(filePath) || this.fileRegistry.findByPath(filePath);
        if (file) {
            // Update the file content in the registry (don't update baseline - keep as unsaved change)
            file.setContent(newContent, false);
            // CRITICAL: Mark file to preserve raw content - prevents regeneration from overwriting diff edits
            file.setPreserveRawContent(true);
            const relPath = (file as any).getRelativePath?.() || filePath;
            console.log(`[KanbanDiffService] syncKanbanChangesToRegistry: Updated content for "${filePath}" (${file.getFileType()}, relPath="${relPath}"), preserveRaw=true, hasUnsaved=${file.hasUnsavedChanges()}`);
        } else {
            console.warn(`[KanbanDiffService] syncKanbanChangesToRegistry: File not found in registry: "${filePath}"`);
            // List all registered files for debugging
            const allFiles = this.fileRegistry.getAll();
            console.log(`[KanbanDiffService] Registered files: [${allFiles.map((f: any) => f.getRelativePath?.() || f.getPath()).join(', ')}]`);
        }

        // Notify callback with debouncing (300ms) to avoid excessive updates while typing
        if (this.onContentChangedCallback) {
            console.log(`[KanbanDiffService] syncKanbanChangesToRegistry: scheduling callback for "${filePath}" (debounce 300ms)`);
            if (this.contentChangeDebounceTimer) {
                clearTimeout(this.contentChangeDebounceTimer);
            }
            this.contentChangeDebounceTimer = setTimeout(() => {
                this.contentChangeDebounceTimer = null;
                if (this.onContentChangedCallback) {
                    console.log(`[KanbanDiffService] syncKanbanChangesToRegistry: invoking callback for "${filePath}"`);
                    this.onContentChangedCallback(filePath, newContent);
                }
            }, 300);
        } else {
            console.warn(`[KanbanDiffService] syncKanbanChangesToRegistry: NO callback registered!`);
        }
    }

    /**
     * Close editor tabs matching the given session
     * Uses the unique session ID in the temp file name for reliable matching
     */
    private async closeEditorBySession(session: DiffSession): Promise<void> {
        const tempFileName = path.basename(session.tempFilePath);
        console.log(`[KanbanDiffService] closeEditorBySession: Looking for tabs with tempFile="${tempFileName}" (sessionId=${session.sessionId})`);

        const tabsToClose: vscode.Tab[] = [];

        for (const tabGroup of vscode.window.tabGroups.all) {
            for (const tab of tabGroup.tabs) {
                const tabInput = tab.input;
                if (tabInput && typeof tabInput === 'object') {
                    // Handle diff editor tabs - check if either side contains our temp file
                    if ('original' in tabInput && 'modified' in tabInput) {
                        const diffInput = tabInput as { original: vscode.Uri; modified: vscode.Uri };
                        const originalPath = diffInput.original?.fsPath || '';
                        const modifiedPath = diffInput.modified?.fsPath || '';

                        // Match by our unique temp file name (contains session ID)
                        if (originalPath.includes(tempFileName) || modifiedPath.includes(tempFileName)) {
                            console.log(`[KanbanDiffService] closeEditorBySession: Found diff tab for session ${session.sessionId}`);
                            tabsToClose.push(tab);
                        }
                    }
                    // Handle regular editor tabs (in case temp file was opened separately)
                    if ('uri' in tabInput) {
                        const textInput = tabInput as { uri: vscode.Uri };
                        if (textInput.uri?.fsPath?.includes(tempFileName)) {
                            console.log(`[KanbanDiffService] closeEditorBySession: Found regular tab for session ${session.sessionId}`);
                            tabsToClose.push(tab);
                        }
                    }
                }
            }
        }

        if (tabsToClose.length === 0) {
            console.log(`[KanbanDiffService] closeEditorBySession: No matching tabs found for session ${session.sessionId}`);
        } else {
            console.log(`[KanbanDiffService] closeEditorBySession: Closing ${tabsToClose.length} tab(s) for session ${session.sessionId}`);
            for (const tab of tabsToClose) {
                try {
                    await vscode.window.tabGroups.close(tab);
                } catch (e) {
                    console.warn(`[KanbanDiffService] closeEditorBySession: Error closing tab:`, e);
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

                        // NOTE: Do NOT clear preserveRawContent flag here!
                        // The flag should persist until the file is saved.

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
