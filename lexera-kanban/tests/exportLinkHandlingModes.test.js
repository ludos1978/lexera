import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { loadIIFE } from './load-iife.js';

// Phase 2 tests: legacy link-handling values migrate to the two-mode scheme,
// pack-type filter by extension list picks the correct files, and the
// rewrite-relative default emits relative paths that rewrite_export_file and
// Marp can follow without copying the originals.

let ES;
let Registry;
let Prefs;

const mockInvoke = vi.fn();
const mockFetch = vi.fn();

const mockWindow = {
  __TAURI__: { core: { invoke: mockInvoke } },
  LexeraApi: { baseUrl: 'http://localhost:9000', discover: vi.fn() },
  ExportService: null,
};

const mockLexeraLog = vi.fn();

beforeAll(() => {
  Prefs = loadIIFE('export/exportUiPreferences.js', 'LexeraExportUiPreferences', {
    window: mockWindow,
  });
  mockWindow.LexeraExportUiPreferences = Prefs;

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

// ── Legacy-value migration ───────────────────────────────────────────────

describe('normalizeLinkHandlingMode — legacy migration', () => {
  it('collapses pack-all into pack-linked (type filter moves to packTypeMode)', () => {
    expect(ES.normalizeLinkHandlingMode('pack-all')).toBe('pack-linked');
  });

  it('keeps pack-linked as pack-linked', () => {
    expect(ES.normalizeLinkHandlingMode('pack-linked')).toBe('pack-linked');
  });

  it('collapses rewrite-only into rewrite-relative (default)', () => {
    expect(ES.normalizeLinkHandlingMode('rewrite-only')).toBe('rewrite-relative');
  });

  it('collapses no-modify / dont-modify into rewrite-relative', () => {
    expect(ES.normalizeLinkHandlingMode('no-modify')).toBe('rewrite-relative');
    expect(ES.normalizeLinkHandlingMode('dont-modify')).toBe('rewrite-relative');
  });

  it('returns rewrite-relative for unknown and empty values', () => {
    expect(ES.normalizeLinkHandlingMode('')).toBe('rewrite-relative');
    expect(ES.normalizeLinkHandlingMode('garbage')).toBe('rewrite-relative');
    expect(ES.normalizeLinkHandlingMode(null)).toBe('rewrite-relative');
    expect(ES.normalizeLinkHandlingMode(undefined)).toBe('rewrite-relative');
  });

  it('is mirrored in the shared preferences module', () => {
    expect(Prefs.normalizeLinkHandlingMode('pack-all')).toBe('pack-linked');
    expect(Prefs.normalizeLinkHandlingMode('no-modify')).toBe('rewrite-relative');
    expect(Prefs.normalizeLinkHandlingMode('rewrite-only')).toBe('rewrite-relative');
  });
});

// ── Custom extension list parsing ────────────────────────────────────────

describe('normalizePackCustomExtensions', () => {
  it('parses comma-separated extensions with and without leading dots', () => {
    expect(ES.normalizePackCustomExtensions('.png, mp4, .PDF')).toEqual(['.png', '.mp4', '.pdf']);
  });

  it('handles whitespace, tabs, and semicolons as separators', () => {
    expect(ES.normalizePackCustomExtensions('.png  .mp4\t; pdf')).toEqual(['.png', '.mp4', '.pdf']);
  });

  it('is case-insensitive and deduplicates', () => {
    expect(ES.normalizePackCustomExtensions('.PNG, .png, PNG')).toEqual(['.png']);
  });

  it('returns [] for empty input', () => {
    expect(ES.normalizePackCustomExtensions('')).toEqual([]);
    expect(ES.normalizePackCustomExtensions('   ,  ')).toEqual([]);
    expect(ES.normalizePackCustomExtensions(null)).toEqual([]);
  });

  it('accepts an existing array (idempotent re-normalization)', () => {
    expect(ES.normalizePackCustomExtensions(['.png', 'MP4'])).toEqual(['.png', '.mp4']);
  });
});

// ── shouldPackAsset with extension filter ───────────────────────────────

describe('shouldPackAsset', () => {
  it('returns false when linkHandlingMode is rewrite-relative', () => {
    expect(ES.shouldPackAsset('/a/pic.png', 'rewrite-relative', { typeMode: 'all' })).toBe(false);
  });

  it('returns false when linkHandlingMode is legacy no-modify (migrates to rewrite-relative)', () => {
    expect(ES.shouldPackAsset('/a/pic.png', 'no-modify', { typeMode: 'all' })).toBe(false);
  });

  it('packs everything when typeMode = all (including a legacy pack-all mode)', () => {
    expect(ES.shouldPackAsset('/a/pic.png', 'pack-all', { typeMode: 'all' })).toBe(true);
    expect(ES.shouldPackAsset('/a/movie.mp4', 'pack-linked', { typeMode: 'all' })).toBe(true);
    expect(ES.shouldPackAsset('/a/data.xlsx', 'pack-linked', { typeMode: 'all' })).toBe(true);
  });

  it('packs only whitelisted extensions when typeMode = custom', () => {
    const opts = { typeMode: 'custom', extensions: ['.png', '.mp4'] };
    expect(ES.shouldPackAsset('/a/pic.png', 'pack-linked', opts)).toBe(true);
    expect(ES.shouldPackAsset('/a/movie.MP4', 'pack-linked', opts)).toBe(true);
    expect(ES.shouldPackAsset('/a/readme.md', 'pack-linked', opts)).toBe(false);
  });

  it('packs nothing when typeMode = custom and extension list is empty', () => {
    expect(ES.shouldPackAsset('/a/pic.png', 'pack-linked', { typeMode: 'custom', extensions: [] })).toBe(false);
  });

  it('accepts raw string extensions via normalization', () => {
    expect(ES.shouldPackAsset('/a/pic.png', 'pack-linked', { typeMode: 'custom', extensions: 'png, mp4' })).toBe(true);
    expect(ES.shouldPackAsset('/a/file.txt', 'pack-linked', { typeMode: 'custom', extensions: 'png, mp4' })).toBe(false);
  });
});

// ── End-to-end: rewrite-relative default keeps originals in place ───────

describe('rewrite-relative mode — embed paths', () => {
  it('emits relative paths from exportDir to the original source when no packing', async () => {
    mockInvoke.mockImplementation((cmd) => {
      if (cmd === 'write_export_file') return Promise.resolve(undefined);
      return Promise.resolve({ success: true });
    });

    await ES._output('![P](assets/pic.png)', {
      mode: 'save',
      format: 'keep',
      targetFolder: '/out',
      exportFolderName: 'board',
      sourceFilePath: '/src/workspace/board.md',
      linkHandlingMode: 'rewrite-relative',
    });

    const writeCall = mockInvoke.mock.calls.find((c) => c[0] === 'write_export_file');
    expect(writeCall[1]).toEqual({
      path: '/out/board/board.md',
      content: '![P](../../src/workspace/assets/pic.png)',
    });
    // No pack copy is invoked in rewrite-relative mode.
    expect(mockInvoke.mock.calls.some((c) => c[0] === 'copy_export_assets')).toBe(false);
  });

  it('treats legacy rewrite-only as rewrite-relative', async () => {
    mockInvoke.mockImplementation((cmd) => {
      if (cmd === 'write_export_file') return Promise.resolve(undefined);
      return Promise.resolve({ success: true });
    });

    await ES._output('![P](assets/pic.png)', {
      mode: 'save',
      format: 'keep',
      targetFolder: '/out',
      exportFolderName: 'board',
      sourceFilePath: '/src/workspace/board.md',
      linkHandlingMode: 'rewrite-only',
    });

    const writeCall = mockInvoke.mock.calls.find((c) => c[0] === 'write_export_file');
    expect(writeCall[1].content).toContain('src/workspace/assets/pic.png');
    expect(mockInvoke.mock.calls.some((c) => c[0] === 'copy_export_assets')).toBe(false);
  });
});

// ── Packing filter end-to-end ────────────────────────────────────────────

describe('pack-linked with custom-extensions filter', () => {
  it('skips files whose extension is not in the whitelist', async () => {
    mockInvoke.mockImplementation((cmd, args) => {
      if (cmd === 'copy_export_assets') {
        // Only pic.png matches; video.mp4 must not be in items.
        const paths = args.items.map((i) => i.sourcePath);
        expect(paths).toContain('/src/workspace/assets/pic.png');
        expect(paths).not.toContain('/src/workspace/assets/video.mp4');
        return Promise.resolve(args.items.map((i) => ({ sourcePath: i.sourcePath, targetPath: i.targetPath, success: true, error: null })));
      }
      if (cmd === 'write_export_file') return Promise.resolve(undefined);
      return Promise.resolve({ success: true });
    });

    await ES._output(
      '![P](assets/pic.png)\n\n![V](assets/video.mp4)',
      {
        mode: 'save',
        format: 'keep',
        targetFolder: '/out',
        exportFolderName: 'board',
        sourceFilePath: '/src/workspace/board.md',
        linkHandlingMode: 'pack-linked',
        packAssets: true,
        packOptions: { typeMode: 'custom', extensions: ['.png'], fileSizeLimitMB: 100 },
      }
    );

    const writeCall = mockInvoke.mock.calls.find((c) => c[0] === 'write_export_file');
    // png → _Rendered/; mp4 → relative to original source (rewrite only).
    expect(writeCall[1].content).toContain('_Rendered/pic.png');
    expect(writeCall[1].content).toContain('src/workspace/assets/video.mp4');
  });
});

// ── Share-content preset wires to new scheme ────────────────────────────

describe('applyExportPresetToOptions — share-content', () => {
  it('wires linkHandlingMode=pack-linked + typeMode=all', () => {
    const next = Prefs.applyExportPresetToOptions({}, 'share-content');
    expect(next.linkHandlingMode).toBe('pack-linked');
    expect(next.packAssets).toBe(true);
    expect(next.packOptions).toEqual({ typeMode: 'all', extensions: [], fileSizeLimitMB: 100 });
  });

  it('marp presets use rewrite-relative', () => {
    expect(Prefs.applyExportPresetToOptions({}, 'marp-presentation').linkHandlingMode).toBe('rewrite-relative');
    expect(Prefs.applyExportPresetToOptions({}, 'marp-pdf').linkHandlingMode).toBe('rewrite-relative');
  });
});
