// @vitest-environment jsdom

/**
 * Contract tests for `getDragTargetAtTopPoint(topX, topY)` in
 * dragDropHandlers.js — the unified cross-view cursor resolver that
 * Phase 5 of the workspace-viewer drag work consumes.
 *
 * Three outcomes the bridge must distinguish:
 *   - iframe hit          → `{ kind: 'iframe', win: Window }`
 *   - native-webview hit  → `{ kind: 'native-webview', label: string }`
 *   - plain shell DOM     → `null`
 *
 * Iframe-hit precedence matters: if both an iframe and a native webview
 * report overlap at the same screen coord, the iframe wins because the
 * cursor is in fact intercepting it (z-order: iframe is in document
 * flow; native webview paints on top of the placeholder rect but not
 * on top of an iframe that overlaps it).
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, '..', 'src');

function loadDragDropHandlers() {
  const source = readFileSync(resolve(srcDir, 'dragdrop/dragDropHandlers.js'), 'utf-8');
  return new Function(`${source}\nreturn LexeraDragDropHandlers;`)();
}

let DDH;

beforeAll(() => {
  DDH = loadDragDropHandlers();
});

beforeEach(() => {
  document.body.innerHTML = '';
  delete window.LexeraMultiviewWebview;
  // Restore the default elementFromPoint behavior (jsdom returns null
  // unless we override it) — each test stubs it as needed.
  document.elementFromPoint = () => null;
});

describe('getDragTargetAtTopPoint — outcome matrix', () => {
  it('returns null when cursor is over plain shell DOM and no native webviews are spawned', () => {
    const div = document.createElement('div');
    div.className = 'shell-content';
    document.body.appendChild(div);
    document.elementFromPoint = () => div;
    expect(DDH.getDragTargetAtTopPoint(100, 100)).toBeNull();
  });

  it('returns an iframe target when cursor is over an `<iframe>`', () => {
    const iframe = document.createElement('iframe');
    document.body.appendChild(iframe);
    // jsdom gives the iframe a contentWindow — that's the value we
    // expect the bridge to receive so it can call __lexeraExternalDnd
    // on the iframe's window directly.
    document.elementFromPoint = () => iframe;
    const target = DDH.getDragTargetAtTopPoint(100, 100);
    expect(target).toBeTruthy();
    expect(target.kind).toBe('iframe');
    expect(target.win).toBe(iframe.contentWindow);
  });

  it('returns a native-webview target when LexeraMultiviewWebview reports a label hit', () => {
    // No iframe under cursor; multiview reports a hit.
    document.elementFromPoint = () => document.body;
    window.LexeraMultiviewWebview = {
      getWebviewLabelAtTopPoint: (x, y) => {
        if (x === 200 && y === 150) return 'panel-tab-tab-logs';
        return null;
      }
    };
    const target = DDH.getDragTargetAtTopPoint(200, 150);
    expect(target).toEqual({ kind: 'native-webview', label: 'panel-tab-tab-logs' });
  });

  it('returns null when neither an iframe nor any native webview matches', () => {
    document.elementFromPoint = () => document.body;
    window.LexeraMultiviewWebview = {
      getWebviewLabelAtTopPoint: () => null
    };
    expect(DDH.getDragTargetAtTopPoint(50, 50)).toBeNull();
  });

  it('iframe hit takes precedence over a native-webview overlap at the same screen coord', () => {
    const iframe = document.createElement('iframe');
    document.body.appendChild(iframe);
    document.elementFromPoint = () => iframe;
    // Multiview WOULD claim the same point — but the iframe is in DOM
    // and the cursor is intercepting it, so the bridge must route via
    // direct cross-frame JS, not IPC.
    window.LexeraMultiviewWebview = {
      getWebviewLabelAtTopPoint: () => 'panel-tab-tab-something'
    };
    const target = DDH.getDragTargetAtTopPoint(100, 100);
    expect(target.kind).toBe('iframe');
    expect(target.win).toBe(iframe.contentWindow);
  });

  it('does not crash when LexeraMultiviewWebview is absent (non-Tauri context, e.g. detached test runner)', () => {
    document.elementFromPoint = () => document.body;
    expect(window.LexeraMultiviewWebview).toBeUndefined();
    expect(() => DDH.getDragTargetAtTopPoint(50, 50)).not.toThrow();
    expect(DDH.getDragTargetAtTopPoint(50, 50)).toBeNull();
  });

  it('does not crash when LexeraMultiviewWebview lacks the getWebviewLabelAtTopPoint export', () => {
    document.elementFromPoint = () => document.body;
    window.LexeraMultiviewWebview = {}; // no methods
    expect(() => DDH.getDragTargetAtTopPoint(50, 50)).not.toThrow();
    expect(DDH.getDragTargetAtTopPoint(50, 50)).toBeNull();
  });

  it('falls back to native-webview lookup when document.elementFromPoint is absent', () => {
    // Hostile environment: top window has no elementFromPoint. The
    // function must not throw — it should still consult multiview.
    delete document.elementFromPoint;
    window.LexeraMultiviewWebview = {
      getWebviewLabelAtTopPoint: () => 'panel-tab-tab-x'
    };
    expect(DDH.getDragTargetAtTopPoint(10, 10)).toEqual({
      kind: 'native-webview', label: 'panel-tab-tab-x'
    });
  });
});
