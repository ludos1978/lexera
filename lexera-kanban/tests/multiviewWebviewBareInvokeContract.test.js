// Pins the regression behind commit 60cf3203:
//
//   ReferenceError: Can't find variable: invoke
//     setup (multiviewWebview.js:1155)
//     workspaceShell.js:1778 / 4743
//
// The shell-boot path called `invoke('multiview_subscribe', …)` as a bare
// identifier — but multiviewWebview.js has no local `invoke` binding, so
// every shell boot threw the ReferenceError above and the multiview /
// log subscriptions never ran. The fix routes through the canonical
// `window.__TAURI__.core.invoke(…)` (with the existing guard pattern,
// see multiviewWebview.js:107) that the rest of the file uses.
//
// This contract scans the source and refuses any bare `invoke(` call
// (i.e. an unprefixed identifier-call). Future changes can still call
// Tauri commands — they just have to use `window.__TAURI__.core.invoke`,
// or define a local `invoke` first (the file currently doesn't, and we
// don't add one to keep the safe-guard pattern explicit at every call
// site).

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sourcePath = resolve(__dirname, '..', 'src', 'workspace', 'multiviewWebview.js');

function stripCommentsAndStrings(src) {
  // Drop // line comments, /* block comments */, and string literals so
  // an `invoke(` mention in a comment or string can't trip the contract.
  // This is approximate but sufficient for catching the actual bug class
  // (executable bare identifier-call).
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:\\])\/\/[^\n]*/g, '$1')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/`(?:\\.|[^`\\])*`/g, '``');
}

describe('multiviewWebview.js bare-invoke contract', () => {
  it('contains no bare `invoke(` calls — every Tauri call must go through window.__TAURI__.core.invoke', () => {
    const raw = readFileSync(sourcePath, 'utf8');
    const stripped = stripCommentsAndStrings(raw);

    // Match `invoke(` only when NOT preceded by an identifier character
    // or a `.` (so `window.__TAURI__.core.invoke(`, `LexeraMultiview.invoke(`,
    // `tauriInvoke(`, `invokeOrReject(`, `checkInvoke(`, etc. all pass).
    const bareInvokeRe = /(^|[^A-Za-z0-9_$.])invoke\s*\(/g;
    const offenders = [];
    const lines = stripped.split('\n');
    lines.forEach((line, idx) => {
      if (bareInvokeRe.test(line)) {
        offenders.push({ line: idx + 1, text: line.trim() });
      }
      bareInvokeRe.lastIndex = 0;
    });

    if (offenders.length > 0) {
      const list = offenders.map((o) => `  L${o.line}: ${o.text}`).join('\n');
      throw new Error(
        'multiviewWebview.js contains bare `invoke(` call(s). This file ' +
        'has no local `invoke` binding, so a bare call throws ReferenceError ' +
        'on every shell boot. Use `window.__TAURI__.core.invoke(…)` with ' +
        'the existing guard (see line 107) instead.\n' + list
      );
    }
    expect(offenders).toEqual([]);
  });
});
