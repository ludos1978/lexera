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
import { getTaskSummaryLine, splitTaskContent } from '../utils/taskContent';

// Date locale configuration - matches frontend tagUtils.js
let dateLocale: string = 'de-DE';

/**
 * Check if locale uses day-first format (DD.MM.YYYY)
 */
function isLocaleDayFirst(): boolean {
    const dayFirstLocales = ['de-DE', 'de-AT', 'de-CH', 'en-GB', 'fr-FR'];
    return dayFirstLocales.includes(dateLocale);
}

/**
 * Parse a date tag string into a Date object
 * Supports: DD.MM.YYYY, DD.MM.YY, DD.MM, YYYY-MM-DD, YYYY.MM.DD
 * NEW TAG SYSTEM: @ prefix for temporal (dates, times, weeks)
 */
function parseDateTag(tagContent: string): Date | null {
    // Remove the @ prefix if present (NEW: @ is temporal prefix)
    const content = tagContent.startsWith('@') ? tagContent.slice(1) : tagContent;

    // Try to match date patterns
    const dateMatch = content.match(/^(\d{1,4})[-./](\d{1,2})(?:[-./](\d{2,4}))?$/);
    if (!dateMatch) return null;

    const [, part1, part2, part3] = dateMatch;
    let year: number, month: number, day: number;

    const p1 = parseInt(part1, 10);
    const p2 = parseInt(part2, 10);
    const p3 = part3 ? parseInt(part3, 10) : undefined;

    // Determine format based on first number and locale
    if (p1 > 31) {
        // First number > 31, must be year: YYYY-MM-DD
        year = p1;
        month = p2;
        day = p3 || 1;
    } else if (isLocaleDayFirst()) {
        // European format: DD.MM.YYYY or DD.MM.YY or DD.MM
        day = p1;
        month = p2;
        if (p3 !== undefined) {
            year = p3 < 100 ? 2000 + p3 : p3;
        } else {
            year = new Date().getFullYear();
        }
    } else {
        // US format: MM/DD/YYYY
        month = p1;
        day = p2;
        if (p3 !== undefined) {
            year = p3 < 100 ? 2000 + p3 : p3;
        } else {
            year = new Date().getFullYear();
        }
    }

    // Validate
    if (month < 1 || month > 12) return null;
    if (day < 1 || day > 31) return null;
    if (year < 1900 || year > 2100) return null;

    return new Date(year, month - 1, day);
}

/**
 * Parse a week tag and return the Monday of that week
 * NEW TAG SYSTEM: Supports @W4, @KW4, @w4, @kw4, @2025-W4, @2025.W4
 */
function parseWeekTag(tagContent: string): Date | null {
    const content = tagContent.startsWith('@') ? tagContent.slice(1) : tagContent;

    // Try week with year: 2025-W4, 2025.W4, 2025-KW4
    const weekYearMatch = content.match(/^(\d{4})[-.]?(?:[wW]|[kK][wW])(\d{1,2})$/);
    if (weekYearMatch) {
        const year = parseInt(weekYearMatch[1], 10);
        const week = parseInt(weekYearMatch[2], 10);
        return getDateOfISOWeek(week, year);
    }

    // Try week without year: W4, w4, KW4, kw4
    const weekMatch = content.match(/^(?:[wW]|[kK][wW])(\d{1,2})$/);
    if (weekMatch) {
        const week = parseInt(weekMatch[1], 10);
        const year = new Date().getFullYear();
        return getDateOfISOWeek(week, year);
    }

    return null;
}

/**
 * Get the Monday of a given ISO week
 */
function getDateOfISOWeek(week: number, year: number): Date {
    const jan4 = new Date(year, 0, 4);
    const dayOfWeek = jan4.getDay() || 7; // Sunday = 7
    const monday = new Date(jan4);
    monday.setDate(jan4.getDate() - dayOfWeek + 1 + (week - 1) * 7);
    return monday;
}

/**
 * Get a specific weekday of a given ISO week
 * @param week - ISO week number
 * @param year - Year
 * @param weekday - Weekday (0=Sun, 1=Mon, ..., 6=Sat) - uses JS convention
 */
