# Lexera Kanban Todo
- [ ] export is not working properly. it has save, but save is not what it's supposed to do. it should export. the export folder should be default be {main-markdown-file-folder}/_Export/{main-markdown-filename}-{columnIndexes-to-export}/ . the target folder should automatically be defined, also the browse folder in export is not working.
- [ ] dragging a card out of a column into a free space in canvas mode removes the card (and deletes it completely?). it should instead place it in a new stack/column it generates at the drop location.
- [ ] Add pptx rendering (needs esbuild bundle of @jvmr/pptx-to-html)
- [ ] could we integrate a view that allows embedding ![]() images with animations from the animated format. for example i found <https://glaxnimate.org/de/> . just to extend the excalidraw and other formats we already support. it's important that keyframes could be shown as individual images using a parameter or only the final image for example with the parameters {export=keyframes} or {export=flatten} .

## High Priority — Code Quality
- [ ] **Frontend modularization** — app.js currently 13,108 lines (down from 28K, 53% reduction). 35+ extracted modules. Remaining: core rendering, canvas, event handling, live sync, state management — deeply intertwined.

## Open — Features
- [ ] I am planning on adding other sources that could be used to directly integrate data into the kanban boards. Ideas that pop up are: RSS, EMail, Filesystem.
- [ ] A mobile web clipper (something that can run on an ios and or android) would be best as well.

## Long Term — Sync & Collaboration Architecture
- [ ] **CRDT + VCS requirements analysis** — current Loro CRDT works for real-time text sync but doesn't fulfill all requirements:
  - users should collaborate on markdown files AND media files
  - users can be offline and changes must integrate on reconnect
  - changes from specific users must be excludable (per-user isolation / branching)
  - history can be purged to save space (accepted baseline)
  - the system runs on user device or company server
  - current conclusion: something like git with automatic commit + merge (with exclusion) is closer to what we need than pure CRDT
  - **Decision made (2026-03)**: iroh/P2P is premature — Lexera is LAN-first, existing WebSocket + HTTP infrastructure handles current needs. Revisit P2P only when WAN collaboration is requested.
  - **Reference**: REALTIME_VCS_RESEARCH.md documents iroh, FastCDC, Pijul, Jujutsu, Zed DeltaDB research — keep as future reference, don't implement now.
- [ ] **Per-user change isolation** — Loro v1.10.3 has no native fork/branch API. Would require manual snapshot + merge logic on top. No documented user need yet. Revisit when Loro adds branching or when users request it.
- [ ] **Content-addressed binary storage** — current media is path-based filesystem (`{board}-Media/`). No dedup across boards, no version history. If large file sync becomes a need, evaluate BLAKE3 + FastCDC chunking. Not needed for typical kanban media (screenshots, logos, PDFs under 20MB).
- [ ] **WAN/internet collaboration** — current architecture is LAN-only (UDP discovery, WebSocket over localhost/LAN). If WAN is needed, evaluate: iroh (P2P with NAT traversal, but pre-1.0), relay server, or simple VPN recommendation. Don't add P2P infrastructure until there's a proven need.

## Long Term — Architecture
- [ ] **Repository promotion** — make the active Tauri/packages workspace the obvious root product surface and move/archive the legacy VS Code extension scaffolding out of the main root package.json/README path
- [ ] **Frontend build pipeline** — replace script-tag loading + window-global module discovery with a real module graph / bundler (blocked by app.js monolith split)
- [ ] **Typed API contract** — generate or centralize backend/frontend API contracts so settings panels and management views cannot drift from LexeraApi capabilities
- [ ] **Backend service extraction** — split AppState into narrower injected services (config, auth, discovery, sync, board registry) instead of one broad lock-heavy state container
- [ ] **Backend config transactions** — centralize lock/mutate/save/notify patterns from config_api.rs into a ConfigService helper so all config writes share one code path
- [ ] **Plugin architecture** — unify plugin registration across kanban, backend, shared (manifests, not hardcoded lists)
- [ ] **Board schema centralization** — single canonical schema for rows, stacks, columns, cards, settings, metadata
- [ ] **Storage abstraction** — split lexera-core LocalStorage into smaller capability-focused services (repository, persistence, include tracking, revisions, search index, remote boards)
- [ ] **Parser source of truth** — remove or strictly constrain the duplicated markdown parser logic between packages/shared and lexera-core so only one parser is canonical

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

