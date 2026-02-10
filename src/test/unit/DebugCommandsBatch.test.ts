import { DebugCommands } from '../../commands/DebugCommands';

type MockFile = {
    getPath: () => string;
    getRelativePath: () => string;
    getFileType: () => 'main' | 'include-column';
    getLastAccessErrorCode: () => string | null;
    isDirtyInEditor: () => boolean;
    hasAnyUnsavedChanges: () => boolean;
    readFromDisk: () => Promise<string | null>;
    getContentForBackup: () => string;
    createVisibleConflictFile: (content: string) => Promise<string | null>;
    isInEditMode: () => boolean;
    setEditMode: (value: boolean) => void;
    reload: () => Promise<void>;
};

function createMockFile(
    filePath: string,
    overrides: Partial<MockFile> = {}
): MockFile {
    const relativePath = filePath.split('/').pop() || filePath;
    return {
        getPath: () => filePath,
        getRelativePath: () => relativePath,
        getFileType: () => 'include-column',
        getLastAccessErrorCode: () => null,
        isDirtyInEditor: () => false,
        hasAnyUnsavedChanges: () => false,
        readFromDisk: async () => 'disk',
        getContentForBackup: () => 'kanban',
        createVisibleConflictFile: async () => `/tmp/${relativePath}-conflict.md`,
        isInEditMode: () => false,
        setEditMode: () => undefined,
        reload: async () => undefined,
        ...overrides
    };
}

function createMockRegistry(files: Record<string, MockFile>) {
    return {
        get: (path: string) => files[path],
        findByPath: (path: string) => files[path]
    };
}

