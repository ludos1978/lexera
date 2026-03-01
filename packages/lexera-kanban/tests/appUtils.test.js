import { describe, it, expect, vi, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ── Bootstrap ──────────────────────────────────────────────────────────────
// app.js is a large IIFE (LexeraDashboard) that runs DOM code on evaluation.
// We cannot safely evaluate the full file, so we extract the pure utility
// functions from the source text and evaluate them in a minimal sandbox.

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, '..', 'src');

/**
 * Reads app.js and extracts named function bodies by line range, then evaluates
 * them together so mutual dependencies (e.g. stripPathSearchAndHash uses
 * isExternalHttpUrl) are available. Returns an object with each function by name.
 */
function loadAppUtils() {
  const source = readFileSync(resolve(srcDir, 'app.js'), 'utf-8');
  const lines = source.split('\n');

  // Extract a function starting at the given 1-based line number.
  // Scans forward to find the matching closing brace.
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

  // Find 1-based line number for a function definition
  function findLine(pattern) {
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(pattern)) return i + 1;
    }
    throw new Error('Could not find: ' + pattern);
  }

  // Extract all needed functions
  const fnDefs = [
    // Global-scope functions (before the IIFE)
    extractFunction(findLine('function normalizeLogMessage(')),
    extractFunction(findLine('function formatErrorDetails(')),

    // Functions inside the IIFE — extract them individually
    extractFunction(findLine('function normalizePathForCompare(')),
    extractFunction(findLine('function isExternalHttpUrl(')),
    extractFunction(findLine('function stripPathSearchAndHash(')),
    extractFunction(findLine('function parseLocalFileReference(')),
    extractFunction(findLine('function stripMarkdownExtension(')),
    extractFunction(findLine('function normalizeWikiLookupKey(')),
    extractFunction(findLine('function stripLayoutTags(')),
    extractFunction(findLine('function getColumnLayoutTags(')),
    extractFunction(findLine('function reconstructColumnTitle(')),
    extractFunction(findLine('function normalizeRatio(')),
    extractFunction(findLine('function reorderItems(')),
    extractFunction(findLine('function normalizeDroppedPath(')),
  ];

  const wrappedSource = `
    ${fnDefs.join('\n\n')}

    return {
      normalizeLogMessage,
      formatErrorDetails,
      normalizePathForCompare,
      parseLocalFileReference,
      normalizeWikiLookupKey,
      stripLayoutTags,
      getColumnLayoutTags,
      reconstructColumnTitle,
      normalizeRatio,
      reorderItems,
      normalizeDroppedPath,
    };
  `;

  // The functions reference URL (global in browser) — Node has it natively.
  const factory = new Function('URL', wrappedSource);
  return factory(URL);
}

let U; // utility functions under test

beforeAll(() => {
  U = loadAppUtils();
});

// ═══════════════════════════════════════════════════════════════════════════
// normalizeLogMessage
// ═══════════════════════════════════════════════════════════════════════════

