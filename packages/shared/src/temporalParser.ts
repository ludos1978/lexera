/**
 * Pure temporal parsing functions extracted from DashboardScanner.
 *
 * Parses @-prefixed temporal tags: dates, weeks, weekdays, time ranges.
 * No VS Code dependencies — used by both the extension and ludos-sync.
 */

// Date locale configuration
let dateLocale: string = 'de-DE';

/**
 * Set the date locale for parsing (e.g. 'de-DE', 'en-US')
 */
export function setDateLocale(locale: string): void {
    dateLocale = locale;
}

/**
 * Check if locale uses day-first format (DD.MM.YYYY)
 */
export function isLocaleDayFirst(): boolean {
    const dayFirstLocales = ['de-DE', 'de-AT', 'de-CH', 'en-GB', 'fr-FR'];
    return dayFirstLocales.includes(dateLocale);
}

/**
 * Parse a date tag string into a Date object.
 * Supports: DD.MM.YYYY, DD.MM.YY, DD.MM, YYYY-MM-DD, YYYY.MM.DD
 * @ prefix for temporal tags.
 */
export function parseDateTag(tagContent: string): Date | null {
    const content = tagContent.startsWith('@') ? tagContent.slice(1) : tagContent;

    const dateMatch = content.match(/^(\d{1,4})[-./](\d{1,2})(?:[-./](\d{2,4}))?$/);
    if (!dateMatch) return null;

    const [, part1, part2, part3] = dateMatch;
    let year: number, month: number, day: number;

    const p1 = parseInt(part1, 10);
    const p2 = parseInt(part2, 10);
    const p3 = part3 ? parseInt(part3, 10) : undefined;

    if (p1 > 31) {
        year = p1;
        month = p2;
        day = p3 || 1;
    } else if (isLocaleDayFirst()) {
        day = p1;
        month = p2;
        if (p3 !== undefined) {
            year = p3 < 100 ? 2000 + p3 : p3;
        } else {
            year = new Date().getFullYear();
        }
    } else {
        month = p1;
        day = p2;
        if (p3 !== undefined) {
            year = p3 < 100 ? 2000 + p3 : p3;
        } else {
            year = new Date().getFullYear();
        }
    }

    if (month < 1 || month > 12) return null;
    if (day < 1 || day > 31) return null;
    if (year < 1900 || year > 2100) return null;

    return new Date(year, month - 1, day);
}

/**
 * Parse a week tag and return the Monday of that week.
 * Supports @W4, @KW4, @w4, @kw4, @2025-W4, @2025.W4
 */
export function parseWeekTag(tagContent: string): Date | null {
    const content = tagContent.startsWith('@') ? tagContent.slice(1) : tagContent;

    const weekYearMatch = content.match(/^(\d{4})[-.]?(?:[wW]|[kK][wW])(\d{1,2})$/);
    if (weekYearMatch) {
        const year = parseInt(weekYearMatch[1], 10);
        const week = parseInt(weekYearMatch[2], 10);
        return getDateOfISOWeek(week, year);
    }

    const weekMatch = content.match(/^(?:[wW]|[kK][wW])(\d{1,2})$/);
    if (weekMatch) {
        const week = parseInt(weekMatch[1], 10);
        const year = new Date().getFullYear();
        return getDateOfISOWeek(week, year);
    }

    return null;
}

/**
 * Get the Monday of a given ISO week.
 */
export function getDateOfISOWeek(week: number, year: number): Date {
    const jan4 = new Date(year, 0, 4);
    const dayOfWeek = jan4.getDay() || 7;
    const monday = new Date(jan4);
    monday.setDate(jan4.getDate() - dayOfWeek + 1 + (week - 1) * 7);
    return monday;
}

/**
 * Get a specific weekday of a given ISO week.
 * @param weekday - JS convention: 0=Sun, 1=Mon, ..., 6=Sat
 */
export function getWeekdayOfISOWeek(week: number, year: number, weekday: number): Date {
    const monday = getDateOfISOWeek(week, year);
    const daysFromMonday = weekday === 0 ? 6 : weekday - 1;
    const result = new Date(monday);
    result.setDate(monday.getDate() + daysFromMonday);
    return result;
}

/**
 * Parse weekday name to JS weekday number (0=Sun, 1=Mon, ..., 6=Sat)
 */
export function parseWeekdayName(name: string): number | null {
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
 * Get ISO week number for a date.
 */
export function getISOWeek(date: Date): number {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

/**
 * Result of extracting temporal information from text.
 */
export interface TemporalInfo {
    tag: string;
    date?: Date;
    week?: number;
    year?: number;
    weekday?: number;
    timeSlot?: string;
    hasExplicitDate?: boolean;
    checkboxState?: 'unchecked' | 'checked' | 'none';
}

/**
 * Extract temporal information from text.
 * Returns array of results to handle week OR syntax (e.g., @kw8|kw38 @fri).
 * Also detects checkbox state for deadline tasks.
 */
export function extractTemporalInfo(text: string): TemporalInfo[] {
    const results: TemporalInfo[] = [];

    // Check for time slot first (can be combined with date/week)
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
            if (startHours < 24 && startMins < 60 && endHours < 24 && endMins < 60) {
                timeSlot = timeRangeNoColonMatch[0];
            }
        }
    }

    // 4-digit time: @1230
    if (!timeSlot) {
        const time4DigitMatch = text.match(/@(\d{4})(?![-./\d])/);
        if (time4DigitMatch) {
            const digits = time4DigitMatch[1];
            const hours = parseInt(digits.substring(0, 2), 10);
            const mins = parseInt(digits.substring(2, 4), 10);
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

    // Check for weekday tag
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
                const checkedMatch = line.match(/^\s*- \[[xX]\]/);
                const uncheckedMatch = line.match(/^\s*- \[ \]/);
                if (checkedMatch) return 'checked';
                if (uncheckedMatch) return 'unchecked';
                return 'none';
            }
        }
        return 'none';
    };

    // Year tag: @Y2026 or @J2026
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

    // Date tag: @DD.MM.YYYY etc.
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

    // Week tag(s) with OR syntax: @kw8|kw38, @kw8|38
    const weekOrMatch = text.match(/@(?:(\d{4})[-.]?)?(?:[wW]|[kK][wW])(\d{1,2})(?:\|(?:[wW]|[kK][wW])?(\d{1,2}))*(?=\s|$)/);
    if (weekOrMatch) {
        const fullMatch = weekOrMatch[0];
        const baseYear = weekOrMatch[1] ? parseInt(weekOrMatch[1], 10) : new Date().getFullYear();

        const weekNumbers: number[] = [];
        const weekNumPattern = /(?:[wW]|[kK][wW])?(\d{1,2})/g;
        const tagContent = fullMatch.slice(1);
        let numMatch;
        while ((numMatch = weekNumPattern.exec(tagContent)) !== null) {
            weekNumbers.push(parseInt(numMatch[1], 10));
        }

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

    // Standalone weekday tag
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

    // Time slot only → "today"
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
