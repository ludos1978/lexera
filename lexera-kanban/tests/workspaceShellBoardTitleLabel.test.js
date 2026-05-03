// Workspace shell tab-title resolver — board title labelling contract.
//
// `workspaceShell.js`'s `getBoardMetaLabel(meta)` decides what shows
// on a board tab header. User report 2026-05-03: "the board title in
// the workspace window doesnt show the right title!". Two issues:
//
//   1. The previous shape returned `"Title (Filename.md)"` whenever
//      both differed — visually noisy when the filename adds nothing
//      (the typical case where the file is named after its title)
//      and misleading when the filename diverges (a renamed file
//      whose H1 hasn't been updated, or vice-versa).
//   2. The fallback chain ended at `meta.id` — the raw hex board id —
//      which appears in the UI as a 12-char hex string and reads as
//      "wrong title" rather than "no title".
//
// Fix (this file pins it):
//   - Prefer `meta.title` alone (parsed by lexera-core's
//     `build_board_summary` from the board's H1).
//   - Fall back to `meta.filePath`'s basename, stripping `.md`.
//   - Only fall back to `meta.id` as the last resort.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const workspaceShellJs = readFileSync(
  resolve(__dirname, '..', 'src', 'workspace', 'workspaceShell.js'),
  'utf8'
);

// Strip line comments so the contract regexes match only ACTUAL code.
function codeOnly(text) {
  return text.split('\n').map(function (line) {
    var idx = line.indexOf('//');
    return idx === -1 ? line : line.substring(0, idx);
  }).join('\n');
}

const code = codeOnly(workspaceShellJs);

function fnSlice(name) {
  var start = code.indexOf('function ' + name);
  if (start === -1) throw new Error('function not found: ' + name);
  // Find the next top-level function definition.
  var nextFn = code.indexOf('\n  function ', start + 1);
  return code.substring(start, nextFn === -1 ? code.length : nextFn);
}

describe('getBoardMetaLabel — title resolution', () => {
  const slice = fnSlice('getBoardMetaLabel');

  it('the previous "Title (Filename)" composite is gone', () => {
    // Specifically, no concatenation of `title + ' (' + fileName + ')'`.
    expect(slice).not.toMatch(/title\s*\+\s*['"]\s*\(\s*['"]\s*\+\s*fileName/);
  });

  it('returns meta.title alone when it exists', () => {
    // `if (title) return title;` — title alone is the primary path.
    expect(slice).toMatch(/if\s*\(\s*title\s*\)\s*return\s+title/);
  });

  it('falls back to filePath basename without the .md extension', () => {
    // The filename branch strips `.md` (case-insensitive).
    expect(slice).toMatch(/getDisplayNameFromPath\(\s*meta\.filePath\s*\|\|\s*['"]['"]\)/);
    expect(slice).toMatch(/replace\(\s*\/\\\.md\$\/i\s*,\s*['"]['"]\)/);
  });

  it('only surfaces the raw board id as a last resort', () => {
    // The id fallback comes after both title and fileName paths.
    var titleIdx = slice.search(/if\s*\(\s*title\s*\)\s*return\s+title/);
    var idIdx = slice.search(/meta\.id/);
    expect(titleIdx).toBeGreaterThan(-1);
    expect(idIdx).toBeGreaterThan(titleIdx);
  });

  it('returns "Untitled" when meta is missing entirely', () => {
    expect(slice).toMatch(/if\s*\(\s*!meta\s*\)\s*return\s+['"]Untitled['"]/);
  });
});
