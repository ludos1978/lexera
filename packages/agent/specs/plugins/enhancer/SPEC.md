# Content Enhancer Pipeline Specification

**Status**: Planned
**V2 Target**: `packages/lexera-kanban`
**V1 Reference**: `packages/lexera-kanban/src/app.js` (lines 21932-22270)
**Dependencies**: [Content Plugins](../content/SPEC.md), [Diagram Registry](../diagram/SPEC.md)

---

## Purpose

Replace the hardcoded sequential chain of content enhancers (`enhanceEmbeddedContent` → `enhanceFileLinks` → `enhanceIncludeDirectives` → `flushDiagramQueue`) with a declarative registry. Each enhancer registers a CSS selector and an enhance function; the pipeline runs them in priority order.

---

## UX Requirements

### Post-Render Enhancement
- After markdown is rendered to HTML, the pipeline runs all registered enhancers
- Each enhancer matches DOM elements by CSS selector and applies async transformations
- Enhancers run in priority order (lower number = earlier)
- Elements are marked after enhancement to prevent double-processing

### Extensibility
- Adding a new embed type or content enhancer = one `ContentEnhancerRegistry.register()` call
- No changes needed in the orchestrator function

---

## Architecture

### Enhancement Flow

```
renderCardContent() produces raw HTML
    |
    v
enhanceAllContent(root, context)
    |
    v
For each enhancer (sorted by priority):
    root.querySelectorAll(enhancer.selector)
        |
        v
    For each matched element:
        enhancer.enhance(element, context)
```

---

## Data Model

### ContentEnhancer

```typescript
interface ContentEnhancer {
  id: string;                              // unique identifier
  selector: string | null;                 // CSS selector to match elements (null = whole-root enhancer)
  priority: number;                        // execution order (lower = first)
  enhance(element: HTMLElement, context: EnhanceContext): void | Promise<void>;
}

interface EnhanceContext {
  boardId: string;
  renderState: object;
}
```

---

## Public API

```javascript
var ContentEnhancerRegistry = {
  register: function(enhancer)            // register an enhancer
  getAll: function()                      // all enhancers sorted by priority
  remove: function(id)                    // unregister by ID
};

function enhanceAllContent(root, context) // run all enhancers on a DOM subtree
```

---

## Built-in Enhancers

| ID | Selector | Priority | Current Function |
|----|----------|----------|-----------------|
| `external-embed` | `.external-embed-container:not([data-enhanced])` | 10 | `enhanceSingleExternalEmbedContainer` |
| `file-embed` | `.embed-container:not([data-enhanced])` | 20 | `enhanceSingleEmbedContainer` |
| `inline-file-embed` | `.inline-file-embed-container:not([data-enhanced])` | 30 | `enhanceSingleInlineFileEmbed` |
| `file-link` | `.markdown-file-link:not([data-enhanced])` | 40 | `enhanceSingleFileLink` |
| `column-include-badge` | `.column-include-badge:not([data-enhanced])` | 50 | `enhanceSingleColumnIncludeBadge` |
| `include-directive` | `.include-inline-container:not([data-enhanced])` | 60 | `enhanceSingleIncludeDirective` |
| `diagram-flush` | (null — whole-root) | 100 | `flushPendingDiagramQueues` |

---

## Key Behaviors

### Idempotency
- Each enhancer sets `data-enhanced="true"` on processed elements
- Selector includes `:not([data-enhanced])` to prevent double-processing
- Safe to call `enhanceAllContent()` multiple times on the same subtree

### Ordering
- Priority determines execution order
- Lower priority runs first so that early enhancers can produce DOM that later enhancers process
- Example: `include-directive` (60) may produce new `.embed-container` elements that `file-embed` (20) would catch on a re-run

### Whole-Root Enhancers
- Enhancers with `selector: null` receive the root element directly
- Used for non-DOM-query operations (e.g. flushing diagram queues)

---

## Integration Points

### Called By
- `renderCardContent()` → after HTML generation
- `enhanceSingleIncludeDirective()` → recursive call on included content
- `enhanceSingleInlineFileEmbed()` → recursive call on embedded content

### Calls
- Backend API → file metadata, rendered previews
- DiagramRegistry → `flushDiagramQueue()`
- FileFormatRegistry → preview kind detection

---

## Migration Notes

### Keep Same
- Individual enhancer logic (each `enhanceSingle*` function body stays the same)
- `:not([data-enhanced])` idempotency guard
- Recursive enhancement for includes and inline embeds

### Change
- Replace hardcoded `enhanceEmbeddedContent()` sequential chain with registry loop
- Each `enhanceSingle*` function becomes the `enhance` callback of a registration

### Remove
- `enhanceEmbeddedContent()` function (replaced by `enhanceAllContent()`)
- `enhanceFileLinks()` wrapper (inlined into registration)
- `enhanceIncludeDirectives()` wrapper (inlined into registration)
- `enhanceColumnIncludeBadges()` wrapper (inlined into registration)

### Estimated Change
- Remove ~200 lines of orchestration wrappers from app.js
- Add ~100 lines (40 registry + 60 registration calls)
