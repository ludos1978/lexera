import { mkdirSync, copyFileSync } from 'node:fs';
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

for (const rawDest of destinations) {
  const destDir = resolve(process.cwd(), rawDest);
  mkdirSync(destDir, { recursive: true });
  for (const asset of assets) {
    copyFileSync(resolve(sharedDir, asset), resolve(destDir, asset));
  }
  console.log('[lexera-shared] synced runtime assets -> ' + destDir);
}
