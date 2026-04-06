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
