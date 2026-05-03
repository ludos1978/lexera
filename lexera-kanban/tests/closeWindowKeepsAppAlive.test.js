// Closing a window closes the view, NOT the application.
//
// User contract: clicking the red X on any window — including the
// last open one — must close that view but keep the app process
// alive (re-openable via the macOS menu bar or system tray /
// dock). Only an explicit Cmd+Q / File > Quit (`quit_app`) actually
// terminates the process.
//
// Earlier shape: the `main` window was special-cased to
// `prevent_close + minimize` — clicking close would silently
// minimize instead of closing. And closing the last secondary
// window let Tauri's default behavior exit the process. Both were
// wrong relative to the user's request.
//
// Fix: every window closes normally, and `RunEvent::ExitRequested`
// is gated by a `USER_REQUESTED_QUIT` atomic flag that only
// `quit_app` sets.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const mainRs = readFileSync(
  resolve(__dirname, '..', 'src-tauri', 'src', 'main.rs'),
  'utf8'
);
const commandsRs = readFileSync(
  resolve(__dirname, '..', 'src-tauri', 'src', 'commands.rs'),
  'utf8'
);

function codeOnly(text) {
  return text.split('\n').map(function (line) {
    var i = line.indexOf('//');
    return i === -1 ? line : line.substring(0, i);
  }).join('\n');
}

const mainCode = codeOnly(mainRs);
const commandsCode = codeOnly(commandsRs);

describe('main.rs: closing windows does not exit the app', () => {
  it('every window closes normally — no `prevent_close` / `window.minimize()` for any specific label', () => {
    // The previous shape was:
    //   if closing_label == "main" {
    //       api.prevent_close();
    //       window.minimize();
    //   }
    // Both lines (and the special-case branch) must be gone.
    expect(mainCode).not.toMatch(/closing_label\s*==\s*"main"/);
    expect(mainCode).not.toMatch(/api\.prevent_close\(\)/);
    expect(mainCode).not.toMatch(/window\.minimize\(\)/);
  });

  it('declares USER_REQUESTED_QUIT atomic flag (default false)', () => {
    expect(mainCode).toMatch(
      /USER_REQUESTED_QUIT:\s*std::sync::atomic::AtomicBool\s*=\s*std::sync::atomic::AtomicBool::new\(false\)/
    );
  });

  it('the run loop intercepts `ExitRequested` and prevents exit unless USER_REQUESTED_QUIT is set (macOS only)', () => {
    // The flow on macOS:
    //   .build(ctx)?.run(|app, event| {
    //       #[cfg(target_os = "macos")]
    //       if let RunEvent::ExitRequested { api, .. } = event {
    //           if !USER_REQUESTED_QUIT.load(...) { api.prevent_exit(); }
    //       }
    //   });
    expect(mainCode).toMatch(/\.build\(tauri::generate_context!\(\)\)/);
    expect(mainCode).toMatch(/RunEvent::ExitRequested/);
    expect(mainCode).toMatch(/USER_REQUESTED_QUIT\.load/);
    expect(mainCode).toMatch(/api\.prevent_exit\(\)/);
  });

  it('keep-alive is gated by `cfg(target_os = "macos")` — Windows/Linux exit normally so a no-window app is not silently invisible', () => {
    // The whole `if let RunEvent::ExitRequested` block must be
    // wrapped in `#[cfg(target_os = "macos")]`. The match was made
    // because the macOS menu bar persists without a window
    // (re-openable via File > New Window); on Windows/Linux there
    // is currently no system tray, so a no-window app would be
    // invisible.
    expect(mainRs).toMatch(
      /#\[cfg\(target_os\s*=\s*"macos"\)\][\s\S]{0,200}RunEvent::ExitRequested/
    );
  });

  it('does NOT use the legacy `.run(generate_context!())` form (which always exits on last-window close)', () => {
    // The build()?.run(|app, event|) form is the only way to
    // intercept ExitRequested. The legacy chain `.run(ctx)`
    // collapses everything and exits unconditionally.
    expect(mainCode).not.toMatch(/^\s*\.run\(tauri::generate_context!\(\)\)/m);
  });
});

describe('commands.rs: quit_app sets the flag before app.exit', () => {
  it('quit_app sets USER_REQUESTED_QUIT to true before invoking app.exit(0)', () => {
    var fnStart = commandsCode.indexOf('pub fn quit_app');
    var fnEnd = commandsCode.indexOf('\n}\n', fnStart);
    var fn = commandsCode.substring(fnStart, fnEnd);
    expect(fn).toMatch(/USER_REQUESTED_QUIT\.store\(true/);
    expect(fn).toMatch(/app\.exit\(0\)/);
    // Order matters: the flag must be set BEFORE app.exit.
    var storeIdx = fn.indexOf('USER_REQUESTED_QUIT.store');
    var exitIdx = fn.indexOf('app.exit');
    expect(storeIdx).toBeLessThan(exitIdx);
  });
});
