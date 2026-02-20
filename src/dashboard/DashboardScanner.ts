/**
 * DashboardScanner - Scans kanban boards for upcoming items and tags
 *
 * Extracts:
 * - Tasks with temporal tags within a specified timeframe
 * - All unique tags used in the board
 *
 * Recurring logic: yearless temporal tags (@KW7, @JAN, @Q1, @mon without
 * week context) use a rolling window to classify as overdue / outdated /
 * resetToRepeat / future.
 */

import { KanbanBoard, KanbanColumn, KanbanCard } from '../markdownParser';
import {
    UpcomingItem,
    UndatedTask,
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
    ResolvedTemporal,
    TemporalInfo,
    getDateOfISOWeek,
    getWeekdayOfISOWeek,
    getISOWeek,
    isArchivedOrDeleted,
} from '@ludos/shared';

/**
 * Check if a date (or date range) is within the specified timeframe from today.
 * If dateEnd is provided, checks overlap of [date, dateEnd] with [today, futureLimit].
 * Otherwise checks if date falls within [today, futureLimit].
 */
function isWithinTimeframe(date: Date, timeframeDays: number, dateEnd?: Date): boolean {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const futureLimit = new Date(today);
    futureLimit.setDate(futureLimit.getDate() + timeframeDays);

    const rangeStart = new Date(date);
    rangeStart.setHours(0, 0, 0, 0);

    if (dateEnd) {
        const rangeEnd = new Date(dateEnd);
        rangeEnd.setHours(0, 0, 0, 0);
        // Overlap: rangeStart <= futureLimit AND rangeEnd >= today
        return rangeStart <= futureLimit && rangeEnd >= today;
    }

    return rangeStart >= today && rangeStart <= futureLimit;
}

/**
 * Recurring state classification result.
 * - 'overdue'       → unchecked, recently past
 * - 'outdated'      → unchecked, older past (will be discarded soon)
 * - 'resetToRepeat' → checked, needs to be unchecked for next cycle
 * - 'future'        → date should be adjusted to next occurrence
 * - 'skip'          → not in any visible window
 */
type RecurringClassification = 'overdue' | 'outdated' | 'resetToRepeat' | 'future' | 'skip';

/**
 * Classify a yearless recurring temporal tag based on how old it is
 * and the checkbox state.
 *
 * Yearly recurring (weeks, months, quarters without explicit year):
 *   age < 0                        → future (show normally)
 *   0..60 days  + unchecked        → overdue
 *   60..75 days + unchecked        → outdated
 *   75..90 days + checked          → resetToRepeat
 *   > 90 days                      → future (adjust to next year occurrence)
 *   gaps                           → skip
 *
 * Weekly recurring (standalone weekday without week context):
 *   age < 0                        → future
 *   0..2 days   + unchecked        → overdue
 *   2..2.5 days + unchecked        → outdated
 *   2.5..3 days + checked          → resetToRepeat
 *   > 3 days                       → future (adjust to next week)
 *   gaps                           → skip
 */
function classifyRecurringState(
    effectiveDate: Date,
    isChecked: boolean,
    isWeeklyRecurring: boolean
): RecurringClassification {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const checkDate = new Date(effectiveDate);
    checkDate.setHours(0, 0, 0, 0);

    const ageDays = (today.getTime() - checkDate.getTime()) / (1000 * 60 * 60 * 24);

    if (isWeeklyRecurring) {
        if (ageDays < 0) return 'future';
        if (ageDays <= 2 && !isChecked) return 'overdue';
        if (ageDays <= 2.5 && !isChecked) return 'outdated';
        if (ageDays <= 3 && isChecked) return 'resetToRepeat';
        if (ageDays > 3) return 'future';
        return 'skip';
    }

    // Yearly recurring
    if (ageDays < 0) return 'future';
    if (ageDays <= 60 && !isChecked) return 'overdue';
    if (ageDays <= 75 && !isChecked) return 'outdated';
    if (ageDays <= 90 && isChecked) return 'resetToRepeat';
    if (ageDays > 90) return 'future';
    return 'skip';
}

/**
 * Adjust a yearless date to the next occurrence (next year or next week).
 * For yearly: if age > 90 days, the tag wraps to the same week/month/quarter next year.
 * For weekly: if age > 3 days, the tag wraps to next week.
 */
