import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, '..', 'src');

function loadExportUiHelpers() {
  const source = readFileSync(resolve(srcDir, 'export', 'exportUI.js'), 'utf-8');
  const lines = source.split('\n');

  function extractFunction(startLine) {
    let depth = 0;
    let started = false;
    const result = [];
    for (let i = startLine - 1; i < lines.length; i++) {
      const line = lines[i];
      result.push(line);
      for (let c = 0; c < line.length; c++) {
        if (line[c] === '{') { depth++; started = true; }
        if (line[c] === '}') depth--;
      }
      if (started && depth === 0) break;
    }
    return result.join('\n');
  }

  function findLine(pattern) {
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(pattern)) return i + 1;
    }
    throw new Error('Could not find: ' + pattern);
  }

  const storageLine = findLine('var EXPORT_UI_STORAGE_KEYS = {');
  let depth = 0;
  let started = false;
  const storageLines = [];
  for (let i = storageLine - 1; i < lines.length; i++) {
    storageLines.push(lines[i]);
    for (let c = 0; c < lines[i].length; c++) {
      if (lines[i][c] === '{') { depth++; started = true; }
      if (lines[i][c] === '}') depth--;
    }
    if (started && depth === 0) break;
  }

  const legacyLine = findLine('var EXPORT_UI_LEGACY_STORAGE_KEYS = {');
  depth = 0;
  started = false;
  const legacyLines = [];
  for (let i = legacyLine - 1; i < lines.length; i++) {
    legacyLines.push(lines[i]);
    for (let c = 0; c < lines[i].length; c++) {
      if (lines[i][c] === '{') { depth++; started = true; }
      if (lines[i][c] === '}') depth--;
    }
    if (started && depth === 0) break;
  }

  const wrappedSource = `
    ${storageLines.join('\n')}
    ${legacyLines.join('\n')}
    ${extractFunction(findLine('function normalizeExportDialogFormat('))}
    ${extractFunction(findLine('function normalizeExportPreset('))}
    ${extractFunction(findLine('function normalizePandocExportFormat('))}
    ${extractFunction(findLine('function normalizeDocumentPageBreakPreference('))}
    ${extractFunction(findLine('function normalizeSpeakerNoteMode('))}
    ${extractFunction(findLine('function normalizeKeepRemoveMode('))}
    ${extractFunction(findLine('function normalizeEmbedHandling('))}
    ${extractFunction(findLine('function normalizeMarpBrowser('))}
    ${extractFunction(findLine('function normalizeLinkHandlingMode('))}
    ${extractFunction(findLine('function normalizeBooleanPreference('))}
    ${extractFunction(findLine('function normalizePackFileSizeLimit('))}
    ${extractFunction(findLine('function defaultExcludeTagsInput('))}
    ${extractFunction(findLine('function normalizeExcludeTagsInput('))}
    ${extractFunction(findLine('function applyExportPresetToOptions('))}
    ${extractFunction(findLine('function getStoredExportUiPreference('))}
    ${extractFunction(findLine('function setStoredExportUiPreference('))}

    return {
      EXPORT_UI_STORAGE_KEYS,
      EXPORT_UI_LEGACY_STORAGE_KEYS,
      normalizeExportDialogFormat,
      normalizeExportPreset,
      normalizePandocExportFormat,
      normalizeDocumentPageBreakPreference,
      normalizeSpeakerNoteMode,
      normalizeKeepRemoveMode,
      normalizeEmbedHandling,
      normalizeMarpBrowser,
      normalizeLinkHandlingMode,
      normalizeBooleanPreference,
      normalizePackFileSizeLimit,
      defaultExcludeTagsInput,
      normalizeExcludeTagsInput,
      applyExportPresetToOptions,
      getStoredExportUiPreference,
      setStoredExportUiPreference,
      __storage: localStorage,
    };
  `;

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

  const factory = new Function('localStorage', wrappedSource);
  return factory(storage);
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
    expect(U.normalizeLinkHandlingMode('dont-modify')).toBe('no-modify');
    expect(U.normalizeLinkHandlingMode('other')).toBe('rewrite-only');
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
      linkHandlingMode: 'rewrite-only',
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
      linkHandlingMode: 'rewrite-only',
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
      linkHandlingMode: 'pack-all',
      packAssets: true,
      runPandoc: false,
    });
    expect(U.applyExportPresetToOptions({}, 'share-content').packOptions).toEqual({
      includeFiles: true,
      includeImages: true,
      includeVideos: true,
      includeOtherMedia: true,
      includeDocuments: true,
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
