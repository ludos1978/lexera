// Theme-mode contract (user report 2026-05-13).
//
// User: "the dark mode doesnt work anymore. also the frontend settings
// should have a theme-mode setting (auto = system default, dark, bright
// - modes)".
//
// Three pieces must hold for the fix to work:
//
// 1. `app.css` must define dark-token overrides keyed off the
//    `:root[data-theme-mode="dark"]` attribute selector. Without these
//    rules, JS can flip the attribute all day and the surface stays
//    light.
// 2. `appearance.js` must expose the resolver + setter under stable
//    names (`getThemeMode`, `applyThemeMode`, `resolveEffectiveThemeMode`,
//    `getEffectiveThemeMode`, `normalizeThemeMode`, `VALID_THEME_MODES`)
//    so the frontend-settings panel can drive it.
// 3. `frontendSettings/index.html` must carry the
//    `.lexera-shared-frontend-settings-theme-mode` select with
//    auto/light/dark options, and `settings/frontendSettings.js` must
//    wire `bindSelect('theme-mode', 'applyThemeMode')` plus a render
//    branch that reads `opts.getThemeMode()`.
//
// Source-grep contract; pins each piece so a future edit can't silently
// regress the user-visible behaviour.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const appCss = readFileSync(resolve(repoRoot, 'src', 'app.css'), 'utf8');
const appearanceSrc = readFileSync(
  resolve(repoRoot, 'src', 'appearance', 'appearance.js'), 'utf8'
);
const frontendSettingsRendererSrc = readFileSync(
  resolve(repoRoot, 'src', 'settings', 'frontendSettings.js'), 'utf8'
);
const frontendSettingsHtml = readFileSync(
  resolve(repoRoot, 'src', 'views', 'frontendSettings', 'index.html'), 'utf8'
);
const settingsRuntimeSrc = readFileSync(
  resolve(repoRoot, 'src', 'views', '_shared', 'settingsRuntime.js'), 'utf8'
);

