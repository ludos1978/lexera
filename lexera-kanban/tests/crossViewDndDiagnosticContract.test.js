// Pin the cross-view DnD diagnostic-log prefix.
//
// User-reported: cross-view drag-and-drop doesn't work, with no idea
// where the chain falls off (5 handoff points). The bridges now emit
// `lexeraLog('debug', '[xview-dnd] …')` lines at every stage so the
// user can open the Log panel filtered to `debug`, attempt a drag,
// and read the chain in chronological order.
//
// This contract guards against the next refactor silently stripping
// those log calls. Both sides of the chain (source-side bridge in
// `hierarchyDragBridge.js`, receiver-side relay in `embeddedBoardBridge.js`)
// must keep the `[xview-dnd]` prefix at the documented stages so a
// single-filter Log-panel query continues to surface the whole chain.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, '..', 'src');

function read(rel) {
  return readFileSync(resolve(srcDir, rel), 'utf8');
}

describe('cross-view DnD diagnostic-log contract', () => {
  it('hierarchyDragBridge logs the [xview-dnd] forward stage', () => {
    const src = read('shell/bridges/hierarchyDragBridge.js');
    expect(src).toMatch(/\[xview-dnd\]/);
    // The three forward-side stages we documented:
    //   forward.skip(no-payload-source)         — stage 1 fail
    //   forward.skip(no-target-webview-at-cursor) — stage 3 fail
    //   forward.emit                              — stage 4 success
    //   forward.emit.failed                       — stage 4 fail
    expect(src).toMatch(/forward\.skip\(no-payload-source\)/);
    expect(src).toMatch(/forward\.skip\(no-target-webview-at-cursor\)/);
    expect(src).toMatch(/forward\.emit\b/);
    expect(src).toMatch(/forward\.emit\.failed/);
  });

  it('hierarchyDragBridge logs the install mode (cross-view-enabled vs same-board-only)', () => {
    // Without an install-mode log, a sub-app or shell webview that
    // installed the bridge in degraded "same-board-only" state (no
    // cross-view forwarder) had no way to surface that fact. Both
    // branches must emit a log line so the user can tell from the
    // Log panel whether each webview has the cross-view forwarder.
    const src = read('shell/bridges/hierarchyDragBridge.js');
    expect(src).toMatch(/install\.cross-view-enabled/);
    expect(src).toMatch(/install\.same-board-only\(no-multiview-deps\)/);
  });

  it('workspaces.js logs source.broadcast + source.drag-end-external + their failure variants', () => {
    // Stage 1 of the chain — source emits broadcasts. Without a
    // source-side log, a misconfigured panel webview where
    // LexeraSubApp.broadcast silently fails (e.g., __TAURI__ not
    // ready, IPC error) leaves no trace. The log line lets the user
    // verify the source IS firing before tracing the rest of the
    // chain. Same-prefix `[xview-dnd]` so a single Log-panel filter
    // pulls every stage.
    const src = read('views/workspaces/workspaces.js');
    expect(src).toMatch(/\[xview-dnd\]/);
    expect(src).toMatch(/source\.broadcast\b/);
    expect(src).toMatch(/source\.broadcast\.failed/);
    expect(src).toMatch(/source\.drag-end-external\b/);
    expect(src).toMatch(/source\.drag-end-external\.failed/);
  });

  it('embeddedBoardBridge logs the [xview-dnd] receive stage', () => {
    const src = read('shell/bridges/embeddedBoardBridge.js');
    expect(src).toMatch(/\[xview-dnd\]/);
    // Receiver-side stages:
    //   receive                  — relay handler invoked
    //   receive.no-handler       — __lexeraExternalDnd missing
    //   receive.handler.threw    — relay called but handler threw
    expect(src).toMatch(/receive\b/);
    expect(src).toMatch(/receive\.no-handler/);
    expect(src).toMatch(/receive\.handler\.threw/);
  });

  it('both sides use the same [xview-dnd] prefix so one filter shows the whole chain', () => {
    const sourceSide = read('shell/bridges/hierarchyDragBridge.js');
    const receiverSide = read('shell/bridges/embeddedBoardBridge.js');
    // Each file must log via lexeraLog at debug level — that's the
    // surface the in-app Log panel reads from.
    for (const [path, src] of [
      ['hierarchyDragBridge.js', sourceSide],
      ['embeddedBoardBridge.js', receiverSide]
    ]) {
      expect(
        /window\.lexeraLog\s*\(\s*['"]debug['"]\s*,\s*['"]\[xview-dnd\]/.test(src),
        path + ' must call window.lexeraLog("debug", "[xview-dnd] …")'
      ).toBe(true);
    }
  });
});
