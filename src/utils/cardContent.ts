/**
 * Utilities for unified task content.
 *
 * Task content is now stored as a single unified string.
 * No title/description split - content is preserved exactly as-is.
 */

function normalizeLineEndings(value: string): string {
    return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

export function normalizeCardContent(value: string | undefined | null): string {
    if (typeof value !== 'string') {
        return '';
    }
    return normalizeLineEndings(value);
}

// ============================================================================
// DEPRECATED: The following functions are no longer used.
// They were part of the legacy title/description split system.
// Keeping them temporarily for backwards compatibility with tests.
// ============================================================================

/** @deprecated No longer used - content is unified */
export interface CardContentParts {
    summaryLine: string;
    remainingContent: string;
}

/** @deprecated No longer used - content is unified */
export function mergeLegacyCardContent(title?: string, description?: string): string {
    const normalizedTitle = normalizeCardContent(title);
    const normalizedDescription = normalizeCardContent(description);
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

/** @deprecated No longer used - content is unified */
export function splitCardContent(content: string | undefined | null): CardContentParts {
    const normalized = normalizeCardContent(content);
    if (!normalized) {
        return { summaryLine: '', remainingContent: '' };
    }

    const lines = normalized.split('\n');
    return {
        summaryLine: lines[0] ?? '',
        remainingContent: lines.slice(1).join('\n')
    };
}

/** @deprecated No longer used - content is unified */
export function getCardSummaryLine(content: string | undefined | null): string {
    const normalized = normalizeCardContent(content);
    if (!normalized) {
        return '';
    }

    const lines = normalized.split('\n');
    const firstNonEmpty = lines.find(line => line.trim().length > 0);
    return firstNonEmpty ?? (lines[0] ?? '');
}
