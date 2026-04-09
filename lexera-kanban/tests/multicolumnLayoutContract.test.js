import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const appCss = readFileSync(resolve(__dirname, '..', 'src', 'app.css'), 'utf8');

function getRuleBody(css, selector) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp('(?:^|\\n)' + escapedSelector + '\\s*\\{([\\s\\S]*?)\\n\\}', 'm'));
  return match ? match[1] : '';
}

describe('markdown multicolumn layout contract', () => {
  it('keeps the multicolumn wrapper content-sized', () => {
    const rule = getRuleBody(appCss, '.md-multicolumn');
    expect(rule).toContain('display: flex;');
    expect(rule).toContain('align-items: stretch;');
    expect(rule).toContain('min-height: max-content;');
    expect(rule).toContain('overflow: visible;');
  });

  it('keeps multicolumn columns sized by their children', () => {
    const rule = getRuleBody(appCss, '.md-multicolumn-column');
    expect(rule).toContain('display: flex;');
    expect(rule).toContain('flex-direction: column;');
    expect(rule).toContain('min-height: max-content;');
    expect(rule).toContain('overflow: visible;');
  });
});
