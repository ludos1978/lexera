import { KanbanFileService } from '../../kanbanFileService';
import { getCardSummaryLine } from '../../utils/cardContent';

type MockMarkdownFile = {
    getPath: jest.Mock<string, []>;
    getRelativePath: jest.Mock<string, []>;
    getFileName: jest.Mock<string, []>;
    getFileType: jest.Mock<'main' | 'include-column', []>;
    getLastAccessErrorCode: jest.Mock<string | null, []>;
    probeWriteAccess: jest.Mock<Promise<string | null>, []>;
    exists: jest.Mock<boolean, []>;
    hasUnsavedChanges: jest.Mock<boolean, []>;
    hasAnyUnsavedChanges: jest.Mock<boolean, []>;
    hasExternalChanges: jest.Mock<boolean, []>;
    shouldPreserveRawContent: jest.Mock<boolean, []>;
    isDirtyInEditor: jest.Mock<boolean, []>;
    isInEditMode: jest.Mock<boolean, []>;
    setEditMode: jest.Mock<void, [boolean]>;
    reload: jest.Mock<Promise<void>, []>;
    readFromDisk: jest.Mock<Promise<string | null>, []>;
    createVisibleConflictFile: jest.Mock<Promise<string | null>, [string]>;
    getContentForBackup: jest.Mock<string, []>;
    generateFromTasks: jest.Mock<string, [unknown[]]>;
    setCachedBoardFromWebview: jest.Mock<void, [unknown]>;
    updateFromBoard: jest.Mock<void, [unknown, boolean, boolean]>;
    getBoard: jest.Mock<unknown, []>;
};

function createMockFile(config: {
    path: string;
    relativePath?: string;
    fileName?: string;
    fileType: 'main' | 'include-column';
    exists?: boolean;
    hasUnsavedChanges?: boolean;
    hasExternalChanges?: boolean;
}): MockMarkdownFile {
    const relativePath = config.relativePath ?? config.path;
    const fileName = config.fileName ?? relativePath.split('/').pop() ?? relativePath;

    return {
        getPath: jest.fn(() => config.path),
        getRelativePath: jest.fn(() => relativePath),
        getFileName: jest.fn(() => fileName),
        getFileType: jest.fn(() => config.fileType),
        getLastAccessErrorCode: jest.fn(() => null),
        probeWriteAccess: jest.fn(async () => null),
        exists: jest.fn(() => config.exists ?? true),
        hasUnsavedChanges: jest.fn(() => config.hasUnsavedChanges ?? false),
        hasAnyUnsavedChanges: jest.fn(() => config.hasUnsavedChanges ?? false),
        hasExternalChanges: jest.fn(() => config.hasExternalChanges ?? false),
        shouldPreserveRawContent: jest.fn(() => false),
        isDirtyInEditor: jest.fn(() => false),
        isInEditMode: jest.fn(() => false),
        setEditMode: jest.fn(),
        reload: jest.fn(async () => undefined),
        readFromDisk: jest.fn(async () => 'disk-content'),
        createVisibleConflictFile: jest.fn(async (_content: string) => '/tmp/conflict.md'),
        getContentForBackup: jest.fn(() => 'backup-content'),
        generateFromTasks: jest.fn((tasks: unknown[]) => JSON.stringify(tasks)),
        setCachedBoardFromWebview: jest.fn(),
        updateFromBoard: jest.fn(),
        getBoard: jest.fn(() => ({
            valid: true,
            title: 'Board',
            columns: [],
            yamlHeader: null,
            kanbanFooter: null
        }))
    };
}

