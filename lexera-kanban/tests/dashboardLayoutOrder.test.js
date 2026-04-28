import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadIIFE } from './load-iife.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const indexHtml = readFileSync(resolve(__dirname, '..', 'src', 'index.html'), 'utf8');

function createDocumentStub() {
  return {
    createElement() {
      return {
        className: '',
        innerHTML: '',
        attributes: {},
        setAttribute(name, value) {
          this.attributes[name] = String(value);
        },
        getAttribute(name) {
          return this.attributes[name] || '';
        }
      };
    }
  };
}

describe('dashboard layout order', () => {
  it('removes the legacy dashboard markup from the shell index.html', () => {
    // The dashboard panel is a child webview in the multiview
    // architecture; its DOM is built by `sharedPanels.createPanelElement`
    // (verified below). The hardcoded `<div id="sidebar-dashboard">`
    // markup that used to live here was a layout liability behind every
    // panel webview (its `.sidebar-dashboard { min-height: 180px }` rule
    // leaked space even after runtime detach), so it was removed.
    expect(indexHtml).not.toContain('data-dashboard-group-key="results"');
    expect(indexHtml).not.toContain('id="sidebar-dashboard"');
  });

  it('renders results before pinned searches in shared dashboard panels', () => {
    const window = {};
    const document = createDocumentStub();

    loadIIFE('workspace/sharedPanels.js', 'window.LexeraSharedPanels', {
      window,
      document,
      CustomEvent: class {},
    });

    const panel = window.LexeraSharedPanels.createPanelElement('dashboard', 'test-dashboard');
    const resultsIndex = panel.innerHTML.indexOf('data-dashboard-group-key="results"');
    const pinnedIndex = panel.innerHTML.indexOf('data-dashboard-group-key="pinned"');

    expect(resultsIndex).toBeGreaterThan(-1);
    expect(pinnedIndex).toBeGreaterThan(-1);
    expect(resultsIndex).toBeLessThan(pinnedIndex);
  });
});
