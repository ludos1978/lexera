/**
 * Maps KanbanColumn[] to iCalendar VTODO/VEVENT components.
 *
 * Mapping rules:
 *   Task with @HH:MM-HH:MM time range + date → VEVENT (DTSTART + DTEND)
 *   Task with @date or @week only (no time range) → VTODO (DUE date)
 *   Task with no temporal tags → VTODO (undated)
 *   - [x] checked → STATUS:COMPLETED, PERCENT-COMPLETE:100
 *   - [ ] unchecked → STATUS:NEEDS-ACTION
 *   #tag in content → CATEGORIES
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
 * Generate a stable UID from board slug, column title, and task first line.
 */
function generateUid(boardSlug: string, columnTitle: string, firstLine: string): string {
  const hash = crypto.createHash('sha256')
    .update(`${boardSlug}\0${columnTitle}\0${firstLine}`)
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
   */
  static columnsToIcalTasks(columns: KanbanColumn[], boardSlug: string): IcalTask[] {
    const tasks: IcalTask[] = [];

    for (const column of columns) {
      for (const task of column.tasks) {
        const icalTask = this.mapTask(task, column.title, boardSlug);
        tasks.push(icalTask);
      }
    }

    log.verbose(`[IcalMapper] Mapped ${tasks.length} tasks (${tasks.filter(t => t.type === 'VEVENT').length} events, ${tasks.filter(t => t.type === 'VTODO').length} todos)`);
    return tasks;
  }

  /**
   * Map a single KanbanTask to an IcalTask.
   */
  private static mapTask(task: KanbanTask, columnTitle: string, boardSlug: string): IcalTask {
    const content = task.content || '';
    const lines = content.split('\n');
    const firstLine = lines[0] || '';
    const description = lines.length > 1 ? lines.slice(1).join('\n').trim() : undefined;

    const uid = generateUid(boardSlug, columnTitle, firstLine);
    const temporals = extractTemporalInfo(firstLine);
    const temporal: TemporalInfo | null = temporals.length > 0 ? temporals[0] : null;

    const hashTags = extractHashTags(content);
    // Add column title as a category
    const categories = [columnTitle, ...hashTags];

    const checked = task.checked === true;
    const status = checked ? 'COMPLETED' : 'NEEDS-ACTION';

    // Determine type: VEVENT if has time range + date, otherwise VTODO
    let type: 'VEVENT' | 'VTODO' = 'VTODO';
    let dtstart: string | undefined;
    let dtend: string | undefined;
    let due: string | undefined;

    if (temporal) {
      const timeRange = temporal.timeSlot ? parseTimeRange(temporal.timeSlot) : null;

      if (timeRange && temporal.date && temporal.hasExplicitDate) {
        // VEVENT: has time range + explicit date
        type = 'VEVENT';
        dtstart = formatIcalDateTime(temporal.date, timeRange.startH, timeRange.startM);
        dtend = formatIcalDateTime(temporal.date, timeRange.endH, timeRange.endM);
      } else if (temporal.date && temporal.hasExplicitDate) {
        // VTODO with DUE date
        due = formatIcalDate(temporal.date);
      }
      // else: no explicit date → undated VTODO (no DUE)
    }

    return {
      uid,
      type,
      summary: firstLine,
      description,
      dtstart,
      dtend,
      due,
      status,
      percentComplete: checked ? 100 : undefined,
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
      lines.push(`DTSTART:${task.dtstart}`);
    }
    if (task.dtend) {
      lines.push(`DTEND:${task.dtend}`);
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
