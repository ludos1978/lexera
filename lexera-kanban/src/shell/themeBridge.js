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
    var t = tauri();
    if (!t || !t.webview || typeof t.webview.getCurrentWebview !== 'function') return null;
    try { return t.webview.getCurrentWebview(); } catch (_) { return null; }
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

  /**
   * Read every theme CSS var off :root plus the resolved color scheme,
   * returning a { palette, color_scheme } snapshot ready to broadcast.
   * Returns null if there's no document (test sandbox without DOM).
   */
  function snapshotTheme() {
    if (typeof document === 'undefined' || !document.documentElement) return null;
    var cs = getComputedStyle(document.documentElement);
    var palette = {};
    for (var i = 0; i < THEME_VAR_NAMES.length; i++) {
      var v = cs.getPropertyValue(THEME_VAR_NAMES[i]);
      if (v) palette[THEME_VAR_NAMES[i]] = v.trim();
    }
    var isDark = (document.documentElement.style.colorScheme === 'dark') ||
      (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    return { palette: palette, color_scheme: isDark ? 'dark' : 'light' };
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
      var handler = function () { setTimeout(broadcastTheme, 50); };
      if (mq.addEventListener) mq.addEventListener('change', handler);
      else if (mq.addListener) mq.addListener(handler);
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
      applyThemeSnapshot: applyThemeSnapshot,
      initListeners: initListeners
    };
  }
})();