### Style Model
- [ ] **Define exactly two style layers for the product** — document and enforce:
  - `Application Style`: one global shell/UI style for windows, menus, logs, dashboard, settings, workspaces, dialogs, and shared controls
  - `Board Style`: one per-board visual style for kanban/canvas content only
  remove any third overlapping style layer that mixes the two
- [ ] **Merge the current overlapping style systems into one model** — consolidate the current split between:
  - [packages/lexera-shared/themes.js](/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/lexera-standalone/packages/lexera-shared/themes.js)
  - [packages/lexera-kanban/src/visualThemes.js](/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/lexera-standalone/packages/lexera-kanban/src/visualThemes.js)
  - workspace appearance settings in [packages/lexera-shared/management.js](/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/lexera-standalone/packages/lexera-shared/management.js)
  into:
  - one global application theme system
  - one board-local style system
- [ ] **Define strict style scope boundaries** — make it explicit that:
  - application style controls shell chrome, settings, logs, dashboard, workspace browser, dialogs, shared panels, quick capture, backend settings
  - board style controls board background, separators, card/stack/column surfaces, board typography accents, board spacing, and canvas visuals
  - board style must not restyle the application shell

### Typography
- [ ] **Create a single typography scale for the entire application** — replace the current sprawl of direct `font-size` values in:
  - [packages/lexera-kanban/src/app.css](/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/lexera-standalone/packages/lexera-kanban/src/app.css)
  - [packages/lexera-kanban/src/workspace/workspaceShell.css](/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/lexera-standalone/packages/lexera-kanban/src/workspace/workspaceShell.css)
  - [packages/lexera-kanban/src/management.css](/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/lexera-standalone/packages/lexera-kanban/src/management.css)
  - [packages/lexera-kanban/src/wysiwyg-editor.css](/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/lexera-standalone/packages/lexera-kanban/src/wysiwyg-editor.css)
  with a very small token set, for example:
  - `--font-size-xs`
  - `--font-size-sm`
  - `--font-size-md`
  - `--font-size-lg`
  and a single shared body line-height scale
- [ ] **Reduce typography to one UI font and one code font** — stop introducing multiple font stacks across surfaces. Define:
  - one application/board UI font stack
  - one monospace stack for code, logs, raw paths, structured data
  and remove component-level font-family declarations unless they intentionally use the shared monospace token
- [ ] **Define a typography usage map** — assign the small token set to concrete roles:
  - app chrome
  - view headers
  - board titles
  - card body text
  - metadata/badges
  - logs/code/paths
  so components stop choosing arbitrary sizes locally
- [ ] **Make board typography inherit from board-level tokens** — cards, columns, stacks, canvas labels, inline chips, and editor previews inside a board should derive from board typography tokens, not ad hoc CSS declarations

### Board Style
- [ ] **Replace free-form board appearance overlap with a bounded board style descriptor** — define one board style object in board settings, for example:
  - `styleId`
  - `density`
  - `surface`
  - `separatorMode`
  - `accentMode`
  - `boardFontScale` or `boardTextSize`
  and stop scattering board appearance across separate localStorage keys and workspace appearance controls
- [ ] **Limit board style variants to a small curated set** — instead of many overlapping visual tweaks, offer only a few supported board styles such as:
  - `classic`
  - `minimal`
  - `lines`
  - `canvas-notebook`
  each implemented through the same token contract
- [ ] **Keep kanban and canvas on the same board style system** — canvas mode should not have a separate typography/spacing language from kanban mode. Both should inherit from the same board style tokens and only differ where layout mechanics require it
- [ ] **Move tag styling onto the board style contract** — keep per-tag color/pattern overrides if needed, but make sure tag typography, chip sizing, borders, padding, and visual hierarchy inherit from the board style instead of drifting independently in [packages/lexera-kanban/src/tagcolors/tagColors.js](/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/lexera-standalone/packages/lexera-kanban/src/tagcolors/tagColors.js) and [packages/lexera-kanban/src/app.css](/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/lexera-standalone/packages/lexera-kanban/src/app.css)

