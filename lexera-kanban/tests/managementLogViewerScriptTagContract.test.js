// Pins the load order: every host HTML that includes `management.js` MUST
// also include `managementLogViewer.js` BEFORE it. The shared management
// IIFE reads `window.LexeraManagementLogHelpers` at evaluation time and
// throws if the global isn't there, so a forgotten `<script>` tag breaks
// the whole management/log UI silently in production but loudly here.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');

// Files that load `management.js`. If a new HTML page picks up the
// management IIFE, add it here so the contract continues to fence drift.
const HOSTS = [
  'lexera-kanban/src/index.html',
  'lexera-kanban/src/views/backendSettings/index.html',
  'lexera-kanban/src/views/files/index.html',
  'lexera-backend/src/connection-settings.html',
];

function extractScriptSrcs(html) {
  const out = [];
  const re = /<script\b[^>]*\bsrc\s*=\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(html)) !== null) out.push(m[1]);
  return out;
}

function basename(src) {
  const slash = src.lastIndexOf('/');
  return slash === -1 ? src : src.slice(slash + 1);
}

describe('managementLogViewer.js script-tag load order', () => {
  for (const host of HOSTS) {
    describe(host, () => {
      const html = readFileSync(resolve(repoRoot, host), 'utf-8');
      const srcs = extractScriptSrcs(html);
      const names = srcs.map(basename);

      it('loads management.js', () => {
        expect(names).toContain('management.js');
      });

      it('loads managementLogViewer.js', () => {
        expect(names).toContain('managementLogViewer.js');
      });

      it('loads managementLogViewer.js BEFORE management.js', () => {
        const helperIdx = names.indexOf('managementLogViewer.js');
        const mainIdx = names.indexOf('management.js');
        expect(helperIdx, 'managementLogViewer.js must be present').toBeGreaterThan(-1);
        expect(mainIdx, 'management.js must be present').toBeGreaterThan(-1);
        expect(helperIdx).toBeLessThan(mainIdx);
      });
    });
  }
});
