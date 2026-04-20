import { describe, it, expect, beforeEach } from 'vitest';
import { loadIIFE } from './load-iife.js';

let H;

beforeEach(() => {
  H = loadIIFE('plugins/formats/fileFormatHelpers.js', 'LexeraFileFormatHelpers', {});
});

describe('LexeraFileFormatHelpers.normalizePageNumber', () => {
  it('returns the parsed integer for positive numeric input', () => {
    expect(H.normalizePageNumber(1)).toBe(1);
    expect(H.normalizePageNumber(7)).toBe(7);
    expect(H.normalizePageNumber(42)).toBe(42);
  });

  it('parses positive numeric strings', () => {
    expect(H.normalizePageNumber('3')).toBe(3);
    expect(H.normalizePageNumber('  12  ')).toBe(12);
  });

  it('falls back to 1 for zero, negatives, or non-numeric input', () => {
    expect(H.normalizePageNumber(0)).toBe(1);
    expect(H.normalizePageNumber(-5)).toBe(1);
    expect(H.normalizePageNumber(NaN)).toBe(1);
    expect(H.normalizePageNumber('abc')).toBe(1);
    expect(H.normalizePageNumber(undefined)).toBe(1);
    expect(H.normalizePageNumber(null)).toBe(1);
  });
});

describe('LexeraFileFormatHelpers.pageSuffix', () => {
  it('returns a function that emits prefix + normalized page number', () => {
    const suffix = H.pageSuffix('-p');
    expect(typeof suffix).toBe('function');
    expect(suffix(1)).toBe('-p1');
    expect(suffix(3)).toBe('-p3');
  });

  it('normalizes bad input to page 1', () => {
    const suffix = H.pageSuffix('-s');
    expect(suffix(0)).toBe('-s1');
    expect(suffix(-4)).toBe('-s1');
    expect(suffix(undefined)).toBe('-s1');
    expect(suffix('x')).toBe('-s1');
  });

  it('supports arbitrary prefixes', () => {
    expect(H.pageSuffix('')(2)).toBe('2');
    expect(H.pageSuffix('-page-')(5)).toBe('-page-5');
  });
});

describe('LexeraFileFormatHelpers.buildPreviewConfig', () => {
  it('fills every documented field and defaults supportsRuntimeRender to true', () => {
    const cfg = H.buildPreviewConfig('diagram', 'drawio-cache', 'png', 'png');
    expect(cfg.kind).toBe('diagram');
    expect(cfg.cacheFolderName).toBe('drawio-cache');
    expect(cfg.outputExtension).toBe('png');
    expect(cfg.outputFormat).toBe('png');
    expect(cfg.supportsRuntimeRender).toBe(true);
    expect(typeof cfg.buildSuffix).toBe('function');
  });

  it('defaults buildSuffix to a no-op when none supplied', () => {
    const cfg = H.buildPreviewConfig('diagram', 'c', 'png', 'png');
    expect(cfg.buildSuffix()).toBe('');
    expect(cfg.buildSuffix(5)).toBe('');
  });

  it('accepts a custom suffix builder and passes the page number through', () => {
    const cfg = H.buildPreviewConfig('table', 'csv-cache', 'svg', 'svg', H.pageSuffix('-p'));
    expect(cfg.buildSuffix(2)).toBe('-p2');
  });

  it('lets outputFormat differ from outputExtension', () => {
    const cfg = H.buildPreviewConfig('diagram', 'c', 'png', 'webp');
    expect(cfg.outputExtension).toBe('png');
    expect(cfg.outputFormat).toBe('webp');
  });
});

describe('LexeraFileFormatHelpers.buildExportConfig', () => {
  it('produces an export-shaped object with the expected defaults', () => {
    const cfg = H.buildExportConfig('svg', 'svg');
    expect(cfg.outputExtension).toBe('svg');
    expect(cfg.outputFormat).toBe('svg');
    expect(cfg.supportsRuntimeRender).toBe(true);
    expect(typeof cfg.buildSuffix).toBe('function');
    expect(cfg.buildSuffix()).toBe('');
  });

  it('threads a custom buildSuffix through', () => {
    const cfg = H.buildExportConfig('png', 'png', H.pageSuffix('-s'));
    expect(cfg.buildSuffix(4)).toBe('-s4');
  });

  it('omits `kind` and `cacheFolderName` — these belong only to preview configs', () => {
    const cfg = H.buildExportConfig('png', 'png');
    expect('kind' in cfg).toBe(false);
    expect('cacheFolderName' in cfg).toBe(false);
  });
});