### Shared UI Surfaces
- [ ] **Normalize shell and auxiliary view typography** — `Workspaces`, `Dashboard`, `Logs`, `Frontend Settings`, and `Backend Settings` should all use the same application style tokens and shared component primitives instead of each view carrying its own font sizing rules
- [ ] **Unify management/settings styling through shared primitives** — consolidate duplicated management/settings styling between:
  - [packages/lexera-shared/management.css](/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/lexera-standalone/packages/lexera-shared/management.css)
  - [packages/lexera-kanban/src/management.css](/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/lexera-standalone/packages/lexera-kanban/src/management.css)
  - [packages/lexera-backend/src/connection-settings.css](/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/lexera-standalone/packages/lexera-backend/src/connection-settings.css)
  so all settings UIs share the same typography and control sizing
- [ ] **Make WYSIWYG and overlay editors inherit the board/application type system** — [packages/lexera-kanban/src/wysiwyg-editor.css](/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/lexera-standalone/packages/lexera-kanban/src/wysiwyg-editor.css) should stop using its own relative font ladder for normal content and instead inherit the same board text tokens, with only semantic exceptions for code blocks or special overlays

### Refactoring / Cleanup
- [ ] **Introduce a central style token file for kanban** — create one canonical token source for:
  - application spacing
  - application typography
  - board typography
  - board spacing
  - icon sizes
  - control heights
  then consume those tokens from `app.css`, `workspaceShell.css`, `management.css`, and `wysiwyg-editor.css`
- [ ] **Audit and remove direct pixel font declarations** — replace the current scattered direct sizes such as `9px`, `10px`, `11px`, `12px`, `13px`, `14px`, `15px`, `18px`, `32px`, and relative `em` values with the shared typography tokens. No component should invent new font sizes without an explicit token addition
- [ ] **Separate style tokens from structural CSS** — move color/typography/spacing tokens out of giant structural files like [packages/lexera-kanban/src/app.css](/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/lexera-standalone/packages/lexera-kanban/src/app.css) so the style system is inspectable and not buried inside component/layout rules
- [ ] **Remove legacy style keys and migrations once the new model exists** — clean out overlapping localStorage/config remnants such as:
  - `lexera-visual-theme`
  - `lexera-board-theme`
  - `lexera-ui-template`
  and any old aliases once application style and board style have stable replacements

### UX / Configuration
- [ ] **Simplify the frontend settings UI around the new model** — the frontend settings view should expose:
  - one application theme/style selector
  - one small typography scale option if still needed globally
  and nothing board-specific
- [ ] **Simplify board style selection in the board UI** — each board should expose only the bounded board style options and not a long list of overlapping appearance toggles. The user should be able to tell clearly what belongs to the board and what belongs to the application
- [ ] **Document the style system and enforce it in review** — add a short architecture/style guide that defines:
  - allowed typography tokens
  - allowed style scopes
  - how to add a new board style
  - when a new token is allowed
  - when a direct pixel font size is forbidden

## Style Simplification Analysis Follow-up
- [ ] **Stop treating font choice as part of the global theme pack** — [packages/lexera-shared/themes.js](/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/lexera-standalone/packages/lexera-shared/themes.js) currently changes both color palette and `--theme-font`, which creates multiple application styles instead of one. Split this so:
  - application theme controls color only
  - application typography is defined once globally
  - code/log monospace remains the only intentional secondary font
