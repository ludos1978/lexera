/**
 * Pure temporal parsing functions extracted from DashboardScanner.
 *
 * Parses @-prefixed temporal tags: dates, weeks (@w1/@kw1/@week1), weekdays, months (EN+DE), quarters, time ranges.
 * No VS Code dependencies — used by both the extension and ludos-sync.
 *
 * Multiple tags of the same type on a line are OR-connected (alternatives).
 * Tags of different types are AND-connected (combinatorial cross-product).
 * Example: @KW1 @KW2 @mon = (KW1 OR KW2) AND mon = [Mon-KW1, Mon-KW2]
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
 * Returns { date, hasExplicitYear } or null.
 */
export function parseDateTag(tagContent: string): Date | null {
    const result = parseDateTagFull(tagContent);
    return result ? result.date : null;
}

/**
 * Extended date parsing that also reports whether the year was explicit.
 */
function parseDateTagFull(tagContent: string): { date: Date; hasExplicitYear: boolean } | null {
    const content = tagContent.startsWith('@') ? tagContent.slice(1) : tagContent;

    const dateMatch = content.match(/^(\d{1,4})[-./](\d{1,2})(?:[-./](\d{2,4}))?$/);
    if (!dateMatch) return null;

    const [, part1, part2, part3] = dateMatch;
    let year: number, month: number, day: number;
    let hasExplicitYear = false;

    const p1 = parseInt(part1, 10);
    const p2 = parseInt(part2, 10);
    const p3 = part3 ? parseInt(part3, 10) : undefined;

    if (p1 > 31) {
        year = p1;
        month = p2;
        day = p3 || 1;
        hasExplicitYear = true;
    } else if (isLocaleDayFirst()) {
        day = p1;
        month = p2;
        if (p3 !== undefined) {
            year = p3 < 100 ? 2000 + p3 : p3;
            hasExplicitYear = true;
        } else {
            year = new Date().getFullYear();
        }
    } else {
        month = p1;
        day = p2;
        if (p3 !== undefined) {
            year = p3 < 100 ? 2000 + p3 : p3;
            hasExplicitYear = true;
        } else {
            year = new Date().getFullYear();
        }
    }

    if (month < 1 || month > 12) return null;
    if (day < 1 || day > 31) return null;
    if (year < 1900 || year > 2100) return null;

    return { date: new Date(year, month - 1, day), hasExplicitYear };
}

/**
 * Parse a week tag and return the Monday of that week.
 * Supports @W4, @KW4, @w4, @kw4, @2025-W4, @2025.W4
 */
