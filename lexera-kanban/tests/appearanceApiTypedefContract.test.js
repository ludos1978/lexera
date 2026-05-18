// Pin: `types/lexera-globals.d.ts` declares the `LexeraAppearanceApi`
// interface and exposes `window.LexeraAppearance` as that type. This
// is a slice of the workspaceShell narrow-by-kind typedef paydown
// (TODOs-lexera.md). Before this landed, `tsc --noEmit` reported
// TS2339 "Property 'LexeraAppearance' does not exist on type Window"
// at the three `frontend-setting-changed` handler call sites in
// workspaceShell.js.
//
// The runtime is unchanged — the .d.ts is type metadata only — but
// the pinned shape is what `./run-lexera-tests.sh --typedefs` lints
// against. Removing the interface or the Window member would
// silently re-introduce the TS2339 errors; this test catches the
// regression immediately so the typed surface can grow incrementally.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dts = readFileSync(
  resolve(__dirname, '..', 'src', 'types', 'lexera-globals.d.ts'),
  'utf8'
);
const shellJs = readFileSync(
  resolve(__dirname, '..', 'src', 'workspace', 'workspaceShell.js'),
  'utf8'
);

describe('lexera-globals.d.ts — LexeraAppearanceApi', () => {
  it('declares the LexeraAppearanceApi interface', () => {
    expect(dts).toMatch(/interface\s+LexeraAppearanceApi\s*\{/);
  });

  it('exposes window.LexeraAppearance typed as LexeraAppearanceApi', () => {
    // Pin the Window member so the `window.LexeraAppearance.*` reads in
    // workspaceShell.js stay typed rather than falling back to TS2339.
    expect(dts).toMatch(/\bLexeraAppearance:\s*LexeraAppearanceApi\s*;/);
  });

  it('types applyThemeMode with the persist option and requested/effective result', () => {
    // workspaceShell.js's frontend-setting-changed handler calls
    // `applyThemeMode(payload.value, { persist: false })` — the
    // signature must keep the optional `{ persist?: boolean }` arg and
    // the discriminated mode return so that call site type-checks.
    const ifaceMatch = dts.match(/interface\s+LexeraAppearanceApi\s*\{([\s\S]*?)\n\}/);
    expect(ifaceMatch, 'LexeraAppearanceApi body must be parseable').toBeTruthy();
    const body = ifaceMatch[1];
    expect(body).toMatch(/applyThemeMode\(/);
    expect(body).toMatch(/options\?\s*:\s*\{\s*persist\?\s*:\s*boolean\s*\}/);
    expect(body).toMatch(/requested:\s*'auto'\s*\|\s*'dark'\s*\|\s*'light'/);
    expect(body).toMatch(/effective:\s*'dark'\s*\|\s*'light'/);
  });

  it('is the type behind the real workspaceShell.js consumer call site', () => {
    // The regression this guards against is specifically the
    // frontend-setting-changed handler reaching for applyThemeMode.
    // Keep the consumer pinned so the typedef and its sole shell
    // consumer don't drift apart.
    expect(shellJs).toMatch(
      /window\.LexeraAppearance\.applyThemeMode\(\s*payload\.value\s*,\s*\{\s*persist:\s*false\s*\}\s*\)/
    );
  });
});
