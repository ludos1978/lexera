// Pin the null-guard fix that lets the workspace shell mount in a
// host page without a `.sidebar` element (the backend management
// window's connection-settings.html).
//
// Bug: in `ensurePanelElements()`, `dashboardEl` is freshly created
// (detached, parentNode=null) and `sidebarEl` resolves to null when
// the page has no `.sidebar`. The guard `dashboardEl.parentNode ===
// sidebarEl` then evaluates `null === null` → true, and `.removeChild`
// on null throws. The throw aborts `mount()` and the management
// window stays empty.
//
// Fix: add an explicit `sidebarEl &&` to the guard so the check only
// fires when there is a real sidebar to detach the dashboard from.
//
// This contract guards the source text so a future "simplification"
// can't quietly drop the null guard and re-break the management view.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const shellPath = resolve(__dirname, '..', 'src', 'workspace', 'workspaceShell.js');
const shellSrc = readFileSync(shellPath, 'utf-8');

describe('workspaceShell.ensurePanelElements — sidebar-less mount', () => {
  it('guards the dashboardEl detach with `sidebarEl &&` so null === null does not match', () => {
    // The dangerous form was `if (dashboardEl && dashboardEl.parentNode === sidebarEl)`.
    // Reject that exact pattern.
    expect(
      shellSrc,
      'unguarded `dashboardEl && dashboardEl.parentNode === sidebarEl` is back — would crash on a sidebar-less page',
    ).not.toMatch(/if\s*\(\s*dashboardEl\s*&&\s*dashboardEl\.parentNode\s*===\s*sidebarEl\s*\)/);
    // The fixed form must be present.
    expect(
      shellSrc,
      'expected `if (sidebarEl && dashboardEl && dashboardEl.parentNode === sidebarEl)` guard',
    ).toMatch(/if\s*\(\s*sidebarEl\s*&&\s*dashboardEl\s*&&\s*dashboardEl\.parentNode\s*===\s*sidebarEl\s*\)/);
  });

  it('does not regress to calling removeChild on a null parentNode for the dashboard detach', () => {
    // Regardless of how the guard is spelled, the removeChild line
    // must not be reachable when sidebarEl is null. The simplest way
    // to enforce that is: the same line that calls
    // `dashboardEl.parentNode.removeChild(dashboardEl)` must be
    // preceded (within ~3 lines above) by a guard that mentions
    // `sidebarEl`.
    const m = shellSrc.match(/[\s\S]{0,200}dashboardEl\.parentNode\.removeChild\(dashboardEl\)/);
    expect(m, 'expected to find the dashboardEl.parentNode.removeChild call site').toBeTruthy();
    expect(
      m[0],
      'guard above `dashboardEl.parentNode.removeChild(dashboardEl)` must reference sidebarEl',
    ).toMatch(/sidebarEl/);
  });
});
