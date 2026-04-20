import { describe, it, expect, beforeAll } from 'vitest';
import { loadIIFE } from './load-iife.js';

function loadExportUiHelpers() {
  const storage = {
    _map: {},
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(this._map, key) ? this._map[key] : null;
    },
    setItem(key, value) {
      this._map[key] = String(value);
    },
    removeItem(key) {
      delete this._map[key];
    },
  };

  const Preferences = loadIIFE('export/exportUiPreferences.js', 'LexeraExportUiPreferences');
  return {
    ...Preferences.createExportUiPreferenceHelpers(storage),
    __storage: storage,
  };
}

let U;

beforeAll(() => {
  U = loadExportUiHelpers();
});

describe('export UI preference helpers', () => {
  it('normalizes export format presets', () => {
    expect(U.normalizeExportDialogFormat('document')).toBe('document');
    expect(U.normalizeExportDialogFormat('keep')).toBe('keep');
    expect(U.normalizeExportDialogFormat('unexpected')).toBe('presentation');
    expect(U.normalizeExportPreset('marp-pdf')).toBe('marp-pdf');
    expect(U.normalizeExportPreset('unknown')).toBe('custom');
  });

  it('normalizes Pandoc formats and page break modes', () => {
    expect(U.normalizePandocExportFormat('ODT')).toBe('odt');
    expect(U.normalizePandocExportFormat('unknown')).toBe('docx');
    expect(U.normalizeDocumentPageBreakPreference('per-task')).toBe('perTask');
    expect(U.normalizeDocumentPageBreakPreference('perColumn')).toBe('perColumn');
    expect(U.normalizeDocumentPageBreakPreference('anything')).toBe('continuous');
  });

  it('normalizes Marp and transform defaults', () => {
    expect(U.normalizeSpeakerNoteMode('keep')).toBe('keep');
    expect(U.normalizeSpeakerNoteMode('other')).toBe('comment');
    expect(U.normalizeKeepRemoveMode('remove')).toBe('remove');
    expect(U.normalizeKeepRemoveMode('other')).toBe('keep');
    expect(U.normalizeEmbedHandling('fallback')).toBe('fallback');
    expect(U.normalizeEmbedHandling('other')).toBe('url');
    expect(U.normalizeMarpBrowser('firefox')).toBe('firefox');
    expect(U.normalizeMarpBrowser('other')).toBe('chrome');
    // Phase 2: two-mode scheme with legacy migration.
    expect(U.normalizeLinkHandlingMode('dont-modify')).toBe('rewrite-relative');
    expect(U.normalizeLinkHandlingMode('no-modify')).toBe('rewrite-relative');
    expect(U.normalizeLinkHandlingMode('rewrite-only')).toBe('rewrite-relative');
    expect(U.normalizeLinkHandlingMode('pack-all')).toBe('pack-linked');
    expect(U.normalizeLinkHandlingMode('pack-linked')).toBe('pack-linked');
    expect(U.normalizeLinkHandlingMode('other')).toBe('rewrite-relative');
    expect(U.normalizeBooleanPreference('true', false)).toBe(true);
    expect(U.normalizeBooleanPreference('', true)).toBe(true);
    expect(U.normalizePackFileSizeLimit('250')).toBe(250);
    expect(U.normalizePackFileSizeLimit('0')).toBe(100);
    expect(U.defaultExcludeTagsInput()).toBe('#exclude');
    expect(U.normalizeExcludeTagsInput('')).toBe('#exclude');
    expect(U.normalizeExcludeTagsInput(' #draft ')).toBe('#draft');
  });

  it('applies export presets with v1-compatible defaults for the remaining parity controls', () => {
    expect(U.applyExportPresetToOptions({}, 'marp-presentation')).toMatchObject({
      preset: 'marp-presentation',
      format: 'presentation',
      tagVisibility: 'none',
      stripIncludes: false,
      autoExportOnSave: true,
      runMarp: true,
      marpFormat: 'html',
      marpBrowser: 'chrome',
      marpWatch: true,
      marpPptxEditable: false,
      linkHandlingMode: 'rewrite-relative',
      packAssets: false,
      runPandoc: false,
    });

    expect(U.applyExportPresetToOptions({}, 'marp-pdf')).toMatchObject({
      preset: 'marp-pdf',
      format: 'presentation',
      tagVisibility: 'none',
      stripIncludes: false,
      autoExportOnSave: true,
      runMarp: true,
      marpFormat: 'pdf',
      marpBrowser: 'chrome',
      marpWatch: false,
      marpPptxEditable: false,
      speakerNoteMode: 'keep',
      linkHandlingMode: 'rewrite-relative',
      packAssets: false,
      runPandoc: false,
    });

    expect(U.applyExportPresetToOptions({}, 'share-content')).toMatchObject({
      preset: 'share-content',
      format: 'keep',
      tagVisibility: 'all',
      stripIncludes: false,
      autoExportOnSave: false,
      runMarp: false,
      marpWatch: false,
      linkHandlingMode: 'pack-linked',
      packAssets: true,
      runPandoc: false,
    });
    expect(U.applyExportPresetToOptions({}, 'share-content').packOptions).toEqual({
      typeMode: 'all',
      extensions: [],
      fileSizeLimitMB: 100,
    });
  });

  it('stores and removes persisted export defaults', () => {
    U.setStoredExportUiPreference('pandocFormat', 'epub');
    expect(U.getStoredExportUiPreference('pandocFormat', 'docx')).toBe('epub');

    U.setStoredExportUiPreference('pandocFormat', '');
    expect(U.getStoredExportUiPreference('pandocFormat', 'docx')).toBe('docx');
  });

  it('falls back to legacy v1 storage keys for persisted defaults', () => {
    U.setStoredExportUiPreference('excludeTags', '');
    U.__storage.setItem(U.EXPORT_UI_LEGACY_STORAGE_KEYS.excludeTags, '#draft,#wip');
    expect(U.getStoredExportUiPreference('excludeTags', '')).toBe('#draft,#wip');
  });
});
