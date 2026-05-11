// Cross-window semantic drag/drop routing contract.
//
// Rows, stacks, columns, and cards must drag across both sibling
// views and separate top-level windows. Generic multiview broadcasts
// stay scoped to the caller window; drag-start and board invalidation
// use the global subscriber lane, while hot hover/drop routing goes
// directly to the single webview under the cursor.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

const webviewMgr = readFileSync(resolve(repoRoot, 'src-tauri', 'src', 'webview_mgr.rs'), 'utf8');
const mainRs = readFileSync(resolve(repoRoot, 'src-tauri', 'src', 'main.rs'), 'utf8');
const subAppRuntime = readFileSync(resolve(repoRoot, 'src', 'views', '_shared', 'subAppRuntime.js'), 'utf8');
const hierarchyDragBridge = readFileSync(resolve(repoRoot, 'src', 'shell', 'bridges', 'hierarchyDragBridge.js'), 'utf8');
const multiviewClient = readFileSync(resolve(repoRoot, 'src', 'shell', 'multiviewClient.js'), 'utf8');
const embeddedBoardBridge = readFileSync(resolve(repoRoot, 'src', 'shell', 'bridges', 'embeddedBoardBridge.js'), 'utf8');
const dndListeners = readFileSync(resolve(repoRoot, 'src', 'dragdrop', 'dndListeners.js'), 'utf8');
const dragDropHandlers = readFileSync(resolve(repoRoot, 'src', 'dragdrop', 'dragDropHandlers.js'), 'utf8');
const hierarchyView = readFileSync(resolve(repoRoot, 'src', 'views', 'hierarchy', 'hierarchy.js'), 'utf8');
const workspacesView = readFileSync(resolve(repoRoot, 'src', 'views', 'workspaces', 'workspaces.js'), 'utf8');

