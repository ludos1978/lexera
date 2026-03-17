/**
 * Express + Nephele WebDAV server lifecycle.
 *
 * Starts/stops the WebDAV server, registers the bookmark adapter.
 */

import express from 'express';
import createServer from 'nephele';
import * as http from 'http';
import * as path from 'path';
import { BookmarkAdapter } from './adapters/BookmarkAdapter';
import { LocalhostAuth } from './auth/LocalhostAuth';
import { BoardFileWatcher } from './fileWatcher';
import { ConfigManager, SyncConfig, resolveBoardOptions } from './config';
import { createCaldavRouter } from './middleware/caldavMiddleware';
import { createApiRouter } from './middleware/apiMiddleware';
import { log } from './logger';
import { resolveProcessName, recordAccess, getRecentClients, stopTracking } from './clientTracker';
import type { Socket } from 'net';

// Augment Socket to carry the resolved process name
interface TrackedSocket extends Socket {
  _processNamePromise?: Promise<string>;
}

const DAV_ALLOWED_METHODS = 'OPTIONS, GET, HEAD, PROPFIND, REPORT, PROPPATCH, PUT, DELETE, MKCALENDAR';

function setDavHeaders(res: express.Response): void {
  res.setHeader('DAV', '1, calendar-access');
  res.setHeader('Allow', DAV_ALLOWED_METHODS);
  res.setHeader('Access-Control-Allow-Methods', DAV_ALLOWED_METHODS);
}

function isUnauthenticatedCaldavDiscoveryRequest(req: express.Request): boolean {
  const method = String(req.method || '').toUpperCase();
  if (method !== 'PROPFIND' && method !== 'OPTIONS' && method !== 'HEAD') {
    return false;
  }
  const pathOnly = String(req.path || req.url || '');
  return pathOnly === '/.well-known/caldav'
    || pathOnly === '/'
    || pathOnly === '/caldav'
    || pathOnly === '/caldav/'
    || pathOnly === '/caldav/principal/'
    || pathOnly === '/principals'
    || pathOnly === '/principals/'
    || pathOnly.startsWith('/principals/')
    || pathOnly === '/calendar/dav'
    || pathOnly === '/calendar/dav/'
    || pathOnly.startsWith('/calendar/dav/');
}

function isLoopbackAddress(address: string | undefined | null): boolean {
  const value = String(address || '').trim();
  return value === '::1'
    || value === '127.0.0.1'
    || value === '::ffff:127.0.0.1'
    || value === '::ffff:7f00:1';
}

function isUnauthenticatedLoopbackCalendarReadRequest(req: express.Request): boolean {
  const method = String(req.method || '').toUpperCase();
  if (!['PROPFIND', 'REPORT', 'GET', 'HEAD', 'OPTIONS'].includes(method)) {
    return false;
  }
  if (!isLoopbackAddress(req.socket?.remoteAddress)) {
    return false;
  }
  const pathOnly = String(req.path || req.url || '');
  return pathOnly === '/caldav/calendars'
    || pathOnly === '/caldav/calendars/'
    || pathOnly.startsWith('/caldav/calendars/');
}

function caldavMultistatus(responses: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
${responses.join('\n')}
</D:multistatus>`;
}

function caldavResponse(href: string, props: string[]): string {
  return `  <D:response>
    <D:href>${href}</D:href>
    <D:propstat>
      <D:prop>
${props.map(p => '        ' + p).join('\n')}
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>`;
}

function buildPrincipalCollectionSet(): string {
  return '<D:principal-collection-set><D:href>/principals/</D:href><D:href>/caldav/principals/</D:href></D:principal-collection-set>';
}

function buildPrincipalReportSet(): string {
  return `<D:supported-report-set>
  <D:supported-report><D:report><D:expand-property/></D:report></D:supported-report>
  <D:supported-report><D:report><D:principal-property-search/></D:report></D:supported-report>
  <D:supported-report><D:report><D:principal-search-property-set/></D:report></D:supported-report>
</D:supported-report-set>`;
}

function buildCalendarUserAddressSet(username: string | null): string {
  const safeUser = String(username || 'lexera')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<C:calendar-user-address-set><D:href>/caldav/principal/</D:href><D:href>mailto:${safeUser}@localhost</D:href></C:calendar-user-address-set>`;
}

