/**
 * Markdown renderer factory for lexera-kanban.
 *
 * Creates a configured markdown-it instance with all Lexera custom plugins:
 *   wiki-links, tag, task-checkbox, date-person-tag, temporal-tag,
 *   enhanced-strikethrough, speaker-note, html-comment,
 *   mark, sub, sup, ins, underline, strikethrough-alt, abbr,
 *   container (note, comment, highlight, mark-*, center, right, caption),
 *   image-figures, image-attrs, table-widths, multicolumn, list-split,
 *   emoji, footnote.
 *
 * Ported from _ARCHIVE/src/html/markdownRenderer.js:createMarkdownItInstance.
 *
 * Exposes window.LexeraMarkdownRenderer with:
 *   getInstance(options) -> markdown-it instance (cached by options fingerprint)
 *   render(content, options) -> HTML string
 *   renderInline(content, options) -> HTML string (no outer <p>)
 *   invalidate() -> clears the cached instance
 */
(function (root) {
    'use strict';

    var cachedInstance = null;
    var cachedFingerprint = null;

    function normalizeHtmlMode(value, fallback) {
        var v = String(value == null ? '' : value).trim().toLowerCase();
        if (v === 'keep' || v === 'remove') return v;
        return fallback;
    }

    function resolveTagColors() {
        if (root.LexeraTagColors && typeof root.LexeraTagColors.getColors === 'function') {
            try { return root.LexeraTagColors.getColors() || {}; } catch (e) { return {}; }
        }
        return root.tagColors || {};
    }

    function buildInstance(options) {
        var opts = options || {};
        var htmlCommentMode = normalizeHtmlMode(opts.htmlCommentMode, 'keep');
        var htmlContentMode = normalizeHtmlMode(opts.htmlContentMode, 'keep');
        var enableTypographer = !!opts.typographer;

        if (typeof root.markdownit !== 'function') {
            throw new Error('markdown-it core is not loaded');
        }

        var md = root.markdownit({
            html: true,
            linkify: false,
            typographer: enableTypographer,
            breaks: true
        });

        // Apply markdown-it plugins from the unified registry manifest.
        // Entries live in plugins/markdown/markdownPluginManifest.js and are
        // sorted ascending by priority (lower loads first).
        var scope = opts.scope || 'frontend';
        var ctx = {
            htmlCommentMode: htmlCommentMode,
            htmlContentMode: htmlContentMode,
            resolveTagColors: resolveTagColors
        };
        if (root.LexeraPluginRegistry) {
            var entries = root.LexeraPluginRegistry.getByKind('markdown');
            entries.sort(function (a, b) {
                var pa = (a.metadata && typeof a.metadata.priority === 'number') ? a.metadata.priority : 0;
                var pb = (b.metadata && typeof b.metadata.priority === 'number') ? b.metadata.priority : 0;
                return pa - pb;
            });
            for (var i = 0; i < entries.length; i++) {
                var entry = entries[i];
                if (entry.scope && entry.scope !== 'both' && entry.scope !== scope) continue;
                try {
                    entry.apply(md, ctx);
                } catch (err) {
                    if (root.console && root.console.error) {
                        root.console.error('[markdown plugin] ' + entry.metadata.id + ' failed:', err);
                    }
                }
            }
        }

        return md;
    }

    function fingerprint(options) {
        var opts = options || {};
        return [
            normalizeHtmlMode(opts.htmlCommentMode, 'keep'),
            normalizeHtmlMode(opts.htmlContentMode, 'keep'),
            opts.typographer ? '1' : '0'
        ].join('|');
    }

    function getInstance(options) {
        var fp = fingerprint(options);
        if (cachedInstance && cachedFingerprint === fp) return cachedInstance;
        cachedInstance = buildInstance(options);
        cachedFingerprint = fp;
        return cachedInstance;
    }

    function render(content, options) {
        var md = getInstance(options);
        return md.render(String(content == null ? '' : content));
    }

    function renderInline(content, options) {
        var md = getInstance(options);
        return md.renderInline(String(content == null ? '' : content));
    }

    function invalidate() {
        cachedInstance = null;
        cachedFingerprint = null;
    }

    function isReady() {
        return typeof root.markdownit === 'function';
    }

    root.LexeraMarkdownRenderer = {
        getInstance: getInstance,
        render: render,
        renderInline: renderInline,
        invalidate: invalidate,
        isReady: isReady
    };
}(typeof globalThis !== 'undefined' ? globalThis : this));
