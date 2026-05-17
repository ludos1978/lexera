import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const appCss = readFileSync(resolve(__dirname, '..', 'src', 'app.css'), 'utf8');

function getRuleBody(css, selector) {
  var escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  var match = css.match(new RegExp('(?:^|\\n)' + escapedSelector + '\\s*\\{([\\s\\S]*?)\\n\\}', 'm'));
  return match ? match[1] : '';
}

describe('modal dialog height contract', () => {
  it('lets the dialog grow to its content height instead of clipping at a viewport cap', () => {
    const rule = getRuleBody(appCss, '.modal-dialog');

    expect(rule).not.toBe('');
    expect(rule).not.toMatch(/max-height\s*:/);
  });

  it('still scrolls overflow when the dialog exceeds the viewport', () => {
    const rule = getRuleBody(appCss, '.modal-dialog');

    expect(rule).toContain('overflow-y: auto;');
  });
});
