// Modal result routing — source-level contract.
//
// Earlier shape: `confirmModal` / `promptModal` generated labels via
// a per-webview `modalCounter` (`confirm-modal-1`, …) — not globally
// unique. Two windows confirming at the same time would either
// collide on Tauri's window-label registry or, if both registered
// listeners for the same label, both fire on the modal's global
// `t.event.emit('modal-result-…')` because Tauri 2's emit-side has
// no per-target filter.
//
// Fix: modal labels now embed the parent webview's label, and the
// modal HTML routes its result via `multiview_emit_to(parentLabel,
// …)` so it reaches ONLY the webview that opened it.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const multiviewClientJs = readFileSync(
  resolve(__dirname, '..', 'src', 'shell', 'multiviewClient.js'),
  'utf8'
);
const confirmHtml = readFileSync(
  resolve(__dirname, '..', 'src', 'views', 'modals', 'confirm.html'),
  'utf8'
);
const promptHtml = readFileSync(
  resolve(__dirname, '..', 'src', 'views', 'modals', 'prompt.html'),
  'utf8'
);

describe('multiviewClient confirmModal / promptModal — labels embed parent webview', () => {
  it('confirmModal label includes parentLabel so two windows do not collide', () => {
    expect(multiviewClientJs).toMatch(
      /var label = 'confirm-modal-' \+ parentLabel \+ '-' \+ \(\+\+modalCounter\)/
    );
  });

  it('promptModal label includes parentLabel so two windows do not collide', () => {
    expect(multiviewClientJs).toMatch(
      /var label = 'prompt-modal-' \+ parentLabel \+ '-' \+ \(\+\+modalCounter\)/
    );
  });

  it('confirmModal forwards parentLabel to the modal via URL params', () => {
    // The confirm-modal block must set `parentLabel` on the params
    // it serialises into the modal URL.
    var fnStart = multiviewClientJs.indexOf('function confirmModal');
    var fnEnd = multiviewClientJs.indexOf('function promptModal', fnStart + 1);
    var slice = multiviewClientJs.substring(fnStart, fnEnd);
    expect(slice).toMatch(/params\.set\('parentLabel', parentLabel\)/);
  });

  it('promptModal forwards parentLabel to the modal via URL params', () => {
    var fnStart = multiviewClientJs.indexOf('function promptModal');
    var fnEnd = multiviewClientJs.indexOf('function ', fnStart + 'function promptModal'.length);
    var slice = multiviewClientJs.substring(fnStart, fnEnd === -1 ? fnStart + 4000 : fnEnd);
    expect(slice).toMatch(/params\.set\('parentLabel', parentLabel\)/);
  });
});

describe('modal HTML emits via multiview_emit_to(parentLabel, …) when parentLabel is set', () => {
  it('confirm.html routes result through multiview_emit_to', () => {
    expect(confirmHtml).toMatch(/parentLabel = params\.get\('parentLabel'\)/);
    expect(confirmHtml).toMatch(
      /t\.core\.invoke\('multiview_emit_to',\s*\{\s*target:\s*parentLabel,\s*event:\s*'modal-result-'\s*\+\s*label/
    );
  });

  it('prompt.html routes result through multiview_emit_to', () => {
    expect(promptHtml).toMatch(/parentLabel = params\.get\('parentLabel'\)/);
    expect(promptHtml).toMatch(
      /t\.core\.invoke\('multiview_emit_to',\s*\{\s*target:\s*parentLabel,\s*event:\s*'modal-result-'\s*\+\s*label/
    );
  });

  it('falls back to the legacy global emit only when parentLabel is missing', () => {
    // Both modals should keep the `t.event.emit` path as a fallback
    // (defensive) but ONLY in the `else` branch — the primary path
    // must be multiview_emit_to.
    var confirmEmit = confirmHtml.match(
      /if \(parentLabel[\s\S]+?\} else if \(t && t\.event && typeof t\.event\.emit === 'function'\) \{[\s\S]+?t\.event\.emit\('modal-result-'/
    );
    expect(confirmEmit).not.toBeNull();
    var promptEmit = promptHtml.match(
      /if \(parentLabel[\s\S]+?\} else if \(t && t\.event && typeof t\.event\.emit === 'function'\) \{[\s\S]+?t\.event\.emit\('modal-result-'/
    );
    expect(promptEmit).not.toBeNull();
  });
});
