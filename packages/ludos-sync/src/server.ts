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
import { ConfigManager, SyncConfig } from './config';
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

    // Mount Nephele WebDAV server at /bookmarks/
    if (config.bookmarks.enabled) {
      log.verbose('Bookmarks sync enabled, mounting WebDAV at /bookmarks/');
      const bookmarkAdapter = new BookmarkAdapter(this.boardWatcher);
      const localhostAuth = new LocalhostAuth();

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
          log.info(`Server started on http://localhost:${addr.port}`);
          log.info(`Bookmarks endpoint: http://localhost:${addr.port}/bookmarks/`);
          resolve(this.serverInfo);
        } else {
          reject(new Error('Failed to get server address'));
        }
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
    const configDir = path.dirname(this.configManager.getConfigPath());
    const boards = config.bookmarks.enabled ? config.bookmarks.boards : [];
    log.verbose(`Config dir: ${configDir}, ${boards.length} board(s) configured`);
    for (const boardConfig of boards) {
      const filePath = path.resolve(configDir, boardConfig.file);
      const xbelName = boardConfig.xbelName || path.basename(filePath, '.md') + '.xbel';
      this.boardWatcher.addBoard(filePath, boardConfig.xbelName);
      log.info(`Watching board: ${filePath} -> ${xbelName}`);
    }

    // Watch config file for changes
    this.configManager.watch((newConfig) => {
      log.info('Config changed, updating board watchers...');
      this.boardWatcher.stopAll();
      this.setupBoardWatchers(newConfig);
    });
  }
}
