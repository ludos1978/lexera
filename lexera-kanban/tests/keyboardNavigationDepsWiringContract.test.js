// Pin the dependency-wiring contract for LexeraKeyboardNavigation
// init in app.js.
//
// keyboardNavigation.js reads its collaborators off `_deps` (populated
// via `KeyboardNav.init({...})`). No compile-time check that app.js's
// manually curated config passes every dep the module uses — and the
// keyboard module touches a lot of the board's mutate surface
// (moveCard / duplicateCard / openCardEditor / etc.), so a missing
// dep would silently disable a shortcut.
//
// Companion to `inlineCardEditorDepsWiringContract.test.js` /
// `orderHelpersDepsWiringContract.test.js` /
// `boardSearchDepsWiringContract.test.js`. Same shape; differs only
// in file path + init call prefix.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const appJsPath = resolve(repoRoot, 'src/app.js');
const moduleJsPath = resolve(repoRoot, 'src/keyboard/keyboardNavigation.js');

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
  const callDepRe = /_(?:call)?[Dd]ep\(\s*['"]([A-Za-z_$][\w$]*)['"]/g;
  let m;
  while ((m = dotRe.exec(moduleSource)) !== null) keys.add(m[1]);
  while ((m = bracketRe.exec(moduleSource)) !== null) keys.add(m[1]);
  while ((m = callDepRe.exec(moduleSource)) !== null) keys.add(m[1]);
  return keys;
}

describe('LexeraKeyboardNavigation dep wiring contract (app.js)', () => {
  const appSrc = readFileSync(appJsPath, 'utf8');
  const moduleSrc = readFileSync(moduleJsPath, 'utf8');
  // Use the full `if (KeyboardNav) KeyboardNav.init(` prefix so the
  // search skips a stray comment match at app.js:602 (which mentions
  // `KeyboardNav.init()` in prose). Without the `if (KeyboardNav)`
  // anchor, extractInitObjectBlock starts from the comment line, finds
  // a `{` belonging to some unrelated block downstream, and reports
  // every dep as "missing" because the wrong object is being scanned.
  const initBlock = extractInitObjectBlock(appSrc, 'if (KeyboardNav) KeyboardNav.init(');
  const passedDeps = initBlock ? extractTopLevelKeys(initBlock) : new Set();
  const accessedDeps = extractDepsAccessedByModule(moduleSrc);

  it('finds the KeyboardNav.init({...}) call in app.js', () => {
    expect(initBlock, 'KeyboardNav.init({...}) call not found in app.js').toBeTruthy();
  });

  it('passes every dep the module actually reads off _deps', () => {
    const missing = [];
    for (const key of accessedDeps) {
      if (!passedDeps.has(key)) missing.push(key);
    }
    expect(
      missing,
      `app.js KeyboardNav.init() is missing deps used by keyboardNavigation.js: ${missing.join(', ')}`
    ).toEqual([]);
  });

  it('wires getActiveBoardColumns (used by arrow-key navigation skipping empty columns — fix 31544557)', () => {
    // Specific regression fence — commit 31544557 introduced the
    // multi-empty-column arrow-key skip behaviour. Removing this
    // dep would silently disable that traversal.
    expect(passedDeps.has('getActiveBoardColumns')).toBe(true);
  });
});