function decodeBasicAuthUsername(req: express.Request): string | null {
  const authHeader = String(req.headers.authorization || '');
  if (!authHeader.startsWith('Basic ')) return null;
  try {
    const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf8');
    const colonIndex = decoded.indexOf(':');
    if (colonIndex === -1) return null;
    const username = decoded.slice(0, colonIndex).trim();
    return username || null;
  } catch {
    return null;
  }
}

function sendDiscoveryRoot(res: express.Response): void {
  setDavHeaders(res);
  res.status(207).type('application/xml; charset=utf-8').send(caldavMultistatus([
    caldavResponse('/', [
      '<D:resourcetype><D:collection/></D:resourcetype>',
      '<D:current-user-principal><D:href>/caldav/principal/</D:href></D:current-user-principal>',
      buildPrincipalCollectionSet(),
      buildPrincipalReportSet(),
      '<D:displayname>Lexera CalDAV</D:displayname>',
    ]),
  ]));
}

function sendDiscoveryPrincipals(req: express.Request, res: express.Response): void {
  setDavHeaders(res);
  const depth = String(req.headers.depth || '0');
  const username = decodeBasicAuthUsername(req);
  const responses = [
    caldavResponse('/principals/', [
      '<D:resourcetype><D:collection/></D:resourcetype>',
      '<D:current-user-principal><D:href>/caldav/principal/</D:href></D:current-user-principal>',
      buildPrincipalCollectionSet(),
      buildPrincipalReportSet(),
      '<D:displayname>Principals</D:displayname>',
    ]),
  ];
  if (depth !== '0') {
    responses.push(caldavResponse('/caldav/principal/', [
      '<D:resourcetype><D:principal/></D:resourcetype>',
      '<D:current-user-principal><D:href>/caldav/principal/</D:href></D:current-user-principal>',
      '<D:principal-URL><D:href>/caldav/principal/</D:href></D:principal-URL>',
      buildPrincipalCollectionSet(),
      '<C:calendar-home-set><D:href>/caldav/calendars/</D:href></C:calendar-home-set>',
      buildCalendarUserAddressSet(username),
      '<D:owner><D:href>/caldav/principal/</D:href></D:owner>',
      buildPrincipalReportSet(),
      `<D:displayname>${username || 'Lexera'}</D:displayname>`,
    ]));
  }
  res.status(207).type('application/xml; charset=utf-8').send(caldavMultistatus(responses));
}

function sendDiscoveryPrincipalAlias(req: express.Request, res: express.Response): void {
  setDavHeaders(res);
  const href = String(req.path || '/caldav/principal/');
  const username = decodeBasicAuthUsername(req);
  res.status(207).type('application/xml; charset=utf-8').send(caldavMultistatus([
    caldavResponse(href, [
      '<D:resourcetype><D:principal/></D:resourcetype>',
      '<D:current-user-principal><D:href>/caldav/principal/</D:href></D:current-user-principal>',
      '<D:principal-URL><D:href>/caldav/principal/</D:href></D:principal-URL>',
      buildPrincipalCollectionSet(),
      '<C:calendar-home-set><D:href>/caldav/calendars/</D:href></C:calendar-home-set>',
      buildCalendarUserAddressSet(username),
      '<D:owner><D:href>/caldav/principal/</D:href></D:owner>',
      buildPrincipalReportSet(),
      `<D:displayname>${username || 'Lexera'}</D:displayname>`,
    ]),
  ]));
}

export interface ServerInfo {
  port: number;
  address: string;
}

export class SyncServer {
  private app: express.Application | null = null;
  private httpServer: http.Server | null = null;
  private configManager: ConfigManager;
  private boardWatcher: BoardFileWatcher;
  private serverInfo: ServerInfo | null = null;

  constructor(configManager: ConfigManager) {
    this.configManager = configManager;
    this.boardWatcher = new BoardFileWatcher();
  }

