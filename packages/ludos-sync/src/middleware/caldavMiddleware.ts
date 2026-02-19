/**
 * CalDAV protocol middleware for Express.
 *
 * Serves kanban tasks as calendar entries over CalDAV so calendar apps
 * (Apple Calendar, Thunderbird, GNOME Calendar, DAVx5) can display
 * the kanban schedule. Read-only.
 *
 * URL structure:
 *   /principal/                        → PROPFIND: current-user-principal, calendar-home-set
 *   /calendars/                        → PROPFIND: lists calendar collections (one per board)
 *   /calendars/{slug}/                 → PROPFIND: lists .ics members + ctag
 *   /calendars/{slug}/{uid}.ics        → GET: individual VTODO/VEVENT
 */

import * as crypto from 'crypto';
import { Router, Request, Response } from 'express';
import { XMLParser } from 'fast-xml-parser';
import { BoardFileWatcher } from '../fileWatcher';
import { IcalMapper } from '../mappers/IcalMapper';
import { log } from '../logger';

const DAV_NS = 'DAV:';
const CALDAV_NS = 'urn:ietf:params:xml:ns:caldav';

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: false,
});

/**
 * Extract Depth header value, defaulting to 'infinity'.
 */
function getDepth(req: Request): string {
  return (req.headers['depth'] as string) || 'infinity';
}

/**
 * Build a multistatus XML response wrapper.
 */
