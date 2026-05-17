import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const appCss = readFileSync(resolve(__dirname, '..', 'src', 'app.css'), 'utf8');
const embedMenuJs = readFileSync(resolve(__dirname, '..', 'src', 'menu', 'embedMenu.js'), 'utf8');

describe('include menu layout contract', () => {
  it('keeps include burger buttons inline instead of overlaying column controls', () => {
    expect(embedMenuJs).toContain('class="embed-menu-btn include-menu-btn"');
    expect(appCss).toMatch(
      /\.include-link-container \.include-menu-btn,\s*\.include-inline-container \.include-menu-btn\s*\{[\s\S]*position:\s*static;[\s\S]*top:\s*auto;[\s\S]*right:\s*auto;[\s\S]*opacity:\s*1;[\s\S]*z-index:\s*auto;/
    );
  });
});
