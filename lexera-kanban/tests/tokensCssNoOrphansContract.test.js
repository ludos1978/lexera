// Guards every CSS variable declared in `lexera-kanban/src/tokens.css`
// against becoming orphaned (defined but unused). Each token must have at
// least one consumer — either a direct `var(--token)` reference somewhere
// in src/, or an explicit allowlist entry below for tokens that are
// intentionally broadcast through other channels (e.g. themeBridge).
//
// Catches the "deprecated during multiview migration but never deleted"
// failure mode that motivated the original audit.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, '..', 'src');
const tokensPath = resolve(srcDir, 'tokens.css');

// Tokens that have zero direct `var()` consumers but are still load-bearing.
// Add a token here only with a one-line reason in the comment.
const ALLOWLIST = {
  // Broadcast to all child webviews via the themeBridge as part of the v2
  // type scale (LX.size.l). Sub-app stylesheets read it through the bridge,
  // not through `var(--font-size-l)` in this kanban tree.
  '--font-size-l': 'broadcast via shell/bridges/themeBridge.js',
};

function declaredTokens(cssSource) {
  // Match `--name:` declarations inside :root (or any selector). Keep it
  // simple — capture every line that defines a custom property.
  const out = new Set();
  const re = /^\s*(--[a-zA-Z0-9-]+)\s*:/gm;
  let m;
  while ((m = re.exec(cssSource)) !== null) {
    out.add(m[1]);
  }
  return [...out].sort();
}

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name === 'vendor' || name === 'node_modules') continue;
    const full = join(dir, name);
    let s;
    try { s = statSync(full); } catch (_) { continue; }
    if (s.isDirectory()) yield* walk(full);
    else if (s.isFile() && (full.endsWith('.css') || full.endsWith('.js'))) {
      yield full;
    }
  }
}

function consumerCount(token) {
  const needle = `var(${token}`;
  let n = 0;
  for (const file of walk(srcDir)) {
    // Skip the tokens.css definition file itself; the declaration site is
    // not a "consumer."
    if (file === tokensPath) continue;
    const text = readFileSync(file, 'utf-8');
    if (text.includes(needle)) n += 1;
  }
  return n;
}

describe('tokens.css — no orphan custom properties', () => {
  const source = readFileSync(tokensPath, 'utf-8');
  const tokens = declaredTokens(source);

  it('declares at least one custom property', () => {
    expect(tokens.length).toBeGreaterThan(0);
  });

  for (const token of tokens) {
    it(`${token} has at least one consumer (or is allowlisted)`, () => {
      const used = consumerCount(token) > 0;
      const allowed = Object.prototype.hasOwnProperty.call(ALLOWLIST, token);
      if (!used && !allowed) {
        throw new Error(
          `${token} is declared in tokens.css but has zero \`var(${token})\` ` +
          `consumers under src/. Either find/wire a consumer, remove it, or ` +
          `add it to ALLOWLIST with a reason.`
        );
      }
    });
  }
});
