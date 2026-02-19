/**
 * Maps KanbanColumn[] to iCalendar VEVENT components.
 *
 * Mapping rules (matching DashboardScanner behavior):
 *   Each line with a temporal tag → separate VEVENT
 *   Temporal inheritance: column → task title → line (same as dashboard)
 *   Time-only tags inherit date from task title or column
 *   Lines without temporal tags → skipped
 *   checked (task.checked=true) → STATUS:COMPLETED
 *   #tag in content → CATEGORIES
 *
 * Note: SharedMarkdownParser strips the "- [ ] " checkbox prefix from
 * task.content. Checked state comes from the task.checked boolean field.
 *
 * UID: SHA-256 hash of boardId + columnTitle + lineContent + occurrence.
 * Time handling: Floating time (no timezone suffix).
 */

import * as crypto from 'crypto';
import { KanbanColumn, KanbanCard, extractTemporalInfo, resolveTaskTemporals, TemporalInfo, isArchivedOrDeleted } from '@ludos/shared';
import { log } from '../logger';

export interface IcalTask {
  uid: string;
  type: 'VEVENT' | 'VTODO';
  summary: string;
  description?: string;
  dtstart?: string;
  dtend?: string;
  due?: string;
  status: string;
  percentComplete?: number;
  categories: string[];
  columnTitle: string;
}

/**
 * Parse a time slot string into start/end hours and minutes.
 * Supports @HH:MM-HH:MM, @HHMM-HHMM, @HH:MM, and @HHMM formats.
 * Single times (no range) default to 1-hour duration.
 */
function parseTimeRange(timeSlot: string): { startH: number; startM: number; endH: number; endM: number } | null {
  // @09:00-17:00
  const colonRangeMatch = timeSlot.match(/@(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})/);
  if (colonRangeMatch) {
    return {
      startH: parseInt(colonRangeMatch[1], 10),
      startM: parseInt(colonRangeMatch[2], 10),
      endH: parseInt(colonRangeMatch[3], 10),
      endM: parseInt(colonRangeMatch[4], 10),
    };
  }
  // @0900-1700
  const noColonRangeMatch = timeSlot.match(/@(\d{2})(\d{2})-(\d{2})(\d{2})/);
  if (noColonRangeMatch) {
    return {
      startH: parseInt(noColonRangeMatch[1], 10),
      startM: parseInt(noColonRangeMatch[2], 10),
      endH: parseInt(noColonRangeMatch[3], 10),
      endM: parseInt(noColonRangeMatch[4], 10),
    };
  }
  // Single time @09:30 → 1-hour duration
  const singleColonMatch = timeSlot.match(/@(\d{1,2}):(\d{2})/);
  if (singleColonMatch) {
    const startH = parseInt(singleColonMatch[1], 10);
    const startM = parseInt(singleColonMatch[2], 10);
    const endH = startH + 1 < 24 ? startH + 1 : 23;
    const endM = startH + 1 < 24 ? startM : 59;
    return { startH, startM, endH, endM };
  }
  // Single time @0930 → 1-hour duration
  const single4Match = timeSlot.match(/@(\d{2})(\d{2})/);
  if (single4Match) {
    const startH = parseInt(single4Match[1], 10);
    const startM = parseInt(single4Match[2], 10);
    if (startH < 24 && startM < 60) {
      const endH = startH + 1 < 24 ? startH + 1 : 23;
      const endM = startH + 1 < 24 ? startM : 59;
      return { startH, startM, endH, endM };
    }
  }
  return null;
}

/**
 * Format a Date as iCal DATE (YYYYMMDD).
 */
function formatIcalDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

/**
 * Format a Date + time as iCal DATETIME (YYYYMMDDTHHMMSS) — floating time.
 */
function formatIcalDateTime(date: Date, hours: number, minutes: number): string {
  return `${formatIcalDate(date)}T${String(hours).padStart(2, '0')}${String(minutes).padStart(2, '0')}00`;
}

/**
 * Generate a stable UID from board identifier, column title, task first line,
 * and occurrence index (to disambiguate identical tasks in the same column).
 */
function generateUid(boardId: string, columnTitle: string, firstLine: string, occurrence: number): string {
  const hash = crypto.createHash('sha256')
    .update(`${boardId}\0${columnTitle}\0${firstLine}\0${occurrence}`)
    .digest('hex')
    .substring(0, 16);
  return hash;
}

/**
 * Extract #tags from task content.
 */
function extractHashTags(content: string): string[] {
  const tags: string[] = [];
  const regex = /#([a-zA-Z0-9_-]+)/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    tags.push(match[1]);
  }
  return tags;
}

/**
 * Fold long iCal lines at 75 octets per RFC 5545.
 */
