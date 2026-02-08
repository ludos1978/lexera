import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { writeFileAtomically } from '../../utils/atomicWrite';

describe('writeFileAtomically', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('includes cleanup errors in the thrown message when temp cleanup fails', async () => {
        jest.spyOn(fs.promises, 'mkdir').mockResolvedValue(undefined as any);
        jest.spyOn(fs.promises, 'open').mockRejectedValue(new Error('open failed'));
        jest.spyOn(fs.promises, 'unlink').mockRejectedValue(
            Object.assign(new Error('unlink denied'), { code: 'EACCES' })
        );

        await expect(
            writeFileAtomically('/tmp/atomic-write-cleanup-failure.md', 'content', { maxAttempts: 1 })
        ).rejects.toThrow('Cleanup errors');
    });

    it('writes content successfully in normal operation', async () => {
        const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'atomic-write-test-'));
        const targetPath = path.join(dir, 'board.md');
        const content = 'hello atomic write';

        await writeFileAtomically(targetPath, content, { maxAttempts: 2 });

        const written = await fs.promises.readFile(targetPath, 'utf-8');
        expect(written).toBe(content);
    });
});