function createServiceHarness(config: {
    mainFile: MockMarkdownFile;
    includeFiles?: MockMarkdownFile[];
    consistencyIssues?: Array<{ code: string; severity: 'warning' | 'error'; message: string }>;
    generatedBoard?: unknown;
}) {
    const board = {
        valid: true,
        title: 'Board',
        columns: [],
        yamlHeader: '---\nkanban-plugin: board\n---',
        kanbanFooter: null
    };

    const saveFile = jest.fn<Promise<void>, [MockMarkdownFile, unknown?, unknown?]>(async () => undefined);
    const consistencyIssues = config.consistencyIssues ?? [];
    const generatedBoard = config.generatedBoard ?? board;
    const setBoard = jest.fn();
    const sendBoardUpdate = jest.fn(async () => undefined);

    const fileRegistry = {
        getMainFile: jest.fn(() => config.mainFile),
        getIncludeFiles: jest.fn(() => config.includeFiles ?? []),
        generateBoard: jest.fn(() => generatedBoard),
        getConsistencyReport: jest.fn(() => ({
            checkedAt: '2026-01-01T00:00:00.000Z',
            fileCount: 1 + (config.includeFiles?.length ?? 0),
            issueCount: consistencyIssues.length,
            issues: consistencyIssues
        })),
        findByPath: jest.fn((filePath: string) => {
            if (config.mainFile.getPath() === filePath || config.mainFile.getRelativePath() === filePath) {
                return config.mainFile;
            }
            return (config.includeFiles ?? []).find(file =>
                file.getPath() === filePath || file.getRelativePath() === filePath
            );
        }),
        get: jest.fn((filePath: string) => {
            if (config.mainFile.getPath() === filePath) {
                return config.mainFile;
            }
            return (config.includeFiles ?? []).find(file => file.getPath() === filePath);
        })
    };

    const fileManager = {
        getDocument: jest.fn(() => ({ uri: { fsPath: config.mainFile.getPath() } })),
        sendFileInfo: jest.fn()
    };

    const deps = {
        boardStore: {
            getBoard: jest.fn(() => board),
            setBoard,
            setOriginalTaskOrder: jest.fn(),
            clearHistory: jest.fn()
        },
        extensionContext: {} as any,
        getPanel: jest.fn(() => ({
            webview: {
                postMessage: jest.fn()
            }
        })),
        getPanelInstance: jest.fn(() => null),
        getWebviewManager: jest.fn(() => null),
        sendBoardUpdate
    };

    const context = {
        fileSaveService: {
            saveFile
        },
        conflictDialogBridge: {}
    };

    const service = new KanbanFileService(
        fileManager as any,
        fileRegistry as any,
        {} as any,
        {} as any,
        {} as any,
        deps as any,
        context as any,
        new Map(),
        new Map()
    );

    return {
        board,
        setBoard,
        sendBoardUpdate,
        fileRegistry,
        saveFile,
        service
    };
}

