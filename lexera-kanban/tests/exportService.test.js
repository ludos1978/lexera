import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { loadIIFE } from './load-iife.js';

// ── Bootstrap ──────────────────────────────────────────────────────────────

let ES; // ExportService class
let Registry;

const mockInvoke = vi.fn();
const mockFetch = vi.fn();

const mockWindow = {
  __TAURI__: { core: { invoke: mockInvoke } },
  LexeraApi: { baseUrl: 'http://localhost:9000', discover: vi.fn() },
  ExportService: null, // will be assigned by the source file
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
  mockWindow.LexeraApi.baseUrl = 'http://localhost:9000';
  mockWindow.LexeraApi.discover = vi.fn();
});

// ═══════════════════════════════════════════════════════════════════════════
// getExtensionForFormat — pure static helper
// ═══════════════════════════════════════════════════════════════════════════

describe('getExtensionForFormat', () => {

  // ── Presentation format ──

  it('returns .pdf for presentation + pdf marpFormat', () => {
    expect(ES.getExtensionForFormat('presentation', 'pdf', undefined)).toBe('.pdf');
  });

  it('returns .pptx for presentation + pptx marpFormat', () => {
    expect(ES.getExtensionForFormat('presentation', 'pptx', undefined)).toBe('.pptx');
  });

  it('returns .html for presentation + html marpFormat', () => {
    expect(ES.getExtensionForFormat('presentation', 'html', undefined)).toBe('.html');
  });

  it('returns .md for presentation + markdown marpFormat', () => {
    expect(ES.getExtensionForFormat('presentation', 'markdown', undefined)).toBe('.md');
  });

  it('returns .md for presentation with no marpFormat', () => {
    expect(ES.getExtensionForFormat('presentation', undefined, undefined)).toBe('.md');
  });

  // ── Document format ──

  it('returns .docx for document + docx pandocFormat', () => {
    expect(ES.getExtensionForFormat('document', undefined, 'docx')).toBe('.docx');
  });

  it('returns .odt for document + odt pandocFormat', () => {
    expect(ES.getExtensionForFormat('document', undefined, 'odt')).toBe('.odt');
  });

  it('returns .epub for document + epub pandocFormat', () => {
    expect(ES.getExtensionForFormat('document', undefined, 'epub')).toBe('.epub');
  });

  it('returns .md for document with no pandocFormat', () => {
    expect(ES.getExtensionForFormat('document', undefined, undefined)).toBe('.md');
  });

  // ── Keep / kanban formats ──

  it('returns .md for keep format', () => {
    expect(ES.getExtensionForFormat('keep', undefined, undefined)).toBe('.md');
  });

  it('returns .md for kanban format', () => {
    expect(ES.getExtensionForFormat('kanban', undefined, undefined)).toBe('.md');
  });

  it('returns .md for unknown format', () => {
    expect(ES.getExtensionForFormat('something-else', 'pdf', 'docx')).toBe('.md');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// generateExportPath — pure static helper
// ═══════════════════════════════════════════════════════════════════════════

describe('generateExportPath', () => {

  it('builds path with unix separators', () => {
    const result = ES.generateExportPath('/home/user/exports', 'my-board', '.md');
    expect(result).toBe('/home/user/exports/my-board/my-board.md');
  });

  it('builds path with windows separators', () => {
    const result = ES.generateExportPath('C:\\Users\\exports', 'my-board', '.pdf');
    expect(result).toBe('C:\\Users\\exports\\my-board\\my-board.pdf');
  });

  it('defaults folderName to "export" when empty', () => {
    const result = ES.generateExportPath('/tmp', '', '.md');
    expect(result).toBe('/tmp/export/export.md');
  });

  it('defaults folderName to "export" when null', () => {
    const result = ES.generateExportPath('/tmp', null, '.md');
    expect(result).toBe('/tmp/export/export.md');
  });

  it('defaults folderName to "export" when undefined', () => {
    const result = ES.generateExportPath('/tmp', undefined, '.md');
    expect(result).toBe('/tmp/export/export.md');
  });

  it('defaults targetFolder to empty string when null', () => {
    const result = ES.generateExportPath(null, 'board', '.md');
    expect(result).toBe('/board/board.md');
  });

  it('defaults targetFolder to empty string when undefined', () => {
    const result = ES.generateExportPath(undefined, 'board', '.md');
    expect(result).toBe('/board/board.md');
  });

  it('handles both defaults at once', () => {
    const result = ES.generateExportPath(null, null, '.html');
    expect(result).toBe('/export/export.html');
  });
});

describe('getAssetType', () => {
  it('uses registry metadata for plugin-backed embedded file types', () => {
    expect(ES.getAssetType('diagram.drawio')).toBe('diagram');
    expect(ES.getAssetType('assets/scene.excalidraw.json')).toBe('diagram');
    expect(ES.getAssetType('docs/book.epub')).toBe('document');
    expect(ES.getAssetType('tables/report.tsv')).toBe('document');
  });

  it('keeps native media extension fallbacks for images and video', () => {
    expect(ES.getAssetType('images/cover.png')).toBe('image');
    expect(ES.getAssetType('videos/demo.mp4')).toBe('video');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// _transform — Phase 2 logic
// ═══════════════════════════════════════════════════════════════════════════

describe('_transform', () => {

  it('returns content unchanged for non-presentation format', async () => {
    const content = '# Document content';
    const result = await ES._transform(content, { format: 'document' });
    expect(result).toBe(content);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns content unchanged for keep format', async () => {
    const content = '# Keep content';
    const result = await ES._transform(content, { format: 'keep' });
    expect(result).toBe(content);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns content unchanged when all presentation modes are default', async () => {
    const content = '---\nmarp: true\n---\n# Slide 1';
    const result = await ES._transform(content, {
      format: 'presentation',
      speakerNoteMode: 'comment',
      htmlCommentMode: 'keep',
      htmlContentMode: 'keep',
    });
    expect(result).toBe(content);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns content unchanged when presentation options are omitted (defaults apply)', async () => {
    const content = '---\nmarp: true\n---\n# Slide 1';
    const result = await ES._transform(content, { format: 'presentation' });
    expect(result).toBe(content);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('applies embed removal locally without REST when only embed handling differs', async () => {
    const content = '![Demo](https://miro.com/app/embed/abc){.embed}';
    const result = await ES._transform(content, {
      format: 'presentation',
      mode: 'save',
      marpFormat: 'pdf',
      embedHandling: 'remove',
    });

    expect(result).toBe('');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('forces iframe embeds for html presentation output', async () => {
    const content = '![Demo](https://miro.com/app/embed/abc){.embed width=90% height=360}';
    const result = await ES._transform(content, {
      format: 'presentation',
      mode: 'save',
      marpFormat: 'html',
    });

    expect(result).toContain('<iframe');
    expect(result).toContain('width="90%"');
    expect(result).toContain('height="360"');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('calls REST transform endpoint when speakerNoteMode is non-default', async () => {
    const content = '# Slide\n\n<!-- speaker note -->';
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ content: '# Slide\n\n(note removed)' }),
    });

    const result = await ES._transform(content, {
      format: 'presentation',
      speakerNoteMode: 'remove',
    });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('http://localhost:9000/export/transform');
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body);
    expect(body.speakerNoteMode).toBe('remove');
    expect(body.htmlCommentMode).toBe('keep');
    expect(body.htmlContentMode).toBe('keep');
    expect(body.format).toBe('presentation');
    expect(body.content).toBe(content);
    expect(result).toBe('# Slide\n\n(note removed)');
  });

  it('calls REST transform endpoint when htmlCommentMode is non-default', async () => {
    const content = '# Slide\n<!-- comment -->';
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ content: '# Slide' }),
    });

    const result = await ES._transform(content, {
      format: 'presentation',
      htmlCommentMode: 'strip',
    });

    expect(mockFetch).toHaveBeenCalledOnce();
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.htmlCommentMode).toBe('strip');
    expect(result).toBe('# Slide');
  });

  it('calls REST transform endpoint when htmlContentMode is non-default', async () => {
    const content = '# Slide\n<div>html</div>';
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ content: '# Slide\nhtml' }),
    });

    const result = await ES._transform(content, {
      format: 'presentation',
      htmlContentMode: 'strip',
    });

    expect(mockFetch).toHaveBeenCalledOnce();
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.htmlContentMode).toBe('strip');
    expect(result).toBe('# Slide\nhtml');
  });

  it('falls back to original content when API returns empty content', async () => {
    const content = '# Slide';
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ content: '' }),
    });

    const result = await ES._transform(content, {
      format: 'presentation',
      speakerNoteMode: 'remove',
    });

    expect(result).toBe(content);
  });

  it('throws on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    });

    await expect(ES._transform('content', {
      format: 'presentation',
      speakerNoteMode: 'remove',
    })).rejects.toThrow('Transform failed (500): Internal Server Error');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// _extract — Phase 1 endpoint and body building
// ═══════════════════════════════════════════════════════════════════════════

describe('_extract', () => {

  it('calls the presentation endpoint for format=presentation', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ markdown: '---\nmarp: true\n---\n# Slide' }),
    });

    const result = await ES._extract({
      boardId: 'board-42',
      format: 'presentation',
      tagVisibility: 'visible',
      excludeTags: ['hidden'],
      stripIncludes: true,
      includeMarpDirectives: true,
      marpTheme: 'gaia',
      marpGlobalClasses: ['invert'],
      marpLocalClasses: [],
      columnIds: ['col-1', 'col-2'],
      columnIndexes: [0, 1],
    });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('http://localhost:9000/boards/board-42/export/presentation');
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body);
    expect(body.tagVisibility).toBe('visible');
    expect(body.excludeTags).toEqual(['hidden']);
    expect(body.stripIncludes).toBe(true);
    expect(body.includeMarpDirectives).toBe(true);
    expect(body.marpTheme).toBe('gaia');
    expect(body.marpGlobalClasses).toEqual(['invert']);
    expect(body.marpLocalClasses).toEqual([]);
    expect(body.columnIds).toEqual(['col-1', 'col-2']);
    expect(body.columnIndexes).toEqual([0, 1]);
    expect(result).toBe('---\nmarp: true\n---\n# Slide');
  });

  it('calls the document endpoint for format=document', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ markdown: '# Document' }),
    });

    const result = await ES._extract({
      boardId: 'board-7',
      format: 'document',
      documentPageBreaks: 'column',
    });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('http://localhost:9000/boards/board-7/export/document');
    const body = JSON.parse(opts.body);
    expect(body.pageBreaks).toBe('column');
    expect(body.tagVisibility).toBe('all');
    expect(body.excludeTags).toEqual([]);
    expect(body.stripIncludes).toBe(false);
    expect(body.columnIds).toEqual([]);
    expect(body.columnIndexes).toEqual([]);
    expect(result).toBe('# Document');
  });

  it('calls the filter endpoint for format=keep', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ markdown: '## Kanban' }),
    });

    const result = await ES._extract({
      boardId: 'board-1',
      format: 'keep',
    });

    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe('http://localhost:9000/boards/board-1/export/filter');
    expect(result).toBe('## Kanban');
  });

  it('calls the filter endpoint for format=kanban', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ markdown: '## Kanban' }),
    });

    await ES._extract({ boardId: 'b', format: 'kanban' });
    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe('http://localhost:9000/boards/b/export/filter');
  });

  it('returns empty string when API returns no markdown', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });

    const result = await ES._extract({ boardId: 'b', format: 'keep' });
    expect(result).toBe('');
  });

  it('throws when boardId is missing', async () => {
    await expect(ES._extract({ format: 'keep' })).rejects.toThrow('No boardId specified');
  });

  it('throws when backend is not available', async () => {
    mockWindow.LexeraApi.baseUrl = null;
    mockWindow.LexeraApi.discover = vi.fn().mockResolvedValue(null);

    await expect(ES._extract({ boardId: 'b', format: 'keep' })).rejects.toThrow('Backend not available');
  });

  it('throws on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: async () => 'Not Found',
    });

    await expect(ES._extract({ boardId: 'b', format: 'keep' }))
      .rejects.toThrow('Extract failed (404): Not Found');
  });

  it('applies default values for omitted presentation options', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ markdown: 'md' }),
    });

    await ES._extract({ boardId: 'b', format: 'presentation' });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.tagVisibility).toBe('all');
    expect(body.excludeTags).toEqual([]);
    expect(body.stripIncludes).toBe(false);
    expect(body.includeMarpDirectives).toBe(false);
    expect(body.marpTheme).toBeNull();
    expect(body.marpGlobalClasses).toEqual([]);
    expect(body.marpLocalClasses).toEqual([]);
    expect(body.columnIds).toEqual([]);
    expect(body.columnIndexes).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// _output — Phase 3 logic
