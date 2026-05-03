// Tauri capability window-allowlist guardrail (Gap #7 — IPC-Migration-Plan.md).
//
// The default capability used to grant `core:default` + `core:event:allow-listen`
// to all windows via `"windows": ["*"]`. The audit replaces the wildcard with
// an explicit per-label allowlist. This test pins that decision so a future
// edit cannot silently re-introduce the wildcard.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const capPath = resolve(__dirname, '..', 'src-tauri', 'capabilities', 'default.json');

describe('lexera-kanban default capability', () => {
  const cap = JSON.parse(readFileSync(capPath, 'utf-8'));

  it('does not grant permissions to all windows via wildcard', () => {
    expect(Array.isArray(cap.windows)).toBe(true);
    expect(cap.windows).not.toContain('*');
  });

  it('lists each known window-label family explicitly', () => {
    // Inventory derived from main.rs (top-level OS windows), drag_coordinator.rs
    // (drag-ghost), and webview spawn call sites (board-tab-* / panel-tab-*).
    // Adjust this list when a new window family is introduced — the explicit
    // list is the contract.
    const expected = ['main', 'kanban-*', 'drag-ghost', 'board-tab-*', 'panel-tab-*'];
    for (const label of expected) {
      expect(cap.windows).toContain(label);
    }
  });

  it('does not regress the documented permissions', () => {
    expect(cap.permissions).toContain('core:default');
    expect(cap.permissions).toContain('core:event:allow-listen');
  });
});
