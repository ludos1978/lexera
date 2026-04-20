import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, '..', 'src');

function runSource(sandbox, file) {
  vm.runInContext(readFileSync(resolve(srcDir, file), 'utf8'), sandbox, { filename: file });
  [
    'LexeraPathUtils',
    'LexeraPluginRegistry',
    'LexeraFileFormatHelpers',
    'LexeraFileFormatRegistry',
    'LexeraEmbedMenu',
  ].forEach((key) => {
    if (sandbox[key] !== undefined) sandbox.window[key] = sandbox[key];
  });
}

function createTextElement() {
  return {
    value: '',
    _html: '',
    set innerHTML(value) {
      this._html = String(value || '');
      this.value = this._html;
    },
    get innerHTML() {
      return this._html;
    },
  };
}

function loadEmbedMenu() {
  const tauriInternals = { invoke: vi.fn() };
  const sandbox = {
    window: {},
    globalThis: null,
    document: {
      createElement: vi.fn(() => createTextElement()),
    },
    console,
    URL,
    Promise,
    setTimeout,
    clearTimeout,
    encodeURIComponent,
    parseInt,
    isFinite,
    btoa: (value) => Buffer.from(String(value), 'binary').toString('base64'),
  };
  sandbox.globalThis = sandbox.window;
  sandbox.window.globalThis = sandbox.window;
  sandbox.window.window = sandbox.window;
  sandbox.window.parent = sandbox.window;
  sandbox.window.document = sandbox.document;
  sandbox.window.__TAURI_INTERNALS__ = tauriInternals;

  vm.createContext(sandbox);
  [
    'utils/pathUtils.js',
    'plugins/pluginRegistry.js',
    'plugins/formats/fileFormatHelpers.js',
    'plugins/formats/excalidraw.js',
    'plugins/fileFormatRegistry.js',
    'menu/embedMenu.js',
  ].forEach((file) => runSource(sandbox, file));

  return {
    EmbedMenu: sandbox.window.LexeraEmbedMenu,
    PathUtils: sandbox.window.LexeraPathUtils,
    sandbox,
    tauriInternals,
  };
}

function createDeps(PathUtils, LexeraApi, logs) {
  const escapeHtml = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));
  return {
    escapeHtml,
    escapeAttr: escapeHtml,
    getDisplayFileNameFromPath: PathUtils.getDisplayFileNameFromPath,
    getFileNameFromPath: PathUtils.getFileNameFromPath,
    getDirNameFromPath: PathUtils.getDirNameFromPath,
    normalizePathForCompare: PathUtils.normalizePathForCompare,
    parseLocalFileReference: (path) => ({ path: String(path || '').split('#')[0], pageNumber: '' }),
    logFrontendIssue: (...args) => logs.push(args),
    traceFrontendAction: vi.fn(),
    getBoardFilePathForId: () => '/workspace/board.md',
    getLexeraApi: () => LexeraApi,
  };
}

