# Markdown Renderer Specification

**Status**: ✅ Baseline  
**V2 Target**: `lexera-kanban` (rendering), `lexera-core` (transforms)  
**V1 Reference**: `src/html/markdownRenderer.js` (~3,806 lines)  
**Dependencies**: markdown-it, 20+ markdown-it plugins, Mermaid, PlantUML, [Content Plugins](../plugins/content/SPEC.md)

---

## UX Requirements

### Basic Markdown
- User writes markdown in card content
- System renders to HTML with proper formatting
- Supports: headers, lists, links, images, code blocks, tables

### Extended Markdown
- User uses extended syntax (strikethrough, mark, subscript, etc.)
- System renders with markdown-it plugins
- All 20+ plugins work together

### Media Handling
- User includes images, videos, audio in markdown
- System resolves paths relative to include context
- Broken media shows placeholder with menu
- Large media shows loading indicator

### Diagrams
- User writes code fences with language (mermaid, plantuml)
- System renders diagrams asynchronously
- Diagrams cached for performance
- Backend rendering for complex diagrams

### Embeds
- User includes YouTube, Vimeo, other embed URLs
- System does not load the page immediately
- System probes remote headers first and then shows an explicit action button
- If embedding is allowed, user gets `Open page`
- If embedding is blocked or uncertain, user gets `Open in browser`

---

## Architecture

### Caching Strategy

```
┌─────────────────────────────────────────────────────────────────┐
│                    MARKDOWN RENDERER CACHE                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ┌──────────────────────────────────────────────────────────┐  │
│   │  Cached markdown-it Instance                              │  │
│   │                                                            │  │
│   │  - Created once, reused for all renders                   │  │
│   │  - Recreated only when settings change                    │  │
│   │  - ~3-5ms saved per render (significant for 400+ cards)   │  │
│   └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│   ┌──────────────────────────────────────────────────────────┐  │
│   │  Diagram Cache (LRU, max 100 items)                       │  │
│   │                                                            │  │
│   │  Key: filePath + diagramType + includeDir + subKey        │  │
│   │  Value: { mtime, imageDataUrl }                           │  │
│   └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│   ┌──────────────────────────────────────────────────────────┐  │
│   │  External Embed Policy Cache (global persistent file)     │  │
│   │                                                            │  │
│   │  Stores embed-policy probe results by parent-origin+URL   │  │
│   │  Shared across sessions to avoid repeated header probes   │  │
│   └──────────────────────────────────────────────────────────┘  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Render Flow

```
renderMarkdown(text, includeContext)
         │
         ▼
┌──────────────────┐
│ Store context    │  window.currentTaskIncludeContext
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ Get/create       │  Check cache, recreate if needed
│ markdown-it      │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ md.render()      │  Custom renderers intercept:
│                  │  - image/video/audio → resolvePath()
│                  │  - fence → diagram handling
│                  │  - embed → placeholder shell
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ Post-process     │  splitTaggedParagraphs()
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ Queue async      │  processPlantUMLQueue()
│ renders          │  processDiagramQueue()
└────────┬─────────┘
         │
         ▼
   HTML string
```

---

## Functions

### Main Entry Point
```javascript
function renderMarkdown(text, includeContext)
```

### Markdown-it Setup
```javascript
function createMarkdownItInstance(htmlCommentRenderMode, htmlContentRenderMode, enableTypographer)
function addDiagramFenceRenderer(md)
```

### Path Resolution
```javascript
function resolveRelativePath(baseDir, relativePath)
function buildWebviewResourceUrl(pathValue, encodeSegments)
function normalizeWindowsAbsolutePath(pathValue, shouldDecode)
function safeDecodePath(value)
```

### Media Handling
```javascript
function createBrokenMediaPlaceholder(path, emoji, titleText, displayText, existingContainer, mediaType)
function createLoadingPlaceholder(id, className, message)
window._handleMediaError = function(mediaEl, path, mediaType)
```

### Diagram Rendering
```javascript
function queueDiagramRender(id, filePath, diagramType, includeDir)
function queueMermaidRender(id, code)
function queuePlantUMLRender(id, code)
function queuePDFPageRender(id, filePath, pageNumber, includeDir)
function queueXlsxRender(id, filePath, sheetNumber, includeDir)
```

### Cache Management
```javascript
function getRenderedDiagramCache(filePath, diagramType, includeDir, subKey)
function setRenderedDiagramCache(filePath, diagramType, includeDir, subKey, mtime, imageDataUrl)
function invalidateDiagramCache(filePath, diagramType)
function clearDiagramCache()
```

### Embed Handling
```javascript
function isKnownEmbedUrl(url)
function detectEmbed(src, alt, title, token)
function renderEmbed(embedInfo, originalSrc, alt, title)
function renderWebPreview(url, alt, title)
function enhanceSingleExternalEmbedContainer(container, options)
function requestExternalEmbedPolicy(url, options)
function openExternalEmbedInPlace(container)
```

Embed policy probing is backend-driven and uses the response headers from the target site. The markdown renderer must not trust prior inline metadata or session-only iframe failures.

---

## Markdown-it Plugins (20+)

| Plugin | Purpose |
|--------|---------|
| `markdown-it-temporal-tag` | `@date` highlighting |
| `markdown-it-image-attrs` | `{width=100}` image sizing |
| `markdown-it-wiki-links` | `[[link]]` syntax |
| `markdown-it-tag` | `#tag` styling |
| `markdown-it-task-checkbox` | `[ ]` / `[x]` checkboxes |
| `markdown-it-strikethrough` | `~~strikethrough~~` |
| `markdown-it-mark` | `==marked==` |
| `markdown-it-sub` | `H~2~O` subscript |
| `markdown-it-sup` | `29^th^` superscript |
| `markdown-it-underline` | `_underline_` |
| `markdown-it-container` | `:::note` blocks |

---

## Media Error Handling

```html
<!-- Broken media placeholder -->
<span class="image-path-overlay-container image-broken" data-file-path="/path/to/image.png">
  <span class="image-not-found">
    <span class="image-not-found-text">📷 image.png</span>
    <button class="image-menu-btn" onclick="toggleMediaNotFoundMenu(...)">☰</button>
  </span>
</span>
```

---

## Iframe Fallback

```html
<!-- When site blocks iframe -->
<div class="web-preview-fallback">
  <span class="web-preview-fallback-icon">⚠️</span>
  <span class="web-preview-fallback-text">
    Cannot display preview — this site doesn't allow iframe embedding
  </span>
  <a class="web-preview-fallback-link" href="..." target="_blank">
    Open in browser
  </a>
</div>
```

---

## Settings

| Setting | Values | Default |
|---------|--------|---------|
| `htmlCommentRenderMode` | `hidden`, `visible`, `block` | `hidden` |
| `htmlContentRenderMode` | `html`, `escaped` | `html` |
| `enableTypographer` | `true`, `false` | `false` |

---

## Migration Notes for V2

### Keep Same
- Caching strategy
- Plugin architecture
- Media error handling

### Improve
- Lazy load Mermaid
- Web Workers for diagrams
- Better cache invalidation

### Modularize
- `markdownCore.js` - Basic rendering
- `mediaHandler.js` - Media handling
- `diagramRenderer.js` - Diagrams
- `embedHandler.js` - Embeds
