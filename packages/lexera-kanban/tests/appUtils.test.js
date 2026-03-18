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
  // Load TagSystem first so delegating functions in app.js can reference it
  const tagSystemSource = readFileSync(resolve(srcDir, 'tagSystem.js'), 'utf-8');
  new Function(tagSystemSource)();

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
    extractFunction(findLine('function extractHtmlComments(')),
    extractFunction(findLine('function stripHtmlComments(')),
    extractFunction(findLine('function buildSourceSummaryLabel(')),
    extractFunction(findLine('function getCreationEntityDragIconSvg(')),
    extractFunction(findLine('function stashRenderedHtmlToken(')),
    extractFunction(findLine('function restoreRenderedHtmlTokens(')),
    extractFunction(findLine('function extractAngleBracketAutolinks(')),
    extractFunction(findLine('function buildAngleBracketAutolinkHtml(')),
    extractFunction(findLine('function getMediaCategory(')),
    extractFunction(findLine('function getFileExtension(')),
    extractFunction(findLine('function inferExternalMediaCategoryFromUrl(')),
    extractFunction(findLine('function normalizeIncomingImageBase64(')),
    extractFunction(findLine('function decodeBase64BinaryStringToUint8Array(')),
    extractFunction(findLine('function sanitizeBuiltInDiagramFileName(')),
    extractFunction(findLine('function buildPastedEmbedImageFileName(')),
    extractFunction(findLine('function getUploadedMediaEmbedTarget(')),
    extractFunction(findLine('function stripLayoutTags(')),
    extractFunction(findLine('function stripLegacyImportStructureTags(')),
    extractFunction(findLine('function getColumnLayoutTags(')),
    extractFunction(findLine('function getLegacyImportRowNumber(')),
    extractFunction(findLine('function buildRowsFromLegacyColumns(')),
    extractFunction(findLine('function reconstructColumnTitle(')),
    extractFunction(findLine('function normalizeRatio(')),
    extractFunction(findLine('function reorderItems(')),
    extractFunction(findLine('function normalizeDroppedPath(')),
    extractFunction(findLine('function shouldKeepInlineEditorOpenOnBlur(')),
    extractFunction(findLine('function shouldCancelInlineEditorOnEscape(')),
    extractFunction(findLine('function syncConnectionStatusButton(')),
  ];

  const wrappedSource = `
    ${fnDefs.join('\n\n')}

    return {
      normalizeLogMessage,
      formatErrorDetails,
      normalizePathForCompare,
      parseLocalFileReference,
      normalizeWikiLookupKey,
      buildSourceSummaryLabel,
      getCreationEntityDragIconSvg,
      stashRenderedHtmlToken,
      restoreRenderedHtmlTokens,
      extractAngleBracketAutolinks,
      buildAngleBracketAutolinkHtml,
      getMediaCategory,
      getFileExtension,
      inferExternalMediaCategoryFromUrl,
      normalizeIncomingImageBase64,
      decodeBase64BinaryStringToUint8Array,
      sanitizeBuiltInDiagramFileName,
      buildPastedEmbedImageFileName,
      getUploadedMediaEmbedTarget,
      stripLayoutTags,
      stripLegacyImportStructureTags,
      getColumnLayoutTags,
      getLegacyImportRowNumber,
      buildRowsFromLegacyColumns,
      reconstructColumnTitle,
      normalizeRatio,
      reorderItems,
      normalizeDroppedPath,
      shouldKeepInlineEditorOpenOnBlur,
      shouldCancelInlineEditorOnEscape,
      syncConnectionStatusButton,
    };
  `;

  // The functions reference URL (global in browser) — Node has it natively.
  const atobShim = (value) => Buffer.from(String(value || ''), 'base64').toString('binary');
  const escapeHtmlShim = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
  const escapeAttrShim = escapeHtmlShim;
  const factory = new Function('URL', 'atob', 'escapeHtml', 'escapeAttr', wrappedSource);
  return factory(URL, atobShim, escapeHtmlShim, escapeAttrShim);
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

