/**
 * Maps KanbanColumn[] to iCalendar VTODO/VEVENT components.
 *
 * Mapping rules:
 *   Task with any date/week/time → VEVENT (visible on calendar)
 *   Task with no temporal tags   → skipped (not added to calendar)
 *   checked (task.checked=true) → STATUS:COMPLETED, PERCENT-COMPLETE:100
 *   unchecked → STATUS:NEEDS-ACTION
 *   #tag in content → CATEGORIES
 *
 * Note: SharedMarkdownParser strips the "- [ ] " checkbox prefix from
 * task.content. Checked state comes from the task.checked boolean field.
 *
 * UID: SHA-256 hash of boardSlug + columnTitle + firstLine, truncated to 16 hex chars.
 * Time handling: Floating time (no timezone suffix).
 */

import * as crypto from 'crypto';
import { KanbanColumn, KanbanTask, extractTemporalInfo, TemporalInfo } from '@ludos/shared';
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
 * Supports @HH:MM-HH:MM and @HHMM-HHMM formats.
 */
function parseTimeRange(timeSlot: string): { startH: number; startM: number; endH: number; endM: number } | null {
  // @09:00-17:00
  const colonMatch = timeSlot.match(/@(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})/);
  if (colonMatch) {
    return {
      startH: parseInt(colonMatch[1], 10),
      startM: parseInt(colonMatch[2], 10),
      endH: parseInt(colonMatch[3], 10),
      endM: parseInt(colonMatch[4], 10),
    };
  }
  // @0900-1700
  const noColonMatch = timeSlot.match(/@(\d{2})(\d{2})-(\d{2})(\d{2})/);
  if (noColonMatch) {
    return {
      startH: parseInt(noColonMatch[1], 10),
      startM: parseInt(noColonMatch[2], 10),
      endH: parseInt(noColonMatch[3], 10),
      endM: parseInt(noColonMatch[4], 10),
    };
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
   * @param boardId Unique identifier per board (e.g. file path) used for UID generation.
   *   This ensures tasks from different boards get distinct UIDs even when
   *   multiple boards share the same calendar slug (workspace mode).
   */
  static columnsToIcalTasks(columns: KanbanColumn[], boardId: string): IcalTask[] {
    const tasks: IcalTask[] = [];
    // Track occurrences of (columnTitle, firstLine) to disambiguate identical tasks
    const occurrences = new Map<string, number>();

    for (const column of columns) {
      for (const task of column.tasks) {
        const firstLine = (task.content || '').split('\n')[0] || '';
        const key = `${column.title}\0${firstLine}`;
        const occ = occurrences.get(key) || 0;
        occurrences.set(key, occ + 1);
        const mapped = this.mapTask(task, column.title, boardId, occ);
        tasks.push(...mapped);
      }
    }

    log.verbose(`[IcalMapper] Mapped ${tasks.length} tasks (${tasks.filter(t => t.type === 'VEVENT').length} events, ${tasks.filter(t => t.type === 'VTODO').length} todos)`);
    return tasks;
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
   * Build a clean summary by stripping checkbox and temporal tags.
   */
  private static cleanSummary(text: string): string {
    return this.stripTemporalTags(this.stripCheckbox(text));
  }

  /**
   * Map a single KanbanTask to exactly one IcalTask entry.
   *
   * SharedMarkdownParser strips the "- [ ] " checkbox prefix from task.content,
   * so all kanban tasks are checkboxes. The checked/unchecked status comes from
   * task.checked instead.
   *
   * Mapping rules:
   *   Any task with a date/week/time  → VEVENT (visible on calendar)
   *   No temporal tags                → skipped (not added to calendar)
   *   Checked status always applied via task.checked field.
   */
  private static mapTask(task: KanbanTask, columnTitle: string, boardId: string, occurrence: number): IcalTask[] {
    const content = task.content || '';
    const lines = content.split('\n');
    const firstLine = lines[0] || '';
    const description = lines.length > 1 ? lines.slice(1).join('\n').trim() : undefined;

    const uid = generateUid(boardId, columnTitle, firstLine, occurrence);
    const temporals = extractTemporalInfo(firstLine);
    const temporal: TemporalInfo | null = temporals.length > 0 ? temporals[0] : null;

    const hashTags = extractHashTags(content);
    const categories = [columnTitle, ...hashTags];

    const checked = task.checked === true;
    const summary = this.cleanSummary(firstLine);

    // Determine temporal data
    let hasTimeRange = false;
    let hasDate = false;
    let dtstart: string | undefined;
    let dtend: string | undefined;
    let due: string | undefined;

    if (temporal) {
      const timeRange = temporal.timeSlot ? parseTimeRange(temporal.timeSlot) : null;

      if (timeRange && temporal.date && temporal.hasExplicitDate) {
        // Specific date + time range → timed event
        hasTimeRange = true;
        hasDate = true;
        dtstart = formatIcalDateTime(temporal.date, timeRange.startH, timeRange.startM);
        dtend = formatIcalDateTime(temporal.date, timeRange.endH, timeRange.endM);
      } else if (temporal.week !== undefined && temporal.weekday === undefined && temporal.date && temporal.hasExplicitDate) {
        // Week tag without specific weekday → all-day event spanning the full week (Mon–Sun)
        hasDate = true;
        const monday = temporal.date; // extractTemporalInfo returns Monday for week-only tags
        const sunday = new Date(monday);
        sunday.setDate(monday.getDate() + 7);
        dtstart = formatIcalDate(monday);
        dtend = formatIcalDate(sunday); // iCal DATE DTEND is exclusive
        due = formatIcalDate(monday);
      } else if (temporal.date && temporal.hasExplicitDate) {
        // Single date → due date
        hasDate = true;
        dtstart = formatIcalDate(temporal.date);
        due = formatIcalDate(temporal.date);
      }
    }

    // Only tasks with dates appear in the calendar — undated tasks are skipped
    if (!hasDate) {
      return [];
    }

    return [{
      uid,
      type: 'VEVENT',
      summary,
      description,
      dtstart,
      dtend,
      status: checked ? 'COMPLETED' : 'CONFIRMED',
      categories,
      columnTitle,
    }];
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
