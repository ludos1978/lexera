import { describe, it, expect } from 'vitest';
import { loadIIFE } from './load-iife.js';

function loadFormat(formatFile) {
  const Registry = loadIIFE(
    [
      'plugins/pluginRegistry.js',
      'plugins/formats/fileFormatHelpers.js',
      `plugins/formats/${formatFile}`,
    ],
    'LexeraPluginRegistry',
    {}
  );
  const all = Registry.getByKind('fileFormat');
  if (all.length !== 1) {
    throw new Error(`expected exactly 1 plugin from ${formatFile}, got ${all.length}`);
  }
  return { Registry, plugin: all[0] };
}

function expectValidManifest(plugin, id, name) {
  expect(plugin.kind).toBe('fileFormat');
  expect(plugin.metadata).toBeDefined();
  expect(plugin.metadata.id).toBe(id);
  expect(plugin.metadata.name).toBe(name);
  expect(typeof plugin.metadata.version).toBe('string');
  expect(plugin.metadata.version.length).toBeGreaterThan(0);
  expect(typeof plugin.matches).toBe('function');
  // The registry validated successfully — extra sanity: id mirrored at top level
  // is fine because the facade reads it, but metadata.id is authoritative.
}

describe('drawio format manifest', () => {
  const { plugin } = loadFormat('drawio.js');

  it('has a valid v2 manifest with id drawio', () => {
    expectValidManifest(plugin, 'drawio', 'Draw.io file');
    expect(plugin.label).toBe('Draw.io file');
    expect(plugin.assetType).toBe('diagram');
    expect(plugin.editorKind).toBe('drawio');
  });

  it('matches .drawio and .dio extensions and rejects others', () => {
    expect(plugin.matches('diagram.drawio')).toBe(true);
    expect(plugin.matches('diagram.dio')).toBe(true);
    expect(plugin.matches('diagram.png')).toBe(false);
    expect(plugin.matches('diagram.excalidraw')).toBe(false);
  });

  it('declares drawio as the sole renderer requirement', () => {
    expect(plugin.rendererRequirements).toEqual([{ id: 'drawio' }]);
  });

  it('previews to png but exports to svg', () => {
    expect(plugin.preview.kind).toBe('diagram');
    expect(plugin.preview.cacheFolderName).toBe('drawio-cache');
    expect(plugin.preview.outputExtension).toBe('png');
    expect(plugin.export.outputExtension).toBe('svg');
    expect(plugin.export.outputFormat).toBe('svg');
  });
});

describe('excalidraw format manifest', () => {
  const { plugin } = loadFormat('excalidraw.js');

  it('has a valid v2 manifest', () => {
    expectValidManifest(plugin, 'excalidraw', 'Excalidraw file');
    expect(plugin.assetType).toBe('diagram');
    expect(plugin.editorKind).toBe('excalidraw');
  });

  it('matches .excalidraw, .excalidraw.json, and .excalidraw.svg', () => {
    expect(plugin.matches('d.excalidraw')).toBe(true);
    expect(plugin.matches('d.excalidraw.json')).toBe(true);
    expect(plugin.matches('d.excalidraw.svg')).toBe(true);
    expect(plugin.matches('d.drawio')).toBe(false);
  });

  it('declares node + excalidraw-assets as renderer requirements', () => {
    expect(plugin.rendererRequirements).toEqual([{ id: 'node' }, { id: 'excalidraw-assets' }]);
  });

  it('previews and exports as SVG', () => {
    expect(plugin.preview.outputExtension).toBe('svg');
    expect(plugin.export.outputExtension).toBe('svg');
  });
});

describe('xlsx format manifest', () => {
  const { plugin } = loadFormat('xlsx.js');

  it('has a valid v2 manifest', () => {
    expectValidManifest(plugin, 'xlsx', 'Spreadsheet file');
    expect(plugin.assetType).toBe('document');
  });

  it('matches xlsx, xls, and ods (case-insensitive normalized path)', () => {
    expect(plugin.matches('budget.xlsx')).toBe(true);
    expect(plugin.matches('budget.xls')).toBe(true);
    expect(plugin.matches('budget.ods')).toBe(true);
    expect(plugin.matches('budget.csv')).toBe(false);
  });

  it('requires soffice (LibreOffice) only', () => {
    expect(plugin.rendererRequirements).toEqual([{ id: 'soffice' }]);
  });

  it('uses a sheet-suffix (-s) in preview and export configs', () => {
    expect(plugin.preview.kind).toBe('spreadsheet');
    expect(plugin.preview.buildSuffix(3)).toBe('-s3');
    expect(plugin.export.buildSuffix(2)).toBe('-s2');
  });
});

