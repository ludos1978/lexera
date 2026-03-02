# Content Plugin System Specification

**Status**: Base-plan critical for v2  
**V2 Targets**: `packages/lexera-core`, `packages/lexera-kanban`, `packages/lexera-backend`, `packages/marp-engine`  
**V1 Reference**: `src/plugins/registry/PluginRegistry.ts`, `src/plugins/markdown/markdownPluginManifest.ts`, `src/html/markdownRenderer.js`, `src/html/wysiwygEditor.ts`, `src/services/export/ExportService.ts`

---

## Purpose

Define a single plugin-based content architecture that can:

- display content inside Kanban cards
- display and edit the same content in the WYSIWYG editor
- export the same content to Marp or Pandoc
- optionally convert or downgrade content before export

The main requirement is to stop treating Kanban display, WYSIWYG, and export as three unrelated pipelines.

---

## Core Design Rule

Each content feature should be defined once as a **content plugin** with:

- a stable identity
- declared capabilities
- a normalized content shape
- per-surface adapters

The surfaces are:

- Kanban display
- WYSIWYG editing
- Export transform
- Export runner target

---

## Target Outcome

When Lexera adds a content feature like diagrams, embeds, callouts, speaker notes, or custom containers, the system should answer four questions in one place:

1. How is the syntax recognized?
2. How is it rendered in Kanban display?
3. How is it represented and edited in WYSIWYG?
4. How is it exported to Marp and Pandoc if the target does not support it natively?

---

## Proposed Package Structure

```text
packages/
├── lexera-core/
│   └── src/
│       └── content/
│           ├── mod.rs
│           ├── ast.rs
│           ├── manifest.rs
│           ├── registry.rs
│           ├── normalize.rs
│           ├── pipeline.rs
│           ├── capabilities.rs
│           ├── export/
│           │   ├── mod.rs
│           │   ├── common.rs
│           │   ├── marp.rs
│           │   └── pandoc.rs
│           └── plugins/
│               ├── mod.rs
│               ├── media.rs
│               ├── diagrams.rs
│               ├── embeds.rs
│               ├── callouts.rs
│               ├── includes.rs
│               └── speaker_notes.rs
├── lexera-kanban/
│   └── src/
│       └── content/
│           ├── registry.js
│           ├── runtime.js
│           ├── kanban/
│           │   ├── renderers.js
│           │   └── fallback.js
│           ├── wysiwyg/
│           │   ├── schema.js
│           │   ├── serializer.js
│           │   ├── commands.js
│           │   ├── nodeViews.js
│           │   └── pasteRules.js
│           └── plugins/
│               ├── media/
│               │   ├── manifest.js
│               │   ├── kanban.js
│               │   └── wysiwyg.js
│               ├── diagrams/
│               ├── embeds/
│               ├── callouts/
│               ├── includes/
│               └── speaker_notes/
├── lexera-backend/
│   └── src-tauri/
│       └── src/
│           └── content_export/
│               ├── mod.rs
│               ├── registry.rs
│               ├── pipeline.rs
│               ├── target_marp.rs
│               ├── target_pandoc.rs
│               └── plugins/
│                   ├── media.rs
│                   ├── diagrams.rs
│                   ├── embeds.rs
│                   ├── callouts.rs
│                   ├── includes.rs
│                   └── speaker_notes.rs
└── marp-engine/
    └── engine/
        └── plugins/
            ├── media.js
            ├── diagrams.js
            ├── embeds.js
            └── speaker-notes.js
```

This structure separates:

- normalized content knowledge in `lexera-core`
- UI-specific behavior in `lexera-kanban`
- export orchestration in `lexera-backend`
- Marp-engine-specific markdown-it/runtime hooks in `marp-engine`

---

## Plugin Taxonomy

### 1. Content syntax plugins

Responsible for recognizing and normalizing syntax.

Examples:

- diagrams
- embeds
- media blocks
- includes
- callout/container blocks
- speaker notes

Primary home:

- `lexera-core/src/content/plugins/*`

Output:

- normalized `ContentNode` / `ContentMark` structures

### 2. Kanban display plugins

Responsible for turning normalized content into card HTML and async render hooks.

Examples:

- diagram placeholders + rendered preview
- media fallback placeholders
- embed iframe/fallback blocks

Primary home:

- `lexera-kanban/src/content/plugins/*/kanban.js`

### 3. WYSIWYG plugins

Responsible for mapping normalized content to editor schema, node views, commands, and markdown serialization.

Examples:

- custom block node specs
- toolbar actions
- special paste/input rules
- inline widget editing

Primary home:

- `lexera-kanban/src/content/plugins/*/wysiwyg.js`

### 4. Export transform plugins

Responsible for converting normalized content into target-safe output before Marp or Pandoc runs.

