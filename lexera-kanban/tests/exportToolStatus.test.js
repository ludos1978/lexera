import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadIIFE } from './load-iife.js';

function createMockStorage() {
  const map = {};
  return {
    _map: map,
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null;
    },
    setItem(key, value) {
      map[key] = String(value);
    },
    removeItem(key) {
      delete map[key];
    },
  };
}

function loadModule(globals) {
  // Load LexeraExportUiPreferences first so the module can delegate
  const Prefs = loadIIFE('export/exportUiPreferences.js', 'LexeraExportUiPreferences');
  const mergedGlobals = {
    window: { LexeraExportUiPreferences: Prefs },
    ...globals,
  };
  // The IIFE reads window.LexeraExportUiPreferences
  mergedGlobals.window = mergedGlobals.window || {};
  mergedGlobals.window.LexeraExportUiPreferences = Prefs;

  const ETS = loadIIFE('export/exportToolStatus.js', 'ExportToolStatus', mergedGlobals);
  return ETS;
}

describe('ExportToolStatus', () => {
  let ETS;
  let storage;

  beforeEach(() => {
    storage = createMockStorage();
    ETS = loadModule({ window: { LexeraExportUiPreferences: loadIIFE('export/exportUiPreferences.js', 'LexeraExportUiPreferences') } });
    ETS.init({
      tauriInvoke: vi.fn().mockRejectedValue(new Error('mock')),
      hasTauri: false,
      buildModeMenuItems: function (currentValue, actionPrefix, options) {
        var items = [];
        for (var i = 0; i < options.length; i++) {
          var option = options[i];
          if (option && option.separator) { items.push({ separator: true }); continue; }
          items.push({
            id: actionPrefix + ':' + option.value,
            label: (currentValue === option.value ? '\u2713 ' : '') + option.label
          });
        }
        return items;
      },
      storage: storage,
    });
  });

  // ── Normalizer delegation ──────────────────────────────────────────

  describe('normalizer delegation', () => {
    it('normalizeExportDialogFormat delegates correctly', () => {
      expect(ETS.normalizeExportDialogFormat('document')).toBe('document');
      expect(ETS.normalizeExportDialogFormat('keep')).toBe('keep');
      expect(ETS.normalizeExportDialogFormat('kanban')).toBe('kanban');
      expect(ETS.normalizeExportDialogFormat('bogus')).toBe('presentation');
      expect(ETS.normalizeExportDialogFormat('')).toBe('presentation');
      expect(ETS.normalizeExportDialogFormat(null)).toBe('presentation');
    });

    it('normalizePandocExportFormat delegates correctly', () => {
      expect(ETS.normalizePandocExportFormat('odt')).toBe('odt');
      expect(ETS.normalizePandocExportFormat('EPUB')).toBe('epub');
      expect(ETS.normalizePandocExportFormat('unknown')).toBe('docx');
    });

    it('normalizeDocumentPageBreakPreference delegates correctly', () => {
      expect(ETS.normalizeDocumentPageBreakPreference('per-task')).toBe('perTask');
      expect(ETS.normalizeDocumentPageBreakPreference('pertask')).toBe('perTask');
      expect(ETS.normalizeDocumentPageBreakPreference('per-column')).toBe('perColumn');
      expect(ETS.normalizeDocumentPageBreakPreference('percolumn')).toBe('perColumn');
      expect(ETS.normalizeDocumentPageBreakPreference('anything')).toBe('continuous');
    });
  });

  // ── Storage helpers ────────────────────────────────────────────────

  describe('storage helpers', () => {
    it('reads and writes stored export defaults', () => {
      expect(ETS.getStoredExportDefault('pandocFormat', 'docx')).toBe('docx');
      ETS.setStoredExportDefault('pandocFormat', 'epub');
      expect(ETS.getStoredExportDefault('pandocFormat', 'docx')).toBe('epub');
    });

    it('removes stored export default when value is empty', () => {
      ETS.setStoredExportDefault('pandocFormat', 'odt');
      expect(ETS.getStoredExportDefault('pandocFormat', 'docx')).toBe('odt');
      ETS.setStoredExportDefault('pandocFormat', '');
      expect(ETS.getStoredExportDefault('pandocFormat', 'docx')).toBe('docx');
    });

    it('returns fallback for unknown keys', () => {
      expect(ETS.getStoredExportDefault('nonexistent', 'fallback')).toBe('fallback');
    });

    it('getStoredPandocDefaults returns normalized defaults', () => {
      var defaults = ETS.getStoredPandocDefaults();
      expect(defaults.format).toBe('docx');
      expect(defaults.pageBreaks).toBe('continuous');

      ETS.setStoredExportDefault('pandocFormat', 'epub');
      ETS.setStoredExportDefault('pandocPageBreaks', 'perTask');
      defaults = ETS.getStoredPandocDefaults();
      expect(defaults.format).toBe('epub');
      expect(defaults.pageBreaks).toBe('perTask');
    });
  });

  // ── Status formatting ──────────────────────────────────────────────

  describe('status formatting', () => {
    it('formatExportToolStatusLabel handles all states', () => {
      expect(ETS.formatExportToolStatusLabel('Pandoc', null)).toBe('Pandoc: Unknown');
      expect(ETS.formatExportToolStatusLabel('Pandoc', { pending: true })).toBe('Pandoc: Checking\u2026');
      expect(ETS.formatExportToolStatusLabel('Pandoc', { available: true, version: '3.1' })).toBe('Pandoc: Ready (v3.1)');
      expect(ETS.formatExportToolStatusLabel('Pandoc', { available: true })).toBe('Pandoc: Ready');
      expect(ETS.formatExportToolStatusLabel('Pandoc', { error: 'not found' })).toBe('Pandoc: Unavailable');
      expect(ETS.formatExportToolStatusLabel('Pandoc', {})).toBe('Pandoc: Not Installed');
    });

    it('formatEmbeddedRendererStatusSummary handles all states', () => {
      expect(ETS.formatEmbeddedRendererStatusSummary(null)).toBe('Embedded Renderers: Unknown');
      expect(ETS.formatEmbeddedRendererStatusSummary({ pending: true })).toBe('Embedded Renderers: Checking\u2026');
      expect(ETS.formatEmbeddedRendererStatusSummary({ error: 'err', rows: [] })).toBe('Embedded Renderers: Unavailable');
      expect(ETS.formatEmbeddedRendererStatusSummary({ rows: [] })).toBe('Embedded Renderers: Unknown');
      expect(ETS.formatEmbeddedRendererStatusSummary({
        rows: [{ available: true }, { available: false }, { available: true }]
      })).toBe('Embedded Renderers: 2/3 Ready');
    });

    it('formatEmbeddedRendererStatusItem handles all states', () => {
      expect(ETS.formatEmbeddedRendererStatusItem(null)).toBe('Unknown Renderer');
      expect(ETS.formatEmbeddedRendererStatusItem({ label: 'Mermaid', available: true, version: '10.9' }))
        .toBe('Mermaid: Ready (10.9)');
      expect(ETS.formatEmbeddedRendererStatusItem({ label: 'PlantUML', available: false, details: 'Java not found' }))
        .toBe('PlantUML: Missing - Java not found');
      expect(ETS.formatEmbeddedRendererStatusItem({ available: false }))
        .toBe('Renderer: Missing');
    });
  });

  // ── Menu item builders ─────────────────────────────────────────────

  describe('menu item builders', () => {
    it('buildPandocOutputFormatItems returns menu items', () => {
      var items = ETS.buildPandocOutputFormatItems('prefix');
      expect(items.length).toBe(3);
      expect(items[0].id).toBe('prefix:docx');
      expect(items[0].label).toContain('DOCX');
      expect(items[1].id).toBe('prefix:odt');
      expect(items[2].id).toBe('prefix:epub');
    });

    it('buildDocumentPageBreakModeItems returns menu items', () => {
      var items = ETS.buildDocumentPageBreakModeItems('brk');
      expect(items.length).toBe(3);
      expect(items[0].id).toBe('brk:continuous');
      expect(items[1].id).toBe('brk:perTask');
      expect(items[2].id).toBe('brk:perColumn');
    });

    it('buildEmbeddedRendererStatusMenuItems returns summary and refresh items', () => {
      var items = ETS.buildEmbeddedRendererStatusMenuItems();
      expect(items.length).toBeGreaterThanOrEqual(2);
      expect(items[0].id).toBe('file-renderer-status-summary');
      expect(items[0].disabled).toBe(true);
      expect(items[1].id).toBe('file-renderer-refresh-status');
    });

    it('buildFileHeaderPandocMenuItems returns pandoc menu structure', () => {
      var items = ETS.buildFileHeaderPandocMenuItems();
      expect(items.length).toBeGreaterThanOrEqual(4);
      expect(items[0].id).toBe('file-pandoc-status');
      expect(items[0].disabled).toBe(true);
      expect(items[1].id).toBe('file-pandoc-refresh-status');
      var formatItem = items.find(function (i) { return i.id === 'file-pandoc-output-format'; });
      expect(formatItem).toBeTruthy();
      expect(formatItem.items.length).toBe(3);
    });
  });

  // ── Status refresh ─────────────────────────────────────────────────

  describe('status refresh', () => {
    it('refreshEmbeddedRendererStatuses returns cache immediately when tauri unavailable', async () => {
      var result = await ETS.refreshEmbeddedRendererStatuses(true);
      expect(result.error).toBe('tauri-unavailable');
      expect(result.rows).toEqual([]);
    });

    it('refreshExportToolStatus returns error for unknown tool', async () => {
      var result = await ETS.refreshExportToolStatus('unknown-tool', true);
      expect(result.error).toBe('unknown-tool');
    });

    it('refreshExportToolStatus marks pandoc unavailable when ExportService missing', async () => {
      var result = await ETS.refreshExportToolStatus('pandoc', true);
      expect(result.available).toBe(false);
      expect(result.error).toBe('unavailable');
    });
  });

  // ── Menu action handlers ───────────────────────────────────────────

  describe('menu action handlers', () => {
    it('handleBoardPandocMenuAction sets format', async () => {
      var handled = await ETS.handleBoardPandocMenuAction('file-pandoc-set-format:epub');
      expect(handled).toBe(true);
      expect(ETS.getStoredPandocDefaults().format).toBe('epub');
    });

    it('handleBoardPandocMenuAction sets page breaks', async () => {
      var handled = await ETS.handleBoardPandocMenuAction('file-pandoc-set-page-breaks:perColumn');
      expect(handled).toBe(true);
      expect(ETS.getStoredPandocDefaults().pageBreaks).toBe('perColumn');
    });

    it('handleBoardPandocMenuAction calls triggerExportFn for open-export', async () => {
      var called = false;
      var handled = await ETS.handleBoardPandocMenuAction('file-pandoc-open-export', function (opts) {
        called = true;
        expect(opts.format).toBe('document');
        expect(opts.runPandoc).toBe(true);
      });
      expect(handled).toBe(true);
      expect(called).toBe(true);
    });

    it('handleBoardPandocMenuAction returns false for unknown action', async () => {
      var handled = await ETS.handleBoardPandocMenuAction('unknown-action');
      expect(handled).toBe(false);
    });

    it('handleEmbeddedRendererMenuAction returns false for unknown action', async () => {
      var handled = await ETS.handleEmbeddedRendererMenuAction('unknown-action');
      expect(handled).toBe(false);
    });
  });

  // ── Tool status cache ──────────────────────────────────────────────

  describe('tool status cache', () => {
    it('getToolStatusCache returns the internal cache object', () => {
      var cache = ETS.getToolStatusCache();
      expect(cache).toBeTruthy();
      expect(cache.pandoc).toBeTruthy();
      expect(cache.renderers).toBeTruthy();
      expect(cache.pandoc.available).toBe(false);
      expect(Array.isArray(cache.renderers.rows)).toBe(true);
    });
  });
});
