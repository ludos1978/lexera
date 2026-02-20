import { MainKanbanFile } from '../../files/MainKanbanFile';
import { ConflictResolver } from '../../services/ConflictResolver';
import { KanbanBoard } from '../../board/KanbanTypes';

function createBoard(): KanbanBoard {
    return {
        valid: true,
        title: 'Board',
        yamlHeader: '---\nkanban-plugin: board\n---',
        kanbanFooter: null,
        columns: [
            {
                id: 'column-1',
                title: 'Todo',
                cards: [
                    {
                        id: 'task-1',
                        content: 'Task A\nDescription A'
                    }
                ]
            }
        ]
    };
}

class TestMainKanbanFile extends MainKanbanFile {
    public writtenContent: string | null = null;

    constructor(filePath: string) {
        const fileManager = {
            getDocument: jest.fn(() => undefined)
        };
        const fileRegistry = {
            getMainFile: jest.fn(() => undefined),
            getIncludeFiles: jest.fn(() => []),
            getAll: jest.fn(() => [])
        };
        super(filePath, fileManager as any, new ConflictResolver('panel-test'), {} as any, fileRegistry as any);
    }

    public async readFromDisk(): Promise<string | null> {
        return this.writtenContent;
    }

    public async writeToDisk(content: string): Promise<void> {
        this.writtenContent = content;
    }

    public validate(_content: string): { valid: boolean; errors?: string[] } {
        return { valid: true };
    }

    protected async _getFileModifiedTime(): Promise<Date | null> {
        return new Date('2026-01-01T00:00:00.000Z');
    }
}

describe('MainKanbanFile.save serialization validation', () => {
    it('fails closed when cached board snapshot is invalid', async () => {
        const file = new TestMainKanbanFile('/tmp/main-save-validation-invalid-board.md');
        const invalidBoard = {
            valid: false,
            columns: []
        } as unknown as KanbanBoard;
        file.setCachedBoardFromWebview(invalidBoard);

        await expect(file.save({ skipValidation: true, skipReloadDetection: false }))
            .rejects
            .toThrow('Refusing to save invalid board snapshot');

        expect(file.writtenContent).toBeNull();
    });

    it('warns but saves when generated markdown does not round-trip to the same persisted shape', async () => {
        const file = new TestMainKanbanFile('/tmp/main-save-validation-mismatch.md');
        const board = createBoard();
        file.setCachedBoardFromWebview(board);

        (file as any)._parser = {
            generateMarkdown: jest.fn(() => 'generated-content'),
            parseMarkdown: jest.fn(() => ({
                board: {
                    ...createBoard(),
                    columns: []
                },
                includedFiles: [],
                columnIncludeFiles: [],
                taskIncludeFiles: []
            })),
            updateYamlWithBoardSettings: jest.fn((yamlHeader: string | null) => yamlHeader ?? '---\nkanban-plugin: board\n---')
        };

        // With the forced save behavior, save should succeed even with mismatch (logs warning instead)
        const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

        await expect(file.save({ skipValidation: true, skipReloadDetection: false }))
            .resolves
            .toBeUndefined();

        // Content should be written despite mismatch
        expect(file.writtenContent).toBe('generated-content');
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Save serialization mismatch'));

        consoleSpy.mockRestore();
    });

    it('saves when generated markdown round-trips to the same persisted shape', async () => {
        const file = new TestMainKanbanFile('/tmp/main-save-validation-ok.md');
        const board = createBoard();
        file.setCachedBoardFromWebview(board);

        (file as any)._parser = {
            generateMarkdown: jest.fn(() => 'generated-content'),
            parseMarkdown: jest.fn(() => ({
                board: createBoard(),
                includedFiles: [],
                columnIncludeFiles: [],
                taskIncludeFiles: []
            })),
            updateYamlWithBoardSettings: jest.fn((yamlHeader: string | null) => yamlHeader ?? '---\nkanban-plugin: board\n---')
        };

        await expect(file.save({ skipValidation: true, skipReloadDetection: false }))
            .resolves
            .toBeUndefined();

        expect(file.writtenContent).toBe('generated-content');
        expect(file.getBaseline()).toBe('generated-content');
    });
});