// ═══════════════════════════════════════════════════════════════════════════

describe('_output', () => {

  it('returns content for copy mode', async () => {
    const result = await ES._output('# Hello', { mode: 'copy' });
    expect(result).toEqual({
      success: true,
      content: '# Hello',
      message: 'Content ready for clipboard',
    });
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('defaults to copy mode when mode is omitted', async () => {
    const result = await ES._output('data', {});
    expect(result.success).toBe(true);
    expect(result.content).toBe('data');
  });

  it('writes markdown file and returns path for save mode without tool runners', async () => {
    mockInvoke.mockResolvedValueOnce(undefined); // write_export_file

    const result = await ES._output('# Content', {
      mode: 'save',
      format: 'keep',
      targetFolder: '/tmp/out',
      exportFolderName: 'my-board',
    });

    expect(mockInvoke).toHaveBeenCalledWith('write_export_file', {
      path: '/tmp/out/my-board/my-board.md',
      content: '# Content',
    });
    expect(result).toMatchObject({
      success: true,
      exportedPath: '/tmp/out/my-board/my-board.md',
      message: 'Markdown file saved',
    });
  });

  it('runs Marp export in save mode when runMarp is true', async () => {
    mockInvoke
      .mockResolvedValueOnce(undefined) // write_export_file
      .mockResolvedValueOnce({          // marp_export
        success: true,
        outputPath: '/out/board/board.pdf',
        message: 'Marp done',
      });

    const result = await ES._output('# Slides', {
      mode: 'save',
      format: 'presentation',
      runMarp: true,
      marpFormat: 'pdf',
      targetFolder: '/out',
      exportFolderName: 'board',
    });

    expect(mockInvoke).toHaveBeenCalledTimes(2);
    expect(mockInvoke.mock.calls[0][0]).toBe('write_export_file');
    expect(mockInvoke.mock.calls[1][0]).toBe('marp_export');
    expect(mockInvoke.mock.calls[1][1].opts.browser).toBe('chrome');
    expect(result.success).toBe(true);
    expect(result.exportedPath).toBe('/out/board/board.pdf');
  });

  it('does not run Marp when marpFormat is markdown', async () => {
    mockInvoke.mockResolvedValueOnce(undefined); // write_export_file

    const result = await ES._output('# Slides', {
      mode: 'save',
      format: 'presentation',
      runMarp: true,
      marpFormat: 'markdown',
      targetFolder: '/out',
      exportFolderName: 'board',
    });

    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockInvoke.mock.calls[0][0]).toBe('write_export_file');
    expect(result.message).toBe('Markdown file saved');
  });

  it('runs Pandoc export in save mode when runPandoc is true', async () => {
    mockInvoke
      .mockResolvedValueOnce(undefined) // write_export_file
      .mockResolvedValueOnce({          // pandoc_export
        success: true,
        outputPath: '/out/doc/doc.docx',
        message: 'Pandoc done',
      });

    const result = await ES._output('# Doc', {
      mode: 'save',
      format: 'document',
      runPandoc: true,
      pandocFormat: 'docx',
      targetFolder: '/out',
      exportFolderName: 'doc',
    });

    expect(mockInvoke).toHaveBeenCalledTimes(2);
    expect(mockInvoke.mock.calls[1][0]).toBe('pandoc_export');
    expect(result.success).toBe(true);
    expect(result.exportedPath).toBe('/out/doc/doc.docx');
  });

  it('rewrites relative links before writing the markdown file', async () => {
    mockInvoke.mockResolvedValueOnce(undefined);

    await ES._output('![Asset](assets/pic.png)', {
      mode: 'save',
      format: 'keep',
      targetFolder: '/out',
      exportFolderName: 'board',
      sourceFilePath: '/src/workspace/board.md',
      linkHandlingMode: 'rewrite-only',
    });

    expect(mockInvoke).toHaveBeenCalledWith('write_export_file', {
      path: '/out/board/board.md',
      content: '![Asset](../../src/workspace/assets/pic.png)',
    });
  });

  it('packs custom-extension-filtered assets into _Rendered/ before writing the markdown file', async () => {
    mockInvoke
      .mockResolvedValueOnce([
        {
          sourcePath: '/src/workspace/assets/pic.png',
          targetPath: '/out/board/_Rendered/pic.png',
          success: true,
          error: null,
        },
      ])
      .mockResolvedValueOnce(undefined);

    await ES._output('![Asset](assets/pic.png)', {
      mode: 'save',
      format: 'keep',
      targetFolder: '/out',
      exportFolderName: 'board',
      sourceFilePath: '/src/workspace/board.md',
      linkHandlingMode: 'pack-linked',
      packAssets: true,
      packOptions: {
        typeMode: 'custom',
        extensions: ['.png'],
        fileSizeLimitMB: 100,
      },
    });

    expect(mockInvoke.mock.calls[0][0]).toBe('copy_export_assets');
    expect(mockInvoke.mock.calls[0][1]).toEqual({
      items: [
        {
          sourcePath: '/src/workspace/assets/pic.png',
          targetPath: '/out/board/_Rendered/pic.png',
          maxBytes: 104857600,
        },
      ],
    });
    expect(mockInvoke.mock.calls[1]).toEqual([
      'write_export_file',
      {
        path: '/out/board/board.md',
        content: '![Asset](_Rendered/pic.png)',
      },
    ]);
  });

  // Helper: compute the expected shared cache path for a rendered embed.
  // The export pipeline now targets the same file the preview cache uses, so
  // tests recompute the expected path via the public ES helpers.
  function expectedCacheTarget(boardFile, sourceAbs, mtimeMs, cacheFolder, extension, suffix) {
    const cacheDir = ES.buildDiagramCacheDir(boardFile, sourceAbs, cacheFolder);
    const fileName = ES.buildDiagramCacheFileName(sourceAbs, mtimeMs, extension, suffix);
    return cacheDir + '/' + fileName;
  }

  it('renders xlsx embeds into the shared preview cache and links to it relatively', async () => {
    const absoluteSource = '/src/workspace/assets/budget.xlsx';
    const mtimeMs = 1_700_000_000_000;
    const cacheAbsolute = expectedCacheTarget(
      '/src/workspace/board.md',
      absoluteSource,
      mtimeMs,
      'xlsx-cache',
      'png',
      '-s2'
    );
    const expectedRelativeLink = ES.relativePath('/out/board', cacheAbsolute);

    mockInvoke.mockImplementation((cmd, args) => {
      if (cmd === 'get_file_mtime_ms') return Promise.resolve(mtimeMs);
      if (cmd === 'render_embedded_file') return Promise.resolve({ success: true, outputPath: args.opts.targetPath, format: 'png', error: null });
      if (cmd === 'write_export_file') return Promise.resolve(undefined);
      return Promise.resolve({ success: true });
    });

    await ES._output('![Budget](assets/budget.xlsx){sheet=2}', {
      mode: 'save',
      format: 'document',
      targetFolder: '/out',
      exportFolderName: 'board',
      sourceFilePath: '/src/workspace/board.md',
      linkHandlingMode: 'rewrite-only',
    });

    const renderCall = mockInvoke.mock.calls.find((c) => c[0] === 'render_embedded_file');
    expect(renderCall).toBeDefined();
    expect(renderCall[1].opts.pluginId).toBe('xlsx');
    expect(renderCall[1].opts.sourcePath).toBe(absoluteSource);
    expect(renderCall[1].opts.targetPath).toBe(cacheAbsolute);
    expect(renderCall[1].opts.pageNumber).toBe(2);
    expect(renderCall[1].opts.outputFormat).toBe('png');

    const writeCall = mockInvoke.mock.calls.find((c) => c[0] === 'write_export_file');
    expect(writeCall).toBeDefined();
    expect(writeCall[1]).toEqual({
      path: '/out/board/board.md',
      content: '![Budget](' + expectedRelativeLink + '){sheet=2}',
    });
  });

  it('renders excalidraw embeds into the shared preview cache and links to it relatively', async () => {
    const absoluteSource = '/src/workspace/assets/sketch.excalidraw.json';
    const mtimeMs = 1_700_000_000_000;
    const cacheAbsolute = expectedCacheTarget(
      '/src/workspace/board.md',
      absoluteSource,
      mtimeMs,
      'excalidraw-cache',
      'svg',
      ''
    );
    const expectedRelativeLink = ES.relativePath('/out/board', cacheAbsolute);

    mockInvoke.mockImplementation((cmd, args) => {
      if (cmd === 'get_file_mtime_ms') return Promise.resolve(mtimeMs);
      if (cmd === 'render_embedded_file') return Promise.resolve({ success: true, outputPath: args.opts.targetPath, format: 'svg', error: null });
      if (cmd === 'write_export_file') return Promise.resolve(undefined);
      return Promise.resolve({ success: true });
    });

    await ES._output('![Sketch](assets/sketch.excalidraw.json)', {
      mode: 'save',
      format: 'presentation',
      targetFolder: '/out',
      exportFolderName: 'board',
      sourceFilePath: '/src/workspace/board.md',
      linkHandlingMode: 'rewrite-only',
    });

    const renderCall = mockInvoke.mock.calls.find((c) => c[0] === 'render_embedded_file');
    expect(renderCall).toBeDefined();
    expect(renderCall[1].opts.pluginId).toBe('excalidraw');
    expect(renderCall[1].opts.targetPath).toBe(cacheAbsolute);

    const writeCall = mockInvoke.mock.calls.find((c) => c[0] === 'write_export_file');
    expect(writeCall).toBeDefined();
    expect(writeCall[1]).toEqual({
      path: '/out/board/board.md',
      content: '![Sketch](' + expectedRelativeLink + ')',
    });
  });

  it('renders csv embeds into the shared preview cache and links to it relatively', async () => {
    const absoluteSource = '/src/workspace/assets/tasks.csv';
    const mtimeMs = 1_700_000_000_000;
    const cacheAbsolute = expectedCacheTarget(
      '/src/workspace/board.md',
      absoluteSource,
      mtimeMs,
      'csv-cache',
      'svg',
      '-p2'
    );
    const expectedRelativeLink = ES.relativePath('/out/board', cacheAbsolute);

    mockInvoke.mockImplementation((cmd, args) => {
      if (cmd === 'get_file_mtime_ms') return Promise.resolve(mtimeMs);
      if (cmd === 'render_embedded_file') return Promise.resolve({ success: true, outputPath: args.opts.targetPath, format: 'svg', error: null });
      if (cmd === 'write_export_file') return Promise.resolve(undefined);
      return Promise.resolve({ success: true });
    });

    await ES._output('![Tasks](assets/tasks.csv){page=2}', {
      mode: 'save',
      format: 'document',
      targetFolder: '/out',
      exportFolderName: 'board',
      sourceFilePath: '/src/workspace/board.md',
      linkHandlingMode: 'rewrite-only',
    });

    const renderCall = mockInvoke.mock.calls.find((c) => c[0] === 'render_embedded_file');
    expect(renderCall).toBeDefined();
    expect(renderCall[1].opts.pluginId).toBe('csv');
    expect(renderCall[1].opts.targetPath).toBe(cacheAbsolute);

    const writeCall = mockInvoke.mock.calls.find((c) => c[0] === 'write_export_file');
    expect(writeCall).toBeDefined();
    expect(writeCall[1]).toEqual({
      path: '/out/board/board.md',
      content: '![Tasks](' + expectedRelativeLink + '){page=2}',
    });
  });

  it('preserves the written markdown when Marp fails (partial-success, no cleanup)', async () => {
    // Contract change (after user feedback): when Marp CLI fails we keep
    // the markdown file so the user can inspect missing includes, fix paths,
    // and re-run Marp manually. The pipeline returns { success:false,
    // exportedPath:<md path> } with an explanatory message.
    mockInvoke.mockImplementation((cmd) => {
      if (cmd === 'write_export_file') return Promise.resolve(undefined);
      if (cmd === 'get_marp_engine_path') return Promise.resolve(null);
      if (cmd === 'marp_export') return Promise.reject(new Error('Marp crashed'));
      return Promise.resolve({ success: true });
    });

    const result = await ES._output('# Slides', {
      mode: 'save',
      format: 'presentation',
      runMarp: true,
      marpFormat: 'pdf',
      targetFolder: '/out',
      exportFolderName: 'board',
    });

    expect(result.success).toBe(false);
    expect(result.exportedPath).toBe('/out/board/board.md');
    expect(result.message).toContain('Marp export failed');
    expect(result.message).toContain('/out/board/board.md');
    // The outer cleanup block must NOT have fired — keep the .md.
    const cleanupCall = mockInvoke.mock.calls.find(c => c[0] === 'remove_export_files');
    expect(cleanupCall).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// export — full pipeline orchestration
// ═══════════════════════════════════════════════════════════════════════════

describe('export (full pipeline)', () => {

  it('returns success with content in copy mode', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ markdown: '# Exported' }),
    });

    const result = await ES.export({
      boardId: 'b1',
      format: 'keep',
      mode: 'copy',
    });

    expect(result.success).toBe(true);
    expect(result.content).toBe('# Exported');
    expect(result.message).toBe('Content ready for clipboard');
  });

  it('returns failure when extract returns no content', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ markdown: '' }),
    });

    const result = await ES.export({
      boardId: 'b1',
      format: 'keep',
      mode: 'copy',
    });

    expect(result.success).toBe(false);
    expect(result.message).toBe('Phase 1 (Extract) returned no content');
  });

  it('catches errors and returns failure', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const result = await ES.export({
      boardId: 'b1',
      format: 'keep',
      mode: 'copy',
    });

    expect(result.success).toBe(false);
    expect(result.message).toBe('Network error');
  });

  it('runs all 3 phases for presentation save with Marp', async () => {
    // Phase 1 — extract
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ markdown: '---\nmarp: true\n---\n# Slide' }),
    });

    // Phase 2 — transform (non-default speakerNoteMode triggers REST call)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ content: '---\nmarp: true\n---\n# Slide (transformed)' }),
    });

    // Phase 3 — output
    mockInvoke
      .mockResolvedValueOnce(undefined) // write_export_file
      .mockResolvedValueOnce({          // marp_export
        success: true,
        outputPath: '/out/pres/pres.pdf',
        message: 'Done',
      });

    const result = await ES.export({
      boardId: 'b1',
      format: 'presentation',
      mode: 'save',
      speakerNoteMode: 'remove',
      runMarp: true,
      marpFormat: 'pdf',
      targetFolder: '/out',
      exportFolderName: 'pres',
    });

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockInvoke).toHaveBeenCalledTimes(2);
    expect(result.success).toBe(true);
    expect(result.exportedPath).toBe('/out/pres/pres.pdf');
  });

  it('skips Phase 2 for document format', async () => {
    // Phase 1 — extract
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ markdown: '# Doc' }),
    });

    // Phase 3 — output (copy mode, no Tauri calls)
    const result = await ES.export({
      boardId: 'b1',
      format: 'document',
      mode: 'copy',
    });

    // Only 1 fetch call (extract), no transform call
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
    expect(result.content).toBe('# Doc');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Tauri-delegating public methods — verify invocation arguments
