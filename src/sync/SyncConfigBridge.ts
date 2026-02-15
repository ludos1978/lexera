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

export interface WorkspaceBoardConfig {
  file: string;
  name?: string;
  bookmarkSync?: boolean;
  calendarSync?: boolean;
  xbelName?: string;
  calendarSlug?: string;
  calendarName?: string;
}

export interface WorkspaceConfig {
  boards: WorkspaceBoardConfig[];
}

export interface SyncConfig {
  port: number;
  auth?: {
    username: string;
    password: string;
  };
  bookmarks: {
    enabled: boolean;
  };
  calendar: {
    enabled: boolean;
  };
  workspaces: Record<string, WorkspaceConfig>;
}

const DEFAULT_CONFIG: SyncConfig = {
  port: 0,
  bookmarks: {
    enabled: true,
  },
  calendar: {
    enabled: false,
  },
  workspaces: {},
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
   * Sync the boards for a specific workspace into the shared config.
   * Replaces only this workspace's entry, preserving other workspaces.
   * Each board can specify calendarSync and calendarName individually.
   * calendarEnabled controls the top-level calendar.enabled flag.
   */
  syncWorkspaceBoards(
    workspaceKey: string,
    boards: Array<{ file: string; name: string; calendarSync: boolean; calendarSlug?: string; calendarName?: string }>,
    calendarEnabled: boolean
  ): void {
    const config = this.readConfig();

    if (!config.workspaces) {
      config.workspaces = {};
    }

    config.calendar.enabled = calendarEnabled;

    config.workspaces[workspaceKey] = {
      boards: boards.map(b => ({
        file: b.file,
        name: b.name,
        bookmarkSync: true,
        calendarSync: b.calendarSync,
        calendarSlug: b.calendarSlug,
        calendarName: b.calendarName,
      })),
    };

    this.writeConfig(config);
    logger.debug(`[SyncConfigBridge] Synced ${boards.length} board(s) for workspace: ${workspaceKey}, calendar.enabled=${calendarEnabled}`);
  }

  /**
   * Generate a URL-safe slug from a name.
   */
  static slugify(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  /**
   * Get the port from config (0 means auto-select).
   */
  getPort(): number {
    return this.readConfig().port;
  }
}
