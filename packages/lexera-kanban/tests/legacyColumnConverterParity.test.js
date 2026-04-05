import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

/**
 * Parity baseline for the three legacy flat-column → rows/stacks/columns
 * converters that currently live in the kanban frontend.
 *
 * Background: the todo-list's "Legacy retirement — one canonical codepath"
 * section calls for DELETING all three and replacing them with a single
 * import-boundary adapter. Before that cleanup can safely happen, we need a
 * record of what each implementation currently produces for the same inputs —
 * because they diverge in ways that are not documented anywhere else.
 *
 * The three implementations:
 *
 *   1. `rowsFromLegacyColumns(columns, boardTitle)`
 *      in `packages/lexera-kanban/src/board/boardList.js`
 *      - Groups ONLY by `#stack` tag. Ignores `#rowN`.
 *      - Always produces exactly one row titled after the board.
 *      - Stack titles are always `"Stack N"`.
 *      - No hidden-item filtering.
 *
 *   2. `buildRowsFromLegacyColumns(cols, fallbackTitle)`
 *      in `packages/lexera-kanban/src/board/orderHelpers.js`
 *      - Honors both `#rowN` and `#stack` tags.
 *      - Produces one row per `#rowN` value (default 1).
 *      - Stack title comes from the first column in the stack.
 *      - Row title is `"Row N"` when multi-row, else the fallback title.
 *      - No hidden-item filtering.
 *
 *   3. `ExportTreeBuilder.rowsFromLegacyColumns(columns)` (static method)
 *      in `packages/lexera-kanban/src/export/exportTreeBuilder.js`
 *      - Honors both `#rowN` and `#stack` tags.
 *      - Filters hidden items (via `isHiddenItem`).
 *      - Stack title is `"Stack N"` when multi-column, else the column title.
 *      - Row title is always `"Row N"`.
 *      - Does not accept a fallback title.
 *
 * These tests are NOT asserting that the converters agree — they currently
 * do not. They are pinning the observable behaviour so the future unification
 * work (todo.md "Legacy retirement" section) has a clear, mechanical diff to
 * reason against. When the cleanup lands and deletes all three, these tests
 * should be deleted along with them.
 */

// ─── Loader: boardList.js IIFE ─────────────────────────────────────────────
//
// `rowsFromLegacyColumns` in boardList.js calls `_callDep('hasTag', ...)` and
// `_callDep('stripStackTag', ...)`, which means we need to inject those deps
// via `LexeraBoardList.init(...)` before invoking the function.

