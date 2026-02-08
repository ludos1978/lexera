import { MarkdownFile } from '../../files/MarkdownFile';
import { ConflictResolver } from '../../services/ConflictResolver';
import { CapturedEdit, IMarkdownFileRegistry } from '../../files/FileInterfaces';

class TestMarkdownFile extends MarkdownFile {
    public diskContent: string;
    public shouldCorruptWrite: boolean = false;
    public queuedReadResponses: Array<string | null> = [];
    public writeCount: number = 0;

    constructor(initialContent: string) {
        super('/tmp/kanban-save-verification-test.md', 'kanban-save-verification-test.md', new ConflictResolver('test-panel'), {} as any);
        this.diskContent = initialContent;
        this.setContent(initialContent, true);
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
            return;
        }
        this.diskContent = content;
    }

    async handleExternalChange(_changeType: 'modified' | 'deleted' | 'created'): Promise<void> {
        // no-op for unit tests
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

    it('rolls back in-memory state when persisted content does not verify', async () => {
        const file = new TestMarkdownFile('before');
        file.setContent('after');
        file.shouldCorruptWrite = true;

        await expect(file.save({ skipReloadDetection: false })).rejects.toThrow('Post-save verification failed');

        expect(file.getContent()).toBe('after');
        expect(file.getBaseline()).toBe('before');
        expect(file.hasUnsavedChanges()).toBe(true);
        expect(file.diskContent).toBe('corrupted:after');
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
