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
 * The three implementations under test:
 *
 *   1. `rowsFromLegacyColumns(columns, boardTitle)`
 *      in `lexera-kanban/src/board/boardList.js`
 *      - Delegates to the shared frontend converter
 *        `orderHelpers.buildRowsFromLegacyColumns(...)`.
 *      - Exists today as a boardList-facing adapter only; it should not own
 *        its own legacy normalization logic anymore.
 *
 *   2. `buildRowsFromLegacyColumns(cols, fallbackTitle)`
 *      in `lexera-kanban/src/board/orderHelpers.js`
 *      - Honors both `#rowN` and `#stack` tags.
 *      - Produces one row per `#rowN` value (default 1).
 *      - Stack title comes from the first column in the stack.
 *      - Row title is `"Row N"` when multi-row, else the fallback title.
 *      - No hidden-item filtering.
 *
 *   3. `ExportTreeBuilder.rowsFromLegacyColumns(columns)` (static method)
 *      in `lexera-kanban/src/export/exportTreeBuilder.js`
 *      - Honors both `#rowN` and `#stack` tags.
 *      - Filters hidden items (via `isHiddenItem`).
 *      - Stack title is `"Stack N"` when multi-column, else the column title.
 *      - Row title is always `"Row N"`.
 *      - Does not accept a fallback title.
 *
 * These tests are pinning the current behaviour while the legacy-retirement
 * work is in flight. The frontend `boardList.js` adapter SHOULD now agree
 * with `orderHelpers.js`; the remaining divergence is the export/backend side.
 * When the cleanup lands and deletes the legacy adapters entirely, these tests
 * should be deleted along with them.
 */

