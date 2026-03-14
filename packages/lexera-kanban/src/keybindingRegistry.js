/// Configurable keyboard shortcut registry.
/// Loads user keybindings from ~/.config/lexera/keybindings.json and merges
/// with built-in defaults. User bindings take priority over defaults.
///
/// Binding format (VSCode-like):
///   { "key": "meta+1", "action": "insert-text", "args": { "text": "\n\n---:\n\n" }, "when": "editor" }
///
/// Contexts (when):
///   "always"     - active everywhere
///   "board"      - active when viewing a board but NOT editing a card
///   "editor"     - active when a card editor textarea has focus
///   "card-focus" - active when a card has keyboard focus (not editing)
///
/// Built-in actions:
///   "insert-text"       - insert args.text at cursor position in editor
///   "insert-formatting" - wrap/prefix/suffix selection (args: { wrap, prefix, suffix })
///   Any ActionRegistry action name (dispatched via ActionRegistry)
(function () {
  'use strict';

  var isMac = navigator.platform && navigator.platform.indexOf('Mac') >= 0;

  // ── Key combo parsing ──

  function normalizeKeyCombo(combo) {
    var parts = combo.toLowerCase().split('+');
    var mods = { ctrl: false, meta: false, shift: false, alt: false };
    var key = '';
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i].trim();
      if (p === 'ctrl' || p === 'control') mods.ctrl = true;
      else if (p === 'meta' || p === 'cmd' || p === 'command') mods.meta = true;
      else if (p === 'shift') mods.shift = true;
      else if (p === 'alt' || p === 'option') mods.alt = true;
      else key = p;
    }
    return { ctrl: mods.ctrl, meta: mods.meta, shift: mods.shift, alt: mods.alt, key: key };
  }

  function eventMatchesCombo(e, combo) {
    // "meta" means Cmd on Mac, Ctrl on non-Mac (VSCode convention)
    if (isMac) {
      if (combo.meta && !e.metaKey) return false;
      if (!combo.meta && e.metaKey) return false;
      if (combo.ctrl && !e.ctrlKey) return false;
      if (!combo.ctrl && e.ctrlKey) return false;
    } else {
      var wantPrimary = combo.ctrl || combo.meta;
      if (wantPrimary && !e.ctrlKey) return false;
      if (!wantPrimary && e.ctrlKey) return false;
      if (e.metaKey) return false;
    }
    if (combo.shift !== e.shiftKey) return false;
    if (combo.alt !== e.altKey) return false;

    var eventKey = e.key.toLowerCase();
    if (eventKey === combo.key) return true;
    // Number keys: e.key may differ when shift is held, check e.code
    if (combo.key.length === 1 && combo.key >= '0' && combo.key <= '9') {
      if (e.code === 'Digit' + combo.key) return true;
    }
    // Letter fallback via code
    if (combo.key.length === 1 && combo.key >= 'a' && combo.key <= 'z') {
      if (e.code === 'Key' + combo.key.toUpperCase()) return true;
    }
    // Special key names
    if (combo.key === 'enter' && (eventKey === 'enter')) return true;
    if (combo.key === 'escape' && (eventKey === 'escape')) return true;
    if (combo.key === 'tab' && (eventKey === 'tab')) return true;
    if (combo.key === 'space' && (eventKey === ' ')) return true;
    if (combo.key === 'backspace' && (eventKey === 'backspace')) return true;
    if (combo.key === 'delete' && (eventKey === 'delete')) return true;
    if (combo.key === 'home' && (eventKey === 'home')) return true;
    if (combo.key === 'end' && (eventKey === 'end')) return true;
    if (combo.key === 'up' && (eventKey === 'arrowup')) return true;
    if (combo.key === 'down' && (eventKey === 'arrowdown')) return true;
    if (combo.key === 'left' && (eventKey === 'arrowleft')) return true;
    if (combo.key === 'right' && (eventKey === 'arrowright')) return true;
    if (combo.key === '=' && (eventKey === '=' || eventKey === '+')) return true;
    if (combo.key === '-' && (eventKey === '-')) return true;
    if (combo.key === '`' && (eventKey === '`')) return true;
    if (combo.key === '?' && (eventKey === '?')) return true;
    if (combo.key === 'f12' && (eventKey === 'f12')) return true;
    return false;
  }

  // ── Binding storage ──

  var userBindings = [];
  var loaded = false;
  var configPath = null;

  // ── Public API ──

  var KeybindingRegistry = {
    /// Load user keybindings from the config file.
    /// Called during app init with the result of read_text_file.
    loadFromJson: function (jsonString) {
      userBindings = [];
      if (!jsonString) { loaded = true; return; }
      try {
        var arr = JSON.parse(jsonString);
        if (!Array.isArray(arr)) { loaded = true; return; }
        for (var i = 0; i < arr.length; i++) {
          var b = arr[i];
          if (!b.key || !b.action) continue;
          userBindings.push({
            key: b.key,
            combo: normalizeKeyCombo(b.key),
            action: b.action,
            when: b.when || 'always',
            args: b.args || null,
            description: b.description || ''
          });
        }
      } catch (err) {
        console.warn('[keybinding] Failed to parse keybindings.json:', err);
      }
      loaded = true;
    },

    /// Match a keyboard event against user bindings for a given context.
    /// Returns the first matching binding object, or null.
    match: function (event, context) {
      for (var i = 0; i < userBindings.length; i++) {
        var b = userBindings[i];
        if (b.when !== context && b.when !== 'always') continue;
        if (eventMatchesCombo(event, b.combo)) return b;
      }
      return null;
    },

    /// Execute a matched binding. Returns true if handled.
    /// textarea: the active textarea element (for insert-text/insert-formatting actions)
    /// insertFn: reference to the insertFormatting function
    execute: function (binding, textarea, insertFn) {
      if (!binding) return false;

      if (binding.action === 'insert-text' && textarea && insertFn) {
        var text = (binding.args && binding.args.text) || '';
        insertFn(textarea, { snippet: text });
        return true;
      }

      if (binding.action === 'insert-formatting' && textarea && insertFn) {
        var args = binding.args || {};
        insertFn(textarea, args);
        return true;
      }

      // Dispatch via ActionRegistry for all other actions
      if (window.LexeraActionRegistry) {
        var scope = binding.when === 'card-focus' ? 'card' : 'board';
        return window.LexeraActionRegistry.dispatch(scope, binding.action, binding.args || {});
      }
      return false;
    },

    /// Get all user-defined bindings (for help overlay).
    getUserBindings: function () {
      return userBindings.slice();
    },

    /// Format a key combo for display (platform-aware).
    formatKeyDisplay: function (keyStr) {
      var parts = keyStr.split('+');
      var display = [];
      for (var i = 0; i < parts.length; i++) {
        var p = parts[i].trim().toLowerCase();
        if (p === 'meta' || p === 'cmd' || p === 'command') {
          display.push(isMac ? '\u2318' : 'Ctrl');
        } else if (p === 'ctrl' || p === 'control') {
          display.push(isMac ? '\u2303' : 'Ctrl');
        } else if (p === 'shift') {
          display.push(isMac ? '\u21E7' : 'Shift');
        } else if (p === 'alt' || p === 'option') {
          display.push(isMac ? '\u2325' : 'Alt');
        } else {
          display.push(p.charAt(0).toUpperCase() + p.slice(1));
        }
      }
      return display.join(isMac ? '' : '+');
    },

    /// Set the config path for saving
    setConfigPath: function (path) { configPath = path; },
    getConfigPath: function () { return configPath; },

    isLoaded: function () { return loaded; }
  };

  window.LexeraKeybindingRegistry = KeybindingRegistry;
})();