describe('csv format manifest', () => {
  const { plugin } = loadFormat('csv.js');

  it('has a valid v2 manifest', () => {
    expectValidManifest(plugin, 'csv', 'CSV table');
    expect(plugin.editorKind).toBe('plaintext');
  });

  it('matches only .csv', () => {
    expect(plugin.matches('data.csv')).toBe(true);
    expect(plugin.matches('data.tsv')).toBe(false);
    expect(plugin.matches('data.tab')).toBe(false);
  });

  it('declares the csv-builtin renderer as available with full metadata', () => {
    expect(plugin.rendererRequirements).toEqual([{
      id: 'csv-builtin',
      label: 'Built-in CSV Renderer',
      available: true,
      version: null,
      path: null,
      details: 'No external CLI is required for CSV/TSV table rendering.'
    }]);
  });

  it('renders as an SVG table (-p suffix)', () => {
    expect(plugin.preview.kind).toBe('table');
    expect(plugin.preview.buildSuffix(2)).toBe('-p2');
    expect(plugin.export.outputExtension).toBe('svg');
  });
});

describe('tsv format manifest', () => {
  const { plugin } = loadFormat('tsv.js');

  it('has a valid v2 manifest', () => {
    expectValidManifest(plugin, 'tsv', 'TSV table');
  });

  it('matches .tsv and .tab but not .csv', () => {
    expect(plugin.matches('data.tsv')).toBe(true);
    expect(plugin.matches('data.tab')).toBe(true);
    expect(plugin.matches('data.csv')).toBe(false);
  });

  it('shares the csv-builtin renderer declaration', () => {
    expect(plugin.rendererRequirements[0].id).toBe('csv-builtin');
    expect(plugin.rendererRequirements[0].available).toBe(true);
  });
});

describe('pdf format manifest', () => {
  const { plugin } = loadFormat('pdf.js');

  it('has a valid v2 manifest', () => {
    expectValidManifest(plugin, 'pdf', 'PDF file');
    expect(plugin.assetType).toBe('document');
  });

  it('matches only .pdf', () => {
    expect(plugin.matches('file.pdf')).toBe(true);
    expect(plugin.matches('file.pdf.bak')).toBe(false);
    expect(plugin.matches('file.epub')).toBe(false);
  });

  it('requires pdftoppm', () => {
    expect(plugin.rendererRequirements).toEqual([{ id: 'pdftoppm' }]);
  });

  it('uses the built-in viewer (supportsRuntimeRender=false) and exports to PNG pages', () => {
    expect(plugin.preview.kind).toBe('pdf');
    expect(plugin.preview.supportsRuntimeRender).toBe(false);
    expect(plugin.export.outputExtension).toBe('png');
    expect(plugin.export.buildSuffix(5)).toBe('-p5');
  });
});

describe('pptx format manifest', () => {
  const { plugin } = loadFormat('pptx.js');

  it('has a valid v2 manifest', () => {
    expectValidManifest(plugin, 'pptx', 'Presentation file');
  });

  it('matches .ppt, .pptx, and .odp', () => {
    expect(plugin.matches('deck.pptx')).toBe(true);
    expect(plugin.matches('deck.ppt')).toBe(true);
    expect(plugin.matches('deck.odp')).toBe(true);
    expect(plugin.matches('deck.pdf')).toBe(false);
  });

  it('requires soffice + pdftoppm', () => {
    expect(plugin.rendererRequirements).toEqual([{ id: 'soffice' }, { id: 'pdftoppm' }]);
  });

  it('uses the document preview kind', () => {
    expect(plugin.preview.kind).toBe('document');
  });
});