// ═══════════════════════════════════════════════════════════════════════════

describe('checkMarpStatus', () => {
  it('invokes check_marp_available and returns result', async () => {
    mockInvoke.mockResolvedValueOnce({ available: true, version: '3.4.0' });
    const result = await ES.checkMarpStatus();
    expect(mockInvoke).toHaveBeenCalledWith('check_marp_available');
    expect(result).toEqual({ available: true, version: '3.4.0' });
  });

  it('returns null version when not provided', async () => {
    mockInvoke.mockResolvedValueOnce({ available: false });
    const result = await ES.checkMarpStatus();
    expect(result).toEqual({ available: false, version: null });
  });
});

describe('checkPandocStatus', () => {
  it('invokes check_pandoc_available and returns result', async () => {
    mockInvoke.mockResolvedValueOnce({ available: true, version: '3.1' });
    const result = await ES.checkPandocStatus();
    expect(mockInvoke).toHaveBeenCalledWith('check_pandoc_available');
    expect(result).toEqual({ available: true, version: '3.1' });
  });
});

describe('getMarpThemes', () => {
  it('invokes discover_marp_themes with provided dirs', async () => {
    const themes = [{ name: 'gaia', path: '/themes/gaia.css', builtin: true }];
    mockInvoke.mockResolvedValueOnce(themes);
    const result = await ES.getMarpThemes(['/themes']);
    expect(mockInvoke).toHaveBeenCalledWith('discover_marp_themes', { dirs: ['/themes'] });
    expect(result).toEqual(themes);
  });

  it('passes empty array when dirs is null', async () => {
    mockInvoke.mockResolvedValueOnce([]);
    await ES.getMarpThemes(null);
    expect(mockInvoke).toHaveBeenCalledWith('discover_marp_themes', { dirs: [] });
  });
});