function multistatus(responses: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<D:multistatus xmlns:D="${DAV_NS}" xmlns:C="${CALDAV_NS}" xmlns:CS="http://calendarserver.org/ns/">
${responses.join('\n')}
</D:multistatus>`;
}

/**
 * Build a single <D:response> element.
 */
function davResponse(href: string, props: string[], notFoundProps?: string[]): string {
  let xml = `  <D:response>
    <D:href>${escapeXml(href)}</D:href>
    <D:propstat>
      <D:prop>
${props.map(p => '        ' + p).join('\n')}
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>`;

  if (notFoundProps && notFoundProps.length > 0) {
    xml += `
    <D:propstat>
      <D:prop>
${notFoundProps.map(p => '        ' + p).join('\n')}
      </D:prop>
      <D:status>HTTP/1.1 404 Not Found</D:status>
    </D:propstat>`;
  }

  xml += `
  </D:response>`;
  return xml;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Deduplicate tasks when merging from multiple boards sharing a calendar slug.
 * First deduplicates by UID (exact same source), then by content (same
 * summary + dtstart + dtend across different boards).
 */
function deduplicateTasks(tasks: import('../mappers/IcalMapper').IcalTask[]): import('../mappers/IcalMapper').IcalTask[] {
  const seenUids = new Set<string>();
  const seenContent = new Set<string>();
  return tasks.filter(task => {
    if (seenUids.has(task.uid)) return false;
    seenUids.add(task.uid);
    const key = `${task.summary}\0${task.dtstart || ''}\0${task.dtend || ''}`;
    if (seenContent.has(key)) return false;
    seenContent.add(key);
    return true;
  });
}

/**
 * Compute a composite CTag from all boards sharing a calendar slug.
 * Changes when ANY board in the group is modified.
 */
function compositeCtag(boards: { icalEtag?: string }[]): string {
  if (boards.length === 1) return boards[0].icalEtag || '"empty"';
  const combined = boards.map(b => b.icalEtag || '').join('\0');
  const hash = crypto.createHash('sha256').update(combined).digest('hex').substring(0, 16);
  return `"${hash}"`;
}

/**
 * Parse requested property names from PROPFIND body.
 * Returns null if no specific props requested (allprop).
 */
function parseRequestedProps(body: string): Set<string> | null {
  if (!body || body.trim().length === 0) return null;
  try {
    const parsed = xmlParser.parse(body);
    const propfind = parsed['D:propfind'] || parsed['d:propfind'] || parsed['propfind'] || {};
    const prop = propfind['D:prop'] || propfind['d:prop'] || propfind['prop'];
    if (!prop) return null;
    return new Set(Object.keys(prop));
  } catch {
    return null;
  }
}

/**
 * Create the CalDAV Express Router.
 */
export function createCaldavRouter(boardWatcher: BoardFileWatcher, basePath: string): Router {
  const router = Router();

  // -- OPTIONS: DAV compliance --
  router.use((_req: Request, res: Response, next) => {
    res.setHeader('DAV', '1, calendar-access');
    res.setHeader('Allow', 'OPTIONS, GET, HEAD, PROPFIND, REPORT');
    next();
  });

  router.use((req: Request, res: Response, next) => {
    if (req.method === 'OPTIONS') {
      res.status(200).end();
      return;
    }
    next();
  });

  // -- PROPFIND / (root discovery) --
  router.all('/', (req: Request, res: Response) => {
    if (req.method !== 'PROPFIND') {
      res.status(405).end();
      return;
    }

    log.verbose(`[CalDAV] PROPFIND /`);

    const responses = [
      davResponse(`${basePath}/`, [
        `<D:resourcetype><D:collection/></D:resourcetype>`,
        `<D:current-user-principal><D:href>${basePath}/principal/</D:href></D:current-user-principal>`,
        `<D:displayname>Ludos Kanban CalDAV</D:displayname>`,
      ]),
    ];

    res.status(207).type('application/xml; charset=utf-8').send(multistatus(responses));
  });

  // -- PROPFIND /principal/ --
  router.all('/principal/', (req: Request, res: Response) => {
    if (req.method !== 'PROPFIND') {
      res.status(405).end();
      return;
    }

    log.verbose(`[CalDAV] PROPFIND /principal/`);

    const responses = [
      davResponse(`${basePath}/principal/`, [
        `<D:resourcetype><D:principal/></D:resourcetype>`,
        `<D:current-user-principal><D:href>${basePath}/principal/</D:href></D:current-user-principal>`,
        `<C:calendar-home-set><D:href>${basePath}/calendars/</D:href></C:calendar-home-set>`,
        `<D:displayname>Ludos Kanban</D:displayname>`,
      ]),
    ];

    res.status(207).type('application/xml; charset=utf-8').send(multistatus(responses));
  });

  // -- PROPFIND /calendars/ --
  router.all('/calendars/', (req: Request, res: Response) => {
    if (req.method !== 'PROPFIND') {
      res.status(405).end();
      return;
    }

    const depth = getDepth(req);
    log.verbose(`[CalDAV] PROPFIND /calendars/ depth=${depth}`);

    const responses: string[] = [];

    // The collection itself
    responses.push(davResponse(`${basePath}/calendars/`, [
      `<D:resourcetype><D:collection/></D:resourcetype>`,
      `<D:displayname>Calendars</D:displayname>`,
    ]));

    // List calendar collections if depth > 0 (deduplicated by slug)
    if (depth !== '0') {
      const calBoards = boardWatcher.getCalendarBoards();
      // Group boards by slug for composite CTag
      const slugBoards = new Map<string, typeof calBoards>();
      for (const board of calBoards) {
        const slug = board.calendarSlug!;
        if (!slugBoards.has(slug)) slugBoards.set(slug, []);
        slugBoards.get(slug)!.push(board);
      }
      for (const [slug, boards] of slugBoards) {
        const name = boards[0].calendarName || boards[0].board.title || slug;
        const ctag = compositeCtag(boards);
        responses.push(davResponse(`${basePath}/calendars/${slug}/`, [
          `<D:resourcetype><D:collection/><C:calendar/></D:resourcetype>`,
          `<D:displayname>${escapeXml(name)}</D:displayname>`,
          `<CS:getctag>${escapeXml(ctag)}</CS:getctag>`,
          `<C:supported-calendar-component-set><C:comp name="VEVENT"/><C:comp name="VTODO"/></C:supported-calendar-component-set>`,
        ]));
      }
    }

    res.status(207).type('application/xml; charset=utf-8').send(multistatus(responses));
  });

  // -- PROPFIND & REPORT /calendars/:slug/ --
  router.all('/calendars/:slug/', (req: Request, res: Response, next) => {
    if (req.method !== 'PROPFIND' && req.method !== 'REPORT') {
      next();
      return;
    }

    const slug = String(req.params.slug);
    const depth = getDepth(req);
    // Aggregate tasks from ALL boards sharing this slug (workspace mode)
    const boards = boardWatcher.getBoardsByCalendarSlug(slug);

    if (boards.length === 0) {
      log.verbose(`[CalDAV] ${req.method} /calendars/${slug}/ -> 404`);
      res.status(404).send('Calendar not found');
      return;
    }

    // Merge tasks from all boards with this slug, deduplicating cross-board duplicates
    let allTasks: import('../mappers/IcalMapper').IcalTask[] = [];
    for (const b of boards) {
      if (b.icalTasks) { allTasks = allTasks.concat(b.icalTasks); }
    }
    const beforeDedup = allTasks.length;
    allTasks = deduplicateTasks(allTasks);

    log.verbose(`[CalDAV] ${req.method} /calendars/${slug}/ depth=${depth} boards=${boards.length} tasks=${allTasks.length} (deduped from ${beforeDedup})`);

    // If REPORT, apply calendar-multiget or calendar-query filtering
    let filteredTasks = allTasks;
    if (req.method === 'REPORT' && req.body) {
      const bodyStr = String(req.body);
      log.verbose(`[CalDAV] REPORT body (${bodyStr.length} bytes): ${bodyStr.substring(0, 300)}`);
      const report = parseReportBody(bodyStr, basePath, slug);
      filteredTasks = applyReportFilter(report, allTasks);
      log.verbose(`[CalDAV] REPORT ${report.type}: ${filteredTasks.length} tasks after filter (from ${allTasks.length})`);
    }

    const responses: string[] = [];
    const name = boards[0].calendarName || boards[0].board.title || slug;
    const ctag = compositeCtag(boards);

    // The collection itself
    responses.push(davResponse(`${basePath}/calendars/${slug}/`, [
      `<D:resourcetype><D:collection/><C:calendar/></D:resourcetype>`,
      `<D:displayname>${escapeXml(name)}</D:displayname>`,
      `<CS:getctag>${escapeXml(ctag)}</CS:getctag>`,
      `<C:supported-calendar-component-set><C:comp name="VEVENT"/><C:comp name="VTODO"/></C:supported-calendar-component-set>`,
    ]));

    // List .ics members if depth > 0 or REPORT
    if (depth !== '0' || req.method === 'REPORT') {
      for (const task of filteredTasks) {
        const uid = task.uid;
        const ics = IcalMapper.generateSingleIcs(task);
        const etag = `"${uid}"`;
        const props = [
          `<D:getetag>${etag}</D:getetag>`,
          `<D:getcontenttype>text/calendar; charset=utf-8</D:getcontenttype>`,
          `<D:getcontentlength>${Buffer.byteLength(ics, 'utf-8')}</D:getcontentlength>`,
        ];

        // Include calendar-data if REPORT
        if (req.method === 'REPORT') {
          props.push(`<C:calendar-data>${escapeXml(ics)}</C:calendar-data>`);
        }

        responses.push(davResponse(`${basePath}/calendars/${slug}/${uid}.ics`, props));
      }
    }

    res.status(207).type('application/xml; charset=utf-8').send(multistatus(responses));
  });

  // -- GET /calendars/:slug/:uid.ics --
  router.get('/calendars/:slug/:uid.ics', (req: Request, res: Response) => {
    const slug = String(req.params.slug);
    const uid = String(req.params.uid);
    const boards = boardWatcher.getBoardsByCalendarSlug(slug);

    if (boards.length === 0) {
      res.status(404).send('Calendar not found');
      return;
    }

    // Search across all boards sharing this slug
    let task: import('../mappers/IcalMapper').IcalTask | undefined;
    for (const b of boards) {
      task = b.icalTasks?.find(t => t.uid === uid);
      if (task) break;
    }

    if (!task) {
      res.status(404).send('Resource not found');
      return;
    }

    const ics = IcalMapper.generateSingleIcs(task);
    log.verbose(`[CalDAV] GET /calendars/${slug}/${uid}.ics (${ics.length} bytes)`);

    res.status(200)
      .type('text/calendar; charset=utf-8')
      .set('ETag', `"${uid}"`)
      .send(ics);
  });

  // -- GET /calendars/:slug/ (full calendar) --
  router.get('/calendars/:slug/', (req: Request, res: Response) => {
    const slug = String(req.params.slug);
    const boards = boardWatcher.getBoardsByCalendarSlug(slug);

    if (boards.length === 0) {
      res.status(404).send('Calendar not found');
      return;
    }

    // Merge tasks from all boards, deduplicating cross-board duplicates
    let allTasks: import('../mappers/IcalMapper').IcalTask[] = [];
    for (const b of boards) {
      if (b.icalTasks) { allTasks = allTasks.concat(b.icalTasks); }
    }
    allTasks = deduplicateTasks(allTasks);
    const calName = boards[0].calendarName || boards[0].board.title || slug;
    const fullCal = IcalMapper.generateCalendar(allTasks, calName);
    const etag = compositeCtag(boards);

    log.verbose(`[CalDAV] GET /calendars/${slug}/ (full calendar, ${boards.length} boards, ${allTasks.length} tasks, ${fullCal.length} bytes)`);

    res.status(200)
      .type('text/calendar; charset=utf-8')
      .set('ETag', etag)
      .send(fullCal);
  });

  // Catch-all for unsupported methods
  router.all('*', (req: Request, res: Response) => {
    log.verbose(`[CalDAV] Unsupported: ${req.method} ${req.path}`);
    // Read-only: reject write methods
    if (['PUT', 'DELETE', 'MKCALENDAR', 'PROPPATCH'].includes(req.method)) {
      res.status(403).send('Read-only CalDAV server');
      return;
    }
    res.status(404).end();
  });

  return router;
}

/**
 * Parse a REPORT body and return the type and filtering info.
 *
 * Handles two REPORT types per RFC 4791:
 *   - calendar-multiget: client requests specific resources by href
 *   - calendar-query: client requests resources matching a filter (time-range)
 */
function parseReportBody(body: string, basePath: string, slug: string): {
  type: 'multiget' | 'calendar-query' | 'unknown';
  requestedUids?: Set<string>;
  timeRangeStart?: Date;
  timeRangeEnd?: Date;
} {
  if (!body || body.trim().length === 0) return { type: 'unknown' };

  try {
    const parsed = xmlParser.parse(body);

    // Detect calendar-multiget (check all possible namespace prefixes)
    const multigetKey = Object.keys(parsed).find(k => k.toLowerCase().includes('calendar-multiget'));
    if (multigetKey) {
      const requestedUids = new Set<string>();

      // Extract .ics UIDs directly from the raw XML body using regex.
      // This is more robust than traversing fast-xml-parser's structure
      // which varies depending on namespace prefixes and element count.
      const hrefRegex = /<[^>]*href[^>]*>\s*([^<]+?)\s*<\/[^>]*href[^>]*>/gi;
      let hrefMatch;
      while ((hrefMatch = hrefRegex.exec(body)) !== null) {
        const href = hrefMatch[1].trim();
        if (href.endsWith('.ics')) {
          const filename = href.substring(href.lastIndexOf('/') + 1);
          const uid = filename.replace('.ics', '');
          if (uid.length > 0) requestedUids.add(uid);
        }
      }

      log.verbose(`[CalDAV] REPORT calendar-multiget: ${requestedUids.size} UIDs extracted`);
      return { type: 'multiget', requestedUids };
    }

    // Detect calendar-query with time-range filter
    const findTimeRange = (obj: Record<string, unknown>): { start?: string; end?: string } | null => {
      if (!obj || typeof obj !== 'object') return null;
      for (const key of Object.keys(obj)) {
        if (key.includes('time-range')) {
          const tr = obj[key] as Record<string, unknown>;
          return {
            start: (tr['@_start'] as string) || undefined,
            end: (tr['@_end'] as string) || undefined,
          };
        }
        const sub = findTimeRange(obj[key] as Record<string, unknown>);
        if (sub) return sub;
      }
      return null;
    };

    const timeRange = findTimeRange(parsed);
    if (timeRange) {
      const startDate = timeRange.start ? parseIcalTimestamp(timeRange.start) : undefined;
      const endDate = timeRange.end ? parseIcalTimestamp(timeRange.end) : undefined;
      log.verbose(`[CalDAV] REPORT calendar-query: time-range start=${timeRange.start} end=${timeRange.end}`);
      return { type: 'calendar-query', timeRangeStart: startDate ?? undefined, timeRangeEnd: endDate ?? undefined };
    }

    return { type: 'calendar-query' };
  } catch (err) {
    log.warn(`[CalDAV] Failed to parse REPORT body:`, err);
    return { type: 'unknown' };
  }
}

/**
 * Apply REPORT filters to a task list based on the parsed report info.
 */
function applyReportFilter(
  report: ReturnType<typeof parseReportBody>,
  tasks: import('../mappers/IcalMapper').IcalTask[]
): import('../mappers/IcalMapper').IcalTask[] {
  if (report.type === 'multiget' && report.requestedUids) {
    // If no UIDs were extracted, parsing likely failed — return all tasks as fallback
    if (report.requestedUids.size === 0) {
      log.warn(`[CalDAV] calendar-multiget with 0 extracted UIDs, returning all ${tasks.length} tasks as fallback`);
      return tasks;
    }
    return tasks.filter(task => report.requestedUids!.has(task.uid));
  }

  if (report.type === 'calendar-query') {
    if (!report.timeRangeStart && !report.timeRangeEnd) return tasks;
    return tasks.filter(task => {
      if (task.type === 'VTODO' && !task.due) return true;
      const taskDate = task.dtstart || task.due;
      if (!taskDate) return true;
      const d = parseIcalTimestamp(taskDate);
      if (!d) return true;
      if (report.timeRangeStart && d < report.timeRangeStart) return false;
      if (report.timeRangeEnd && d >= report.timeRangeEnd) return false;
      return true;
    });
  }

  return tasks;
}

/**
 * Parse an iCal timestamp string (YYYYMMDD or YYYYMMDDTHHMMSS or with Z) to Date.
 */
function parseIcalTimestamp(ts: string): Date | null {
  // Remove trailing Z
  const s = ts.replace(/Z$/, '');
  if (s.length === 8) {
    const y = parseInt(s.substring(0, 4), 10);
    const m = parseInt(s.substring(4, 6), 10) - 1;
    const d = parseInt(s.substring(6, 8), 10);
    return new Date(y, m, d);
  }
  if (s.length >= 15) {
    const y = parseInt(s.substring(0, 4), 10);
    const m = parseInt(s.substring(4, 6), 10) - 1;
    const d = parseInt(s.substring(6, 8), 10);
    const h = parseInt(s.substring(9, 11), 10);
    const min = parseInt(s.substring(11, 13), 10);
    const sec = parseInt(s.substring(13, 15), 10);
    return new Date(y, m, d, h, min, sec);
  }
  return null;
}
