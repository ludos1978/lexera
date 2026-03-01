import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { loadIIFE } from './load-iife.js';

// ── Bootstrap ──────────────────────────────────────────────────────────────

let ES; // ExportService class

const mockInvoke = vi.fn();
const mockFetch = vi.fn();

const mockWindow = {
  __TAURI__: { core: { invoke: mockInvoke } },
  LexeraApi: { baseUrl: 'http://localhost:9000', discover: vi.fn() },
  ExportService: null, // will be assigned by the source file
};

const mockLexeraLog = vi.fn();

beforeAll(() => {
  ES = loadIIFE('export/exportService.js', 'ExportService', {
    window: mockWindow,
    fetch: mockFetch,
    console: globalThis.console,
    lexeraLog: mockLexeraLog,
  });
});

beforeEach(() => {
  vi.clearAllMocks();
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
    expect(result).toEqual({
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

  it('starts Marp watch in preview mode', async () => {
    mockInvoke
      .mockResolvedValueOnce(undefined) // write_export_file
      .mockResolvedValueOnce({          // marp_watch
        success: true,
        message: 'Watching',
      });

    const result = await ES._output('# Slides', {
      mode: 'preview',
      format: 'presentation',
      targetFolder: '/out',
      exportFolderName: 'pres',
    });

    expect(mockInvoke).toHaveBeenCalledTimes(2);
    expect(mockInvoke.mock.calls[1][0]).toBe('marp_watch');
    expect(result.success).toBe(true);
    expect(result.exportedPath).toBe('/out/pres/pres.md');
  });

  it('cleans up files on failure during save', async () => {
    mockInvoke
      .mockResolvedValueOnce(undefined) // write_export_file succeeds
      .mockRejectedValueOnce(new Error('Marp crashed')); // marp_export fails

    // cleanup invoke
    mockInvoke.mockResolvedValueOnce(undefined); // remove_export_files

    await expect(ES._output('# Slides', {
      mode: 'save',
      format: 'presentation',
      runMarp: true,
      marpFormat: 'pdf',
      targetFolder: '/out',
      exportFolderName: 'board',
    })).rejects.toThrow('Marp crashed');

    // Verify cleanup was attempted
    const cleanupCall = mockInvoke.mock.calls.find(c => c[0] === 'remove_export_files');
    expect(cleanupCall).toBeTruthy();
    expect(cleanupCall[1].paths).toContain('/out/board/board.md');
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
