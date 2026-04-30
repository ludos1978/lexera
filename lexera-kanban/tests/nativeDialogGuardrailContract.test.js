// Native browser dialog ban guardrail.
//
// User rule (memory: feedback_no_native_browser_popups):
//   "Native browser popups are forbidden — use showNotification /
//   LexeraDialogs.confirm / LexeraDialogs.prompt, never
//   window.alert/confirm/prompt."
//
// Native popups don't render in Tauri WKWebView the same way they do
// in browsers (they steal focus, can fall behind workspace windows,
// or silently no-op during drag cycles). Lexera ships in-app Dialog
// primitives that handle layering correctly.
//
// Walks every authored .js file in lexera-kanban/src and fails on any
// `window.alert(`, `window.confirm(`, or `window.prompt(` occurrence.
// Bundled vendor JS and the synced lexera-shared assets are skipped.
//
// Allowlist accepts an exact line range — narrower than file-level so
// a future regression in the same file still trips the gate.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcRoot = resolve(__dirname, '..', 'src');

// Built-and-bundled vendor JS — not authored here.
const SKIP_FILES = new Set([
  'wysiwyg-editor.js',
  'management.js',
  'themes.js',
  'backendDiscovery.js',
  'dialogs.js'
]);

// Allowlist: filename → set of permitted line numbers. Each entry is a
// known fallback after LexeraDialogs is unavailable. New native popup
// usage must NOT be added here lightly.
const ALLOW_LINES = new Map([
  // settingsRuntime.confirm() falls back to window.confirm only after
  // both showNotification(confirm:true) AND LexeraDialogs.confirm have
  // been tried and thrown. Removing this would break management-UI
  // confirms when both upper layers are missing (eg detached webview).
  ['views/_shared/settingsRuntime.js', new Set([251])]
]);

function walkJs(dir, out, srcRootArg) {
  for (const name of readdirSync(dir)) {
    if (name === 'vendor' || name === 'node_modules') continue;
    const full = join(dir, name);
    let s;
    try { s = statSync(full); } catch (_) { continue; }
    if (s.isDirectory()) walkJs(full, out, srcRootArg);
    else if (s.isFile() && full.endsWith('.js')) {
      const rel = relative(srcRootArg, full);
      if (SKIP_FILES.has(rel)) continue;
      out.push(full);
    }
  }
  return out;
}

const RE = /\bwindow\.(alert|confirm|prompt)\s*\(/;

function findOffenders(absPath, srcRootArg) {
  const rel = relative(srcRootArg, absPath);
  const allow = ALLOW_LINES.get(rel) || new Set();
  const lines = readFileSync(absPath, 'utf8').split('\n');
  const offenders = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Skip line comments + block-comment-only lines.
    if (/^\s*(\/\/|\*)/.test(line)) continue;
    if (!RE.test(line)) continue;
    const lineNo = i + 1;
    if (allow.has(lineNo)) continue;
    offenders.push(`${rel}:${lineNo}`);
  }
  return offenders;
}

describe('native dialog ban contract', () => {
  it('no authored JS calls window.alert / window.confirm / window.prompt', () => {
    const all = [];
    for (const file of walkJs(srcRoot, [], srcRoot)) {
      all.push(...findOffenders(file, srcRoot));
    }
    expect(
      all,
      'Native browser popups are forbidden in Tauri (focus stealing, layering bugs). Use showNotification / LexeraDialogs.confirm / LexeraDialogs.prompt instead. If a fallback is genuinely needed (eg dialogs/notifications themselves unavailable), add the file:line to ALLOW_LINES with a comment explaining the fallback path.'
    ).toEqual([]);
  });
});
