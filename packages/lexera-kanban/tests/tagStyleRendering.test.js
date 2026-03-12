import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, '..', 'src');

function readSource(name) {
  return readFileSync(resolve(srcDir, name), 'utf-8');
}

describe('tag style rendering parity', () => {
  it('does not re-render tag labels or badge rails into headers/footers', () => {
    const appSource = readSource('app.js');
    expect(appSource.includes('renderTagStyleBadgeRail(')).toBe(false);
    expect(appSource.includes('buildTagStyleBadgeDescriptor(')).toBe(false);
    expect(appSource.includes("setAttribute('data-tag-style-label'")).toBe(false);
  });

  it('does not include generated tag label or badge CSS hooks', () => {
    const cssSource = readSource('app.css');
    expect(cssSource.includes('data-tag-style-label')).toBe(false);
    expect(cssSource.includes('.tag-style-badge-rail')).toBe(false);
    expect(cssSource.includes('.tag-style-badge')).toBe(false);
  });
});