function adjustToNextOccurrence(
    r: ResolvedTemporal,
    isWeeklyRecurring: boolean
): { date: Date; dateEnd?: Date; week?: number } {
    if (isWeeklyRecurring) {
        // Advance weekday to next week
        const nextDate = new Date(r.effectiveDate);
        nextDate.setDate(nextDate.getDate() + 7);
        return { date: nextDate };
    }

    // Yearly: advance to next year
    const nextYear = r.effectiveDate.getFullYear() + 1;

    if (r.temporal.week !== undefined) {
        const monday = getDateOfISOWeek(r.temporal.week, nextYear);
        if (r.effectiveWeekday !== undefined) {
            const date = getWeekdayOfISOWeek(r.temporal.week, nextYear, r.effectiveWeekday);
            return { date, week: r.temporal.week };
        }
        const sunday = new Date(monday);
        sunday.setDate(monday.getDate() + 6);
        return { date: monday, dateEnd: sunday, week: r.temporal.week };
    }

    if (r.temporal.month !== undefined) {
        const start = new Date(nextYear, r.temporal.month - 1, 1);
        const end = new Date(nextYear, r.temporal.month, 0);
        return { date: start, dateEnd: end };
    }

    if (r.temporal.quarter !== undefined) {
        const startMonth = (r.temporal.quarter - 1) * 3;
        const start = new Date(nextYear, startMonth, 1);
        const end = new Date(nextYear, startMonth + 3, 0);
        return { date: start, dateEnd: end };
    }

    // Generic: advance one year
    const nextDate = new Date(r.effectiveDate);
    nextDate.setFullYear(nextDate.getFullYear() + 1);
    const nextDateEnd = r.effectiveDateEnd ? new Date(r.effectiveDateEnd) : undefined;
    if (nextDateEnd) nextDateEnd.setFullYear(nextDateEnd.getFullYear() + 1);
    return { date: nextDate, dateEnd: nextDateEnd };
}

/**
 * Determine effective checkbox state, fixing the case where the markdown
 * parser strips '- [ ]' from task content (first-line temporals get
 * checkboxState 'none' even though the task IS a checkbox task).
 *
 * Parser convention: task.checked = true for [x], undefined for [ ].
 * ALL parser tasks come from '- ' lines, so every task IS a checkbox card.
 * For first-line temporals we always know it's a checkbox task.
 */