Examples:

- embed -> link or fallback image
- speaker note marker -> Marp comment
- custom container -> plain markdown blockquote or HTML block
- diagram -> preserved code fence, generated image, or fallback text

Primary home:

- `lexera-backend/src-tauri/src/content_export/plugins/*`
- common normalization in `lexera-core/src/content/export/*`

### 5. Export runner plugins

Responsible for the final tool execution layer only.

Examples:

- Marp runner
- Pandoc runner

Primary home:

- desktop shell runner layer

Current v2 baseline:

- `packages/lexera-kanban/src-tauri/src/export_commands.rs`

Possible future consolidation:

- `lexera-backend` may absorb runner execution later if the desktop shell/runtime boundary changes

These are separate from content plugins. They do not decide content semantics; they only consume already transformed export content.

---

## Capability Model

Each plugin should declare capabilities instead of assuming all surfaces exist.

### Example capability matrix

```typescript
interface ContentPluginCapabilities {
  syntax: true;
  kanbanRender?: true;
  wysiwygNode?: true;
  exportTransform?: true;
  asyncAssets?: true;
  marpNative?: boolean;
  pandocNative?: boolean;
}
```

Examples:

- `speaker-notes`: syntax + exportTransform, maybe no Kanban-special rendering
- `diagram`: syntax + kanbanRender + wysiwygNode + exportTransform + asyncAssets
- `embed`: syntax + kanbanRender + exportTransform, limited WYSIWYG support possible

---

## Shared Manifest

Use one manifest entry per content plugin as the stable source of truth.

### Manifest shape

```typescript
interface ContentPluginManifest {
  id: string;
  version: string;
  kind: 'block' | 'inline' | 'mark' | 'hybrid';
  priority: number;
  syntaxFamily: string;
  capabilities: ContentPluginCapabilities;
  exportPolicy?: {
    marp: 'native' | 'transform' | 'fallback' | 'drop';
    pandoc: 'native' | 'transform' | 'fallback' | 'drop';
  };
}
```

The manifest should not contain executable logic. It should declare:

- what the plugin is
- what surfaces it participates in
- how export should treat unsupported content

---

## Normalized Content Model

The system needs a surface-neutral representation between markdown parsing and target rendering.

### Content document

```typescript
interface ContentDocument {
  version: 1;
  blocks: ContentNode[];
}
```

### Content node

```typescript
interface ContentNode {
  id: string;
  pluginId: string | null;
  type: string;
  attrs?: Record<string, unknown>;
  children?: ContentNode[];
  text?: string;
}
```

### Rules

- plain markdown structures may have `pluginId: null`
- plugin-owned structures must carry stable `pluginId`
- WYSIWYG and export must operate on the normalized node type, not on raw regex detection

---

## Pipeline Structure

### 1. Parse + normalize pipeline

```text
Markdown card content
  -> base markdown parse
  -> content plugin detection
  -> normalized ContentDocument
```

Owner:

- `lexera-core`

Purpose:

- establish one canonical interpretation of content features

### 2. Kanban render pipeline

```text
ContentDocument
  -> base HTML rendering
  -> plugin Kanban render hooks
  -> async asset/diagram enhancement
  -> final card DOM
```

Owner:

- `lexera-kanban`

Purpose:

- keep card display modular
- prevent `markdownRenderer.js` from remaining a giant special-case file

### 3. WYSIWYG pipeline

```text
ContentDocument
  -> plugin-provided schema mapping
  -> editor node views / commands
  -> edited document
  -> markdown serializer using plugin serializers
```

Owner:

- `lexera-kanban`

Purpose:

- keep WYSIWYG compatible with the same content semantics as display/export

### 4. Export pipeline

```text
Board/card selection
  -> ContentDocument
  -> common export transforms
  -> target-specific plugin transforms
  -> target markdown/document source
  -> Marp or Pandoc runner
```

Owner:

- `lexera-core` for common transforms
- `lexera-backend` for extraction and transform APIs
- desktop shell layer for current runner execution

Purpose:

- allow content conversion before export
- avoid Marp/Pandoc-specific hacks inside UI code

---

## Export Conversion Model

Some content is not natively supported by Marp or Pandoc. The plugin system must make this explicit.

### Export stages

1. Selection stage
2. Common normalization stage
3. Plugin conversion stage
4. Target shaping stage
5. Runner stage

### Common normalization stage

Applied before target-specific logic:

- resolve includes
- filter tags
- strip or rewrite HTML comments/content depending on export settings
- normalize media paths
- remove editor-only metadata

### Target-specific plugin conversion stage

Each plugin can choose a strategy per target:

- `native`: leave content intact
- `transform`: rewrite to target-friendly markdown/document structure
- `fallback`: emit a safer downgraded representation
- `drop`: remove content entirely with warning

