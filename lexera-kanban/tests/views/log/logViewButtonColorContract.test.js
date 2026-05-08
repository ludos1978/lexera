import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const logCss = readFileSync(resolve(__dirname, '..', '..', '..', 'src', 'views', 'log', 'log.css'), 'utf8');
const appCss = readFileSync(resolve(__dirname, '..', '..', '..', 'src', 'app.css'), 'utf8');

describe('log view button color contract', () => {
  // Regression guard: `--text-secondary` is referenced but never defined
  // anywhere in the codebase. Earlier the log buttons fell back to a hard
  // `#ccc`, which on the default light theme (--bg-tertiary = #ffffff)
  // produced unreadable bright-on-bright text. The fallback chain must
  // route through `--text-primary` so the buttons stay legible in every
  // theme that defines the standard token set.
  it('log header buttons fall back through --text-primary, never to a bare bright literal', () => {
    expect(logCss).toMatch(
      /\.log-panel-tab,\s*\.log-panel-btn,\s*\.connection-status-btn\s*\{[\s\S]*?color:\s*var\(--text-secondary,\s*var\(--text-primary[^)]*\)\s*\)/
    );
  });

  it('log header button :hover reasserts --text-primary so it does not inherit the bright fallback', () => {
    expect(logCss).toMatch(
      /\.log-panel-tab:hover,\s*\.log-panel-btn:hover,\s*\.connection-status-btn:hover\s*\{[\s\S]*?color:\s*var\(--text-primary[^)]*\)/
    );
  });

  it('--text-primary remains defined at the app baseline so the fallback chain resolves', () => {
    // Without this anchor, the fallback chain in log.css would silently
    // collapse to its bare literal — exactly the pre-fix bug.
    expect(appCss).toMatch(/--text-primary:\s*var\(--font-color-unified\)/);
  });
});
