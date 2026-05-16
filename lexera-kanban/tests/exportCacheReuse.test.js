import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { loadIIFE } from './load-iife.js';

// Phase 1 contract tests: the export pipeline renders excalidraw / drawio
// embeds into the SAME preview cache location the kanban UI uses (so preview
// and export share a render), the cache filename embeds the source mtime so
// modifications invalidate it, and the markdown link is either a relative
// reference to the cache or a copy into the export's -Media/rendered/ folder
// depending on the user's `linkHandlingMode` selection.

let ES;
let Registry;

const mockInvoke = vi.fn();
const mockFetch = vi.fn();

const mockWindow = {
  __TAURI__: { core: { invoke: mockInvoke } },
  LexeraApi: { baseUrl: 'http://localhost:9000', discover: vi.fn() },
  ExportService: null,
};

const mockLexeraLog = vi.fn();

beforeAll(() => {
  Registry = loadIIFE(
    [
      'plugins/pluginRegistry.js',
      'plugins/exports/tauriInvoke.js',
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
});

// ── Cache-path helpers ───────────────────────────────────────────────────

describe('buildDiagramCacheDir / buildDiagramCacheFileName', () => {
  it('places the cache next to the board file when source and board share a directory', () => {
    const dir = ES.buildDiagramCacheDir(
      '/src/board.md',
      '/src/diagram.excalidraw',
      'excalidraw-cache'
    );
    expect(dir).toBe('/src/board-Media/excalidraw-cache');
  });

  it('falls back to a source-local cache directory when source lives elsewhere', () => {
    const dir = ES.buildDiagramCacheDir(
      '/src/board.md',
      '/assets/diagram.excalidraw',
      'excalidraw-cache'
    );
    expect(dir).toBe('/assets/assets-Media/excalidraw-cache');
  });

  it('reuses an existing media directory for source-local cache files', () => {
    const dir = ES.buildDiagramCacheDir(
      '/src/board.md',
      '/src/board-Media/diagram.excalidraw',
      'excalidraw-cache'
    );
    expect(dir).toBe('/src/board-Media/excalidraw-cache');
  });

  it('embeds mtime and extension in the cache filename', () => {
    const name = ES.buildDiagramCacheFileName('/src/d.drawio', 1_700_000_000_000, 'svg', '');
    expect(name).toMatch(/^d-[A-Za-z0-9]{8}-1700000000000\.svg$/);
  });

  it('produces different names when mtime changes (invalidation)', () => {
    const a = ES.buildDiagramCacheFileName('/src/d.drawio', 1000, 'svg', '');
    const b = ES.buildDiagramCacheFileName('/src/d.drawio', 2000, 'svg', '');
    expect(a).not.toBe(b);
  });

  it('produces different names for png vs svg variants of the same source', () => {
    const png = ES.buildDiagramCacheFileName('/src/d.drawio', 1000, 'png', '');
    const svg = ES.buildDiagramCacheFileName('/src/d.drawio', 1000, 'svg', '');
    expect(png).not.toBe(svg);
    expect(png.endsWith('.png')).toBe(true);
    expect(svg.endsWith('.svg')).toBe(true);
  });
});

// ── Render path rewrite: excalidraw → cache ──────────────────────────────

describe('renderFileEmbedsForExport — excalidraw reference mode', () => {
  it('renders excalidraw to preview cache and rewrites the markdown link to a relative cache path', async () => {
    const absoluteSource = '/src/workspace/assets/sketch.excalidraw';
    const mtimeMs = 1_700_000_000_000;
    const cacheDir = ES.buildDiagramCacheDir('/src/workspace/board.md', absoluteSource, 'excalidraw-cache');
    const cacheFile = ES.buildDiagramCacheFileName(absoluteSource, mtimeMs, 'svg', '');
    const cacheAbsolute = cacheDir + '/' + cacheFile;
    const expectedLink = ES.relativePath('/out/board', cacheAbsolute);

    mockInvoke.mockImplementation((cmd, args) => {
      if (cmd === 'get_file_mtime_ms') {
        expect(args.path).toBe(absoluteSource);
        return Promise.resolve(mtimeMs);
      }
      if (cmd === 'render_embedded_file') {
        expect(args.opts.pluginId).toBe('excalidraw');
        expect(args.opts.sourcePath).toBe(absoluteSource);
        expect(args.opts.targetPath).toBe(cacheAbsolute);
        expect(args.opts.outputFormat).toBe('svg');
        return Promise.resolve({ success: true, outputPath: args.opts.targetPath, format: 'svg', error: null });
      }
      if (cmd === 'write_export_file') return Promise.resolve(undefined);
      return Promise.resolve({ success: true });
    });

    await ES._output('![Sketch](assets/sketch.excalidraw)', {
      mode: 'save',
      format: 'presentation',
      targetFolder: '/out',
      exportFolderName: 'board',
      sourceFilePath: '/src/workspace/board.md',
      linkHandlingMode: 'rewrite-only',
    });

    const writeCall = mockInvoke.mock.calls.find((c) => c[0] === 'write_export_file');
    expect(writeCall[1].content).toBe('![Sketch](' + expectedLink + ')');
    // Cache copy is NOT invoked in reference mode.
    expect(mockInvoke.mock.calls.some((c) => c[0] === 'copy_export_assets')).toBe(false);
  });
});

// ── Render path rewrite: drawio → cache (PNG preview vs SVG export) ──────

describe('renderFileEmbedsForExport — drawio reference mode', () => {
  it('renders drawio to the drawio-cache folder with the export-format (svg) extension', async () => {
    const absoluteSource = '/src/workspace/assets/flow.drawio';
    const mtimeMs = 1_700_000_000_000;
    const cacheDir = ES.buildDiagramCacheDir('/src/workspace/board.md', absoluteSource, 'drawio-cache');
    const cacheFile = ES.buildDiagramCacheFileName(absoluteSource, mtimeMs, 'svg', '');
    const cacheAbsolute = cacheDir + '/' + cacheFile;
    const expectedLink = ES.relativePath('/out/board', cacheAbsolute);

    mockInvoke.mockImplementation((cmd, args) => {
      if (cmd === 'get_file_mtime_ms') return Promise.resolve(mtimeMs);
      if (cmd === 'render_embedded_file') {
        expect(args.opts.pluginId).toBe('drawio');
        expect(args.opts.targetPath).toBe(cacheAbsolute);
        // Export format is SVG even though preview uses PNG — the cache
        // folder is shared but the filename encodes the extension.
        expect(args.opts.outputFormat).toBe('svg');
        return Promise.resolve({ success: true, outputPath: args.opts.targetPath, format: 'svg', error: null });
      }
      if (cmd === 'write_export_file') return Promise.resolve(undefined);
      return Promise.resolve({ success: true });
    });

    await ES._output('![Flow](assets/flow.drawio)', {
      mode: 'save',
      format: 'presentation',
      targetFolder: '/out',
      exportFolderName: 'board',
      sourceFilePath: '/src/workspace/board.md',
      linkHandlingMode: 'rewrite-only',
    });

    const writeCall = mockInvoke.mock.calls.find((c) => c[0] === 'write_export_file');
    expect(writeCall[1].content).toBe('![Flow](' + expectedLink + ')');
  });
});

// ── Pack mode copies the rendered cache file into _Rendered/ ────────────

describe('renderFileEmbedsForExport — pack-linked copy mode', () => {
  it('copies the rendered cache into _Rendered/ and emits a relative link to the copy', async () => {
    const absoluteSource = '/src/workspace/assets/sketch.excalidraw';
    const mtimeMs = 1_700_000_000_000;
    const cacheDir = ES.buildDiagramCacheDir('/src/workspace/board.md', absoluteSource, 'excalidraw-cache');
    const cacheFile = ES.buildDiagramCacheFileName(absoluteSource, mtimeMs, 'svg', '');
    const cacheAbsolute = cacheDir + '/' + cacheFile;
    const expectedPackRelative = '_Rendered/' + cacheFile;
    const expectedPackAbsolute = '/out/board/' + expectedPackRelative;

    mockInvoke.mockImplementation((cmd, args) => {
      if (cmd === 'get_file_mtime_ms') return Promise.resolve(mtimeMs);
      if (cmd === 'render_embedded_file') return Promise.resolve({ success: true, outputPath: args.opts.targetPath, format: 'svg', error: null });
      if (cmd === 'copy_export_assets') {
        expect(args.items).toHaveLength(1);
        expect(args.items[0].sourcePath).toBe(cacheAbsolute);
        expect(args.items[0].targetPath).toBe(expectedPackAbsolute);
        return Promise.resolve([{ sourcePath: cacheAbsolute, targetPath: expectedPackAbsolute, success: true, error: null }]);
      }
      if (cmd === 'write_export_file') return Promise.resolve(undefined);
      return Promise.resolve({ success: true });
    });

    await ES._output('![Sketch](assets/sketch.excalidraw)', {
      mode: 'save',
      format: 'presentation',
      targetFolder: '/out',
      exportFolderName: 'board',
      sourceFilePath: '/src/workspace/board.md',
      linkHandlingMode: 'pack-linked',
      packAssets: true,
      packOptions: { typeMode: 'all', extensions: [], fileSizeLimitMB: 100 },
    });

    const writeCall = mockInvoke.mock.calls.find((c) => c[0] === 'write_export_file');
    expect(writeCall[1].content).toBe('![Sketch](' + expectedPackRelative + ')');
  });

  it('falls back to the raw link when the cache copy fails in pack mode', async () => {
    mockInvoke.mockImplementation((cmd, args) => {
      if (cmd === 'get_file_mtime_ms') return Promise.resolve(1_700_000_000_000);
      if (cmd === 'render_embedded_file') return Promise.resolve({ success: true, outputPath: args.opts.targetPath, format: 'svg', error: null });
      if (cmd === 'copy_export_assets') {
        return Promise.resolve([{ sourcePath: args.items[0].sourcePath, targetPath: args.items[0].targetPath, success: false, error: 'disk full' }]);
      }
      if (cmd === 'write_export_file') return Promise.resolve(undefined);
      return Promise.resolve({ success: true });
    });

    await ES._output('![Sketch](assets/sketch.excalidraw)', {
      mode: 'save',
      format: 'presentation',
      targetFolder: '/out',
      exportFolderName: 'board',
      sourceFilePath: '/src/workspace/board.md',
      linkHandlingMode: 'pack-linked',
      packAssets: true,
      packOptions: { typeMode: 'all', extensions: [], fileSizeLimitMB: 100 },
    });

    const writeCall = mockInvoke.mock.calls.find((c) => c[0] === 'write_export_file');
    // No rendered target survived → original source path stays (link rewriter
    // then turns it into a relative path to the source, not to the cache).
    expect(writeCall[1].content).toContain('sketch.excalidraw');
  });
});

// ── Dedupe: two embeds referencing the same source render once ──────────

describe('renderFileEmbedsForExport — deduplication', () => {
  it('renders a single cache file when multiple image links point at the same source', async () => {
    mockInvoke.mockImplementation((cmd, args) => {
      if (cmd === 'get_file_mtime_ms') return Promise.resolve(1_700_000_000_000);
      if (cmd === 'render_embedded_file') return Promise.resolve({ success: true, outputPath: args.opts.targetPath, format: 'svg', error: null });
      if (cmd === 'write_export_file') return Promise.resolve(undefined);
      return Promise.resolve({ success: true });
    });

    await ES._output(
      '![A](assets/sketch.excalidraw)\n\n![B](assets/sketch.excalidraw)',
      {
        mode: 'save',
        format: 'presentation',
        targetFolder: '/out',
        exportFolderName: 'board',
        sourceFilePath: '/src/workspace/board.md',
        linkHandlingMode: 'rewrite-only',
      }
    );

    const renderCalls = mockInvoke.mock.calls.filter((c) => c[0] === 'render_embedded_file');
    expect(renderCalls).toHaveLength(1);
    // get_file_mtime_ms is cached per source, only one call.
    const mtimeCalls = mockInvoke.mock.calls.filter((c) => c[0] === 'get_file_mtime_ms');
    expect(mtimeCalls).toHaveLength(1);
  });
});

// ── Regression: embedded PDF must convert to an image in export ─────────
// The PDF plugin renders client-side (pdf.js) in the board, so its preview
// block lacked cacheFolderName/outputExtension. getPreviewRenderConfig then
// returned null and renderFileEmbedsForExport skipped PDF entirely — the
// embed reached Marp/presentation output unconverted. The preview block now
// carries a cache config while keeping supportsRuntimeRender:false (board
// keeps its live viewer; only export uses the cache render).

describe('PDF embed export contract', () => {
  it('exposes an export-usable preview cache config without enabling board runtime render', () => {
    const cfg = Registry.getPreviewRenderConfig('/x/doc.pdf', { pageNumber: 1 });
    expect(cfg).toBeTruthy();
    expect(cfg.cacheFolderName).toBe('pdf-cache');
    // Board view must still use the interactive pdf.js viewer, not a
    // cached backend render.
    expect(cfg.supportsRuntimeRender).toBe(false);
    const exp = Registry.getExportRenderConfig('/x/doc.pdf', { pageNumber: 1 });
    expect(exp).toBeTruthy();
    expect(exp.outputExtension).toBe('png');
  });

  it('renders a ![](file.pdf) embed to the pdf-cache and rewrites the link (no longer skipped)', async () => {
    const absoluteSource = '/src/workspace/assets/sample.pdf';
    const mtimeMs = 1_700_000_000_000;
    const prev = Registry.getPreviewRenderConfig(absoluteSource, { pageNumber: 1 });
    const exp = Registry.getExportRenderConfig(absoluteSource, { pageNumber: 1 });
    const cacheDir = ES.buildDiagramCacheDir('/src/workspace/board.md', absoluteSource, prev.cacheFolderName);
    const cacheFile = ES.buildDiagramCacheFileName(absoluteSource, mtimeMs, exp.outputExtension, exp.suffix);
    const cacheAbsolute = cacheDir + '/' + cacheFile;
    const expectedLink = ES.relativePath('/out/board', cacheAbsolute);

    mockInvoke.mockImplementation((cmd, args) => {
      if (cmd === 'get_file_mtime_ms') return Promise.resolve(mtimeMs);
      if (cmd === 'render_embedded_file') {
        expect(args.opts.pluginId).toBe('pdf');
        expect(args.opts.targetPath).toBe(cacheAbsolute);
        expect(args.opts.outputFormat).toBe('png');
        return Promise.resolve({ success: true, outputPath: args.opts.targetPath, format: 'png', error: null });
      }
      if (cmd === 'write_export_file') return Promise.resolve(undefined);
      return Promise.resolve({ success: true });
    });

    await ES._output('![Doc](assets/sample.pdf)', {
      mode: 'save',
      format: 'presentation',
      targetFolder: '/out',
      exportFolderName: 'board',
      sourceFilePath: '/src/workspace/board.md',
      linkHandlingMode: 'rewrite-only',
    });

    const renderCalls = mockInvoke.mock.calls.filter((c) => c[0] === 'render_embedded_file');
    expect(renderCalls).toHaveLength(1);
    const writeCall = mockInvoke.mock.calls.find((c) => c[0] === 'write_export_file');
    expect(writeCall[1].content).toBe('![Doc](' + expectedLink + ')');
    expect(writeCall[1].content).not.toContain('sample.pdf');
  });
});
