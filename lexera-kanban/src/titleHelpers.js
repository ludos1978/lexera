/**
 * LexeraTitleHelpers — Shared HTML-comment title helpers.
 *
 * Canonical implementations of stripHtmlComments, extractHtmlComments,
 * and rebuildTitleWithPreservedComments. Other modules delegate here.
 *
 * IIFE module — no const/let, no ES imports.
 */
(function () {
  'use strict';

  function extractHtmlComments(text) {
    var matches = String(text || '').match(/<!--[\s\S]*?-->/g);
    return matches ? matches.slice() : [];
  }

  function stripHtmlComments(text) {
    return String(text || '')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n[ \t]+/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function rebuildTitleWithPreservedComments(userInput, originalTitle) {
    var cleanTitle = stripHtmlComments(userInput);
    var comments = extractHtmlComments(originalTitle);
    if (comments.length === 0) return cleanTitle;
    return ((cleanTitle ? cleanTitle + ' ' : '') + comments.join(' ')).trim();
  }

  // Canonical board-label resolver. Used by boardHeader (the in-board
  // pane title), workspaceShell (tab headers), and the workspaces /
  // hierarchy sub-apps so a single piece of logic decides what users
  // see — no priority-chain drift between surfaces.
  //
  // Priority: parsed `title` (markdown H1, set by lexera-core's
  // `build_board_summary` from `KanbanBoard.title`) → filename
  // basename without `.md` (recovers a useful label when the file
  // has no H1) → legacy `name` field → `'Untitled'`. Both `filePath`
  // (camelCase per Rust serde rename) and `file_path` (legacy
  // snake_case payloads) are accepted.
  function basenameWithoutMd(filePath) {
    var raw = String(filePath || '').trim();
    if (!raw) return '';
    var stripped = raw.split(/[\\/]/).filter(Boolean).pop() || '';
    return stripped.replace(/\.md$/i, '');
  }
  function resolveBoardLabel(meta) {
    if (!meta) return 'Untitled';
    var title = String(meta.title || '').trim();
    if (title) return title;
    var fileName = basenameWithoutMd(meta.filePath || meta.file_path || '');
    if (fileName) return fileName;
    var name = String(meta.name || '').trim();
    if (name) return name;
    return 'Untitled';
  }

  var api = {
    extractHtmlComments: extractHtmlComments,
    stripHtmlComments: stripHtmlComments,
    rebuildTitleWithPreservedComments: rebuildTitleWithPreservedComments,
    resolveBoardLabel: resolveBoardLabel,
    basenameWithoutMd: basenameWithoutMd
  };

  // Register on every available global. Browsers see the same `api` via
  // `window`, IIFE-loader test sandboxes see it via the `window` argument
  // they passed in (which differs from Node's actual `globalThis`), and
  // CommonJS-style consumers can still pull it off `globalThis`.
  if (typeof window !== 'undefined') window.LexeraTitleHelpers = api;
  if (typeof globalThis !== 'undefined') globalThis.LexeraTitleHelpers = api;
  if (typeof self !== 'undefined') self.LexeraTitleHelpers = api;

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
})();
