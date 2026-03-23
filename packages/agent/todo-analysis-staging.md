
## Architecture Simplification Todo

### Frontend Runtime

- [ ] **Split the kanban frontend into explicit layers** — break [packages/lexera-kanban/src/app.js](/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/lexera-standalone/packages/lexera-kanban/src/app.js) and [packages/lexera-kanban/src/workspace/workspaceShell.js](/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/lexera-standalone/packages/lexera-kanban/src/workspace/workspaceShell.js) into stable module groups:
  - `state/` for document sessions, shell state, view state
  - `services/` for persistence, sync, API, export, search
  - `views/` for board, canvas, dashboard, logs, settings
  - `shell/` for tabs, splits, docking, windows
  - `adapters/` for Tauri, clipboard, browser APIs, filesystem
  - target rule: no module should mix DOM rendering, localStorage, and backend requests

- [ ] **Introduce a real frontend state model** — remove ambient state and direct `localStorage` usage from view code in [packages/lexera-kanban/src/app.js](/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/lexera-standalone/packages/lexera-kanban/src/app.js). Replace ad hoc globals with:
  - `DocumentSessionStore`
  - `ViewStateStore`
  - `WorkspaceShellStore`
  - `SettingsStore`
  - `SyncSessionStore`

- [ ] **Replace scattered browser persistence calls with a settings service** — centralize the current 80+ `localStorage` reads/writes in [packages/lexera-kanban/src/app.js](/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/lexera-standalone/packages/lexera-kanban/src/app.js) behind a typed settings API. Separate:
  - document-scoped settings
  - workspace-scoped settings
  - frontend user settings
  - backend/server settings
  - transient view state

- [ ] **Finish removing source-sliced tests** — retire the remaining test harnesses that still parse source text:
  - [packages/lexera-kanban/tests/appUtils.test.js](/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/lexera-standalone/packages/lexera-kanban/tests/appUtils.test.js)
  - [packages/lexera-kanban/tests/mutations.test.js](/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/lexera-standalone/packages/lexera-kanban/tests/mutations.test.js)
  - [packages/lexera-kanban/tests/boardMutations.test.js](/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/lexera-standalone/packages/lexera-kanban/tests/boardMutations.test.js)
  - [packages/lexera-kanban/tests/tagStyleRendering.test.js](/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/lexera-standalone/packages/lexera-kanban/tests/tagStyleRendering.test.js)

- [ ] **Reduce `app.js` to orchestration only** — continue extracting pure helpers and mutation logic until [packages/lexera-kanban/src/app.js](/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/lexera-standalone/packages/lexera-kanban/src/app.js) stops being the owner of:
  - markdown rendering helpers
  - path/media helpers
  - mutation helpers
  - canvas parsing/layout helpers
  - shell coordination
  - settings plumbing

### Multi-Window / Shell

- [ ] **Remove iframe-based in-window board composition** — [packages/lexera-kanban/src/workspace/workspaceShell.js](/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/lexera-standalone/packages/lexera-kanban/src/workspace/workspaceShell.js) currently uses iframes and `postMessage` for view composition. Replace in-window tabs/splits with native in-process view instances. Keep separate Tauri windows only for true top-level windows.

- [ ] **Define a universal view contract** — all boards, logs, workspaces, dashboard, and settings views should implement the same tab/view interface:
  - `serializeState()`
  - `restoreState()`
  - `focus()`
  - `close()`
  - `getTitle()`
  - `getKind()`
  - `getDirtyState()`
  This should replace current special-case panel and board behavior.

- [ ] **Separate shell state from board state completely** — kanban/canvas choice, split layout, focused tab, detached windows, and dock positions must live in shell/view state, not in mixed board/global runtime state.

### Shared Code / Package Boundaries

- [ ] **Replace copy-based runtime sharing with a real package** — stop treating [packages/lexera-shared](/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/lexera-standalone/packages/lexera-shared) as a source directory that gets copied into app `src/` folders. Build it as a real browser runtime package and consume it through a stable public interface.

- [ ] **Merge or clearly separate `shared` and `lexera-shared`** — today:
  - [packages/shared](/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/lexera-standalone/packages/shared) owns TS types/parsers
  - [packages/lexera-shared](/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/lexera-standalone/packages/lexera-shared) owns browser runtime JS/CSS
  define one intentional strategy instead of two unrelated “shared” packages.

- [ ] **Stop importing package source across package boundaries** — the web clipper currently imports [packages/shared/src/webClipper.ts](/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/lexera-standalone/packages/shared/src/webClipper.ts) directly from [packages/lexera-web-clipper/src/background.ts](/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/lexera-standalone/packages/lexera-web-clipper/src/background.ts). Convert this to a real package contract using built outputs or a proper workspace package export.

### Domain Logic / Contracts

- [ ] **Choose one source of truth for parser semantics** — [packages/shared/src/markdownParser.ts](/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/lexera-standalone/packages/shared/src/markdownParser.ts) and [packages/lexera-core/src/parser.rs](/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/lexera-standalone/packages/lexera-core/src/parser.rs) currently evolve in parallel. Establish one owner and validate the other implementation through shared fixtures instead of hand-maintained parity.

- [ ] **Choose one source of truth for temporal/search semantics** — align [packages/shared/src/temporalParser.ts](/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/lexera-standalone/packages/shared/src/temporalParser.ts) and [packages/lexera-core/src/search.rs](/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/lexera-standalone/packages/lexera-core/src/search.rs) behind shared fixture tests and one declared semantic authority.

- [ ] **Create a shared API contract package** — define DTOs and endpoint contracts once for:
  - kanban frontend
  - backend settings window
  - web clipper
  - quick capture
  so frontend clients stop hand-coding overlapping assumptions about backend responses.

### Backend / Service Boundaries

- [ ] **Split backend API assembly by domain area** — [packages/lexera-backend/src-tauri/src/api/mod.rs](/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/lexera-standalone/packages/lexera-backend/src-tauri/src/api/mod.rs) should remain a thin router composition layer only. Move route registration into smaller domain-specific routers:
  - boards/files/media
  - config/workspaces
  - sync/collab/events
  - capture/templates

- [ ] **Unify backend discovery and connection state across all clients** — keep a single discovery implementation and a single connection-state model shared between:
  - kanban frontend
  - backend settings window
  - quick capture
  - web clipper

### Repo / Build Hygiene

- [ ] **Quarantine the legacy VS Code extension surface** — the root [package.json](/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/lexera-standalone/package.json) still contains the old extension manifest. Keep it only as archived reference, and make the root workspace describe the active `packages/` products clearly.

- [ ] **Move generated outputs out of active source surfaces** — avoid keeping active build outputs in normal package directories when possible:
  - [packages/shared/dist](/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/lexera-standalone/packages/shared/dist)
  - [packages/lexera-web-clipper/dist](/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/lexera-standalone/packages/lexera-web-clipper/dist)
  - [packages/target](/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/lexera-standalone/packages/target)

- [ ] **Create an explicit architecture document for active products** — document the intended roles of:
  - `lexera-kanban`
  - `lexera-backend`
  - `lexera-core`
  - `shared`
  - `lexera-shared`
  - `lexera-web-clipper`
  - `lexera-capture-ios`
  including ownership, boundaries, and allowed dependencies.