describe('document format manifest', () => {
  const { plugin } = loadFormat('document.js');

  it('has a valid v2 manifest', () => {
    expectValidManifest(plugin, 'document', 'Document file');
  });

  it('matches doc, docx, odt, and rtf', () => {
    expect(plugin.matches('report.doc')).toBe(true);
    expect(plugin.matches('report.docx')).toBe(true);
    expect(plugin.matches('report.odt')).toBe(true);
    expect(plugin.matches('report.rtf')).toBe(true);
    expect(plugin.matches('report.txt')).toBe(false);
    expect(plugin.matches('report.pdf')).toBe(false);
  });

  it('requires soffice + pdftoppm', () => {
    expect(plugin.rendererRequirements).toEqual([{ id: 'soffice' }, { id: 'pdftoppm' }]);
  });
});

describe('epub format manifest', () => {
  const { plugin } = loadFormat('epub.js');

  it('has a valid v2 manifest', () => {
    expectValidManifest(plugin, 'epub', 'EPUB file');
  });

  it('matches only .epub', () => {
    expect(plugin.matches('book.epub')).toBe(true);
    expect(plugin.matches('book.pdf')).toBe(false);
  });

  it('requires mutool (MuPDF)', () => {
    expect(plugin.rendererRequirements).toEqual([{ id: 'mutool' }]);
  });

  it('uses the epub preview kind', () => {
    expect(plugin.preview.kind).toBe('epub');
  });
});

describe('plaintext format manifest', () => {
  const { plugin } = loadFormat('plaintext.js');

  it('has a valid v2 manifest', () => {
    expectValidManifest(plugin, 'plaintext', 'Text file');
    expect(plugin.editorKind).toBe('plaintext');
  });

  it('matches common text/config extensions', () => {
    expect(plugin.matches('readme.txt')).toBe(true);
    expect(plugin.matches('notes.text')).toBe(true);
    expect(plugin.matches('server.log')).toBe(true);
    expect(plugin.matches('settings.cfg')).toBe(true);
    expect(plugin.matches('app.ini')).toBe(true);
    expect(plugin.matches('server.conf')).toBe(true);
    expect(plugin.matches('data.csv')).toBe(false);
    expect(plugin.matches('notes.md')).toBe(false);
  });

  it('uses the text preview kind', () => {
    expect(plugin.preview.kind).toBe('text');
    expect(plugin.preview.outputExtension).toBe('svg');
  });
});

