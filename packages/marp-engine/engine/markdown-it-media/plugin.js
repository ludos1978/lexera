/**
 * @typedef {Record<string, string>} AttrsOption
 * @typedef {object} PluginOptions
 * @property {boolean} [controls=false]
 * @property {object} [attrs]
 * @property {AttrsOption} [attrs.image]
 * @property {AttrsOption} [attrs.audio]
 * @property {AttrsOption} [attrs.video]
 * @typedef {import("markdown-it").PluginWithOptions<PluginOptions>} Plugin
 */

const { createMediaRule } = require("./ruler.js");
const { renderMedia } = require("./render.js");

/** @type {Plugin} */
function markdownItMedia(md, options) {
  md.inline.ruler.before("image", "media", createMediaRule(options));
  // md.inline.ruler.disable("image");

	// old working version
//	md.inline.ruler.after("image", "media", createMediaRule(options));

  md.renderer.rules.audio = renderMedia;
  md.renderer.rules.video = renderMedia;

  // Core rule: unwrap paragraphs containing media (video/audio) tokens.
  // Video/audio renderers output block-level elements, but markdown-it wraps
  // inline content in <p> tags. The browser can't nest block elements inside <p>,
  // so it auto-closes the <p> creating empty <p></p> artifacts.
  // Using token.hidden is the standard markdown-it mechanism (same as tight list paragraphs).
  //
  // Handles three cases:
  // 1. Pure media paragraph (only video/audio + softbreaks) → hide <p> wrapper
  // 2. Mixed paragraph (media + other inline content) → split into separate groups
  // 3. No media → leave unchanged
  md.core.ruler.after('inline', 'media_paragraph_unwrap', function(state) {
    var Token = state.Token;
    var tokens = state.tokens;
    var output = [];

    for (var i = 0; i < tokens.length; i++) {
      // Only process paragraph_open + inline + paragraph_close triplets
      if (i + 2 >= tokens.length ||
          tokens[i].type !== 'paragraph_open' ||
          tokens[i + 1].type !== 'inline' ||
          tokens[i + 2].type !== 'paragraph_close') {
        output.push(tokens[i]);
        continue;
      }

      var pOpen = tokens[i];
      var inline = tokens[i + 1];
      var pClose = tokens[i + 2];
      var children = inline.children || [];

      // Check if any media tokens exist
      var hasMedia = children.some(function(c) {
        return c.type === 'video' || c.type === 'audio';
      });

      if (!hasMedia) {
        // No media at all — keep as-is
        output.push(pOpen, inline, pClose);
        i += 2;
        continue;
      }

      // Check if ALL non-softbreak tokens are media
      var isAllMedia = children.every(function(c) {
        return c.type === 'video' || c.type === 'audio' || c.type === 'softbreak';
      });

      if (isAllMedia) {
        // Pure media paragraph — just hide the <p> wrapper
        pOpen.hidden = true;
        pClose.hidden = true;
        for (var j = 0; j < children.length; j++) {
          if (children[j].type === 'softbreak') {
            children[j]._mediaBreak = true;
          }
        }
        output.push(pOpen, inline, pClose);
        i += 2;
        continue;
      }

      // Mixed paragraph — split children into media and non-media groups.
      // Each media group gets a hidden paragraph (no <p> wrapper).
      // Each non-media group gets a normal paragraph.
      // Softbreaks at group boundaries are consumed.
      var groups = _splitMediaGroups(children);

      for (var g = 0; g < groups.length; g++) {
        var group = groups[g];

        var gOpen = new Token('paragraph_open', 'p', 1);
        gOpen.map = pOpen.map;
        gOpen.level = pOpen.level;
        if (group.isMedia) { gOpen.hidden = true; }

        var gInline = new Token('inline', '', 0);
        gInline.children = group.children;
        gInline.content = '';
        gInline.level = inline.level;
        gInline.map = inline.map;

        var gClose = new Token('paragraph_close', 'p', -1);
        gClose.level = pClose.level;
        if (group.isMedia) { gClose.hidden = true; }

        output.push(gOpen, gInline, gClose);
      }

      i += 2;
    }

    state.tokens = output;
  });
}

/**
 * Split inline children into groups of consecutive media vs non-media tokens.
 * Softbreaks at group boundaries are consumed (not included in either group).
 * Softbreaks within media groups are marked with _mediaBreak = true.
 */
function _splitMediaGroups(children) {
  var groups = [];
  var current = null;

  for (var i = 0; i < children.length; i++) {
    var child = children[i];
    var isMedia = child.type === 'video' || child.type === 'audio';
    var isSoftbreak = child.type === 'softbreak';

    if (isSoftbreak) {
      if (!current) { continue; } // skip leading softbreak

      // Peek ahead to see if group type is changing
      var nextChild = i + 1 < children.length ? children[i + 1] : null;
      var nextIsMedia = nextChild && (nextChild.type === 'video' || nextChild.type === 'audio');

      if (nextChild && current.isMedia !== nextIsMedia) {
        // Group boundary — consume softbreak, close current group
        groups.push(current);
        current = null;
        continue;
      }

      // Same type on both sides — keep softbreak in current group
      if (current.isMedia) { child._mediaBreak = true; }
      current.children.push(child);
      continue;
    }

    // Non-softbreak token: start new group if type differs
    if (!current || current.isMedia !== isMedia) {
      if (current) { groups.push(current); }
      current = { isMedia: isMedia, children: [] };
    }
    current.children.push(child);
  }

  if (current && current.children.length > 0) {
    groups.push(current);
  }

  return groups;
}

module.exports = { markdownItMedia };
module.exports.default = markdownItMedia;
