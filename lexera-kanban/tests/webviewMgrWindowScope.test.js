// webview_mgr.rs window-scope contract.
//
// User report: views suddenly disappear / wrong window receives
// events. Audit found two related causes in webview_mgr.rs:
//
//   1. Lifecycle commands (multiview_destroy, multiview_set_geometry,
//      multiview_navigate, multiview_set_visible) all looked up the
//      target webview under a hardcoded `app.get_window("main")`
//      parent. Child webviews hosted in secondary windows would
//      silently no-op — the destroy / move / hide call wouldn't
//      reach them, leaving "ghost" child webviews painting where
//      they shouldn't.
//
//   2. focus-changed / multiview-destroyed / health-changed events
//      were emitted via `app.emit(…)` (global broadcast). Sub-apps
//      in sibling windows would then act on the event as if it
//      pertained to one of their own webviews.
//
// This contract pins both fixes at the source level so a regression
// that reintroduces `get_window("main")` for a label-keyed lookup
// or `app.emit("focus-changed"|"multiview-destroyed"|"health-changed", …)`
// fails CI.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const webviewMgrRs = readFileSync(
  resolve(__dirname, '..', 'src-tauri', 'src', 'webview_mgr.rs'),
  'utf8'
);

function fnSlice(name) {
  var start = webviewMgrRs.indexOf('pub fn ' + name);
  if (start === -1) throw new Error('function not found: ' + name);
  var nextFn = webviewMgrRs.indexOf('pub fn ', start + 1);
  return webviewMgrRs.substring(start, nextFn === -1 ? webviewMgrRs.length : nextFn);
}

// Strip line comments (everything from `//` to end-of-line) so contract
// regexes match only ACTUAL code. The comments in webview_mgr.rs
// reference patterns we DON'T use ("hardcoded app.get_window("main"),
// which silently fails …") — without this filter the negative
// assertions match the comment text.
function codeOnly(text) {
  return text.split('\n').map(function (line) {
    var idx = line.indexOf('//');
    return idx === -1 ? line : line.substring(0, idx);
  }).join('\n');
}

var webviewMgrCode = codeOnly(webviewMgrRs);
function fnCode(name) { return codeOnly(fnSlice(name)); }

describe('webview_mgr.rs — lifecycle commands resolve webviews across all windows', () => {
  it('multiview_destroy looks up parent via app.webviews().get(label) (not hardcoded "main")', () => {
    var slice = fnCode('multiview_destroy');
    expect(slice).toMatch(/app\.webviews\(\)\.get\(&label\)/);
    expect(slice).not.toMatch(/app\.get_window\("main"\)/);
  });

  it('multiview_set_geometry resolves each webview via app.webviews() (not hardcoded "main")', () => {
    var slice = fnCode('multiview_set_geometry');
    expect(slice).toMatch(/app\.webviews\(\)/);
    expect(slice).not.toMatch(/app\.get_window\("main"\)/);
  });

  it('multiview_navigate resolves the webview via app.webviews().get(&label) (not hardcoded "main")', () => {
    var slice = fnCode('multiview_navigate');
    expect(slice).toMatch(/app\s*\.\s*webviews\(\)\s*\.\s*get\(&label\)/);
    expect(slice).not.toMatch(/app\.get_window\("main"\)/);
  });

  it('multiview_set_visible resolves the webview via app.webviews() (not hardcoded "main")', () => {
    var slice = fnCode('multiview_set_visible');
    expect(slice).toMatch(/app\.webviews\(\)/);
    expect(slice).not.toMatch(/app\.get_window\("main"\)/);
  });
});

describe('webview_mgr.rs — lifecycle events are window-scoped, not global', () => {
  it('does NOT use app.emit("focus-changed", …)', () => {
    expect(webviewMgrCode).not.toMatch(/app\.emit\(\s*"focus-changed"/);
  });

  it('does NOT use app.emit("multiview-destroyed", …)', () => {
    expect(webviewMgrCode).not.toMatch(/app\.emit\(\s*"multiview-destroyed"/);
  });

  it('does NOT use app.emit("health-changed", …)', () => {
    expect(webviewMgrCode).not.toMatch(/app\.emit\(\s*"health-changed"/);
  });

  it('keeps log-message global (intentionally cross-window — comment documents it)', () => {
    // log-message is the one event that should stay global so any
    // window's Log panel reflects activity from any webview.
    expect(webviewMgrRs).toMatch(/app\.emit\(\s*"log-message"/);
    expect(webviewMgrRs).toMatch(/intentionally cross-window/);
  });

  it('multiview_set_focused emits focus-changed via emit_to_window_of_label', () => {
    var slice = fnCode('multiview_set_focused');
    expect(slice).toMatch(/emit_to_window_of_label\([\s\S]{0,80}"focus-changed"/);
  });

  it('multiview_set_health emits health-changed via emit_to_window_of_label', () => {
    var slice = fnCode('multiview_set_health');
    expect(slice).toMatch(/emit_to_window_of_label\([\s\S]{0,80}"health-changed"/);
  });

  it('multiview_destroy emits multiview-destroyed via emit_to over the destroyed webview\'s window only', () => {
    var slice = fnCode('multiview_destroy');
    // After resolving parent_window, the destroy fn iterates the
    // siblings and emit_to's "multiview-destroyed" — same shape as
    // emit_to_window_of_label but inlined because we need the
    // captured parent_window from BEFORE close().
    expect(slice).toMatch(/parent_window\.is_some\(\)|if let Some\(window\) = parent_window/);
    expect(slice).toMatch(/emit_to\([\s\S]{0,80}"multiview-destroyed"/);
  });
});
