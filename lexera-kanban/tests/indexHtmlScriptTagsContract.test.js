// Guards `lexera-kanban/src/index.html` against broken `<script src=...>`
// references. The shell's 166-script bootstrap is fragile: a typo or a
// stray rename leaves a 404 at startup that only surfaces when a feature
// gated on the missing module is exercised. This contract catches the
// regression at test time.
//
// Also asserts the linked file is non-empty (zero-byte file is almost
// always a botched sync) and that no duplicate `<script>` tags load the
// same path twice.

import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, '..', 'src');
const indexHtml = resolve(srcDir, 'index.html');

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

describe('index.html — <script src> references', () => {
  const html = readFileSync(indexHtml, 'utf-8');
  const srcs = extractScriptSrcs(html);
  const localSrcs = srcs.filter((s) => !isExternalUrl(s));

  it('has at least one local <script> tag', () => {
    expect(localSrcs.length).toBeGreaterThan(0);
  });

  it('every local src resolves to a file that exists', () => {
    const missing = [];
    for (const src of localSrcs) {
      const full = isAbsolute(src) ? src : resolve(srcDir, src);
      if (!existsSync(full)) missing.push(src);
    }
    if (missing.length > 0) {
      throw new Error(
        `index.html references ${missing.length} script(s) that do not exist on disk:\n` +
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
        `index.html references ${empty.length} zero-byte script file(s):\n` +
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
        `index.html loads the same script tag(s) more than once:\n` +
        dupes.map((s) => `  - ${s} (${seen.get(s)}×)`).join('\n'),
      );
    }
  });
});
