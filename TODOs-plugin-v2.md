# Plugin Architecture v2 — Unified Registry for Lexera (Tauri) [DONE]

Port v1's plugin architecture (see `_ARCHIVE/src/plugins/` and `TODOs-plugin.md`) to the current `lexera-*/` codebase, adapted for Tauri + Rust + IIFE frontend.

---

## Goal

Replace 6+ siloed registries with one unified `PluginRegistry`. Bring the Rust backend's monolithic export pipeline into the same model via a trait-based registry. Preserve everything that already works (scope/priority dispatch, lazy-load enhancers, IIFE-in-WKWebView pattern).

---

## Target architecture

Single `LexeraPluginRegistry` at [lexera-kanban/src/plugins/](lexera-kanban/src/plugins/) that holds plugins by `kind`.

**Plugin kinds**:

| Kind | Replaces | Key methods |
|---|---|---|
| `fileFormat` | 10 inline entries in [fileFormatRegistry.js](lexera-kanban/src/plugins/fileFormatRegistry.js) | `matches(path)`, `preview`, `export`, `rendererRequirements` |
| `diagram` | [diagramRegistry.js](lexera-kanban/src/diagramRegistry.js) | `canRenderCodeBlock(lang)`, `renderCodeBlock(code)` |
| `export` | [exportService.js](lexera-kanban/src/export/exportService.js) | `getSupportedFormats()`, `canExport(fmt)`, `export(data)` |
| `contentEnhancer` | [contentEnhancerRegistry.js](lexera-kanban/src/contentEnhancerRegistry.js) | `selector`, `enhance(el, ctx)`, `lazy` |
| `menuContributor` | [menuContributorRegistry.js](lexera-kanban/src/menuContributorRegistry.js) | `scopes[]`, `build(scope, ctx)` |
| `embed` | (not yet extracted) | iframe config + export transform |

**Base contract** all plugins share:

```
{
  kind: 'fileFormat' | 'diagram' | ...
  metadata: { id, name, version, priority?, requires?, contributes? }
  activate?(ctx),  deactivate?(),  isAvailable?(): Promise<boolean>
}
```

**`PluginLoader`** — idempotent, honors `disabled: [...]` from [lexera-shared/management.js](lexera-shared/management.js), activates in topological order by `requires`.

---

## Improvements over v1

1. **Instance-based, not singleton** — v1's `PluginRegistry.getInstance()` forced shared state across test suites. Expose a default instance for ergonomics, but also a `createRegistry()` factory.
2. **One file per plugin manifest + impl** — v1 already did this; current code jams 10 formats into 370 lines.
3. **Runtime enable/disable** — v1 only honored the disabled list at load. Management UI should toggle live via `registry.setEnabled(id, bool)`.
4. **Promote `rendererRequirements` to plugin metadata** — currently only on file format plugins. A top-level `requires: ['soffice', 'pdftoppm']` lets management UI auto-surface missing tools for *any* plugin kind.
5. **Cross-plugin `requires`** — topological sort on activation so e.g. XLSX that depends on a shared LibreOffice plugin activates in order. v1 lacked this.
6. **Rust parity** — v1 was TS-only. Introduce `trait Plugin` + kind-specific sub-traits in [lexera-core/src/plugins/](lexera-core/src/plugins/); make [lexera-core/src/export/](lexera-core/src/export/) (ical, xbel, presentation, tag_filter) into impls. Biggest improvement — wasn't possible in v1.
7. **Drop the `any` context wildcard** — v1's `contextLocation: 'any'` + `_deduplicateMatches()` was noise; discovery API stays explicit (`findDiagramFor(lang)`, etc.).
8. **Skip pattern-conflict validation** — v1 warned on overlapping include patterns; rarely useful, noisy.
9. **Log-and-skip on invalid registration** — v1 threw, taking down boot. Log error and continue with other plugins.

---

## Phases

Each phase is independently shippable. Old registries stay as thin adapters until replacement lands.

### Phase 1 — Infrastructure (no behavior change)

