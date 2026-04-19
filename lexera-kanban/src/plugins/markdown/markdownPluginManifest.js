(function () {
  if (typeof LexeraPluginRegistry === 'undefined') return;

  // ── shared helpers ─────────────────────────────────────────────
  function resolveTagColors() {
    var root = typeof window !== 'undefined' ? window : {};
    if (root.LexeraTagColors && typeof root.LexeraTagColors.getColors === 'function') {
      try { return root.LexeraTagColors.getColors() || {}; } catch (e) { return {}; }
    }
    return root.tagColors || {};
  }

  // ── manifest entries ──────────────────────────────────────────
  // Each entry describes one markdown-it plugin. `apply(md, ctx)` is called by
  // markdownRenderer.buildInstance() when building a new md instance. Entries
  // are sorted ascending by priority (lower loads first), matching v1.
  //
  // `scope`:
  //   - 'frontend' — only applied in the card-render path (not export)
  //   - 'export'   — only applied in the export pipeline
  //   - 'both'     — applied in both
  //
  // Apply functions read their vendor global lazily so the manifest stays
  // resilient to load order — missing globals silently skip the plugin.
  var entries = [
    {
      id: 'wiki-links', name: 'Wiki Links', priority: 10,
      apply: function (md) {
        if (typeof window.markdownitWikiLinks === 'function') {
          md.use(window.markdownitWikiLinks, { className: 'wiki-link' });
        }
      }
    },
    {
      id: 'tag', name: 'Tag', priority: 20,
      apply: function (md) {
        if (typeof window.markdownitTag === 'function') {
          md.use(window.markdownitTag, { tagColors: resolveTagColors() });
        }
      }
    },
    {
      id: 'task-checkbox', name: 'Task Checkbox', priority: 30,
      apply: function (md) {
        if (typeof window.markdownitTaskCheckbox === 'function') md.use(window.markdownitTaskCheckbox);
      }
    },
    {
      id: 'date-person-tag', name: 'Date / Person Tag', priority: 40,
      apply: function (md) {
        if (typeof window.markdownitDatePersonTag === 'function') md.use(window.markdownitDatePersonTag);
      }
    },
    {
      id: 'temporal-tag', name: 'Temporal Tag', priority: 50,
      apply: function (md) {
        if (typeof window.markdownitTemporalTag === 'function') md.use(window.markdownitTemporalTag);
      }
    },
    {
      id: 'enhanced-strikethrough', name: 'Enhanced Strikethrough', priority: 60,
      apply: function (md) {
        if (typeof window.markdownitEnhancedStrikethrough === 'function') md.use(window.markdownitEnhancedStrikethrough);
      }
    },
    {
      id: 'speaker-note', name: 'Speaker Note', priority: 70,
      apply: function (md) {
        if (typeof window.markdownitSpeakerNote === 'function') md.use(window.markdownitSpeakerNote);
      }
    },
    {
      id: 'html-comment', name: 'HTML Comment', priority: 80,
      apply: function (md, ctx) {
        if (typeof window.markdownitHtmlComment === 'function') {
          md.use(window.markdownitHtmlComment, {
            commentMode: ctx.htmlCommentMode,
            contentMode: ctx.htmlContentMode
          });
        }
      }
    },
    {
      id: 'emoji', name: 'Emoji', priority: 90,
      apply: function (md) {
        if (window.markdownitEmoji) {
          var plugin = window.markdownitEmoji.full || window.markdownitEmoji.light || window.markdownitEmoji;
          md.use(plugin);
        }
      }
    },
    {
      id: 'footnote', name: 'Footnote', priority: 100,
      apply: function (md) {
        if (typeof window.markdownitFootnote === 'function') md.use(window.markdownitFootnote);
      }
    },
    {
      id: 'multicolumn', name: 'Multicolumn', priority: 110,
      apply: function (md) {
        if (typeof window.markdownItMulticolumn === 'function') md.use(window.markdownItMulticolumn);
      }
    },
    {
      id: 'mark', name: 'Mark', priority: 120,
      apply: function (md) {
        if (typeof window.markdownitMark === 'function') md.use(window.markdownitMark);
      }
    },
    {
      id: 'sub', name: 'Sub', priority: 130,
      apply: function (md) {
        if (typeof window.markdownitSub === 'function') md.use(window.markdownitSub);
      }
    },
    {
      id: 'sup', name: 'Sup', priority: 140,
      apply: function (md) {
        if (typeof window.markdownitSup === 'function') md.use(window.markdownitSup);
      }
    },
    {
      id: 'ins', name: 'Insert', priority: 150,
      apply: function (md) {
        if (typeof window.markdownitIns === 'function') md.use(window.markdownitIns);
      }
    },
    {
      id: 'strikethrough-alt', name: 'Alternate Strikethrough', priority: 160,
      apply: function (md) {
        if (typeof window.markdownitStrikethroughAlt === 'function') md.use(window.markdownitStrikethroughAlt);
      }
    },
    {
      id: 'underline', name: 'Underline', priority: 170,
      apply: function (md) {
        if (typeof window.markdownitUnderline === 'function') md.use(window.markdownitUnderline);
      }
    },
    {
      id: 'abbr', name: 'Abbreviation', priority: 180,
      apply: function (md) {
        if (typeof window.markdownitAbbr === 'function') md.use(window.markdownitAbbr);
      }
    },
    {
      id: 'container', name: 'Container', priority: 190,
      apply: function (md) {
        if (typeof window.markdownitContainer !== 'function') return;
        var names = [
          'note', 'comment', 'highlight',
          'mark-red', 'mark-green', 'mark-blue', 'mark-cyan', 'mark-magenta', 'mark-yellow',
          'center', 'center100', 'right', 'caption'
        ];
        for (var i = 0; i < names.length; i++) md.use(window.markdownitContainer, names[i]);
      }
    },
    {
      id: 'image-figures', name: 'Image Figures', priority: 200,
      apply: function (md) {
        if (typeof window.markdownItImageFigures === 'function') {
          md.use(window.markdownItImageFigures, { figcaption: 'title' });
        }
      }
    },
    {
      id: 'image-attrs', name: 'Image Attributes', priority: 210,
      apply: function (md) {
        if (typeof window.markdownItImageAttrs === 'function') md.use(window.markdownItImageAttrs);
      }
    },
    {
      id: 'table-widths', name: 'Table Widths', priority: 220,
      apply: function (md) {
        if (typeof window.markdownitTableWidths === 'function') md.use(window.markdownitTableWidths);
      }
    },
    {
      id: 'list-split', name: 'List Split', priority: 230,
      apply: function (md) {
        if (typeof window.markdownitListSplit === 'function') md.use(window.markdownitListSplit);
      }
    }
  ];

  for (var i = 0; i < entries.length; i++) {
    var e = entries[i];
    LexeraPluginRegistry.register({
      kind: 'markdown',
      metadata: { id: e.id, name: e.name, version: '1.0.0', priority: e.priority },
      scope: e.scope || 'both',
      apply: e.apply
    });
  }
})();
