/**
 * Utilities for unified task content.
 *
 * Task markdown representation still uses:
 * - checkbox line for the summary line
 * - indented lines for the remaining content
 *
 * Internally, tasks store a single `content` string.
 */

export interface TaskContentParts {
    summaryLine: string;
    remainingContent: string;
}

function normalizeLineEndings(value: string): string {
    return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

export function normalizeTaskContent(value: string | undefined | null): string {
    if (typeof value !== 'string') {
        return '';
    }
    return normalizeLineEndings(value);
}

/**
 * Merge legacy split values into unified content.
 */
export function mergeLegacyTaskContent(title?: string, description?: string): string {
    const normalizedTitle = normalizeTaskContent(title);
    const normalizedDescription = normalizeTaskContent(description);
    const hasExplicitTitle = title !== undefined && title !== null;

    if (hasExplicitTitle && !normalizedDescription) {
        return normalizedTitle;
    }
    if (hasExplicitTitle && normalizedDescription) {
        return `${normalizedTitle}\n${normalizedDescription}`;
    }
    if (!normalizedTitle) {
        return normalizedDescription;
    }
    if (!normalizedDescription) {
        return normalizedTitle;
    }
    return `${normalizedTitle}\n${normalizedDescription}`;
}

/**
 * Split unified content into markdown-compatible summary + remainder.
 */
export function splitTaskContent(content: string | undefined | null): TaskContentParts {
    const normalized = normalizeTaskContent(content);
    if (!normalized) {
        return { summaryLine: '', remainingContent: '' };
    }

    const lines = normalized.split('\n');
    return {
        summaryLine: lines[0] ?? '',
        remainingContent: lines.slice(1).join('\n')
    };
}

/**
 * Returns a folded-summary candidate.
 * Uses the first non-empty line, then falls back to the first line.
 */
export function getTaskSummaryLine(content: string | undefined | null): string {
    const normalized = normalizeTaskContent(content);
    if (!normalized) {
        return '';
    }

    const lines = normalized.split('\n');
    const firstNonEmpty = lines.find(line => line.trim().length > 0);
    return firstNonEmpty ?? (lines[0] ?? '');
}