- [ ] **Remove the conflict between hardcoded app fonts and theme-provided fonts** — [packages/lexera-kanban/src/app.css](/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/lexera-standalone/packages/lexera-kanban/src/app.css) hardcodes `Poppins` as the fallback shell font, while [packages/lexera-shared/themes.js](/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/lexera-standalone/packages/lexera-shared/themes.js) swaps font families per theme. Pick one application font system and delete the competing path
- [ ] **Collapse `visualThemes.js` into the board style system** — [packages/lexera-kanban/src/visualThemes.js](/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/lexera-standalone/packages/lexera-kanban/src/visualThemes.js) currently provides a second style axis (`classic`, `sleek`, `gap`, `lines`) on top of the application theme. Move these variants into the bounded board-style contract and remove `data-visual-theme` as a separate global styling mechanism
- [ ] **Remove workspace appearance as a competing styling layer** — workspace appearance in [packages/lexera-shared/management.js](/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/lexera-standalone/packages/lexera-shared/management.js) currently stores `Theme` values like `bordered`, `gap-highlight`, and `lines`, and [packages/lexera-kanban/src/app.js](/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/lexera-standalone/packages/lexera-kanban/src/app.js) applies that through `applyWorkspaceAppearance()`. Decide whether workspace appearance:
  - disappears completely
  - becomes only a default board style selector
  - never directly restyles the active application window
- [ ] **Unify board-facing style controls into one board style object** — [packages/lexera-kanban/src/app.js](/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/lexera-standalone/packages/lexera-kanban/src/app.js) currently exposes separate board-level controls for:
  - `visualTheme`
  - `tagStylePreset`
  - layout preset / spacing
  - canvas grid
  replace this with one explicit board presentation model so the user is not composing style from unrelated menus and localStorage-backed features
- [ ] **Move tag presentation under the board style authority** — [packages/lexera-kanban/src/tagcolors/tagColors.js](/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/lexera-standalone/packages/lexera-kanban/src/tagcolors/tagColors.js) persists its own style config in `lexera-tag-style-config`. Keep semantic tag color/category overrides if needed, but make chip sizing, typography, borders, and spacing come from board tokens rather than a separate style engine
- [ ] **Standardize typography across all active product surfaces, not just kanban** — the same typography drift exists in:
  - [packages/lexera-backend/src/quick-capture.css](/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/lexera-standalone/packages/lexera-backend/src/quick-capture.css)
  - [packages/lexera-backend/src/connection-settings.css](/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/lexera-standalone/packages/lexera-backend/src/connection-settings.css)
  - [packages/lexera-shared/management.css](/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/lexera-standalone/packages/lexera-shared/management.css)
  - [packages/lexera-kanban/src/workspace/workspaceShell.css](/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/lexera-standalone/packages/lexera-kanban/src/workspace/workspaceShell.css)
  define one shared application typography package/token layer that these surfaces consume
- [ ] **Remove special editor font ladders for normal content** — [packages/lexera-kanban/src/wysiwyg-editor.css](/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/lexera-standalone/packages/lexera-kanban/src/wysiwyg-editor.css) still uses its own relative typography ladder and `--vscode-editor-font-family`. Normal prose editing should inherit the board/application text system; only code/preformatted blocks should opt into monospace styling
- [ ] **Create a migration plan for style state cleanup** — define how to migrate and then remove overlapping persisted style keys:
  - `lexera-theme`
  - `lexera-visual-theme`
  - `lexera-board-theme`
  - `lexera-ui-template`
  - `lexera-tag-style-config`
  and any workspace `theme` values that currently map to board presentation
- [ ] **Add style regression checks around token usage** — once the style system is simplified, add a lightweight lint/test check that fails when new direct `font-size` pixel values or new ad hoc font-family declarations are introduced outside the approved token files

### UI Architecture
- [ ] **Retire the parallel legacy vs shell UI paths** — stop maintaining both the fixed in-page layout in [packages/lexera-kanban/src/index.html](/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/lexera-standalone/packages/lexera-kanban/src/index.html) and the duplicated shell panel factories in [packages/lexera-kanban/src/workspace/sharedPanels.js](/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/lexera-standalone/packages/lexera-kanban/src/workspace/sharedPanels.js) as equal interface architectures. Keep one active view/panel composition model and demote the other to compatibility code on the way out
- [ ] **Define one interface component vocabulary for the app** — standardize all interactive UI around a small primitive set:
  - `Button`
  - `IconButton`
  - `Input`
  - `Select`
  - `PanelHeader`
  - `TabStrip`
  - `StatusBadge`
  - `SectionHeader`
  new surfaces should compose these instead of inventing new control families