describe('inline render token helpers', () => {
  it('protects generated embed HTML from the later tag pass', () => {
    const htmlTokens = [];
    const token = U.stashRenderedHtmlToken(
      htmlTokens,
      '<span class="embed-file-link">&#128206; example.bin</span><button class="embed-menu-btn">&#8942;</button>'
    );

    const afterTagPass = token.replace(/(^|[\s&|!])(#[^\s&|!]+)/g, (match, pre, tag) => {
      return pre + '<span class="tag" data-tag="' + tag + '">' + tag + '</span>';
    });
    const restored = U.restoreRenderedHtmlTokens(afterTagPass, htmlTokens);

    expect(restored).toContain('&#128206; example.bin');
    expect(restored).toContain('&#8942;');
    expect(restored).not.toContain('data-tag="#128206;"');
    expect(restored).not.toContain('data-tag="#8942;"');
  });

  it('extracts angle-bracket autolinks before html parsing and rebuilds them as anchors', () => {
    const extracted = U.extractAngleBracketAutolinks('See <https://www.youtube.com/@LevelDesignLobby/videos>');
    expect(extracted.text).toBe('See @@AUTOLINKTOKEN0@@');
    expect(extracted.links).toEqual(['https://www.youtube.com/@LevelDesignLobby/videos']);

    const rebuilt = extracted.text.replace(/@@AUTOLINKTOKEN(\d+)@@/g, (_, index) => {
      return U.buildAngleBracketAutolinkHtml(extracted.links[Number(index)]);
    });

    expect(rebuilt).toContain('<a href="https://www.youtube.com/@LevelDesignLobby/videos" target="_blank" rel="noopener noreferrer">');
    expect(rebuilt).toContain('https://www.youtube.com/@LevelDesignLobby/videos</a>');
    expect(rebuilt).not.toContain('<https:');
  });

  it('detects extensionless googleusercontent image urls as images', () => {
    expect(
      U.inferExternalMediaCategoryFromUrl(
        'https://yt3.googleusercontent.com/bMVIjxhJITY5gAwz2T1R1YOYauALN0GzX2DS5P0TuZeTCphXCrIqTEvIGbrAPDF9r0AZO5NjuYw=w2276-fcrop64=1,00005a57ffffa5a8-k-c0xffffffff-no-nd-rj'
      )
    ).toBe('image');
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

  it('removes #header and #footer tags', () => {
    expect(U.stripLayoutTags('Column #header #footer')).toBe('Column');
  });

  it('removes multiple layout tags at once', () => {
    expect(U.stripLayoutTags('Col #row2 #span3 #stack')).toBe('Col');
  });

  it('removes canvas connection annotations from stack titles', () => {
    expect(U.stripLayoutTags('System Map [#backend]{from:right, to:left} #planning')).toBe('System Map #planning');
  });

  it('returns empty string for null/undefined input', () => {
    expect(U.stripLayoutTags(null)).toBe('');
    expect(U.stripLayoutTags(undefined)).toBe('');
  });

  it('preserves title when there are no layout tags', () => {
    expect(U.stripLayoutTags('Regular Title')).toBe('Regular Title');
  });
});

describe('stripLegacyImportStructureTags', () => {
  it('removes only #row and #stack from legacy import titles', () => {
    expect(U.stripLegacyImportStructureTags('Col #row2 #stack #span3')).toBe('Col #span3');
  });
});

describe('buildSourceSummaryLabel', () => {
  it('collapses whitespace and trims the result', () => {
    expect(U.buildSourceSummaryLabel('  alpha   beta \n gamma  ', 'fallback')).toBe('alpha beta gamma');
  });

  it('returns the fallback when the source is empty', () => {
    expect(U.buildSourceSummaryLabel('   ', 'fallback')).toBe('fallback');
  });

  it('truncates long labels to 80 characters', () => {
    const label = U.buildSourceSummaryLabel('a'.repeat(90), 'fallback');
    expect(label.length).toBe(80);
    expect(label.endsWith('...')).toBe(true);
  });
});

describe('getCreationEntityDragIconSvg', () => {
  it('returns the board icon markup', () => {
    const svg = U.getCreationEntityDragIconSvg('board');
    expect(svg).toContain('width="18" height="18"');
    expect(svg).toContain('width="12" height="5"');
  });

  it('returns the row icon markup', () => {
    const svg = U.getCreationEntityDragIconSvg('row');
    expect(svg).toContain('width="18" height="6"');
    expect(svg).toContain('width="18" height="8"');
  });

  it('returns the stack icon markup', () => {
    const svg = U.getCreationEntityDragIconSvg('stack');
    expect(svg).toContain('width="4" height="18"');
    expect(svg.match(/width="4" height="18"/g)?.length).toBe(3);
  });

  it('returns the column icon markup', () => {
    const svg = U.getCreationEntityDragIconSvg('column');
    expect(svg).toContain('stroke-dasharray="4 2"');
    expect(svg).toContain('width="13" height="11"');
  });

  it('falls back to the card icon markup', () => {
    const svg = U.getCreationEntityDragIconSvg('card');
    expect(svg).toContain('x1="8" y1="9" x2="16" y2="9"');
    expect(svg).toContain('x1="8" y1="13" x2="13" y2="13"');
  });
});

describe('incoming capture base64 helpers', () => {
  it('strips the data URL prefix from incoming image payloads', () => {
    expect(U.normalizeIncomingImageBase64('data:image/png;base64,YWJj')).toBe('YWJj');
  });

  it('decodes base64 payloads into bytes', () => {
    expect(Array.from(U.decodeBase64BinaryStringToUint8Array('YWJj'))).toEqual([97, 98, 99]);
  });

  it('builds a sanitized png filename for pasted embed images', () => {
    expect(U.buildPastedEmbedImageFileName('folder/custom:name')).toBe('custom-name.png');
  });

  it('prefers the relative media path returned by uploads', () => {
    expect(U.getUploadedMediaEmbedTarget({ path: 'Board-Media/example.png', filename: 'example.png' }))
      .toBe('Board-Media/example.png');
    expect(U.getUploadedMediaEmbedTarget({ filename: 'example.png' })).toBe('example.png');
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
    const result = U.getColumnLayoutTags('Col #row2 #span4 #stack #header #footer');
    expect(result.row).toBe('#row2');
    expect(result.span).toBe('#span4');
    expect(result.stack).toBe(true);
    expect(result.header).toBe(true);
    expect(result.footer).toBe(true);
  });

  it('returns empty/false for a title with no layout tags', () => {
    const result = U.getColumnLayoutTags('Plain Title');
    expect(result.row).toBe('');
    expect(result.span).toBe('');
    expect(result.stack).toBe(false);
    expect(result.header).toBe(false);
    expect(result.footer).toBe(false);
  });

  it('handles null/undefined input', () => {
    const result = U.getColumnLayoutTags(null);
    expect(result.row).toBe('');
    expect(result.span).toBe('');
    expect(result.stack).toBe(false);
    expect(result.header).toBe(false);
    expect(result.footer).toBe(false);
  });
});

describe('legacy import row/stack grouping helpers', () => {
  it('parses the legacy row number from the column title', () => {
    expect(U.getLegacyImportRowNumber('Column #row2 #stack')).toBe(2);
    expect(U.getLegacyImportRowNumber('Column')).toBe(1);
  });

  it('groups flat legacy columns into numbered rows and stack chains', () => {
    const rows = U.buildRowsFromLegacyColumns([
      { title: 'Todo', cards: [] },
      { title: 'Backlog #row2', cards: [] },
      { title: 'Doing #row2 #stack', cards: [] },
      { title: 'Done', cards: [] },
    ], 'Board');

    expect(rows.length).toBe(2);
    expect(rows[0].title).toBe('Row 1');
    expect(rows[0].stacks.length).toBe(2);
    expect(rows[0].stacks[0].columns[0].title).toBe('Todo');
    expect(rows[0].stacks[1].columns[0].title).toBe('Done');

    expect(rows[1].title).toBe('Row 2');
    expect(rows[1].stacks.length).toBe(1);
    expect(rows[1].stacks[0].columns.map((c) => c.title)).toEqual(['Backlog', 'Doing']);
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

  it('preserves #header/#footer from original when user does not override', () => {
    const result = U.reconstructColumnTitle('New Name', 'Old Name #header #footer');
    expect(result).toContain('#header');
    expect(result).toContain('#footer');
  });

  it('removes #header/#footer with #noheader/#nofooter directives', () => {
    const result = U.reconstructColumnTitle('Title #noheader #nofooter', 'Old #header #footer');
    expect(result).not.toContain('#header');
    expect(result).not.toContain('#footer');
    expect(result).toBe('Title');
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

describe('shouldKeepInlineEditorOpenOnBlur', () => {
  it('keeps the inline editor open when the document loses focus', () => {
    const previousDocument = global.document;
    global.document = { hasFocus: () => false };
    try {
      expect(U.shouldKeepInlineEditorOpenOnBlur()).toBe(true);
    } finally {
      global.document = previousDocument;
    }
  });

  it('allows the inline editor blur-save when the document is still focused', () => {
    const previousDocument = global.document;
    global.document = { hasFocus: () => true };
    try {
      expect(U.shouldKeepInlineEditorOpenOnBlur()).toBe(false);
    } finally {
      global.document = previousDocument;
    }
  });
});

describe('shouldCancelInlineEditorOnEscape', () => {
  it('returns true for the Escape key', () => {
    expect(U.shouldCancelInlineEditorOnEscape({ key: 'Escape' })).toBe(true);
  });

  it('returns false for other keys or missing events', () => {
    expect(U.shouldCancelInlineEditorOnEscape({ key: 'Enter' })).toBe(false);
    expect(U.shouldCancelInlineEditorOnEscape(null)).toBe(false);
  });
});

describe('syncConnectionStatusButton', () => {
  function createClassList() {
    const values = new Set();
    return {
      toggle(name, enabled) {
        if (enabled) values.add(name);
        else values.delete(name);
      },
      contains(name) {
        return values.has(name);
      },
    };
  }

  it('marks the button and dot as connected and updates accessibility text', () => {
    const button = {
      classList: createClassList(),
      attributes: {},
      setAttribute(name, value) { this.attributes[name] = value; },
      title: '',
    };
    const dot = { classList: createClassList() };

    U.syncConnectionStatusButton(button, dot, true);

    expect(button.classList.contains('connected')).toBe(true);
    expect(button.classList.contains('disconnected')).toBe(false);
    expect(button.attributes['data-connection-state']).toBe('connected');
    expect(button.attributes['aria-label']).toContain('connected');
    expect(button.title).toContain('connected');
    expect(dot.classList.contains('connected')).toBe(true);
    expect(dot.classList.contains('disconnected')).toBe(false);
  });

  it('marks the button and dot as disconnected', () => {
    const button = {
      classList: createClassList(),
      attributes: {},
      setAttribute(name, value) { this.attributes[name] = value; },
      title: '',
    };
    const dot = { classList: createClassList() };

    U.syncConnectionStatusButton(button, dot, false);

    expect(button.classList.contains('connected')).toBe(false);
    expect(button.classList.contains('disconnected')).toBe(true);
    expect(button.attributes['data-connection-state']).toBe('disconnected');
    expect(button.attributes['aria-label']).toContain('disconnected');
    expect(button.title).toContain('disconnected');
    expect(dot.classList.contains('connected')).toBe(false);
    expect(dot.classList.contains('disconnected')).toBe(true);
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