  /**
   * Start the WebDAV server.
   * Returns the actual port (useful when port=0 for auto-select).
   */
  async start(): Promise<ServerInfo> {
    const config = this.configManager.getConfig();

    // Set up board watchers for all configured boards
    this.setupBoardWatchers(config);

    // Create Express app
    this.app = express();

    // Request logging + client tracking middleware
    // Process name is resolved at connection open time (see httpServer 'connection' handler below)
    this.app.use((req, _res, next) => {
      const sock = req.socket as TrackedSocket;
      const namePromise = sock._processNamePromise || Promise.resolve('unknown');
      namePromise.then((proc) => {
        log.http(req.method, req.url, `from ${proc} (${req.socket.remoteAddress})`);
        if (req.url !== '/status') {
          recordAccess(proc, req.method, req.url);
        }
      });
      next();
    });

    // Basic Auth middleware — only active when auth credentials are configured
    if (config.auth) {
      const { username, password } = config.auth;
      log.verbose('Basic Auth enabled for all endpoints');
      this.app.use((req, res, next) => {
        if (isUnauthenticatedCaldavDiscoveryRequest(req)) {
          log.verbose(`Auth bypass for CalDAV discovery: ${req.method} ${req.url}`);
          next();
          return;
        }
        if (isUnauthenticatedLoopbackCalendarReadRequest(req)) {
          log.verbose(`Auth bypass for loopback CalDAV read: ${req.method} ${req.url}`);
          next();
          return;
        }
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Basic ')) {
          log.verbose(`Auth rejected: ${req.method} ${req.url} — missing Basic Auth header`);
          res.setHeader('WWW-Authenticate', 'Basic realm="ludos-sync"');
          res.status(401).send('Authentication required');
          return;
        }
        const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf8');
        const colonIndex = decoded.indexOf(':');
        if (colonIndex === -1) {
          log.verbose(`Auth rejected: ${req.method} ${req.url} — malformed header`);
          res.setHeader('WWW-Authenticate', 'Basic realm="ludos-sync"');
          res.status(401).send('Authentication required');
          return;
        }
        const reqUser = decoded.slice(0, colonIndex);
        const reqPass = decoded.slice(colonIndex + 1);
        if (reqUser !== username || reqPass !== password) {
          log.warn(`Auth rejected: ${req.method} ${req.url} — invalid credentials for "${reqUser}"`);
          res.setHeader('WWW-Authenticate', 'Basic realm="ludos-sync"');
          res.status(401).send('Invalid credentials');
          return;
        }
        next();
      });
    }

    // Mount Nephele WebDAV server at /bookmarks/
    if (config.bookmarks.enabled) {
      log.verbose('Bookmarks sync enabled, mounting WebDAV at /bookmarks/');
      const bookmarkAdapter = new BookmarkAdapter(this.boardWatcher);
      const localhostAuth = new LocalhostAuth(config.auth);

      this.app.use(
        '/bookmarks',
        createServer({
          adapter: bookmarkAdapter,
          authenticator: localhostAuth,
        })
      );
    } else {
      log.verbose('Bookmarks sync is disabled in config');
    }

    // Mount CalDAV server at /caldav/ for calendar sync
    // Always mount so it becomes available when calendar is enabled dynamically via config change
    log.verbose('Mounting CalDAV at /caldav/ (boards served dynamically based on config)');

    // .well-known/caldav discovery redirect
    this.app.all('/.well-known/caldav', (_req, res) => {
      res.redirect(301, '/caldav/principal/');
    });

    // Apple Calendar also probes several root-level CalDAV discovery aliases before sending credentials.
    // Serve those explicitly so verification can complete against the managed Lexera backend module.
    this.app.all('/', (req, res, next) => {
      if (req.method !== 'PROPFIND') {
        next();
        return;
      }
      sendDiscoveryRoot(res);
    });
    this.app.all(['/principals', '/principals/'], (req, res, next) => {
      if (req.method !== 'PROPFIND') {
        next();
        return;
      }
      sendDiscoveryPrincipals(req, res);
    });
    this.app.all(['/principals/*', '/calendar/dav', '/calendar/dav/', '/calendar/dav/*'], (req, res, next) => {
      if (req.method !== 'PROPFIND') {
        next();
        return;
      }
      sendDiscoveryPrincipalAlias(req, res);
    });

    // Parse XML bodies for CalDAV. Accept both classic XML content types and +xml variants.
    this.app.use('/caldav', express.text({
      type: (req) => {
        const contentType = String(req.headers['content-type'] || '').toLowerCase();
        return contentType.includes('xml');
      },
      limit: '1mb',
    }));

    // Mount CalDAV router
    const caldavRouter = createCaldavRouter(this.boardWatcher, '/caldav');
    this.app.use('/caldav', caldavRouter);

    // Mount REST API for Ludos Dashboard
    const apiRouter = createApiRouter(this.boardWatcher);
    this.app.use('/api', apiRouter);

