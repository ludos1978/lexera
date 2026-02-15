/**
 * Configuration management for ludos-sync.
 *
 * Default config location: ~/.config/ludos-sync/sync.json
 * Override with --config <path>.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { log } from './logger';

/**
 * Returns the default config file path: ~/.config/ludos-sync/sync.json
 */
export function getDefaultConfigPath(): string {
  const configDir = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(configDir, 'ludos-sync', 'sync.json');
}

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

export class ConfigManager {
  private configPath: string;
  private config: SyncConfig;
  private watcher: fs.FSWatcher | null = null;
  private onChange: ((config: SyncConfig) => void) | null = null;

  constructor(configPath: string) {
    this.configPath = path.resolve(configPath);
    this.config = this.load();
  }

  private load(): SyncConfig {
    try {
      if (fs.existsSync(this.configPath)) {
        const raw = fs.readFileSync(this.configPath, 'utf8');
        const parsed = JSON.parse(raw);
        const config = { ...DEFAULT_CONFIG, ...parsed };
        const workspaceKeys = Object.keys(config.workspaces || {});
        const totalBoards = workspaceKeys.reduce((sum, key) => sum + (config.workspaces[key]?.boards?.length || 0), 0);
        log.verbose(`Config loaded: port=${config.port}, bookmarks.enabled=${config.bookmarks?.enabled}, calendar.enabled=${config.calendar?.enabled}, ${workspaceKeys.length} workspace(s), ${totalBoards} board(s)`);
        for (const wsKey of workspaceKeys) {
          const ws = config.workspaces[wsKey];
          log.verbose(`  Workspace: ${wsKey} (${ws.boards?.length || 0} boards)`);
          for (const board of ws.boards || []) {
            log.verbose(`    Board: file="${board.file}" name="${board.name || '(none)'}" bookmarkSync=${board.bookmarkSync ?? true} calendarSync=${board.calendarSync ?? true}`);
          }
        }
        return config;
      }
    } catch (err) {
      log.error(`Failed to read config ${this.configPath}:`, err);
    }
    log.verbose('No config file found, using defaults');
    return { ...DEFAULT_CONFIG };
  }

  getConfig(): SyncConfig {
    return this.config;
  }

  getConfigPath(): string {
    return this.configPath;
  }

  /**
   * Write current config to disk, creating parent directories if needed.
   */
  save(): void {
    const dir = path.dirname(this.configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), 'utf8');
    log.verbose(`Config saved to ${this.configPath}`);
  }

  /**
   * Create a default config file if none exists.
   */
  ensureConfigExists(): void {
    if (!fs.existsSync(this.configPath)) {
      log.info(`Creating default config: ${this.configPath}`);
      this.save();
    }
  }

  /**
   * Watch the config file for external changes (e.g. from VS Code extension).
   */
  watch(callback: (config: SyncConfig) => void): void {
    this.onChange = callback;

    // Watch the directory since the file might be recreated
    const dir = path.dirname(this.configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    try {
      this.watcher = fs.watch(this.configPath, { persistent: false }, () => {
        log.verbose('Config file changed on disk, reloading...');
        const newConfig = this.load();
        this.config = newConfig;
        if (this.onChange) {
          this.onChange(newConfig);
        }
      });
      log.verbose(`Watching config file: ${this.configPath}`);
    } catch {
      log.verbose(`Config file not found for watching: ${this.configPath}`);
    }
  }

  stopWatching(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }

  /**
   * Get all configured board file paths across all workspaces.
   */
  getAllBoardFiles(): string[] {
    const files: string[] = [];
    for (const ws of Object.values(this.config.workspaces || {})) {
      for (const board of ws.boards || []) {
        files.push(path.resolve(board.file));
      }
    }
    return files;
  }
}
