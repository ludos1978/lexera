import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const backendSrcDir = resolve(__dirname, '..', 'src');
const kanbanSrcDir = resolve(__dirname, '..', '..', 'lexera-kanban', 'src');

const assets = [
  ['logging/loggingSystem.js', 'loggingSystem.js'],
  ['workspace/sharedPanels.js', 'sharedPanels.js'],
  ['workspace/workspaceShell.js', 'workspaceShell.js'],
  ['workspace/workspaceShell.css', 'workspaceShell.css']
];

mkdirSync(backendSrcDir, { recursive: true });

for (const [sourceRelative, targetRelative] of assets) {
  copyFileSync(resolve(kanbanSrcDir, sourceRelative), resolve(backendSrcDir, targetRelative));
}

console.log('[lexera-backend] synced frontend view assets -> ' + backendSrcDir);
