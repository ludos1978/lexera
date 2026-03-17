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
    expect(config.calendar.enabled).toBe(false);
    expect(config.workspaces).toEqual({});
  });

  it('should create config file on ensureConfigExists', () => {
    const mgr = new ConfigManager(configPath);
    mgr.ensureConfigExists();

    expect(fs.existsSync(configPath)).toBe(true);
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    expect(raw.port).toBe(0);
  });

  it('should read existing config with workspaces', () => {
    const dir = path.dirname(configPath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({
      port: 8080,
      bookmarks: { enabled: true },
      workspaces: {
        '/project-a': {
          boards: [{ file: '/project-a/kanban.md', name: 'My Board' }]
        }
      }
    }), 'utf8');

    const mgr = new ConfigManager(configPath);
    const config = mgr.getConfig();

    expect(config.port).toBe(8080);
    expect(Object.keys(config.workspaces)).toHaveLength(1);
    expect(config.workspaces['/project-a'].boards[0].file).toBe('/project-a/kanban.md');
  });

  it('should list all board files across workspaces', () => {
    const dir = path.dirname(configPath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({
      port: 0,
      bookmarks: { enabled: true },
      workspaces: {
        '/project-a': {
          boards: [{ file: '/project-a/kanban.md' }]
        },
        '/project-b': {
          boards: [{ file: '/project-b/tasks.md' }]
        }
      }
    }), 'utf8');

    const mgr = new ConfigManager(configPath);
    const boardFiles = mgr.getAllBoardFiles();

    expect(boardFiles).toHaveLength(2);
    expect(boardFiles).toContain(path.resolve('/project-a/kanban.md'));
    expect(boardFiles).toContain(path.resolve('/project-b/tasks.md'));
  });

  it('should return empty array when no workspaces configured', () => {
    const dir = path.dirname(configPath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({
      port: 0,
      bookmarks: { enabled: false },
      workspaces: {}
    }), 'utf8');

    const mgr = new ConfigManager(configPath);
    expect(mgr.getAllBoardFiles()).toEqual([]);
  });
});
