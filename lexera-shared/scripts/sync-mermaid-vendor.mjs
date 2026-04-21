#!/usr/bin/env node
/**
 * Refresh the vendored Mermaid bundle at
 * `lexera-kanban/src/vendor/mermaid/`.
 *
 * Phase 7.5 gap #6 from IPC-Migration-Plan.md: Mermaid is vendored so the
 * desktop build does not depend on a CDN. This script re-pulls the pinned
 * version + LICENSE from jsdelivr, verifies a non-empty download, and
 * writes the files in place.
 *
 * Usage:
 *   node lexera-shared/scripts/sync-mermaid-vendor.mjs
 *   MERMAID_VERSION=11.14.1 node lexera-shared/scripts/sync-mermaid-vendor.mjs
 *
 * To bump the pinned version:
 *   1. Update MERMAID_VERSION_DEFAULT below.
 *   2. Run this script.
 *   3. Update the version in `THIRD_PARTY_LICENSES.md` (Vendored Runtime
 *      Assets section).
 *   4. Re-run the Phase-4 rendering smoke tests in IPC-Smoke-Test.md.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MERMAID_VERSION_DEFAULT = '11.14.0';
const version = process.env.MERMAID_VERSION || MERMAID_VERSION_DEFAULT;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '..', '..');
const vendorDir = resolve(repoRoot, 'lexera-kanban', 'src', 'vendor', 'mermaid');

async function fetchToBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`GET ${url} -> ${res.status} ${res.statusText}`);
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength === 0) {
    throw new Error(`GET ${url} returned empty body`);
  }
  return buf;
}

async function main() {
  console.log(`[mermaid-vendor] pin=${version} target=${vendorDir}`);
  await mkdir(vendorDir, { recursive: true });

  const base = `https://cdn.jsdelivr.net/npm/mermaid@${version}`;
  const jsUrl = `${base}/dist/mermaid.min.js`;
  const licenseUrl = `${base}/LICENSE`;

  const [js, license] = await Promise.all([
    fetchToBuffer(jsUrl),
    fetchToBuffer(licenseUrl),
  ]);

  await writeFile(resolve(vendorDir, 'mermaid.min.js'), js);
  await writeFile(resolve(vendorDir, 'LICENSE'), license);
  await writeFile(
    resolve(vendorDir, 'VERSION'),
    `${version}\n`
  );

  console.log(
    `[mermaid-vendor] wrote mermaid.min.js (${js.byteLength} bytes), LICENSE (${license.byteLength} bytes), VERSION=${version}`
  );
  console.log(
    '[mermaid-vendor] remember: update THIRD_PARTY_LICENSES.md if the pin changed.'
  );
}

main().catch((err) => {
  console.error('[mermaid-vendor] FAILED:', err.message || err);
  process.exitCode = 1;
});
