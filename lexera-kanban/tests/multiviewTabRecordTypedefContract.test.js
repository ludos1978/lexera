// Pin: `multiviewWebview.js` declares the `TabRecord` JSDoc typedef
// at the top of the file and applies `@type {TabRecordMap}` to the
// `multiviewSpawnedTabs` variable. This is the first slice of TODO
// 6.1 ("Convert state and tabRecords to JSDoc-typed objects; run
// `tsc --noEmit` in CI").
//
// The runtime is unchanged — the typedef is comments only — but the
// pinned shape is what a future `tsc --noEmit` step will lint
// against. Removing the typedef would silently break that future
// type check before it lands; this test catches the regression
// immediately so the JSDoc surface area can grow incrementally.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const multiviewJs = readFileSync(
  resolve(__dirname, '..', 'src', 'workspace', 'multiviewWebview.js'),
  'utf8'
);

describe('multiviewWebview.js — TabRecord JSDoc typedef', () => {
  it('defines TabRecordState as a string union of the three lifecycle values', () => {
    // The runtime stores these strings literally on each record. If a
    // future refactor adds a fourth state without expanding the union,
    // tsc would silently lose coverage of that branch — pin all three
    // here so the union and the writers stay in lockstep.
    expect(multiviewJs).toMatch(/@typedef\s+\{[^}]*'pending'[^}]*\}\s+TabRecordState/);
    expect(multiviewJs).toMatch(/@typedef\s+\{[^}]*'ready'[^}]*\}\s+TabRecordState/);
    expect(multiviewJs).toMatch(/@typedef\s+\{[^}]*'destroying'[^}]*\}\s+TabRecordState/);
  });

  it('defines TabRecord with url, state, label, and optional attempts', () => {
    expect(multiviewJs).toMatch(/@typedef\s+\{Object\}\s+TabRecord\b/);
    expect(multiviewJs).toMatch(/@property\s+\{string\}\s+url/);
    expect(multiviewJs).toMatch(/@property\s+\{TabRecordState\}\s+state/);
    expect(multiviewJs).toMatch(/@property\s+\{string\}\s+label/);
    // The brackets around `attempts` mark it optional in JSDoc; pin
    // that explicitly so a future "always present" refactor doesn't
    // silently change the public type.
    expect(multiviewJs).toMatch(/@property\s+\{number\}\s+\[attempts\]/);
  });

  it('defines TabRecordMap as Object<string, TabRecord>', () => {
    expect(multiviewJs).toMatch(/@typedef\s+\{Object<string,\s*TabRecord>\}\s+TabRecordMap/);
  });

  it('applies @type {TabRecordMap} to the multiviewSpawnedTabs variable', () => {
    // Annotation must immediately precede the declaration so tsc can
    // associate them — pin the proximity, not just both presences.
    expect(multiviewJs).toMatch(
      /@type\s+\{TabRecordMap\}[^\n]*\n\s*var\s+multiviewSpawnedTabs\s*=/
    );
  });
});
