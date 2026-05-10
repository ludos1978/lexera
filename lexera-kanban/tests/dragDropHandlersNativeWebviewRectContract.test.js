// Latent ReferenceError fence — `getWebviewRectSafe` is NOT a defined
// symbol anywhere in the kanban codebase. The `toLocalFramePoint`
// function in dragDropHandlers.js called it for the
// `target.kind === 'native-webview'` branch, which would throw
// `ReferenceError: getWebviewRectSafe is not defined` whenever a
// cross-Tauri-webview hover routed through that path in the shell
// (LexeraMultiviewWebview-loaded) context.
//
// The Stage 17l typedef-gate trial-compile of dragDropHandlers.js
// surfaced the bug. Fix uses the actual public API:
// `LexeraMultiviewWebview.getWebviewRect(label)`, guarded by a
// presence check so embedded-kanban contexts (where the global
// is undefined) degrade to `null` instead of throwing.
//
// Source-level (regex) regression fence — would refuse to merge a
// future regression that re-introduces the bare identifier.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const dragDropHandlersSrc = readFileSync(
  resolve(repoRoot, 'src', 'dragdrop', 'dragDropHandlers.js'), 'utf8'
);

describe('dragDropHandlers — native-webview rect lookup', () => {
  it('does NOT reference the bare identifier getWebviewRectSafe (latent ReferenceError)', () => {
    expect(dragDropHandlersSrc).not.toMatch(/\bgetWebviewRectSafe\s*\(/);
  });

  it('uses LexeraMultiviewWebview.getWebviewRect for native-webview lookups', () => {
    // The fix routes through the actual public API on the
    // multiviewWebview module, guarded by a presence check.
    expect(dragDropHandlersSrc).toMatch(
      /target\.kind\s*===\s*['"]native-webview['"][\s\S]{0,500}LexeraMultiviewWebview/
    );
    expect(dragDropHandlersSrc).toMatch(
      /typeof\s+mv\.getWebviewRect\s*===\s*['"]function['"][\s\S]{0,200}mv\.getWebviewRect\(\s*target\.label\s*\)/
    );
  });

  it('degrades to null in embedded contexts where LexeraMultiviewWebview is undefined', () => {
    // Without this guard, embedded kanban would throw
    // `Cannot read properties of undefined (reading 'getWebviewRect')`.
    expect(dragDropHandlersSrc).toMatch(
      /window\.LexeraMultiviewWebview[\s\S]{0,200}typeof\s+mv\.getWebviewRect/
    );
  });
});
