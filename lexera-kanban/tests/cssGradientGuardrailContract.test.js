// CSS gradient ban guardrail.
//
// User rule (in memory): "NEVER use gradients (linear-gradient,
// radial-gradient, etc.) in CSS styling". Solid colors / color-mix /
// transparency tinting are the approved alternatives.
//
// Walks every authored .css file in lexera-kanban/src and fails on
// any `linear-gradient(`, `radial-gradient(`, or `conic-gradient(`
// occurrence. Vendor bundles and the synced lexera-shared assets
// (their owner is in another package) are skipped.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcRoot = resolve(__dirname, '..', 'src');

const BUILD_SYNCED_FILES = new Set([
  'management.css',
  'dialogs.css'
]);

function walkCss(dir, out, srcRootArg) {
  for (const name of readdirSync(dir)) {
    if (name === 'vendor' || name === 'node_modules') continue;
    const full = join(dir, name);
    let s;
    try { s = statSync(full); } catch (_) { continue; }
    if (s.isDirectory()) walkCss(full, out, srcRootArg);
    else if (s.isFile() && full.endsWith('.css')) {
      const rel = relative(srcRootArg, full);
      if (BUILD_SYNCED_FILES.has(rel)) continue;
      out.push(full);
    }
  }
  return out;
}

function fileUsesGradient(absPath) {
  const src = readFileSync(absPath, 'utf8');
  // Strip /* */ block comments so a doc reference doesn't trigger.
  const stripped = src.replace(/\/\*[\s\S]*?\*\//g, '');
  return /\b(linear|radial|conic)-gradient\s*\(/.test(stripped);
}

describe('CSS gradient ban contract', () => {
  it('no authored CSS uses linear-gradient / radial-gradient / conic-gradient', () => {
    const offenders = [];
    for (const file of walkCss(srcRoot, [], srcRoot)) {
      if (fileUsesGradient(file)) offenders.push(relative(srcRoot, file));
    }
    expect(
      offenders,
      'These CSS files use gradients. The user rule is: NEVER use gradients. Replace with a solid color, color-mix, or rgba tint.'
    ).toEqual([]);
  });
});
