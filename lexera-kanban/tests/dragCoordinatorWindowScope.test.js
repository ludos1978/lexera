// Drag coordinator window scoping — source-level contract.
//
// User report: "different windows still interfere with each other ...
// views suddenly disappear". Audit found that `drag_coordinator.rs`
// emitted `drag-began` and `drag-ended` via `app.emit(…)` (global
// broadcast). Sub-apps in window B subscribe via `wv.listen('drag-…')`
// per-webview, which in Tauri 2 still receives global emits — so a
// drag started in window A activated window B's drop zones / cleared
// window B's drag UI on completion.
//
// Fix: route the lifecycle events through `emit_to_source_window`,
// a helper that resolves the source webview's parent window and
// `emit_to`s every webview in that window only. Same pattern as
// `multiview_broadcast`.
//
// This test pins the source-level invariants so a regression that
// reintroduces `app.emit("drag-began"` etc. fails CI.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dragCoordinatorRs = readFileSync(
  resolve(__dirname, '..', 'src-tauri', 'src', 'drag_coordinator.rs'),
  'utf8'
);
const webviewMgrRs = readFileSync(
  resolve(__dirname, '..', 'src-tauri', 'src', 'webview_mgr.rs'),
  'utf8'
);

describe('drag_coordinator.rs — drag lifecycle events are window-scoped', () => {
  it('does NOT use app.emit("drag-began", …) — would broadcast to every window', () => {
    expect(dragCoordinatorRs).not.toMatch(/app\.emit\(\s*"drag-began"/);
  });

  it('does NOT use app.emit("drag-ended", …) — would broadcast to every window', () => {
    expect(dragCoordinatorRs).not.toMatch(/app\.emit\(\s*"drag-ended"/);
  });

  it('webview_mgr exposes emit_to_window_of_label that resolves parent via app.webviews().get(label).window()', () => {
    expect(webviewMgrRs).toMatch(/pub fn emit_to_window_of_label/);
    // Helper must look up the source's parent window through the
    // webview registry rather than hardcoding "main" (which would
    // miss secondary windows).
    expect(webviewMgrRs).toMatch(/app\.webviews\(\)\.get\(source_label\)/);
    expect(webviewMgrRs).toMatch(/source_window\.webviews\(\)/);
  });

  it('drag_coordinator imports emit_to_window_of_label from webview_mgr (no duplicate definition)', () => {
    expect(dragCoordinatorRs).toMatch(/use crate::webview_mgr::\{[^}]*emit_to_window_of_label/);
    expect(dragCoordinatorRs).not.toMatch(/fn emit_to_window_of_label/);
  });

  it('drag_start uses emit_to_window_of_label for drag-began', () => {
    // Slice from the drag_start signature to the next pub fn. The
    // helper call must appear in this slice.
    var start = dragCoordinatorRs.indexOf('pub fn drag_start');
    expect(start).toBeGreaterThan(-1);
    var nextFn = dragCoordinatorRs.indexOf('pub fn ', start + 1);
    var slice = dragCoordinatorRs.substring(start, nextFn === -1 ? dragCoordinatorRs.length : nextFn);
    expect(slice).toMatch(/emit_to_window_of_label\(\s*&app,\s*&payload\.source,\s*"drag-began"/);
  });

  it('drag_pointer_up uses emit_to_window_of_label for drag-ended', () => {
    var start = dragCoordinatorRs.indexOf('pub fn drag_pointer_up');
    var nextFn = dragCoordinatorRs.indexOf('pub fn ', start + 1);
    var slice = dragCoordinatorRs.substring(start, nextFn === -1 ? dragCoordinatorRs.length : nextFn);
    expect(slice).toMatch(/emit_to_window_of_label\(&app, &active\.source_label, "drag-ended"/);
  });

  it('drag_cancel uses emit_to_window_of_label for drag-ended', () => {
    var start = dragCoordinatorRs.indexOf('pub fn drag_cancel');
    var nextFn = dragCoordinatorRs.indexOf('pub fn ', start + 1);
    var slice = dragCoordinatorRs.substring(start, nextFn === -1 ? dragCoordinatorRs.length : nextFn);
    expect(slice).toMatch(/emit_to_window_of_label\(&app, &active\.source_label, "drag-ended"/);
  });

  it('DragState is per-window (HashMap keyed by source webview\'s parent window), not a process-singleton Option', () => {
    // Earlier shape `Mutex<Option<ActiveDrag>>` allowed only one drag
    // anywhere in the app. Drag in window B while window A was mid-
    // drag would error or stomp window A's state. Keying by window
    // label gives each window its own slot.
    expect(dragCoordinatorRs).toMatch(/inner:\s*Mutex<HashMap<String,\s*ActiveDrag>>/);
    expect(dragCoordinatorRs).not.toMatch(/inner:\s*Mutex<Option<ActiveDrag>>/);
  });

  it('drag_start takes caller: tauri::Webview and keys DragState by caller.window().label()', () => {
    var slice = dragCoordinatorRs.indexOf('pub fn drag_start');
    var nextFn = dragCoordinatorRs.indexOf('pub fn ', slice + 1);
    var body = dragCoordinatorRs.substring(slice, nextFn);
    expect(body).toMatch(/caller:\s*tauri::Webview/);
    expect(body).toMatch(/caller\.window\(\)\.label\(\)/);
    // The duplicate-drag check is now per-window.
    expect(body).toMatch(/contains_key\(&window_label\)/);
    expect(body).toMatch(/state\.insert\(window_label/);
  });

  it('drag_pointer_move resolves ghost screen coords from caller.window() — not hardcoded "main"', () => {
    var slice = dragCoordinatorRs.indexOf('pub fn drag_pointer_move');
    var nextFn = dragCoordinatorRs.indexOf('pub fn ', slice + 1);
    var body = dragCoordinatorRs.substring(slice, nextFn);
    expect(body).toMatch(/caller:\s*tauri::Webview/);
    // Look up the active drag in this window's slot.
    expect(body).toMatch(/state\.get_mut\(&window_label\)/);
    // Use caller_window for screen-space conversion, NOT "main".
    expect(body).toMatch(/caller_window\.outer_position\(\)/);
    expect(body).toMatch(/caller_window\.scale_factor\(\)/);
    // Strip comments and check no production code path uses "main" here.
    var codeOnly = body.split('\n').map(function (l) {
      var i = l.indexOf('//');
      return i === -1 ? l : l.substring(0, i);
    }).join('\n');
    expect(codeOnly).not.toMatch(/get_webview_window\("main"\)/);
  });

  it('drag_pointer_up takes caller and removes its window\'s entry', () => {
    var slice = dragCoordinatorRs.indexOf('pub fn drag_pointer_up');
    var nextFn = dragCoordinatorRs.indexOf('pub fn ', slice + 1);
    var body = dragCoordinatorRs.substring(slice, nextFn);
    expect(body).toMatch(/caller:\s*tauri::Webview/);
    expect(body).toMatch(/state\.remove\(&window_label\)/);
  });

  it('drag_cancel takes caller and removes its window\'s entry', () => {
    var slice = dragCoordinatorRs.indexOf('pub fn drag_cancel');
    var nextFn = dragCoordinatorRs.indexOf('pub fn ', slice + 1);
    var body = dragCoordinatorRs.substring(slice, nextFn);
    expect(body).toMatch(/caller:\s*tauri::Webview/);
    expect(body).toMatch(/state\.remove\(&window_label\)/);
  });

  it('targeted emits to specific labels (drag-enter / drag-over / drop / drag-leave / drag-cancelled / drag-complete) remain — those carry an explicit target', () => {
    // Confirm the legitimate emit_to calls weren't accidentally removed
    // along with the broadcasts. Each event name is just searched for
    // appearing inside a `.emit_to(` call (multi-line tolerant via [\s\S]).
    var hasEmitTo = function (eventName) {
      var pattern = new RegExp('emit_to\\([\\s\\S]{0,80}"' + eventName + '"');
      return pattern.test(dragCoordinatorRs);
    };
    expect(hasEmitTo('drag-enter')).toBe(true);
    expect(hasEmitTo('drag-over')).toBe(true);
    expect(hasEmitTo('drop')).toBe(true);
    expect(hasEmitTo('drag-leave')).toBe(true);
    expect(hasEmitTo('drag-cancelled')).toBe(true);
    expect(hasEmitTo('drag-complete')).toBe(true);
  });
});
