import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { loadIIFE } from './load-iife.js';

// Phase 3A contract tests: include-handling dropdown (keep/strip/merge),
// media-embedding opt-in (images become data URIs; video/audio skipped when
// oversize), and the Readme.txt skip/warning report.

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
  Prefs = loadIIFE('export/exportUiPreferences.js', 'LexeraExportUiPreferences', { window: mockWindow });
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

// ── Include handling normalization + migration ───────────────────────────

describe('normalizeIncludeHandling', () => {
  it('accepts the three canonical values', () => {
    expect(ES.normalizeIncludeHandling('keep')).toBe('keep');
    expect(ES.normalizeIncludeHandling('strip')).toBe('strip');
    expect(ES.normalizeIncludeHandling('merge')).toBe('merge');
  });

  it('migrates legacy boolean stripIncludes', () => {
    expect(ES.normalizeIncludeHandling('true')).toBe('strip');
    expect(ES.normalizeIncludeHandling('false')).toBe('keep');
  });

  it('defaults to keep for unknown or empty values', () => {
    expect(ES.normalizeIncludeHandling('')).toBe('keep');
    expect(ES.normalizeIncludeHandling(null)).toBe('keep');
    expect(ES.normalizeIncludeHandling('garbage')).toBe('keep');
  });

  it('is mirrored in the preferences module', () => {
    expect(Prefs.normalizeIncludeHandling('true')).toBe('strip');
    expect(Prefs.normalizeIncludeHandling('false')).toBe('keep');
    expect(Prefs.normalizeIncludeHandling('merge')).toBe('merge');
  });
});

describe('normalizeMergeIncludesMaxDepth', () => {
  it('defaults to 10 for missing or invalid input', () => {
    expect(ES.normalizeMergeIncludesMaxDepth('')).toBe(10);
    expect(ES.normalizeMergeIncludesMaxDepth(null)).toBe(10);
    expect(ES.normalizeMergeIncludesMaxDepth(undefined)).toBe(10);
    expect(ES.normalizeMergeIncludesMaxDepth('garbage')).toBe(10);
  });

  it('clamps to [1, 50]', () => {
    expect(ES.normalizeMergeIncludesMaxDepth('0')).toBe(10);
    expect(ES.normalizeMergeIncludesMaxDepth('-1')).toBe(10);
    expect(ES.normalizeMergeIncludesMaxDepth('100')).toBe(50);
    expect(ES.normalizeMergeIncludesMaxDepth('50')).toBe(50);
    expect(ES.normalizeMergeIncludesMaxDepth('1')).toBe(1);
    expect(ES.normalizeMergeIncludesMaxDepth('7')).toBe(7);
  });
});

// ── mergeIncludesInline ──────────────────────────────────────────────────