describe('cross-window drag/drop routing', () => {
  it('adds a global subscriber-only broadcast without changing generic multiview_broadcast scope', () => {
    expect(mainRs).toMatch(/webview_mgr::multiview_broadcast_global_subscribers/);
    const globalBlock = webviewMgr.match(
      /pub fn multiview_broadcast_global_subscribers[\s\S]*?\n\}/
    );
    expect(globalBlock, 'global subscriber command must exist').not.toBeNull();
    expect(globalBlock[0]).toMatch(/subscribers_for\(&reg,\s*&event\)/);
    expect(globalBlock[0]).toMatch(/emit_to\(label\.as_str\(\),\s*&event/);
    expect(globalBlock[0]).not.toMatch(/caller\.window|window_webview_labels|subs\.is_empty\(\)/);

    const scopedBlock = webviewMgr.match(/pub fn multiview_broadcast\([\s\S]*?\n\}/);
    expect(scopedBlock, 'generic scoped broadcast must still exist').not.toBeNull();
    expect(scopedBlock[0]).toMatch(/caller\.window\(\)/);
    expect(scopedBlock[0]).toMatch(/window_webview_labels\.contains/);
  });

  it('adds native screen-space hit-test and direct external-DnD route commands', () => {
    expect(mainRs).toMatch(/webview_mgr::multiview_webview_at_screen_point/);
    expect(mainRs).toMatch(/webview_mgr::multiview_route_external_dnd/);
    expect(webviewMgr).toMatch(/fn\s+webview_at_screen_point[\s\S]*outer_position\(\)[\s\S]*scale_factor\(\)/);
    expect(webviewMgr).toMatch(/fn\s+webview_at_window_point/);
    expect(webviewMgr).toMatch(/source_webview_label/);
    expect(webviewMgr).toMatch(/local_x:\s*screen_x\s*-\s*left/);
    expect(webviewMgr).toMatch(/local_y:\s*screen_y\s*-\s*top/);
    expect(webviewMgr).toMatch(/source_client_x/);
    expect(webviewMgr).toMatch(/same_window_hit/);
    expect(webviewMgr).toMatch(/pub fn multiview_route_external_dnd/);
    expect(webviewMgr).toMatch(/external-dnd-hover/);
    expect(webviewMgr).toMatch(/external-dnd-drop/);
    expect(webviewMgr).toMatch(/emit_to\(hit\.label\.as_str\(\),\s*request\.event\.as_str\(\),\s*payload\)/);
  });

  it('keeps hot drag-move/drop off the global subscriber lane', () => {
    const map = subAppRuntime.match(/GLOBAL_SUBSCRIBER_EVENTS\s*=\s*\{[\s\S]*?\}/);
    expect(map, 'LexeraSubApp global event allowlist must exist').not.toBeNull();
    expect(map[0]).toMatch(/['"]hierarchy-entity-drag-start['"]/);
    expect(map[0]).toMatch(/['"]cross-view-drag-handled['"]/);
    expect(map[0]).toMatch(/['"]hierarchy-board-changed['"]/);
    expect(map[0]).not.toMatch(/hierarchy-entity-drag-move/);
    expect(map[0]).not.toMatch(/hierarchy-entity-drag-end-external/);
    expect(map[0]).not.toMatch(/hierarchy-entity-drop/);
    expect(subAppRuntime).toMatch(/GLOBAL_SUBSCRIBER_EVENTS\[event\][\s\S]{0,160}multiview_broadcast_global_subscribers/);
  });

  it('hierarchy DnD saves invalidate affected boards without rebroadcasting the full catalog', () => {
    const installIdx = multiviewClient.search(/function\s+installHierarchyDragBridge\s*\(/);
    expect(installIdx).toBeGreaterThan(-1);
    const installBlock = multiviewClient.slice(installIdx, installIdx + 2600);
    expect(installBlock).toMatch(/hierarchy-board-changed/);
    expect(installBlock).not.toMatch(/broadcastCatalog\s*\(/);
  });

  it('source views route hover/drop directly by source-client coordinates with screen fallback', () => {
    for (const src of [dragDropHandlers, hierarchyView, workspacesView]) {
      expect(src).toMatch(/multiview_route_external_dnd/);
      expect(src).toMatch(/external-dnd-hover/);
      expect(src).toMatch(/external-dnd-drop/);
      expect(src).toMatch(/sourceWebviewLabel/);
      expect(src).toMatch(/sourceClientX/);
      expect(src).toMatch(/sourceClientY/);
      expect(src).toMatch(/screenX/);
      expect(src).toMatch(/screenY/);
      expect(src).not.toMatch(/broadcast\(\s*['"]hierarchy-entity-drag-move['"]/);
      expect(src).not.toMatch(/broadcast\(\s*['"]hierarchy-entity-drag-end-external['"]/);
    }
    expect(dndListeners).toMatch(/broadcastCrossViewDragMove\(e\.clientX,\s*e\.clientY,\s*e\.screenX,\s*e\.screenY\)/);
    expect(dndListeners).toMatch(/broadcastCrossViewDragEnd\(e\.clientX,\s*e\.clientY,\s*e\.screenX,\s*e\.screenY\)/);
  });

  it('the shell keeps the legacy same-window/native fallback router for older source broadcasts', () => {
    expect(hierarchyDragBridge).toMatch(/routeCrossViewDragPoint\(/);
    expect(hierarchyDragBridge).toMatch(/multiview_webview_at_screen_point/);
    expect(hierarchyDragBridge).toMatch(/getWebviewRect\(payload\.sourceWebviewLabel\)/);
    expect(hierarchyDragBridge).toMatch(/multiview_emit_to/);
    expect(hierarchyDragBridge).toMatch(/targetLabel:\s*hit\.label/);
    expect(hierarchyDragBridge).toMatch(/localX:\s*hit\.localX/);
    expect(hierarchyDragBridge).toMatch(/localY:\s*hit\.localY/);
  });

  it('semantic sources cover rows, stacks, columns, and cards', () => {
    for (const src of [dragDropHandlers, dndListeners, hierarchyDragBridge, embeddedBoardBridge]) {
      expect(src).toMatch(/card/);
      expect(src).toMatch(/column/);
      expect(src).toMatch(/stack/);
      expect(src).toMatch(/row/);
    }
    expect(dndListeners).toMatch(/['"]drag-card['"]/);
    expect(dndListeners).toMatch(/['"]drag-column['"]/);
    expect(dndListeners).toMatch(/['"]drag-stack['"]/);
    expect(dndListeners).toMatch(/['"]drag-row['"]/);
  });

  it('kanban destinations globally echo cross-view-drag-handled after a resolved external drop', () => {
    const idx = embeddedBoardBridge.search(/wv\.listen\(\s*['"]external-dnd-drop['"]/);
    expect(idx).toBeGreaterThan(-1);
    const tail = embeddedBoardBridge.slice(idx, idx + 2500);
    expect(tail).toMatch(/hierarchy-entity-drop/);
    expect(tail).toMatch(/broadcastCrossViewDragHandled/);
    expect(embeddedBoardBridge).toMatch(/multiview_broadcast_global_subscribers[\s\S]{0,120}cross-view-drag-handled/);
  });
});
