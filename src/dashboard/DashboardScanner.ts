/**
 * DashboardScanner - Scans kanban boards for upcoming items and tags
 *
 * Extracts:
 * - Tasks with temporal tags within a specified timeframe
 * - All unique tags used in the board
 */

import { KanbanBoard, KanbanColumn, KanbanTask } from '../markdownParser';
import {
    UpcomingItem,
    BoardTagSummary,
    TagInfo,
    TagSearchResult
} from './DashboardTypes';
import { TextMatcher } from '../utils/textMatcher';
import { logger } from '../utils/logger';
import {
    extractTemporalInfo,
    resolveTaskTemporals,
    setDateLocale,
} from '@ludos/shared';

/**
 * Check if a date is within the specified timeframe from today
 * @param date - The date to check
 * @param timeframeDays - Number of days in the future to include
 * @param isWeekDate - If true, checks if any day of that week overlaps with timeframe
 */
function isWithinTimeframe(date: Date, timeframeDays: number, isWeekDate: boolean = false): boolean {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const futureLimit = new Date(today);
    futureLimit.setDate(futureLimit.getDate() + timeframeDays);

    const checkDate = new Date(date);
    checkDate.setHours(0, 0, 0, 0);

    if (isWeekDate) {
        // For week dates (Monday), check if any day of that week overlaps with [today, futureLimit]
        // Week spans Monday (checkDate) to Sunday (checkDate + 6 days)
        const weekEnd = new Date(checkDate);
        weekEnd.setDate(weekEnd.getDate() + 6);

        // Overlap exists if: weekStart <= futureLimit AND weekEnd >= today
        return checkDate <= futureLimit && weekEnd >= today;
    }

    return checkDate >= today && checkDate <= futureLimit;
}

export class DashboardScanner {
    /**
     * Set the date locale for parsing
     */
    static setDateLocale(locale: string): void {
        setDateLocale(locale);
    }

    /**
     * Scan a board for upcoming items and tags.
     *
     * Uses resolveTaskTemporals() from @ludos/shared for temporal resolution,
     * then applies dashboard-specific filtering (timeframe, column gating,
     * checkbox state, overdue detection).
     */
    static scanBoard(
        board: KanbanBoard,
        boardUri: string,
        boardName: string,
        timeframeDays: number
    ): { upcomingItems: UpcomingItem[]; summary: BoardTagSummary } {
        const upcomingItems: UpcomingItem[] = [];
        const tagCounts = new Map<string, { count: number; type: 'hash' | 'temporal' }>();
        let totalTasks = 0;
        let temporalTasks = 0;

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        logger.debug('[DashboardScanner] START scan', { today: today.toISOString(), timeframeDays });

        let columnIndex = 0;
        for (const column of board.columns || []) {
            const columnTitle = column.title || '';
            const columnTemporals = extractTemporalInfo(columnTitle);
            const columnTemporal = columnTemporals.length > 0 ? columnTemporals[0] : null;

            // Column gating: if column has a temporal tag outside timeframe, skip all tasks
            let columnWithinTimeframe = true;
            if (columnTemporal?.date) {
                const isWeekBased = columnTemporal.week !== undefined;
                columnWithinTimeframe = isWithinTimeframe(columnTemporal.date, timeframeDays, isWeekBased);
            }

            let taskIndex = 0;
            for (const task of column.tasks || []) {
                totalTasks++;
                const taskText = task.content || '';
                const taskLines = taskText.replace(/\r\n/g, '\n').split('\n');
                const taskSummary = taskLines.find(line => line.trim().length > 0) ?? taskLines[0] ?? '';

                // Collect tags for summary
                const tags = TextMatcher.extractTags(taskText);
                for (const tag of tags) {
                    const existing = tagCounts.get(tag.name);
                    if (existing) {
                        existing.count++;
                    } else {
                        tagCounts.set(tag.name, { count: 1, type: tag.type });
                    }
                }

                // Shared temporal resolution (same logic as IcalMapper)
                const resolved = resolveTaskTemporals(taskText, columnTemporal);

                if (resolved.length > 0) {
                    temporalTasks++;
                }

                // Task-level checked state: parsed from `- [x]` by markdownParser.
                // When checked, the task is complete — skip all its temporal entries.
                // Note: sub-line checkboxes are still detected by detectCheckboxState
                // inside extractTemporalInfo (those lines retain their `- [x]` prefix).
                if (task.checked) {
                    taskIndex++;
                    continue;
                }

                for (const r of resolved) {
                    // Skip checked sub-line deadline tasks (detected via line-level checkbox)
                    if (r.temporal.checkboxState === 'checked') continue;

                    // Column gating: skip when column is outside timeframe
                    if (columnTemporal?.date && !columnWithinTimeframe) continue;

                    const effectiveDateIsWeekBased = r.effectiveWeek !== undefined;
                    const withinTimeframe = isWithinTimeframe(r.effectiveDate, timeframeDays, effectiveDateIsWeekBased);

                    // Overdue detection for unchecked deadline tasks
                    const isDeadlineTask = r.temporal.checkboxState === 'unchecked';
                    const checkDate = new Date(r.effectiveDate);
                    checkDate.setHours(0, 0, 0, 0);
                    const isOverdue = isDeadlineTask && checkDate < today;

                    if (!withinTimeframe && !isOverdue) continue;

                    upcomingItems.push({
                        boardUri,
                        boardName,
                        columnIndex,
                        columnTitle,
                        taskIndex,
                        taskSummary: r.lineContent || taskSummary,
                        temporalTag: r.temporal.tag,
                        date: r.effectiveDate,
                        week: r.effectiveWeek,
                        year: r.temporal.year,
                        weekday: r.effectiveWeekday,
                        timeSlot: r.temporal.timeSlot,
                        rawTitle: taskSummary || '',
                        isOverdue
                    });
                }

                taskIndex++;
            }
            columnIndex++;
        }

        logger.debug('[DashboardScanner] END scan', { upcomingItems: upcomingItems.length });

        const tags: TagInfo[] = Array.from(tagCounts.entries())
            .map(([name, info]) => ({ name, count: info.count, type: info.type }))
            .sort((a, b) => b.count - a.count);

        return {
            upcomingItems,
            summary: { boardUri, boardName, tags, totalTasks, temporalTasks }
        };
    }