function getWeekdayOfISOWeek(week: number, year: number, weekday: number): Date {
    const monday = getDateOfISOWeek(week, year);
    // Monday is weekday 1, so offset from Monday
    // 0=Sun means -1 from Monday (or +6), 1=Mon means 0, 2=Tue means +1, etc.
    const daysFromMonday = weekday === 0 ? 6 : weekday - 1;
    const result = new Date(monday);
    result.setDate(monday.getDate() + daysFromMonday);
    return result;
}

/**
 * Parse weekday name to JS weekday number (0=Sun, 1=Mon, ..., 6=Sat)
 */
function parseWeekdayName(name: string): number | null {
    const weekdays: Record<string, number> = {
        'sun': 0, 'sunday': 0,
        'mon': 1, 'monday': 1,
        'tue': 2, 'tuesday': 2,
        'wed': 3, 'wednesday': 3,
        'thu': 4, 'thursday': 4,
        'fri': 5, 'friday': 5,
        'sat': 6, 'saturday': 6
    };
    return weekdays[name.toLowerCase()] ?? null;
}

/**
 * Get ISO week number for a date
 */
function getISOWeek(date: Date): number {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

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
        dateLocale = locale;
    }

    /**
     * Scan a board for upcoming items and tags
     */
    static scanBoard(
        board: KanbanBoard,
        boardUri: string,
        boardName: string,
        timeframeDays: number
    ): { upcomingItems: UpcomingItem[]; summary: BoardTagSummary } {
        const upcomingItems: UpcomingItem[] = [];
        // NEW TAG SYSTEM: hash (#) for tags including people, temporal (@) for dates/times
        const tagCounts = new Map<string, { count: number; type: 'hash' | 'temporal' }>();
        let totalTasks = 0;
        let temporalTasks = 0;

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        logger.debug('[DashboardScanner] START scan', { today: today.toISOString(), timeframeDays });

        // Scan all columns and tasks with hierarchical temporal gating
        let columnIndex = 0;
        for (const column of board.columns || []) {
            // Check column's temporal tag first (hierarchical gating)
            const columnTitle = column.title || '';
            const columnTemporals = this._extractTemporalInfo(columnTitle);
            // Use first temporal result for column gating (usually there's only one)
            const columnTemporal = columnTemporals.length > 0 ? columnTemporals[0] : null;

            // If column has a date/week tag outside timeframe, skip all tasks in this column
            let columnWithinTimeframe = true;
            let columnDate: Date | undefined;

            if (columnTemporal) {
                if (columnTemporal.date) {
                    // For week tags, check if any day of the week overlaps with timeframe
                    const isWeekBased = columnTemporal.week !== undefined;
                    columnWithinTimeframe = isWithinTimeframe(columnTemporal.date, timeframeDays, isWeekBased);
                    columnDate = columnTemporal.date;
                }
            }

            let taskIndex = 0;
            for (const task of column.tasks || []) {
                totalTasks++;
                const taskText = task.content || '';
                const taskSummary = getTaskSummaryLine(task.content);
                const taskTitleTemporals = this._extractTemporalInfo(taskSummary);
                // Use first temporal result for task context (usually there's only one)
                const taskTitleTemporal = taskTitleTemporals.length > 0 ? taskTitleTemporals[0] : null;
                let taskTemporalContext: {
                    date: Date;
                    week?: number;
                    year?: number;
                    isWeekBased: boolean;
                } | null = (taskTitleTemporal?.hasExplicitDate && taskTitleTemporal.date)
                    ? {
                        date: taskTitleTemporal.date,
                        week: taskTitleTemporal.week,
                        year: taskTitleTemporal.year,
                        isWeekBased: taskTitleTemporal.week !== undefined
                    }
                    : null;

                // Extract all tags from task (for tag summary)
                const tags = TextMatcher.extractTags(taskText);
                for (const tag of tags) {
                    const existing = tagCounts.get(tag.name);
                    if (existing) {
                        existing.count++;
                    } else {
                        tagCounts.set(tag.name, { count: 1, type: tag.type });
                    }
                }

                // Process each line separately to find all temporal tags
                const lines = taskText.split('\n');
                let hasTemporalTag = false;

                for (const line of lines) {
                    const lineTemporals = this._extractTemporalInfo(line);
                    if (lineTemporals.length === 0) continue;

                    hasTemporalTag = true;

                    // Process each temporal result (may be multiple for week OR syntax)
                    for (const lineTemporal of lineTemporals) {
                        // Skip checked deadline tasks (- [x] !date)
                        if (lineTemporal.checkboxState === 'checked') {
                            continue;
                        }

                        // Determine effective date for this line's temporal tag
                        let effectiveDate = lineTemporal.date;
                        let effectiveDateIsWeekBased = lineTemporal.week !== undefined;
                        let effectiveWeek = lineTemporal.week;
                        let effectiveYear = lineTemporal.year;
                        const effectiveWeekday = lineTemporal.weekday;

                        // For time slots WITHOUT explicit date/week - can inherit from column
                        if (lineTemporal.timeSlot && !lineTemporal.hasExplicitDate) {
                            if (columnTemporal && columnDate && !columnWithinTimeframe) {
                                // Column is outside timeframe - gates this time slot
                                continue;
                            }

                            if (taskTemporalContext?.date) {
                                // Task has temporal context (title or earlier explicit line) - inherit from task
                                effectiveDate = taskTemporalContext.date;
                                effectiveDateIsWeekBased = taskTemporalContext.isWeekBased;
                                effectiveWeek = taskTemporalContext.week;
                                effectiveYear = taskTemporalContext.year;
                            } else if (columnTemporal && columnDate) {
                                // Column has temporal tag - time slot inherits from column
                                effectiveDate = columnDate;
                                effectiveDateIsWeekBased = columnTemporal.week !== undefined;
                                effectiveWeek = columnTemporal.week;
                                effectiveYear = columnTemporal.year;
                            }
                            // If no column temporal tag, time slot uses "today" (already set)
                        } else if (lineTemporal.hasExplicitDate && columnTemporal && columnTemporal.date && !columnWithinTimeframe) {
                            // Line has explicit date/week tag, but column has temporal tag outside timeframe
                            // Column gates the line (hierarchical gating)
                            continue;
                        }

                        if (lineTemporal.hasExplicitDate && lineTemporal.date) {
                            taskTemporalContext = {
                                date: lineTemporal.date,
                                week: lineTemporal.week,
                                year: lineTemporal.year,
                                isWeekBased: lineTemporal.week !== undefined
                            };
                        }

                        const withinTimeframe = effectiveDate ? isWithinTimeframe(effectiveDate, timeframeDays, effectiveDateIsWeekBased) : false;

                        // For deadline tasks (unchecked checkbox), also include overdue items
                        const isDeadlineTask = lineTemporal.checkboxState === 'unchecked';
                        let isOverdue = false;
                        if (effectiveDate) {
                            const today = new Date();
                            today.setHours(0, 0, 0, 0);
                            const checkDate = new Date(effectiveDate);
                            checkDate.setHours(0, 0, 0, 0);
                            isOverdue = checkDate < today;
                        }

                        // Include if within timeframe OR if it's an overdue deadline task
                        const shouldInclude = withinTimeframe || (isDeadlineTask && isOverdue);

                        if (effectiveDate && shouldInclude) {
                            // Use the line content as the display title for this temporal item
                            const lineTitle = line.trim() || taskSummary || '';
                            upcomingItems.push({
                                boardUri,
                                boardName,
                                columnIndex,
                                columnTitle: columnTitle,
                                taskIndex,
                                taskSummary: lineTitle,
                                temporalTag: lineTemporal.tag,
                                date: effectiveDate,
                                week: effectiveWeek,
                                year: effectiveYear,
                                weekday: effectiveWeekday,
                                timeSlot: lineTemporal.timeSlot,
                                rawTitle: taskSummary || '',
                                isOverdue: isDeadlineTask && isOverdue
                            });
                        }
                    }
                }

                if (hasTemporalTag) {
                    temporalTasks++;
                }
                taskIndex++;
            }
            columnIndex++;
        }

        logger.debug('[DashboardScanner] END scan', { upcomingItems: upcomingItems.length });

        // Convert tag counts to sorted array
        const tags: TagInfo[] = Array.from(tagCounts.entries())
            .map(([name, info]) => ({
                name,
                count: info.count,
                type: info.type
            }))
            .sort((a, b) => b.count - a.count);

        const summary: BoardTagSummary = {
            boardUri,
            boardName,
            tags,
            totalTasks,
            temporalTasks
        };

        return { upcomingItems, summary };
    }

    /**
     * Extract temporal information from text
     * Returns array of results to handle week OR syntax (e.g., @kw8|kw38 @fri)
     * Also detects checkbox state for deadline tasks (- [ ] or - [x] at line start)
     */
    private static _extractTemporalInfo(text: string): Array<{
        tag: string;
        date?: Date;
        week?: number;
        year?: number;
        weekday?: number;  // 0=Sun, 1=Mon, ..., 6=Sat
        timeSlot?: string;
        hasExplicitDate?: boolean;  // true if date came from explicit date/week tag
        checkboxState?: 'unchecked' | 'checked' | 'none';  // checkbox state if temporal tag is on a checkbox line
    }> {
        const results: Array<{
            tag: string;
            date?: Date;
            week?: number;
            year?: number;
            weekday?: number;
            timeSlot?: string;
            hasExplicitDate?: boolean;
            checkboxState?: 'unchecked' | 'checked' | 'none';
        }> = [];

        // Check for time slot first (can be combined with date/week)
        // NEW TAG SYSTEM: Supports @HH:MM-HH:MM, @HHMM-HHMM, @HHMM, @HHam/pm
        let timeSlot: string | undefined;

        // Time range with colons: @09:00-17:00
        const timeRangeColonMatch = text.match(/@(\d{1,2}:\d{2})-(\d{1,2}:\d{2})/);
        if (timeRangeColonMatch) {
            timeSlot = timeRangeColonMatch[0];
        }

        // Time range without colons: @1200-1400
        if (!timeSlot) {
            const timeRangeNoColonMatch = text.match(/@(\d{4})-(\d{4})/);
            if (timeRangeNoColonMatch) {
                const start = timeRangeNoColonMatch[1];
                const end = timeRangeNoColonMatch[2];
                const startHours = parseInt(start.substring(0, 2), 10);
                const startMins = parseInt(start.substring(2, 4), 10);
                const endHours = parseInt(end.substring(0, 2), 10);
                const endMins = parseInt(end.substring(2, 4), 10);
                // Validate both times
                if (startHours < 24 && startMins < 60 && endHours < 24 && endMins < 60) {
                    timeSlot = timeRangeNoColonMatch[0];
                }
            }
        }

        // 4-digit time: @1230 (not matching years like @2026 which are handled separately)
        if (!timeSlot) {
            const time4DigitMatch = text.match(/@(\d{4})(?![-./\d])/);
            if (time4DigitMatch) {
                const digits = time4DigitMatch[1];
                const hours = parseInt(digits.substring(0, 2), 10);
                const mins = parseInt(digits.substring(2, 4), 10);
                // Only treat as time if hours < 24 and mins < 60 (exclude years like 2026)
                if (hours < 24 && mins < 60) {
                    timeSlot = time4DigitMatch[0];
                }
            }
        }

        // AM/PM time: @12pm, @9am (US locale)
        if (!timeSlot && !isLocaleDayFirst()) {
            const ampmMatch = text.match(/@(\d{1,2})(am|pm)/i);
            if (ampmMatch) {
                timeSlot = ampmMatch[0];
            }
        }

        // Check for weekday tag: @mon, @friday, etc.
        let weekdayNum: number | null = null;
        const weekdayMatch = text.match(/@(mon|monday|tue|tuesday|wed|wednesday|thu|thursday|fri|friday|sat|saturday|sun|sunday)(?=\s|$)/i);
        if (weekdayMatch) {
            weekdayNum = parseWeekdayName(weekdayMatch[1]);
        }

        // Helper to detect checkbox state
        const detectCheckboxState = (tag: string): 'unchecked' | 'checked' | 'none' => {
            const lines = text.split('\n');
            for (const line of lines) {
                if (line.includes(tag)) {
                    const uncheckedMatch = line.match(/^\s*- \[ \]/);
                    const checkedMatch = line.match(/^\s*- \[[xX]\]/);
                    if (checkedMatch) return 'checked';
                    if (uncheckedMatch) return 'unchecked';
                    return 'none';
                }
            }
            return 'none';
        };

        // Try to find year tag: @Y2026 or @J2026 (German "Jahr")
        const yearTagMatch = text.match(/@[YyJj](\d{4})/);
        if (yearTagMatch) {
            const year = parseInt(yearTagMatch[1], 10);
            const date = new Date(year, 0, 1);
            results.push({
                tag: yearTagMatch[0],
                date,
                year,
                timeSlot,
                hasExplicitDate: true,
                checkboxState: detectCheckboxState(yearTagMatch[0])
            });
            return results;
        }

        // Try to find date tag (most specific) - NEW: @ prefix
        const dateMatch = text.match(/@(\d{1,4}[-./]\d{1,2}(?:[-./]\d{2,4})?)/);
        if (dateMatch) {
            const date = parseDateTag(dateMatch[0]);
            if (date) {
                results.push({
                    tag: dateMatch[0],
                    date,
                    timeSlot,
                    hasExplicitDate: true,
                    checkboxState: detectCheckboxState(dateMatch[0])
                });
                return results;
            }
        }

        // Try to find week tag(s) with OR syntax: @kw8|kw38, @kw8|38, @w8|w9
        // Pattern captures: optional year, first week prefix+number, then |number or |prefix+number repeats
        const weekOrMatch = text.match(/@(?:(\d{4})[-.]?)?(?:[wW]|[kK][wW])(\d{1,2})(?:\|(?:[wW]|[kK][wW])?(\d{1,2}))*(?=\s|$)/);
        if (weekOrMatch) {
            const fullMatch = weekOrMatch[0];
            const baseYear = weekOrMatch[1] ? parseInt(weekOrMatch[1], 10) : new Date().getFullYear();

            // Extract all week numbers from the match
            // First week is in group 2, additional weeks need to be parsed from the full match
            const weekNumbers: number[] = [];

            // Parse all week numbers from the full tag string
            const weekNumPattern = /(?:[wW]|[kK][wW])?(\d{1,2})/g;
            const tagContent = fullMatch.slice(1); // Remove @ prefix
            let numMatch;
            while ((numMatch = weekNumPattern.exec(tagContent)) !== null) {
                weekNumbers.push(parseInt(numMatch[1], 10));
            }

            // If weekday is specified, create a result for each week + weekday combination
            if (weekdayNum !== null) {
                for (const week of weekNumbers) {
                    const date = getWeekdayOfISOWeek(week, baseYear, weekdayNum);
                    results.push({
                        tag: fullMatch + ' ' + weekdayMatch![0],
                        date,
                        week,
                        year: baseYear,
                        weekday: weekdayNum,
                        timeSlot,
                        hasExplicitDate: true,
                        checkboxState: detectCheckboxState(fullMatch)
                    });
                }
            } else {
                // No weekday - create result for each week (Monday of that week)
                for (const week of weekNumbers) {
                    const date = getDateOfISOWeek(week, baseYear);
                    results.push({
                        tag: fullMatch,
                        date,
                        week,
                        year: baseYear,
                        timeSlot,
                        hasExplicitDate: true,
                        checkboxState: detectCheckboxState(fullMatch)
                    });
                }
            }

            if (results.length > 0) {
                return results;
            }
        }

        // Standalone weekday tag (without week) - means current week's weekday
        if (weekdayNum !== null && !weekOrMatch) {
            const today = new Date();
            const currentWeek = getISOWeek(today);
            const currentYear = today.getFullYear();
            const date = getWeekdayOfISOWeek(currentWeek, currentYear, weekdayNum);
            results.push({
                tag: weekdayMatch![0],
                date,
                weekday: weekdayNum,
                timeSlot,
                hasExplicitDate: true,
                checkboxState: detectCheckboxState(weekdayMatch![0])
            });
            return results;
        }

        // If no date or week but has time slot, treat as "today" (can inherit from column)
        if (results.length === 0 && timeSlot) {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            results.push({
                tag: timeSlot,
                date: today,
                timeSlot,
                hasExplicitDate: false,
                checkboxState: detectCheckboxState(timeSlot)
            });
        }

        return results;
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
                const { summaryLine } = splitTaskContent(task.content);
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