describe('normalizeLogMessage', () => {
  it('returns "null" for null input', () => {
    expect(U.normalizeLogMessage(null)).toBe('null');
  });

  it('returns "undefined" for undefined input', () => {
    expect(U.normalizeLogMessage(undefined)).toBe('undefined');
  });

  it('returns the string as-is for string input', () => {
    expect(U.normalizeLogMessage('hello world')).toBe('hello world');
  });

  it('returns stack trace for Error objects', () => {
    const err = new Error('boom');
    const result = U.normalizeLogMessage(err);
    // Error with a stack should include the stack trace
    expect(result).toContain('boom');
  });

  it('JSON-stringifies plain objects', () => {
    const obj = { key: 'value', num: 42 };
    expect(U.normalizeLogMessage(obj)).toBe('{"key":"value","num":42}');
  });

  it('handles error-like objects with a message property', () => {
    const errorLike = { message: 'something failed', code: 123 };
    const result = U.normalizeLogMessage(errorLike);
    expect(result).toContain('something failed');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// parseLocalFileReference
// ═══════════════════════════════════════════════════════════════════════════

describe('parseLocalFileReference', () => {
  it('parses a simple file path', () => {
    const result = U.parseLocalFileReference('docs/readme.md');
    expect(result.raw).toBe('docs/readme.md');
    expect(result.path).toBe('docs/readme.md');
    expect(result.pageNumber).toBeNull();
  });

  it('extracts page number from PDF hash fragment', () => {
    const result = U.parseLocalFileReference('report.pdf#5');
    expect(result.path).toBe('report.pdf');
    expect(result.pageNumber).toBe(5);
  });

  it('extracts page number from PDF query parameter (p=)', () => {
    const result = U.parseLocalFileReference('report.pdf?p=3');
    expect(result.path).toBe('report.pdf');
    expect(result.pageNumber).toBe(3);
  });

  it('extracts page number from PDF query parameter (page=)', () => {
    const result = U.parseLocalFileReference('report.pdf?page=10');
    expect(result.path).toBe('report.pdf');
    expect(result.pageNumber).toBe(10);
  });

  it('returns null pageNumber for non-PDF files with hash', () => {
    const result = U.parseLocalFileReference('notes.md#section');
    expect(result.pageNumber).toBeNull();
  });

  it('handles empty/null input gracefully', () => {
    const result = U.parseLocalFileReference('');
    expect(result.raw).toBe('');
    expect(result.path).toBe('');
    expect(result.pageNumber).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// stripLayoutTags
// ═══════════════════════════════════════════════════════════════════════════

describe('stripLayoutTags', () => {
  it('removes #row tag with number', () => {
    expect(U.stripLayoutTags('My Column #row2')).toBe('My Column');
  });

  it('removes #span tag with number', () => {
    expect(U.stripLayoutTags('Title #span3')).toBe('Title');
  });

  it('removes #stack tag', () => {
    expect(U.stripLayoutTags('Column #stack')).toBe('Column');
  });

  it('removes multiple layout tags at once', () => {
    expect(U.stripLayoutTags('Col #row2 #span3 #stack')).toBe('Col');
  });

  it('returns empty string for null/undefined input', () => {
    expect(U.stripLayoutTags(null)).toBe('');
    expect(U.stripLayoutTags(undefined)).toBe('');
  });

  it('preserves title when there are no layout tags', () => {
    expect(U.stripLayoutTags('Regular Title')).toBe('Regular Title');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// normalizeWikiLookupKey
// ═══════════════════════════════════════════════════════════════════════════

describe('normalizeWikiLookupKey', () => {
  it('lowercases the value', () => {
    expect(U.normalizeWikiLookupKey('MyDocument')).toBe('mydocument');
  });

  it('strips .md extension', () => {
    expect(U.normalizeWikiLookupKey('notes.md')).toBe('notes');
  });

  it('converts backslashes to forward slashes and lowercases', () => {
    expect(U.normalizeWikiLookupKey('folder\\subfolder\\file.md')).toBe('folder/subfolder/file');
  });

  it('strips leading ./ prefix', () => {
    expect(U.normalizeWikiLookupKey('./docs/page.md')).toBe('docs/page');
  });

  it('strips leading / prefix', () => {
    expect(U.normalizeWikiLookupKey('/root/page')).toBe('root/page');
  });

  it('handles empty/null input', () => {
    expect(U.normalizeWikiLookupKey('')).toBe('');
    expect(U.normalizeWikiLookupKey(null)).toBe('');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// getColumnLayoutTags
// ═══════════════════════════════════════════════════════════════════════════

describe('getColumnLayoutTags', () => {
  it('extracts #row tag', () => {
    const result = U.getColumnLayoutTags('Title #row2');
    expect(result.row).toBe('#row2');
    expect(result.span).toBe('');
    expect(result.stack).toBe(false);
  });

  it('extracts #span tag', () => {
    const result = U.getColumnLayoutTags('Title #span3');
    expect(result.span).toBe('#span3');
  });

  it('detects #stack tag', () => {
    const result = U.getColumnLayoutTags('Column #stack');
    expect(result.stack).toBe(true);
  });

  it('extracts all layout tags at once', () => {
    const result = U.getColumnLayoutTags('Col #row2 #span4 #stack');
    expect(result.row).toBe('#row2');
    expect(result.span).toBe('#span4');
    expect(result.stack).toBe(true);
  });

  it('returns empty/false for a title with no layout tags', () => {
    const result = U.getColumnLayoutTags('Plain Title');
    expect(result.row).toBe('');
    expect(result.span).toBe('');
    expect(result.stack).toBe(false);
  });

  it('handles null/undefined input', () => {
    const result = U.getColumnLayoutTags(null);
    expect(result.row).toBe('');
    expect(result.span).toBe('');
    expect(result.stack).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// reconstructColumnTitle
// ═══════════════════════════════════════════════════════════════════════════

describe('reconstructColumnTitle', () => {
  it('preserves original layout tags when user input has none', () => {
    const result = U.reconstructColumnTitle('New Title', 'Old Title #row2 #span3');
    expect(result).toBe('New Title #row2 #span3');
  });

  it('user-specified layout tags override originals', () => {
    const result = U.reconstructColumnTitle('Title #row5', 'Old #row2');
    expect(result).toBe('Title #row5');
  });

  it('removes span with #nospan directive', () => {
    const result = U.reconstructColumnTitle('Title #nospan', 'Old #span3');
    expect(result).not.toContain('#span');
    expect(result).toBe('Title');
  });

  it('removes stack with #nostack directive', () => {
    const result = U.reconstructColumnTitle('Title #nostack', 'Old #stack');
    expect(result).not.toContain('#stack');
    expect(result).toBe('Title');
  });

  it('preserves #stack from original when user does not override', () => {
    const result = U.reconstructColumnTitle('New Name', 'Old Name #stack');
    expect(result).toContain('#stack');
  });

  it('drops #row1 because it is the default', () => {
    const result = U.reconstructColumnTitle('Title #row1', '');
    expect(result).toBe('Title');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// normalizeRatio
// ═══════════════════════════════════════════════════════════════════════════

describe('normalizeRatio', () => {
  it('returns fallback (0.5) for NaN input', () => {
    expect(U.normalizeRatio('abc')).toBe(0.5);
  });

  it('clamps below minimum to minimum (default 0.2)', () => {
    expect(U.normalizeRatio(0.05)).toBe(0.2);
  });

  it('clamps above maximum to maximum (default 0.8)', () => {
    expect(U.normalizeRatio(0.95)).toBe(0.8);
  });

  it('snaps to 0.5 when within default snap threshold', () => {
    expect(U.normalizeRatio(0.52)).toBe(0.5);
    expect(U.normalizeRatio(0.48)).toBe(0.5);
  });

  it('does not snap when outside threshold', () => {
    expect(U.normalizeRatio(0.45)).toBe(0.45);
    expect(U.normalizeRatio(0.55)).toBe(0.55);
  });

  it('respects custom options', () => {
    const result = U.normalizeRatio(0.1, { min: 0.1, max: 0.9, snap: 0.3, snapThreshold: 0.05 });
    expect(result).toBe(0.1);
  });

  it('uses custom fallback for NaN', () => {
    expect(U.normalizeRatio(undefined, { fallback: 0.7 })).toBe(0.7);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// reorderItems
// ═══════════════════════════════════════════════════════════════════════════

describe('reorderItems', () => {
  it('moves item forward with insertBefore=true', () => {
    const items = ['a', 'b', 'c', 'd'];
    const result = U.reorderItems(items, 0, 2, true);
    expect(result).toEqual(['b', 'a', 'c', 'd']);
  });

  it('moves item forward with insertBefore=false', () => {
    const items = ['a', 'b', 'c', 'd'];
    const result = U.reorderItems(items, 0, 2, false);
    expect(result).toEqual(['b', 'c', 'a', 'd']);
  });

  it('moves item backward with insertBefore=true', () => {
    const items = ['a', 'b', 'c', 'd'];
    const result = U.reorderItems(items, 3, 1, true);
    expect(result).toEqual(['a', 'd', 'b', 'c']);
  });

  it('moves item backward with insertBefore=false', () => {
    const items = ['a', 'b', 'c', 'd'];
    const result = U.reorderItems(items, 3, 1, false);
    expect(result).toEqual(['a', 'b', 'd', 'c']);
  });

  it('does not mutate the original array', () => {
    const items = ['x', 'y', 'z'];
    const result = U.reorderItems(items, 0, 2, false);
    expect(items).toEqual(['x', 'y', 'z']);
    expect(result).not.toBe(items);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// normalizeDroppedPath
// ═══════════════════════════════════════════════════════════════════════════

describe('normalizeDroppedPath', () => {
  it('returns empty string for falsy input', () => {
    expect(U.normalizeDroppedPath('')).toBe('');
    expect(U.normalizeDroppedPath(null)).toBe('');
    expect(U.normalizeDroppedPath(undefined)).toBe('');
  });

  it('decodes a file:// URI to a local path', () => {
    const result = U.normalizeDroppedPath('file:///home/user/doc.md');
    expect(result).toBe('/home/user/doc.md');
  });

  it('decodes percent-encoded characters in file:// URI', () => {
    const result = U.normalizeDroppedPath('file:///home/user/my%20doc.md');
    expect(result).toBe('/home/user/my doc.md');
  });

  it('strips leading slash from Windows drive paths in file:// URIs', () => {
    const result = U.normalizeDroppedPath('file:///C:/Users/doc.md');
    expect(result).toBe('C:/Users/doc.md');
  });

  it('passes through regular paths unchanged', () => {
    expect(U.normalizeDroppedPath('/home/user/file.md')).toBe('/home/user/file.md');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// normalizePathForCompare
// ═══════════════════════════════════════════════════════════════════════════

describe('normalizePathForCompare', () => {
  it('converts backslashes to forward slashes', () => {
    expect(U.normalizePathForCompare('C:\\Users\\docs\\file.md')).toBe('C:/Users/docs/file.md');
  });

  it('leaves forward slashes unchanged', () => {
    expect(U.normalizePathForCompare('/home/user/file.md')).toBe('/home/user/file.md');
  });

  it('handles empty string', () => {
    expect(U.normalizePathForCompare('')).toBe('');
  });

  it('handles null/undefined gracefully', () => {
    expect(U.normalizePathForCompare(null)).toBe('');
    expect(U.normalizePathForCompare(undefined)).toBe('');
  });

  it('handles mixed separators', () => {
    expect(U.normalizePathForCompare('dir\\sub/file.txt')).toBe('dir/sub/file.txt');
  });
});