- [ ] **Extract shared UI primitives out of `app.css`** — move the common button/select/header/status styles currently scattered through [packages/lexera-kanban/src/app.css](/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/lexera-standalone/packages/lexera-kanban/src/app.css), [packages/lexera-kanban/src/workspace/workspaceShell.css](/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/lexera-standalone/packages/lexera-kanban/src/workspace/workspaceShell.css), and [packages/lexera-shared/management.css](/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/lexera-standalone/packages/lexera-shared/management.css) into a shared primitive layer with explicit variant rules

### Panels / Views
- [ ] **Standardize panel anatomy across all dockable views** — `Workspaces`, `Dashboard`, `Logs`, `Frontend Settings`, `Backend Settings`, and file/settings views should all use the same structural layout:
  - drag handle
  - title
  - optional tab strip
  - actions area
  - body
  - optional status/footer
  remove the current mix of embedded custom headers, shell wrappers, and container-only panels
- [ ] **Make board views and auxiliary views use the same chrome rules** — board tabs, logs, dashboard, workspace browser, and settings should all follow the same header sizing, padding, action placement, and status placement rules, even if their bodies differ
- [ ] **Normalize folded/collapsed view presentation** — folded bars, edge markers, dock strips, and collapsed status states should use one consistent visual model for labels, drag handles, icons, and reopen affordances

### Controls / Forms
- [ ] **Unify all button families into shared variants** — replace the current split between:
  - `.btn-icon`
  - `.sidebar-btn`
  - `.board-action-btn`
  - `.log-panel-btn`
  - `.log-panel-status-btn`
  - `.mgmt-btn`
  - `.export-action-btn`
  with a small set of button variants such as `icon`, `primary`, `secondary`, `danger`, `quiet`, and `status`
- [ ] **Unify all select/input families into shared variants** — replace the current split between:
  - `.workspace-select`
  - `.dashboard-select`
  - `.theme-select`
  - `.mgmt-field-input`
  - export dialog inputs
  with one select/input component system and variant API
- [ ] **Standardize section headers and subheaders** — dashboard group headers, management section titles, export section titles, panel titles, and board subheaders should all use a shared section/title pattern instead of each area defining its own capitalization, spacing, and emphasis

### States / Feedback
- [ ] **Create one shared state presentation model** — standardize how the interface shows:
  - connected / disconnected
  - loading
  - empty
  - error
  - selected / active
  - pinned
  - destructive
  these should not be implemented differently depending on the panel or surface
- [ ] **Normalize connection-status presentation across all surfaces** — logs headers, folded log bars, backend-related panels, and future status rows should all use the same connection badge/button primitive and text behavior
- [ ] **Standardize empty states and onboarding states** — the main board empty state, empty lists, missing results, and unconfigured panels should use one shared empty-state component instead of ad hoc text blocks and layout-specific placeholders

### Accessibility / Interaction Quality
- [ ] **Standardize focus-visible and keyboard interaction across all controls** — the main board controls have better focus styling than management/settings controls. Bring shared focus rings, keyboard navigation, and active/pressed states to every control family
- [ ] **Create consistent hit-area and sizing rules for controls** — standardize minimum target sizes, icon sizes, button heights, and padding so the app stops mixing compact micro-controls with larger shell controls
- [ ] **Define a consistent action ordering policy** — panel headers, board headers, row/stack/column/card controls, and settings actions should follow one predictable order for drag, title, tabs, state, primary actions, and overflow menu

### Review / Governance
- [ ] **Add an interface consistency checklist to PR review** — require every new surface or control to declare:
  - which shared primitive it uses
  - which typography tokens it uses
  - which state patterns it uses
  - whether it introduces a new control/header pattern
  if it introduces a new pattern, it should justify why the shared one is insufficient

### Spacing System
- [ ] **Define one application spacing scale separate from board spacing** — create a dedicated application-only spacing token set for shell, panels, settings, dialogs, logs, dashboard, workspace browser, quick capture, and backend settings. Do not reuse board spacing tokens for app chrome
- [ ] **Reduce application spacing to a small token ladder** — replace the current spread of ad hoc values like `1px`, `2px`, `3px`, `4px`, `5px`, `6px`, `7px`, `8px`, `10px`, `12px`, `14px`, `16px`, `20px`, `22px`, `24px` with a bounded spacing system, for example:
  - `--app-space-1`
  - `--app-space-2`
  - `--app-space-3`
  - `--app-space-4`
  - `--app-space-5`
  and only allow exceptions for true one-pixel dividers or drag separators
