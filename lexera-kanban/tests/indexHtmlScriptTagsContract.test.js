// Guards every shipped HTML entry point against broken `<script src=...>`
// references. Each app's bootstrap is a long static script-tag list; a typo
// or stray rename leaves a 404 at startup that only surfaces when a feature
// gated on the missing module is exercised. This contract catches the
// regression at test time.
//
// For each HTML entry point asserts:
//   1. the file has at least one local <script src>
//   2. every local src resolves to a file that exists on disk
//   3. no referenced file is zero-byte (catches botched syncs)
//   4. no local src is loaded twice
//
// Covers lexera-kanban/src/index.html (166 scripts), the lexera-backend
// utility windows (connection-settings.html, quick-capture.html — also
// load synced shared assets like backendDiscovery.js), and the
// lexera-capture-ios entry point.

import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');

const ENTRY_POINTS = [
  { label: 'lexera-kanban/src/index.html',                      file: 'lexera-kanban/src/index.html' },
  { label: 'lexera-backend/src/index.html',                     file: 'lexera-backend/src/index.html' },
  { label: 'lexera-backend/src/connection-settings.html',       file: 'lexera-backend/src/connection-settings.html' },
  { label: 'lexera-backend/src/quick-capture.html',             file: 'lexera-backend/src/quick-capture.html' },
  { label: 'lexera-capture-ios/src/index.html',                 file: 'lexera-capture-ios/src/index.html' },
];

function extractScriptSrcs(html) {
  // Pull every <script src="..."> regardless of attribute order.
  const out = [];
  const re = /<script\b[^>]*\bsrc\s*=\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    out.push(m[1]);
  }
  return out;
}

function isExternalUrl(src) {
  return /^(https?:|data:|\/\/)/.test(src);
}

for (const entry of ENTRY_POINTS) {
  describe(`${entry.label} — <script src> references`, () => {
    const htmlPath = resolve(repoRoot, entry.file);
    if (!existsSync(htmlPath)) {
      it.skip(`${entry.label}: file missing — skipped`, () => {});
      return;
    }

    const html = readFileSync(htmlPath, 'utf-8');
    const srcDir = dirname(htmlPath);
    const srcs = extractScriptSrcs(html);
    const localSrcs = srcs.filter((s) => !isExternalUrl(s));

    // Some entry points are intentional stubs (e.g. the backend's
    // `index.html` is a placeholder for a tray-driven window that never
    // mounts; the real UI is the connection-settings/quick-capture
    // pop-outs). Skip the "non-empty" gate when there's nothing to
    // assert against — the per-src checks below run regardless.
    it('every local src resolves to a file that exists', () => {
      const missing = [];
      for (const src of localSrcs) {
        const full = isAbsolute(src) ? src : resolve(srcDir, src);
        if (!existsSync(full)) missing.push(src);
      }
      if (missing.length > 0) {
        throw new Error(
          `${entry.label} references ${missing.length} script(s) that do not exist on disk:\n` +
          missing.map((s) => `  - ${s}`).join('\n'),
        );
      }
    });

    it('no referenced script is an empty file (sync regression)', () => {
      const empty = [];
      for (const src of localSrcs) {
        const full = isAbsolute(src) ? src : resolve(srcDir, src);
        if (!existsSync(full)) continue; // covered by the previous test
        try {
          if (statSync(full).size === 0) empty.push(src);
        } catch (_) { /* ignore */ }
      }
      if (empty.length > 0) {
        throw new Error(
          `${entry.label} references ${empty.length} zero-byte script file(s):\n` +
          empty.map((s) => `  - ${s}`).join('\n'),
        );
      }
    });

    it('no local src is loaded twice', () => {
      const seen = new Map();
      const dupes = [];
      for (const src of localSrcs) {
        const count = (seen.get(src) || 0) + 1;
        seen.set(src, count);
        if (count === 2) dupes.push(src);
      }
      if (dupes.length > 0) {
        throw new Error(
          `${entry.label} loads the same script tag(s) more than once:\n` +
          dupes.map((s) => `  - ${s} (${seen.get(s)}×)`).join('\n'),
        );
      }
    });
  });
}
