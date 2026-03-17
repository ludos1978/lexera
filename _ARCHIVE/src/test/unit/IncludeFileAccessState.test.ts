import * as fs from 'fs';
import * as path from 'path';
import { IncludeFile } from '../../files/IncludeFile';
import { ConflictResolver } from '../../services/ConflictResolver';

function createIncludeFile(): IncludeFile {
    const parentFile = {
        getPath: () => '/tmp/board.md',
        getFileRegistry: () => undefined
    };

    return new IncludeFile(
        'includes/test.md',
        parentFile as any,
        new ConflictResolver('test-panel'),
        {} as any,
        'include-column'
    );
}

describe('IncludeFile access state tracking', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('marks file as missing when read fails with ENOENT', async () => {
        const file = createIncludeFile();
        jest.spyOn(fs.promises, 'readFile').mockRejectedValueOnce(
            Object.assign(new Error('missing'), { code: 'ENOENT' })
        );

        const content = await file.readFromDisk();

        expect(content).toBeNull();
        expect(file.exists()).toBe(false);
        expect(file.getLastAccessErrorCode()).toBe('ENOENT');
    });

    it('records permission errors without marking the file as missing', async () => {
        const file = createIncludeFile();
        jest.spyOn(fs.promises, 'readFile').mockRejectedValueOnce(
            Object.assign(new Error('denied'), { code: 'EACCES' })
        );

        const content = await file.readFromDisk();

        expect(content).toBeNull();
        expect(file.exists()).toBe(true);
        expect(file.getLastAccessErrorCode()).toBe('EACCES');
    });

    it('clears access errors after a successful read', async () => {
        const file = createIncludeFile();
        jest.spyOn(fs.promises, 'readFile')
            .mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'EACCES' }))
            .mockResolvedValueOnce('content');

        await file.readFromDisk();
        const content = await file.readFromDisk();

        expect(content).toBe('content');
        expect(file.exists()).toBe(true);
        expect(file.getLastAccessErrorCode()).toBeNull();
    });

    it('re-resolves absolute path when parent file path changes', () => {
        let parentPath = '/tmp/project-a/board.md';
        const parentFile = {
            getPath: () => parentPath,
            getFileRegistry: () => undefined
        };

        const file = new IncludeFile(
            'includes/test.md',
            parentFile as any,
            new ConflictResolver('test-panel'),
            {} as any,
            'include-column'
        );

        expect(file.getPath()).toBe(path.resolve('/tmp/project-a', 'includes/test.md'));

        parentPath = '/tmp/project-b/board.md';
        expect(file.getPath()).toBe(path.resolve('/tmp/project-b', 'includes/test.md'));
    });

    it('uses refreshed parent-relative path for disk reads', async () => {
        let parentPath = '/tmp/project-a/board.md';
        const parentFile = {
            getPath: () => parentPath,
            getFileRegistry: () => undefined
        };

        const file = new IncludeFile(
            'includes/test.md',
            parentFile as any,
            new ConflictResolver('test-panel'),
            {} as any,
            'include-column'
        );

        parentPath = '/tmp/project-b/board.md';
        const readSpy = jest.spyOn(fs.promises, 'readFile').mockResolvedValue('content');

        await file.readFromDisk();

        expect(readSpy).toHaveBeenCalledWith(path.resolve('/tmp/project-b', 'includes/test.md'), 'utf-8');
    });
});
