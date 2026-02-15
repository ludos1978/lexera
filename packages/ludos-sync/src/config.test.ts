import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ConfigManager } from './config';

describe('ConfigManager', () => {
  let tmpDir: string;
  let configPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ludos-sync-test-'));
    configPath = path.join(tmpDir, '.kanban', 'sync.json');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should return defaults when no config file exists', () => {
    const mgr = new ConfigManager(configPath);
    const config = mgr.getConfig();

    expect(config.port).toBe(0);
    expect(config.bookmarks.enabled).toBe(true);
    expect(config.bookmarks.boards).toEqual([]);
    expect(config.calendar.enabled).toBe(false);
  });

  it('should create config file on ensureConfigExists', () => {
    const mgr = new ConfigManager(configPath);
    mgr.ensureConfigExists();

    expect(fs.existsSync(configPath)).toBe(true);
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    expect(raw.port).toBe(0);
  });

  it('should read existing config', () => {
    const dir = path.dirname(configPath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({
      port: 8080,
      bookmarks: {
        enabled: true,
        boards: [{ file: '../my-board.md', columnMapping: 'per-folder' }]
      }
    }), 'utf8');

    const mgr = new ConfigManager(configPath);
    const config = mgr.getConfig();

    expect(config.port).toBe(8080);
    expect(config.bookmarks.boards).toHaveLength(1);
    expect(config.bookmarks.boards[0].file).toBe('../my-board.md');
  });

  it('should resolve board file paths relative to config', () => {
    const dir = path.dirname(configPath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({
      port: 0,
      bookmarks: {
        enabled: true,
        boards: [{ file: '../my-board.md', columnMapping: 'per-folder' }]
      }
    }), 'utf8');

    const mgr = new ConfigManager(configPath);
    const boardFiles = mgr.getBookmarkBoardFiles();

    expect(boardFiles).toHaveLength(1);
    expect(boardFiles[0]).toBe(path.resolve(dir, '../my-board.md'));
  });

  it('should return empty array when bookmarks disabled', () => {
    const dir = path.dirname(configPath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({
      port: 0,
      bookmarks: {
        enabled: false,
        boards: [{ file: '../my-board.md', columnMapping: 'per-folder' }]
      }
    }), 'utf8');

    const mgr = new ConfigManager(configPath);
    expect(mgr.getBookmarkBoardFiles()).toEqual([]);
  });
});