    /**
     * Search a board for all tasks containing a specific tag
     * @param board - The parsed kanban board
     * @param boardUri - URI of the board file
     * @param boardName - Display name of the board
     * @param searchTag - The tag to search for (e.g., "#project", "#person", "@date")
     *                    NEW TAG SYSTEM: # for tags including people, @ for temporal
     * @returns Array of matching tasks
     */
    static searchByTag(
        board: KanbanBoard,
        boardUri: string,
        boardName: string,
        searchTag: string
    ): TagSearchResult[] {
        const results: TagSearchResult[] = [];

        let columnIndex = 0;
        for (const column of board.columns || []) {
            const columnTitle = column.title || '';

            // Check if column title contains the search tag (exact match)
            const columnTags = TextMatcher.extractTags(columnTitle);
            const columnMatchingTag = columnTags.find(t => TextMatcher.tagExactMatch(t.name, searchTag));
            const columnHasTag = !!columnMatchingTag;

            // Track if any task in this column matched directly
            let anyTaskMatchedDirectly = false;

            let taskIndex = 0;
            for (const task of column.tasks || []) {
                const taskText = task.content || '';
                // Get first line as task summary
                const summaryLine = taskText.replace(/\r\n/g, '\n').split('\n')[0] || '';
                const tags = TextMatcher.extractTags(taskText);

                // Check if any tag in task matches the search (exact match)
                for (const tag of tags) {
                    if (TextMatcher.tagExactMatch(tag.name, searchTag)) {
                        results.push({
                            boardUri,
                            boardName,
                            columnIndex,
                            columnTitle,
                            taskIndex,
                            taskSummary: summaryLine || '',
                            matchedTag: tag.name
                        });
                        anyTaskMatchedDirectly = true;
                        break; // Only add task once even if multiple tags match
                    }
                }
                taskIndex++;
            }

            // If column has the tag but no tasks matched directly, add a column-level result
            // Use taskIndex = -1 to indicate this is a column match, not a task match
            if (columnHasTag && !anyTaskMatchedDirectly) {
                results.push({
                    boardUri,
                    boardName,
                    columnIndex,
                    columnTitle,
                    taskIndex: -1,  // -1 indicates column-level match
                    taskSummary: '',  // No specific task
                    matchedTag: columnMatchingTag?.name || searchTag
                });
            }

            columnIndex++;
        }

        return results;
    }
}
