import { computeTrackedFilesSnapshotToken } from '../../utils/fileStateSnapshot';
import { MarkdownFileRegistry } from '../../files/MarkdownFileRegistry';

type SnapshotFile = {
    getPath: () => string;
    getFileType: () => string;
    exists: () => boolean;
    hasExternalChanges: () => boolean;
    hasUnsavedChanges: () => boolean;
    hasAnyUnsavedChanges: () => boolean;
    isDirtyInEditor: () => boolean;
    isInEditMode: () => boolean;
    getContent: () => string;
    getBaseline: () => string;
};

function createRegistry(files: SnapshotFile[]): MarkdownFileRegistry {
    return {
        getAll: () => files
    } as unknown as MarkdownFileRegistry;
}

function createFile(path: string, overrides: Partial<SnapshotFile> = {}): SnapshotFile {
    const defaults: SnapshotFile = {
        getPath: () => path,
        getFileType: () => 'include-task',
        exists: () => true,
        hasExternalChanges: () => false,
        hasUnsavedChanges: () => false,
        hasAnyUnsavedChanges: () => false,
        isDirtyInEditor: () => false,
        isInEditMode: () => false,
        getContent: () => 'content',
        getBaseline: () => 'content'
    };
    return {
        ...defaults,
        ...overrides
    };
}

describe('computeTrackedFilesSnapshotToken', () => {
    it('is deterministic regardless of file ordering', () => {
        const fileA = createFile('/tmp/a.md');
        const fileB = createFile('/tmp/b.md');

        const token1 = computeTrackedFilesSnapshotToken(createRegistry([fileA, fileB]));
        const token2 = computeTrackedFilesSnapshotToken(createRegistry([fileB, fileA]));

        expect(token1).toBe(token2);
    });

    it('changes when tracked file state changes', () => {
        const cleanFile = createFile('/tmp/a.md');
        const changedFile = createFile('/tmp/a.md', {
            hasExternalChanges: () => true
        });

        const token1 = computeTrackedFilesSnapshotToken(createRegistry([cleanFile]));
        const token2 = computeTrackedFilesSnapshotToken(createRegistry([changedFile]));

        expect(token1).not.toBe(token2);
    });
});
