import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { loadIIFE } from './load-iife.js';

const mockInvoke = vi.fn();
const mockFetch = vi.fn();
const mockLexeraLog = vi.fn();

const mockWindow = {
  __TAURI__: { core: { invoke: mockInvoke } },
  LexeraApi: { baseUrl: 'http://localhost:9000', discover: vi.fn() },
  LexeraFileFormatRegistry: null,
};

let ExportService;

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
  ExportService = loadIIFE('export/exportService.js', 'ExportService', {
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

describe('ExportService abort semantics', () => {
  it('_wasAborted returns true when signal.aborted is true', () => {
    const controller = new AbortController();
    expect(ExportService._wasAborted({ signal: controller.signal })).toBe(false);
    controller.abort();
    expect(ExportService._wasAborted({ signal: controller.signal })).toBe(true);
  });

  it('export() short-circuits with aborted=true if signal already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await ExportService.export({
      signal: controller.signal,
      boardId: 'b1',
      format: 'keep',
      mode: 'save',
    });
    expect(result.success).toBe(false);
    expect(result.aborted).toBe(true);
    expect(result.message).toBe('Export cancelled');
    // The pipeline must not have called fetch or Tauri if it short-circuited.
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('export() catches AbortError from fetch and reports aborted=true', async () => {
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    mockFetch.mockRejectedValue(abortError);
    const controller = new AbortController();
    const result = await ExportService.export({
      signal: controller.signal,
      boardId: 'b1',
      format: 'keep',
      mode: 'save',
    });
    expect(result.success).toBe(false);
    expect(result.aborted).toBe(true);
  });

  it('_output throws AbortError between phases and cleanup runs', async () => {
    const controller = new AbortController();
    const options = {
      mode: 'save',
      format: 'presentation',
      targetFolder: '/tmp/out',
      exportFolderName: 'pres',
      runMarp: true,
      marpFormat: 'pdf',
      signal: controller.signal,
    };

    // Abort during write_export_file so the next throwIfAborted() checkpoint fires.
    mockInvoke.mockImplementation((cmd) => {
      if (cmd === 'write_export_file') {
        controller.abort();
        return Promise.resolve(undefined);
      }
      if (cmd === 'get_marp_engine_path') return Promise.resolve(null);
      if (cmd === 'remove_export_files') return Promise.resolve(undefined);
      return Promise.resolve({ success: true, outputPath: '/fake.pdf' });
    });

    const result = await ExportService._output('# Slides', options).catch((e) => e);
    expect(result).toBeInstanceOf(Error);
    expect(result.name).toBe('AbortError');
    // Cleanup must have been invoked to remove the markdown file we just wrote.
    const cleanup = mockInvoke.mock.calls.find((c) => c[0] === 'remove_export_files');
    expect(cleanup).toBeDefined();
    expect(cleanup[1].paths).toContain('/tmp/out/pres/pres.md');
    // marp_export must NOT have run — the abort checkpoint should have caught it.
    const marpCall = mockInvoke.mock.calls.find((c) => c[0] === 'marp_export');
    expect(marpCall).toBeUndefined();
  });
});
