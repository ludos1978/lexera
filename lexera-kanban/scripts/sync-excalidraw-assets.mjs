// Sync the Excalidraw runtime bundle + its asset directory from
// node_modules/ into lexera-kanban/src/vendor/excalidraw/.
//
// Idempotency contract — same as lexera-shared/scripts/sync-runtime-assets.mjs:
//
// In Tauri 2 dev mode, frontendDist (= lexera-kanban/src/) is watched
// for any file change. The previous shell-script version of this sync
// did unconditional `cp` of three top-level files plus a recursive
// `cp -R` of the assets dir. cp bumps destination mtime even when the
// bytes are byte-identical, so the watcher fires a few hundred ms
// after boot, the main webview reloads mid-spawn, and the old shell's
// destroyAll() loses its race against the new shell's spawn loop —
// the user-visible "ghost child webviews painting in the background"
// regression. Same root cause class as cecd3aa7 fixed for the
// lexera-shared sync; this script is the second offender.
//
// Behaviour: read source + destination bytes, byte-compare, write only
// when they differ. mtimes stay frozen on identical content so the
// dev watcher doesn't fire.

import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, resolve, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, '..');
const vendorDir = resolve(rootDir, 'src', 'vendor', 'excalidraw');
const nodeModules = resolve(rootDir, '..', 'node_modules');

const TOP_LEVEL_FILES = [
  {
    src: resolve(nodeModules, 'react/umd/react.production.min.js'),
    dst: resolve(vendorDir, 'react.production.min.js'),
  },
  {
    src: resolve(nodeModules, 'react-dom/umd/react-dom.production.min.js'),
    dst: resolve(vendorDir, 'react-dom.production.min.js'),
  },
  {
    src: resolve(nodeModules, '@excalidraw/excalidraw/dist/excalidraw.production.min.js'),
    dst: resolve(vendorDir, 'excalidraw.production.min.js'),
  },
];

const ASSETS_SRC_DIR = resolve(nodeModules, '@excalidraw/excalidraw/dist/excalidraw-assets');
const ASSETS_DST_DIR = resolve(vendorDir, 'excalidraw-assets');

function bytesEqual(a, b) {
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  return a.equals(b);
}

function syncFile(srcPath, dstPath) {
  const srcBytes = readFileSync(srcPath);
  let dstBytes = null;
  if (existsSync(dstPath)) {
    try { dstBytes = readFileSync(dstPath); } catch (_) { dstBytes = null; }
  }
  if (bytesEqual(srcBytes, dstBytes)) return false;
  mkdirSync(dirname(dstPath), { recursive: true });
  writeFileSync(dstPath, srcBytes);
  return true;
}

function walkFiles(dir) {
  const out = [];
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try { entries = readdirSync(cur, { withFileTypes: true }); }
    catch (_) { continue; }
    for (const entry of entries) {
      const full = join(cur, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile()) out.push(full);
    }
  }
  return out;
}

mkdirSync(vendorDir, { recursive: true });
mkdirSync(ASSETS_DST_DIR, { recursive: true });

let written = 0;
let unchanged = 0;

for (const { src, dst } of TOP_LEVEL_FILES) {
  if (!existsSync(src)) {
    throw new Error('[sync-excalidraw-assets] missing source file: ' + src);
  }
  if (syncFile(src, dst)) written += 1;
  else unchanged += 1;
}

if (existsSync(ASSETS_SRC_DIR)) {
  const srcFiles = walkFiles(ASSETS_SRC_DIR);
  for (const srcFile of srcFiles) {
    const rel = relative(ASSETS_SRC_DIR, srcFile);
    const dstFile = resolve(ASSETS_DST_DIR, rel);
    if (syncFile(srcFile, dstFile)) written += 1;
    else unchanged += 1;
  }
} else {
  throw new Error('[sync-excalidraw-assets] missing source dir: ' + ASSETS_SRC_DIR);
}

console.log('[sync-excalidraw-assets] synced -> ' + vendorDir +
  ' (' + written + ' written, ' + unchanged + ' unchanged)');
