import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const appCss = readFileSync(resolve(__dirname, '..', 'src', 'app.css'), 'utf8');
const treeViewSource = readFileSync(resolve(__dirname, '..', 'src', 'treeView.js'), 'utf8');
const indexHtml = readFileSync(resolve(__dirname, '..', 'src', 'index.html'), 'utf8');
const frontendSettingsHtml = readFileSync(resolve(__dirname, '..', 'src', 'views', 'frontendSettings', 'index.html'), 'utf8');
const sharedPanels = readFileSync(resolve(__dirname, '..', 'src', 'workspace', 'sharedPanels.js'), 'utf8');
const orderHelpersSource = readFileSync(resolve(__dirname, '..', 'src', 'board', 'orderHelpers.js'), 'utf8');

describe('hierarchy style contract', () => {
  it('keeps dashboard section children visibly owned by their section header', () => {
    // Dashboard groups use tree-entry/tree-node/tree-children structure
    // No extra padding-left — TreeView indent guides handle all indentation.
    // The shell's index.html no longer hardcodes the dashboard markup
    // (dashboard runs as its own webview); the contract is enforced on
    // the `sharedPanels.js` factory which builds the dashboard panel.
    expect(sharedPanels).toContain('data-hierarchy-section-body="true"');
    expect(sharedPanels).toContain('data-dashboard-group-key=');
    expect(sharedPanels).toContain('data-tree-structural-role="section"');
    expect(sharedPanels).toContain('dashboard-group tree-entry');
    expect(sharedPanels).toContain('dashboard-list tree-children expanded');
    expect(orderHelpersSource).toContain("getAttribute('data-dashboard-group-key')");
  });

  it('dashboard group headers carry the cursor:pointer affordance from the shared .tree-node row layout', () => {
    // Workspace section headers were removed when each window was
    // pinned to a single workspace (window-per-workspace rule). Only
    // dashboard groups still need the joint pointer affordance.
    expect(appCss).toMatch(/\.dashboard-group-header\s*\{[\s\S]{0,80}cursor:\s*pointer/);
  });

  it('uses one quiet typography and accent-line state model across hierarchy surfaces', () => {
    expect(appCss).toContain('--app-shell-font-size: var(--font-size-base);');
    // v2 "warm paper" ink (#1a1816) used as the mode-unset fallback instead of pure black.
    expect(appCss).toContain('--font-color-unified: var(--font-color-mode, #1a1816);');
    // --app-shell-font-color removed — text colors use --text-primary and --text-muted directly
    expect(appCss).toContain('--app-control-font-size: var(--font-size-base);');
    expect(appCss).toContain('--app-control-font-weight: 400;');
    expect(appCss).toContain('--app-font-color: var(--text-primary);');
    expect(appCss).toContain('--app-font-muted-color: var(--text-muted);');
    expect(appCss).toContain('--hierarchy-font-size: var(--app-control-font-size);');
    expect(appCss).toContain('--hierarchy-font-weight: var(--app-control-font-weight);');
    expect(appCss).toContain('--hierarchy-hover-bg: transparent;');
    expect(appCss).toContain('--hierarchy-active-bg: transparent;');
    // Font-size tokens (xs, sm, md) are NOT overridden per container — they retain
    // their distinct values from tokens.css and body inherits --font-size-base.
    // Text color tokens are no longer overridden per container — they use
    // distinct color-mix values from :root and inherit naturally.
    expect(appCss).toMatch(/:where\([\s\S]*\.sidebar,[\s\S]*\.calendar-panel,[\s\S]*\.mgmt-panel,[\s\S]*\.log-panel[\s\S]*\)\s*\{/);
    // Containers set font-size; children inherit it
    expect(appCss).toMatch(/\.board-list\s*\{[\s\S]*font-size:\s*var\(--hierarchy-font-size\)/);
    expect(appCss).toMatch(/\.sidebar-dashboard-body\s*\{[\s\S]*font-size:\s*var\(--hierarchy-font-size\)/);
    expect(appCss).toMatch(/\.sidebar-dashboard-controls\s*\{[\s\S]*font-size:\s*var\(--hierarchy-font-size\)/);
    expect(appCss).toMatch(/\.tree-node\s*\{[\s\S]*font-weight:\s*var\(--hierarchy-font-weight\)/);
    // Dashboard group headers inherit font-weight from .tree-node
    // (asserted above). The legacy joint selector with workspace
    // section headers is gone — single-workspace-per-window means
    // there's no workspace section header anymore.
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

  it('uses full indentation without compact root flattening', () => {
    // compact variant was removed — all levels get proper indent
    expect(treeViewSource).toContain("var childIndent = parentLastFlags.concat([isLast]);");
    expect(treeViewSource).toContain("entry.setAttribute('data-tree-node-role', nodeRole);");
    expect(treeViewSource).toContain("el.setAttribute('data-tree-node-role', nodeRole);");
    expect(treeViewSource).toContain("entry.setAttribute('data-tree-structural-role', structuralRole);");
    expect(treeViewSource).toContain("el.setAttribute('data-tree-structural-role', structuralRole);");
    // compact root flattening CSS was removed — all tree nodes get indent guides
  });

  it('styles hierarchy groups and items from structural roles instead of per-surface type lists', () => {
    expect(appCss).toContain('.tree-node[data-tree-structural-role="group"] > .tree-label');
    expect(appCss).toContain('.tree-node[data-tree-structural-role="item"] > .tree-label');
  });

  it('keeps hierarchy tree action icons visible without settings gates', () => {
    expect(appCss).toContain('body.workspace-shell-mode .board-list,');
    expect(appCss).toContain('--sidebar-tree-action-col: var(--app-icon-button-size);');
    expect(appCss).toContain('--sidebar-tree-grip-col: var(--app-icon-button-size);');
    expect(appCss).toContain('.board-list .tree-menu-btn {');
    expect(appCss).toMatch(/\.board-list \.tree-menu-btn\s*\{[\s\S]{0,80}opacity:\s*1/);
    expect(appCss).toMatch(/\.board-list \.tree-grip\.entity-drag-icon\s*\{[\s\S]{0,80}opacity:\s*0\.88/);
    expect(appCss).toContain('body.workspace-shell-mode .board-list .tree-menu-btn,');
    expect(appCss).toContain('body.workspace-shell-mode .lexera-shared-board-list .tree-menu-btn,');
    expect(appCss).toContain('body.workspace-shell-mode .board-list .tree-grip.entity-drag-icon,');
    expect(appCss).toContain('body.workspace-shell-mode .lexera-shared-board-list .tree-grip.entity-drag-icon {');
    expect(appCss).toContain('display: inline-flex !important;');
    expect(appCss).not.toContain('data-sidebar-tree-menus');
    expect(appCss).not.toContain('data-sidebar-tree-grips');
  });

  it('keeps count and presence columns always visible without frontend settings gates', () => {
    expect(appCss).toContain('.lexera-shared-board-list .board-item-count');
    expect(appCss).toContain('.lexera-shared-board-list .tree-count');
    expect(appCss).toContain('.lexera-shared-board-list .board-presence-badge');
    expect(treeViewSource).toContain("root.setAttribute('data-sidebar-tree-counts', 'on')");
    expect(treeViewSource).toContain("root.setAttribute('data-sidebar-tree-presence', 'on')");
    expect(treeViewSource).not.toContain("localStorage.getItem('lexera-sidebar-tree-display')");
    expect(treeViewSource).not.toContain("listen('frontend-setting-changed'");
  });

  it('does not expose hierarchy display toggles in frontend settings', () => {
    expect(frontendSettingsHtml).not.toContain('data-frontend-settings-section="hierarchy"');
    expect(frontendSettingsHtml).not.toContain('lexera-shared-frontend-settings-sidebar-counts');
    expect(frontendSettingsHtml).not.toContain('lexera-shared-frontend-settings-sidebar-presence');
    expect(frontendSettingsHtml).not.toContain('lexera-shared-frontend-settings-sidebar-grips');
    expect(frontendSettingsHtml).not.toContain('lexera-shared-frontend-settings-sidebar-menus');
    expect(sharedPanels).not.toContain('data-frontend-settings-section="hierarchy"');
    expect(sharedPanels).not.toContain('lexera-shared-frontend-settings-sidebar-counts');
    expect(sharedPanels).not.toContain('lexera-shared-frontend-settings-sidebar-presence');
    expect(sharedPanels).not.toContain('lexera-shared-frontend-settings-sidebar-grips');
    expect(sharedPanels).not.toContain('lexera-shared-frontend-settings-sidebar-menus');
  });
});