describe('format manifest render capability', () => {
  // Build a mock Tauri invoke channel + load the export-side helper so plugin
  // renderFile() resolves to a real dispatch.
  function loadWithInvoke() {
    const invoke = (cmd, args) => Promise.resolve({ cmd, args, success: true });
    const fakeWindow = { __TAURI__: { core: { invoke } }, LexeraBackendDiscovery: null };
    const Registry = loadIIFE(
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
      ],
      'LexeraPluginRegistry',
      { window: fakeWindow }
    );
    return { Registry, fakeWindow };
  }

  it('every format plugin exposes canRenderFile() and renderFile()', () => {
    const { Registry } = loadWithInvoke();
    const plugins = Registry.getByKind('fileFormat');
    for (const p of plugins) {
      expect(typeof p.canRenderFile).toBe('function');
      expect(typeof p.renderFile).toBe('function');
    }
  });

  it('canRenderFile mirrors the matches() path predicate', () => {
    const { Registry } = loadWithInvoke();
    const drawio = Registry.getById('fileFormat', 'drawio');
    expect(drawio.canRenderFile('/some/diagram.drawio')).toBe(true);
    expect(drawio.canRenderFile('/some/diagram.pdf')).toBe(false);
  });

  it('renderFile dispatches render_embedded_file with the plugin id', async () => {
    const calls = [];
    const invoke = (cmd, args) => { calls.push({ cmd, args }); return Promise.resolve({ success: true }); };
    const fakeWindow = { __TAURI__: { core: { invoke } } };
    const Registry = loadIIFE(
      [
        'plugins/pluginRegistry.js',
        'plugins/exports/tauriInvoke.js',
        'plugins/formats/fileFormatHelpers.js',
        'plugins/formats/xlsx.js',
      ],
      'LexeraPluginRegistry',
      { window: fakeWindow }
    );
    const xlsx = Registry.getById('fileFormat', 'xlsx');
    await xlsx.renderFile({ sourcePath: '/abs/book.xlsx', targetPath: '/out/book.png', pageNumber: 2, outputFormat: 'png' });
    expect(calls.length).toBe(1);
    expect(calls[0].cmd).toBe('render_embedded_file');
    expect(calls[0].args.opts).toEqual({
      pluginId: 'xlsx',
      sourcePath: '/abs/book.xlsx',
      targetPath: '/out/book.png',
      pageNumber: 2,
      outputFormat: 'png'
    });
  });

  it('renderFile normalizes missing pageNumber to 1 and defaults outputFormat to png', async () => {
    const calls = [];
    const invoke = (cmd, args) => { calls.push({ cmd, args }); return Promise.resolve({ success: true }); };
    const fakeWindow = { __TAURI__: { core: { invoke } } };
    const Registry = loadIIFE(
      [
        'plugins/pluginRegistry.js',
        'plugins/exports/tauriInvoke.js',
        'plugins/formats/fileFormatHelpers.js',
        'plugins/formats/drawio.js',
      ],
      'LexeraPluginRegistry',
      { window: fakeWindow }
    );
    const drawio = Registry.getById('fileFormat', 'drawio');
    await drawio.renderFile({ sourcePath: '/a/d.drawio', targetPath: '/b/d.png' });
    expect(calls[0].args.opts.pageNumber).toBe(1);
    expect(calls[0].args.opts.outputFormat).toBe('png');
  });

  it('renderFile rejects when sourcePath or targetPath is missing', async () => {
    const { Registry } = loadWithInvoke();
    const drawio = Registry.getById('fileFormat', 'drawio');
    await expect(drawio.renderFile({})).rejects.toThrow(/sourcePath and targetPath required/);
    await expect(drawio.renderFile({ sourcePath: '/a' })).rejects.toThrow(/sourcePath and targetPath required/);
  });

  it('renderFile rejects when the invoker is unavailable', async () => {
    const Registry = loadIIFE(
      [
        'plugins/pluginRegistry.js',
        // intentionally NOT loading plugins/exports/tauriInvoke.js
        'plugins/formats/fileFormatHelpers.js',
        'plugins/formats/drawio.js',
      ],
      'LexeraPluginRegistry',
      { window: {} }
    );
    const drawio = Registry.getById('fileFormat', 'drawio');
    await expect(drawio.renderFile({ sourcePath: '/a', targetPath: '/b' })).rejects.toThrow(/LexeraExportTauriInvoke unavailable/);
  });
});

describe('format manifest registry consistency', () => {
  it('all 10 format files pass registry validation when loaded together', () => {
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
      ],
      'LexeraPluginRegistry',
      {}
    );
    const plugins = Registry.getByKind('fileFormat');
    const ids = plugins.map(p => p.metadata.id).sort();
    expect(ids).toEqual(['csv', 'document', 'drawio', 'epub', 'excalidraw', 'pdf', 'plaintext', 'pptx', 'tsv', 'xlsx']);
    // No two formats share an id
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('no two formats claim the same extension', () => {
    // This test guards against silent overlap that would let the first matcher
    // win and hide regressions in the other plugin.
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
      ],
      'LexeraPluginRegistry',
      {}
    );
    const plugins = Registry.getByKind('fileFormat');
    const probes = [
      'a.drawio', 'a.dio', 'a.excalidraw', 'a.excalidraw.json',
      'a.xlsx', 'a.xls', 'a.ods',
      'a.csv', 'a.tsv', 'a.tab',
      'a.pdf', 'a.pptx', 'a.ppt', 'a.odp',
      'a.doc', 'a.docx', 'a.odt', 'a.rtf',
      'a.epub',
      'a.txt', 'a.text', 'a.log', 'a.cfg', 'a.ini', 'a.conf'
    ];
    for (const probe of probes) {
      const matching = plugins.filter(p => p.matches(probe));
      expect(matching.length, `${probe} matched by ${matching.map(p => p.metadata.id).join(', ')}`).toBe(1);
    }
  });
});
