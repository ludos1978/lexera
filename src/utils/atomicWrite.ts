import * as fs from 'fs';
import * as path from 'path';
import { logger } from './logger';

export interface AtomicWriteOptions {
    encoding?: BufferEncoding;
    maxAttempts?: number;
}

const DEFAULT_MAX_ATTEMPTS = 6;

function formatError(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}

function buildTempPath(targetPath: string, attempt: number): string {
    const dir = path.dirname(targetPath);
    const ext = path.extname(targetPath);
    const base = path.basename(targetPath, ext);
    const now = Date.now();
    const random = Math.random().toString(36).slice(2, 8);
    const suffix = ext || '.tmp';
    return path.join(dir, `.${base}.write-${process.pid}-${now}-${attempt}-${random}${suffix}`);
}

async function fsyncDirectoryIfPossible(dirPath: string): Promise<void> {
    let dirHandle: fs.promises.FileHandle | undefined;
    try {
        dirHandle = await fs.promises.open(dirPath, 'r');
        await dirHandle.sync();
    } catch (error) {
        // Best effort only. Some platforms/filesystems do not support syncing directories.
        logger.warn(`[atomicWrite] Directory fsync skipped for "${dirPath}": ${formatError(error)}`);
    } finally {
        if (dirHandle) {
            try {
                await dirHandle.close();
            } catch (closeError) {
                logger.warn(`[atomicWrite] Failed to close directory handle for "${dirPath}": ${formatError(closeError)}`);
            }
        }
    }
}

/**
 * Crash-safer write: write to a unique temp file, fsync temp, rename over target, fsync directory.
 * Fails closed if replacement cannot be completed, preserving original file contents.
 */
export async function writeFileAtomically(
    targetPath: string,
    content: string,
    options: AtomicWriteOptions = {}
): Promise<void> {
    const encoding = options.encoding ?? 'utf-8';
    const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    const targetDir = path.dirname(targetPath);
    await fs.promises.mkdir(targetDir, { recursive: true });

    let lastError: unknown;
    let lastCleanupErrors: string[] = [];

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const tempPath = buildTempPath(targetPath, attempt);
        let tempHandle: fs.promises.FileHandle | undefined;

        try {
            tempHandle = await fs.promises.open(tempPath, 'wx');
            await tempHandle.writeFile(content, { encoding });
            await tempHandle.sync();
            await tempHandle.close();
            tempHandle = undefined;

            await fs.promises.rename(tempPath, targetPath);
            await fsyncDirectoryIfPossible(targetDir);
            return;
        } catch (error) {
            const cleanupErrors: string[] = [];
            lastError = error;
            if (tempHandle) {
                try {
                    await tempHandle.close();
                } catch (closeError) {
                    cleanupErrors.push(`close temp handle failed: ${formatError(closeError)}`);
                }
            }
            try {
                await fs.promises.unlink(tempPath);
            } catch (unlinkError) {
                const errorWithCode = unlinkError as NodeJS.ErrnoException;
                if (errorWithCode.code !== 'ENOENT') {
                    cleanupErrors.push(`remove temp file failed: ${formatError(unlinkError)}`);
                }
            }
            lastCleanupErrors = cleanupErrors;
        }
    }

    const cleanupSuffix = lastCleanupErrors.length > 0
        ? ` Cleanup errors: ${lastCleanupErrors.join('; ')}.`
        : '';

    throw new Error(
        `Atomic write failed for "${targetPath}" after ${maxAttempts} attempts. `
        + `Last error: ${formatError(lastError)}.${cleanupSuffix}`
    );
}
