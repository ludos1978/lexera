import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { loadIIFE } from './load-iife.js';

let Registry;

// Shared bootstrap for the "manifests" describe blocks.
beforeAll(() => {
  Registry = loadIIFE(
    [
      'plugins/pluginRegistry.js',
      'plugins/exports/tauriInvoke.js',
      'plugins/exports/marpExport.js',
      'plugins/exports/pandocExport.js',
      'plugins/exports/filterExport.js',
    ],
    'LexeraPluginRegistry',
    { window: {} }
  );
});

// A second bootstrap helper for delegation tests — lets each test inject
// a mock Tauri invoke channel and get a fresh plugin set.
function bootstrapWithInvoke(mockInvoke) {
  const fakeWindow = {
    LexeraBackendDiscovery: { invokeTauri: mockInvoke }
  };
  const Reg = loadIIFE(
    [
      'plugins/pluginRegistry.js',
      'plugins/exports/tauriInvoke.js',
      'plugins/exports/marpExport.js',
      'plugins/exports/pandocExport.js',
      'plugins/exports/filterExport.js',
    ],
    'LexeraPluginRegistry',
    { window: fakeWindow }
  );
  return { Registry: Reg, fakeWindow };
}

describe('Export plugin manifests', () => {
  it('registers marp, pandoc, and filter plugins as kind=export', () => {
    const ids = Registry.getByKind('export').map(p => p.metadata.id).sort();
    expect(ids).toEqual(['filter', 'marp', 'pandoc']);
  });

  it('marp declares presentation subformats', () => {
    const marp = Registry.getById('export', 'marp');
    expect(marp.baseFormat).toBe('presentation');
    const fmts = marp.getSupportedFormats().map(f => f.id);
    expect(fmts).toContain('presentation-pdf');
    expect(fmts).toContain('presentation-pptx');
    expect(marp.canExport('presentation-pdf')).toBe(true);
    expect(marp.canExport('presentation')).toBe(true);
    expect(marp.canExport('document-docx')).toBe(false);
  });

  it('pandoc declares document subformats', () => {
    const pandoc = Registry.getById('export', 'pandoc');
    expect(pandoc.baseFormat).toBe('document');
    const fmts = pandoc.getSupportedFormats().map(f => f.id);
    expect(fmts).toEqual(expect.arrayContaining(['document-docx', 'document-odt', 'document-epub']));
    expect(pandoc.canExport('document-docx')).toBe(true);
    expect(pandoc.canExport('presentation-pdf')).toBe(false);
  });

  it('filter declares keep/kanban and is lower priority', () => {
    const filt = Registry.getById('export', 'filter');
    expect(filt.metadata.priority).toBe(-10);
    const fmts = filt.getSupportedFormats().map(f => f.id).sort();
    expect(fmts).toEqual(['kanban', 'keep']);
  });

  it('findBy returns the right plugin for a given format id', () => {
    const pdf = Registry.findBy('export', p => p.canExport('presentation-pdf'));
    expect(pdf.metadata.id).toBe('marp');
    const docx = Registry.findBy('export', p => p.canExport('document-docx'));
    expect(docx.metadata.id).toBe('pandoc');
    const keep = Registry.findBy('export', p => p.canExport('keep'));
    expect(keep.metadata.id).toBe('filter');
  });

  it('declares external tool requirements', () => {
    expect(Registry.getById('export', 'marp').metadata.requires).toContain('marp');
    expect(Registry.getById('export', 'pandoc').metadata.requires).toContain('pandoc');
  });
});

