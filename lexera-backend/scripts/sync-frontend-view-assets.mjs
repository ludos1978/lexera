import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const backendSrcDir = resolve(__dirname, '..', 'src');
const kanbanSrcDir = resolve(__dirname, '..', '..', 'lexera-kanban', 'src');

// workspaceShell.js throws at parse time if its global deps are missing.
// Keep this list in dependency order — copyFileSync order doesn't matter
// at runtime, but the matching <script> tags in connection-settings.html
// must load these before workspaceShell.js.
const assets = [
  ['logging/loggingSystem.js', 'loggingSystem.js'],
  ['titleHelpers.js', 'titleHelpers.js'],
  ['workspace/layoutTree.js', 'layoutTree.js'],
  ['workspace/lifecycleReconciler.js', 'lifecycleReconciler.js'],
  ['workspace/boardHost.js', 'boardHost.js'],
  ['workspace/panelHost.js', 'panelHost.js'],
  ['workspace/multiviewWebview.js', 'multiviewWebview.js'],
  ['workspace/messageBridge.js', 'messageBridge.js'],
  ['workspace/panelDefinitions.js', 'panelDefinitions.js'],
  ['workspace/treeRegistry.js', 'treeRegistry.js'],
  ['workspace/layoutPersistence.js', 'layoutPersistence.js'],
  ['workspace/tabDragController.js', 'tabDragController.js'],
  ['workspace/sharedPanels.js', 'sharedPanels.js'],
  ['workspace/workspaceShell.js', 'workspaceShell.js'],
  ['workspace/workspaceShell.css', 'workspaceShell.css']
];

mkdirSync(backendSrcDir, { recursive: true });

for (const [sourceRelative, targetRelative] of assets) {
  copyFileSync(resolve(kanbanSrcDir, sourceRelative), resolve(backendSrcDir, targetRelative));
}

console.log('[lexera-backend] synced frontend view assets -> ' + backendSrcDir);
