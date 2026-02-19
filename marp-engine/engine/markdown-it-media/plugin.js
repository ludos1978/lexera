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

  // Core rule: unwrap paragraphs that contain only media (video/audio) tokens.
  // Video/audio renderers output block-level elements, but markdown-it wraps
  // inline content in <p> tags. The browser can't nest block elements inside <p>,
  // so it auto-closes the <p> creating empty <p></p> artifacts.
  // Using token.hidden is the standard markdown-it mechanism (same as tight list paragraphs).
  md.core.ruler.after('inline', 'media_paragraph_unwrap', function(state) {
    const tokens = state.tokens;
    for (let i = 1; i < tokens.length - 1; i++) {
      if (tokens[i].type !== 'inline') continue;
      if (tokens[i - 1].type !== 'paragraph_open') continue;
      if (tokens[i + 1].type !== 'paragraph_close') continue;

      const children = tokens[i].children;
      if (!children || children.length === 0) continue;

      // Check if all children are media tokens or softbreaks (line breaks between media)
      const isMediaOnly = children.every(function(child) {
        return child.type === 'video' ||
               child.type === 'audio' ||
               child.type === 'softbreak';
      });

      if (isMediaOnly) {
        tokens[i - 1].hidden = true;
        tokens[i + 1].hidden = true;
        // Mark softbreaks between media tokens so they don't render as <br>
        for (let j = 0; j < children.length; j++) {
          if (children[j].type === 'softbreak') {
            children[j]._mediaBreak = true;
          }
        }
      }
    }
  });
}

module.exports = { markdownItMedia };
module.exports.default = markdownItMedia;