describe('Marp export plugin — Tauri delegation', () => {
  it('checkStatus invokes check_marp_available and normalizes the shape', async () => {
    const invoke = vi.fn().mockResolvedValue({ available: true, version: '3.4.0' });
    const marp = bootstrapWithInvoke(invoke).Registry.getById('export', 'marp');
    const status = await marp.checkStatus();
    expect(invoke).toHaveBeenCalledWith('check_marp_available', undefined);
    expect(status).toEqual({ available: true, version: '3.4.0' });
  });

  it('checkStatus normalizes missing version to null', async () => {
    const invoke = vi.fn().mockResolvedValue({ available: false });
    const marp = bootstrapWithInvoke(invoke).Registry.getById('export', 'marp');
    const status = await marp.checkStatus();
    expect(status).toEqual({ available: false, version: null });
  });

  it('getThemes invokes discover_marp_themes with a dirs payload', async () => {
    const invoke = vi.fn().mockResolvedValue(['theme-a.css']);
    const marp = bootstrapWithInvoke(invoke).Registry.getById('export', 'marp');
    await marp.getThemes(['/a', '/b']);
    expect(invoke).toHaveBeenCalledWith('discover_marp_themes', { dirs: ['/a', '/b'] });
  });

  it('getThemes defaults dirs to an empty array', async () => {
    const invoke = vi.fn().mockResolvedValue([]);
    const marp = bootstrapWithInvoke(invoke).Registry.getById('export', 'marp');
    await marp.getThemes();
    expect(invoke).toHaveBeenCalledWith('discover_marp_themes', { dirs: [] });
  });

  it('getClasses invokes discover_marp_classes', async () => {
    const invoke = vi.fn().mockResolvedValue(['small', 'big']);
    const marp = bootstrapWithInvoke(invoke).Registry.getById('export', 'marp');
    await marp.getClasses(['/x']);
    expect(invoke).toHaveBeenCalledWith('discover_marp_classes', { dirs: ['/x'] });
  });

  it('stopAllWatches invokes marp_stop_all_watches', async () => {
    const invoke = vi.fn().mockResolvedValue(null);
    const marp = bootstrapWithInvoke(invoke).Registry.getById('export', 'marp');
    await marp.stopAllWatches();
    expect(invoke).toHaveBeenCalledWith('marp_stop_all_watches', undefined);
  });

  it('getEnginePath caches successful lookups and only invokes once', async () => {
    const invoke = vi.fn().mockResolvedValue('/abs/path/to/engine.js');
    const marp = bootstrapWithInvoke(invoke).Registry.getById('export', 'marp');
    const p1 = await marp.getEnginePath();
    const p2 = await marp.getEnginePath();
    expect(p1).toBe('/abs/path/to/engine.js');
    expect(p2).toBe('/abs/path/to/engine.js');
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('getEnginePath caches null on failure and does not retry', async () => {
    const invoke = vi.fn().mockRejectedValue(new Error('engine missing'));
    const marp = bootstrapWithInvoke(invoke).Registry.getById('export', 'marp');
    const p1 = await marp.getEnginePath();
    const p2 = await marp.getEnginePath();
    expect(p1).toBeNull();
    expect(p2).toBeNull();
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('resetEnginePathCache forces a new lookup', async () => {
    const invoke = vi.fn()
      .mockResolvedValueOnce('/first')
      .mockResolvedValueOnce('/second');
    const marp = bootstrapWithInvoke(invoke).Registry.getById('export', 'marp');
    const p1 = await marp.getEnginePath();
    marp.resetEnginePathCache();
    const p2 = await marp.getEnginePath();
    expect(p1).toBe('/first');
    expect(p2).toBe('/second');
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it('isAvailable returns true when checkStatus says available', async () => {
    const invoke = vi.fn().mockResolvedValue({ available: true });
    const marp = bootstrapWithInvoke(invoke).Registry.getById('export', 'marp');
    expect(await marp.isAvailable()).toBe(true);
  });

  it('isAvailable returns false when the invoke fails', async () => {
    const invoke = vi.fn().mockRejectedValue(new Error('tauri down'));
    const marp = bootstrapWithInvoke(invoke).Registry.getById('export', 'marp');
    expect(await marp.isAvailable()).toBe(false);
  });
});

describe('Pandoc export plugin — Tauri delegation', () => {
  it('checkStatus invokes check_pandoc_available and normalizes the shape', async () => {
    const invoke = vi.fn().mockResolvedValue({ available: true, version: '3.1' });
    const pandoc = bootstrapWithInvoke(invoke).Registry.getById('export', 'pandoc');
    const status = await pandoc.checkStatus();
    expect(invoke).toHaveBeenCalledWith('check_pandoc_available', undefined);
    expect(status).toEqual({ available: true, version: '3.1' });
  });

  it('isAvailable returns false when the invoke rejects', async () => {
    const invoke = vi.fn().mockRejectedValue(new Error('no pandoc'));
    const pandoc = bootstrapWithInvoke(invoke).Registry.getById('export', 'pandoc');
    expect(await pandoc.isAvailable()).toBe(false);
  });
});