function foldLine(line: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [];
  parts.push(line.substring(0, 75));
  let pos = 75;
  while (pos < line.length) {
    parts.push(' ' + line.substring(pos, pos + 74));
    pos += 74;
  }
  return parts.join('\r\n');
}

/**
 * Escape text for iCal property values per RFC 5545.
 */
function escapeIcalText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

export class IcalMapper {

  /**
   * Convert kanban columns into an array of IcalTask objects.
   *
   * Uses resolveTaskTemporals() from @ludos/shared — the same function
   * DashboardScanner uses — to ensure identical temporal resolution.
   *
   * @param boardId Unique identifier per board (e.g. file path) used for UID generation.
   */
  static columnsToIcalTasks(columns: KanbanColumn[], boardId: string): IcalTask[] {
    const results: IcalTask[] = [];
    const occurrences = new Map<string, number>();

    for (const column of columns) {
      // Skip archived/deleted columns
      if (isArchivedOrDeleted(column.title || '')) continue;

      const columnTemporals = extractTemporalInfo(column.title || '');
      const columnTemporal = columnTemporals.length > 0 ? columnTemporals[0] : null;

      for (const task of column.cards) {
        const content = task.content || '';

        // Skip archived/deleted tasks
        if (isArchivedOrDeleted(content)) continue;
        const hashTags = extractHashTags(content);
        const categories = [column.title, ...hashTags];
        const checked = task.checked === true;
        const taskSummaryLine = content.split('\n')[0] || '';

        // Shared temporal resolution (same logic as DashboardScanner)
        const resolved = resolveTaskTemporals(content, columnTemporal);

        for (const r of resolved) {
          const occKey = `${column.title}\0${r.lineContent}`;
          const occ = occurrences.get(occKey) || 0;
          occurrences.set(occKey, occ + 1);
          const uid = generateUid(boardId, column.title, r.lineContent, occ);

          const summary = this.cleanSummary(r.lineContent || taskSummaryLine);
          const event = this.buildEvent(uid, summary, r.effectiveDate, r.temporal, r.effectiveWeek, r.effectiveWeekday, checked, categories, column.title);
          if (event) {
            results.push(event);
          }
        }
      }
    }

    log.verbose(`[IcalMapper] Mapped ${results.length} events from ${columns.length} columns`);
    return results;
  }

  /**
   * Strip `- [ ]` / `- [x]` checkbox prefix from text.
   */
  private static stripCheckbox(text: string): string {
    return text.replace(/^\s*- \[[xX ]\]\s*/, '');
  }