function getEffectiveCheckboxState(
    temporal: TemporalInfo,
    taskChecked: boolean | undefined,
    isFirstLine: boolean
): 'unchecked' | 'checked' | 'none' {
    // Sub-line checkboxes retain their prefix in task content, so detectCheckboxState works
    if (temporal.checkboxState === 'checked' || temporal.checkboxState === 'unchecked') {
        return temporal.checkboxState;
    }
    // For first-line temporals: parser strips '- [ ]', so detectCheckboxState
    // returns 'none'. But ALL tasks come from '- ' lines in the parser, so the
    // card always has a checkbox. task.checked = true means [x], undefined means [ ].
    if (isFirstLine) {
        return taskChecked ? 'checked' : 'unchecked';
    }
    return temporal.checkboxState ?? 'none';
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
     * checkbox state, overdue detection, recurring state classification).
     */
    static scanBoard(
        board: KanbanBoard,
        boardUri: string,
        boardName: string,
        timeframeDays: number
    ): { upcomingItems: UpcomingItem[]; calendarEvents: UpcomingItem[]; undatedTasks: UndatedTask[]; summary: BoardTagSummary } {
        const upcomingItems: UpcomingItem[] = [];
        const calendarEvents: UpcomingItem[] = [];
        const undatedTasks: UndatedTask[] = [];
        const tagCounts = new Map<string, { count: number; type: 'hash' | 'temporal' }>();
        let totalCards = 0;
        let temporalCards = 0;

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        logger.debug('[DashboardScanner] START scan', { today: today.toISOString(), timeframeDays });

        let columnIndex = 0;
        for (const column of board.columns || []) {
            const rawColumnTitle = column.title || '';
            const columnTitle = column.displayTitle || rawColumnTitle;

            // Skip archived/deleted columns entirely
            if (isArchivedOrDeleted(rawColumnTitle)) {
                columnIndex++;
                continue;
            }

            const columnTemporals = extractTemporalInfo(rawColumnTitle);
            const columnTemporal = columnTemporals.length > 0 ? columnTemporals[0] : null;

            // Column gating: if column has a temporal tag outside timeframe, skip all tasks
            let columnWithinTimeframe = true;
            if (columnTemporal?.date) {
                columnWithinTimeframe = isWithinTimeframe(
                    columnTemporal.date, timeframeDays, columnTemporal.dateEnd
                );
            }

            let cardIndex = 0;
            for (const task of column.cards || []) {
                const taskText = task.content || '';

                // Skip archived/deleted tasks
                if (isArchivedOrDeleted(taskText)) {
                    cardIndex++;
                    continue;
                }

                totalCards++;
                const taskLines = taskText.replace(/\r\n/g, '\n').split('\n');
                const taskSummary = taskLines.find(line => line.trim().length > 0) ?? taskLines[0] ?? '';
                const firstLine = taskLines[0] || '';

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
                    temporalCards++;
                }

                // Skip checked tasks (checked = done)
                if (task.checked) {
                    // Exception: yearless recurring tags might show as "Reset to repeat"
                    const hasYearlessRecurring = resolved.some(
                        r => r.temporal.hasExplicitYear === false
                    );
                    if (!hasYearlessRecurring) {
                        cardIndex++;
                        continue;
                    }
                }

                // Collect undated sub-tasks: scan content lines (not the card
                // title) for "- [ ]" lines that have no temporal tags.
                // The card title itself is NOT an undated task — it's a kanban
                // card that lives in its column.
                const resolvedLineContents = new Set(
                    resolved.map(r => r.lineContent?.trim()).filter(Boolean)
                );
                for (let li = 1; li < taskLines.length; li++) {
                    const line = taskLines[li];
                    const trimmed = line.trim();
                    if (/^- \[ \]\s/.test(trimmed)) {
                        // Skip lines already captured by temporal resolution
                        if (resolvedLineContents.has(trimmed)) continue;
                        // Skip lines with any @ tag (temporal that may not have resolved)
                        if (/(?<=^|\s)@\S/.test(trimmed)) continue;
                        const subTaskSummary = trimmed.substring(6).trim();
                        if (subTaskSummary.length > 0) {
                            undatedTasks.push({
                                boardUri,
                                boardName,
                                columnTitle,
                                cardTitle: taskSummary,
                                taskSummary: subTaskSummary
                            });
                        }
                    }
                }

                for (const r of resolved) {
                    const isFirstLine = r.lineContent === firstLine.trim();
                    const effectiveCheckbox = getEffectiveCheckboxState(
                        r.temporal, task.checked, isFirstLine
                    );

                    // Calendar event = temporal line without checkbox
                    const isCalendarEvent = effectiveCheckbox === 'none';

                    // Skip checked sub-line items (non-recurring) — checkbox items only
                    if (!isCalendarEvent && effectiveCheckbox === 'checked' && r.temporal.hasExplicitYear !== false) {
                        continue;
                    }

                    // Column gating: skip when column is outside timeframe
                    if (columnTemporal?.date && !columnWithinTimeframe) continue;

                    const isChecked = effectiveCheckbox === 'checked';
                    const isUnchecked = effectiveCheckbox === 'unchecked';
                    // Calendar events go into calendarEvents, checkbox items into upcomingItems
                    const targetCollection = isCalendarEvent ? calendarEvents : upcomingItems;

                    // --- Yearless recurring tag handling ---
                    if (r.temporal.hasExplicitYear === false) {
                        const isWeeklyRecurring = r.temporal.weekday !== undefined
                            && r.temporal.week === undefined
                            && r.temporal.month === undefined
                            && r.temporal.quarter === undefined;

                        // Calendar events: treat as unchecked for recurring classification
                        const classification = classifyRecurringState(
                            r.effectiveDate, isCalendarEvent ? false : isChecked, isWeeklyRecurring
                        );

                        if (classification === 'skip') continue;

                        let itemDate = r.effectiveDate;
                        let itemDateEnd = r.effectiveDateEnd;
                        let itemWeek = r.effectiveWeek;
                        let recurringState: 'overdue' | 'outdated' | 'resetToRepeat' | undefined;

                        if (classification === 'future') {
                            const checkDate = new Date(r.effectiveDate);
                            checkDate.setHours(0, 0, 0, 0);
                            if (checkDate < today) {
                                const adjusted = adjustToNextOccurrence(r, isWeeklyRecurring);
                                itemDate = adjusted.date;
                                itemDateEnd = adjusted.dateEnd;
                                if (adjusted.week !== undefined) itemWeek = adjusted.week;
                            }
                            if (!isWithinTimeframe(itemDate, timeframeDays, itemDateEnd)) {
                                continue;
                            }
                        } else {
                            recurringState = classification;
                        }

                        targetCollection.push({
                            boardUri,
                            boardName,
                            columnIndex,
                            columnTitle,
                            cardIndex,
                            cardTitle: taskSummary,
                            taskSummary: r.lineContent || taskSummary,
                            temporalTag: r.temporal.tag,
                            date: itemDate,
                            dateEnd: itemDateEnd,
                            week: itemWeek,
                            year: r.temporal.year,
                            weekday: r.effectiveWeekday,
                            month: r.temporal.month,
                            quarter: r.temporal.quarter,
                            timeSlot: r.temporal.timeSlot,
                            rawTitle: taskSummary || '',
                            isOverdue: isCalendarEvent ? false : (recurringState === 'overdue' || recurringState === 'outdated'),
                            hasExplicitYear: false,
                            recurringState: isCalendarEvent ? undefined : recurringState
                        });
                        continue;
                    }

                    // --- Standard (non-recurring) handling ---
                    const withinTimeframe = isWithinTimeframe(
                        r.effectiveDate, timeframeDays, r.effectiveDateEnd
                    );

                    const checkDate = new Date(r.effectiveDate);
                    checkDate.setHours(0, 0, 0, 0);
                    const isOverdue = !isCalendarEvent && isUnchecked && checkDate < today;

                    if (!withinTimeframe && !isOverdue) continue;

                    targetCollection.push({
                        boardUri,
                        boardName,
                        columnIndex,
                        columnTitle,
                        cardIndex,
                        cardTitle: taskSummary,
                        taskSummary: r.lineContent || taskSummary,
                        temporalTag: r.temporal.tag,
                        date: r.effectiveDate,
                        dateEnd: r.effectiveDateEnd,
                        week: r.effectiveWeek,
                        year: r.effectiveYear ?? r.temporal.year,
                        weekday: r.effectiveWeekday,
                        month: r.temporal.month,
                        quarter: r.temporal.quarter,
                        timeSlot: r.temporal.timeSlot,
                        rawTitle: taskSummary || '',
                        isOverdue,
                        hasExplicitYear: r.temporal.hasExplicitYear
                    });
                }

                cardIndex++;
            }
            columnIndex++;
        }

        logger.debug('[DashboardScanner] END scan', {
            upcomingItems: upcomingItems.length,
            calendarEvents: calendarEvents.length,
            undatedTasks: undatedTasks.length
        });

        const tags: TagInfo[] = Array.from(tagCounts.entries())
            .map(([name, info]) => ({ name, count: info.count, type: info.type }))
            .sort((a, b) => b.count - a.count);

        return {
            upcomingItems,
            calendarEvents,
            undatedTasks,
            summary: { boardUri, boardName, tags, totalCards, temporalCards }
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
            const rawColumnTitle = column.title || '';
            const columnTitle = column.displayTitle || rawColumnTitle;

            // Skip archived/deleted columns
            if (isArchivedOrDeleted(rawColumnTitle)) {
                columnIndex++;
                continue;
            }

            // Check if column title contains the search tag (exact match)
            const columnTags = TextMatcher.extractTags(rawColumnTitle);
            const columnMatchingTag = columnTags.find(t => TextMatcher.tagExactMatch(t.name, searchTag));
            const columnHasTag = !!columnMatchingTag;

            // Track if any task in this column matched directly
            let anyTaskMatchedDirectly = false;

            let cardIndex = 0;
            for (const task of column.cards || []) {
                const taskText = task.content || '';

                // Skip archived/deleted tasks
                if (isArchivedOrDeleted(taskText)) {
                    cardIndex++;
                    continue;
                }

                // Get first non-empty line as card title
                const taskLines = taskText.replace(/\r\n/g, '\n').split('\n');
                const summaryLine = taskLines.find(line => line.trim().length > 0) ?? taskLines[0] ?? '';
                const tags = TextMatcher.extractTags(taskText);

                // Check if any tag in task matches the search (exact match)
                for (const tag of tags) {
                    if (TextMatcher.tagExactMatch(tag.name, searchTag)) {
                        results.push({
                            boardUri,
                            boardName,
                            columnIndex,
                            columnTitle,
                            cardIndex,
                            cardTitle: summaryLine || '',
                            taskSummary: summaryLine || '',
                            matchedTag: tag.name
                        });
                        anyTaskMatchedDirectly = true;
                        break; // Only add task once even if multiple tags match
                    }
                }
                cardIndex++;
            }

            // If column has the tag but no tasks matched directly, add a column-level result
            // Use cardIndex = -1 to indicate this is a column match, not a task match
            if (columnHasTag && !anyTaskMatchedDirectly) {
                results.push({
                    boardUri,
                    boardName,
                    columnIndex,
                    columnTitle,
                    cardIndex: -1,  // -1 indicates column-level match
                    cardTitle: '',  // No specific card
                    taskSummary: '',  // No specific task
                    matchedTag: columnMatchingTag?.name || searchTag
                });
            }

            columnIndex++;
        }

        return results;
    }
}
