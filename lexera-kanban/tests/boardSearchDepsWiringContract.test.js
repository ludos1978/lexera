// Pin the dependency-wiring contract for LexeraBoardSearch init in app.js.
//
// boardSearch.js reads its collaborators off `_deps` (populated via
// `LexeraBoardSearch.init({...})`). There is no compile-time check that
// app.js's manually curated config passes every dep the module uses.
//
// Same class of bug as the one that bit the workspace-card-focus chain
// on 2026-05-13 (commit 34c16adc): a new `_deps.X` / `_callDep('X')`
// inside the module silently early-returns when X is omitted from the
// init config — feature "registered but inert" from the user's side.
//
// Companion to `orderHelpersDepsWiringContract.test.js` and
// `inlineCardEditorDepsWiringContract.test.js`. Pattern is identical;
// only the file paths + init call prefix differ.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const appJsPath = resolve(repoRoot, 'src/app.js');
const moduleJsPath = resolve(repoRoot, 'src/search/boardSearch.js');

function extractInitObjectBlock(source, initCallPrefix) {
  const startIdx = source.indexOf(initCallPrefix);
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
  const valueRe = /(?:^|[,{\s])([A-Za-z_$$][\w$]*)\s*:/g;
  const getterRe = /(?:^|[,{\s])get\s+([A-Za-z_$$][\w$]*)\s*\(/g;
  let m;
  while ((m = valueRe.exec(stripped)) !== null) keys.add(m[1]);
  while ((m = getterRe.exec(stripped)) !== null) keys.add(m[1]);
  // `$searchInput: $searchInput` — the regex chokes on the leading $
  // because $ is treated as start-of-string anchor in some char classes.
  // Explicit pass for $-prefixed keys.
  const dollarRe = /(?:^|[,{\s])(\$[A-Za-z_$$][\w$]*)\s*:/g;
  while ((m = dollarRe.exec(stripped)) !== null) keys.add(m[1]);
  return keys;
}

function extractDepsAccessedByModule(moduleSource) {
  const keys = new Set();
  // `_deps.foo` / `_deps.$searchInput` / `_deps['foo']`.
  const dotRe = /_deps\.(\$?[A-Za-z_$][\w$]*)/g;
  const bracketRe = /_deps\[\s*['"]([A-Za-z_$][\w$]*)['"]\s*\]/g;
  // `_callDep('foo')` / `_dep('foo')` indirections.
  const callDepRe = /_(?:call)?[Dd]ep\(\s*['"]([A-Za-z_$][\w$]*)['"]/g;
  let m;
  while ((m = dotRe.exec(moduleSource)) !== null) keys.add(m[1]);
  while ((m = bracketRe.exec(moduleSource)) !== null) keys.add(m[1]);
  while ((m = callDepRe.exec(moduleSource)) !== null) keys.add(m[1]);
  return keys;
}

describe('LexeraBoardSearch dep wiring contract (app.js)', () => {
  const appSrc = readFileSync(appJsPath, 'utf8');
  const moduleSrc = readFileSync(moduleJsPath, 'utf8');
  const initBlock = extractInitObjectBlock(appSrc, '_BoardSearch.init(');
  const passedDeps = initBlock ? extractTopLevelKeys(initBlock) : new Set();
  const accessedDeps = extractDepsAccessedByModule(moduleSrc);

  it('finds the _BoardSearch.init({...}) call in app.js', () => {
    expect(initBlock, '_BoardSearch.init({...}) call not found in app.js').toBeTruthy();
  });

  it('passes every dep the module actually reads off _deps', () => {
    const missing = [];
    for (const key of accessedDeps) {
      if (!passedDeps.has(key)) missing.push(key);
    }
    expect(
      missing,
      `app.js _BoardSearch.init() is missing deps used by boardSearch.js: ${missing.join(', ')}`
    ).toEqual([]);
  });

  it('wires getBoardNavigationApi (focus chain — boardSearch navigation entry)', () => {
    // Specific regression fence — the same dep that was missing from
    // orderHelpersInitConfig (commit 34c16adc). BoardSearch wires it
    // correctly; this assertion keeps it that way.
    expect(passedDeps.has('getBoardNavigationApi')).toBe(true);
  });
});
