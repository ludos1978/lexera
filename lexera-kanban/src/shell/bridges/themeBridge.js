// Theme bridge — shell-side broadcaster for the multiview palette.
//
// The main kanban applies a palette as CSS custom properties on
// :root via lexera-shared/themes.js. Per-view sub-apps don't run
// that code; they need the same palette so their UI matches.
//
// This module is the SHELL side: it snapshots the current palette and
// broadcasts it via multiview_broadcast. Sub-apps subscribe to
// theme-snapshot (typically through LexeraSubApp.init) and apply
// the snapshot to their own :root.
//
// Workstream 5 extraction: split out from multiviewClient.js so the
// transport file stays focused on raw IPC plumbing.

(function () {
  'use strict';

  function tauri() {
    if (typeof window === 'undefined' || !window.__TAURI__) return null;
    return window.__TAURI__;
  }

  function invoke(cmd, args) {
    var t = tauri();
    if (!t || !t.core || typeof t.core.invoke !== 'function') {
      return Promise.reject(new Error('Tauri invoke unavailable'));
    }
    return t.core.invoke(cmd, args || {});
  }

  function getCurrentWebview() {
    // Tauri 2 ships both `getCurrent` and `getCurrentWebview`; different
    // builds expose subtly different shapes. Try the singular form
    // first to match the codebase-wide pattern (subAppRuntime,
    // multiviewWebview, multiviewClient). Single-API resolution caused
    // the silent cross-view-DnD failure (see commit 1d19e940); applied
    // preemptively here to forestall the same bug class.
    var t = tauri();
    if (!t || !t.webview) return null;
    try {
      if (typeof t.webview.getCurrent === 'function') return t.webview.getCurrent();
      if (typeof t.webview.getCurrentWebview === 'function') return t.webview.getCurrentWebview();
    } catch (_) {}
    return null;
  }

  // Names of every CSS variable the theme exposes. Listed explicitly so
  // we don't have to walk all getComputedStyle properties on every
  // broadcast.
  var THEME_VAR_NAMES = [
    '--bg-primary', '--bg-secondary', '--bg-tertiary', '--bg-hover', '--bg-active',
    '--border', '--font-color-mode', '--text-primary', '--text-muted',
    '--accent', '--accent-hover', '--success', '--error',
    '--card-bg', '--card-border', '--card-checked',
    '--scrollbar-thumb', '--scrollbar-thumb-hover', '--scrollbar-track',
    '--btn-bg', '--btn-bg-hover', '--btn-fg',
    '--input-bg', '--input-border',
    '--font-size-base', '--font-size-s', '--font-size-l'
  ];

  function readUserVisualThemeCss() {
    if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return '';
    var styleEl = document.getElementById('lexera-visual-theme-user-style');
    return styleEl ? String(styleEl.textContent || '') : '';
  }

  /**
   * Read every theme CSS var off :root plus the resolved color scheme,
   * returning a { palette, color_scheme } snapshot ready to broadcast.
   * Returns null if there's no document (test sandbox without DOM).
   */
  function snapshotTheme() {
    if (typeof document === 'undefined' || !document.documentElement) return null;
    var rootEl = document.documentElement;
    var cs = getComputedStyle(rootEl);
    /** @type {{ [varName: string]: string }} */
    var palette = {};
    for (var i = 0; i < THEME_VAR_NAMES.length; i++) {
      var v = cs.getPropertyValue(THEME_VAR_NAMES[i]);
      if (v) palette[THEME_VAR_NAMES[i]] = v.trim();
    }
    // The resolved theme mode (`'dark'` / `'light'`) lives on the shell's
    // :root via appearance.js. It — not the palette vars alone — is what
    // app.css gates every dark-mode token on (`:root[data-theme-mode]`).
    // Sub-app webviews don't load appearance.js, so the snapshot MUST
    // carry the mode for them to flip the full token set.
    var themeMode = rootEl.getAttribute('data-theme-mode') || '';
    var themeModeRequested = rootEl.getAttribute('data-theme-mode-requested') || '';
    var isDark = themeMode
      ? (themeMode === 'dark')
      : ((rootEl.style.colorScheme === 'dark') ||
         (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches));
    /** @type {'dark' | 'light'} */
    var color_scheme = isDark ? 'dark' : 'light';
    return {
      palette: palette,
      color_scheme: color_scheme,
      theme_mode: themeMode || color_scheme,
      theme_mode_requested: themeModeRequested || themeMode || color_scheme,
      visual_theme: rootEl.getAttribute('data-visual-theme') || '',
      visual_theme_variant: rootEl.getAttribute('data-visual-theme-variant') || '',
      visual_theme_lineage: rootEl.getAttribute('data-visual-theme-lineage') || '',
      visual_theme_user_css: readUserVisualThemeCss()
    };
  }

  /**
   * Broadcast the current palette to every webview that has subscribed
   * to theme-snapshot. Subscribers include all sub-apps that
   * LexeraSubApp.init({ requestTheme: true }).
   */
  function broadcastTheme() {
    var snap = snapshotTheme();
    if (!snap) return Promise.resolve();
    return invoke('multiview_broadcast', {
      event: 'theme-snapshot',
      payload: snap
    }).catch(function () { /* offline / no Tauri */ });
  }

  function broadcastThemeAfterThemeChange() {
    broadcastTheme();
    setTimeout(broadcastTheme, 50);
    setTimeout(broadcastTheme, 250);
  }

  function setThemeSnapshotAttr(root, attr, value) {
    if (typeof value === 'undefined') return;
    if (value) root.setAttribute(attr, value);
    else root.removeAttribute(attr);
  }

  function applyUserVisualThemeCss(cssText) {
    if (typeof document === 'undefined') return;
    var doc = document;
    var styleEl = typeof doc.getElementById === 'function'
      ? doc.getElementById('lexera-visual-theme-user-style')
      : null;
    var css = String(cssText || '');
    if (!css) {
      if (styleEl && styleEl.parentNode) styleEl.parentNode.removeChild(styleEl);
      return;
    }
    if (!doc.head || typeof doc.createElement !== 'function') return;
    if (!styleEl) {
      styleEl = doc.createElement('style');
      styleEl.id = 'lexera-visual-theme-user-style';
      styleEl.setAttribute('data-lexera-visual-theme-source', 'user');
      doc.head.appendChild(styleEl);
    }
    styleEl.textContent = css;
  }

  /**
   * Apply a received palette snapshot to :root of the current document.
   * Used by sub-apps in their own webview context — included here for
   * symmetry; sub-apps that load subAppRuntime.js already have their
   * own copy that runs on theme-snapshot events.
   */
  function applyThemeSnapshot(snapshot) {
    if (!snapshot || !snapshot.palette) return;
    var root = document.documentElement;
    var keys = Object.keys(snapshot.palette);
    for (var i = 0; i < keys.length; i++) {
      root.style.setProperty(keys[i], snapshot.palette[keys[i]]);
    }
    if (snapshot.theme_mode) root.setAttribute('data-theme-mode', snapshot.theme_mode);
    if (snapshot.theme_mode_requested) {
      root.setAttribute('data-theme-mode-requested', snapshot.theme_mode_requested);
    }
    setThemeSnapshotAttr(root, 'data-visual-theme', snapshot.visual_theme);
    setThemeSnapshotAttr(root, 'data-visual-theme-variant', snapshot.visual_theme_variant);
    setThemeSnapshotAttr(root, 'data-visual-theme-lineage', snapshot.visual_theme_lineage);
    if (Object.prototype.hasOwnProperty.call(snapshot, 'visual_theme_user_css')) {
      applyUserVisualThemeCss(snapshot.visual_theme_user_css);
    }
    if (snapshot.color_scheme) root.style.colorScheme = snapshot.color_scheme;
  }

  /**
   * Wire up automatic re-broadcast on:
   *   - initial mount (after a 200 ms grace so the app's theme code can
   *     finish applying its first palette)
   *   - prefers-color-scheme change
   *   - explicit theme-request events from sub-apps that just mounted
   *     and need an immediate snapshot.
   *
   * Returns a teardown function to detach the listeners (currently unused
   * — listeners live for the shell's lifetime).
   */
  function initListeners() {
    setTimeout(broadcastTheme, 200);
    if (typeof window !== 'undefined' && window.matchMedia) {
      var mq = window.matchMedia('(prefers-color-scheme: dark)');
      var handler = function () { setTimeout(broadcastThemeAfterThemeChange, 50); };
      if (mq.addEventListener) mq.addEventListener('change', handler);
      else if (mq.addListener) mq.addListener(handler);
    }
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('lexera-visual-theme-applied', broadcastThemeAfterThemeChange);
    }
    var wv = getCurrentWebview();
    if (wv && typeof wv.listen === 'function') {
      wv.listen('theme-request', function () { broadcastTheme(); });
    }
    return function teardown() { /* noop placeholder */ };
  }

  if (typeof window !== 'undefined') {
    window.LexeraThemeBridge = {
      THEME_VAR_NAMES: THEME_VAR_NAMES,
      snapshotTheme: snapshotTheme,
      broadcastTheme: broadcastTheme,
      broadcastThemeAfterThemeChange: broadcastThemeAfterThemeChange,
      applyThemeSnapshot: applyThemeSnapshot,
      initListeners: initListeners
    };
  }
})();