// ─── Loader: boardList.js IIFE ─────────────────────────────────────────────
//
// `rowsFromLegacyColumns` in boardList.js now delegates to the injected shared
// converter contract `normalizeLegacyColumnsToRows(...)`, so we inject it here.

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

  const sharedConverter = loadOrderHelpersConverter();

  // Inject the shared legacy-normalization contract that boardList depends on.
  BoardList.init({
    get embeddedMode() { return false; },
    renderBoardList() {},
    normalizeLegacyColumnsToRows: sharedConverter,
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

  const titleHelpersSource = fs.readFileSync(
    path.resolve('src/titleHelpers.js'),
    'utf8'
  );

  // Wrap all so they install themselves on a shared globalThis.
  const factory = new Function(
    'globalThis', 'console',
    `
    var window = globalThis;
    ${titleHelpersSource}
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
  const titleHelpersSource2 = fs.readFileSync(
    path.resolve('src/titleHelpers.js'),
    'utf8'
  );
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
    ${titleHelpersSource2}
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
  // These tests now assert that the two frontend callers share one converter
  // contract. The remaining divergence is still pinned separately against the
  // exportTreeBuilder variant.

  describe('boardList.js :: rowsFromLegacyColumns', () => {
    it('honors #rowN via the shared frontend converter', () => {
      const r1 = boardListConverter(INPUT_FLAT, 'Board');
      const r2 = boardListConverter(INPUT_ROW_TAG, 'Board');
      const r3 = boardListConverter(INPUT_ROW_AND_STACK, 'Board');
      expect(r1).toHaveLength(1);
      expect(r2).toHaveLength(2);
      expect(r3).toHaveLength(2);
      expect(r1[0].title).toBe('Board');
      expect(r2[0].title).toBe('Row 1');
      expect(r2[1].title).toBe('Row 2');
    });

    it('uses the shared stack-title semantics from orderHelpers', () => {
      const rows = boardListConverter(INPUT_STACK_TAG, 'Board');
      expect(rows[0].stacks).toHaveLength(2);
      expect(rows[0].stacks[0].title).toBe('Todo');
      expect(rows[0].stacks[1].title).toBe('Done');
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

  describe('documented cross-converter relationships', () => {
    it('boardList and orderHelpers agree on #rowN handling', () => {
      const fromBoardList = boardListConverter(INPUT_ROW_TAG, 'Board');
      const fromOrderHelpers = orderHelpersConverter(INPUT_ROW_TAG, 'Board');
      expect(fromBoardList).toEqual(fromOrderHelpers);
    });

    it('frontend single-row titles agree; export still uses "Row 1"', () => {
      const fromBoardList = boardListConverter(INPUT_FLAT, 'Project X');
      const fromOrderHelpers = orderHelpersConverter(INPUT_FLAT, 'Project X');
      const fromExport = exportTreeBuilderConverter(INPUT_FLAT);

      expect(fromBoardList[0].title).toBe('Project X');
      expect(fromOrderHelpers[0].title).toBe('Project X');
      expect(fromExport[0].title).toBe('Row 1');
    });

    it('frontend stack titles agree; export keeps its hybrid rule', () => {
      const fromBoardList = boardListConverter(INPUT_STACK_TAG, 'Board');
      const fromOrderHelpers = orderHelpersConverter(INPUT_STACK_TAG, 'Board');
      const fromExport = exportTreeBuilderConverter(INPUT_STACK_TAG);

      expect(fromBoardList).toEqual(fromOrderHelpers);
      expect(fromOrderHelpers[0].stacks[0].title).toBe('Todo');
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

// ──────────────────────────────────────────────────────────────────────
// Frontend-wide legacy reintroduction budget
//
// Beyond the three legacy converters above, there are two other patterns
// that the legacy-retirement cleanup will eventually have to eliminate:
//
//   1. Flat-column property reads — `fullBoardData.columns`, `boardData.columns`,
//      `board.columns`, `bd.columns`, `fullBoard.columns`. Every one of these
//      is a runtime assumption that flat columns might still be authoritative.
//      The cleanup will either migrate the read to use `rows[]` or push it
//      across the import boundary. In the meantime, new occurrences must be
//      blocked so the cleanup work's target keeps shrinking, not growing.
//
//   2. Format-gate branches — `if (x.rows && x.rows.length > 0) { rows path }
//      else { columns fallback }`. These are the explicit "pick a shape at
//      runtime" tests. Same reasoning: pin the current count, block new ones.
//
// Both budgets below are file + count tuples captured mechanically against
// the current tree (2026-04-05). A failing assertion means either:
//   (a) someone added a new reference, which must be justified, or
//   (b) cleanup work intentionally removed one, in which case the budget
//       number should be lowered in this file in the same commit.
//
// The tests also enforce that NO file outside the allow-list contains any
// flat-column reference — that blocks the pattern from spreading to new
// modules during feature work.
// ──────────────────────────────────────────────────────────────────────

function walkJsFiles(startDir) {
  const results = [];
  const stack = [startDir];
  while (stack.length > 0) {
    const dir = stack.pop();
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // Skip vendor and node_modules copies shipped inside src/.
        if (entry.name === 'vendor' || entry.name === 'node_modules') continue;
        stack.push(full);
      } else if (entry.isFile() && entry.name.endsWith('.js')) {
        results.push(full);
      }
    }
  }
  return results;
}

function srcRelative(absPath) {
  // Normalize to a 'src/…' string for assertion messages.
  const idx = absPath.indexOf('/src/');
  return idx >= 0 ? 'src' + absPath.slice(idx + 4) : absPath;
}

// Allowed flat-column reference budget per file. Captured 2026-04-05 by
// running:
//   node -e 'const fs=require("fs");
//            const re = /\b(?:fullBoard|fullBoardData|boardData|board|bd)\.columns\b/g;
//            files.forEach(f => console.log(f, (fs.readFileSync(f, "utf8").match(re) || []).length))'
// over the union of files returned by walkJsFiles().
//
// Every file NOT in this map must have zero flat-column references.
const FLAT_COLUMN_BUDGET = {
  // saveCurrentBoardForTestFixture() — a test-only helper exposed on
  // LexeraDashboard — defensively ensures `fullBoardData.columns = []`
  // before handing the board to the save pipeline. Not production code
  // path; kept in app.js because it closes over activeBoardId and the
  // full-board state there.
  'src/app.js': 2,
  'src/core/boardDataStore.js': 19,
  'src/board/boardList.js': 10,
  'src/export/exportTreeBuilder.js': 3,
  'src/editor/editorAutocomplete.js': 2,
  'src/undo/boardDelta.js': 2,
  // Test harness: normalizeBoardForBackendTest guarantees both legacy
  // (.columns) and modern (.rows) fields exist on a fixture before
  // feeding it to the backend-facing test helpers. Not production code.
  'src/test/frontendTests.js': 2,
};

// Allowed format-gate branch budget per file. Captured 2026-04-05 by
// enumerating occurrences of `<ident>.rows && <ident>.rows.length > 0`
// (and the Array.isArray variant) across all src/**/*.js files. Includes
// both legacy format-choice branches (app.js:2679, app.js:5680, etc.) and
// "do I have any rows at all?" guards (app.js:10366, app.js:10369). The
// cleanup task will have to justify and remove each one; the count should
// only ever decrease.
const FORMAT_GATE_BUDGET = {
  'src/app.js': 0,
  'src/core/boardDataStore.js': 2,
  'src/board/boardList.js': 2,
  'src/core/actionRegistrations.js': 2,
  'src/export/exportTreeBuilder.js': 1,
  // Test harness: setup() / assertBoardIntegrity / findTwoColumnsWithCards
  // all guard on `data.rows && data.rows.length > 0` before walking the
  // fixture. Not production code.
  'src/test/frontendTests.js': 3,
};

const FLAT_COLUMN_RE = /\b(?:fullBoard|fullBoardData|boardData|board|bd)\.columns\b/g;
const FORMAT_GATE_RE_A = /\b(\w+)\.rows\s*&&\s*\1\.rows\.length\s*>\s*0/g;
const FORMAT_GATE_RE_B = /Array\.isArray\(\s*\w+\.rows\s*\)\s*&&\s*\w+\.rows\.length\s*>\s*0/g;

function countMatches(source, re) {
  // Reset lastIndex every call — these are global regexes with state.
  re.lastIndex = 0;
  const matches = source.match(re);
  return matches ? matches.length : 0;
}

describe('legacy reintroduction budgets — frontend-wide', () => {
  // Resolve the absolute src directory the same way the converter loaders do.
  const srcDir = path.resolve('src');

  it('flat-column reads stay within the per-file budget', () => {
    const files = walkJsFiles(srcDir);
    const actual = {};
    for (const absPath of files) {
      const rel = srcRelative(absPath);
      const source = fs.readFileSync(absPath, 'utf8');
      const count = countMatches(source, FLAT_COLUMN_RE);
      if (count > 0) actual[rel] = count;
    }
    // Detect newcomers (not in the budget): hard fail, these cannot slip in.
    const newcomers = Object.keys(actual).filter((k) => !(k in FLAT_COLUMN_BUDGET));
    expect(
      newcomers,
      'new files introduced flat-column reads — add them to FLAT_COLUMN_BUDGET only after review'
    ).toEqual([]);
    // Per-file counts must match the pinned budget. Any growth fails.
    for (const file of Object.keys(FLAT_COLUMN_BUDGET)) {
      expect(
        actual[file] || 0,
        'flat-column reference count changed in ' + file +
          ' — update FLAT_COLUMN_BUDGET (only decreases are OK)'
      ).toBe(FLAT_COLUMN_BUDGET[file]);
    }
  });

  it('format-gate branches stay within the per-file budget', () => {
    const files = walkJsFiles(srcDir);
    const actual = {};
    for (const absPath of files) {
      const rel = srcRelative(absPath);
      const source = fs.readFileSync(absPath, 'utf8');
      const count = countMatches(source, FORMAT_GATE_RE_A) + countMatches(source, FORMAT_GATE_RE_B);
      if (count > 0) actual[rel] = count;
    }
    const newcomers = Object.keys(actual).filter((k) => !(k in FORMAT_GATE_BUDGET));
    expect(
      newcomers,
      'new files introduced "if rows.length > 0" format-gate branches — add them to FORMAT_GATE_BUDGET only after review'
    ).toEqual([]);
    for (const file of Object.keys(FORMAT_GATE_BUDGET)) {
      expect(
        actual[file] || 0,
        'format-gate branch count changed in ' + file +
          ' — update FORMAT_GATE_BUDGET (only decreases are OK)'
      ).toBe(FORMAT_GATE_BUDGET[file]);
    }
  });

  it('every file listed in FLAT_COLUMN_BUDGET still exists', () => {
    // Catches the case where the cleanup work DELETED a file entirely. If
    // the file is gone, its budget entry must be removed in the same commit.
    for (const file of Object.keys(FLAT_COLUMN_BUDGET)) {
      const absPath = path.resolve(file);
      expect(
        fs.existsSync(absPath),
        'FLAT_COLUMN_BUDGET lists ' + file + ' but the file no longer exists — remove the entry'
      ).toBe(true);
    }
  });

  it('every file listed in FORMAT_GATE_BUDGET still exists', () => {
    for (const file of Object.keys(FORMAT_GATE_BUDGET)) {
      const absPath = path.resolve(file);
      expect(
        fs.existsSync(absPath),
        'FORMAT_GATE_BUDGET lists ' + file + ' but the file no longer exists — remove the entry'
      ).toBe(true);
    }
  });
});

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