describe('mergeIncludesInline', () => {
  it('replaces !!!include(path)!!! with the file body', async () => {
    mockInvoke.mockImplementation((cmd, args) => {
      if (cmd === 'read_text_file') {
        if (args.path === '/src/workspace/part.md') return Promise.resolve('## Inlined section\nBody.');
        return Promise.reject(new Error('unexpected path ' + args.path));
      }
      return Promise.resolve();
    });

    const report = { skipped: [], embedded: [] };
    const result = await ES.mergeIncludesInline(
      '# Main\n\n!!!include(part.md)!!!\n\n_foot_',
      '/src/workspace/board.md',
      10,
      report
    );

    expect(result.content).toBe('# Main\n\n## Inlined section\nBody.\n\n_foot_');
    expect(report.skipped).toHaveLength(0);
  });

  it('logs a skip entry and keeps the directive when the file read fails', async () => {
    mockInvoke.mockImplementation((cmd) => {
      if (cmd === 'read_text_file') return Promise.reject(new Error('ENOENT'));
      return Promise.resolve();
    });

    const report = { skipped: [], embedded: [] };
    const result = await ES.mergeIncludesInline(
      '!!!include(missing.md)!!!',
      '/src/workspace/board.md',
      10,
      report
    );

    expect(result.content).toBe('!!!include(missing.md)!!!');
    expect(report.skipped).toHaveLength(1);
    expect(report.skipped[0].category).toBe('include');
    expect(report.skipped[0].reason).toContain('ENOENT');
  });

  it('enforces the depth cap to prevent runaway expansion', async () => {
    // Every include file contains another include pointing at the same file.
    mockInvoke.mockImplementation((cmd) => {
      if (cmd === 'read_text_file') return Promise.resolve('!!!include(self.md)!!!\nDONE');
      return Promise.resolve();
    });

    const report = { skipped: [], embedded: [] };
    const result = await ES.mergeIncludesInline(
      '!!!include(self.md)!!!',
      '/src/workspace/board.md',
      3,
      report
    );
    // At the cap, the directive is left unexpanded. With cycle detection the
    // same-path guard also fires, so the chain stops cleanly and the final
    // body contains the "DONE" string from whichever level was expanded.
    expect(result.content).toContain('DONE');
  });

  it('detects cycles via visited-path set', async () => {
    mockInvoke.mockImplementation((cmd, args) => {
      if (cmd === 'read_text_file') {
        if (args.path === '/src/workspace/a.md') return Promise.resolve('A>\n!!!include(b.md)!!!\n<A');
        if (args.path === '/src/workspace/b.md') return Promise.resolve('B>\n!!!include(a.md)!!!\n<B');
      }
      return Promise.resolve();
    });

    const report = { skipped: [], embedded: [] };
    const result = await ES.mergeIncludesInline(
      '!!!include(a.md)!!!',
      '/src/workspace/board.md',
      10,
      report
    );
    // a.md expands with b.md body, b.md tries to re-include a.md but the
    // cycle guard records the skip and keeps the directive intact.
    expect(result.content).toContain('A>');
    expect(result.content).toContain('B>');
    const cycleSkip = report.skipped.find((e) => e.reason && e.reason.indexOf('cycle') >= 0);
    expect(cycleSkip).toBeTruthy();
  });
});

// ── embedMediaAsDataUris ────────────────────────────────────────────────

