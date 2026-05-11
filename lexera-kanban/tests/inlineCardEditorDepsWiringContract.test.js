// Pin the dependency-wiring contract for InlineCardEditor.init() in app.js.
//
// inlineCardEditor.js reads its collaborators off a `_deps` object passed
// at init time. There is no compile-time check that app.js's manually
// curated init call passes every dep the module uses. When a new
// `_deps.X(...)` call is added inside the module but X is omitted from
// the init call site, `_deps.X` is undefined and any guarded call path
// silently early-returns — the feature looks "registered but inert."
//
// This bit me on 2026-05-11: I added `_deps.getElColumnsContainer()`
// inside the new outside-mousedown handler but forgot to pass
// `getElColumnsContainer` into `InlineCardEditor.init({...})`. Unit tests
// passed (they pass their own deps), but the real app silently did
// nothing. This contract guards against that class of regression.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const appJsPath = resolve(repoRoot, 'src/app.js');
const moduleJsPath = resolve(repoRoot, 'src/editor/inlineCardEditor.js');

function extractInitObjectBlock(source, initCallPrefix) {
  const startIdx = source.indexOf(initCallPrefix);
  if (startIdx === -1) return null;
  // Find the matching closing brace of the object literal passed to init.
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
  // Strip nested braces so we only see top-level keys.
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
  const re = /(?:^|[,{\s])([A-Za-z_$][\w$]*)\s*:/g;
  let m;
  while ((m = re.exec(stripped)) !== null) keys.add(m[1]);
  return keys;
}

function extractDepsAccessedByModule(moduleSource) {
  const keys = new Set();
  // Match `_deps.foo` and `_deps['foo']` / `_deps["foo"]`.
  const dotRe = /_deps\.([A-Za-z_$][\w$]*)/g;
  const bracketRe = /_deps\[\s*['"]([A-Za-z_$][\w$]*)['"]\s*\]/g;
  let m;
  while ((m = dotRe.exec(moduleSource)) !== null) keys.add(m[1]);
  while ((m = bracketRe.exec(moduleSource)) !== null) keys.add(m[1]);
  return keys;
}

describe('InlineCardEditor dep wiring contract (app.js)', () => {
  const appSrc = readFileSync(appJsPath, 'utf8');
  const moduleSrc = readFileSync(moduleJsPath, 'utf8');
  const initBlock = extractInitObjectBlock(appSrc, 'InlineCardEditorModule.init(');
  const passedDeps = initBlock ? extractTopLevelKeys(initBlock) : new Set();
  const accessedDeps = extractDepsAccessedByModule(moduleSrc);

  it('finds the InlineCardEditorModule.init({...}) call in app.js', () => {
    expect(initBlock, 'InlineCardEditorModule.init({...}) call not found in app.js').toBeTruthy();
  });

  it('passes every dep the module actually reads off _deps', () => {
    const missing = [];
    for (const key of accessedDeps) {
      if (!passedDeps.has(key)) missing.push(key);
    }
    expect(
      missing,
      `app.js InlineCardEditorModule.init() is missing deps used by inlineCardEditor.js: ${missing.join(', ')}`
    ).toEqual([]);
  });

  it('wires getElColumnsContainer (needed by the outside-mousedown handler)', () => {
    expect(passedDeps.has('getElColumnsContainer')).toBe(true);
  });

  it('wires lockBoardScrollHorizontal (needed by the cancel-path scroll latch)', () => {
    expect(passedDeps.has('lockBoardScrollHorizontal')).toBe(true);
  });
});
