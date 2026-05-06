// Phase 3.2 [5/N]: pin that `pruneMissingBoards` in workspaceShell.js
// removes orphan board tabs through `layoutTree.removeTabById` rather
// than direct `node.tabs.splice(…)`.
//
// Pre-migration the function did the splice in-place during a tree
// walk. After 3.2 [5/N] the function collects victim tab.ids first,
// then routes the actual removal through the wrapper API. The wrapper
// keeps `activeTabId` in sync and is what the lifecycle reconciler
// (Phase 2) was designed around — bypassing it re-opens the
// "ghost view" leak class even though `removeFrame` is called.
//
// This is a source-text fence, not a behavioural test: the function
// is too entangled with the rest of the shell to drive in isolation,
// but the wire-up of the wrapper is what we need to lock in.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const shellPath = resolve(__dirname, '..', 'src', 'workspace', 'workspaceShell.js');

function extractFunctionBody(src, name) {
  const re = new RegExp('function\\s+' + name + '\\s*\\([^)]*\\)\\s*\\{', 'g');
  const m = re.exec(src);
  if (!m) return null;
  let depth = 1;
  let i = re.lastIndex;
  while (i < src.length && depth > 0) {
    const ch = src.charAt(i);
    if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
    i += 1;
  }
  return depth === 0 ? src.slice(m.index, i) : null;
}

describe('workspaceShell pruneMissingBoards — Phase 3.2 wrapper migration', () => {
  const src = readFileSync(shellPath, 'utf8');
  const body = extractFunctionBody(src, 'pruneMissingBoards');

  it('the function exists', () => {
    expect(body, 'pruneMissingBoards must still be defined').toBeTruthy();
  });

  it('routes the tree mutation through layoutTree.removeTabById', () => {
    expect(body).toMatch(/layoutTree\.removeTabById\(/);
  });

  it('does not splice tab arrays directly', () => {
    // Strip block + line comments before checking, so the wrap-up
    // commentary above the implementation isn't matched.
    const stripped = body
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:\\])\/\/[^\n]*/g, '$1');
    expect(stripped).not.toMatch(/\.tabs\.splice\(/);
  });

  it('still calls removeFrame before mutating the tree (destruction order preserved)', () => {
    // removeFrame must occur before removeTabById in source order so
    // the multiview registry sees the destroy IPC for a still-tracked
    // tab.id.
    const removeFrameIdx = body.indexOf('removeFrame(');
    const removeTabByIdIdx = body.indexOf('layoutTree.removeTabById(');
    expect(removeFrameIdx).toBeGreaterThan(-1);
    expect(removeTabByIdIdx).toBeGreaterThan(-1);
    expect(removeFrameIdx).toBeLessThan(removeTabByIdIdx);
  });

  it('returns true only when at least one tab was pruned', () => {
    // The early-return when boardsAvailable is 0 must not flip to true.
    expect(body).toMatch(/if\s*\(\s*boardsAvailable\s*===\s*0\s*\)\s*return\s+false/);
  });
});