  /**
   * Strip @temporal tags (dates, weeks, weekdays, time ranges) from text.
   */
  private static stripTemporalTags(text: string): string {
    return text
      // Time ranges: @09:00-17:00, @0900-1700
      .replace(/@\d{1,2}:\d{2}-\d{1,2}:\d{2}/g, '')
      .replace(/@\d{4}-\d{4}/g, '')
      // 4-digit time: @1230
      .replace(/@\d{4}(?![-./\d])/g, '')
      // Single time: @09:30
      .replace(/@\d{1,2}:\d{2}(?=\s|$)/g, '')
      // AM/PM time: @12pm, @9am
      .replace(/@\d{1,2}(?:am|pm)/gi, '')
      // Date tags: @DD.MM.YYYY, @YYYY-MM-DD, @DD.MM
      .replace(/@\d{1,4}[-./]\d{1,2}(?:[-./]\d{2,4})?/g, '')
      // Year tags: @Y2026, @J2026
      .replace(/@[YyJj]\d{4}/g, '')
      // Week tags with OR syntax: @kw8|kw38, @KW8, @W4, @2025-W4
      .replace(/@(?:\d{4}[-.]?)?(?:[wW]|[kK][wW])\d{1,2}(?:\|(?:[wW]|[kK][wW])?\d{1,2})*/g, '')
      // Weekday tags: @mon, @friday
      .replace(/@(?:mon|monday|tue|tuesday|wed|wednesday|thu|thursday|fri|friday|sat|saturday|sun|sunday)(?=\s|$)/gi, '')
      // Clean up extra whitespace
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  /**
   * Strip markdown/kanban formatting from text for clean calendar display.
   */
  private static stripMarkdownFormatting(text: string): string {
    return text
      // Wiki link brackets: [[ and ]]
      .replace(/\[\[/g, '')
      .replace(/\]\]/g, '')
      // Hashtags: #word (until space, tab, or end)
      .replace(/#[^\s]+/g, '')
      // Pipe separators (table cells)
      .replace(/\|/g, ' ')
      // Leading list marker: "- "
      .replace(/^\s*-\s+/, '')
      .replace(/^\s*-\s+/, '')
      // Leading colon: ": "
      .replace(/^\s*:\s+/, '')
      // Collapse whitespace and trim
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  /**
   * Build a clean summary by stripping checkbox, temporal tags, and formatting.
   */
  private static cleanSummary(text: string): string {
    return this.stripMarkdownFormatting(this.stripTemporalTags(this.stripCheckbox(text)));
  }

  /**
   * Build a single VEVENT from resolved temporal data.
   */
  private static buildEvent(
    uid: string, summary: string, effectiveDate: Date,
    lineTemporal: TemporalInfo, effectiveWeek: number | undefined,
    effectiveWeekday: number | undefined,
    checked: boolean, categories: string[], columnTitle: string
  ): IcalTask | null {
    let dtstart: string | undefined;
    let dtend: string | undefined;
    let due: string | undefined;

    const timeRange = lineTemporal.timeSlot ? parseTimeRange(lineTemporal.timeSlot) : null;

    if (timeRange) {
      // Date + time range → timed event
      dtstart = formatIcalDateTime(effectiveDate, timeRange.startH, timeRange.startM);
      dtend = formatIcalDateTime(effectiveDate, timeRange.endH, timeRange.endM);
    } else if (effectiveWeek !== undefined && effectiveWeekday === undefined) {
      // Week tag without specific weekday → all-day event spanning the full week (Mon–Sun)
      const monday = effectiveDate;
      const nextMonday = new Date(monday);
      nextMonday.setDate(monday.getDate() + 7);
      dtstart = formatIcalDate(monday);
      dtend = formatIcalDate(nextMonday); // iCal DATE DTEND is exclusive
      due = formatIcalDate(monday);
    } else {
      // Single date → all-day event
      dtstart = formatIcalDate(effectiveDate);
      due = formatIcalDate(effectiveDate);
    }

    return {
      uid,
      type: 'VEVENT',
      summary,
      dtstart,
      dtend,
      due,
      status: checked ? 'COMPLETED' : 'CONFIRMED',
      categories,
      columnTitle,
    };
  }

  /**
   * Generate a full VCALENDAR string from IcalTask array.
   */
  static generateCalendar(tasks: IcalTask[], calendarName: string): string {
    const lines: string[] = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Ludos Sync//Kanban CalDAV//EN',
      foldLine(`X-WR-CALNAME:${escapeIcalText(calendarName)}`),
    ];

    for (const task of tasks) {
      lines.push(...this.generateComponent(task));
    }

    lines.push('END:VCALENDAR');

    return lines.map(l => foldLine(l)).join('\r\n') + '\r\n';
  }

  /**
   * Generate a single VEVENT or VTODO component for an IcalTask.
   */
  static generateComponent(task: IcalTask): string[] {
    const lines: string[] = [];

    lines.push(`BEGIN:${task.type}`);
    lines.push(`UID:${task.uid}@ludos-sync`);
    lines.push(`SUMMARY:${escapeIcalText(task.summary)}`);

    if (task.dtstart) {
      // All-day events use VALUE=DATE (8 chars), timed events use datetime (15+ chars)
      const isAllDay = task.dtstart.length === 8;
      lines.push(isAllDay ? `DTSTART;VALUE=DATE:${task.dtstart}` : `DTSTART:${task.dtstart}`);
    }
    if (task.dtend) {
      const isAllDay = task.dtend.length === 8;
      lines.push(isAllDay ? `DTEND;VALUE=DATE:${task.dtend}` : `DTEND:${task.dtend}`);
    }
    if (task.due) {
      lines.push(`DUE;VALUE=DATE:${task.due}`);
    }

    lines.push(`STATUS:${task.status}`);

    if (task.percentComplete !== undefined) {
      lines.push(`PERCENT-COMPLETE:${task.percentComplete}`);
    }

    if (task.categories.length > 0) {
      lines.push(`CATEGORIES:${task.categories.map(c => escapeIcalText(c)).join(',')}`);
    }

    if (task.description) {
      lines.push(`DESCRIPTION:${escapeIcalText(task.description)}`);
    }

    // DTSTAMP is required — use epoch as a fixed value since we're read-only
    lines.push(`DTSTAMP:${formatIcalDate(new Date())}T000000Z`);

    lines.push(`END:${task.type}`);

    return lines;
  }

  /**
   * Generate a single .ics file for one task (individual resource).
   */
  static generateSingleIcs(task: IcalTask): string {
    const lines: string[] = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Ludos Sync//Kanban CalDAV//EN',
      ...this.generateComponent(task),
      'END:VCALENDAR',
    ];

    return lines.map(l => foldLine(l)).join('\r\n') + '\r\n';
  }
}
