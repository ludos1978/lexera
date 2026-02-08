import { MarkdownFile } from '../../files/MarkdownFile';
import { ConflictResolver } from '../../services/ConflictResolver';
import { CapturedEdit, IMarkdownFileRegistry } from '../../files/FileInterfaces';
import { FileSaveService } from '../../core/FileSaveService';
import { SaveTransactionManager } from '../../files/SaveTransactionManager';
import { WatcherCoordinator } from '../../files/WatcherCoordinator';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

class TestMarkdownFile extends MarkdownFile {
    public diskContent: string;
    public shouldCorruptWrite: boolean = false;
    public queuedReadResponses: Array<string | null> = [];
    public writeCount: number = 0;
    public emergencyBackupPath: string | null = null;
    public emergencyBackupError: string | null = null;
    public emergencyBackupRequests: string[] = [];
    public externalEvents: Array<'modified' | 'deleted' | 'created'> = [];
    public editorDirty: boolean = false;

    constructor(initialContent: string) {
        const randomSuffix = Math.random().toString(36).slice(2, 10);
        const testFileName = `kanban-save-verification-test-${randomSuffix}.md`;
        const testPath = path.join('/tmp', testFileName);
        super(testPath, testFileName, new ConflictResolver('test-panel'), {} as any);
        this.diskContent = initialContent;
        this.setContent(initialContent, true);
        fs.writeFileSync(this.getPath(), initialContent, 'utf8');
    }

    getFileType(): 'include-task' {
        return 'include-task';
    }

    async readFromDisk(): Promise<string | null> {
        if (this.queuedReadResponses.length > 0) {
            return this.queuedReadResponses.shift() ?? null;
        }
        return this.diskContent;
    }

    async writeToDisk(content: string): Promise<void> {
        this.writeCount++;
        if (this.shouldCorruptWrite) {
            this.diskContent = `corrupted:${content}`;
            await fs.promises.writeFile(this.getPath(), this.diskContent, 'utf8');
            return;
        }
        this.diskContent = content;
        await fs.promises.writeFile(this.getPath(), content, 'utf8');
    }

    async handleExternalChange(changeType: 'modified' | 'deleted' | 'created'): Promise<void> {
        this.externalEvents.push(changeType);
    }

    validate(_content: string): { valid: boolean; errors?: string[] } {
        return { valid: true };
    }

    protected async _getFileModifiedTime(): Promise<Date | null> {
        return new Date('2026-01-01T00:00:00.000Z');
    }

    getFileRegistry(): IMarkdownFileRegistry | undefined {
        return undefined;
    }

    async applyEditToBaseline(_capturedEdit: CapturedEdit): Promise<void> {
        // not needed for these tests
    }

    public isDirtyInEditor(): boolean {
        return this.editorDirty;
    }

    public async simulateWatcherChange(changeType: 'modified' | 'deleted' | 'created'): Promise<void> {
        await this._onFileSystemChange(changeType);
    }

    protected async _persistEmergencyBackup(content: string): Promise<string | null> {
        this.emergencyBackupRequests.push(content);
        if (this.emergencyBackupError) {
            throw new Error(this.emergencyBackupError);
        }
        return this.emergencyBackupPath;
    }
}

describe('MarkdownFile.save post-write verification', () => {
    it('persists content and updates baseline when verification succeeds', async () => {
        const file = new TestMarkdownFile('before');
        file.setContent('after');

        await file.save({ skipReloadDetection: false });

        expect(file.getContent()).toBe('after');
        expect(file.getBaseline()).toBe('after');
        expect(file.hasUnsavedChanges()).toBe(false);
        expect(file.diskContent).toBe('after');
        expect(file.writeCount).toBe(1);
    });

    it('creates an emergency backup when persisted content does not verify', async () => {
        const file = new TestMarkdownFile('before');
        file.setContent('after');
        file.shouldCorruptWrite = true;
        file.emergencyBackupPath = '/tmp/emergency-backup.md';

        await expect(file.save({ skipReloadDetection: false })).rejects.toThrow('Emergency backup created');

        expect(file.getContent()).toBe('after');
        expect(file.getBaseline()).toBe('before');
        expect(file.hasUnsavedChanges()).toBe(true);
        expect(file.diskContent).toBe('corrupted:after');
        expect(file.hasExternalChanges()).toBe(true);
        expect(file.emergencyBackupRequests).toEqual(['after']);
    });

    it('fails loudly when both save and emergency backup fail', async () => {
        const file = new TestMarkdownFile('before');
        file.setContent('after');
        file.shouldCorruptWrite = true;
        file.emergencyBackupError = 'backup write denied';

        await expect(file.save({ skipReloadDetection: false })).rejects.toThrow('failed to create an emergency backup');

        expect(file.getContent()).toBe('after');
        expect(file.getBaseline()).toBe('before');
        expect(file.hasUnsavedChanges()).toBe(true);
        expect(file.hasExternalChanges()).toBe(true);
        expect(file.emergencyBackupRequests).toEqual(['after']);
    });

    it('recovers as saved when verification reads stale data but disk has expected content', async () => {
        const file = new TestMarkdownFile('before');
        file.setContent('after');
        file.queuedReadResponses = ['before', 'before', 'before', 'before', 'before'];

        await expect(file.save({ skipReloadDetection: false })).resolves.toBeUndefined();

        expect(file.getContent()).toBe('after');
        expect(file.getBaseline()).toBe('after');
        expect(file.hasUnsavedChanges()).toBe(false);
        expect(file.hasExternalChanges()).toBe(false);
        expect(file.emergencyBackupRequests).toEqual([]);
    });

    it('retries verification and succeeds when read-after-write is eventually consistent', async () => {
        const file = new TestMarkdownFile('before');
        file.setContent('after');
        file.queuedReadResponses = ['before', 'before'];

        await file.save({ skipReloadDetection: false });

        expect(file.getContent()).toBe('after');
        expect(file.getBaseline()).toBe('after');
        expect(file.hasUnsavedChanges()).toBe(false);
        expect(file.diskContent).toBe('after');
        expect(file.queuedReadResponses.length).toBe(0);
    });
});

