Runtime JavaScript modules shared between Tauri apps. Copied at build time.

Contains plain JS IIFE modules used by both `lexera-kanban` and `lexera-backend`
Tauri applications:

- `backendDiscovery.js` - Backend URL discovery with port scanning and Tauri
  invoke support. This is the authoritative discovery implementation; a parallel
  browser-only TypeScript variant exists in `packages/shared/src/webClipper.ts`.
- `management.js` + `management.css` - Shared management UI (server config,
  collab, identity, boards).
- `themes.js` - Visual theme definitions.

Files are copied into each app's `src/` directory by the `sync-runtime-assets`
script, triggered by Tauri's `beforeDevCommand`/`beforeBuildCommand`. The copied
files are gitignored in each app.
