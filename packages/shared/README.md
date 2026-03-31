TypeScript library for types, parsing, temporal extraction. Used by web clipper.

Contains shared TypeScript types (KanbanCard, KanbanColumn, etc.), markdown
parsing, temporal date/week extraction, and browser-only backend discovery for
the web clipper extension. Published as `@ludos/shared`.

Backend discovery functions (`discoverLexeraBackend`, `buildLexeraBackendCandidates`,
etc.) are a browser-only variant of the authoritative Tauri implementation in
`packages/lexera-shared/backendDiscovery.js`. Both use the same port candidate
list and discovery protocol but target different runtimes.
