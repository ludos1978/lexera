import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const appCss = readFileSync(resolve(__dirname, '..', 'src', 'app.css'), 'utf8');
const treeViewSource = readFileSync(resolve(__dirname, '..', 'src', 'treeView.js'), 'utf8');
const indexHtml = readFileSync(resolve(__dirname, '..', 'src', 'index.html'), 'utf8');
const sharedPanels = readFileSync(resolve(__dirname, '..', 'src', 'workspace', 'sharedPanels.js'), 'utf8');
const orderHelpersSource = readFileSync(resolve(__dirname, '..', 'src', 'board', 'orderHelpers.js'), 'utf8');

describe('hierarchy style contract', () => {
  it('keeps dashboard section children visibly owned by their section header', () => {
    expect(appCss).toMatch(/\.dashboard-group\s*\{[\s\S]*--dashboard-group-child-indent:\s*var\(--tree-indent-step\)/);
    expect(appCss).toMatch(/\.dashboard-group\s*>\s*\.dashboard-list\[data-hierarchy-section-body="true"\]\s*\{[\s\S]*position:\s*relative[\s\S]*padding-left:\s*var\(--dashboard-group-child-indent\)/);
    expect(appCss).toContain('.dashboard-group > .dashboard-list[data-hierarchy-section-body="true"]::before');
    expect(appCss).toContain('.dashboard-group > .dashboard-list[data-hierarchy-section-body="true"] > .tree-entry > .tree-node[data-tree-root="true"]::before');
    expect(indexHtml).toContain('data-hierarchy-section-body="true"');
    expect(indexHtml).toContain('data-dashboard-group-key=');
    expect(indexHtml).toContain('data-tree-structural-role="section"');
    expect(sharedPanels).toContain('data-hierarchy-section-body="true"');
    expect(sharedPanels).toContain('data-dashboard-group-key=');
    expect(sharedPanels).toContain('data-tree-structural-role="section"');
    expect(orderHelpersSource).toContain("getAttribute('data-dashboard-group-key')");
  });

  it('shares the top-level fold affordance between dashboard and workspace headers', () => {
    expect(appCss).toMatch(/\.dashboard-group-toggle,\s*\.workspace-section-toggle/);
    expect(appCss).toMatch(/\.dashboard-group-header,\s*\.workspace-section-header/);
  });

  it('uses one quiet typography and accent-line state model across hierarchy surfaces', () => {
    expect(appCss).toContain('--app-shell-font-size: var(--font-size-base);');
    expect(appCss).toContain('--font-color-unified: var(--font-color-mode, #000000);');
    expect(appCss).toContain('--app-shell-font-color: var(--font-color-unified);');
    expect(appCss).toContain('--app-control-font-size: var(--font-size-base);');
    expect(appCss).toContain('--app-control-font-weight: 400;');
    expect(appCss).toContain('--app-font-color: var(--app-shell-font-color);');
    expect(appCss).toContain('--app-font-muted-color: var(--app-shell-font-color);');
    expect(appCss).toContain('--hierarchy-font-size: var(--app-control-font-size);');
    expect(appCss).toContain('--hierarchy-font-weight: var(--app-control-font-weight);');
    expect(appCss).toContain('--hierarchy-hover-bg: transparent;');
    expect(appCss).toContain('--hierarchy-active-bg: transparent;');
    // Font-size tokens (xs, sm, md) are NOT overridden per container — they retain
    // their distinct values from tokens.css and body inherits --font-size-base.
    expect(appCss).toMatch(/:where\([\s\S]*\.sidebar,[\s\S]*\.calendar-panel,[\s\S]*\.mgmt-panel,[\s\S]*\.log-panel[\s\S]*\)\s*\{[\s\S]*--text-primary:\s*var\(--app-shell-font-color\)[\s\S]*--text-secondary:\s*var\(--app-shell-font-color\)/);
    // Containers set font-size; children inherit it
    expect(appCss).toMatch(/\.board-list\s*\{[\s\S]*font-size:\s*var\(--hierarchy-font-size\)/);
    expect(appCss).toMatch(/\.sidebar-dashboard-body\s*\{[\s\S]*font-size:\s*var\(--hierarchy-font-size\)/);
    expect(appCss).toMatch(/\.sidebar-dashboard-controls\s*\{[\s\S]*font-size:\s*var\(--hierarchy-font-size\)/);
    expect(appCss).toMatch(/\.tree-node\s*\{[\s\S]*font-weight:\s*var\(--hierarchy-font-weight\)/);
    expect(appCss).toMatch(/\.dashboard-group-header,\s*\.workspace-section-header\s*\{[\s\S]*font-weight:\s*var\(--hierarchy-font-weight\)/);
    expect(appCss).toMatch(/\.dashboard-item\s*\{[\s\S]*font-weight:\s*var\(--hierarchy-font-weight\)/);
    expect(appCss).toMatch(/\.tree-node:hover\s*\{[\s\S]*background:\s*var\(--hierarchy-hover-bg\)/);
    expect(appCss).toMatch(/\.dashboard-item\.pinned-active\s*\{[\s\S]*background:\s*var\(--hierarchy-active-bg\)[\s\S]*box-shadow:\s*inset 2px 0 0 var\(--hierarchy-active-accent\)/);
    expect(appCss).toMatch(/\.board-item\.active\s*\{[\s\S]*background:\s*var\(--hierarchy-active-bg\)[\s\S]*box-shadow:\s*inset 2px 0 0 var\(--hierarchy-active-accent\)/);
  });

  it('keeps burger menu buttons on one shared transparent menu-button style', () => {
    expect(appCss).toContain('.tree-menu-btn,');
    expect(appCss).toContain('.wiki-menu-btn,');
    expect(appCss).toMatch(/\.column-menu-btn,[\s\S]*\.burger-menu-btn\s*\{[\s\S]*border-color:\s*var\(--app-menu-border\)[\s\S]*background:\s*var\(--app-menu-bg\)[\s\S]*color:\s*var\(--app-menu-fg\)/);
    expect(appCss).toMatch(/\.column-menu-btn:hover,[\s\S]*\.burger-menu-btn:focus-visible\s*\{[\s\S]*border-color:\s*var\(--app-menu-border-hover\)[\s\S]*background:\s*var\(--app-menu-bg-hover\)[\s\S]*color:\s*var\(--app-menu-fg-hover\)/);
    expect(appCss).toMatch(/\.board-action-btn\s*\{[\s\S]*font-size:\s*var\(--app-control-font-size\)[\s\S]*font-weight:\s*var\(--app-control-font-weight\)/);
    expect(appCss).toMatch(/\.sidebar-btn\s*\{[\s\S]*font-size:\s*var\(--app-control-font-size\)[\s\S]*font-weight:\s*var\(--app-control-font-weight\)/);
  });

  it('keeps compact root flattening without flattening child depth', () => {
    expect(treeViewSource).toContain("var compactRootFlatten = options && options.variant === 'compact' && level === 1;");
    expect(treeViewSource).toContain("var childIndent = compactRootFlatten ? [] : parentLastFlags.concat([isLast]);");
    expect(treeViewSource).toContain("entry.setAttribute('data-tree-node-role', nodeRole);");
    expect(treeViewSource).toContain("el.setAttribute('data-tree-node-role', nodeRole);");
    expect(treeViewSource).toContain("entry.setAttribute('data-tree-structural-role', structuralRole);");
    expect(treeViewSource).toContain("el.setAttribute('data-tree-structural-role', structuralRole);");
    expect(appCss).toContain('.tree-view-compact .tree-node[data-tree-root="true"] > .tree-indent');
  });

  it('styles hierarchy groups and items from structural roles instead of per-surface type lists', () => {
    expect(appCss).toContain('.tree-node[data-tree-structural-role="group"] > .tree-label');
    expect(appCss).toContain('.tree-node[data-tree-structural-role="item"] > .tree-label');
  });
});
