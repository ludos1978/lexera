import { MarkdownFileRegistry } from '../../files/MarkdownFileRegistry';

type RegistryFile = {
    getPath: jest.Mock<string, []>;
    getRelativePath: jest.Mock<string, []>;
    getNormalizedRelativePath: jest.Mock<string, []>;
    getFileType: jest.Mock<'main' | 'include-column' | 'include-task' | 'include-regular', []>;
    onDidChange: jest.Mock;
    dispose: jest.Mock<void, []>;
};

function createRegistryFile(path: string, normalizedRelativePath: string): RegistryFile {
    return {
        getPath: jest.fn(() => path),
        getRelativePath: jest.fn(() => normalizedRelativePath),
        getNormalizedRelativePath: jest.fn(() => normalizedRelativePath),
        getFileType: jest.fn(() => 'include-task'),
        onDidChange: jest.fn(() => ({ dispose: jest.fn() })),
        dispose: jest.fn()
    };
}

function createRegistry(): MarkdownFileRegistry {
    return new MarkdownFileRegistry({ fileSaveService: {} } as any);
}

describe('MarkdownFileRegistry.register', () => {
    it('removes stale absolute entries when a relative-path collision replaces a file instance', () => {
        const registry = createRegistry();
        const oldFile = createRegistryFile('/workspace/includes/a.md', 'includes/a.md');
        const newFile = createRegistryFile('/workspace/includes/a-renamed.md', 'includes/a.md');

        registry.register(oldFile as any);
        registry.register(newFile as any);

        expect(oldFile.dispose).toHaveBeenCalledTimes(1);
        expect(registry.get('/workspace/includes/a.md')).toBeUndefined();
        expect(registry.get('/workspace/includes/a-renamed.md')).toBe(newFile);
        expect(registry.getByRelativePath('includes/a.md')).toBe(newFile);
        expect(registry.getConsistencyReport().issueCount).toBe(0);
    });

    it('re-indexes the same file instance when its absolute path changes', () => {
        const registry = createRegistry();
        let currentPath = '/workspace/board.md';
        const file = createRegistryFile(currentPath, 'board.md');
        file.getPath.mockImplementation(() => currentPath);

        registry.register(file as any);
        currentPath = '/workspace/renamed-board.md';
        registry.register(file as any);

        expect(registry.get('/workspace/board.md')).toBeUndefined();
        expect(registry.get('/workspace/renamed-board.md')).toBe(file);
        expect(registry.getByRelativePath('board.md')).toBe(file);
        expect(registry.getConsistencyReport().issueCount).toBe(0);
    });
});
