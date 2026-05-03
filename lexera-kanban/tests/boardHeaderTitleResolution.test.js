// boardHeader.js — board pane title resolution contract.
//
// User report 2026-05-03: "the kanban board is allways titled like
// the filename!". Earlier `boardHeader.js` used the filename as the
// PRIMARY label whenever a `boardFilePath` existed:
//
//   var boardFileName = boardFilePath
//     ? getDisplayFileNameFromPath(boardFilePath)
//     : (activeBoardData.title || 'Untitled');
//
// Result: a board whose markdown begins with `# Sprint Planning`
// always rendered as `board-3.md` because the path branch swallowed
// the parsed title. Boards with no H1 ALSO showed the filename — but
// with the `.md` extension still attached.
//
// New priority chain matches `app.js`'s `getBoardDisplayTitle`:
//   parsed `activeBoardData.title` → filename without `.md`
//   → `'Untitled'`. Tooltip still shows the full file path so users
//   can confirm which file backs the board.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const boardHeaderJs = readFileSync(
  resolve(__dirname, '..', 'src', 'board', 'boardHeader.js'),
  'utf8'
);

function codeOnly(text) {
  return text.split('\n').map(function (line) {
    var idx = line.indexOf('//');
    return idx === -1 ? line : line.substring(0, idx);
  }).join('\n');
}

const code = codeOnly(boardHeaderJs);

describe('boardHeader.js — pane title prefers parsed H1 over filename', () => {
  it('parsedTitle is sourced from activeBoardData.title (the markdown H1)', () => {
    expect(code).toMatch(/parsedTitle\s*=\s*activeBoardData\s*&&\s*activeBoardData\.title/);
  });

  it('the filename fallback strips the `.md` extension', () => {
    expect(code).toMatch(/getDisplayFileNameFromPath[\s\S]{0,100}\.replace\(\s*\/\\\.md\$\/i\s*,\s*['"]['"]\)/);
  });

  it('fileTitle is `parsedTitle || fallbackFileName || \'Untitled\'` (priority chain)', () => {
    expect(code).toMatch(/fileTitle\s*=\s*parsedTitle\s*\|\|\s*fallbackFileName\s*\|\|\s*['"]Untitled['"]/);
  });

  it('the legacy filename-first composite is gone', () => {
    // Specifically, no `boardFileName = boardFilePath ? getDisplayFileNameFromPath(...)`
    // pattern that puts the filename ahead of the title.
    expect(code).not.toMatch(/boardFileName\s*=\s*boardFilePath\s*\?\s*_callDep\(\s*['"]getDisplayFileNameFromPath['"]/);
  });
});
