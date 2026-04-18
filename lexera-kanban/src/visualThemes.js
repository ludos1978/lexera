/**
 * Visual Theme — controls board surface, separators, and the active board skin.
 *
 * Only one true built-in: `classic` (the default — bare app.css
 * baseline, the Lexera v2 warm-paper design lives here). Every other
 * theme — including the bundled `sleek-uniform` starter — is loaded
 * from the user themes directory (seeded on first launch by
 * src-tauri/templates/) so users can edit them freely.
 * can be added at runtime by creating a folder inside the Lexera themes
 * directory with a `theme.json` manifest and optional `theme.css`.
 */
(function () {
  var Settings = typeof LexeraSettings !== 'undefined' ? LexeraSettings : null;
  var BackendDiscovery = typeof window !== 'undefined' ? window.LexeraBackendDiscovery : null;

  var colorSchemeMedia = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null;

  var BUILTIN_VISUAL_THEMES = [
    {
      id: 'classic',
      name: 'No style',
      description: 'Lexera baseline (warm paper) — no theme override applied',
      source: 'builtin'
    }
  ];

  var VISUAL_THEMES = [];
  var VISUAL_THEME_LABELS = {};
  var currentThemeId = 'classic';
  var currentRequestedThemeId = 'classic';
  var visualThemesDirectory = '';
  var themeRegistryReady = false;
  var userThemeCssCache = {};
  var pendingUserThemeStyleToken = 0;

  function clearObject(target) {
    var keys = Object.keys(target || {});
    for (var i = 0; i < keys.length; i++) {
      delete target[keys[i]];
    }
  }

  function sanitizeThemeId(value) {
    var source = String(value || '').trim().toLowerCase();
    if (!source) return '';
    source = source.replace(/[^a-z0-9_-]+/g, '-');
    source = source.replace(/[_\s]+/g, '-');
    source = source.replace(/-+/g, '-');
    return source.replace(/^-+|-+$/g, '');
  }

  function resolveRequestedVisualThemeId(value) {
    var source = String(value || '').trim().toLowerCase();
    if (!source || source === 'default' || source === 'legacy') return 'classic';
    if (source === 'classic' || source === 'no-style' || source === 'nostyle' || source === 'none' ||
        source === 'paper' || source === 'paper-v2' || source === 'warm-paper' || source === 'lexera-v2') return 'classic';
    if (source === 'sleek' || source === 'minimal' || source === 'modern') return 'sleek-uniform';
    if (source === 'sleek-uniform' || source === 'sleekuniform' || source === 'uniform') return 'sleek-uniform';
    if (source === 'bordered' || source === 'boxed' || source === 'outline') return 'classic';
    if (source === 'gap' || source === 'gap-highlight' || source === 'gaphighlight') return 'sleek-uniform';
    if (source === 'lines' || source === 'line' || source === 'line-separator') return 'sleek-uniform';
    return sanitizeThemeId(source) || 'classic';
  }

  function normalizeThemeManifest(raw, fallbackSource) {
    if (!raw || typeof raw !== 'object') return null;
    var id = sanitizeThemeId(raw.id);
    if (!id) return null;
    return {
      id: id,
      baseId: sanitizeThemeId(raw.baseId) || null,
      extends: sanitizeThemeId(raw.extends) || null,
      name: String(raw.name || id),
      description: String(raw.description || ''),
      cssPath: raw.cssPath ? String(raw.cssPath) : '',
      rootPath: raw.rootPath ? String(raw.rootPath) : '',
      source: raw.source ? String(raw.source) : String(fallbackSource || 'user')
    };
  }

  function findThemeById(id) {
    var normalized = sanitizeThemeId(id);
    for (var i = 0; i < VISUAL_THEMES.length; i++) {
      if (VISUAL_THEMES[i].id === normalized) return VISUAL_THEMES[i];
    }
    return null;
  }

  function normalizeLexeraVisualThemeId(value) {
    var requested = resolveRequestedVisualThemeId(value);
    return findThemeById(requested) ? requested : 'classic';
  }

  function findLexeraVisualTheme(id) {
    var requested = resolveRequestedVisualThemeId(id);
    return findThemeById(requested) || findThemeById('classic') || VISUAL_THEMES[0] || BUILTIN_VISUAL_THEMES[0];
  }

  function rebuildVisualThemeLabels() {
    clearObject(VISUAL_THEME_LABELS);
    for (var i = 0; i < VISUAL_THEMES.length; i++) {
      VISUAL_THEME_LABELS[VISUAL_THEMES[i].id] = VISUAL_THEMES[i].name;
    }
  }

  function dispatchVisualThemesChanged() {
    if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
    var eventObject = null;
    try {
      if (typeof window.CustomEvent === 'function') {
        eventObject = new window.CustomEvent('lexera-visual-themes-changed', {
          detail: {
            themes: VISUAL_THEMES.slice(),
            rootPath: visualThemesDirectory || ''
          }
        });
      } else if (typeof Event === 'function') {
        eventObject = new Event('lexera-visual-themes-changed');
      }
    } catch (err) {
      eventObject = null;
    }
    if (eventObject) window.dispatchEvent(eventObject);
  }

  function replaceVisualThemes(nextThemes) {
    var seen = {};
    var normalized = [];
    var i;
    for (i = 0; i < nextThemes.length; i++) {
      var theme = normalizeThemeManifest(nextThemes[i], nextThemes[i] && nextThemes[i].source ? nextThemes[i].source : 'user');
      if (!theme || seen[theme.id]) continue;
      seen[theme.id] = true;
      normalized.push(theme);
    }
    VISUAL_THEMES.length = 0;
    for (i = 0; i < normalized.length; i++) VISUAL_THEMES.push(normalized[i]);
    rebuildVisualThemeLabels();
    if (typeof window !== 'undefined') {
      window.LEXERA_VISUAL_THEMES = VISUAL_THEMES;
      window.LEXERA_VISUAL_THEME_LABELS = VISUAL_THEME_LABELS;
    }
    dispatchVisualThemesChanged();
  }

  function resolveThemeChain(theme) {
    var chain = [];
    var seen = {};
    var cursor = theme;
    while (cursor && !seen[cursor.id]) {
      seen[cursor.id] = true;
      chain.unshift(cursor);
      cursor = cursor.extends ? findThemeById(cursor.extends) : null;
    }
    return chain;
  }

  function resolveThemeBaseId(theme) {
    var chain = resolveThemeChain(theme);
    for (var i = chain.length - 1; i >= 0; i--) {
      if (chain[i].baseId) return chain[i].baseId;
    }
    return theme && theme.id ? theme.id : 'classic';
  }

  function resolveThemeLineage(theme) {
    var chain = resolveThemeChain(theme);
    var ids = [];
    for (var i = 0; i < chain.length; i++) ids.push(chain[i].id);
    return ids.join(' ');
  }

  function collectAccessibleDocuments() {
    var docs = [];
    if (typeof document !== 'undefined') docs.push(document);
    if (typeof document !== 'undefined' && typeof document.querySelectorAll === 'function') {
      var iframes = document.querySelectorAll('iframe');
      for (var i = 0; i < iframes.length; i++) {
        try {
          var childDoc = iframes[i].contentDocument;
          if (childDoc && docs.indexOf(childDoc) === -1) docs.push(childDoc);
        } catch (err) {
          /* ignore cross-origin frames */
        }
      }
    }
    return docs;
  }

  function applyThemeAttributesToDocument(doc, theme) {
    if (!doc || !doc.documentElement) return;
    var root = doc.documentElement;
    root.setAttribute('data-visual-theme', resolveThemeBaseId(theme));
    root.setAttribute('data-visual-theme-variant', theme.id);
    root.setAttribute('data-visual-theme-lineage', resolveThemeLineage(theme));
  }

  function removeUserThemeStyleFromDocument(doc) {
    if (!doc || typeof doc.getElementById !== 'function') return;
    var styleEl = doc.getElementById('lexera-visual-theme-user-style');
    if (styleEl && styleEl.parentNode && typeof styleEl.parentNode.removeChild === 'function') {
      styleEl.parentNode.removeChild(styleEl);
    }
  }

  function setUserThemeStyleOnDocument(doc, cssText) {
    if (!doc || !doc.head || typeof doc.createElement !== 'function') return;
    var styleEl = typeof doc.getElementById === 'function'
      ? doc.getElementById('lexera-visual-theme-user-style')
      : null;
    if (!styleEl) {
      styleEl = doc.createElement('style');
      styleEl.id = 'lexera-visual-theme-user-style';
      styleEl.setAttribute('data-lexera-visual-theme-source', 'user');
      doc.head.appendChild(styleEl);
    }
    styleEl.textContent = String(cssText || '');
  }

  function canUseTauriInvoke() {
    if (BackendDiscovery && typeof BackendDiscovery.canUseTauriInvoke === 'function') {
      return BackendDiscovery.canUseTauriInvoke();
    }
    return !!(
      typeof window !== 'undefined' &&
      window.__TAURI__ &&
      window.__TAURI__.core &&
      typeof window.__TAURI__.core.invoke === 'function'
    );
  }

  function invokeTauri(command, args) {
    if (BackendDiscovery && typeof BackendDiscovery.invokeTauri === 'function') {
      return BackendDiscovery.invokeTauri(command, args || {});
    }
    if (
      typeof window !== 'undefined' &&
      window.__TAURI__ &&
      window.__TAURI__.core &&
      typeof window.__TAURI__.core.invoke === 'function'
    ) {
      return window.__TAURI__.core.invoke(command, args || {});
    }
    return Promise.reject(new Error('Tauri invoke unavailable: ' + command));
  }

  function readStoredVisualThemeId() {
    try {
      var stored = Settings ? Settings.get('visualTheme') : localStorage.getItem('lexera-visual-theme');
      if (stored) return resolveRequestedVisualThemeId(stored);

      var legacyTemplate = localStorage.getItem('lexera-ui-template');
      if (legacyTemplate) return resolveRequestedVisualThemeId(legacyTemplate);

      var legacyBoardTheme = localStorage.getItem('lexera-board-theme');
      if (legacyBoardTheme) return resolveRequestedVisualThemeId(legacyBoardTheme);
    } catch (err) {
      /* ignore localStorage errors */
    }
    return 'classic';
  }

  function persistVisualThemeSelection(requestedId, appliedTheme, options) {
    if (options && options.skipPersist) return;
    var resolved = appliedTheme && appliedTheme.id ? appliedTheme.id : 'classic';
    var valueToStore = requestedId === resolved ? requestedId : resolved;

    if (requestedId !== resolved && !themeRegistryReady) {
      return;
    }

    try {
      if (Settings) {
        Settings.set('visualTheme', valueToStore);
      } else {
        localStorage.setItem('lexera-visual-theme', valueToStore);
      }
    } catch (err) {
      /* ignore localStorage errors */
    }
  }

  function getUserThemesInChain(theme) {
    var chain = resolveThemeChain(theme);
    var userThemes = [];
    for (var i = 0; i < chain.length; i++) {
      if (chain[i].source === 'user' && chain[i].cssPath) userThemes.push(chain[i]);
    }
    return userThemes;
  }

  function readUserThemeCss(theme) {
    if (!theme || !theme.cssPath || !canUseTauriInvoke()) return Promise.resolve('');
    if (!userThemeCssCache[theme.cssPath]) {
      userThemeCssCache[theme.cssPath] = invokeTauri('read_text_file', { path: theme.cssPath }).catch(function (err) {
        if (typeof console !== 'undefined' && console.warn) {
          console.warn('[visualThemes] Failed to read theme css', theme.cssPath, err);
        }
        return '';
      });
    }
    return userThemeCssCache[theme.cssPath];
  }

  function applyUserThemeStyles(theme) {
    var docs = collectAccessibleDocuments();
    var userThemes = getUserThemesInChain(theme);
    var token = ++pendingUserThemeStyleToken;

    if (!userThemes.length) {
      for (var i = 0; i < docs.length; i++) removeUserThemeStyleFromDocument(docs[i]);
      return;
    }

    var loads = [];
    for (var li = 0; li < userThemes.length; li++) loads.push(readUserThemeCss(userThemes[li]));

    Promise.all(loads).then(function (parts) {
      if (token !== pendingUserThemeStyleToken) return;
      var css = parts.filter(function (part) { return !!String(part || '').trim(); }).join('\n\n');
      var liveDocs = collectAccessibleDocuments();
      if (!css) {
        for (var ri = 0; ri < liveDocs.length; ri++) removeUserThemeStyleFromDocument(liveDocs[ri]);
        return;
      }
      for (var si = 0; si < liveDocs.length; si++) setUserThemeStyleOnDocument(liveDocs[si], css);
    });
  }

  function applyLexeraVisualTheme(themeId, options) {
    var requestedId = resolveRequestedVisualThemeId(themeId);
    var theme = findThemeById(requestedId) || findThemeById('classic') || VISUAL_THEMES[0] || BUILTIN_VISUAL_THEMES[0];
    var docs = collectAccessibleDocuments();

    currentRequestedThemeId = requestedId;
    currentThemeId = theme.id;

    for (var i = 0; i < docs.length; i++) {
      applyThemeAttributesToDocument(docs[i], theme);
    }

    applyUserThemeStyles(theme);

    if (typeof applyLexeraTheme === 'function') {
      applyLexeraTheme('lexera');
    }

    persistVisualThemeSelection(requestedId, theme, options || {});
    return theme;
  }

  function getLexeraCurrentVisualThemeId() {
    return currentThemeId;
  }

  function getLexeraVisualThemesDirectory() {
    return visualThemesDirectory || '';
  }

  function discoverUserVisualThemes() {
    if (!canUseTauriInvoke()) {
      return Promise.resolve({ rootPath: '', themes: [] });
    }
    return invokeTauri('discover_visual_themes', {}).then(function (result) {
      return result && typeof result === 'object'
        ? result
        : { rootPath: '', themes: [] };
    }).catch(function (err) {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[visualThemes] Failed to discover user themes', err);
      }
      return { rootPath: '', themes: [] };
    });
  }

  function refreshLexeraVisualThemes() {
    return discoverUserVisualThemes().then(function (result) {
      var merged = BUILTIN_VISUAL_THEMES.slice();
      var themes = result && Array.isArray(result.themes) ? result.themes : [];
      var seen = {};
      var i;

      for (i = 0; i < merged.length; i++) seen[merged[i].id] = true;
      for (i = 0; i < themes.length; i++) {
        var theme = normalizeThemeManifest(themes[i], 'user');
        if (!theme || seen[theme.id]) continue;
        seen[theme.id] = true;
        merged.push(theme);
      }

      visualThemesDirectory = result && result.rootPath ? String(result.rootPath) : '';
      replaceVisualThemes(merged);
      themeRegistryReady = true;
      applyLexeraVisualTheme(currentRequestedThemeId || readStoredVisualThemeId());
      return VISUAL_THEMES;
    });
  }

  replaceVisualThemes(BUILTIN_VISUAL_THEMES);

  if (typeof window !== 'undefined') {
    window.LEXERA_VISUAL_THEMES = VISUAL_THEMES;
    window.LEXERA_VISUAL_THEME_LABELS = VISUAL_THEME_LABELS;
    window.normalizeLexeraVisualThemeId = normalizeLexeraVisualThemeId;
    window.applyLexeraVisualTheme = applyLexeraVisualTheme;
    window.getLexeraCurrentVisualThemeId = getLexeraCurrentVisualThemeId;
    window.getLexeraVisualThemesDirectory = getLexeraVisualThemesDirectory;
    window.refreshLexeraVisualThemes = refreshLexeraVisualThemes;
  }

  try {
    applyLexeraVisualTheme(readStoredVisualThemeId());
  } catch (err) {
    applyLexeraVisualTheme('classic');
  }

  refreshLexeraVisualThemes();

  if (colorSchemeMedia && typeof colorSchemeMedia.addEventListener === 'function') {
    colorSchemeMedia.addEventListener('change', function () {
      applyLexeraVisualTheme(currentRequestedThemeId || readStoredVisualThemeId());
    });
  }
})();
