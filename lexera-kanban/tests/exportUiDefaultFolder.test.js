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

  it('pre-selects a row node when init() is called with initialOptions.selection scope=row', async () => {
    // Load the REAL ExportTreeBuilder so resolveNodeIdForSelection runs.
    const builderSrc = readFileSync(resolve(srcDir, 'export/exportTreeBuilder.js'), 'utf8');
    dom.window.eval(builderSrc);
    const RealBuilder = dom.window.ExportTreeBuilder;

    // Spy on treeUI to capture which node gets passed to setOnlySelection.
    const setOnlySelectionCalls = [];
    dom.window.ExportTreeUI = class {
      constructor() {}
      setSelectionChangeCallback() {}
      render() {}
      setOnlySelection(nodeId) { setOnlySelectionCalls.push(nodeId); }
      getSelection() {
        return { hasSelection: true, isFullBoard: false, summary: { key: 'selection' }, columnIndexes: [], columnIds: [], scopes: [] };
      }
    };

    const boardData = {
      filePath: '/notes/board.md',
      rows: [
        { title: 'Row 0', stacks: [{ title: 'S', columns: [{ title: 'C0', id: 'c0' }] }] },
        { title: 'Row 1', stacks: [{ title: 'S', columns: [{ title: 'C1', id: 'c1' }] }] },
      ],
    };
    const ui = new ExportUI();
    await ui.init('board-id', boardData, { selection: { scope: 'row', rowIndex: 1 } });

    // setOnlySelection must have been called with the row-1 node id, not 'root'.
    expect(setOnlySelectionCalls).toContain('row-1');
    expect(setOnlySelectionCalls).not.toContain('root');
  });

  it('pre-selects a stack node when init() is called with scope=stack', async () => {
    const builderSrc = readFileSync(resolve(srcDir, 'export/exportTreeBuilder.js'), 'utf8');
    dom.window.eval(builderSrc);

    const setOnlySelectionCalls = [];
    dom.window.ExportTreeUI = class {
      constructor() {}
      setSelectionChangeCallback() {}
      render() {}
      setOnlySelection(nodeId) { setOnlySelectionCalls.push(nodeId); }
      getSelection() {
        return { hasSelection: true, isFullBoard: false, summary: { key: 'selection' }, columnIndexes: [], columnIds: [], scopes: [] };
      }
    };

    const boardData = {
      filePath: '/notes/board.md',
      rows: [
        {
          title: 'Row 0',
          stacks: [
            { title: 'S0', columns: [{ title: 'A', id: 'a' }] },
            { title: 'S1', columns: [{ title: 'B', id: 'b' }] },
          ],
        },
      ],
    };
    const ui = new ExportUI();
    await ui.init('board-id', boardData, { selection: { scope: 'stack', rowIndex: 0, stackIndex: 1 } });

    expect(setOnlySelectionCalls).toContain('stack-0-1');
  });

  it('falls back to root when scope is unknown / unresolved', async () => {
    const builderSrc = readFileSync(resolve(srcDir, 'export/exportTreeBuilder.js'), 'utf8');
    dom.window.eval(builderSrc);

    const setOnlySelectionCalls = [];
    dom.window.ExportTreeUI = class {
      constructor() {}
      setSelectionChangeCallback() {}
      render() {}
      setOnlySelection(nodeId) { setOnlySelectionCalls.push(nodeId); }
      getSelection() {
        return { hasSelection: true, isFullBoard: true, summary: { key: 'full' }, columnIndexes: [], columnIds: [], scopes: [] };
      }
    };

    const boardData = {
      filePath: '/x/y.md',
      rows: [{ title: 'Row', stacks: [{ title: 'S', columns: [{ title: 'c', id: 'c' }] }] }],
    };
    const ui = new ExportUI();
    // Pass a row index that doesn't exist — should fall back to 'root'.
    await ui.init('b', boardData, { selection: { scope: 'row', rowIndex: 99 } });
    expect(setOnlySelectionCalls).toContain('root');
  });

  it('re-applies the stored non-custom preset on dialog open (marp-presentation ticks Watch / Preview)', async () => {
    // Regression guard: individual field values for a preset (runMarp,
    // marpFormat, marpWatch, autoExportOnSave…) are not persisted
    // one-by-one. The preset IS persisted. On re-open we re-apply the
    // preset so its fields (like "Watch / Preview") take effect instead
    // of reverting to their HTML defaults.
    dom.window.localStorage.setItem('lexera-export-preset', 'marp-presentation');

    // Ensure the export-marp-enabled/watch checkboxes start UNchecked
    // (simulating the HTML defaults, which is what the user saw).
    dom.window.document.getElementById('export-marp-enabled') || (() => {
      const f = dom.window.document.body;
      f.insertAdjacentHTML('beforeend', `
        <select id="export-preset"><option value="marp-presentation">Marp</option><option value="custom">Custom</option></select>
        <input id="export-marp-enabled" type="checkbox">
        <input id="export-marp-watch" type="checkbox">
        <select id="export-marp-format"><option value="html"></option><option value="pdf"></option></select>
        <select id="export-marp-browser"><option value="chrome"></option></select>
        <input id="export-auto-export-on-save" type="checkbox">
        <select id="export-tag-visibility"><option value="all"></option><option value="none"></option></select>
        <input id="export-strip-includes" type="checkbox">
        <input id="export-marp-pptx-editable" type="checkbox">
        <input id="export-marp-handout" type="checkbox">
        <select id="export-marp-handout-preset"><option value="2x2"></option></select>
        <select id="export-marp-handout-direction"><option value="horizontal"></option></select>
        <select id="export-speaker-notes"><option value="comment"></option></select>
        <select id="export-html-comments"><option value="keep"></option></select>
        <select id="export-html-content"><option value="keep"></option></select>
        <select id="export-embed-handling"><option value="url"></option></select>
        <input id="export-pandoc-enabled" type="checkbox">
        <select id="export-pandoc-format"><option value="docx"></option></select>
        <select id="export-pandoc-page-breaks"><option value="continuous"></option></select>
        <input id="export-exclude-enabled" type="checkbox">
        <input id="export-exclude-tags">
        <select id="export-link-handling-mode"><option value="rewrite-only"></option><option value="pack-all"></option></select>
        <input id="export-pack-files" type="checkbox">
        <input id="export-pack-images" type="checkbox">
        <input id="export-pack-videos" type="checkbox">
        <input id="export-pack-other-media" type="checkbox">
        <input id="export-pack-documents" type="checkbox">
        <input id="export-pack-file-size-limit" type="number" value="100">
        <input id="export-marp-engine-path">
      `);
      return true;
    })();

    const boardData = {
      filePath: '/tmp/b.md',
      rows: [{ title: 'R', stacks: [{ title: 'S', columns: [{ id: 'c', title: 'C' }] }] }],
    };

    const builderSrc = readFileSync(resolve(srcDir, 'export/exportTreeBuilder.js'), 'utf8');
    dom.window.eval(builderSrc);
    dom.window.ExportTreeUI = class {
      constructor() {}
      setSelectionChangeCallback() {}
      render() {}
      setOnlySelection() {}
      getSelection() { return { hasSelection: true, isFullBoard: true, summary: { key: 'full' } }; }
    };

    const ui = new ExportUI();
    await ui.init('b', boardData, null);

    const watchCb = dom.window.document.getElementById('export-marp-watch');
    const marpCb = dom.window.document.getElementById('export-marp-enabled');
    const autoCb = dom.window.document.getElementById('export-auto-export-on-save');
    expect(watchCb.checked).toBe(true);
    expect(marpCb.checked).toBe(true);
    expect(autoCb.checked).toBe(true);
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