describe('MarkdownFile self-save event suppression', () => {
    it('suppresses watcher event when disk content matches own saved content', async () => {
        const file = new TestMarkdownFile('before');
        file.setContent('after');

        await file.save({ skipReloadDetection: true });
        await file.simulateWatcherChange('modified');

        expect(file.externalEvents).toEqual([]);
        expect(file.hasExternalChanges()).toBe(false);
    });

    it('does not suppress watcher event when disk content differs from own saved content', async () => {
        const file = new TestMarkdownFile('before');
        file.setContent('after');

        await file.save({ skipReloadDetection: true });

        file.diskContent = 'external-change';
        await fs.promises.writeFile(file.getPath(), file.diskContent, 'utf8');
        await file.simulateWatcherChange('modified');

        expect(file.externalEvents).toEqual(['modified']);
        expect(file.hasExternalChanges()).toBe(true);
    });
});

describe('FileSaveService.saveFile with provided content', () => {
    it('keeps baseline unchanged when save fails after content update', async () => {
        const file = new TestMarkdownFile('before');
        file.shouldCorruptWrite = true;
        file.emergencyBackupPath = '/tmp/emergency-backup.md';
        const service = new FileSaveService('panel-test');

        await expect(service.saveFile(file, 'after', { skipReloadDetection: false }))
            .rejects
            .toThrow('Emergency backup created');

        expect(file.getContent()).toBe('after');
        expect(file.getBaseline()).toBe('before');
        expect(file.hasUnsavedChanges()).toBe(true);
    });

    it('rejects non-forced save when the editor document is dirty', async () => {
        const file = new TestMarkdownFile('before');
        file.editorDirty = true;
        const service = new FileSaveService('panel-test');

        await expect(service.saveFile(file, 'after', { skipReloadDetection: false }))
            .rejects
            .toThrow('unsaved text-editor changes');

        expect(file.writeCount).toBe(0);
    });

    it('allows forced save when the editor document is dirty', async () => {
        const file = new TestMarkdownFile('before');
        file.editorDirty = true;
        const service = new FileSaveService('panel-test');

        await service.saveFile(file, 'after', {
            force: true,
            skipReloadDetection: false
        });

        expect(file.writeCount).toBe(1);
        expect(file.getBaseline()).toBe('after');
    });
});

describe('MarkdownFile.getContentForBackup', () => {
    afterEach(() => {
        (vscode.workspace as any).textDocuments = [];
    });

    it('prefers dirty editor buffer content when available', () => {
        const file = new TestMarkdownFile('before');
        file.setContent('kanban-state');

        (vscode.workspace as any).textDocuments = [{
            uri: { fsPath: file.getPath() },
            isDirty: true,
            getText: () => 'editor-buffer'
        }];

        expect(file.getContentForBackup()).toBe('editor-buffer');
    });

    it('falls back to tracked file content when no dirty editor buffer exists', () => {
        const file = new TestMarkdownFile('before');
        file.setContent('kanban-state');

        (vscode.workspace as any).textDocuments = [{
            uri: { fsPath: file.getPath() },
            isDirty: false,
            getText: () => 'editor-buffer'
        }];

        expect(file.getContentForBackup()).toBe('kanban-state');
    });
});

describe('MarkdownFile operation keying', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('uses absolute file paths for operation coordination and save transactions', async () => {
        const file = new TestMarkdownFile('before');
        const expectedPath = file.getPath();

        const coordinator = WatcherCoordinator.getInstance();
        const transactionManager = SaveTransactionManager.getInstance();
        const startSpy = jest.spyOn(coordinator, 'startOperation');
        const endSpy = jest.spyOn(coordinator, 'endOperation');
        const beginSpy = jest.spyOn(transactionManager, 'beginTransaction');
        const commitSpy = jest.spyOn(transactionManager, 'commitTransaction');

        file.setContent('after');
        await file.save({ skipReloadDetection: false });
        await file.reload();

        expect(startSpy).toHaveBeenCalledWith(expectedPath, 'save');
        expect(startSpy).toHaveBeenCalledWith(expectedPath, 'reload');
        expect(endSpy).toHaveBeenCalledWith(expectedPath, 'save');
        expect(endSpy).toHaveBeenCalledWith(expectedPath, 'reload');
        expect(beginSpy).toHaveBeenCalledWith(expectedPath, expect.any(Object));
        expect(commitSpy).toHaveBeenCalledWith(expectedPath, expect.any(String));
    });
});