describe('LexeraFileFormatHelpers.makeRenderFile', () => {
  // makeRenderFile returns a closure that looks up window.LexeraExportTauriInvoke
  // at call time. Tests build a fake window per-scenario so we can exercise
  // both the happy path and the missing-invoker rejection.
  function loadWithWindow(fakeWindow) {
    return loadIIFE('plugins/formats/fileFormatHelpers.js', 'LexeraFileFormatHelpers', {
      window: fakeWindow || {}
    });
  }

  it('returns a function that carries the given pluginId through to the invoker', async () => {
    const calls = [];
    const invoke = (cmd, args) => { calls.push({ cmd, args }); return Promise.resolve({ success: true }); };
    const H = loadWithWindow({ LexeraExportTauriInvoke: { invoke } });
    const renderFile = H.makeRenderFile('xlsx');
    expect(typeof renderFile).toBe('function');
    await renderFile({ sourcePath: '/a.xlsx', targetPath: '/b.png', pageNumber: 2, outputFormat: 'png' });
    expect(calls.length).toBe(1);
    expect(calls[0].cmd).toBe('render_embedded_file');
    expect(calls[0].args.opts.pluginId).toBe('xlsx');
  });

  it('rejects when sourcePath is missing', async () => {
    const invoke = vi.fn().mockResolvedValue({ success: true });
    const H = loadWithWindow({ LexeraExportTauriInvoke: { invoke } });
    const renderFile = H.makeRenderFile('drawio');
    await expect(renderFile({ targetPath: '/out.png' })).rejects.toThrow(/sourcePath and targetPath required/);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('rejects when targetPath is missing', async () => {
    const invoke = vi.fn().mockResolvedValue({ success: true });
    const H = loadWithWindow({ LexeraExportTauriInvoke: { invoke } });
    const renderFile = H.makeRenderFile('drawio');
    await expect(renderFile({ sourcePath: '/a.drawio' })).rejects.toThrow(/sourcePath and targetPath required/);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('normalizes pageNumber (undefined → 1, negative → 1, string → number, good → preserved)', async () => {
    const calls = [];
    const invoke = (cmd, args) => { calls.push(args); return Promise.resolve({ success: true }); };
    const H = loadWithWindow({ LexeraExportTauriInvoke: { invoke } });
    const renderFile = H.makeRenderFile('xlsx');
    const baseOpts = { sourcePath: '/a.xlsx', targetPath: '/b.png' };
    await renderFile(Object.assign({}, baseOpts));                         // undefined → 1
    await renderFile(Object.assign({}, baseOpts, { pageNumber: -3 }));     // negative → 1
    await renderFile(Object.assign({}, baseOpts, { pageNumber: '5' }));    // string → 5
    await renderFile(Object.assign({}, baseOpts, { pageNumber: 7 }));      // preserved
    expect(calls.map(c => c.opts.pageNumber)).toEqual([1, 1, 5, 7]);
  });

  it('defaults outputFormat to png when omitted', async () => {
    const calls = [];
    const invoke = (cmd, args) => { calls.push(args); return Promise.resolve({ success: true }); };
    const H = loadWithWindow({ LexeraExportTauriInvoke: { invoke } });
    const renderFile = H.makeRenderFile('drawio');
    await renderFile({ sourcePath: '/a.drawio', targetPath: '/b' });
    expect(calls[0].opts.outputFormat).toBe('png');
  });

  it('rejects when LexeraExportTauriInvoke is unavailable on both window and top-level', async () => {
    // Empty sandbox window → no invoker found
    const H = loadWithWindow({});
    const renderFile = H.makeRenderFile('drawio');
    await expect(renderFile({ sourcePath: '/a', targetPath: '/b' }))
      .rejects.toThrow(/LexeraExportTauriInvoke unavailable/);
  });
});
