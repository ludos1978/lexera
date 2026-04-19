import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, '..', 'src');

// Load exportUI.js into a jsdom environment with the minimal DOM the dialog
// reads/writes during updateExportFolderName(). We evaluate the source in a
// vm context whose globalThis IS the jsdom window, so bare identifiers
// (ExportTreeBuilder, ExportTreeUI, etc.) resolve to the window globals.
let ExportUI;
let dom;

beforeAll(() => {
  const html = `<!DOCTYPE html><html><body>
    <div id="export-modal" hidden>
      <div id="export-tree-container"></div>
      <input id="export-folder-name" />
      <input id="export-target-folder" />
      <select id="export-format"><option value="keep" selected>keep</option></select>
      <div id="export-status"></div>
    </div>
  </body></html>`;
  dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'outside-only' });
  const { window } = dom;

  // Minimal globals the renderer & helpers expect.
  window.escapeHtml = (s) => String(s == null ? '' : s);
  window.lexeraLog = vi.fn();
  window.LexeraApi = { baseUrl: '', discover: vi.fn() };
  window.ExportService = {
    checkMarpStatus: vi.fn().mockResolvedValue({ available: false }),
    checkPandocStatus: vi.fn().mockResolvedValue({ available: false }),
    getMarpThemes: vi.fn().mockResolvedValue([]),
  };

  // Minimal ExportTreeBuilder / ExportTreeUI stubs — updateExportFolderName()
  // reads treeUI.getSelection() but otherwise doesn't care.
  window.ExportTreeBuilder = {
    buildExportTree: () => ({ children: [] }),
    getSelection: () => ({ hasSelection: true, isFullBoard: true, summary: { key: 'full' } }),
    resolveNodeIdForSelection: () => 'root',
  };
  window.ExportTreeUI = class {
    constructor() {}
    setSelectionChangeCallback() {}
    render() {}
    setOnlySelection() {}
    getSelection() { return { hasSelection: true, isFullBoard: true, summary: { key: 'full' } }; }
  };
  window.LexeraExportUiPreferences = null;
  window.structuredClone = (v) => JSON.parse(JSON.stringify(v));

  // Execute the source inside the jsdom window as globalThis so bare
  // identifiers (ExportTreeBuilder, lexeraLog, document, etc.) resolve.
  const source = readFileSync(resolve(srcDir, 'export/exportUI.js'), 'utf8');
  dom.window.eval(source);
  ExportUI = dom.window.ExportUI;
  if (!ExportUI) throw new Error('ExportUI did not register on window');
});

beforeEach(() => {
  dom.window.document.getElementById('export-target-folder').value = '';
  dom.window.document.getElementById('export-folder-name').value = '';
});

describe('ExportUI default target folder', () => {
  it('sets target folder to {board-folder}/_Export when boardData has filePath', () => {
    const ui = new ExportUI();
    ui.boardData = { filePath: '/Users/rspoerri/notes/ProjectX/TODO.md' };
    ui.boardName = 'TODO';
    ui.tree = null;
    ui.treeUI = null;
    ui._userEditedTargetFolder = false;

    ui.updateExportFolderName();

    const target = dom.window.document.getElementById('export-target-folder');
    expect(target.value).toBe('/Users/rspoerri/notes/ProjectX/_Export');
  });

  it('uses Windows-style separator when filePath is Windows-style', () => {
    const ui = new ExportUI();
    ui.boardData = { filePath: 'C:\\Users\\r\\notes\\TODO.md' };
    ui.boardName = 'TODO';
    ui._userEditedTargetFolder = false;

    ui.updateExportFolderName();

    const target = dom.window.document.getElementById('export-target-folder');
    expect(target.value).toBe('C:\\Users\\r\\notes\\_Export');
  });

  it('accepts the legacy `file` field in addition to `filePath`', () => {
    const ui = new ExportUI();
    ui.boardData = { file: '/tmp/board.md' };
    ui.boardName = 'board';
    ui._userEditedTargetFolder = false;

    ui.updateExportFolderName();

    const target = dom.window.document.getElementById('export-target-folder');
    expect(target.value).toBe('/tmp/_Export');
  });

  it('leaves target empty when boardData has no file path at all (so the UI can prompt)', () => {
    const ui = new ExportUI();
    ui.boardData = {};
    ui.boardName = 'board';
    ui._userEditedTargetFolder = false;

    ui.updateExportFolderName();

    const target = dom.window.document.getElementById('export-target-folder');
    expect(target.value).toBe('');
  });

  it('does not clobber a user-edited value on subsequent calls', () => {
    const ui = new ExportUI();
    ui.boardData = { filePath: '/home/u/notes/a.md' };
    ui.boardName = 'a';
    ui._userEditedTargetFolder = false;

    ui.updateExportFolderName();
    const target = dom.window.document.getElementById('export-target-folder');
    expect(target.value).toBe('/home/u/notes/_Export');

    // Simulate user edit
    target.value = '/some/custom/path';
    ui._userEditedTargetFolder = true;

    // Re-run; must NOT overwrite the user's value.
    ui.updateExportFolderName();
    expect(target.value).toBe('/some/custom/path');
  });
});
