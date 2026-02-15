/**
 * Bridge between VS Code settings and .kanban/sync.json config file.
 *
 * Reads/writes the sync config that ludos-sync watches.
 * When the user adds a board to the dashboard, this can register it for sync.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { logger } from '../utils/logger';

export interface BoardSyncConfig {
  file: string;
  xbelName?: string;
  columnMapping: 'per-folder';
}

export interface SyncConfig {
  port: number;
  bookmarks: {
    enabled: boolean;
    boards: BoardSyncConfig[];
  };
  calendar: {
    enabled: boolean;
    boards: BoardSyncConfig[];
  };
}

const DEFAULT_CONFIG: SyncConfig = {
  port: 0,
  bookmarks: {
    enabled: true,
    boards: [],
  },
  calendar: {
    enabled: false,
    boards: [],
  },
};

export class SyncConfigBridge {
  private configPath: string;

  constructor(configPath?: string) {
    if (configPath) {
      this.configPath = configPath;
    } else {
      const configDir = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
      this.configPath = path.join(configDir, 'ludos-sync', 'sync.json');
    }
  }

  getConfigPath(): string {
    return this.configPath;
  }

  readConfig(): SyncConfig {
    try {
      if (fs.existsSync(this.configPath)) {
        const raw = fs.readFileSync(this.configPath, 'utf8');
        return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
      }
    } catch (err) {
      logger.error('[SyncConfigBridge] Failed to read config:', err);
    }
    return { ...DEFAULT_CONFIG };
  }

  writeConfig(config: SyncConfig): void {
    try {
      const dir = path.dirname(this.configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2), 'utf8');
    } catch (err) {
      logger.error('[SyncConfigBridge] Failed to write config:', err);
    }
  }

  /**
   * Add a board file to the bookmark sync config.
   */
  addBoardForSync(boardFilePath: string): void {
    const config = this.readConfig();
    const relativePath = path.relative(path.dirname(this.configPath), boardFilePath);

    const alreadyExists = config.bookmarks.boards.some(b => b.file === relativePath || b.file === boardFilePath);
    if (alreadyExists) return;

    config.bookmarks.boards.push({
      file: relativePath,
      columnMapping: 'per-folder',
    });

    this.writeConfig(config);
    logger.debug(`[SyncConfigBridge] Added board for sync: ${relativePath}`);
  }

  /**
   * Remove a board file from the bookmark sync config.
   */
  removeBoardFromSync(boardFilePath: string): void {
    const config = this.readConfig();
    const relativePath = path.relative(path.dirname(this.configPath), boardFilePath);

    config.bookmarks.boards = config.bookmarks.boards.filter(
      b => b.file !== relativePath && b.file !== boardFilePath
    );

    this.writeConfig(config);
    logger.debug(`[SyncConfigBridge] Removed board from sync: ${relativePath}`);
  }

  /**
   * Check if a board is configured for sync.
   */
  isBoardSynced(boardFilePath: string): boolean {
    const config = this.readConfig();
    const relativePath = path.relative(path.dirname(this.configPath), boardFilePath);
    return config.bookmarks.boards.some(
      b => b.file === relativePath || b.file === boardFilePath
    );
  }

  /**
   * Get the port from config (0 means auto-select).
   */
  getPort(): number {
    return this.readConfig().port;
  }
}
