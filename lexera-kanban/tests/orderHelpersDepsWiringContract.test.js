// Pin the dependency-wiring contract for OrderHelpers init in app.js.
//
// orderHelpers.js reads its collaborators off `_deps` (populated via
// LexeraOrderHelpers.init(orderHelpersInitConfig)). There is no compile-time
// check that app.js's manually curated config passes every dep the module
// uses — when a new `_deps.X` / `_callDep('X')` call is added inside the
// module but X is omitted from the init config, the dep is undefined and
// any guarded call path silently early-returns.
//
// This bit the workspace-card-focus chain on 2026-05-13: orderHelpers's
// `navigateHierarchyTargetInIframe` called `_callDep('getBoardNavigationApi')`
// but the dep was never wired into orderHelpersInitConfig (only BoardSearch.init
// received it). The chain bailed silently with `skip(no-nav-api) {hasNav:false}`
// — the feature looked "registered but inert" from the user's side.
//
// This contract guards against that class of regression.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const appJsPath = resolve(repoRoot, 'src/app.js');
const moduleJsPath = resolve(repoRoot, 'src/board/orderHelpers.js');

function extractObjectBlock(source, declarationPrefix) {
  const startIdx = source.indexOf(declarationPrefix);
  if (startIdx === -1) return null;
  const openBrace = source.indexOf('{', startIdx);
  if (openBrace === -1) return null;
  let depth = 0;
  for (let i = openBrace; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return source.slice(openBrace, i + 1);
    }
  }
  return null;
}

function extractTopLevelKeys(objectLiteralText) {
  let depth = 0;
  let stripped = '';
  for (const ch of objectLiteralText) {
    if (ch === '{') {
      depth++;
      if (depth === 1) stripped += ch;
      continue;
    }
    if (ch === '}') {
      if (depth === 1) stripped += ch;
      depth--;
      continue;
    }
    if (depth === 1) stripped += ch;
  }
  const keys = new Set();
  // Matches both `foo:` and `get foo()` accessor syntax used in
  // orderHelpersInitConfig for fields that need live read-through
  // (e.g. `get fullBoardData()`).
  const valueRe = /(?:^|[,{\s])([A-Za-z_$][\w$]*)\s*:/g;
  const getterRe = /(?:^|[,{\s])get\s+([A-Za-z_$][\w$]*)\s*\(/g;
  let m;
  while ((m = valueRe.exec(stripped)) !== null) keys.add(m[1]);
  while ((m = getterRe.exec(stripped)) !== null) keys.add(m[1]);
  return keys;
}

function extractDepsAccessedByModule(moduleSource) {
  const keys = new Set();
  const dotRe = /_deps\.([A-Za-z_$][\w$]*)/g;
  const bracketRe = /_deps\[\s*['"]([A-Za-z_$][\w$]*)['"]\s*\]/g;
  // _callDep('foo' [, ...]) and _dep('foo') call sites also read off _deps.
  const callDepRe = /_(?:call)?[Dd]ep\(\s*['"]([A-Za-z_$][\w$]*)['"]/g;
  let m;
  while ((m = dotRe.exec(moduleSource)) !== null) keys.add(m[1]);
  while ((m = bracketRe.exec(moduleSource)) !== null) keys.add(m[1]);
  while ((m = callDepRe.exec(moduleSource)) !== null) keys.add(m[1]);
  return keys;
}

describe('OrderHelpers dep wiring contract (app.js)', () => {
  const appSrc = readFileSync(appJsPath, 'utf8');
  const moduleSrc = readFileSync(moduleJsPath, 'utf8');
  const configBlock = extractObjectBlock(appSrc, 'var orderHelpersInitConfig =');
  const passedDeps = configBlock ? extractTopLevelKeys(configBlock) : new Set();
  const accessedDeps = extractDepsAccessedByModule(moduleSrc);

  it('finds the orderHelpersInitConfig object in app.js', () => {
    expect(configBlock, 'var orderHelpersInitConfig = {...} not found in app.js').toBeTruthy();
  });

  it('wires getBoardNavigationApi (focus chain — workspace-tree card click)', () => {
    // Specific regression fence — this dep was the missing link that
    // caused user-report 2026-05-13 "focussing a card in the kanban
    // view by selecting it in the workspace still doesnt work!". The
    // orderHelpers handler reached navigateHierarchyTargetInIframe but
    // bailed with `skip(no-nav-api)` because the dep wasn't wired.
    expect(passedDeps.has('getBoardNavigationApi')).toBe(true);
  });

  it('wires getFoldStateApi (focus chain — local saveFoldState uses it)', () => {
    // The local `saveFoldState(boardId)` in orderHelpers reads
    // `_callDep('getFoldStateApi')` to reach the fold-state writer.
    // Without this wired the ancestor-unfold persistence (commit
    // f6935916, refined in this slice) silently no-ops.
    expect(passedDeps.has('getFoldStateApi')).toBe(true);
  });

  it('wires findBoardEntityElement (focus chain — DOM lookup)', () => {
    // The canonical lookup used by both the immediate find and the
    // retry loop in focusHierarchyTargetLocally.
    expect(passedDeps.has('findBoardEntityElement')).toBe(true);
  });
});
