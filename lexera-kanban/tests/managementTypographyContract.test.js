import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const managementCss = readFileSync(resolve(__dirname, '..', '..', 'lexera-shared', 'management.css'), 'utf8');

describe('management typography contract', () => {
  it('defines a single management font-size token', () => {
    expect(managementCss).toContain('--mgmt-font-size: var(--font-size-base, 13px);');
    expect(managementCss).toContain('--font-color-unified: var(--font-color-mode, #000000);');
    expect(managementCss).toContain('--app-control-font-size: var(--mgmt-font-size);');
    expect(managementCss).toContain('--hierarchy-font-size: var(--font-size-base, 13px);');
    expect(managementCss).toContain('--hierarchy-font-weight: 400;');
    // Text tokens use distinct opacities via color-mix for visual hierarchy
    // --text-bright removed — --text-primary is now the brightest text token
    expect(managementCss).toContain('--text-primary: var(--font-color-unified);');
    // --text-secondary removed — only --text-primary and --text-muted remain
    expect(managementCss).toMatch(/--text-muted:\s*color-mix/);
  });

  it('uses only one text font size across the management stylesheet', () => {
    const fontSizes = managementCss
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('font-size:'))
      .map((line) => line.replace(/^font-size:\s*/, '').replace(/;$/, '').trim());
    expect(Array.from(new Set(fontSizes)).sort()).toEqual(['0', 'var(--mgmt-font-size)']);
  });

  it('keeps management hierarchy selection and hover background-free', () => {
    expect(managementCss).toMatch(/\.mgmt-config-tree \.tree-node\.selected,\s*\.mgmt-config-tree \.mgmt-config-tree-node\.selected\s*\{[\s\S]*background:\s*var\(--hierarchy-active-bg, transparent\)[\s\S]*box-shadow:\s*inset 2px 0 0 var\(--hierarchy-active-accent/);
    expect(managementCss).toMatch(/\.mgmt-config-tree-node:hover\s*\{[\s\S]*background:\s*var\(--hierarchy-hover-bg, transparent\)/);
  });

  it('uses the shared transparent burger-menu style in the files tree', () => {
    expect(managementCss).toMatch(/\.mgmt-config-tree \.tree-menu-btn,\s*\.mgmt-config-tree \.burger-menu-btn\s*\{[\s\S]*background:\s*var\(--app-menu-bg, transparent\)[\s\S]*color:\s*var\(--app-menu-fg/);
    expect(managementCss).toMatch(/\.mgmt-config-tree \.tree-node:hover \.tree-menu-btn,[\s\S]*\.mgmt-config-tree \.burger-menu-btn:focus-visible\s*\{[\s\S]*opacity:\s*1/);
  });
});