describe('KanbanFileService.saveUnified pre-save conflict targeting', () => {
    it('aborts before writing when registry consistency has blocking errors', async () => {
        const mainFile = createMockFile({
            path: '/workspace/board.md',
            relativePath: 'board.md',
            fileType: 'main'
        });

        const { service, board, saveFile, fileRegistry } = createServiceHarness({
            mainFile,
            consistencyIssues: [
                {
                    code: 'duplicate-absolute-entries',
                    severity: 'error',
                    message: 'Same file instance is indexed by multiple absolute keys.'
                }
            ]
        });

        const result = await service.saveUnified({
            scope: 'main',
            board: board as any,
            updateUi: false,
            updateBaselines: false
        });

        expect(fileRegistry.getConsistencyReport).toHaveBeenCalled();
        expect(result.success).toBe(false);
        expect(result.aborted).toBe(true);
        expect(result.error).toContain('file index inconsistency');
        expect(saveFile).not.toHaveBeenCalled();
    });

    it('does not block save for external changes on include files outside the save target', async () => {
        const mainFile = createMockFile({
            path: '/workspace/board.md',
            relativePath: 'board.md',
            fileType: 'main',
            hasExternalChanges: false
        });
        const includeRegular = createMockFile({
            path: '/workspace/content/note.md',
            relativePath: 'content/note.md',
            fileType: 'include-column',
            hasExternalChanges: true,
            hasUnsavedChanges: false
        });

        const { service, board, saveFile } = createServiceHarness({
            mainFile,
            includeFiles: [includeRegular]
        });

        const showDialogSpy = jest.spyOn(service as any, '_showPresaveConflictDialog')
            .mockResolvedValue({
                cancelled: true,
                perFileResolutions: []
            });

        const result = await service.saveUnified({
            scope: 'all',
            syncIncludes: false,
            board: board as any,
            updateUi: false,
            updateBaselines: false
        });

        expect(showDialogSpy).not.toHaveBeenCalled();
        expect(result.success).toBe(true);
        expect(result.aborted).toBe(false);
        expect(saveFile).toHaveBeenCalledTimes(1);
        expect(saveFile).toHaveBeenCalledWith(mainFile, undefined, expect.objectContaining({
            source: 'ui-edit',
            force: false
        }));
    });

    it('applies overwrite resolutions even when conflict results return relative file paths', async () => {
        const mainFile = createMockFile({
            path: '/workspace/board.md',
            relativePath: 'board.md',
            fileType: 'main',
            hasExternalChanges: true
        });

        const { service, board, saveFile } = createServiceHarness({
            mainFile,
            includeFiles: []
        });

        jest.spyOn(service as any, '_showPresaveConflictDialog')
            .mockResolvedValue({
                cancelled: false,
                snapshotToken: 'token',
                perFileResolutions: [
                    {
                        path: 'board.md',
                        action: 'overwrite'
                    }
                ]
            });
        jest.spyOn(service as any, '_validateConflictSnapshotToken').mockReturnValue(null);

        const result = await service.saveUnified({
            scope: 'main',
            board: board as any,
            updateUi: false,
            updateBaselines: false
        });

        expect(result.success).toBe(true);
        expect(result.aborted).toBe(false);
        expect(saveFile).toHaveBeenCalledTimes(1);
        expect(saveFile).toHaveBeenCalledWith(mainFile, undefined, expect.objectContaining({
            force: true
        }));
    });

    it('honors force-write decisions for file-scoped include saves', async () => {
        const mainFile = createMockFile({
            path: '/workspace/board.md',
            relativePath: 'board.md',
            fileType: 'main',
            hasExternalChanges: false
        });
        const includeFile = createMockFile({
            path: '/workspace/includes/item.md',
            relativePath: 'includes/item.md',
            fileType: 'include-column',
            hasExternalChanges: true,
            hasUnsavedChanges: false
        });

        const { service, saveFile } = createServiceHarness({
            mainFile,
            includeFiles: [includeFile]
        });

        jest.spyOn(service as any, '_showPresaveConflictDialog')
            .mockResolvedValue({
                cancelled: false,
                snapshotToken: 'token',
                perFileResolutions: [
                    {
                        path: includeFile.getRelativePath(),
                        action: 'overwrite'
                    }
                ]
            });
        jest.spyOn(service as any, '_validateConflictSnapshotToken').mockReturnValue(null);

        const result = await service.saveUnified({
            scope: { filePath: includeFile.getRelativePath() },
            updateUi: false,
            updateBaselines: false
        });

        expect(result.success).toBe(true);
        expect(result.aborted).toBe(false);
        expect(saveFile).toHaveBeenCalledTimes(1);
        expect(saveFile).toHaveBeenCalledWith(includeFile, undefined, expect.objectContaining({
            force: true
        }));
    });

    it('aborts load_external without backup when unsaved changes exist', async () => {
        const mainFile = createMockFile({
            path: '/workspace/board.md',
            relativePath: 'board.md',
            fileType: 'main',
            hasExternalChanges: true,
            hasUnsavedChanges: true
        });

        const { service, board, saveFile } = createServiceHarness({
            mainFile,
            includeFiles: []
        });

        jest.spyOn(service as any, '_showPresaveConflictDialog')
            .mockResolvedValue({
                cancelled: false,
                snapshotToken: 'token',
                perFileResolutions: [
                    {
                        path: mainFile.getPath(),
                        action: 'load_external'
                    }
                ]
            });
        jest.spyOn(service as any, '_validateConflictSnapshotToken').mockReturnValue(null);

        const result = await service.saveUnified({
            scope: 'main',
            board: board as any,
            updateUi: false,
            updateBaselines: false
        });

        expect(result.success).toBe(false);
        expect(result.aborted).toBe(true);
        expect(result.error).toContain('requires backup');
        expect(saveFile).not.toHaveBeenCalled();
    });

    it('regenerates board state from registry after reload actions in conflict resolution', async () => {
        const mainFile = createMockFile({
            path: '/workspace/board.md',
            relativePath: 'board.md',
            fileType: 'main',
            hasExternalChanges: true,
            hasUnsavedChanges: false
        });
        const regeneratedBoard = {
            valid: true,
            title: 'Regenerated',
            columns: [],
            yamlHeader: '---\nkanban-plugin: board\n---',
            kanbanFooter: null
        };

        const { service, board, saveFile, fileRegistry, setBoard, sendBoardUpdate } = createServiceHarness({
            mainFile,
            includeFiles: [],
            generatedBoard: regeneratedBoard
        });

        jest.spyOn(service as any, '_showPresaveConflictDialog')
            .mockResolvedValue({
                cancelled: false,
                snapshotToken: 'token',
                perFileResolutions: [
                    {
                        path: mainFile.getPath(),
                        action: 'load_external'
                    }
                ]
            });
        jest.spyOn(service as any, '_validateConflictSnapshotToken').mockReturnValue(null);

        const result = await service.saveUnified({
            scope: 'main',
            board: board as any,
            updateUi: false,
            updateBaselines: false
        });

        expect(mainFile.reload).toHaveBeenCalledTimes(1);
        expect(fileRegistry.generateBoard).toHaveBeenCalled();
        expect(setBoard).toHaveBeenCalledWith(regeneratedBoard);
        expect(sendBoardUpdate).toHaveBeenCalledWith(false, true);
        expect(saveFile).not.toHaveBeenCalled();
        expect(result.success).toBe(false);
        expect(result.aborted).toBe(true);
        expect(result.error).toContain('external versions were loaded');
    });

    it('aborts save when one writable include file maps to conflicting board content sources', async () => {
        const mainFile = createMockFile({
            path: '/workspace/board.md',
            relativePath: 'board.md',
            fileType: 'main',
            hasExternalChanges: false
        });
        const sharedInclude = createMockFile({
            path: '/workspace/includes/shared.md',
            relativePath: 'includes/shared.md',
            fileType: 'include-column',
            hasExternalChanges: false,
            hasUnsavedChanges: true
        });
        sharedInclude.generateFromTasks.mockImplementation((tasks: unknown[]) =>
            (tasks as Array<{ content?: string }>).map(task => getCardSummaryLine(task.content || '')).join('|')
        );

        const conflictingBoard = {
            valid: true,
            title: 'Board',
            yamlHeader: '---\nkanban-plugin: board\n---',
            kanbanFooter: null,
            columns: [
                {
                    id: 'col-a',
                    title: 'A',
                    cards: [{ id: 'task-a', content: 'Alpha' }],
                    includeFiles: ['includes/shared.md']
                },
                {
                    id: 'col-b',
                    title: 'B',
                    cards: [{ id: 'task-b', content: 'Beta' }],
                    includeFiles: ['includes/shared.md']
                }
            ]
        };

        const { service, saveFile } = createServiceHarness({
            mainFile,
            includeFiles: [sharedInclude]
        });

        const result = await service.saveUnified({
            scope: 'all',
            board: conflictingBoard as any,
            syncIncludes: true,
            updateUi: false,
            updateBaselines: false
        });

        expect(result.success).toBe(false);
        expect(result.aborted).toBe(true);
        expect(result.error).toContain('ambiguous include content detected');
        expect(saveFile).not.toHaveBeenCalled();
    });

    it('allows save when repeated writable include references generate identical content', async () => {
        const mainFile = createMockFile({
            path: '/workspace/board.md',
            relativePath: 'board.md',
            fileType: 'main',
            hasExternalChanges: false
        });
        const sharedInclude = createMockFile({
            path: '/workspace/includes/shared.md',
            relativePath: 'includes/shared.md',
            fileType: 'include-column',
            hasExternalChanges: false,
            hasUnsavedChanges: true
        });
        sharedInclude.generateFromTasks.mockImplementation((tasks: unknown[]) =>
            (tasks as Array<{ content?: string }>).map(task => getCardSummaryLine(task.content || '')).join('|')
        );

        const deterministicBoard = {
            valid: true,
            title: 'Board',
            yamlHeader: '---\nkanban-plugin: board\n---',
            kanbanFooter: null,
            columns: [
                {
                    id: 'col-a',
                    title: 'A',
                    cards: [{ id: 'task-a', content: 'Alpha' }],
                    includeFiles: ['includes/shared.md']
                },
                {
                    id: 'col-b',
                    title: 'B',
                    cards: [{ id: 'task-b', content: 'Alpha' }],
                    includeFiles: ['includes/shared.md']
                }
            ]
        };

        const { service, saveFile } = createServiceHarness({
            mainFile,
            includeFiles: [sharedInclude]
        });

        const result = await service.saveUnified({
            scope: 'all',
            board: deterministicBoard as any,
            syncIncludes: true,
            updateUi: false,
            updateBaselines: false
        });

        expect(result.success).toBe(true);
        expect(result.aborted).toBe(false);
        expect(saveFile).toHaveBeenCalledTimes(2);
    });

    it('aborts scope=all before main write when include save fails', async () => {
        const mainFile = createMockFile({
            path: '/workspace/board.md',
            relativePath: 'board.md',
            fileType: 'main',
            hasExternalChanges: false
        });
        const includeFile = createMockFile({
            path: '/workspace/includes/item.md',
            relativePath: 'includes/item.md',
            fileType: 'include-column',
            hasUnsavedChanges: true,
            hasExternalChanges: false
        });

        const { service, board, saveFile } = createServiceHarness({
            mainFile,
            includeFiles: [includeFile]
        });

        saveFile.mockImplementation(async (file: MockMarkdownFile) => {
            if (file.getPath() === includeFile.getPath()) {
                throw new Error('simulated include write failure');
            }
            return undefined;
        });

        const result = await service.saveUnified({
            scope: 'all',
            syncIncludes: false,
            board: board as any,
            updateUi: false,
            updateBaselines: false
        });

        expect(result.success).toBe(false);
        expect(result.aborted).toBe(true);
        expect(result.savedMainFile).toBe(false);
        expect(result.error).toContain('Main file was not saved');
        expect(result.includeSaveErrors).toHaveLength(1);
        expect(result.includeSaveErrors[0]).toContain(includeFile.getPath());

        const savedPaths = saveFile.mock.calls.map(call => call[0].getPath());
        expect(savedPaths).toEqual([includeFile.getPath()]);
    });

    it('writes include files before main file for scope=all', async () => {
        const mainFile = createMockFile({
            path: '/workspace/board.md',
            relativePath: 'board.md',
            fileType: 'main',
            hasExternalChanges: false
        });
        const includeFile = createMockFile({
            path: '/workspace/includes/item.md',
            relativePath: 'includes/item.md',
            fileType: 'include-column',
            hasUnsavedChanges: true,
            hasExternalChanges: false
        });

        const { service, board, saveFile } = createServiceHarness({
            mainFile,
            includeFiles: [includeFile]
        });

        const result = await service.saveUnified({
            scope: 'all',
            syncIncludes: false,
            board: board as any,
            updateUi: false,
            updateBaselines: false
        });

        expect(result.success).toBe(true);
        expect(result.aborted).toBe(false);
        expect(result.savedMainFile).toBe(true);
        expect(saveFile).toHaveBeenCalledTimes(2);

        const savedPaths = saveFile.mock.calls.map(call => call[0].getPath());
        expect(savedPaths).toEqual([includeFile.getPath(), mainFile.getPath()]);
    });

    it('aborts main save before writing when target file remains permission-blocked', async () => {
        const mainFile = createMockFile({
            path: '/workspace/board.md',
            relativePath: 'board.md',
            fileType: 'main',
            hasExternalChanges: false
        });
        mainFile.getLastAccessErrorCode.mockReturnValue('EACCES');
        mainFile.readFromDisk.mockResolvedValue(null);

        const { service, board, saveFile } = createServiceHarness({
            mainFile,
            includeFiles: []
        });

        const result = await service.saveUnified({
            scope: 'main',
            board: board as any,
            updateUi: false,
            updateBaselines: false
        });

        expect(result.success).toBe(false);
        expect(result.aborted).toBe(true);
        expect(result.error).toContain('permission errors');
        expect(saveFile).not.toHaveBeenCalled();
    });

    it('aborts before writing when write-access probe reports blocked target', async () => {
        const mainFile = createMockFile({
            path: '/workspace/board.md',
            relativePath: 'board.md',
            fileType: 'main',
            hasExternalChanges: false
        });
        mainFile.probeWriteAccess.mockResolvedValue('EACCES');

        const { service, board, saveFile } = createServiceHarness({
            mainFile,
            includeFiles: []
        });

        const result = await service.saveUnified({
            scope: 'main',
            board: board as any,
            updateUi: false,
            updateBaselines: false
        });

        expect(result.success).toBe(false);
        expect(result.aborted).toBe(true);
        expect(result.error).toContain('permission errors');
        expect(saveFile).not.toHaveBeenCalled();
    });

    it('does not block save when stale permission error clears during preflight refresh', async () => {
        const mainFile = createMockFile({
            path: '/workspace/board.md',
            relativePath: 'board.md',
            fileType: 'main',
            hasExternalChanges: false
        });

        let accessCode: string | null = 'EACCES';
        mainFile.getLastAccessErrorCode.mockImplementation(() => accessCode);
        mainFile.readFromDisk.mockImplementation(async () => {
            accessCode = null;
            return 'disk-content';
        });

        const { service, board, saveFile } = createServiceHarness({
            mainFile,
            includeFiles: []
        });

        const result = await service.saveUnified({
            scope: 'main',
            board: board as any,
            updateUi: false,
            updateBaselines: false
        });

        expect(result.success).toBe(true);
        expect(result.aborted).toBe(false);
        expect(saveFile).toHaveBeenCalledTimes(1);
    });

    it('aborts scope=all before any write when a targeted include file is permission-blocked', async () => {
        const mainFile = createMockFile({
            path: '/workspace/board.md',
            relativePath: 'board.md',
            fileType: 'main',
            hasExternalChanges: false
        });
        const includeFile = createMockFile({
            path: '/workspace/includes/blocked.md',
            relativePath: 'includes/blocked.md',
            fileType: 'include-column',
            hasUnsavedChanges: true,
            hasExternalChanges: false
        });
        includeFile.getLastAccessErrorCode.mockReturnValue('EPERM');
        includeFile.readFromDisk.mockResolvedValue(null);

        const { service, board, saveFile } = createServiceHarness({
            mainFile,
            includeFiles: [includeFile]
        });

        const result = await service.saveUnified({
            scope: 'all',
            syncIncludes: false,
            board: board as any,
            updateUi: false,
            updateBaselines: false
        });

        expect(result.success).toBe(false);
        expect(result.aborted).toBe(true);
        expect(result.error).toContain('permission errors');
        expect(saveFile).not.toHaveBeenCalled();
    });

    it('does not block scope=all when include permission error exists on a non-targeted clean include', async () => {
        const mainFile = createMockFile({
            path: '/workspace/board.md',
            relativePath: 'board.md',
            fileType: 'main',
            hasExternalChanges: false
        });
        const includeFile = createMockFile({
            path: '/workspace/includes/blocked.md',
            relativePath: 'includes/blocked.md',
            fileType: 'include-column',
            hasUnsavedChanges: false,
            hasExternalChanges: false
        });
        includeFile.getLastAccessErrorCode.mockReturnValue('EPERM');

        const { service, board, saveFile } = createServiceHarness({
            mainFile,
            includeFiles: [includeFile]
        });

        const result = await service.saveUnified({
            scope: 'all',
            syncIncludes: false,
            board: board as any,
            updateUi: false,
            updateBaselines: false
        });

        expect(result.success).toBe(true);
        expect(result.aborted).toBe(false);
        expect(saveFile).toHaveBeenCalledTimes(1);
        expect(saveFile).toHaveBeenCalledWith(mainFile, undefined, expect.objectContaining({
            source: 'ui-edit'
        }));
    });

    it('allows file-scoped save for include files', async () => {
        const mainFile = createMockFile({
            path: '/workspace/board.md',
            relativePath: 'board.md',
            fileType: 'main'
        });
        const includeFile = createMockFile({
            path: '/workspace/includes/reference.md',
            relativePath: 'includes/reference.md',
            fileType: 'include-column',
            hasUnsavedChanges: true
        });

        const { service, saveFile } = createServiceHarness({
            mainFile,
            includeFiles: [includeFile]
        });

        const result = await service.saveUnified({
            scope: { filePath: includeFile.getRelativePath() },
            updateUi: false,
            updateBaselines: false
        });

        expect(result.success).toBe(true);
        expect(result.aborted).toBe(false);
        expect(saveFile).toHaveBeenCalledTimes(1);
        expect(saveFile).toHaveBeenCalledWith(includeFile, undefined, expect.objectContaining({
            source: 'ui-edit'
        }));
    });
});