    // Health check endpoint
    this.app.get('/status', (_req, res) => {
      const boards = this.boardWatcher.getAllBoardStates();
      res.json({
        status: 'running',
        port: this.serverInfo?.port,
        boards: boards.map(b => ({
          file: b.filePath,
          xbelName: b.xbelName,
          etag: b.etag,
          lastModified: b.lastModified.toISOString(),
        })),
        recentClients: getRecentClients(),
      });
    });

    // Start HTTP server on localhost (both IPv4 and IPv6)
    // Binding to '::' enables dual-stack: accepts both ::1 and 127.0.0.1.
    // LocalhostAuth rejects any non-localhost connections.
    return new Promise((resolve, reject) => {
      const port = config.port || 0;
      this.httpServer = this.app!.listen(port, '::', () => {
        const addr = this.httpServer!.address();
        if (typeof addr === 'object' && addr) {
          this.serverInfo = {
            port: addr.port,
            address: addr.address,
          };

          // Summary of loaded boards
          const allBoards = this.boardWatcher.getAllBoardStates();
          const calBoards = this.boardWatcher.getCalendarBoards();
          const totalTasks = calBoards.reduce((sum, b) => sum + (b.icalTasks?.length || 0), 0);
          const calSlugs = new Set(calBoards.map(b => b.calendarSlug));

          log.info(`Server started on http://localhost:${addr.port} — ${allBoards.length} board(s), ${calSlugs.size} calendar(s), ${totalTasks} tasks`);
          log.verbose(`Bookmarks endpoint: http://localhost:${addr.port}/bookmarks/`);
          log.verbose(`CalDAV endpoint: http://localhost:${addr.port}/caldav/`);
          log.verbose(`CalDAV discovery: http://localhost:${addr.port}/.well-known/caldav`);
          resolve(this.serverInfo);
        } else {
          reject(new Error('Failed to get server address'));
        }
      });

      // Resolve process name eagerly when TCP connection opens (socket is still alive)
      this.httpServer.on('connection', (socket: TrackedSocket) => {
        const remote = `${socket.remoteAddress}:${socket.remotePort}`;
        log.verbose(`[Connection] opened from ${remote}`);
        // Start lsof resolution immediately while the port is still open
        socket._processNamePromise = resolveProcessName(socket.remoteAddress, socket.remotePort);
        socket.on('close', () => {
          log.verbose(`[Connection] closed from ${remote}`);
        });
      });

      this.httpServer.on('error', reject);
    });
  }

  /**
   * Stop the server and all file watchers.
   */
  async stop(): Promise<void> {
    this.boardWatcher.stopAll();
    this.configManager.stopWatching();
    stopTracking();

    if (this.httpServer) {
      return new Promise((resolve) => {
        this.httpServer!.close(() => {
          log.info('Server stopped.');
          this.httpServer = null;
          this.app = null;
          this.serverInfo = null;
          resolve();
        });
      });
    }
  }

  getServerInfo(): ServerInfo | null {
    return this.serverInfo;
  }

  getBoardWatcher(): BoardFileWatcher {
    return this.boardWatcher;
  }

  private setupBoardWatchers(config: SyncConfig): void {
    const workspaces = config.workspaces || {};
    const workspaceKeys = Object.keys(workspaces);
    log.verbose(`${workspaceKeys.length} workspace(s) configured`);

    for (const wsKey of workspaceKeys) {
      const ws = workspaces[wsKey];
      for (const board of ws.boards || []) {
        const filePath = path.resolve(board.file);
        const opts = resolveBoardOptions(board, ws);
        const wantBookmarks = config.bookmarks?.enabled && opts.bookmarkSync;
        const wantCalendar = config.calendar?.enabled && opts.calendarSync;

        if (wantBookmarks) {
          const xbelName = board.xbelName || path.basename(filePath, '.md') + '.xbel';
          this.boardWatcher.addBoard(filePath, board.xbelName);
          log.verbose(`Watching board (bookmarks): ${filePath} -> ${xbelName}`);
        }

        if (wantCalendar) {
          const slug = opts.calendarSlug || path.basename(filePath, '.md');
          const name = opts.calendarName || board.name || path.basename(filePath, '.md');
          this.boardWatcher.addBoard(filePath, undefined, { calendarSlug: slug, calendarName: name });
          log.verbose(`Watching board (calendar): ${filePath} -> slug=${slug}`);
        }
      }
    }

    // Watch config file for changes
    this.configManager.watch((newConfig) => {
      log.verbose('Config changed, updating board watchers...');
      this.boardWatcher.stopAll();
      this.setupBoardWatchers(newConfig);
    });
  }
}