describe('LexeraEmbedMenu special preview rendering', () => {
  it('falls back to a locally resolved absolute path when convert-path fails', async () => {
    const { EmbedMenu, PathUtils, tauriInternals } = loadEmbedMenu();
    const logs = [];
    let renderTarget = '';
    let cacheProbeCount = 0;
    const LexeraApi = {
      request: vi.fn(async () => {
        const err = new Error('400: convert-path unavailable');
        err.status = 400;
        throw err;
      }),
      fileInfo: vi.fn(async (_boardId, path) => {
        if (path === 'board-Media/diagram.excalidraw') {
          return { exists: true, lastModifiedMs: 1700000000000 };
        }
        if (path.indexOf('/workspace/board-Media/excalidraw-cache/') === 0) {
          cacheProbeCount += 1;
          return { exists: cacheProbeCount > 1, lastModifiedMs: 1700000000001 };
        }
        return { exists: false };
      }),
      fileUrl: (_boardId, path) => 'lexera-file://' + path,
    };
    tauriInternals.invoke.mockImplementation(async (cmd, args) => {
      expect(cmd).toBe('render_embedded_file');
      renderTarget = args.opts.targetPath;
      expect(args.opts.sourcePath).toBe('/workspace/board-Media/diagram.excalidraw');
      return { success: true, outputPath: args.opts.targetPath };
    });

    EmbedMenu.init(createDeps(PathUtils, LexeraApi, logs));
    const container = createTextElement();
    const rendered = await EmbedMenu.renderCachedSpecialPreview(
      container,
      'board-1',
      'board-Media/diagram.excalidraw',
      'diagram'
    );

    expect(rendered).toBe(true);
    expect(renderTarget).toMatch(/^\/workspace\/board-Media\/excalidraw-cache\/diagram-[A-Za-z0-9]{8}-1700000000000\.svg$/);
    expect(renderTarget).not.toContain('board-Media-Media');
    expect(container.innerHTML).toContain('lexera-file:///workspace/board-Media/excalidraw-cache/');
    expect(logs.some((entry) => entry[1] === 'path.resolve' && String(entry[2]).includes('using /workspace/board-Media/diagram.excalidraw'))).toBe(true);
  });

  it('reuses legacy double-nested media cache files before rendering a new preview', async () => {
    const { EmbedMenu, PathUtils, tauriInternals } = loadEmbedMenu();
    const logs = [];
    const LexeraApi = {
      request: vi.fn(async () => ({ path: '/workspace/board-Media/diagram.excalidraw' })),
      fileInfo: vi.fn(async (_boardId, path) => {
        if (path === 'board-Media/diagram.excalidraw') {
          return { exists: true, lastModifiedMs: 1700000000000 };
        }
        if (path.indexOf('/workspace/board-Media/excalidraw-cache/') === 0) {
          return { exists: false };
        }
        if (path.indexOf('/workspace/board-Media/board-Media-Media/excalidraw-cache/') === 0) {
          return { exists: true, lastModifiedMs: 1700000000001 };
        }
        return { exists: false };
      }),
      fileUrl: (_boardId, path) => 'lexera-file://' + path,
    };

    EmbedMenu.init(createDeps(PathUtils, LexeraApi, logs));
    const container = createTextElement();
    const rendered = await EmbedMenu.renderCachedSpecialPreview(
      container,
      'board-1',
      'board-Media/diagram.excalidraw',
      'diagram'
    );

    expect(rendered).toBe(true);
    expect(tauriInternals.invoke).not.toHaveBeenCalled();
    expect(container.innerHTML).toContain('lexera-file:///workspace/board-Media/board-Media-Media/excalidraw-cache/');
  });

  it('uses file-info resolvedPath instead of requiring a convert-path request', async () => {
    const { EmbedMenu, PathUtils, tauriInternals } = loadEmbedMenu();
    const logs = [];
    let cacheProbeCount = 0;
    const LexeraApi = {
      request: vi.fn(async () => {
        throw new Error('convert-path should not be needed');
      }),
      fileInfo: vi.fn(async (_boardId, path) => {
        if (path === 'board-Media/diagram.excalidraw') {
          return {
            exists: true,
            lastModifiedMs: 1700000000000,
            resolvedPath: '/workspace/board-Media/diagram.excalidraw',
          };
        }
        if (path.indexOf('/workspace/board-Media/excalidraw-cache/') === 0) {
          cacheProbeCount += 1;
          return { exists: cacheProbeCount > 1, lastModifiedMs: 1700000000001 };
        }
        return { exists: false };
      }),
      fileUrl: (_boardId, path) => 'lexera-file://' + path,
    };
    tauriInternals.invoke.mockImplementation(async (cmd, args) => {
      expect(cmd).toBe('render_embedded_file');
      expect(args.opts.sourcePath).toBe('/workspace/board-Media/diagram.excalidraw');
      return { success: true, outputPath: args.opts.targetPath };
    });

    EmbedMenu.init(createDeps(PathUtils, LexeraApi, logs));
    const container = createTextElement();
    const rendered = await EmbedMenu.renderCachedSpecialPreview(
      container,
      'board-1',
      'board-Media/diagram.excalidraw',
      'diagram'
    );

    expect(rendered).toBe(true);
    expect(LexeraApi.request).not.toHaveBeenCalled();
    expect(container.innerHTML).toContain('lexera-file:///workspace/board-Media/excalidraw-cache/');
  });
});