describe('theme-mode contract (auto / light / dark)', () => {
  describe('app.css dark-mode tokens', () => {
    it('declares :root[data-theme-mode="dark"] block', () => {
      expect(appCss).toMatch(/:root\[data-theme-mode="dark"\]\s*\{/);
    });

    it('overrides --bg-primary and --text-primary inside the dark block', () => {
      // The dark block must change the user-visible surface tokens.
      // We pin --bg-primary and --text-primary because they're the two
      // tokens consumed everywhere downstream.
      var darkBlockMatch = appCss.match(
        /:root\[data-theme-mode="dark"\][\s\S]{0,2000}?\}/
      );
      expect(darkBlockMatch).not.toBeNull();
      expect(darkBlockMatch[0]).toMatch(/--bg-primary\s*:/);
      expect(darkBlockMatch[0]).toMatch(/--text-primary\s*:/);
    });

    it('flips native color-scheme so scrollbars + form widgets match', () => {
      var darkBlockMatch = appCss.match(
        /:root\[data-theme-mode="dark"\][\s\S]{0,2000}?\}/
      );
      expect(darkBlockMatch[0]).toMatch(/color-scheme\s*:\s*dark/);
    });
  });

  describe('appearance.js resolver + setter', () => {
    it('exposes VALID_THEME_MODES with auto/dark/light', () => {
      expect(appearanceSrc).toMatch(
        /VALID_THEME_MODES\s*=\s*\[\s*['"]auto['"]\s*,\s*['"]dark['"]\s*,\s*['"]light['"]\s*\]/
      );
    });

    it('normalizeThemeMode maps "bright" to "light" and unknown values to "auto"', () => {
      // The user's report uses "bright" — UI label and accepted alias.
      expect(appearanceSrc).toMatch(/raw\s*===\s*['"]bright['"][\s\S]{0,40}raw\s*=\s*['"]light['"]/);
      expect(appearanceSrc).toMatch(/VALID_THEME_MODES\.indexOf\(raw\)\s*!==\s*-1\s*\?\s*raw\s*:\s*['"]auto['"]/);
    });

    it('resolveEffectiveThemeMode falls back to OS prefers-color-scheme for "auto"', () => {
      expect(appearanceSrc).toMatch(/resolveEffectiveThemeMode/);
      expect(appearanceSrc).toMatch(
        /matchMedia\(['"]\(prefers-color-scheme:\s*dark\)['"]\)\.matches\s*\?\s*['"]dark['"]\s*:\s*['"]light['"]/
      );
    });

    it('applyThemeMode writes both data-theme-mode and data-theme-mode-requested on :root', () => {
      // Effective vs requested are SEPARATE attrs — the dropdown shows
      // 'auto' while CSS reads the resolved 'dark' or 'light'.
      expect(appearanceSrc).toMatch(/setAttribute\(['"]data-theme-mode['"]\s*,\s*effective\)/);
      expect(appearanceSrc).toMatch(
        /setAttribute\(['"]data-theme-mode-requested['"]\s*,\s*requested\)/
      );
    });

    it('re-resolves on OS prefers-color-scheme change WHEN user is on auto', () => {
      // Auto must follow OS; explicit dark/light must NOT flip on OS change.
      expect(appearanceSrc).toMatch(
        /matchMedia\(['"]\(prefers-color-scheme:\s*dark\)['"]\)\.addEventListener\([\s\S]{0,400}?readStoredThemeMode\(\)\s*===\s*['"]auto['"][\s\S]{0,200}?applyThemeMode\(['"]auto['"]/
      );
    });

    it('re-applies on cross-webview storage event for lexera-theme-mode', () => {
      // The frontend-settings sub-app writes localStorage; other
      // webviews react via the browser's `storage` event.
      expect(appearanceSrc).toMatch(
        /addEventListener\(['"]storage['"][\s\S]{0,600}?event\.key\s*(===|!==)\s*['"]lexera-theme-mode['"]/
      );
    });

    it('exposes the public API on the IIFE return', () => {
      expect(appearanceSrc).toMatch(/applyThemeMode\s*:\s*applyThemeMode/);
      expect(appearanceSrc).toMatch(/getThemeMode\s*:\s*getThemeMode/);
      expect(appearanceSrc).toMatch(/getEffectiveThemeMode\s*:\s*getEffectiveThemeMode/);
    });
  });

  describe('frontend-settings UI', () => {
    it('index.html declares the theme-mode select with auto/light/dark options', () => {
      expect(frontendSettingsHtml).toMatch(
        /class="[^"]*lexera-shared-frontend-settings-theme-mode"/
      );
      expect(frontendSettingsHtml).toMatch(/value="auto"/);
      expect(frontendSettingsHtml).toMatch(/value="light"/);
      expect(frontendSettingsHtml).toMatch(/value="dark"/);
    });

    it('settings/frontendSettings.js binds theme-mode select to applyThemeMode', () => {
      expect(frontendSettingsRendererSrc).toMatch(
        /bindSelect\(['"]theme-mode['"]\s*,\s*['"]applyThemeMode['"]\)/
      );
    });

    it('settings/frontendSettings.js render() seeds the select from opts.getThemeMode()', () => {
      expect(frontendSettingsRendererSrc).toMatch(
        /q\(root\s*,\s*['"]theme-mode['"]\)[\s\S]{0,200}?opts\.getThemeMode/
      );
    });

    it('settingsRuntime.js (sub-app side) provides getThemeMode + applyThemeMode', () => {
      // The sub-app webview has its own options-bag; it writes
      // localStorage and broadcasts so the shell + other webviews can
      // react. Must accept "bright" as an alias for "light".
      expect(settingsRuntimeSrc).toMatch(/getThemeMode\s*:\s*function/);
      expect(settingsRuntimeSrc).toMatch(/applyThemeMode\s*:\s*function/);
      expect(settingsRuntimeSrc).toMatch(/lexera-theme-mode/);
      expect(settingsRuntimeSrc).toMatch(
        /broadcast\(['"]frontend-setting-changed['"]\s*,\s*\{\s*setting:\s*['"]themeMode['"]/
      );
    });
  });
});
