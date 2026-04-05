import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const workspaceShellCss = readFileSync(
  resolve(__dirname, '..', 'src', 'workspace', 'workspaceShell.css'),
  'utf8'
);

describe('workspace shell overflow menu styles', () => {
  it('uses shared menu contrast tokens for the overflow menu surface and items', () => {
    expect(workspaceShellCss).toContain('border: 1px solid var(--menu-border, var(--border));');
    expect(workspaceShellCss).toContain('background: var(--menu-bg, var(--bg-secondary));');
    expect(workspaceShellCss).toContain('color: var(--menu-item-fg, var(--text-primary));');
    expect(workspaceShellCss).toContain('background: var(--menu-item-bg-hover, var(--bg-hover));');
    expect(workspaceShellCss).toContain('color: var(--menu-item-fg-hover, var(--text-bright));');
  });

  it('keeps overflow-menu close controls readable against the menu palette', () => {
    expect(workspaceShellCss).toContain('opacity: 0.78;');
    expect(workspaceShellCss).toContain('color: var(--menu-item-fg-hover, var(--text-bright));');
  });
});
