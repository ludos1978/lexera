import { WatcherCoordinator } from '../../files/WatcherCoordinator';

function uniquePath(prefix: string): string {
    return `/tmp/${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.md`;
}

describe('WatcherCoordinator', () => {
    it('queues operations for the same file and starts the next after endOperation', async () => {
        const coordinator = WatcherCoordinator.getInstance();
        const filePath = uniquePath('watcher-queue');
        let queuedStarted = false;

        await coordinator.startOperation(filePath, 'save', 500);

        const queuedPromise = coordinator.startOperation(filePath, 'reload', 500).then(() => {
            queuedStarted = true;
        });

        await new Promise(resolve => setTimeout(resolve, 25));
        expect(queuedStarted).toBe(false);

        coordinator.endOperation(filePath, 'save');
        await queuedPromise;
        expect(queuedStarted).toBe(true);

        coordinator.endOperation(filePath, 'reload');
    });

    it('releases queued operations when the active operation times out', async () => {
        const coordinator = WatcherCoordinator.getInstance();
        const filePath = uniquePath('watcher-timeout');

        await coordinator.startOperation(filePath, 'save', 40);

        let queuedStarted = false;
        const queuedPromise = coordinator.startOperation(filePath, 'reload', 200).then(() => {
            queuedStarted = true;
        });

        await new Promise(resolve => setTimeout(resolve, 80));
        expect(queuedStarted).toBe(true);

        await queuedPromise;
        coordinator.endOperation(filePath, 'reload');
    });
});
