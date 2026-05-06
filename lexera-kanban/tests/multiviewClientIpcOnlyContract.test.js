// Pin: lexera-kanban/src/shell/multiviewClient.js MUST drive every
// shell ⇄ Rust call through the Tauri IPC plugin
// (`window.__TAURI__.core.invoke` / `getCurrentWebview().listen`).
//
// Background: earlier prototypes of the multiview shell used HTTP /
// WebSocket fallbacks against the backend dev server when Tauri IPC
// wasn't available. After the lexera-local-ipc migration those
// fallbacks were deleted, but nothing pinned the file against re-
// introducing them. A future "well, the IPC isn't ready, let's just
// fetch() the URL" patch would silently bypass the in-process IPC
// plugin and break the multi-window guarantees that webview lifecycle
// depends on.
//
// This test fences the file: no `fetch(`, no `XMLHttpRequest`, no
// `axios`, no `.ajax`, no hard-coded `http://` / `https://` URL
// pointing at the backend or kanban dev server. The only network-
// adjacent symbols allowed are the Tauri IPC primitives.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const multiviewClientJs = readFileSync(
  resolve(__dirname, '..', 'src', 'shell', 'multiviewClient.js'),
  'utf8'
);

describe('multiviewClient.js — Tauri IPC is the only transport', () => {
  it('does not use fetch() for shell ⇄ Rust calls', () => {
    // `fetch(` (whitespace tolerated) is the canonical browser HTTP
    // entry point. If a regression adds `await fetch('/some-cmd')`
    // anywhere in this file, this assertion catches it.
    expect(multiviewClientJs).not.toMatch(/\bfetch\s*\(/);
  });

  it('does not use XMLHttpRequest', () => {
    expect(multiviewClientJs).not.toMatch(/\bXMLHttpRequest\b/);
  });

  it('does not import or invoke axios / jQuery $.ajax', () => {
    expect(multiviewClientJs).not.toMatch(/\baxios\b/);
    expect(multiviewClientJs).not.toMatch(/\$\.ajax\s*\(/);
  });

  it('contains no hard-coded http:// or https:// URLs (backend host should be discovered, not embedded)', () => {
    expect(multiviewClientJs).not.toMatch(/['"`]https?:\/\/[^'"`]+['"`]/);
  });

  it('exposes the Tauri IPC `invoke()` wrapper as the shell ⇄ Rust call site', () => {
    // Sanity: this contract is meaningful only because every command
    // goes through `invoke()`. Kept loose so internal helper renames
    // don't break the test — just check that the wrapper exists and
    // both `__TAURI__` (gateway global) and `core.invoke` (the actual
    // IPC entry point) are referenced somewhere in the file.
    expect(multiviewClientJs).toMatch(/function\s+invoke\s*\(/);
    expect(multiviewClientJs).toMatch(/__TAURI__/);
    expect(multiviewClientJs).toMatch(/\.core\.invoke\b/);
  });
});