- [ ] **Create separate token groups for content spacing vs control sizing** — the application needs distinct tokens for:
  - container/page insets
  - section spacing
  - row/field gaps
  - button/control heights
  - icon button square sizes
  - folded strip sizes
  mixing these into one generic spacing pool is part of why the layout rhythm drifts

### Application Surfaces
- [ ] **Unify shell chrome spacing** — standardize the padding, gaps, strip sizes, divider thickness, folded-dock sizes, and tab/header insets in [packages/lexera-kanban/src/workspace/workspaceShell.css](/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/lexera-standalone/packages/lexera-kanban/src/workspace/workspaceShell.css). The shell currently mixes values like `2px`, `4px`, `6px`, `8px`, `14px`, `16px`, `22px`, `24px`, and `28px`
- [ ] **Unify sidebar, dashboard, and logs spacing in the main app shell** — standardize the header padding, field spacing, button insets, list row spacing, and status-row spacing in [packages/lexera-kanban/src/app.css](/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/lexera-standalone/packages/lexera-kanban/src/app.css) for:
  - workspace browser
  - dashboard
  - logs
  - shell settings panels
- [ ] **Unify management/settings spacing across frontend and backend** — [packages/lexera-shared/management.css](/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/lexera-standalone/packages/lexera-shared/management.css), [packages/lexera-kanban/src/management.css](/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/lexera-standalone/packages/lexera-kanban/src/management.css), and [packages/lexera-backend/src/management.css](/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/lexera-standalone/packages/lexera-backend/src/management.css) should use one spacing system for:
  - tab bars
  - section spacing
  - field rows
  - list rows
  - chips
  - action rows
  - fold buttons
- [ ] **Unify utility window spacing** — [packages/lexera-backend/src/quick-capture.css](/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/lexera-standalone/packages/lexera-backend/src/quick-capture.css) and [packages/lexera-backend/src/connection-settings.css](/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/lexera-standalone/packages/lexera-backend/src/connection-settings.css) should adopt the same app spacing tokens as the main application instead of their own padding/gap/control-size ladder

### Controls
- [ ] **Define one application control-height system** — standardize all non-board control heights and paddings across the app:
  - icon buttons
  - toolbar/status buttons
  - tabs
  - select inputs
  - text inputs
  - compact buttons
  - fold buttons
  so the app stops mixing `16px`, `18px`, `20px`, `22px`, `24px`, `28px`, and `30px` control heights
- [ ] **Normalize icon-button sizing across all application surfaces** — shell controls, sidebar buttons, management buttons, log actions, and quick-capture icon buttons should use one square-size token family rather than separate local sizes like `22px`, `24px`, `var(--btn-square-size)`, and view-specific overrides
- [ ] **Normalize field-row spacing and action-row spacing** — settings forms, dashboard controls, export controls, logs header actions, and dialog action rows should all use the same row-gap and inline-gap rules instead of each surface inventing its own `gap` pattern

### Layout Rhythm
- [ ] **Standardize container insets for application panels and dialogs** — define a consistent inset model for:
  - panel bodies
  - dialog bodies
  - settings containers
  - logs bodies
  - dashboard bodies
  - quick-capture content panes
  the current app mixes `8px`, `10px`, `12px`, `16px`, `20px`, and `24px` insets without a clear rule
- [ ] **Define consistent section-to-section vertical rhythm** — top-level panels and dialogs should use one standard for spacing between headers, sections, lists, and action bars. Right now management, dashboard, export, and quick capture all use different vertical rhythm
- [ ] **Separate structural drag separators from visual spacing** — drag dividers and fold strips in the workspace shell should use fixed functional sizes, but all surrounding paddings and insets should come from the normal application spacing system. Right now these concerns are interleaved

