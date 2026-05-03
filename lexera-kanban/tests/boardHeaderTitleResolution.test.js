// boardHeader.js — board pane title delegation contract.
//
// User reports 2026-05-03:
//   "the kanban board is allways titled like the filename!"
//   "the title should be everywhere the same!"
//
// The pane button label now goes through the shared
// `LexeraTitleHelpers.resolveBoardLabel` so this header, the
// workspace shell tab headers, and the workspaces / hierarchy
// sub-apps ALL produce the same label for the same board. The
// actual priority chain (title → filename sans `.md` → name →
// 'Untitled') is exercised in titleHelpersBoardLabel.test.js;
// this file just pins the delegation so a future refactor can't
// silently reintroduce a divergent inline copy.

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

describe('boardHeader.js — pane title delegates to LexeraTitleHelpers', () => {
  it('fileTitle is set by window.LexeraTitleHelpers.resolveBoardLabel(...)', () => {
    expect(code).toMatch(/fileTitle\s*=\s*window\.LexeraTitleHelpers\.resolveBoardLabel/);
  });

  it('passes both title and filePath to the helper', () => {
    expect(code).toMatch(/title:\s*activeBoardData\s*&&\s*activeBoardData\.title/);
    expect(code).toMatch(/filePath:\s*boardFilePath/);
  });

  it('the legacy filename-first composite is gone', () => {
    // Specifically, no `boardFileName = boardFilePath ? getDisplayFileNameFromPath(...)`
    // pattern that puts the filename ahead of the title.
    expect(code).not.toMatch(/boardFileName\s*=\s*boardFilePath\s*\?\s*_callDep\(\s*['"]getDisplayFileNameFromPath['"]/);
    // No standalone parsedTitle / fallbackFileName variables — both
    // collapsed into the single delegating call.
    expect(code).not.toMatch(/var parsedTitle\s*=/);
    expect(code).not.toMatch(/var fallbackFileName\s*=/);
  });
});
