import { MarkdownFileRegistry } from '../../files/MarkdownFileRegistry';

type ReportFile = {
    getPath: jest.Mock<string, []>;
    getRelativePath: jest.Mock<string, []>;
    getNormalizedRelativePath: jest.Mock<string, []>;
};

function createReportFile(path: string, relativePath: string, normalizedRelativePath: string): ReportFile {
    return {
        getPath: jest.fn(() => path),
        getRelativePath: jest.fn(() => relativePath),
        getNormalizedRelativePath: jest.fn(() => normalizedRelativePath)
    };
}

function createRegistryForReport(): any {
    const registry: any = Object.create(MarkdownFileRegistry.prototype);
    registry._files = new Map<string, unknown>();
    registry._filesByRelativePath = new Map<string, unknown>();
    return registry;
}

describe('MarkdownFileRegistry.getConsistencyReport', () => {
    it('reports no issues for aligned absolute and relative indexes', () => {
        const registry = createRegistryForReport();
        const file = createReportFile('/workspace/board.md', 'board.md', 'board.md');

        registry._files.set('/workspace/board.md', file);
        registry._filesByRelativePath.set('board.md', file);

        const report = (registry as MarkdownFileRegistry).getConsistencyReport();
        expect(report.issueCount).toBe(0);
        expect(report.issues).toEqual([]);
    });

    it('detects stale absolute map keys', () => {
        const registry = createRegistryForReport();
        const file = createReportFile('/workspace/new-board.md', 'board.md', 'board.md');

        registry._files.set('/workspace/old-board.md', file);
        registry._filesByRelativePath.set('board.md', file);

        const report = (registry as MarkdownFileRegistry).getConsistencyReport();
        expect(report.issueCount).toBeGreaterThan(0);
        expect(report.issues.some((issue: { code: string }) => issue.code === 'absolute-key-stale')).toBe(true);
    });

    it('detects duplicate absolute entries for the same file instance', () => {
        const registry = createRegistryForReport();
        const file = createReportFile('/workspace/board.md', 'board.md', 'board.md');

        registry._files.set('/workspace/board.md', file);
        registry._files.set('/workspace/board-copy.md', file);
        registry._filesByRelativePath.set('board.md', file);

        const report = (registry as MarkdownFileRegistry).getConsistencyReport();
        expect(report.issueCount).toBeGreaterThan(0);
        expect(report.issues.some((issue: { code: string }) => issue.code === 'duplicate-absolute-entries')).toBe(true);
    });

    it('detects relative index entries pointing to files missing from absolute index', () => {
        const registry = createRegistryForReport();
        const file = createReportFile('/workspace/board.md', 'board.md', 'board.md');

        registry._filesByRelativePath.set('board.md', file);

        const report = (registry as MarkdownFileRegistry).getConsistencyReport();
        expect(report.issueCount).toBeGreaterThan(0);
        expect(report.issues.some((issue: { code: string }) => issue.code === 'orphan-relative-entry')).toBe(true);
    });
});
