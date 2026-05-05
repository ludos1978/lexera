import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const sharedDir = resolve(__dirname, '..');
const assets = [
  'management.js',
  'management.css',
  'themes.js',
  'backendDiscovery.js',
  'dialogs.js',
  'dialogs.css'
];

const destinations = process.argv.slice(2);

if (destinations.length === 0) {
  console.error('Usage: node sync-runtime-assets.mjs <dest-dir> [dest-dir...]');
  process.exit(1);
}

// IMPORTANT: write only when the content actually changed.
//
// In Tauri 2 dev mode, the per-app `frontendDist` (e.g.
// lexera-kanban/src) is watched for changes. Any unconditional
// `copyFileSync` here bumps the destination mtime even when the bytes
// are identical, and the watcher reloads the main webview a few
// hundred ms after boot. The old shell's `destroyAll()` fires async
// IPCs that race the new shell's spawn loop, leaving the old set of
// child webviews painting at the same coordinates as the new set —
// the user-visible "windows are visible multiple times" / "content
// in the background view" regression.
//
// Compare bytes (cheap; max ~MB per file, ran once per dev launch +
// once per build). If equal, do nothing — neither write nor mtime
// touch — so the watcher stays quiet.
function bytesEqual(a, b) {
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  return a.equals(b);
}

for (const rawDest of destinations) {
  const destDir = resolve(process.cwd(), rawDest);
  mkdirSync(destDir, { recursive: true });
  let written = 0;
  let skipped = 0;
  for (const asset of assets) {
    const srcPath = resolve(sharedDir, asset);
    const dstPath = resolve(destDir, asset);
    const srcBytes = readFileSync(srcPath);
    let dstBytes = null;
    if (existsSync(dstPath)) {
      try { dstBytes = readFileSync(dstPath); } catch (_) { dstBytes = null; }
    }
    if (bytesEqual(srcBytes, dstBytes)) {
      skipped += 1;
      continue;
    }
    writeFileSync(dstPath, srcBytes);
    written += 1;
  }
  console.log('[lexera-shared] synced runtime assets -> ' + destDir +
    ' (' + written + ' written, ' + skipped + ' unchanged)');
}
