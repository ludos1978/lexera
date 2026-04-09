import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const appCss = readFileSync(resolve(__dirname, '..', 'src', 'app.css'), 'utf8');
const appJs = readFileSync(resolve(__dirname, '..', 'src', 'app.js'), 'utf8');

function getRuleBody(css, selector) {
  var escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  var match = css.match(new RegExp('(?:^|\\n)' + escapedSelector + '\\s*\\{([\\s\\S]*?)\\n\\}', 'm'));
  return match ? match[1] : '';
}

describe('card auto-size contract', () => {
  it('keeps cards content-sized instead of clipping the rendered body', () => {
    const cardRule = getRuleBody(appCss, '.card');
    const cardContentRule = getRuleBody(appCss, '.card-content');

    expect(cardRule).toContain('height: auto;');
    expect(cardRule).toContain('max-height: none;');
    expect(cardRule).toContain('overflow: visible;');
    expect(cardContentRule).toContain('flex: 0 0 auto;');
    expect(cardContentRule).toContain('overflow: visible;');
  });

  it('remeasures cards after post-render size changes', () => {
    expect(appJs).toContain('function flushCardAutoSizeSync() {');
    expect(appJs).toContain('function queueCardAutoSizeSync(colIndex, options) {');
    expect(appJs).toContain('function ensureCardAutoSizeObserver() {');
    expect(appJs).toContain('function observeCardAutoSize(root) {');
    expect(appJs).toContain('observeCardAutoSize(el);');
    expect(appJs).toContain('queueCardAutoSizeSync(colIndex, {');
    expect(appJs).toContain('clearLayoutLockStyles();');
    expect(appJs).toContain('vsRemeasureColumn(pendingCols[i]);');
  });
});