describe('getMarpClasses', () => {
  it('invokes discover_marp_classes with provided dirs', async () => {
    mockInvoke.mockResolvedValueOnce(['lead', 'invert', 'deck']);
    const result = await ES.getMarpClasses(['/themes']);
    expect(mockInvoke).toHaveBeenCalledWith('discover_marp_classes', { dirs: ['/themes'] });
    expect(result).toEqual(['lead', 'invert', 'deck']);
  });

  it('passes empty array when dirs is null', async () => {
    mockInvoke.mockResolvedValueOnce([]);
    await ES.getMarpClasses(null);
    expect(mockInvoke).toHaveBeenCalledWith('discover_marp_classes', { dirs: [] });
  });
});

describe('stopAllWatches', () => {
  it('invokes marp_stop_all_watches', async () => {
    mockInvoke.mockResolvedValueOnce(3);
    const result = await ES.stopAllWatches();
    expect(mockInvoke).toHaveBeenCalledWith('marp_stop_all_watches');
    expect(result).toBe(3);
  });
});

describe('openExportFolder', () => {
  it('invokes open_export_folder with path', async () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    await ES.openExportFolder('/some/path');
    expect(mockInvoke).toHaveBeenCalledWith('open_export_folder', { path: '/some/path' });
  });
});