export function parseWeekTag(tagContent: string): Date | null {
    const content = tagContent.startsWith('@') ? tagContent.slice(1) : tagContent;

    const weekYearMatch = content.match(/^(\d{4})[-.]?(?:[wW]eek|[kK][wW]|[wW])(\d{1,2})$/);
    if (weekYearMatch) {
        const year = parseInt(weekYearMatch[1], 10);
        const week = parseInt(weekYearMatch[2], 10);
        return getDateOfISOWeek(week, year);
    }

    const weekMatch = content.match(/^(?:[wW]eek|[kK][wW]|[wW])(\d{1,2})$/);
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
 * Parse month name to month number (1-12)
 */
export function parseMonthName(name: string): number | null {
    const months: Record<string, number> = {
        'jan': 1, 'january': 1, 'januar': 1,
        'feb': 2, 'february': 2, 'februar': 2,
        'mar': 3, 'march': 3, 'mär': 3, 'mrz': 3, 'märz': 3,
        'apr': 4, 'april': 4,
        'may': 5, 'mai': 5,
        'jun': 6, 'june': 6, 'juni': 6,
        'jul': 7, 'july': 7, 'juli': 7,
        'aug': 8, 'august': 8,
        'sep': 9, 'september': 9,
        'oct': 10, 'october': 10, 'okt': 10, 'oktober': 10,
        'nov': 11, 'november': 11,
        'dec': 12, 'december': 12, 'dez': 12, 'dezember': 12
    };
    return months[name.toLowerCase()] ?? null;
}

/**
 * Parse quarter tag to quarter number (1-4)
 */
export function parseQuarterTag(tag: string): number | null {
    const content = tag.startsWith('@') ? tag.slice(1) : tag;
    const match = content.match(/^[qQ]([1-4])$/);
    return match ? parseInt(match[1], 10) : null;
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
 * Get the last day of a month.
 */
function getLastDayOfMonth(year: number, month: number): Date {
    return new Date(year, month, 0);
}

/**
 * Get the Nth occurrence of a weekday in a given month.
 * @param year - Calendar year
 * @param month - Month number (1-12)
 * @param n - Occurrence (1 = first, 2 = second, etc.)
 * @param weekday - JS convention: 0=Sun, 1=Mon, ..., 6=Sat
 * @returns The date, or null if the Nth occurrence doesn't exist in the month
 */
function getNthWeekdayOfMonth(year: number, month: number, n: number, weekday: number): Date | null {
    const firstOfMonth = new Date(year, month - 1, 1);
    const firstDayOfWeek = firstOfMonth.getDay(); // 0=Sun
    let daysUntilFirst = weekday - firstDayOfWeek;
    if (daysUntilFirst < 0) daysUntilFirst += 7;
    const dayOfMonth = daysUntilFirst + 1 + (n - 1) * 7;
    const lastDay = getLastDayOfMonth(year, month).getDate();
    if (dayOfMonth > lastDay) return null;
    return new Date(year, month - 1, dayOfMonth);
}

/**
 * Get the date range for week N of a given month.
 * Week 1 = days 1-7, week 2 = days 8-14, etc.
 */
function getWeekOfMonthRange(year: number, month: number, weekNum: number): { start: Date; end: Date } | null {
    const startDay = (weekNum - 1) * 7 + 1;
    const lastDay = getLastDayOfMonth(year, month).getDate();
    if (startDay > lastDay) return null;
    const endDay = Math.min(weekNum * 7, lastDay);
    return {
        start: new Date(year, month - 1, startDay),
        end: new Date(year, month - 1, endDay)
    };
}

/**
 * Get start and end dates for a quarter.
 */
function getQuarterRange(quarter: number, year: number): { start: Date; end: Date } {
    const startMonth = (quarter - 1) * 3;
    return {
        start: new Date(year, startMonth, 1),
        end: getLastDayOfMonth(year, startMonth + 3)
    };
}

// ─── Internal token types ────────────────────────────────────────────

type TemporalTokenType = 'week' | 'weekday' | 'month' | 'quarter' | 'date' | 'time' | 'year';

interface TemporalToken {
    type: TemporalTokenType;
    tag: string;
    value: number;
    date?: Date;
    dateEnd?: Date;
    year?: number;
    hasExplicitYear: boolean;
    timeSlot?: string;
}

// ─── Token extraction (finds ALL temporal tags on a line) ────────────

/**
 * Extract all temporal tokens from a line of text.
 * Each @-prefixed temporal tag becomes a separate token.
 */
function extractTemporalTokens(text: string): TemporalToken[] {
    const tokens: TemporalToken[] = [];

    // --- Time tokens ---
    // Time range with colons: @09:00-17:00
    const timeRangeColonRe = /(?<=^|\s)@(\d{1,2}:\d{2})-(\d{1,2}:\d{2})/g;
    let m;
    while ((m = timeRangeColonRe.exec(text)) !== null) {
        tokens.push({ type: 'time', tag: m[0], value: 0, hasExplicitYear: true, timeSlot: m[0] });
    }

    // Time range without colons: @1200-1400
    if (tokens.filter(t => t.type === 'time').length === 0) {
        const timeRangeNoColonRe = /(?<=^|\s)@(\d{4})-(\d{4})/g;
        while ((m = timeRangeNoColonRe.exec(text)) !== null) {
            const start = m[1];
            const end = m[2];
            const sH = parseInt(start.substring(0, 2), 10);
            const sM = parseInt(start.substring(2, 4), 10);
            const eH = parseInt(end.substring(0, 2), 10);
            const eM = parseInt(end.substring(2, 4), 10);
            if (sH < 24 && sM < 60 && eH < 24 && eM < 60) {
                tokens.push({ type: 'time', tag: m[0], value: 0, hasExplicitYear: true, timeSlot: m[0] });
            }
        }
    }

    // 4-digit time: @1230 (only if no time range found)
    if (tokens.filter(t => t.type === 'time').length === 0) {
        const time4Re = /(?<=^|\s)@(\d{4})(?![-./\d])/g;
        while ((m = time4Re.exec(text)) !== null) {
            const digits = m[1];
            const hours = parseInt(digits.substring(0, 2), 10);
            const mins = parseInt(digits.substring(2, 4), 10);
            if (hours < 24 && mins < 60) {
                tokens.push({ type: 'time', tag: m[0], value: 0, hasExplicitYear: true, timeSlot: m[0] });
            }
        }
    }

    // Single time with colon: @09:30 (only if no time range or 4-digit time found)
    if (tokens.filter(t => t.type === 'time').length === 0) {
        const singleTimeColonRe = /(?<=^|\s)@(\d{1,2}):(\d{2})(?=\s|$)/g;
        while ((m = singleTimeColonRe.exec(text)) !== null) {
            const hours = parseInt(m[1], 10);
            const mins = parseInt(m[2], 10);
            if (hours < 24 && mins < 60) {
                tokens.push({ type: 'time', tag: m[0], value: 0, hasExplicitYear: true, timeSlot: m[0] });
            }
        }
    }

    // AM/PM time: @12pm, @9am (US locale only)
    if (tokens.filter(t => t.type === 'time').length === 0 && !isLocaleDayFirst()) {
        const ampmRe = /(?<=^|\s)@(\d{1,2})(am|pm)/gi;
        while ((m = ampmRe.exec(text)) !== null) {
            tokens.push({ type: 'time', tag: m[0], value: 0, hasExplicitYear: true, timeSlot: m[0] });
        }
    }

    // Collect all matched positions to avoid double-matching
    const timePositions = new Set<number>();
    for (const t of tokens) {
        const idx = text.indexOf(t.tag);
        if (idx >= 0) {
            for (let i = idx; i < idx + t.tag.length; i++) timePositions.add(i);
        }
    }

    // --- Year tags: @Y2026 or @J2026 ---
    const yearRe = /(?<=^|\s)@[YyJj](\d{4})/g;
    while ((m = yearRe.exec(text)) !== null) {
        if (timePositions.has(m.index)) continue;
        const year = parseInt(m[1], 10);
        tokens.push({
            type: 'year', tag: m[0], value: year,
            date: new Date(year, 0, 1), dateEnd: new Date(year, 11, 31),
            year, hasExplicitYear: true
        });
    }

    // --- Date tags: @DD.MM.YYYY, @YYYY-MM-DD, @DD.MM etc. ---
    const dateRe = /(?<=^|\s)@(\d{1,4}[-./]\d{1,2}(?:[-./]\d{2,4})?)/g;
    while ((m = dateRe.exec(text)) !== null) {
        if (timePositions.has(m.index)) continue;
        const parsed = parseDateTagFull(m[0]);
        if (parsed) {
            tokens.push({
                type: 'date', tag: m[0], value: 0,
                date: parsed.date, hasExplicitYear: parsed.hasExplicitYear
            });
        }
    }

    // --- Week tags: @KW7, @W5, @week3, @2026-W8, @kw8|kw38 (OR syntax with pipe) ---
    // Match individual week tags (space-separated) and pipe-OR groups
    const weekRe = /(?<=^|\s)@(?:(\d{4})[-.]?)?(?:[wW]eek|[kK][wW]|[wW])(\d{1,2})(?:\|(?:[wW]eek|[kK][wW]|[wW])?(\d{1,2}))*(?=\s|$)/g;
    while ((m = weekRe.exec(text)) !== null) {
        if (timePositions.has(m.index)) continue;
        const fullMatch = m[0];
        const explicitYear = m[1] ? parseInt(m[1], 10) : undefined;
        const baseYear = explicitYear ?? new Date().getFullYear();
        const hasExplicitYear = explicitYear !== undefined;

        // Extract all week numbers from the match (handles pipe OR syntax)
        const weekNumbers: number[] = [];
        const weekNumPattern = /(?:[wW]eek|[kK][wW]|[wW])?(\d{1,2})/g;
        const tagContent = fullMatch.slice(1); // skip @
        let numMatch;
        while ((numMatch = weekNumPattern.exec(tagContent)) !== null) {
            weekNumbers.push(parseInt(numMatch[1], 10));
        }

        for (const week of weekNumbers) {
            const monday = getDateOfISOWeek(week, baseYear);
            const sunday = new Date(monday);
            sunday.setDate(monday.getDate() + 6);
            tokens.push({
                type: 'week', tag: fullMatch, value: week,
                date: monday, dateEnd: sunday,
                year: baseYear, hasExplicitYear
            });
        }
    }

    // --- Quarter tags: @Q1, @Q2, @Q3, @Q4 ---
    const quarterRe = /(?<=^|\s)@[qQ]([1-4])(?=\s|$)/g;
    while ((m = quarterRe.exec(text)) !== null) {
        if (timePositions.has(m.index)) continue;
        const quarter = parseInt(m[1], 10);
        const year = new Date().getFullYear();
        const range = getQuarterRange(quarter, year);
        tokens.push({
            type: 'quarter', tag: m[0], value: quarter,
            date: range.start, dateEnd: range.end,
            year, hasExplicitYear: false
        });
    }

    // --- Month tags: @JAN, @january, etc. ---
    const monthNames = 'jan|january|januar|feb|february|februar|mar|march|mär|mrz|märz|apr|april|may|mai|jun|june|juni|jul|july|juli|aug|august|sep|september|oct|october|okt|oktober|nov|november|dec|december|dez|dezember';
    const monthRe = new RegExp('(?<=^|\\s)@(' + monthNames + ')(?=\\s|$)', 'gi');
    while ((m = monthRe.exec(text)) !== null) {
        if (timePositions.has(m.index)) continue;
        const monthNum = parseMonthName(m[1]);
        if (monthNum !== null) {
            const year = new Date().getFullYear();
            const start = new Date(year, monthNum - 1, 1);
            const end = getLastDayOfMonth(year, monthNum);
            tokens.push({
                type: 'month', tag: m[0], value: monthNum,
                date: start, dateEnd: end,
                year, hasExplicitYear: false
            });
        }
    }

    // --- Weekday tags: @mon, @friday, etc. ---
    const weekdayRe = /(?<=^|\s)@(mon|monday|tue|tuesday|wed|wednesday|thu|thursday|fri|friday|sat|saturday|sun|sunday)(?=\s|$)/gi;
    while ((m = weekdayRe.exec(text)) !== null) {
        if (timePositions.has(m.index)) continue;
        // Avoid matching if this position was already consumed by a month tag
        // (e.g. @march should not also match @mar as weekday)
        const alreadyMonth = tokens.some(t => t.type === 'month' && t.tag.toLowerCase() === m![0].toLowerCase());
        if (alreadyMonth) continue;
        const wd = parseWeekdayName(m[1]);
        if (wd !== null) {
            tokens.push({
                type: 'weekday', tag: m[0], value: wd,
                hasExplicitYear: false
            });
        }
    }

    return tokens;
}

// ─── Token combination (OR within type, AND across types) ────────────

/**
 * Combine extracted tokens into resolved TemporalInfo results.
 * Same-type tokens are OR-connected, cross-type are AND-connected.
 */
function combineTemporalTokens(
    tokens: TemporalToken[],
    checkboxState: 'unchecked' | 'checked' | 'none'
): TemporalInfo[] {
    // Group by type
    const weeks = tokens.filter(t => t.type === 'week');
    const weekdays = tokens.filter(t => t.type === 'weekday');
    const months = tokens.filter(t => t.type === 'month');
    const quarters = tokens.filter(t => t.type === 'quarter');
    const dates = tokens.filter(t => t.type === 'date');
    const times = tokens.filter(t => t.type === 'time');
    const years = tokens.filter(t => t.type === 'year');

    const timeSlot = times.length > 0 ? times[0].timeSlot : undefined;
    const results: TemporalInfo[] = [];

    // Helper to build combined tag string from tokens used
    const buildTag = (usedTokens: TemporalToken[]): string => {
        const tags = new Set<string>();
        for (const t of usedTokens) tags.add(t.tag);
        return Array.from(tags).join(' ');
    };

    // Year tags are highest priority (standalone)
    if (years.length > 0) {
        for (const yt of years) {
            results.push({
                tag: yt.tag,
                date: yt.date,
                dateEnd: yt.dateEnd,
                year: yt.year,
                timeSlot,
                hasExplicitDate: true,
                hasExplicitYear: true,
                checkboxState
            });
        }
        return results;
    }

    // Date tags are fully resolved (most specific)
    if (dates.length > 0) {
        for (const dt of dates) {
            results.push({
                tag: dt.tag,
                date: dt.date,
                timeSlot,
                hasExplicitDate: true,
                hasExplicitYear: dt.hasExplicitYear,
                checkboxState
            });
        }
        return results;
    }

    // Months (OR) × Weeks (OR) × Weekdays (OR) — Nth weekday of month
    // e.g. @jan @w1 @mon = first Monday in January
    if (months.length > 0 && weeks.length > 0 && weekdays.length > 0) {
        for (const mo of months) {
            for (const wk of weeks) {
                for (const wd of weekdays) {
                    const date = getNthWeekdayOfMonth(mo.year!, mo.value, wk.value, wd.value);
                    if (date) {
                        results.push({
                            tag: buildTag([mo, wk, wd]),
                            date,
                            month: mo.value,
                            week: wk.value,
                            weekday: wd.value,
                            year: mo.year,
                            timeSlot,
                            hasExplicitDate: true,
                            hasExplicitYear: false,
                            checkboxState
                        });
                    }
                }
            }
        }
        return results;
    }

    // Months (OR) × Weeks (OR) — week N of month (date range)
    // e.g. @jan @w2 = days 8-14 of January
    if (months.length > 0 && weeks.length > 0) {
        for (const mo of months) {
            for (const wk of weeks) {
                const range = getWeekOfMonthRange(mo.year!, mo.value, wk.value);
                if (range) {
                    results.push({
                        tag: buildTag([mo, wk]),
                        date: range.start,
                        dateEnd: range.end,
                        month: mo.value,
                        week: wk.value,
                        year: mo.year,
                        timeSlot,
                        hasExplicitDate: true,
                        hasExplicitYear: false,
                        checkboxState
                    });
                }
            }
        }
        return results;
    }

    // Weeks (OR) × Weekdays (OR) cross-product (ISO weeks, no month context)
    if (weeks.length > 0 && weekdays.length > 0) {
        for (const wk of weeks) {
            for (const wd of weekdays) {
                const date = getWeekdayOfISOWeek(wk.value, wk.year!, wd.value);
                results.push({
                    tag: buildTag([wk, wd]),
                    date,
                    week: wk.value,
                    year: wk.year,
                    weekday: wd.value,
                    timeSlot,
                    hasExplicitDate: true,
                    hasExplicitYear: wk.hasExplicitYear,
                    checkboxState
                });
            }
        }
        return results;
    }

    // Weeks only (no weekday, no month — ISO week)
    if (weeks.length > 0) {
        for (const wk of weeks) {
            results.push({
                tag: wk.tag,
                date: wk.date,
                dateEnd: wk.dateEnd,
                week: wk.value,
                year: wk.year,
                timeSlot,
                hasExplicitDate: true,
                hasExplicitYear: wk.hasExplicitYear,
                checkboxState
            });
        }
        return results;
    }

    // Months (OR) × Weekdays (OR) cross-product
    if (months.length > 0 && weekdays.length > 0) {
        for (const mo of months) {
            for (const wd of weekdays) {
                results.push({
                    tag: buildTag([mo, wd]),
                    date: mo.date,
                    dateEnd: mo.dateEnd,
                    month: mo.value,
                    weekday: wd.value,
                    year: mo.year,
                    timeSlot,
                    hasExplicitDate: true,
                    hasExplicitYear: false,
                    checkboxState
                });
            }
        }
        return results;
    }

    // Months only
    if (months.length > 0) {
        for (const mo of months) {
            results.push({
                tag: mo.tag,
                date: mo.date,
                dateEnd: mo.dateEnd,
                month: mo.value,
                year: mo.year,
                timeSlot,
                hasExplicitDate: true,
                hasExplicitYear: false,
                checkboxState
            });
        }
        return results;
    }

    // Quarters (OR) × Weekdays (OR) cross-product
    if (quarters.length > 0 && weekdays.length > 0) {
        for (const qt of quarters) {
            for (const wd of weekdays) {
                results.push({
                    tag: buildTag([qt, wd]),
                    date: qt.date,
                    dateEnd: qt.dateEnd,
                    quarter: qt.value,
                    weekday: wd.value,
                    year: qt.year,
                    timeSlot,
                    hasExplicitDate: true,
                    hasExplicitYear: false,
                    checkboxState
                });
            }
        }
        return results;
    }

    // Quarters only
    if (quarters.length > 0) {
        for (const qt of quarters) {
            results.push({
                tag: qt.tag,
                date: qt.date,
                dateEnd: qt.dateEnd,
                quarter: qt.value,
                year: qt.year,
                timeSlot,
                hasExplicitDate: true,
                hasExplicitYear: false,
                checkboxState
            });
        }
        return results;
    }

    // Standalone weekday(s)
    if (weekdays.length > 0) {
        const today = new Date();
        const currentWeek = getISOWeek(today);
        const currentYear = today.getFullYear();
        for (const wd of weekdays) {
            const date = getWeekdayOfISOWeek(currentWeek, currentYear, wd.value);
            results.push({
                tag: wd.tag,
                date,
                weekday: wd.value,
                timeSlot,
                hasExplicitDate: true,
                hasExplicitYear: false,
                checkboxState
            });
        }
        return results;
    }

    // Time slot only → "today"
    if (timeSlot) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        results.push({
            tag: timeSlot,
            date: today,
            timeSlot,
            hasExplicitDate: false,
            hasExplicitYear: true,
            checkboxState
        });
    }

    return results;
}

// ─── Checkbox detection ──────────────────────────────────────────────

/**
 * Detect checkbox state from the line containing temporal tags.
 */
function detectCheckboxState(text: string): 'unchecked' | 'checked' | 'none' {
    const lines = text.split('\n');
    for (const line of lines) {
        // Check the first line that has an @ temporal tag
        if (/(?<=^|\s)@\S/.test(line)) {
            if (/^\s*- \[[xX]\]/.test(line)) return 'checked';
            if (/^\s*- \[ \]/.test(line)) return 'unchecked';
            return 'none';
        }
    }
    return 'none';
}

// ─── Public interfaces ───────────────────────────────────────────────

/**
 * A temporal match resolved with inheritance context.
 * Produced by resolveTaskTemporals().
 */
export interface ResolvedTemporal {
    lineContent: string;
    temporal: TemporalInfo;
    effectiveDate: Date;
    effectiveDateEnd?: Date;
    effectiveWeek?: number;
    effectiveWeekday?: number;
}

/**
 * Result of extracting temporal information from text.
 */
export interface TemporalInfo {
    tag: string;
    date?: Date;
    dateEnd?: Date;
    week?: number;
    year?: number;
    weekday?: number;
    month?: number;
    quarter?: number;
    timeSlot?: string;
    hasExplicitDate?: boolean;
    hasExplicitYear?: boolean;
    checkboxState?: 'unchecked' | 'checked' | 'none';
}

// ─── Main extraction function ────────────────────────────────────────

/**
 * Extract temporal information from text.
 *
 * Finds ALL @-prefixed temporal tags on the line, groups by type,
 * and produces combinatorial results (OR within type, AND across types).
 *
 * Also detects checkbox state for deadline tasks.
 */
export function extractTemporalInfo(text: string): TemporalInfo[] {
    const tokens = extractTemporalTokens(text);
    if (tokens.length === 0) return [];

    const checkboxState = detectCheckboxState(text);
    return combineTemporalTokens(tokens, checkboxState);
}

// ─── Task-level temporal resolution ──────────────────────────────────

/**
 * Resolve temporal tags for all lines in a task, with hierarchical inheritance.
 *
 * Processes each line of taskContent, calling extractTemporalInfo per line.
 * Time-only tags (no explicit date) inherit their date from the task title
 * temporal context or the column temporal context.
 *
 * Used by both DashboardScanner and IcalMapper to ensure identical behavior.
 *
 * @param taskContent  Full task content (may be multi-line)
 * @param columnTemporal  Temporal info extracted from the column title (or null)
 */
export function resolveTaskTemporals(
    taskContent: string,
    columnTemporal: TemporalInfo | null
): ResolvedTemporal[] {
    const results: ResolvedTemporal[] = [];
    const lines = taskContent.split('\n');

    // Extract task title temporal from first line
    const titleLine = lines[0] || '';
    const titleTemporals = extractTemporalInfo(titleLine);
    const titleTemporal = titleTemporals.length > 0 ? titleTemporals[0] : null;

    // Track task-level temporal context (updated as lines are processed)
    let taskTemporalContext: TemporalInfo | null =
        (titleTemporal?.hasExplicitDate && titleTemporal.date) ? titleTemporal : null;

    for (const line of lines) {
        const lineTemporals = extractTemporalInfo(line);
        if (lineTemporals.length === 0) continue;

        for (const lineTemporal of lineTemporals) {
            let effectiveDate = lineTemporal.date;
            let effectiveDateEnd = lineTemporal.dateEnd;
            let effectiveWeek = lineTemporal.week;
            const effectiveWeekday = lineTemporal.weekday;
            let hasEffectiveDate = lineTemporal.hasExplicitDate === true;

            // Time-only tags inherit the calendar date but NOT the week/month structural context
            if (lineTemporal.timeSlot && !lineTemporal.hasExplicitDate) {
                if (taskTemporalContext?.date) {
                    effectiveDate = taskTemporalContext.date;
                    effectiveDateEnd = taskTemporalContext.dateEnd;
                    hasEffectiveDate = true;
                } else if (columnTemporal?.date && columnTemporal.hasExplicitDate) {
                    effectiveDate = columnTemporal.date;
                    effectiveDateEnd = columnTemporal.dateEnd;
                    hasEffectiveDate = true;
                }
            }

            // Update task temporal context for subsequent lines
            if (lineTemporal.hasExplicitDate && lineTemporal.date) {
                taskTemporalContext = lineTemporal;
            }

            if (!hasEffectiveDate || !effectiveDate) continue;

            results.push({
                lineContent: line.trim(),
                temporal: lineTemporal,
                effectiveDate,
                effectiveDateEnd,
                effectiveWeek,
                effectiveWeekday,
            });
        }
    }

    return results;
}