function loadBoardListConverter() {
  const source = fs.readFileSync(
    path.resolve('src/board/boardList.js'),
    'utf8'
  );

  const sandbox = {
    console,
    Date,
    JSON,
    Promise,
    setTimeout,
    clearTimeout,
    structuredClone,
    localStorage: {
      getItem() { return null; },
      setItem() {},
      removeItem() {},
    },
    lexeraLog: () => {},
    logFrontendIssue: () => {},
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;

  // Execute the source in an isolated scope and grab LexeraBoardList off the
  // synthetic window we handed in.
  const factory = new Function(
    'console', 'Date', 'JSON', 'Promise', 'setTimeout', 'clearTimeout',
    'structuredClone', 'localStorage', 'lexeraLog', 'logFrontendIssue',
    'window', 'globalThis',
    `
    ${source}
    return window.LexeraBoardList;
    `
  );

  const BoardList = factory(
    sandbox.console, sandbox.Date, sandbox.JSON, sandbox.Promise,
    sandbox.setTimeout, sandbox.clearTimeout, sandbox.structuredClone,
    sandbox.localStorage, sandbox.lexeraLog, sandbox.logFrontendIssue,
    sandbox.window, sandbox.globalThis
  );

  // Inject the deps that rowsFromLegacyColumns actually uses.
  BoardList.init({
    get embeddedMode() { return false; },
    renderBoardList() {},
    hasTag(text, tag) {
      return typeof text === 'string' && text.indexOf(tag) !== -1;
    },
    stripStackTag(title) {
      return String(title || '').replace(/\s*#stack\b/g, '').replace(/\s+/g, ' ').trim();
    },
  });

  return BoardList.rowsFromLegacyColumns;
}

// ─── Loader: orderHelpers.js IIFE (shared with appUtils.test.js pattern) ───
//
// orderHelpers.js depends on a TagSystem global. We preload it the same way
// `appUtils.test.js` does so the conversion logic has the symbols it needs.

const require = createRequire(import.meta.url);

function loadOrderHelpersConverter() {
  // Preload globals that orderHelpers.js references at call time.
  const tagSystemSource = fs.readFileSync(
    path.resolve('src/tagSystem.js'),
    'utf8'
  );
  const tagColorsSource = fs.readFileSync(
    path.resolve('src/tagcolors/tagColors.js'),
    'utf8'
  );
  const orderHelpersSource = fs.readFileSync(
    path.resolve('src/board/orderHelpers.js'),
    'utf8'
  );

  // Wrap all three so they install themselves on a shared globalThis.
  const factory = new Function(
    'globalThis', 'console',
    `
    var window = globalThis;
    ${tagSystemSource}
    ${tagColorsSource}
    ${orderHelpersSource}
    return globalThis.LexeraOrderHelpers;
    `
  );
  const scope = {};
  scope.globalThis = scope;
  const OrderHelpers = factory(scope, console);

  // orderHelpers.js's buildRowsFromLegacyColumns reads from `_dep('LexeraTagSystem')`
  // and `getColumnLayoutTags` / `getLegacyImportRowNumber` / `stripLegacyImportStructureTags`
  // which are all local to the module, so minimal init is enough.
  OrderHelpers.init({
    LexeraTagSystem: scope.LexeraTagSystem,
    hasTag(text, tag) {
      return typeof text === 'string' && text.indexOf(tag) !== -1;
    },
  });

  return OrderHelpers.buildRowsFromLegacyColumns;
}

// ─── Loader: exportTreeBuilder.js static method ────────────────────────────
//
// ExportTreeBuilder is a plain ES class in a non-module file, so we execute it
// the same way and grab the static method. It references `LexeraTagSystem` as
// a free global, so we preload that too.

function loadExportTreeBuilderConverter() {
  const tagSystemSource = fs.readFileSync(
    path.resolve('src/tagSystem.js'),
    'utf8'
  );
  const exportTreeBuilderSource = fs.readFileSync(
    path.resolve('src/export/exportTreeBuilder.js'),
    'utf8'
  );

  const factory = new Function(
    'globalThis',
    `
    var window = globalThis;
    ${tagSystemSource}
    ${exportTreeBuilderSource}
    return globalThis.ExportTreeBuilder;
    `
  );
  const scope = {};
  scope.globalThis = scope;
  const ExportTreeBuilder = factory(scope);
  return ExportTreeBuilder.rowsFromLegacyColumns.bind(ExportTreeBuilder);
}

// ─── Shared test inputs ────────────────────────────────────────────────────

const INPUT_FLAT = [
  { id: 'c1', index: 0, title: 'Todo', cards: [] },
  { id: 'c2', index: 1, title: 'Doing', cards: [] },
  { id: 'c3', index: 2, title: 'Done', cards: [] },
];

const INPUT_STACK_TAG = [
  { id: 'c1', index: 0, title: 'Todo', cards: [] },
  { id: 'c2', index: 1, title: 'Doing #stack', cards: [] },
  { id: 'c3', index: 2, title: 'Done', cards: [] },
];

const INPUT_ROW_TAG = [
  { id: 'c1', index: 0, title: 'Todo', cards: [] },
  { id: 'c2', index: 1, title: 'Backlog #row2', cards: [] },
  { id: 'c3', index: 2, title: 'Doing #row2', cards: [] },
  { id: 'c4', index: 3, title: 'Done', cards: [] },
];

const INPUT_ROW_AND_STACK = [
  { id: 'c1', index: 0, title: 'Todo', cards: [] },
  { id: 'c2', index: 1, title: 'Backlog #row2', cards: [] },
  { id: 'c3', index: 2, title: 'Doing #row2 #stack', cards: [] },
  { id: 'c4', index: 3, title: 'Done', cards: [] },
];

// ─── Load once, reuse across tests ─────────────────────────────────────────

const boardListConverter = loadBoardListConverter();
const orderHelpersConverter = loadOrderHelpersConverter();
const exportTreeBuilderConverter = loadExportTreeBuilderConverter();

describe('legacy flat-column converter parity baseline', () => {
  // These tests deliberately do NOT assert equality across converters.
  // They pin the observable output of each so the upcoming deletion work
  // can verify it's deleting the right code, and so any accidental edit
  // to one converter without updating the others gets caught immediately.

  describe('boardList.js :: rowsFromLegacyColumns', () => {
    it('produces exactly one row for any input (ignores #rowN)', () => {
      const r1 = boardListConverter(INPUT_FLAT, 'Board');
      const r2 = boardListConverter(INPUT_ROW_TAG, 'Board');
      const r3 = boardListConverter(INPUT_ROW_AND_STACK, 'Board');
      expect(r1).toHaveLength(1);
      expect(r2).toHaveLength(1);
      expect(r3).toHaveLength(1);
      // Row title is always the board title, never "Row 1"
      expect(r1[0].title).toBe('Board');
      expect(r2[0].title).toBe('Board');
    });

    it('groups by #stack only, stack titles are always "Stack N"', () => {
      const rows = boardListConverter(INPUT_STACK_TAG, 'Board');
      expect(rows[0].stacks).toHaveLength(2);
      expect(rows[0].stacks[0].title).toBe('Stack 1');
      expect(rows[0].stacks[1].title).toBe('Stack 2');
      // Stack 1 has Todo+Doing (Doing is attached because it has #stack)
      expect(rows[0].stacks[0].columns.map((c) => c.title)).toEqual(['Todo', 'Doing']);
      expect(rows[0].stacks[1].columns.map((c) => c.title)).toEqual(['Done']);
    });

    it('returns [] for empty input', () => {
      expect(boardListConverter([], 'Board')).toEqual([]);
    });
  });

  describe('orderHelpers.js :: buildRowsFromLegacyColumns', () => {
    it('honors #rowN, producing one row per row-number', () => {
      const rows = orderHelpersConverter(INPUT_ROW_TAG, 'Board');
      expect(rows).toHaveLength(2);
      expect(rows[0].title).toBe('Row 1');
      expect(rows[1].title).toBe('Row 2');
      // Row 1 has Todo and Done
      expect(rows[0].stacks.flatMap((s) => s.columns.map((c) => c.title))).toEqual(['Todo', 'Done']);
      // Row 2 has Backlog and Doing
      expect(rows[1].stacks.flatMap((s) => s.columns.map((c) => c.title))).toEqual(['Backlog', 'Doing']);
    });

    it('uses the fallback title when there is only one row', () => {
      const rows = orderHelpersConverter(INPUT_FLAT, 'My Board');
      expect(rows).toHaveLength(1);
      expect(rows[0].title).toBe('My Board');
    });

    it('stack title comes from the first column in each stack', () => {
      const rows = orderHelpersConverter(INPUT_STACK_TAG, 'Board');
      expect(rows[0].stacks).toHaveLength(2);
      // First stack's first column is Todo → stack title 'Todo'
      expect(rows[0].stacks[0].title).toBe('Todo');
      expect(rows[0].stacks[0].columns.map((c) => c.title)).toEqual(['Todo', 'Doing']);
      // Second stack has one column, Done
      expect(rows[0].stacks[1].title).toBe('Done');
    });

    it('returns [] for empty input', () => {
      expect(orderHelpersConverter([], 'Board')).toEqual([]);
    });
  });

  describe('exportTreeBuilder.js :: ExportTreeBuilder.rowsFromLegacyColumns', () => {
    it('honors #rowN and produces numbered row titles', () => {
      const rows = exportTreeBuilderConverter(INPUT_ROW_TAG);
      expect(rows).toHaveLength(2);
      expect(rows[0].title).toBe('Row 1');
      expect(rows[1].title).toBe('Row 2');
    });

    it('does not accept a fallback title — single-row boards are still "Row 1"', () => {
      // This is the key divergence from orderHelpers.js: regardless of the
      // board title, the ExportTreeBuilder variant always labels rows by
      // number. (It doesn't even take a fallback title parameter.)
      const rows = exportTreeBuilderConverter(INPUT_FLAT);
      expect(rows).toHaveLength(1);
      expect(rows[0].title).toBe('Row 1');
    });

    it('returns [] for empty input', () => {
      expect(exportTreeBuilderConverter([])).toEqual([]);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Explicit DIVERGENCE pins — these are the concrete mismatches that the
  // legacy-retirement cleanup task has to reconcile. If any of them start
  // agreeing by accident, the future deletion work becomes cheaper; if any
  // stop agreeing with themselves across runs, we've introduced a silent
  // regression.
  // ──────────────────────────────────────────────────────────────────────

  describe('documented cross-converter divergences', () => {
    it('boardList ignores #rowN; the other two honor it', () => {
      const fromBoardList = boardListConverter(INPUT_ROW_TAG, 'Board');
      const fromOrderHelpers = orderHelpersConverter(INPUT_ROW_TAG, 'Board');
      const fromExport = exportTreeBuilderConverter(INPUT_ROW_TAG);

      expect(fromBoardList).toHaveLength(1);      // collapses to one row
      expect(fromOrderHelpers).toHaveLength(2);   // splits by #row2
      expect(fromExport).toHaveLength(2);         // splits by #row2
    });

    it('single-row titles differ: boardList=boardTitle, orderHelpers=fallback, export="Row 1"', () => {
      const fromBoardList = boardListConverter(INPUT_FLAT, 'Project X');
      const fromOrderHelpers = orderHelpersConverter(INPUT_FLAT, 'Project X');
      const fromExport = exportTreeBuilderConverter(INPUT_FLAT);

      expect(fromBoardList[0].title).toBe('Project X');
      expect(fromOrderHelpers[0].title).toBe('Project X');
      expect(fromExport[0].title).toBe('Row 1');
    });

    it('stack titles differ: boardList="Stack N", orderHelpers=first column, export hybrid', () => {
      const fromBoardList = boardListConverter(INPUT_STACK_TAG, 'Board');
      const fromOrderHelpers = orderHelpersConverter(INPUT_STACK_TAG, 'Board');
      const fromExport = exportTreeBuilderConverter(INPUT_STACK_TAG);

      // boardList: always "Stack N"
      expect(fromBoardList[0].stacks[0].title).toBe('Stack 1');
      // orderHelpers: first column title ("Todo")
      expect(fromOrderHelpers[0].stacks[0].title).toBe('Todo');
      // exportTreeBuilder: "Stack N" when >1 column, else the column title
      expect(fromExport[0].stacks[0].title).toBe('Stack 1'); // 2 cols → numbered
    });
  });
});

// ──────────────────────────────────────────────────────────────────────
// Hard invariant: lock in the current source-level call-site count for
// each legacy converter. Future code MUST NOT add a new runtime caller;
// when the legacy-retirement task deletes the converters, these counts
// go to 0 and the tests can be deleted too.
// ──────────────────────────────────────────────────────────────────────

describe('legacy converter call-site invariants', () => {
  // These tests pin the current number of regex-matched references to the
  // legacy converters per file. The goal is NOT to count call sites exactly —
  // it's to detect *any* change (new caller, new export, deletion, etc.) so
  // the legacy-retirement cleanup either keeps the counts stable during an
  // intermediate refactor or drives them to zero.
  //
  // Each count is the output of `String.prototype.match(/\b<name>\b/g)`, so
  // declarations, exports, runtime calls, and `name: name` object-literal
  // shorthands all contribute. The numbers below were captured mechanically
  // against the current tree; when legacy code is removed they go down, and
  // the tests can be deleted along with the last converter.

  function countMatchesInFile(filename, pattern) {
    const source = fs.readFileSync(
      path.resolve('src/' + filename),
      'utf8'
    );
    const matches = source.match(pattern);
    return matches ? matches.length : 0;
  }

  it('boardList.js references to `rowsFromLegacyColumns` stay at 4', () => {
    // Captured 2026-04-05:
    //   line 826  function rowsFromLegacyColumns(columns, boardTitle) {
    //   line 874  return rowsFromLegacyColumns(fullBoard.columns, …);
    //   line 2205 rowsFromLegacyColumns: rowsFromLegacyColumns,   (× 2 matches)
    // Total = 4 regex matches.
    expect(countMatchesInFile('board/boardList.js', /\browsFromLegacyColumns\b/g)).toBe(4);
  });

  it('orderHelpers.js references to `buildRowsFromLegacyColumns` stay at 3', () => {
    // Captured 2026-04-05:
    //   line 183  function buildRowsFromLegacyColumns(cols, fallbackTitle) {
    //   line 3017 buildRowsFromLegacyColumns: buildRowsFromLegacyColumns,  (× 2)
    // Total = 3. There is no internal runtime caller in this file;
    // consumers live in app.js.
    expect(countMatchesInFile('board/orderHelpers.js', /\bbuildRowsFromLegacyColumns\b/g)).toBe(3);
  });

  it('app.js references to `buildRowsFromLegacyColumns` stay at 4', () => {
    // Captured 2026-04-05:
    //   line 1081  function buildRowsFromLegacyColumns(...)
    //              { return OrderHelpers.buildRowsFromLegacyColumns(...); } (× 2)
    //   line 2685  fullBoardData.rows = buildRowsFromLegacyColumns(cols, …);
    //   line 5690  boardData.rows = buildRowsFromLegacyColumns(cols, …);
    // Total = 4. A new caller bumps this to 5 and fails the test.
    expect(countMatchesInFile('app.js', /\bbuildRowsFromLegacyColumns\b/g)).toBe(4);
  });

  it('app.js references to `rowsFromLegacyColumns` (boardList variant) stay at 2', () => {
    // Captured 2026-04-05:
    //   line 2335 function rowsFromLegacyColumns(...)
    //             { return _bl('rowsFromLegacyColumns', ...); }   (× 2)
    // Total = 2 — the delegating wrapper and its inner reference. Any direct
    // call outside this wrapper bumps the count and fails.
    expect(countMatchesInFile('app.js', /\browsFromLegacyColumns\b/g)).toBe(2);
  });

  it('exportTreeBuilder.js references to `rowsFromLegacyColumns` stay at 2', () => {
    // Captured 2026-04-05:
    //   line 121 return this.rowsFromLegacyColumns(board.columns);
    //   line 126 static rowsFromLegacyColumns(columns) {
    // Total = 2. Note: this is a SEPARATE static-method implementation,
    // not a wrapper around the boardList variant. It must be deleted
    // alongside the other two in the legacy-retirement cleanup.
    expect(countMatchesInFile('export/exportTreeBuilder.js', /\browsFromLegacyColumns\b/g)).toBe(2);
  });
});
