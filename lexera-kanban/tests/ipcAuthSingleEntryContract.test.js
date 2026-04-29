import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcRoot = resolve(__dirname, '..', 'src');

function walkJs(dir, out = []) {
  const entries = readdirSync(dir);
  for (const name of entries) {
    const full = join(dir, name);
    if (name === 'vendor' || name === 'node_modules') continue;
    let s;
    try { s = statSync(full); } catch (_) { continue; }
    if (s.isDirectory()) walkJs(full, out);
    else if (s.isFile() && full.endsWith('.js')) out.push(full);
  }
  return out;
}

describe('IPC auth single-entry-point contract', () => {
  // Authorization headers for backend-bound Tauri IPC are injected by
  // `ensureIpcAuthHeaders()` inside api.js — every backend call must
  // route through `ipcFetch` / `LexeraApi.request` / `LexeraApi.upload`.
  // A direct `core.invoke('backend_ipc_*')` from another file would
  // skip the auth layer; the resulting 401 surfaces as an opaque
  // "operation failed" — recently caused the Excalidraw / Draw.io
  // template-drag silent failure. This test fails loudly if a new
  // call site is added outside api.js.
  it('only api.js invokes backend_ipc_* commands directly', () => {
    const files = walkJs(srcRoot);
    const offenders = [];
    for (const file of files) {
      if (file.endsWith('/api.js')) continue;
      const src = readFileSync(file, 'utf8');
      // Strip line comments so a `// see backend_ipc_request` reference
      // doesn't trigger the check; block comments are kept (rare in
      // practice and easy to spot manually if they ever match).
      const stripped = src.replace(/\/\/[^\n]*/g, '');
      // Match an actual invocation, not a string mention or a doc reference.
      const callRe = /\binvoke\s*\(\s*['"]backend_ipc_[a-z_]+['"]/;
      if (callRe.test(stripped)) {
        offenders.push(file.replace(srcRoot + '/', ''));
      }
    }
    expect(offenders, 'these files invoke backend_ipc_* directly — route them through LexeraApi.request / ipcFetch instead so auth headers are injected').toEqual([]);
  });

  it('api.js still owns ensureIpcAuthHeaders and applies it in ipcFetch + ipcUpload', () => {
    const apiSrc = readFileSync(resolve(srcRoot, 'api.js'), 'utf8');
    expect(apiSrc).toMatch(/function\s+ensureIpcAuthHeaders\s*\(/);
    expect(apiSrc).toMatch(/headers:\s*await\s+ensureIpcAuthHeaders\(/);
    // Both backend_ipc_request (regular) and backend_ipc_upload (binary)
    // must seed headers via the same helper. Two distinct call sites
    // are expected — guard against drift on either.
    const ipcRequestHeaderInjections = (apiSrc.match(/backend_ipc_request[\s\S]{0,400}?ensureIpcAuthHeaders/g) || []).length
      + (apiSrc.match(/ensureIpcAuthHeaders[\s\S]{0,600}?backend_ipc_request/g) || []).length;
    const ipcUploadHeaderInjections = (apiSrc.match(/backend_ipc_upload[\s\S]{0,400}?ensureIpcAuthHeaders/g) || []).length
      + (apiSrc.match(/ensureIpcAuthHeaders[\s\S]{0,600}?backend_ipc_upload/g) || []).length;
    expect(ipcRequestHeaderInjections, 'backend_ipc_request must be paired with ensureIpcAuthHeaders').toBeGreaterThan(0);
    expect(ipcUploadHeaderInjections, 'backend_ipc_upload must be paired with ensureIpcAuthHeaders').toBeGreaterThan(0);
  });
});
