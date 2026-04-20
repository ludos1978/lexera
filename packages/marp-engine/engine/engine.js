// engine.js
const mdItContainer = require("markdown-it-container");

// ============================================
// YAML Stripping Include Plugin
// ============================================
// Pre-processes !!!include(path)!!! to strip YAML frontmatter from included files
// This MUST run BEFORE markdown-it-include to prevent YAML from breaking slide parsing
// Issue: When included files have YAML headers (---\nmarp: true\n---), the --- lines
// are interpreted as slide separators, causing only YAML to show up as a "slide"
const fs = require('fs');
const path = require('path');

const yamlStrippingIncludePlugin = (md, options = {}) => {
  const originalParse = md.parse.bind(md);

  md.parse = (src, env) => {
    // Process !!!include(path)!!! patterns and strip YAML from included content
    const includePattern = /!!!include\(([^)]+)\)!!!/g;
    const processedIncludes = new Set();

    // Get the root directory for resolving paths
    // Use env.root if available, otherwise use current working directory
    const rootDir = (env && env.root) || process.cwd();

    // Recursively process includes
    const processIncludes = (content, currentDir) => {
      return content.replace(includePattern, (match, includePath) => {
        // Trim whitespace and decode URI components
        includePath = includePath.trim();
        try {
          includePath = decodeURIComponent(includePath);
        } catch (e) {
          // If decode fails, use as-is
        }

        // Resolve path relative to current file's directory
        let resolvedPath;
        if (path.isAbsolute(includePath)) {
          resolvedPath = includePath;
        } else {
          resolvedPath = path.resolve(currentDir, includePath);
        }

        // Fallback: if the absolute path doesn't exist (common when a board
        // was authored in another repo and later copied/renamed, leaving
        // hard-coded paths that no longer match), try progressively shorter
        // trailing segments of the include path joined onto currentDir. The
        // first match wins. E.g. includePath=/OLD/tests/kanban/foo.md
        // + currentDir=/NEW/tests/kanban  →  /NEW/tests/kanban/foo.md via
        // the trailing "foo.md" fallback.
        if (!fs.existsSync(resolvedPath) && path.isAbsolute(includePath)) {
          const segments = includePath.split(path.sep).filter(Boolean);
          for (let s = segments.length; s >= 1; s--) {
            const suffix = segments.slice(segments.length - s).join(path.sep);
            const candidate = path.resolve(currentDir, suffix);
            if (fs.existsSync(candidate)) {
              console.warn(`[Engine] Include path rescued: ${includePath} → ${candidate}`);
              resolvedPath = candidate;
              break;
            }
          }
        }

        // Check for circular includes. Replace with a comment so the next
        // plugin (markdown-it-include) doesn't re-trigger the include.
        if (processedIncludes.has(resolvedPath)) {
          console.warn(`[Engine] Circular include detected: ${resolvedPath}`);
          return `<!-- lexera-include-circular: ${resolvedPath.replace(/-->/g, '--&gt;')} -->`;
        }

        // Check if file exists. If not, replace the include syntax with an
        // HTML comment so markdown-it-include (registered later in the
        // plugin chain) never sees it — otherwise it throws a hard error
        // that aborts the whole Marp render.
        if (!fs.existsSync(resolvedPath)) {
          console.warn(`[Engine] Include file not found: ${resolvedPath}`);
          return `<!-- lexera-include-missing: ${resolvedPath.replace(/-->/g, '--&gt;')} -->`;
        }

        processedIncludes.add(resolvedPath);

        try {
          let fileContent = fs.readFileSync(resolvedPath, 'utf8');

          // Strip YAML frontmatter if present
          // Match: ---\n ... \n---\n at the start of the file
          // Allow trailing spaces/tabs after --- (common from editors)
          const yamlMatch = fileContent.match(/^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n/);
          if (yamlMatch) {
            fileContent = fileContent.substring(yamlMatch[0].length);
          }

          // Recursively process nested includes in the included file
          const includeDir = path.dirname(resolvedPath);
          fileContent = processIncludes(fileContent, includeDir);

          return fileContent;
        } catch (err) {
          console.error(`[Engine] Error reading include file ${resolvedPath}:`, err);
          // Replace with a comment so markdown-it-include can't re-throw.
          const safePath = resolvedPath.replace(/-->/g, '--&gt;');
          const safeErr = String(err && err.message ? err.message : err).replace(/-->/g, '--&gt;');
          return `<!-- lexera-include-error: ${safePath} (${safeErr}) -->`;
        }
      });
    };

    // Process the source content
    const processedSrc = processIncludes(src, rootDir);

    return originalParse(processedSrc, env);
  };
};

// ============================================
// Speaker Note Plugin: Convert ;; to <!-- -->
// ============================================
// Converts lines starting with ;; to HTML comments (speaker notes)
// Consecutive ;; lines are grouped into a single comment
const speakerNotePlugin = (md) => {
  const originalParse = md.parse.bind(md);
  md.parse = (src, env) => {
    // Convert ;; lines to <!-- --> before parsing
    const lines = src.split('\n');
    const result = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];
      const trimmed = line.trim();

      if (trimmed.startsWith(';;')) {
        // Collect consecutive ;; lines
        const noteLines = [];
        const indent = line.match(/^(\s*)/)?.[1] || '';

        while (i < lines.length && lines[i].trim().startsWith(';;')) {
          const noteContent = lines[i].trim().substring(2).trim();
          noteLines.push(noteContent);
          i++;
        }

        // Convert to HTML comment (Marp speaker note)
        const combinedContent = noteLines.join('\n');
        result.push(`${indent}<!--\n${combinedContent}\n-->`);
      } else {
        result.push(line);
        i++;
      }
    }

    return originalParse(result.join('\n'), env);
  };
};

