import { describe, it, expect, beforeAll } from 'vitest';
import { loadIIFE } from './load-iife.js';

let Registry;

beforeAll(() => {
  const mockWindow = {};
  Registry = loadIIFE('plugins/fileFormatRegistry.js', 'LexeraFileFormatRegistry', {
    window: mockWindow,
    URL,
  });
});

describe('LexeraFileFormatRegistry', () => {
  it('detects spreadsheet files and returns spreadsheet preview metadata', () => {
    const plugin = Registry.findByFilePath('docs/budget.xlsx');
    expect(plugin.id).toBe('xlsx');
    expect(Registry.getPreviewKind('docs/budget.xlsx')).toBe('spreadsheet');
    expect(Registry.getPreviewMeta('spreadsheet', 'docs/budget.xlsx')).toEqual({
      label: 'Spreadsheet file',
      emoji: '&#128200;',
    });
  });

  it('builds sheet-aware preview and export render configs for spreadsheets', () => {
    expect(Registry.getPreviewRenderConfig('docs/budget.xlsx', { pageNumber: 3 })).toMatchObject({
      pluginId: 'xlsx',
      previewKind: 'spreadsheet',
      cacheFolderName: 'xlsx-cache',
      extension: 'png',
      outputFormat: 'png',
      pageNumber: 3,
      suffix: '-s3',
    });
    expect(Registry.getExportRenderConfig('docs/budget.xlsx', { pageNumber: 3 })).toMatchObject({
      pluginId: 'xlsx',
      outputExtension: 'png',
      outputFormat: 'png',
      pageNumber: 3,
      suffix: '-s3',
    });
  });

  it('uses vector export output for draw.io files while keeping png previews', () => {
    expect(Registry.getPreviewRenderConfig('diagram.drawio', { pageNumber: 1 })).toMatchObject({
      pluginId: 'drawio',
      extension: 'png',
      outputFormat: 'png',
    });
    expect(Registry.getExportRenderConfig('diagram.drawio', { pageNumber: 1 })).toMatchObject({
      pluginId: 'drawio',
      outputExtension: 'svg',
      outputFormat: 'svg',
    });
  });

  it('supports raw excalidraw json files with svg preview and export output', () => {
    expect(Registry.findByFilePath('diagram.excalidraw.json').id).toBe('excalidraw');
    expect(Registry.getPreviewRenderConfig('diagram.excalidraw.json', { pageNumber: 1 })).toMatchObject({
      pluginId: 'excalidraw',
      extension: 'svg',
      outputFormat: 'svg',
    });
    expect(Registry.getExportRenderConfig('diagram.excalidraw.json', { pageNumber: 1 })).toMatchObject({
      pluginId: 'excalidraw',
      outputExtension: 'svg',
      outputFormat: 'svg',
    });
  });

  it('treats csv files as renderable table previews and svg export assets', () => {
    expect(Registry.findByFilePath('tables/data.csv').id).toBe('csv');
    expect(Registry.getPreviewKind('tables/data.csv')).toBe('table');
    expect(Registry.getPreviewRenderConfig('tables/data.csv', { pageNumber: 2 })).toMatchObject({
      pluginId: 'csv',
      previewKind: 'table',
      cacheFolderName: 'csv-cache',
      extension: 'svg',
      outputFormat: 'svg',
      pageNumber: 2,
      suffix: '-p2',
    });
    expect(Registry.getExportRenderConfig('tables/data.csv', { pageNumber: 2 })).toMatchObject({
      pluginId: 'csv',
      outputExtension: 'svg',
      outputFormat: 'svg',
      pageNumber: 2,
      suffix: '-p2',
    });
  });

  it('treats tsv and tab files as renderable table previews routed through the tsv plugin', () => {
    expect(Registry.findByFilePath('data/report.tsv').id).toBe('tsv');
    expect(Registry.findByFilePath('data/export.tab').id).toBe('tsv');
    expect(Registry.getPreviewKind('data/report.tsv')).toBe('table');
    expect(Registry.getPreviewRenderConfig('data/report.tsv', { pageNumber: 1 })).toMatchObject({
      pluginId: 'tsv',
      previewKind: 'table',
      cacheFolderName: 'tsv-cache',
      extension: 'svg',
      outputFormat: 'svg',
      pageNumber: 1,
      suffix: '-p1',
    });
    expect(Registry.getExportRenderConfig('data/export.tab', { pageNumber: 2 })).toMatchObject({
      pluginId: 'tsv',
      outputExtension: 'svg',
      outputFormat: 'svg',
      pageNumber: 2,
      suffix: '-p2',
    });
  });

  it('keeps csv and tsv plugins distinct for their respective extensions', () => {
    expect(Registry.findByFilePath('data.csv').id).toBe('csv');
    expect(Registry.findByFilePath('data.tsv').id).toBe('tsv');
    expect(Registry.findByFilePath('data.tab').id).toBe('tsv');
  });

  it('treats plain text files as renderable text previews with svg export', () => {
    expect(Registry.findByFilePath('notes/readme.txt').id).toBe('plaintext');
    expect(Registry.findByFilePath('logs/server.log').id).toBe('plaintext');
    expect(Registry.findByFilePath('config/settings.cfg').id).toBe('plaintext');
    expect(Registry.findByFilePath('config/app.ini').id).toBe('plaintext');
    expect(Registry.findByFilePath('config/server.conf').id).toBe('plaintext');
    expect(Registry.getPreviewKind('notes/readme.txt')).toBe('text');
    expect(Registry.getPreviewRenderConfig('notes/readme.txt', { pageNumber: 2 })).toMatchObject({
      pluginId: 'plaintext',
      previewKind: 'text',
      cacheFolderName: 'text-cache',
      extension: 'svg',
      outputFormat: 'svg',
      pageNumber: 2,
      suffix: '-p2',
    });
    expect(Registry.getExportRenderConfig('logs/server.log', { pageNumber: 1 })).toMatchObject({
      pluginId: 'plaintext',
      outputExtension: 'svg',
      outputFormat: 'svg',
    });
  });

  it('routes rtf files through the document plugin for LibreOffice rendering', () => {
    expect(Registry.findByFilePath('docs/report.rtf').id).toBe('document');
    expect(Registry.getPreviewKind('docs/report.rtf')).toBe('document');
  });

  it('exposes export replacement support for pdf and office documents', () => {
    expect(Registry.supportsExportReplacement('slides.pdf')).toBe(true);
    expect(Registry.supportsExportReplacement('deck.pptx')).toBe(true);
    expect(Registry.supportsExportReplacement('book.epub')).toBe(true);
  });
});