describe('DebugCommands applyBatchFileActions', () => {
    it('fails closed on preflight validation errors before any action executes', async () => {
        const commands = new DebugCommands() as any;
        const postMessage = jest.fn();
        const saveFile = jest.fn();
        const dirtyFile = createMockFile('/tmp/dirty.md', {
            isDirtyInEditor: () => true
        });
        const registry = createMockRegistry({
            '/tmp/dirty.md': dirtyFile
        });

        commands.getFileRegistry = () => registry;
        commands.postMessage = postMessage;
        commands._validateSnapshotToken = jest.fn(() => null);
        commands._context = {
            fileSaveService: { saveFile }
        };

        await commands.handleApplyBatchFileActions({
            type: 'applyBatchFileActions',
            snapshotToken: 'snapshot-1',
            actions: [{ path: '/tmp/dirty.md', action: 'overwrite' }]
        }, {});

        expect(saveFile).not.toHaveBeenCalled();
        const payload = postMessage.mock.calls[0][0];
        expect(payload.type).toBe('batchFileActionsResult');
        expect(payload.success).toBe(false);
        expect(payload.failedCount).toBe(1);
        expect(payload.appliedCount).toBe(0);
        expect(payload.results[0].path).toBe('/tmp/dirty.md');
        expect(payload.results[0].status).toBe('failed');
    });

    it('applies a mixed batch and reports backups created', async () => {
        const commands = new DebugCommands() as any;
        const postMessage = jest.fn();
        const saveFile = jest.fn(async () => undefined);
        const reload = jest.fn(async () => undefined);

        const overwriteFile = createMockFile('/tmp/one.md');
        const reloadWithBackupFile = createMockFile('/tmp/two.md', {
            reload
        });
        const registry = createMockRegistry({
            '/tmp/one.md': overwriteFile,
            '/tmp/two.md': reloadWithBackupFile
        });

        commands.getFileRegistry = () => registry;
        commands.postMessage = postMessage;
        commands._validateSnapshotToken = jest.fn(() => null);
        commands._context = {
            fileSaveService: { saveFile }
        };

        await commands.handleApplyBatchFileActions({
            type: 'applyBatchFileActions',
            snapshotToken: 'snapshot-1',
            actions: [
                { path: '/tmp/one.md', action: 'overwrite' },
                { path: '/tmp/two.md', action: 'load_external_backup_mine' }
            ]
        }, {});

        expect(saveFile).toHaveBeenCalledTimes(1);
        expect(saveFile).toHaveBeenCalledWith(overwriteFile, undefined, expect.objectContaining({
            force: true,
            skipReloadDetection: true
        }));
        expect(reload).toHaveBeenCalledTimes(1);

        const payload = postMessage.mock.calls[0][0];
        expect(payload.type).toBe('batchFileActionsResult');
        expect(payload.success).toBe(true);
        expect(payload.appliedCount).toBe(2);
        expect(payload.failedCount).toBe(0);
        expect(payload.backupCount).toBe(1);
        expect(payload.results[0].status).toBe('applied');
        expect(payload.results[1].status).toBe('applied');
        expect(payload.results[1].backupCreated).toBe(true);
    });

    it('stops the batch after the first execution failure and skips remaining actions', async () => {
        const commands = new DebugCommands() as any;
        const postMessage = jest.fn();
        const saveFile = jest.fn(async () => undefined);

        const fileOne = createMockFile('/tmp/one.md');
        const fileTwo = createMockFile('/tmp/two.md', {
            reload: async () => {
                throw new Error('reload failed');
            }
        });
        const fileThree = createMockFile('/tmp/three.md');
        const registry = createMockRegistry({
            '/tmp/one.md': fileOne,
            '/tmp/two.md': fileTwo,
            '/tmp/three.md': fileThree
        });

        commands.getFileRegistry = () => registry;
        commands.postMessage = postMessage;
        commands._validateSnapshotToken = jest.fn(() => null);
        commands._context = {
            fileSaveService: { saveFile }
        };

        await commands.handleApplyBatchFileActions({
            type: 'applyBatchFileActions',
            snapshotToken: 'snapshot-1',
            actions: [
                { path: '/tmp/one.md', action: 'overwrite' },
                { path: '/tmp/two.md', action: 'load_external' },
                { path: '/tmp/three.md', action: 'overwrite' }
            ]
        }, {});

        expect(saveFile).toHaveBeenCalledTimes(1);
        expect(saveFile).toHaveBeenNthCalledWith(1, fileOne, undefined, expect.objectContaining({
            force: true,
            skipReloadDetection: true
        }));

        const payload = postMessage.mock.calls[0][0];
        expect(payload.type).toBe('batchFileActionsResult');
        expect(payload.success).toBe(false);
        expect(payload.appliedCount).toBe(1);
        expect(payload.failedCount).toBe(1);
        expect(payload.skippedCount).toBe(1);
        expect(payload.results[0].status).toBe('applied');
        expect(payload.results[1].status).toBe('failed');
        expect(payload.results[1].error).toContain('reload failed');
        expect(payload.results[2].status).toBe('skipped');
        expect(payload.results[2].error).toContain('Batch stopped');
    });

    it('blocks load_external without backup when unsaved changes exist', async () => {
        const commands = new DebugCommands() as any;
        const postMessage = jest.fn();
        const reload = jest.fn(async () => undefined);
        const unsavedFile = createMockFile('/tmp/unsaved.md', {
            hasAnyUnsavedChanges: () => true,
            reload
        });
        const registry = createMockRegistry({
            '/tmp/unsaved.md': unsavedFile
        });

        commands.getFileRegistry = () => registry;
        commands.postMessage = postMessage;
        commands._validateSnapshotToken = jest.fn(() => null);
        commands._context = {
            fileSaveService: { saveFile: jest.fn(async () => undefined) }
        };

        await commands.handleApplyBatchFileActions({
            type: 'applyBatchFileActions',
            snapshotToken: 'snapshot-1',
            actions: [{ path: '/tmp/unsaved.md', action: 'load_external' }]
        }, {});

        expect(reload).not.toHaveBeenCalled();
        const payload = postMessage.mock.calls[0][0];
        expect(payload.type).toBe('batchFileActionsResult');
        expect(payload.success).toBe(false);
        expect(payload.failedCount).toBe(1);
        expect(payload.results[0].status).toBe('failed');
        expect(payload.results[0].error).toContain('without backup');
    });

    it('allows overwrite actions for include files', async () => {
        const commands = new DebugCommands() as any;
        const postMessage = jest.fn();
        const saveFile = jest.fn(async () => undefined);
        const includeFile = createMockFile('/tmp/include.md');
        const registry = createMockRegistry({
            '/tmp/include.md': includeFile
        });

        commands.getFileRegistry = () => registry;
        commands.postMessage = postMessage;
        commands._validateSnapshotToken = jest.fn(() => null);
        commands._context = {
            fileSaveService: { saveFile }
        };

        await commands.handleApplyBatchFileActions({
            type: 'applyBatchFileActions',
            snapshotToken: 'snapshot-1',
            actions: [{ path: '/tmp/include.md', action: 'overwrite' }]
        }, {});

        expect(saveFile).toHaveBeenCalledTimes(1);
        const payload = postMessage.mock.calls[0][0];
        expect(payload.type).toBe('batchFileActionsResult');
        expect(payload.success).toBe(true);
        expect(payload.appliedCount).toBe(1);
        expect(payload.results[0].status).toBe('applied');
    });

    it('blocks batch actions when file access errors indicate permission issues', async () => {
        const commands = new DebugCommands() as any;
        const postMessage = jest.fn();
        const saveFile = jest.fn(async () => undefined);
        const blockedFile = createMockFile('/tmp/blocked.md', {
            getLastAccessErrorCode: () => 'EACCES'
        });
        const registry = createMockRegistry({
            '/tmp/blocked.md': blockedFile
        });

        commands.getFileRegistry = () => registry;
        commands.postMessage = postMessage;
        commands._validateSnapshotToken = jest.fn(() => null);
        commands._context = {
            fileSaveService: { saveFile }
        };

        await commands.handleApplyBatchFileActions({
            type: 'applyBatchFileActions',
            snapshotToken: 'snapshot-1',
            actions: [{ path: '/tmp/blocked.md', action: 'overwrite' }]
        }, {});

        expect(saveFile).not.toHaveBeenCalled();
        const payload = postMessage.mock.calls[0][0];
        expect(payload.type).toBe('batchFileActionsResult');
        expect(payload.success).toBe(false);
        expect(payload.failedCount).toBe(1);
        expect(payload.results[0].status).toBe('failed');
        expect(payload.results[0].error).toContain('not accessible');
    });

    it('deduplicates actions by resolved file path (relative/absolute aliases)', async () => {
        const commands = new DebugCommands() as any;
        const postMessage = jest.fn();
        const saveFile = jest.fn(async () => undefined);
        const sameFile = createMockFile('/tmp/shared.md');
        const registry = {
            get: (path: string) => (path === '/tmp/shared.md' ? sameFile : undefined),
            findByPath: (path: string) => (path === 'shared.md' ? sameFile : undefined)
        };

        commands.getFileRegistry = () => registry;
        commands.postMessage = postMessage;
        commands._validateSnapshotToken = jest.fn(() => null);
        commands._context = {
            fileSaveService: { saveFile }
        };

        await commands.handleApplyBatchFileActions({
            type: 'applyBatchFileActions',
            snapshotToken: 'snapshot-1',
            actions: [
                { path: '/tmp/shared.md', action: 'overwrite' },
                { path: 'shared.md', action: 'overwrite' }
            ]
        }, {});

        expect(saveFile).toHaveBeenCalledTimes(1);
        const payload = postMessage.mock.calls[0][0];
        expect(payload.type).toBe('batchFileActionsResult');
        expect(payload.success).toBe(true);
        expect(payload.appliedCount).toBe(1);
        expect(payload.skippedCount).toBe(1);
        expect(payload.failedCount).toBe(0);
        expect(payload.results[0].status).toBe('applied');
        expect(payload.results[1].status).toBe('skipped');
        expect(payload.results[1].error).toContain('Duplicate file action');
    });

    it('normalizes unsupported conflict actions to skip when applying dialog resolutions', async () => {
        const commands = new DebugCommands() as any;
        const executor = jest.fn(async () => ([
            { path: '/tmp/one.md', action: 'overwrite', status: 'applied' },
            { path: '/tmp/two.md', action: 'skip', status: 'failed', error: 'boom' }
        ]));
        const registry = {} as any;
        commands._executeBatchFileActions = executor;

        await expect(commands.applyFileResolutions({
            cancelled: false,
            perFileResolutions: [
                { path: '/tmp/one.md', action: 'overwrite' },
                { path: '/tmp/two.md', action: 'ignore' }
            ]
        }, registry)).rejects.toThrow('boom');

        expect(executor).toHaveBeenCalledWith([
            { path: '/tmp/one.md', action: 'overwrite' },
            { path: '/tmp/two.md', action: 'skip' }
        ], registry);
    });
});
