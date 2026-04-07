# Diagram Renderer Registry Specification

**Status**: Planned
**V2 Target**: `lexera-kanban`
**V1 Reference**: `lexera-kanban/src/app.js` (lines 25170-25250, 573-578)
**Dependencies**: [Content Plugins](../content/SPEC.md), [Plugin Registry](../registry/SPEC.md)

---

## Purpose

Replace the hardcoded Mermaid and PlantUML rendering pipelines with a single diagram renderer registry. Each diagram type registers once; the markdown renderer, queue processor, and menu system all operate through the registry instead of per-type branches.

---

## UX Requirements

### Diagram Rendering
- User writes fenced code block with a language tag (e.g. `mermaid`, `plantuml`)
- Registry finds matching renderer and queues a render job
- Placeholder shown until async render completes
- Rendered SVG/HTML replaces placeholder

### Diagram Menu
- User clicks diagram menu button
- Registry provides menu items specific to the diagram type
- Actions (copy SVG, copy code, refresh) dispatched through the renderer

### Extensibility
- Adding a new diagram type = one `DiagramRegistry.register()` call
- No changes needed in markdown renderer, queue processor, or menu builder

---

## Architecture

### Registration Flow

```
App init
    |
    v
DiagramRegistry.register({id, languages, init, render, ...})
    |
    v
renderCardContent() encounters fenced code block
    |
    v
DiagramRegistry.findByLanguage(lang)
    |
    +-- found --> create placeholder, push to unified queue
    +-- not found --> render as plain code block
    |
    v
flushDiagramQueue()
    |
    v
For each queued item:
    registry.getById(item.pluginId).render(id, code, boardId)
    |
    v
Replace placeholder with rendered output
```

---

## Data Model

### DiagramRendererPlugin

```typescript
interface DiagramRendererPlugin {
  id: string;                              // unique identifier ('mermaid', 'plantuml')
  languages: string[];                     // fenced code block language tags

  init(): Promise<void>;                   // load library / check availability
  isReady(): boolean;                      // true when init complete

  render(id: string, code: string, boardId: string): Promise<string>;
                                           // returns SVG or HTML string

  placeholder(id: string, code: string): string;
                                           // HTML for pre-render placeholder

  menuItems(code: string): NativeMenuItem[];
                                           // context menu items for this diagram type
  handleMenuAction(action: string, container: HTMLElement): void;
                                           // dispatch menu action
}
```

### DiagramQueueItem

```typescript
interface DiagramQueueItem {
  pluginId: string;
  elementId: string;
  code: string;
  boardId: string;
}
```

---

## Public API

### DiagramRegistry

```javascript
var DiagramRegistry = {
  register: function(plugin)              // register a renderer plugin
  getById: function(id)                   // retrieve plugin by ID
  findByLanguage: function(lang)          // find plugin matching code fence language
  getAll: function()                      // list all registered plugins
};
```

### Unified Queue

```javascript
var diagramQueue = [];

function queueDiagramRender(pluginId, elementId, code, boardId)
function flushDiagramQueue()              // process all pending renders
```

---

## Built-in Plugins

| ID | Languages | Init | Render |
|----|-----------|------|--------|
| `mermaid` | `mermaid` | Load CDN script, call `mermaid.initialize()` | `mermaid.render()` |
| `plantuml` | `plantuml`, `puml` | No init needed (backend-rendered) | Fetch SVG from `/boards/{boardId}/render-plantuml/{hash}.svg` |

---

## Key Behaviors

### Queue Processing
- Queue is flushed after each `renderCardContent()` call and after each `enhanceEmbeddedContent()` pass
- If a plugin's `isReady()` returns false, `init()` is called first; items stay queued until ready
- Render failures show error text in the placeholder element
- Queue processing is non-concurrent per plugin (sequential within plugin, parallel across plugins)

### Placeholder Lifecycle
- Placeholder created during markdown parse with unique ID
- Plugin provides placeholder HTML via `placeholder(id, code)`
- On successful render, placeholder innerHTML replaced with render output
- On failure, placeholder gets error class and error message

---

## Integration Points

### Called By
- `renderCardContent()` → `DiagramRegistry.findByLanguage()` during code fence parsing
- `flushDiagramQueue()` → called after render and enhancement passes
- `showDiagramMenu()` → `plugin.menuItems()` and `plugin.handleMenuAction()`

### Calls
- Backend API → PlantUML render endpoint
- CDN → Mermaid library loading

---

## Migration Notes

### Keep Same
- Queue-based async rendering pattern
- Placeholder-then-replace DOM lifecycle
- Error display in placeholder

### Change
- Replace two separate queues + processors with one unified queue
- Replace hardcoded language checks in `renderCardContent()` with registry lookup
- Replace separate `initMermaid()` / `processPlantUmlQueue()` with generic `plugin.init()` / `plugin.render()`

### Remove
- `mermaidIdCounter`, `plantumlIdCounter` → single `diagramIdCounter`
- `mermaidReady`, `mermaidLoading` → `plugin.isReady()`
- `pendingMermaidRenders`, `pendingPlantUmlRenders` → single `diagramQueue`
- `initMermaid()`, `processMermaidQueue()`, `processPlantUmlQueue()` → generic queue processor

### Estimated Change
- Remove ~150 lines from app.js
- Add ~140 lines (80 registry + 60 per built-in plugin registration)
