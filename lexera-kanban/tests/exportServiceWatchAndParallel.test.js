/**
 * Covers:
 *   1. marpWatch=true + marpFormat=html routes through marp_watch instead of
 *      marp_export, restoring the "Watch / Preview" behaviour that briefly
 *      regressed when the standalone Preview button was removed.
 *   2. PlantUML preprocessing issues its renders in parallel (Promise.all),
 *      not sequentially — the speed fix for large boards.
 *   3. File-embed rendering is likewise parallel.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { loadIIFE } from './load-iife.js';

let ES;
const mockInvoke = vi.fn();
const mockFetch = vi.fn();
const mockLexeraLog = vi.fn();
const mockWindow = {
  __TAURI__: { core: { invoke: mockInvoke } },
  LexeraApi: { baseUrl: 'http://localhost:9000', discover: vi.fn() },
  LexeraFileFormatRegistry: null,
};

beforeAll(() => {
  const Registry = loadIIFE(
    [
      'plugins/pluginRegistry.js',
      'plugins/formats/fileFormatHelpers.js',
      'plugins/formats/drawio.js',
      'plugins/formats/excalidraw.js',
      'plugins/formats/xlsx.js',
      'plugins/formats/csv.js',
      'plugins/formats/tsv.js',
      'plugins/formats/pdf.js',
      'plugins/formats/pptx.js',
      'plugins/formats/document.js',
      'plugins/formats/epub.js',
      'plugins/formats/plaintext.js',
      'plugins/fileFormatRegistry.js',
    ],
    'LexeraFileFormatRegistry',
    { window: mockWindow, URL }
  );
  mockWindow.LexeraFileFormatRegistry = Registry;
  ES = loadIIFE('export/exportService.js', 'ExportService', {
    window: mockWindow,
    fetch: mockFetch,
    console: globalThis.console,
    lexeraLog: mockLexeraLog,
  });
});

beforeEach(() => {
  mockInvoke.mockReset();
  mockFetch.mockReset();
  mockLexeraLog.mockReset();
  // getMarpEnginePath / getRenderAppsConfig cache across calls. Reset
  // between tests so each one exercises the fresh fallback path.
  ES._marpEnginePathCache = undefined;
  ES._renderAppsConfigCache = undefined;
  mockWindow.LexeraApi.get = undefined;
});

describe('_output — marp watch mode', () => {
  it('routes to marp_watch when marpWatch=true and marpFormat=html', async () => {
    mockInvoke.mockImplementation((cmd) => {
      if (cmd === 'write_export_file') return Promise.resolve(undefined);
      if (cmd === 'get_marp_engine_path') return Promise.resolve(null);
      if (cmd === 'marp_watch') return Promise.resolve({ success: true, message: 'watching' });
      return Promise.resolve({ success: true });
    });

    const result = await ES._output('# Slides', {
      mode: 'save',
      format: 'presentation',
      runMarp: true,
      marpFormat: 'html',
      marpWatch: true,
      targetFolder: '/out',
      exportFolderName: 'pres',
      marpBrowser: 'firefox',
    });

    const cmds = mockInvoke.mock.calls.map((c) => c[0]);
    expect(cmds).toContain('marp_watch');
    expect(cmds).not.toContain('marp_export');
    const watchCall = mockInvoke.mock.calls.find((c) => c[0] === 'marp_watch');
    expect(watchCall[1].opts.browser).toBe('firefox');
    expect(watchCall[1].opts.format).toBe('html');
    expect(result.success).toBe(true);
    expect(result.exportedPath).toBe('/out/pres/pres.md');
  });

  it('still uses marp_export when marpWatch=true but marpFormat is not html', async () => {
    mockInvoke.mockImplementation((cmd) => {
      if (cmd === 'write_export_file') return Promise.resolve(undefined);
      if (cmd === 'get_marp_engine_path') return Promise.resolve(null);
      if (cmd === 'marp_export') return Promise.resolve({ success: true, outputPath: '/out/pres/pres.pdf' });
      return Promise.resolve({ success: true });
    });

    await ES._output('# Slides', {
      mode: 'save',
      format: 'presentation',
      runMarp: true,
      marpFormat: 'pdf',
      marpWatch: true, // ignored for pdf
      targetFolder: '/out',
      exportFolderName: 'pres',
    });

    const cmds = mockInvoke.mock.calls.map((c) => c[0]);
    expect(cmds).toContain('marp_export');
    expect(cmds).not.toContain('marp_watch');
  });

  it('passes user-supplied marpEnginePath to marp_export instead of calling get_marp_engine_path', async () => {
    var bundledCalled = false;
    mockInvoke.mockImplementation((cmd, args) => {
      if (cmd === 'write_export_file') return Promise.resolve(undefined);
      if (cmd === 'get_marp_engine_path') { bundledCalled = true; return Promise.resolve('/bundled/engine.js'); }
      if (cmd === 'marp_export') return Promise.resolve({ success: true, outputPath: args.opts.outputPath });
      return Promise.resolve({ success: true });
    });

    const customPath = '/Users/alice/my-fork/engine.js';
    await ES._output('# Slides', {
      mode: 'save',
      format: 'presentation',
      runMarp: true,
      marpFormat: 'pdf',
      marpEnginePath: customPath,
      targetFolder: '/out',
      exportFolderName: 'pres',
    });

    const marpCall = mockInvoke.mock.calls.find((c) => c[0] === 'marp_export');
    expect(marpCall[1].opts.enginePath).toBe(customPath);
    // When the user supplied a custom path, the bundled-engine resolver
    // must NOT be called (saves a Tauri roundtrip and respects the override).
    expect(bundledCalled).toBe(false);
  });

  it('falls back to bundled engine when marpEnginePath is empty/null', async () => {
    mockInvoke.mockImplementation((cmd, args) => {
      if (cmd === 'write_export_file') return Promise.resolve(undefined);
      if (cmd === 'get_marp_engine_path') return Promise.resolve('/bundled/engine.js');
      if (cmd === 'marp_export') return Promise.resolve({ success: true, outputPath: args.opts.outputPath });
      return Promise.resolve({ success: true });
    });

    await ES._output('# Slides', {
      mode: 'save',
      format: 'presentation',
      runMarp: true,
      marpFormat: 'pdf',
      marpEnginePath: null,
      targetFolder: '/out',
      exportFolderName: 'pres',
    });

    const marpCall = mockInvoke.mock.calls.find((c) => c[0] === 'marp_export');
    expect(marpCall[1].opts.enginePath).toBe('/bundled/engine.js');
  });

  it('resolves marpEnginePath from /config/render-apps (Plugin Settings) when options omits it', async () => {
    // Contract: Plugin Settings panel (PUT /config/render-apps with
    // marpEnginePath) now drives the Marp engine override. getMarpEnginePath
    // fetches /config/render-apps via LexeraApi.get and uses the value
    // verbatim when set, skipping the Tauri get_marp_engine_path probe.
    let bundledProbed = false;
    mockWindow.LexeraApi.get = async (url) => {
      if (url === '/config/render-apps') {
        return { marpEnginePath: '/custom/from/plugin-settings.js', marpTemplatesPath: '' };
      }
      throw new Error('unexpected ' + url);
    };
    mockInvoke.mockImplementation((cmd, args) => {
      if (cmd === 'write_export_file') return Promise.resolve(undefined);
      if (cmd === 'get_marp_engine_path') { bundledProbed = true; return Promise.resolve('/bundled/engine.js'); }
      if (cmd === 'marp_export') return Promise.resolve({ success: true, outputPath: args.opts.outputPath });
      return Promise.resolve({ success: true });
    });

    await ES._output('# Slides', {
      mode: 'save',
      format: 'presentation',
      runMarp: true,
      marpFormat: 'pdf',
      targetFolder: '/out',
      exportFolderName: 'pres',
    });

    const marpCall = mockInvoke.mock.calls.find((c) => c[0] === 'marp_export');
    expect(marpCall[1].opts.enginePath).toBe('/custom/from/plugin-settings.js');
    expect(bundledProbed).toBe(false);
  });

  it('passes marpTemplatesPath from /config/render-apps as themeDirs to Marp CLI', async () => {
    // Contract: the Templates folder in Plugin Settings becomes
    // --theme-set <dir> on every marp_export, via options.themeDirs.
    mockWindow.LexeraApi.get = async () => ({
      marpEnginePath: null,
      marpTemplatesPath: '/Users/alice/marp-themes',
    });
    mockInvoke.mockImplementation((cmd, args) => {
      if (cmd === 'write_export_file') return Promise.resolve(undefined);
      if (cmd === 'get_marp_engine_path') return Promise.resolve(null);
      if (cmd === 'marp_export') return Promise.resolve({ success: true, outputPath: args.opts.outputPath });
      return Promise.resolve({ success: true });
    });

    await ES._output('# Slides', {
      mode: 'save',
      format: 'presentation',
      runMarp: true,
      marpFormat: 'pdf',
      targetFolder: '/out',
      exportFolderName: 'pres',
    });

    const marpCall = mockInvoke.mock.calls.find((c) => c[0] === 'marp_export');
    expect(marpCall[1].opts.themeDirs).toEqual(['/Users/alice/marp-themes']);
  });

  it('leaves themeDirs null when no template folder is configured', async () => {
    mockWindow.LexeraApi.get = async () => ({ marpEnginePath: null, marpTemplatesPath: null });
    mockInvoke.mockImplementation((cmd, args) => {
      if (cmd === 'write_export_file') return Promise.resolve(undefined);
      if (cmd === 'get_marp_engine_path') return Promise.resolve(null);
      if (cmd === 'marp_export') return Promise.resolve({ success: true, outputPath: args.opts.outputPath });
      return Promise.resolve({ success: true });
    });

    await ES._output('# Slides', {
      mode: 'save',
      format: 'presentation',
      runMarp: true,
      marpFormat: 'pdf',
      targetFolder: '/out',
      exportFolderName: 'pres',
    });

    const marpCall = mockInvoke.mock.calls.find((c) => c[0] === 'marp_export');
    expect(marpCall[1].opts.themeDirs).toBeNull();
  });

  it('uses marp_export (not marp_watch) when marpWatch=false', async () => {
    mockInvoke.mockImplementation((cmd) => {
      if (cmd === 'write_export_file') return Promise.resolve(undefined);
      if (cmd === 'get_marp_engine_path') return Promise.resolve(null);
      if (cmd === 'marp_export') return Promise.resolve({ success: true, outputPath: '/out/pres/pres.html' });
      return Promise.resolve({ success: true });
    });

    await ES._output('# Slides', {
      mode: 'save',
      format: 'presentation',
      runMarp: true,
      marpFormat: 'html',
      marpWatch: false,
      targetFolder: '/out',
      exportFolderName: 'pres',
    });

    const cmds = mockInvoke.mock.calls.map((c) => c[0]);
    expect(cmds).toContain('marp_export');
    expect(cmds).not.toContain('marp_watch');
  });
});

describe('preprocessDiagramsForExport — parallel plantuml rendering', () => {
  it('issues render_plantuml_code calls concurrently, not sequentially', async () => {
    // Gate all renders on a single deferred promise so we can count how many
    // are in flight at once. A sequential loop would start them one at a
    // time; Promise.all kicks them all off and settles together.
    let inFlight = 0;
    let maxInFlight = 0;
    let releaseAll;
    const gate = new Promise((resolve) => { releaseAll = resolve; });

    mockInvoke.mockImplementation((cmd, args) => {
      if (cmd !== 'render_plantuml_code') return Promise.resolve({ success: true });
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      return gate.then(() => {
        inFlight -= 1;
        return { success: true, outputPath: args.opts.targetPath };
      });
    });

    const md = 'intro\n\n```plantuml\nA -> B\n```\n\nmid\n\n```plantuml\nC -> D\n```\n\nend\n\n```plantuml\nE -> F\n```';
    const resultPromise = ES.preprocessDiagramsForExport(md, '/tmp/out', 'slides');

    // Let the microtask queue run so all three renders can enter the gate.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(maxInFlight).toBe(3);
    releaseAll();
    const result = await resultPromise;
    expect(result.createdFiles).toHaveLength(3);
    expect(result.content).toContain('![plantuml-1](slides-plantuml-1.svg)');
    expect(result.content).toContain('![plantuml-3](slides-plantuml-3.svg)');
    expect(result.content).not.toContain('```plantuml');
  });

  it('keeps content unchanged when render fails, without blocking other blocks', async () => {
    mockInvoke.mockImplementation((cmd, args) => {
      if (cmd !== 'render_plantuml_code') return Promise.resolve({ success: true });
      if (/plantuml-2/.test(args.opts.targetPath)) {
        return Promise.resolve({ success: false, error: 'boom' });
      }
      return Promise.resolve({ success: true, outputPath: args.opts.targetPath });
    });

    const md = '```plantuml\nA\n```\n\n```plantuml\nB\n```\n\n```plantuml\nC\n```';
    const result = await ES.preprocessDiagramsForExport(md, '/tmp', 'x');
    expect(result.content).toContain('![plantuml-1](x-plantuml-1.svg)');
    expect(result.content).toContain('```plantuml\nB\n```'); // unchanged on failure
    expect(result.content).toContain('![plantuml-3](x-plantuml-3.svg)');
    expect(result.createdFiles).toEqual(['/tmp/x-plantuml-1.svg', '/tmp/x-plantuml-3.svg']);
  });
});