const handout = require('./handout-shared');

const wrapRenderForHandout = (marp) => {
  const originalRender = marp.render.bind(marp);

  marp.render = (markdown, options = {}) => {
    const renderOptions = {
      ...options,
      htmlAsArray: process.env.MARP_HANDOUT === 'true' ? true : options.htmlAsArray
    };

    const result = originalRender(markdown, renderOptions);

    if (process.env.MARP_HANDOUT === 'true') {
      console.log('[Engine] Handout mode enabled, transforming output...');
      const opts = handout.getOptionsFromEnv();
      const { html, css, comments } = result;
      const slides = Array.isArray(html) ? html : [html];

      console.log(`[Handout] Transforming ${slides.length} slides to handout format (${opts.layout})`);

      const pages = handout.buildHandoutPages(slides, comments || [], opts);
      const fullHTML = handout.wrapInDocument(pages, css, opts);

      return {
        html: fullHTML,
        css: css + handout.getHandoutStyles(opts),
        comments
      };
    }

    return result;
  };

  return marp;
};

// create fragmented list using the '+' character
// + list
// + otheritem
// ---
const fragmentedListMarkupsPlus = ['+']
function _fragment_plus(md) {
  // Fragmented list
  md.core.ruler.after('marpit_directives_parse', 'marpit_fragment', (state) => {
    if (state.inlineMode) return
 
    for (const token of state.tokens) {
      if (
        token.type === 'list_item_open' &&
        fragmentedListMarkupsPlus.includes(token.markup)
      ) {
        token.meta = token.meta || {}
        token.meta.marpitFragment = true

        token.attrSet('style', 'marpit-fragments-plus')
      }
    }
  })
 
  // Add data-marpit-fragment(s) attributes to token
  md.core.ruler.after('marpit_fragment', 'marpit_apply_fragment', (state) => {
    if (state.inlineMode) return

    const fragments = { slide: undefined, count: 0 }

    for (const token of state.tokens) {
      if (token.meta && token.meta.marpitSlideElement === 1) {
        fragments.slide = token
        fragments.count = 0
      } else if (token.meta && token.meta.marpitSlideElement === -1) {
        if (fragments.slide && fragments.count > 0) {
          fragments.slide.attrSet('data-marpit-fragments', fragments.count)
        }
      } else if (token.meta && token.meta.marpitFragment) {
        fragments.count += 1
 
        token.meta.marpitFragment = fragments.count
        token.attrSet('data-marpit-fragment', fragments.count)
      }
    }
  })
}
// ---


/**
 * Custom image caption plugin
 * Wraps images with title attribute in <figure> with <figcaption>
 * Works in ALL contexts including multicolumn blocks (unlike markdown-it-image-figures)
 */
const _customImageCaption = (md) => {
  // Store the default image renderer (or create a fallback)
  const defaultRender = md.renderer.rules.image || function(tokens, idx, options, env, self) {
    return self.renderToken(tokens, idx, options);
  };

  md.renderer.rules.image = function (tokens, idx, options, env, self) {
    const token = tokens[idx];

    // Get the title attribute
    const titleAttr = token.attrGet('title');

    // Render the image using the default renderer
    const imgHtml = defaultRender(tokens, idx, options, env, self);

    // If there's a title, wrap in figure with figcaption
    if (titleAttr) {
      // Escape HTML entities in the title to prevent XSS
      const escapedTitle = titleAttr
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
      return `<figure class="media-figure">${imgHtml}<figcaption>${escapedTitle}</figcaption></figure>`;
    }

    return imgHtml;
  };
};

module.exports = ({ marp }) => {
  marp.use(speakerNotePlugin);
  marp.use(yamlStrippingIncludePlugin);

  marp
    .use(require("markdown-it-include"))
    .use(require("markdown-it-strikethrough-alt"))
    .use(require("markdown-it-underline"))
    .use(require("markdown-it-sub"))
    .use(require("markdown-it-sup"))
    .use(require("markdown-it-mark"))
    .use(require("markdown-it-ins"))
    .use(require("./markdown-it-media").default, {
      controls: true,
      attrs: { image: {}, audio: {}, video: {} }
    })
    .use(require("markdown-it-multicolumn").default)
    .use(require("markdown-it-abbr"))
    .use(require("markdown-it-footnote-here"))
    .use(mdItContainer, "note")
    .use(mdItContainer, "comment")
    .use(mdItContainer, "highlight")
    .use(mdItContainer, "mark-red")
    .use(mdItContainer, "mark-green")
    .use(mdItContainer, "mark-blue")
    .use(mdItContainer, "mark-cyan")
    .use(mdItContainer, "mark-magenta")
    .use(mdItContainer, "mark-yellow")
    .use(mdItContainer, "center")
    .use(mdItContainer, "center100")
    .use(mdItContainer, "right")
    .use(mdItContainer, "caption")
    .use(mdItContainer, "columns")
    .use(mdItContainer, "columns3")
    .use(mdItContainer, "small66")
    .use(mdItContainer, "small50")
    .use(mdItContainer, "small33")
    .use(mdItContainer, "small25")
    .use(require("markdown-it-anchor"), {
      permalink: false,
      permalinkBefore: true,
      permalinkSymbol: "§",
    })
    .use(require("markdown-it-toc-done-right"), {level: 1})
    .use(require('mermaid-it'))
    .use(_customImageCaption)
    .use(_fragment_plus)
    .use(require('markdown-it-checkboxes'))
    .use(require('markdown-it-deflist'))

  // Wrap render for handout support (triggered by MARP_HANDOUT env var)
  wrapRenderForHandout(marp);

  return marp;
};
