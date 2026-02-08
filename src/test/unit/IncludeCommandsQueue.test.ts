import { IncludeCommands } from '../../commands/IncludeCommands';

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

describe('IncludeCommands file action queue', () => {
    it('serializes queued file actions in submission order', async () => {
        const commands = new IncludeCommands() as any;
        const enqueue = commands._enqueueFileAction.bind(commands) as (action: () => Promise<{ success: boolean }>) => Promise<{ success: boolean }>;
        const steps: string[] = [];

        const first = enqueue(async () => {
            steps.push('start:first');
            await delay(25);
            steps.push('end:first');
            return { success: true };
        });

        const second = enqueue(async () => {
            steps.push('start:second');
            await delay(1);
            steps.push('end:second');
            return { success: true };
        });

        await Promise.all([first, second]);

        expect(steps).toEqual([
            'start:first',
            'end:first',
            'start:second',
            'end:second'
        ]);
    });

    it('continues processing queue after a failed action', async () => {
        const commands = new IncludeCommands() as any;
        const enqueue = commands._enqueueFileAction.bind(commands) as (action: () => Promise<{ success: boolean }>) => Promise<{ success: boolean }>;
        let secondRan = false;

        const first = enqueue(async () => {
            throw new Error('intentional failure');
        });

        const second = enqueue(async () => {
            secondRan = true;
            return { success: true };
        });

        await expect(first).rejects.toThrow('intentional failure');
        await expect(second).resolves.toEqual({ success: true });
        expect(secondRan).toBe(true);
    });

    it('revalidates snapshot at execution time for queued saves', async () => {
        const commands = new IncludeCommands() as any;
        const staleError = 'Action blocked: file states changed since the last refresh.';
        const postMessage = jest.fn();
        commands.postMessage = postMessage;

        let stateChanged = false;
        commands._validateSnapshotToken = jest.fn(() => (stateChanged ? staleError : null));
        commands.handleSaveIndividualFile = jest.fn(async () => {
            await delay(20);
            stateChanged = true;
            return { success: true };
        });

        const context = {} as any;
        const first = commands.handleQueuedSaveIndividualFile({
            filePath: 'a.md',
            isMainFile: false,
            forceSave: false,
            action: 'overwrite',
            snapshotToken: 'token-1'
        }, context);

        const second = commands.handleQueuedSaveIndividualFile({
            filePath: 'b.md',
            isMainFile: false,
            forceSave: false,
            action: 'overwrite',
            snapshotToken: 'token-1'
        }, context);

        await Promise.all([first, second]);

        expect(commands.handleSaveIndividualFile).toHaveBeenCalledTimes(1);
        expect(postMessage).toHaveBeenCalledWith({
            type: 'individualFileSaved',
            filePath: 'b.md',
            isMainFile: false,
            success: false,
            forceSave: false,
            action: 'overwrite',
            error: staleError
        });
    });

    it('revalidates snapshot at execution time for queued reloads', async () => {
        const commands = new IncludeCommands() as any;
        const staleError = 'Action blocked: file states changed since the last refresh.';
        const postMessage = jest.fn();
        commands.postMessage = postMessage;

        let stateChanged = false;
        commands._validateSnapshotToken = jest.fn(() => (stateChanged ? staleError : null));
        commands.handleReloadIndividualFile = jest.fn(async () => {
            await delay(20);
            stateChanged = true;
            return { success: true };
        });

        const context = {} as any;
        const first = commands.handleQueuedReloadIndividualFile({
            filePath: 'a.md',
            isMainFile: false,
            action: 'load_external',
            snapshotToken: 'token-1'
        }, context);

        const second = commands.handleQueuedReloadIndividualFile({
            filePath: 'b.md',
            isMainFile: false,
            action: 'load_external',
            snapshotToken: 'token-1'
        }, context);

        await Promise.all([first, second]);

        expect(commands.handleReloadIndividualFile).toHaveBeenCalledTimes(1);
        expect(postMessage).toHaveBeenCalledWith({
            type: 'individualFileReloaded',
            filePath: 'b.md',
            isMainFile: false,
            success: false,
            action: 'load_external',
            error: staleError
        });
    });
});