Deliverables:
- [x] `lexera-kanban/src/plugins/pluginRegistry.js` — instance-based IIFE: register/validate/getById/getByKind/findBy/setEnabled/activate/deactivate
- [x] `lexera-kanban/src/plugins/pluginLoader.js` — loadBuiltins entry point (empty built-in list in Phase 1)
- [x] `lexera-kanban/src/plugins/interfaces.js` — JSDoc @typedef contracts (documentation only)
- [x] `lexera-kanban/tests/pluginRegistry.test.js` — validate/register/discover/lifecycle/priority/enable-disable
- [x] Wire `<script>` tags into [lexera-kanban/src/index.html](lexera-kanban/src/index.html)
- Do NOT touch existing registries yet.

### Phase 2 — File formats (biggest quick win)

- [x] Split [fileFormatRegistry.js](lexera-kanban/src/plugins/fileFormatRegistry.js) into `plugins/formats/{drawio,excalidraw,xlsx,csv,tsv,pdf,pptx,document,epub,plaintext}.js`
- [x] Each exports a `FileFormatPlugin` manifest
- [x] Old `LexeraFileFormatRegistry` becomes a thin facade over `PluginRegistry.findBy('fileFormat', p => p.matches(path))`
- [x] All existing call sites unchanged
- [x] Existing [fileFormatRegistry.test.js](lexera-kanban/tests/fileFormatRegistry.test.js) keeps passing

### Phase 3 — Diagrams

- [x] Port [diagramRegistry.js](lexera-kanban/src/diagramRegistry.js) under unified registry as `kind: 'diagram'`
- [x] Port v1's `MermaidPlugin`, `PlantUMLPlugin` shape, adapted to Tauri IPC (backend calls) instead of VS Code webview
- [x] Preserve current queue/batching behavior in the registry adapter

### Phase 4 — Export (biggest refactor, load-bearing)

- [x] Split [exportService.js](lexera-kanban/src/export/exportService.js) (1125 lines) into `MarpExporter`, `PandocExporter`, `FilterExporter`
- [x] Each is an `ExportPlugin` registered at boot
- [x] `exportService.js` becomes a thin dispatch layer
- [x] Gate behind `features.pluginExport` flag during cutover

### Phase 5 — Rust plugin system (additive)

- [x] New module [lexera-core/src/plugins/](lexera-core/src/plugins/): `mod.rs`, `registry.rs`, traits
- [x] `trait Plugin { fn metadata(&self) -> PluginMetadata; }`
- [x] `trait ExportPlugin: Plugin { fn export(...) -> Result<...>; }`
- [x] Convert [lexera-core/src/export/](lexera-core/src/export/) `{ical, xbel, presentation, tag_filter, content_transform}` into impls
- [x] Register in [lexera-backend/src-tauri/src/](lexera-backend/src-tauri/src/) startup
- [x] Defer until Phase 4 proves value

### Phase 6 — Enhancers, menu, embed

- [x] Fold [contentEnhancerRegistry.js](lexera-kanban/src/contentEnhancerRegistry.js) into unified registry as `kind: 'contentEnhancer'`
- [x] Fold [menuContributorRegistry.js](lexera-kanban/src/menuContributorRegistry.js) into unified registry as `kind: 'menuContributor'`
- [x] Add `EmbedPlugin` (iframe config + export transform) to match v1

### Phase 7 — Management UI integration

- [x] `plugins.disabled` setting read by `PluginLoader` at load
- [x] Toggleable from [lexera-shared/management.js](lexera-shared/management.js) panel
- [x] Per-plugin `requires: [...]` surfaced as "missing tool" warnings in management UI
- [x] Runtime toggle via `registry.setEnabled(id, bool)` — no restart needed

---

## Risks

- **Phase 4 is load-bearing**: [exportService.js](lexera-kanban/src/export/exportService.js) runs Marp + Pandoc pipelines. Any regression breaks exports. Ship feature-flagged, remove old path in follow-up.
- **Phase 5 sprawl**: If the Rust trait design is over-engineered for ~5 impls, defer. Don't build plugin infra that exceeds the problem.
- **IIFE vs ES modules**: Frontend has no build step; keep everything IIFE + JSDoc. No TypeScript.
- **Scope creep**: Resist external/dynamic plugin loading (security + packaging). Built-ins only, like v1.
