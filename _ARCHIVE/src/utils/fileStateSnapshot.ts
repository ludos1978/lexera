import { createHash } from 'crypto';
import { MarkdownFileRegistry } from '../files/MarkdownFileRegistry';

function hashString(value: string): string {
    return createHash('sha256').update(value).digest('hex').substring(0, 16);
}

/**
 * Build a deterministic token for the current tracked-file state.
 * Used by file-manager actions to detect stale UI snapshots before applying writes/reloads.
 */
export function computeTrackedFilesSnapshotToken(fileRegistry: MarkdownFileRegistry): string {
    const records = fileRegistry.getAll().map(file => ({
        path: file.getPath().replace(/\\/g, '/'),
        type: file.getFileType(),
        exists: file.exists(),
        lastAccessErrorCode: file.getLastAccessErrorCode?.() ?? null,
        hasExternalChanges: file.hasExternalChanges(),
        hasUnsavedChanges: file.hasUnsavedChanges(),
        hasAnyUnsavedChanges: file.hasAnyUnsavedChanges(),
        isDirtyInEditor: file.isDirtyInEditor(),
        isInEditMode: file.isInEditMode(),
        contentHash: hashString(file.getContent()),
        baselineHash: hashString(file.getBaseline())
    }));

    records.sort((left, right) => left.path.localeCompare(right.path));
    return hashString(JSON.stringify(records));
}