### Examples

#### Diagram plugin

- Marp:
  - native if code fence is acceptable
  - transform to image if configured
- Pandoc:
  - transform to image or fenced code block

#### Embed plugin

- Marp:
  - fallback to link or screenshot/image
- Pandoc:
  - fallback to link or appendix list

#### Speaker notes plugin

- Marp:
  - transform `;;` style content into Marp-compatible note comments
- Pandoc:
  - drop or move into note appendix depending on export mode

#### Container/callout plugin

- Marp:
  - transform to blockquote or styled fenced block
- Pandoc:
  - transform to Div-compatible markdown or simple heading + body

---

## Registry Responsibilities

### `lexera-core` content registry

- validate manifests
- expose capability graph
- define plugin order
- provide normalized-content pipeline ordering

### `lexera-kanban` runtime registry

- load only plugins needed for Kanban display and WYSIWYG
- wire render hooks, node views, and serializers
- provide fallback rendering when plugin adapter is missing

### `lexera-backend` export registry

- load export-transform adapters
- assemble conversion chain per target
- collect warnings about downgraded or dropped content

---

## UI Fallback Rules

The system must degrade safely when a surface is not implemented.

### Missing Kanban renderer

- show a readable fallback block
- expose plugin ID for diagnostics

### Missing WYSIWYG adapter

- preserve the original markdown block as editable raw markdown
- do not silently strip syntax

### Missing export transform

- use fallback or drop policy explicitly
- return warning list in export result

---

## Initial Plugin Set

Start with plugins that already map to known complexity in the codebase:

- `media`
- `diagrams`
- `embeds`
- `includes`
- `speaker-notes`
- `containers` / `callouts`
- `task-checkbox`
- `wiki-link`
- `temporal-tag`

Not every plugin needs full WYSIWYG support on day one. The manifest should allow partial support.

---

## Implementation Split By Package

### `lexera-core`

Must own:

- normalized content AST
- manifest validation
- plugin capability metadata
- common export transforms
- target-neutral content conversion rules

Should not own:

- DOM rendering
- ProseMirror node views
- CLI spawning

### `lexera-kanban`

Must own:

- Kanban render adapters
- WYSIWYG node specs and node views
- editor commands
- render fallbacks for unsupported plugin UI

Should not own:

- Marp/Pandoc-specific conversion policy
- final export tool execution

### `lexera-backend`

Must own:

- export extraction and transform APIs
- target-specific export assembly for backend-served markdown/document content
- export warning collection
- tool availability checks

Currently does not solely own:

- Marp/Pandoc CLI invocation
- desktop file-writing commands

Should not own:

- the meaning of content syntax itself

### Desktop shell layer (`lexera-kanban` today)

Must currently own:

- export UI orchestration
- Marp/Pandoc CLI invocation
- theme discovery commands
- export file write/remove/open commands

Should eventually be cleanly separated from:

- content normalization logic
- target-specific content conversion semantics

### `marp-engine`

Must own:

- Marp-engine-specific markdown-it/runtime helpers
- only those plugin helpers required by the final Marp pipeline

Should not become:

- the source of truth for all content semantics

---

## Migration From Current State

### Today

- markdown-it plugin manifest exists
- PluginRegistry exists
- WYSIWYG has separate schema/node-view logic
- ExportService performs many content rewrites inline
- backend exposes export extraction/transform APIs
- `lexera-kanban` desktop shell owns Marp/Pandoc runner commands today
- Marp/Pandoc are plugin-like at the runner layer, but not at the content-transform layer

### Move toward

1. keep runner plugins for Marp and Pandoc
2. introduce content plugin manifests with per-surface capabilities
3. introduce normalized content nodes for plugin-owned syntax
4. move export rewrites into plugin-aware transform stages
5. let Kanban and WYSIWYG consume the same plugin definitions through different adapters

---

## Testing Requirements

### Content plugin tests

- syntax recognized into the expected normalized node
- unsupported syntax falls back safely

### Kanban renderer tests

- plugin node renders expected HTML
- async diagram/media paths resolve correctly

### WYSIWYG tests

- plugin node round-trips markdown -> editor -> markdown
- unsupported plugin content remains editable as raw markdown

### Export tests

- plugin content transforms correctly for Marp
- plugin content transforms correctly for Pandoc
- downgrade/fallback warnings are emitted when content cannot be preserved exactly

### End-to-end tests

- one card with mixed plugin content displays in Kanban, edits in WYSIWYG, and exports to both targets

---

## Non-Goals

- arbitrary third-party plugin loading in the first base-plan iteration
- runtime code execution from untrusted plugin packages
- full extension marketplace-style ecosystem

The first goal is a **structured internal plugin architecture** that can later be opened up if needed.
