// Marp watch state per-window scope — source-level contract.
//
// `MarpWatchState.pids` was `HashMap<input_path, u32>`. If two
// windows watched the same file, the second `insert()` overwrote
// the first's PID; the first window's process was orphaned forever
// when the second called marp_stop_watch. Compose-key the map by
// `(window_label, input_path)` so each window owns its own slot.
//
// All three commands (marp_watch / marp_stop_watch /
// marp_stop_all_watches) take a caller and key on its window. On
// window close, MarpWatchState::stop_window kills any processes the
// closing window owned.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const exportRs = readFileSync(
  resolve(__dirname, '..', 'src-tauri', 'src', 'export_commands.rs'),
  'utf8'
);
const mainRs = readFileSync(
  resolve(__dirname, '..', 'src-tauri', 'src', 'main.rs'),
  'utf8'
);

function fnSlice(name) {
  var start = exportRs.indexOf('pub async fn ' + name);
  if (start === -1) start = exportRs.indexOf('pub fn ' + name);
  if (start === -1) throw new Error('function not found: ' + name);
  // Walk forward to the next `pub fn ` / `pub async fn ` / `impl `.
  var nextFn = -1;
  ['pub async fn ', 'pub fn ', 'impl '].forEach(function (kw) {
    var idx = exportRs.indexOf(kw, start + 1);
    if (idx !== -1 && (nextFn === -1 || idx < nextFn)) nextFn = idx;
  });
  return exportRs.substring(start, nextFn === -1 ? exportRs.length : nextFn);
}

function codeOnly(text) {
  return text.split('\n').map(function (line) {
    var idx = line.indexOf('//');
    return idx === -1 ? line : line.substring(0, idx);
  }).join('\n');
}

describe('export_commands.rs — MarpWatchState is per-window', () => {
  it('pids HashMap is keyed by (window_label, input_path) — not by path alone', () => {
    expect(exportRs).toMatch(/pids:\s*Mutex<HashMap<\(String,\s*String\),\s*u32>>/);
    expect(exportRs).not.toMatch(/pids:\s*Mutex<HashMap<String,\s*u32>>/);
  });

  it('marp_watch takes caller and inserts using (window_label, input_path)', () => {
    var slice = codeOnly(fnSlice('marp_watch'));
    expect(slice).toMatch(/caller:\s*tauri::Webview/);
    expect(slice).toMatch(/caller\.window\(\)\.label\(\)/);
    expect(slice).toMatch(/pids\.insert\(\(window_label/);
  });

  it('marp_stop_watch is window-scoped — verifies the PID belongs to the calling window before killing', () => {
    var slice = codeOnly(fnSlice('marp_stop_watch'));
    expect(slice).toMatch(/caller:\s*tauri::Webview/);
    expect(slice).toMatch(/caller\.window\(\)\.label\(\)/);
    // Lookup by composite key when watch_path is given.
    expect(slice).toMatch(/pids\.get\(&\(window_label/);
    // PID-only path filters by window to prevent cross-window kills.
    expect(slice).toMatch(/wl == &window_label/);
  });

  it('marp_stop_all_watches stops only the calling window\'s processes', () => {
    var slice = codeOnly(fnSlice('marp_stop_all_watches'));
    expect(slice).toMatch(/caller:\s*tauri::Webview/);
    expect(slice).toMatch(/caller\.window\(\)\.label\(\)/);
    // Filter the iter by window before collecting PIDs.
    expect(slice).toMatch(/filter\(\|\(\(wl,\s*_\),\s*_\)\|\s*wl == &window_label\)/);
    // Retain non-matching entries when clearing.
    expect(slice).toMatch(/retain\(\|\(wl,\s*_\),\s*_\|\s*wl != &window_label\)/);
  });

  it('MarpWatchState exposes stop_window so window-close cleanup can kill orphans', () => {
    expect(exportRs).toMatch(/impl MarpWatchState[\s\S]{0,800}fn stop_window/);
  });

  it('main.rs CloseRequested invokes MarpWatchState::stop_window on the closing window', () => {
    expect(mainRs).toMatch(/CloseRequested[\s\S]{0,4500}MarpWatchState[\s\S]{0,200}stop_window\(&closing_label\)/);
  });
});
