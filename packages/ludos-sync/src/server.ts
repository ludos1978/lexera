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
import { log } from './logger';

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

    // Request logging middleware
    this.app.use((req, _res, next) => {
      log.http(req.method, req.url, `from ${req.socket.remoteAddress}`);
      next();
    });

    // Basic Auth middleware — only active when auth credentials are configured
    if (config.auth) {
      const { username, password } = config.auth;
      log.info('Basic Auth enabled for all endpoints');
      this.app.use((req, res, next) => {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Basic ')) {
          res.setHeader('WWW-Authenticate', 'Basic realm="ludos-sync"');
          res.status(401).send('Authentication required');
          return;
        }
        const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf8');
        const colonIndex = decoded.indexOf(':');
        if (colonIndex === -1) {
          res.setHeader('WWW-Authenticate', 'Basic realm="ludos-sync"');
          res.status(401).send('Authentication required');
          return;
        }
        const reqUser = decoded.slice(0, colonIndex);
        const reqPass = decoded.slice(colonIndex + 1);
        if (reqUser !== username || reqPass !== password) {
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
      log.info('Bookmarks sync is disabled in config');
    }

    // Mount CalDAV server at /caldav/ for calendar sync
    // Always mount so it becomes available when calendar is enabled dynamically via config change
    log.verbose('Mounting CalDAV at /caldav/ (boards served dynamically based on config)');

    // .well-known/caldav discovery redirect
    this.app.all('/.well-known/caldav', (_req, res) => {
      res.redirect(301, '/caldav/principal/');
    });

    // Parse XML bodies for CalDAV
    this.app.use('/caldav', express.text({ type: ['application/xml', 'text/xml'], limit: '1mb' }));

    // Mount CalDAV router
    const caldavRouter = createCaldavRouter(this.boardWatcher, '/caldav');
    this.app.use('/caldav', caldavRouter);

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

          log.info(`Server started on http://localhost:${addr.port}`);
          log.info(`Loaded ${allBoards.length} board(s): ${calBoards.length} with calendar sync (${totalTasks} tasks across ${calSlugs.size} calendar(s))`);
          log.info(`Bookmarks endpoint: http://localhost:${addr.port}/bookmarks/`);
          log.info(`CalDAV endpoint: http://localhost:${addr.port}/caldav/`);
          log.info(`CalDAV discovery: http://localhost:${addr.port}/.well-known/caldav`);
          resolve(this.serverInfo);
        } else {
          reject(new Error('Failed to get server address'));
        }
      });

      // Track TCP connections
      this.httpServer.on('connection', (socket) => {
        const remote = `${socket.remoteAddress}:${socket.remotePort}`;
        log.info(`[Connection] opened from ${remote}`);
        socket.on('close', () => {
          log.info(`[Connection] closed from ${remote}`);
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
          log.info(`Watching board (bookmarks): ${filePath} -> ${xbelName}`);
        }

        if (wantCalendar) {
          const slug = opts.calendarSlug || path.basename(filePath, '.md');
          const name = opts.calendarName;
          this.boardWatcher.addBoard(filePath, undefined, { calendarSlug: slug, calendarName: name });
          log.info(`Watching board (calendar): ${filePath} -> slug=${slug}`);
        }
      }
    }

    // Watch config file for changes
    this.configManager.watch((newConfig) => {
      log.info('Config changed, updating board watchers...');
      this.boardWatcher.stopAll();
      this.setupBoardWatchers(newConfig);
    });
  }
}
