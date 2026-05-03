// Workspace shell tab-title resolver — delegation contract.
//
// The shell's `getBoardMetaLabel(meta)` no longer holds its own
// fallback chain — it delegates to `LexeraTitleHelpers.resolveBoardLabel`
// in `titleHelpers.js` so this surface, the in-board pane title
// (`boardHeader.js`), and the workspaces / hierarchy sub-apps ALL
// produce the same label for the same board. (User requirement
// 2026-05-03: "the title should be everywhere the same!".)
//
// The actual priority chain is tested at the source-of-truth in
// `titleHelpersBoardLabel.test.js` — this file just pins the
// delegation so a future refactor can't reintroduce a divergent
// inline copy.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const workspaceShellJs = readFileSync(
  resolve(__dirname, '..', 'src', 'workspace', 'workspaceShell.js'),
  'utf8'
);

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
  var nextFn = code.indexOf('\n  function ', start + 1);
  return code.substring(start, nextFn === -1 ? code.length : nextFn);
}

describe('workspaceShell.getBoardMetaLabel — delegates to LexeraTitleHelpers', () => {
  const slice = fnSlice('getBoardMetaLabel');

  it('delegates to window.LexeraTitleHelpers.resolveBoardLabel', () => {
    expect(slice).toMatch(/window\.LexeraTitleHelpers\.resolveBoardLabel\(meta\)/);
  });

  it('does NOT inline its own fallback chain anymore', () => {
    // The old inline implementation read meta.title / meta.filePath /
    // meta.id directly. After delegation, the only reference to
    // `meta` should be passing it to the helper.
    expect(slice).not.toMatch(/meta\.title\s*\|\|/);
    expect(slice).not.toMatch(/meta\.filePath/);
    expect(slice).not.toMatch(/meta\.id/);
  });

  it('does NOT compose "Title (Filename.md)" — that pattern is fully gone', () => {
    expect(slice).not.toMatch(/title\s*\+\s*['"]\s*\(\s*['"]\s*\+/);
  });
});
