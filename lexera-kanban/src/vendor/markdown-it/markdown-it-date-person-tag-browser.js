(function() { 'use strict';

/**
 * DEPRECATED: This plugin is kept for backwards compatibility only.
 *
 * NEW TAG SYSTEM:
 * - # prefix: tags AND people (people are just tags) - handled by markdown-it-tag-browser.js
 * - @ prefix: all temporal (dates, times, weeks) - handled by markdown-it-temporal-tag-browser.js
 *
 * The old @person syntax is now #person (handled by the tag plugin).
 * The old @date syntax is now handled by the temporal plugin.
 *
 * This plugin may be removed in a future version.
 */
window.markdownitDatePersonTag = function(md, options) {
    // This plugin is deprecated - temporal (@) is now handled by the temporal plugin
    // and people are now # tags handled by the tag plugin.
    // Keeping this as a no-op for backwards compatibility during transition.
    console.warn('[markdown-it-date-person-tag] This plugin is deprecated. Use temporal plugin for @ dates and tag plugin for # people.');
};

})();
