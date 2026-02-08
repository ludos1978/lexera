/**
 * Watcher Coordinator
 *
 * Centralized coordination for file watcher operations.
 * Prevents conflicts between concurrent file operations.
 *
 * @module files/WatcherCoordinator
 */

import { normalizePathForLookup } from '../utils/stringUtils';
import { WATCHER_TIMEOUT_MS } from '../constants/TimeoutConstants';

/**
 * Active operation data
 */
interface ActiveOperation {
    operation: string;
    startTime: Date;
    timeout: NodeJS.Timeout;
}

/**
 * Queued operation data
 */
interface QueuedOperation {
    operation: string;
    filePath: string;
    timeoutMs: number;
    resolve: () => void;
    reject: (error: Error) => void;
}

/**
 * Coordinates file watcher operations to prevent conflicts.
 * Queues operations when a file is already being operated on.
 */
export class WatcherCoordinator {
    private static instance: WatcherCoordinator | undefined;
    // Note: Uses centralized WATCHER_TIMEOUT_MS from TimeoutConstants

    // Track active operations per file
    private activeOperations = new Map<string, ActiveOperation>();

    // Queue operations when conflicts occur
    private operationQueue = new Map<string, QueuedOperation[]>();

    private constructor() {}

    public static getInstance(): WatcherCoordinator {
        if (!WatcherCoordinator.instance) {
            WatcherCoordinator.instance = new WatcherCoordinator();
        }
        return WatcherCoordinator.instance;
    }

    /**
     * Start an operation with conflict detection.
     * If another operation is active, queues this one.
     */
    async startOperation(filePath: string, operation: string, timeoutMs?: number): Promise<void> {
        const timeout = timeoutMs ?? WATCHER_TIMEOUT_MS;
        const normalizedPath = normalizePathForLookup(filePath);
        const existing = this.activeOperations.get(normalizedPath);

        if (existing) {
            // Queue the operation
            return new Promise((resolve, reject) => {
                const queue = this.operationQueue.get(normalizedPath) ?? [];
                queue.push({
                    operation,
                    filePath,
                    timeoutMs: timeout,
                    resolve,
                    reject: (error: Error) => reject(error)
                });
                this.operationQueue.set(normalizedPath, queue);
            });
        }

        // Start the operation immediately when no active operation exists.
        return this._activateOperation(normalizedPath, filePath, operation, timeout);
    }

    /**
     * End an operation and process queued operations
     */
    endOperation(filePath: string, operation: string): void {
        const normalizedPath = normalizePathForLookup(filePath);
        const existing = this.activeOperations.get(normalizedPath);

        if (existing && existing.operation === operation) {
            clearTimeout(existing.timeout);
            this.activeOperations.delete(normalizedPath);
            this._startNextQueuedOperation(normalizedPath);
            return;
        }

        if (existing && existing.operation !== operation) {
            console.warn(
                `[WatcherCoordinator] Ignored endOperation("${operation}") for ${normalizedPath}; `
                + `active operation is "${existing.operation}".`
            );
        }
    }

    private _startNextQueuedOperation(normalizedPath: string): void {
        const queue = this.operationQueue.get(normalizedPath);
        if (!queue || queue.length === 0) {
            this.operationQueue.delete(normalizedPath);
            return;
        }

        const next = queue.shift()!;
        if (queue.length === 0) {
            this.operationQueue.delete(normalizedPath);
        }

        this._activateOperation(normalizedPath, next.filePath, next.operation, next.timeoutMs)
            .then(() => next.resolve())
            .catch(error => {
                next.reject(error);
            });
    }

    private async _activateOperation(
        normalizedPath: string,
        filePath: string,
        operation: string,
        timeoutMs: number
    ): Promise<void> {
        return new Promise((resolve, reject) => {
            const timeoutHandle = setTimeout(() => {
                console.error(`[WatcherCoordinator] Operation "${operation}" timed out on ${normalizedPath}`);
                this.endOperation(filePath, operation);
                reject(new Error(`Operation timeout: ${operation}`));
            }, timeoutMs);

            this.activeOperations.set(normalizedPath, {
                operation,
                startTime: new Date(),
                timeout: timeoutHandle
            });

            resolve();
        });
    }
}
