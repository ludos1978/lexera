import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { loadIIFE } from './load-iife.js';

// ─────────────────────────────────────────────────────────────────────────────
// ExportService — plugin dispatch path assertions.
//
// This file is separate from exportService.test.js because loading the Marp
// and Pandoc export plugins flips several Marp-related methods onto the
// plugin-delegation path (plugin.checkStatus → invoke → __TAURI__.core →
// mockInvoke), changing the shape of mockInvoke calls in ways that diverge
// from the existing direct-invoke assertions. The existing tests verify the
// fallback path; this file verifies the plugin-preferred path.
//
// NOT YET COVERED (see plan): app.js:init() integration (loadBuiltins,
// installFromRegistry, registry.activate) — needs a DOM bootstrap harness.
// ─────────────────────────────────────────────────────────────────────────────

let ES;
let PluginRegistry;
let mockInvoke;
let mockFetch;
let mockWindow;

beforeAll(() => {
  mockInvoke = vi.fn().mockResolvedValue({ success: true });
  mockFetch = vi.fn();
  mockWindow = {
    __TAURI__: { core: { invoke: mockInvoke } },
    LexeraApi: { baseUrl: 'http://localhost:9000', discover: vi.fn() },
    ExportService: null,
  };

  // Load the full plugin chain INCLUDING marpExport.js and pandocExport.js so
  // ExportService._getMarpPlugin()/_getPandocPlugin() can resolve them and
  // delegate. The named global we return here is irrelevant — we reach into
  // mockWindow to pick up both LexeraFileFormatRegistry and LexeraPluginRegistry
  // after the load.
  loadIIFE(
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
      'plugins/exports/marpExport.js',
      'plugins/exports/pandocExport.js',
    ],
    'LexeraFileFormatRegistry',
    { window: mockWindow, URL }
  );
  PluginRegistry = mockWindow.LexeraPluginRegistry;
  if (!PluginRegistry) {
    throw new Error('bootstrap failed: LexeraPluginRegistry not on mockWindow');
  }

  ES = loadIIFE('export/exportService.js', 'ExportService', {
    window: mockWindow,
    fetch: mockFetch,
    console: globalThis.console,
    lexeraLog: vi.fn(),
  });
});

beforeEach(() => {
  mockInvoke.mockReset();
  mockInvoke.mockResolvedValue({ available: true, version: '1.0', success: true });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('ExportService — dispatches through Marp plugin', () => {
  it('checkMarpStatus goes through the registered Marp plugin', async () => {
    const marp = PluginRegistry.getById('export', 'marp');
    expect(marp).toBeTruthy();
    const spy = vi.spyOn(marp, 'checkStatus');
    const result = await ES.checkMarpStatus();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(result).toHaveProperty('available');
    expect(mockInvoke).toHaveBeenCalled();
    expect(mockInvoke.mock.calls[0][0]).toBe('check_marp_available');
    spy.mockRestore();
  });

  it('stopAllWatches goes through the registered Marp plugin', async () => {
    const marp = PluginRegistry.getById('export', 'marp');
    const spy = vi.spyOn(marp, 'stopAllWatches');
    await ES.stopAllWatches();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(mockInvoke.mock.calls[0][0]).toBe('marp_stop_all_watches');
    spy.mockRestore();
  });

  it('getMarpThemes goes through the registered Marp plugin', async () => {
    const marp = PluginRegistry.getById('export', 'marp');
    const spy = vi.spyOn(marp, 'getThemes');
    await ES.getMarpThemes(['/custom/theme/dir']);
    expect(spy).toHaveBeenCalledWith(['/custom/theme/dir']);
    expect(mockInvoke.mock.calls[0][0]).toBe('discover_marp_themes');
    spy.mockRestore();
  });
});

describe('ExportService — dispatches through Pandoc plugin', () => {
  it('checkPandocStatus goes through the registered Pandoc plugin', async () => {
    const pandoc = PluginRegistry.getById('export', 'pandoc');
    expect(pandoc).toBeTruthy();
    const spy = vi.spyOn(pandoc, 'checkStatus');
    const result = await ES.checkPandocStatus();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(result).toHaveProperty('available');
    expect(mockInvoke).toHaveBeenCalled();
    expect(mockInvoke.mock.calls[0][0]).toBe('check_pandoc_available');
    spy.mockRestore();
  });
});

describe('ExportService — renderFileEmbedsForExport prefers plugin.renderFile', () => {
  it('calls drawio plugin renderFile with the plain contract (not the {opts} wrapper)', async () => {
    // Build a markdown input with a single drawio embed.
    const input = '# Slide\n\n![diagram](assets/flow.drawio)\n';
    const sourceFile = '/absolute/source/board.md';
    const exportDir = '/absolute/export';
    const fileBasename = 'board';

    // Spy on the underlying drawio plugin's renderFile BEFORE the facade
    // projects it. projectPlugin() does plugin.renderFile.bind(plugin) inside
    // LexeraFileFormatRegistry.getById('drawio'), so mutating the underlying
    // method here changes what the projection wraps.
    const drawio = PluginRegistry.getById('fileFormat', 'drawio');
    const spy = vi.spyOn(drawio, 'renderFile').mockResolvedValue({ success: true });

    const result = await ES.renderFileEmbedsForExport(input, sourceFile, exportDir, fileBasename);

    expect(spy).toHaveBeenCalled();
    const [args] = spy.mock.calls[0];
    // The plugin contract uses a flat object; the old direct-invoke wrapper
    // shape { opts: {...} } would have been { opts: { pluginId, ... } }.
    expect(args).toHaveProperty('sourcePath');
    expect(args).toHaveProperty('targetPath');
    expect(args).toHaveProperty('pageNumber');
    expect(args).toHaveProperty('outputFormat');
    expect(args).not.toHaveProperty('opts');
    expect(typeof args.sourcePath).toBe('string');
    expect(args.sourcePath.toLowerCase()).toContain('flow.drawio');

    // The transformed content should reference the rendered target path.
    expect(result).toHaveProperty('content');
    expect(result).toHaveProperty('createdFiles');
    spy.mockRestore();
  });
});