### Refactoring / Enforcement
- [ ] **Create an application spacing token file and move non-board spacing there** — extract application spacing/sizing tokens out of [packages/lexera-kanban/src/app.css](/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/lexera-standalone/packages/lexera-kanban/src/app.css), [packages/lexera-kanban/src/workspace/workspaceShell.css](/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/lexera-standalone/packages/lexera-kanban/src/workspace/workspaceShell.css), [packages/lexera-shared/management.css](/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/lexera-standalone/packages/lexera-shared/management.css), [packages/lexera-backend/src/quick-capture.css](/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/lexera-standalone/packages/lexera-backend/src/quick-capture.css), and [packages/lexera-backend/src/connection-settings.css](/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/lexera-standalone/packages/lexera-backend/src/connection-settings.css)
- [ ] **Audit and remove ad hoc spacing literals from application surfaces** — replace direct margin/padding/gap/control-size literals in non-board UI code with shared tokens. Allow direct literals only for:
  - `0`
  - `1px` borders/dividers
  - special drag-hit sizes that are explicitly documented
- [ ] **Add spacing regression checks for application UI** — once the spacing system is unified, add a lightweight lint/test rule that flags new direct margin/padding/gap/control-size literals in application surfaces outside the approved token files
- [ ] **Document application spacing rules separately from board layout rules** — add a short guide that defines:
  - which spacing tokens belong to application chrome
  - which belong to board layout
  - standard container insets
  - standard control heights
  - standard row gaps
  - allowed exceptions

## Application Spacing Migration Follow-up
- [ ] **Create an application spacing audit matrix before refactoring** — inventory the current non-board spacing/control-size rules per surface:
  - sidebar/workspace browser
  - dashboard
  - logs
  - frontend settings
  - backend settings
  - export dialog
  - workspace shell chrome
  - quick capture
  and map each existing literal to its future spacing token or documented exception
- [ ] **Define canonical header spacing specs for application surfaces** — standardize one header recipe for:
  - panel headers
  - dialog headers
  - status headers
  - tab headers
  including title gap, action gap, top/bottom padding, left/right inset, and minimum height
- [ ] **Define canonical body inset specs for application surfaces** — standardize one inset recipe for:
  - scrollable panel bodies
  - form bodies
  - list bodies
  - dialog bodies
  - utility-window content panes
  so the app no longer alternates arbitrarily between tight, medium, and large content padding
- [ ] **Define canonical row-density specs for non-board lists and forms** — workspace rows, dashboard rows, management rows, log rows, and export fields should each map to one of a very small number of approved row densities rather than each surface inventing its own height and padding
- [ ] **Unify fold-strip and collapsed-panel dimensions** — standardize the collapsed side/bottom strip sizes, hover-expansion insets, label padding, and collapsed action hit-areas in [packages/lexera-kanban/src/workspace/workspaceShell.css](/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/lexera-standalone/packages/lexera-kanban/src/workspace/workspaceShell.css)
- [ ] **Normalize spacing inside logs/settings composite panels** — the logs area currently mixes:
  - log header spacing
  - log status spacing
  - log settings pane spacing
  - shell settings panel spacing
  make these compose from the same spacing rules instead of each subsection carrying its own local rhythm
- [ ] **Normalize dialog spacing patterns across the app** — use the export dialog as the first canonical dialog migration and define reusable spacing patterns for:
  - header
  - body
  - footer
  - sections
  - field groups
  - inline checkbox clusters
  then apply the same model to future dialogs
- [ ] **Add representative UI screenshot baselines for spacing QA** — once spacing tokens are introduced, capture a small baseline set for:
  - main app with sidebar/dashboard/logs
  - workspace shell with folded docks
  - frontend settings
  - backend settings
  - export dialog
  - quick capture
  so spacing regressions become visible during future cleanup
- [ ] **Migrate application spacing in phases instead of by file ownership** — do the rollout in this order:
  1. shared control heights and button sizes
  2. shared panel/dialog insets
  3. settings and management forms
  4. shell chrome and folded docks
  5. utility windows
  6. cleanup of remaining literals
  this reduces churn compared with rewriting one CSS file at a time