describe('embedMediaAsDataUris', () => {
  it('rewrites image references into data URIs for image/* media', async () => {
    mockInvoke.mockImplementation((cmd, args) => {
      if (cmd === 'read_file_as_data_uri') {
        expect(args.path).toBe('/src/workspace/assets/pic.png');
        return Promise.resolve({
          dataUri: 'data:image/png;base64,AAA=',
          mimeType: 'image/png',
          sizeBytes: 100,
          skipped: false,
          skippedReason: null,
        });
      }
      return Promise.resolve();
    });

    const report = { skipped: [], embedded: [] };
    const result = await ES.embedMediaAsDataUris(
      '![logo](assets/pic.png)',
      '/src/workspace/board.md',
      10 * 1024 * 1024,
      'keep',
      report
    );
    expect(result.content).toBe('![logo](data:image/png;base64,AAA=)');
    // Images do not add warning entries (only video/audio do).
    expect(report.embedded).toHaveLength(0);
    expect(report.skipped).toHaveLength(0);
  });

  it('logs an embed warning when video/audio is inlined', async () => {
    mockInvoke.mockImplementation((cmd, args) => {
      if (cmd === 'read_file_as_data_uri') {
        return Promise.resolve({
          dataUri: 'data:video/mp4;base64,XYZ=',
          mimeType: 'video/mp4',
          sizeBytes: 42 * 1024 * 1024,
          skipped: false,
          skippedReason: null,
        });
      }
      return Promise.resolve();
    });

    const report = { skipped: [], embedded: [] };
    await ES.embedMediaAsDataUris(
      '![clip](assets/intro.mp4)',
      '/src/workspace/board.md',
      100 * 1024 * 1024,
      'marp-html',
      report
    );
    expect(report.embedded).toHaveLength(1);
    expect(report.embedded[0].category).toBe('video');
    expect(report.embedded[0].outputFormat).toBe('marp-html');
    expect(report.embedded[0].sizeBytes).toBe(42 * 1024 * 1024);
  });

  it('keeps original link and logs a skip when the file exceeds the size limit', async () => {
    mockInvoke.mockImplementation((cmd) => {
      if (cmd === 'read_file_as_data_uri') {
        return Promise.resolve({
          dataUri: null,
          mimeType: 'video/mp4',
          sizeBytes: 200 * 1024 * 1024,
          skipped: true,
          skippedReason: 'file size 209715200 bytes exceeds limit 104857600 bytes',
        });
      }
      return Promise.resolve();
    });

    const report = { skipped: [], embedded: [] };
    const result = await ES.embedMediaAsDataUris(
      '![big](assets/big.mp4)',
      '/src/workspace/board.md',
      100 * 1024 * 1024,
      'keep',
      report
    );
    expect(result.content).toBe('![big](assets/big.mp4)');
    expect(report.skipped).toHaveLength(1);
    expect(report.skipped[0].category).toBe('video');
    expect(report.skipped[0].sizeBytes).toBe(200 * 1024 * 1024);
  });

  it('skips URLs, data-URIs, and non-media files', async () => {
    mockInvoke.mockImplementation(() => Promise.resolve());
    const report = { skipped: [], embedded: [] };
    const input = [
      '![ext](https://example.com/pic.png)',
      '![already](data:image/png;base64,AAA=)',
      '![doc](notes.pdf)',
    ].join('\n');
    const result = await ES.embedMediaAsDataUris(input, '/src/workspace/board.md', 1024, 'keep', report);
    // None were rewritten — no read_file_as_data_uri call was even issued.
    expect(result.content).toBe(input);
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});

// ── shouldEmbedMediaForFormat ────────────────────────────────────────────

describe('shouldEmbedMediaForFormat', () => {
  it('returns true for keep / kanban and for marp html/markdown', () => {
    expect(ES.shouldEmbedMediaForFormat({ format: 'keep' })).toBe(true);
    expect(ES.shouldEmbedMediaForFormat({ format: 'kanban' })).toBe(true);
    expect(ES.shouldEmbedMediaForFormat({ format: 'presentation', marpFormat: 'html' })).toBe(true);
    expect(ES.shouldEmbedMediaForFormat({ format: 'presentation', marpFormat: 'markdown' })).toBe(true);
  });

  it('returns false for formats that embed natively (pdf/pptx/docx/odt/epub)', () => {
    expect(ES.shouldEmbedMediaForFormat({ format: 'presentation', marpFormat: 'pdf' })).toBe(false);
    expect(ES.shouldEmbedMediaForFormat({ format: 'presentation', marpFormat: 'pptx' })).toBe(false);
    expect(ES.shouldEmbedMediaForFormat({ format: 'document', pandocFormat: 'docx' })).toBe(false);
    expect(ES.shouldEmbedMediaForFormat({ format: 'document', pandocFormat: 'epub' })).toBe(false);
  });
});

// ── writeExportReadme ───────────────────────────────────────────────────

describe('writeExportReadme', () => {
  it('skips writing when there are no entries', async () => {
    mockInvoke.mockImplementation(() => Promise.resolve());
    const result = await ES.writeExportReadme('/out/board', { skipped: [], embedded: [] });
    expect(result).toBeNull();
    expect(mockInvoke.mock.calls.some((c) => c[0] === 'write_export_file')).toBe(false);
  });

  it('writes Readme.txt grouped by category when entries exist', async () => {
    let capturedContent = '';
    mockInvoke.mockImplementation((cmd, args) => {
      if (cmd === 'write_export_file') {
        capturedContent = args.content;
        return Promise.resolve();
      }
      return Promise.resolve();
    });

    const result = await ES.writeExportReadme('/out/board', {
      skipped: [
        { path: '/src/big.mp4', category: 'video', sizeBytes: 200 * 1024 * 1024, sizeLimitBytes: 100 * 1024 * 1024 },
        { path: '/src/huge.mp3', category: 'audio', sizeBytes: 150 * 1024 * 1024, sizeLimitBytes: 100 * 1024 * 1024 },
      ],
      embedded: [
        { path: '/src/intro.mp4', category: 'video', sizeBytes: 42 * 1024 * 1024, outputFormat: 'marp-html' },
      ],
    });
    expect(result).toBe('/out/board/Readme.txt');
    expect(capturedContent).toContain('# Export report');
    expect(capturedContent).toContain('## Skipped (kept original link)');
    expect(capturedContent).toContain('### Videos');
    expect(capturedContent).toContain('### Audio');
    expect(capturedContent).toContain('## Embedded media (inflated output size)');
    expect(capturedContent).toContain('/src/big.mp4');
    expect(capturedContent).toContain('/src/huge.mp3');
    expect(capturedContent).toContain('/src/intro.mp4');
    expect(capturedContent).toContain('marp-html');
  });
});

// ── End-to-end wiring through prepareContentForOutput ───────────────────

describe('prepareContentForOutput — include + embed wiring', () => {
  it('expands !!!include() only when includeHandling=merge', async () => {
    mockInvoke.mockImplementation((cmd, args) => {
      if (cmd === 'read_text_file') return Promise.resolve('INLINED');
      if (cmd === 'write_export_file') return Promise.resolve();
      return Promise.resolve({ success: true });
    });

    const result = await ES.prepareContentForOutput(
      '!!!include(part.md)!!!',
      {
        mode: 'save',
        format: 'keep',
        sourceFilePath: '/src/workspace/board.md',
        includeHandling: 'merge',
      },
      '/out/board/board.md'
    );
    expect(result.content).toBe('INLINED');
  });

  it('leaves !!!include() alone when includeHandling=keep (default)', async () => {
    mockInvoke.mockImplementation(() => Promise.resolve());

    const result = await ES.prepareContentForOutput(
      '!!!include(part.md)!!!',
      {
        mode: 'save',
        format: 'keep',
        sourceFilePath: '/src/workspace/board.md',
        includeHandling: 'keep',
      },
      '/out/board/board.md'
    );
    expect(result.content).toContain('!!!include(part.md)!!!');
    expect(mockInvoke.mock.calls.some((c) => c[0] === 'read_text_file')).toBe(false);
  });

  it('embeds media only when embedMedia=true AND format supports it', async () => {
    mockInvoke.mockImplementation((cmd) => {
      if (cmd === 'read_file_as_data_uri') return Promise.resolve({
        dataUri: 'data:image/png;base64,AAA=',
        mimeType: 'image/png',
        sizeBytes: 100,
        skipped: false,
      });
      if (cmd === 'write_export_file') return Promise.resolve();
      return Promise.resolve({ success: true });
    });

    // embedMedia=true + format=keep → embed
    let result = await ES.prepareContentForOutput(
      '![p](assets/pic.png)',
      {
        mode: 'save',
        format: 'keep',
        sourceFilePath: '/src/workspace/board.md',
        embedMedia: true,
      },
      '/out/board/board.md'
    );
    expect(result.content).toContain('data:image/png;base64,AAA=');

    // embedMedia=false → no embed (file reference preserved / rewritten relatively)
    mockInvoke.mockReset();
    mockInvoke.mockImplementation((cmd) => {
      if (cmd === 'write_export_file') return Promise.resolve();
      return Promise.resolve({ success: true });
    });
    result = await ES.prepareContentForOutput(
      '![p](assets/pic.png)',
      {
        mode: 'save',
        format: 'keep',
        sourceFilePath: '/src/workspace/board.md',
        embedMedia: false,
      },
      '/out/board/board.md'
    );
    expect(result.content).not.toContain('data:image/png;base64');
    expect(mockInvoke.mock.calls.some((c) => c[0] === 'read_file_as_data_uri')).toBe(false);
  });

  it('does NOT embed even with embedMedia=true when format is pandoc docx', async () => {
    mockInvoke.mockImplementation(() => Promise.resolve());
    const result = await ES.prepareContentForOutput(
      '![p](assets/pic.png)',
      {
        mode: 'save',
        format: 'document',
        pandocFormat: 'docx',
        sourceFilePath: '/src/workspace/board.md',
        embedMedia: true,
      },
      '/out/board/board.md'
    );
    expect(result.content).not.toContain('data:image/png;base64');
    expect(mockInvoke.mock.calls.some((c) => c[0] === 'read_file_as_data_uri')).toBe(false);
  });

  it('writes Readme.txt when any report entry exists', async () => {
    let wroteReadme = false;
    mockInvoke.mockImplementation((cmd, args) => {
      if (cmd === 'read_file_as_data_uri') return Promise.resolve({
        dataUri: null,
        mimeType: 'video/mp4',
        sizeBytes: 200 * 1024 * 1024,
        skipped: true,
        skippedReason: 'over limit',
      });
      if (cmd === 'write_export_file' && args.path === '/out/board/Readme.txt') {
        wroteReadme = true;
        return Promise.resolve();
      }
      return Promise.resolve({ success: true });
    });

    await ES.prepareContentForOutput(
      '![clip](assets/big.mp4)',
      {
        mode: 'save',
        format: 'keep',
        sourceFilePath: '/src/workspace/board.md',
        embedMedia: true,
        packOptions: { fileSizeLimitMB: 10 },
      },
      '/out/board/board.md'
    );
    expect(wroteReadme).toBe(true);
  });
});
