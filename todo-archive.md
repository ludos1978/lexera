# Lexera Kanban — Completed Items Archive

## Archived During Backlog Cleanup — 2026-04-07

### Repository promotion items completed and removed from the active backlog
- [x] Reframed the repository around the active Lexera apps and libraries instead of `packages/lexera-*`.
- [x] Promoted the active Lexera code into stable top-level directories.
- [x] Updated the main build scripts, paths, config files, and active docs to the new layout.
- [x] Replaced the legacy Rust workspace under `packages/Cargo.toml` with a root [`Cargo.toml`](/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/lexera-standalone/Cargo.toml).
- [x] Added a real repo-level Rust workspace manifest so root tasks resolve consistently.
- [x] Updated root `package.json`, workspace metadata, Tauri config paths, and package-local wiring for the promoted structure.
- [x] Updated test fixture references, screenshot paths, asset paths, and other active path-sensitive references that still assumed `packages/lexera-*`.
- [x] Updated shell scripts and local helper scripts that assumed `packages/...` paths.
- [x] Updated active architecture/spec documentation and agent guidance so contributors are pointed at the promoted top-level V2 directories.
- [x] Removed transition-only backlog items about proxying to `packages/Cargo.toml` and documenting the old in-`packages/` Rust workspace reality.
- [x] Added a root `build` entrypoint via [`build.sh`](/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/lexera-standalone/build.sh).
- [x] Added a root `dev` bootstrap entrypoint via [`run-lexera.sh`](/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/lexera-standalone/run-lexera.sh).
- [x] Documented the active development boundary in [`AGENT.md`](/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/lexera-standalone/AGENT.md) and [`README.md`](/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/lexera-standalone/README.md).

### Historical status-report sections removed from the active backlog
- [x] Archived the old completed-work log, architecture snapshot, security review, package-by-package debt report, metrics tables, and phased recommendation sections that no longer belonged in `TODOs-lexera.md`.

## Archived During Backlog Cleanup — 2026-04-05

### Completed items moved out of the active backlog
- [x] CSS-only add-affordance visibility for empty row/stack/column children.
- [x] Empty Excalidraw / Draw.io creation through the generic entity insertion path.
- [x] Workspace overflow/burger menu contrast fix.
- [x] Backend Settings configuration-tab removal while preserving functionality.
- [x] Workspace burger/context menu dispatch via iframe and live hierarchy sync.
- [x] Cross-board drag bridge symmetry and copy/trash source handling.
- [x] Direct add-card insertion without the old Add/Cancel composer.
- [x] Format menu cleanup for `Layout Rows` / `Board Layout`.
- [x] Keyboard shortcut audit plus the first workspace-shell shortcut wave.
- [x] Dashboard search-result focus navigation.
- [x] Workspace config global-sync settings and follow-up fixes.
- [x] Column/card drag-drop geometry fix.
- [x] Dashboard layout collapse and no-focus refresh behavior.
- [x] Per-stack and board-default stack width settings.
- [x] Recovery-copy error explanation surfaced to the user.
- [x] Copy row/stack/column as formatted HTML.
- [x] Kanban font-size unification.
- [x] Embed/include menu restructuring.
- [x] Delete-row and related delete refresh fixes.
- [x] Targeted board re-render pipeline refactor.
- [x] Quick-capture monitor-change detection implemented in the backend. Remaining work is manual cross-platform verification and stays in `TODOs-lexera.md`.

### Architecture milestones moved out of the active backlog
- [x] Hierarchy sync enforcement rollout completed.
  - Enumerate `fullBoardData` writers.
  - Introduce `commitLocalBoardChange(...)`.
  - Migrate polling/live-sync/rebase/cross-board writers.
  - Seal hierarchy-cache writes.
  - Collapse hierarchy refresh APIs.
  - Disable the hierarchy pipeline inside embedded iframes.
  - Keep `boards[] / remoteBoards[] / workspaces[]` polling in the parent realm.
  - Add regression tests and SPEC contract docs.
- [x] Hierarchy sync follow-up fixes completed.
  - Load-path sync leak fixed.
  - Raw `activeBoardData = ...` writes removed.
  - In-place `activeBoardData` mutations routed through the runtime bridge.
  - Stable row/stack/column/card ids adopted for hierarchy focus and most move paths.
- [x] Shared hierarchy interaction controller introduced for Workspace and Dashboard.
- [x] Shared hierarchy contract above `TreeView` introduced for Workspace, Files, and Dashboard.
  - `lexera-kanban/src/hierarchy/hierarchyContract.js` now defines shared node descriptors and capabilities.
  - `TreeView` projects the descriptor into DOM metadata.
  - `hierarchyController` respects explicit capability gating instead of relying on surface-specific assumptions.
- [x] Files / Management config tree migrated to the shared hierarchy system while keeping inspectors/forms separate.
- [x] Workspace hierarchy row / stack / column double-click now edits inline in the visible hierarchy surface, including mirrored workspace panels.
- [x] Hierarchy card nodes now edit inline in the visible hierarchy surface through the shared multiline tree editor, including mirrored workspace panels and hidden-card fallback resolution.
- [x] Legacy-converter call-site parity / invariant baseline added.
- [x] Divider-resize, dashboard pending-flag, workspace-shell testability, and capture watcher tests moved out of the active backlog.

### Superseded or decomposed during cleanup
- [x] ~~make another attempt at unifying the hierarchies we have~~ — planning phase completed; remaining implementation now lives under the structured hierarchy-unification track in `TODOs-lexera.md`.
- [x] ~~there must be one update path if elements are changed in the structure of the kanban/canvas, and another one if content is changed within the boards~~ — decomposed into the active board/session pipeline and hierarchy-unification tracks in `TODOs-lexera.md`.
- [x] ~~Single-source cleanup pass~~ — replaced with concrete architecture and legacy-retirement items in `TODOs-lexera.md`.
- [x] ~~Email/filesystem sources, office editor, build pipeline, typed API~~ — removed from the active backlog until a concrete product spec exists.
- [x] ~~Panel anatomy, tag styling, style regression, hit areas, plugins~~ — removed from the active backlog until a concrete product spec exists.
- [x] ~~Per-user isolation, universal view contract, legacy path retirement~~ — legacy-path work is now tracked concretely in `TODOs-lexera.md`; the remaining broad items are parked until they have an explicit product requirement.

- [x] ~~missing include file logged as ERROR~~ (7d0f9a68, 19cacdb3) — downgraded to warn, shown in dashboard broken elements
- [x] ~~add status informations to all views~~ (a310c52c) — generic .view-loading/.view-empty CSS system + LexeraRuntime helpers
- [x] ~~when closing a view the board re-renders~~ — investigated: no JS renderColumns() is called; the visual change is browser CSS reflow from the pane resizing, which is expected
- [x] ~~#### parsed as tag~~ (90c26251) — negative lookahead `#(?![# ])` in inlineRenderer + tagSystem
- [x] ~~log viewer layout shift on error~~ (add4c117) — error indicator flex:0 + max-width:40%
- [x] ~~can't drag cards~~ (add4c117) — restored card drag mousedown/mousemove/mouseup handlers
- [x] ~~the dashboard search tag list now supports per-workspace overrides via GET/PUT /config/dashboard-tags?workspace={id}, with 3-tier resolution (workspace > global > default)~~ (2e2c2784)
- [x] ~~Settings architecture analysis complete~~ — see [analysis-settings-architecture.md](analysis-settings-architecture.md). Audit found ~90 localStorage keys, ~20 board YAML settings, ~30 backend config fields. Proposed 3-tier resolution (board > workspace > global) and migration path.
- [x] ~~Implement settings unification: added `defaultSettings` and `workspaces[].settings` to sync.json, GET/PUT /config/settings API, 4-tier resolution in getBoardSettingValue~~ (6db5e037)
- [x] ~~browse in files settings now works — was a Tauri invoke detection issue, verified working~~ (verified)
- [x] ~~quick capture re-snaps to screen edge https://claude.ai/chat/d9c3a774-2375-4156-be3c-e6688ae60890when window goes out of monitor bounds (10s polling)~~ (this commit)
- [x] ~~quick capture focus fix: 200ms delay after creation + retry focus on macOS~~ (this commit)
- [x] ~~put the monthly and weekly calendar into separate views~~ (87ddcfdf) — standalone weekCalendar and monthCalendar panels placeable anywhere in workspace shella  q≤
- [x] ~~weekly calendar shows horizontal timeline (today+6 days); dashboard groups have fold/unfold with localStorage persistence~~ (this commit)
- [x] ~~Research: Office doc viewer for !!!include(file.docx)!!!~~ — see [research-office-doc-viewer.md](research-office-doc-viewer.md). Recommended: docx-preview (docx), SheetJS CE (xlsx), @jvmr/pptx-to-html (pptx). Total ~600KB, zero native deps, fully offline.
- [x] ~~Implement Office doc viewer: docx-preview (73KB) renders .docx inline, SheetJS CE (952KB) renders .xlsx/.xls/.ods/.csv with multi-sheet tabs~~ (cad64dfe)
- [x] ~~filename right-click: Rename, Show in Finder, Open in Default App~~ (this commit)
- [x] ~~file browse button in Files > Boards panel (uses rfd native dialog)~~ (this commit)
- [x] ~~workspace tree styling improved: rounded corners, hover backgrounds, consistent spacing, section headers~~ (this commit)
- [x] ~~files configurator fixed: delayed init after backend connects, backend settings preset includes sharing tab~~ (this commit)
- [x] ~~workspace tree navigation with drill-in/out, grouped board list~~ (5ab557aa)
- [x] ~~specs created: spec-frontend-settings.md, spec-dashboard.md~~ (181f41df, b4dd6e47)
- [x] ~~backend settings panel now shows all tabs (sharing, network, config, logs) — was only showing network~~ (this commit)
- [x] ~~v1 board filename redirect verified — saves to {name}-lexera2.md, original untouched. Rust test added~~ (3a47e9e2)
- [x] ~~double-click on link edits card, single click opens link (300ms delay)~~ (this commit)
- [x] ~~folded sidebar lock: default locked, no hover unfold. Click lock icon to toggle~~ (this commit)
- [x] ~~row/stack tags now rendered with renderTitleInline (same as columns/cards)~~ (aac6e187)
- [x] ~~tag clearing debounced (saveLocalBoardDraft was doing 3 serializations per mutation)~~ (f412b197)
- [x] ~~burger menu buttons now use standard colors even on tag-styled entities~~ (this commit)
- [x] **Dashboard Redesign** — see [spec-dashboard.md](spec-dashboard.md) for full spec. All items complete:
  - [x] ~~Upcoming events sub-groups (Overdue / Today / This Week / Upcoming / Later)~~ (91cac70e)
  - [x] ~~Todo entries section (all unchecked items via is:open search)~~ (91cac70e)
  - [x] ~~Tagged items section (configurable tags, parallel search per tag)~~ (this commit)
  - [x] ~~Calendar view (4-week grid with CW, task counts, today highlight)~~ (this commit)
  - [x] ~~Broken elements detection (scans DOM for .embed-broken/.include-broken after render)~~ (this commit)
- [x] ~~context menus restructured for card/column/stack/row — see spec~~ (5ab04402)
- [x] **Frontend Settings Redesign** — see [spec-frontend-settings.md](spec-frontend-settings.md) for full spec. All items complete:
  - [x] ~~Move visual theme, scroll/zoom speed, sidebar hierarchy out of top-right burger menu into Frontend Settings panel~~ (556d9622)
  - [x] ~~Add tag group configuration per entity type (row, stack, column, card)~~ (cafaa0ad)
  - [x] ~~Add marp/pandoc YAML + per-board layout overrides to board filename burger menu~~ (this commit)
  - [x] ~~Make Frontend Settings panel show all editor defaults (column width, tag visibility, etc.)~~ (556d9622)
  - [x] ~~Implement `getEffectiveSetting()` resolution: board override > frontend default > fallback~~ (c5aa9b50)
  - [x] ~~Add realtime sync between Frontend Settings panel, board header menu, and board filename menu via LexeraRuntime events~~ (c5aa9b50)
  - [x] ~~Persist sidebar display options (counts, presence, grips, sync) in localStorage~~ (already done)
  - [x] ~~Top-right burger: only keep quick-access items~~ (b97f4622)
- [x] ~~burger menu toggle items now show checkbox (☑/☐) for active/inactive state~~ (this commit)
- [x] ~~zoom speed options restored: logarithmic 1%-200% with 10 steps~~ (this commit)
- [x] ~~pin column headers removed — always sticky at top~~ (854e1cb0)
- [x] ~~layout rows, font settings, etc removed from top-right burger~~ (556d9622)
- [x] ~~PDF viewer overlay disabled (pointer-events:none on iframe)~~ (this commit)

## Module Runtime Migration — Harden Inter-Module Communication
Goal: migrate from ad-hoc dep injection (getters that break on copy) to the shared moduleRuntime.js infrastructure. Prevents the class of bugs where module extractions silently break live state bindings.
- [x] ~~**Phase 1**: State bridged to runtime (defineState + setState sync)~~ (aa4b2b15)
- [x] ~~**Phase 2**: Setters sync both local var + runtime.setState~~ (aa4b2b15)
- [x] ~~**Phase 3**: setState auto-emits {key}:changed events~~ (aa4b2b15)
- [x] ~~**Phase 4**: Module auto-discovery from window globals (34 modules)~~ (aa4b2b15)
- [x] ~~**Phase 5**: Startup health check logs found/missing modules~~ (aa4b2b15)
- [x] ~~**Phase 6**: All 19 dep-injected modules now use LexeraRuntime.mergeDeps (sidebarResize excluded — doesn't use _deps)~~ (d0cc797f, this commit)

### Critical
- [x] ~~Add error logging to all 13 silent `catch (_) {}` blocks across app.js, orderHelpers.js, workspaceShell.js, contextMenuBuilders.js~~ (7ce8fa09)
- [x] ~~Fix innerHTML direct copy in orderHelpers.js — replaced with DOM cloneNode-based cloneChildrenInto()~~ (this commit)
- [x] ~~Remove CSS gradients from app.css — canvas grid uses JS-generated SVG, resize handle uses solid color~~ (this commit)

### High
- [x] ~~Fix canvas pan memory leak: added detach() with removeEventListener, guard against double-attach~~ (7ce8fa09)
- [x] ~~Add race condition guards to live sync: promise-chain mutex serializes applyBoardToLiveSyncSession and flushPendingLiveSyncUpdates~~ (this commit)
- [x] ~~Convert 8 console.log calls in app.js/workspaceShell.js to proper traceFrontendAction logging~~ (7ce8fa09)

### Medium
- [x] ~~Clean up orphaned packages/src/ directory~~ (7ce8fa09)
- [x] ~~Remove obsolete root jest.config.js~~ (this commit)
- [x] ~~Update build-packages.sh — removed references to archived ludos-sync and ludos-sync-menubar~~ (this commit)
- [x] ~~Add ARIA labels to context menus (role=menu/menuitem/separator), search results (role=status/group), burger buttons (aria-haspopup=menu)~~ (this commit)
- [x] ~~Cache querySelectorAll in drag-drop hot paths — skipped: queries are contextual per drag frame, caching would be stale~~
- [x] ~~Replace JSON.parse(JSON.stringify()) deep clones with structuredClone (12 call sites across 8 files)~~ (this commit)

### Cross-platform
- [x] ~~Fix macOS-only commands: added #[cfg] platform guards to open_in_system, open_url, show_in_folder~~ (7ce8fa09)

### Backend
- [x] ~~Add capture API tests: 6 tests covering list (empty, with entries, no history), delete (success, not found, no history)~~ (this commit)

### Low
- [x] ~~Remove hardcoded Mermaid CDN URL — now configurable via localStorage `lexera-mermaid-url`~~ (this commit)
- [x] ~~Keyboard card move: Alt+Arrow moves cards between columns/positions (already implemented in keyboardNavigation.js)~~
- [x] ~~Add keyboard reorder for rows: Ctrl+Alt+Up/Down moves the focused row up/down~~ (this commit)
- [x] ~~Add keyboard reorder for columns and stacks within rows~~ (701740a9) — Ctrl+Alt+Left/Right
- [x] ~~Export dialog form inputs already have proper `<label for="">` and wrapping `<label>` associations~~ (verified)

## High Priority — Security & Reliability
- [x] ~~horizontal/vertical split dividers now share the same thin-line style as dock dividers~~ (this commit)
- [x] ~~bottom dock drop zone no longer overlapped by left/right zones — bottom has z-index priority~~ (this commit)
- [x] ~~log viewer fills dock pane height + title shows entry count~~ (fecb89e0)
- [x] ~~tab overflow dropdown + reduced close button size~~ (4ec0e383)
- [x] ~~make the drag borders between views always at least 3 pixels~~ (66249ffa)
- [x] ~~frontend settings: fixed hierarchy/editor/theme reactivity, removed diagnostics~~ (ec84756d)
- [x] ~~double clicking any title starts modifying the text.~~ (4aade867)
- [x] ~~each view must also have a close button in the top right.~~ (89dc578b)
- [x] ~~the burger menu of stacks must contain: add (column, stack before/after), rename~~ (89dc578b)
- [x] ~~drawio retry render fix — cache-buster URL parameter fixed~~ (3eaf7260)
- [x] ~~multi-window views: tabs, horizontal/vertical splits, detached windows, dock panels — already implemented in workspace shell~~
- [x] ~~render application configuration panel — draw.io, marp, pandoc, soffice, pdftoppm, mutool paths configurable via Render Applications settings panel, backed by GET/PUT /config/render-apps API, panel wired into workspace shell~~ (5f6ed8c0)
- [x] **Step 1: Auth tokens in AuthService** — server-generated bearer tokens replace query-param identity.
  - `tokens: HashMap<String, String>` (token → user_id) in AuthService
  - `register_user()` generates UUID v4 token, returns it
  - `validate_token()`, `get_token_for_user()`, `generate_token_for_user()` methods
  - `extract_bearer_token()` + updated `require_authenticated_user()` in collab_api.rs
  - Tokens persisted in auth.json (`#[serde(default)]` for backwards compat)
  - All 14 collab endpoints accept `Authorization: Bearer <token>` header
  - Register endpoint returns token in response
- [x] **Step 2: Apply auth to board endpoints** — auth middleware on all /boards/*, /config/*, /search/*, /capture/*, /events routes.
  - `auth_middleware.rs` validates bearer token (query-param fallback removed)
  - Applied via `route_layer` to authenticated route group in `api_router()`
  - Unauthenticated routes: /status, /templates, /logs, /external-embeds/probe
  - All 35+ API tests updated with bearer token auth
- [x] **Step 3: Local auto-auth** — local user always has a token on backend startup.
  - On startup, `register_user` generates token; existing users get `generate_token_for_user`
  - Auth state saved immediately after bootstrap (crash safety)
  - `GET /collab/me` returns token alongside user info for frontend use
- [x] **Step 4: Remote client auth flow** — return auth token on invite accept.
  - `accept_invite` endpoint returns `auth_token` alongside room join info
  - `register_user` response token captured by sync client (new registrations)
  - `RemoteConnectionEntry` stores `auth_token` in sync.json for reconnection
  - All sync client HTTP requests include `Authorization: Bearer <token>` header
  - WebSocket handshake uses `?token=<auth_token>` query param (validated in sync_ws.rs)
  - `reconnect_existing` passes stored auth_token; falls back to register token
  - Frontend api.js fetches token from `/collab/me` and injects `Authorization` header
  - management.js uses api adapter (auto-includes bearer token)
  - `?user=` query-param fallback fully removed from all backend endpoints and frontend
- [x] **Workspace invite ownership check** — `require_workspace_invite_permission` verifies requester owns at least one board in workspace before allowing create/list/revoke workspace invites. Returns 403 Forbidden otherwise.
- [x] **Invite system cleanup** —
  - Removed dead `email` field from `CreateInviteRequest`
  - `cleanup_expired()` already called periodically (3600s interval) and at startup (tokio interval fires first tick immediately)
  - Added `max_uses` upper bound validation (cap at 100), returns `MaxUsesTooHigh` error
- [x] **Rate limiting on collab endpoints** — auth-sensitive routes (`/users/register`, `/invites/{token}/accept`, `/connect`, `/join-public`) rate-limited to 5 req/sec via existing `RateLimiter` middleware.
- [x] **Input validation on user names** — `validate_user_name()` and `validate_user_id()` enforce: non-empty, max 200 chars, no `<`/`>` (XSS), no `..` in IDs (path traversal). Applied to `register_user` and `update_me`.

## High Priority — Media Sync
- [x] **HTTP-based media file sync between LAN peers** — implemented using existing infrastructure:
  - `GET /boards/{id}/media-manifest` endpoint returns `[{name, sha256, size}]` per file (SHA-256 via existing sha2 dep)
  - `MediaManifestEntry` + `compute_media_manifest()` + `diff_media_manifests()` in lexera-core
  - `ClientMediaManifest` / `ServerMediaManifest` WebSocket message types for real-time notification
  - `MediaChanged` board event fired after media upload, triggers sync to connected peers
  - `sync_client.rs`: initial media sync on connect, periodic sync (30s), event-driven sync on local changes
  - Bidirectional: downloads missing files via `GET /boards/{id}/media/{filename}`, uploads via multipart `POST /boards/{id}/media`
  - `ServerMediaManifest` handler diffs and downloads missing files from remote peer manifests
  - 14 new tests (11 core unit + 3 backend integration), all 903 Rust tests pass

## High Priority — Code Quality
- [x] **Extract backend lib.rs setup function** — extracted 570-line setup() closure into 8 named functions + `CollabServices` struct: `init_storage_and_boards`, `resolve_incoming`, `setup_file_watcher`, `init_collab_services`, `bootstrap_local_user`, `spawn_background_tasks`, `restore_persisted_connections`, `spawn_http_server`. All 903 Rust tests pass.
- [x] **Fix duplicate code paths producing inconsistent results:**
  - [x] **CRDT card ID collision** — replaced inline `crdt-{hex_timestamp}` ID generation in `bridge.rs:read_card()` with `crate::parser::generate_id("crdt")` which uses atomic sequence counter for guaranteed uniqueness.
  - [x] **Missing tag interactions on re-rendered cards** — added `attachRenderedTagInteractions(cardEl)` call to `renderCardDisplayState()` so tags in re-rendered cards keep click handlers.
  - [x] **Card title include resolution inconsistency** — editor title bar now uses `getIncludeResolvedContent(value, currentCardEditor.colIndex)` before extracting title, matching the initial render path.
  - [x] **SSE settings merge can't delete** — `onBoardSettingsSaved` now uses `delete fullBoardData.boardSettings[s]` when incoming value is null, matching full-reload behavior.
  - [x] **applyBoardSettings not called in rebase/live-sync paths** — added `applyBoardSettings()` before `renderColumns()` in both `applyRebasedBoardSnapshot` and `applyLiveSyncBoardSnapshot`.

## Open — Features
- [x] ~~file watcher~~ — implemented: FileWatcher in lib.rs with setup_file_watcher(), event broadcast, include-backed column refresh. Remaining: subtree-only invalidation (tracked in Phase 11)

## High Priority — Performance (Large Board Handling)
See [spec-performance.md](spec-performance.md) for full spec.
- [x] **Phase 1: Paginate & truncate API responses** — search and calendar endpoints now expose `limit` / `offset` / `truncate`, and calendar groups return the same paging metadata shape as search
- [x] **Phase 2: Tiered startup hydration** — startup-prepared board state now loads summaries/hierarchy/search metadata first, defers CRDT hydration, and lazily hydrates persisted CRDT/snapshot state on first read/edit/sync use
- [x] **Phase 3: Search index** — `BoardState` now maintains inverted candidate indexes for tags, temporal tags, checked/open state, and due buckets so `search` / `search_many` prefilter before full matching
- [x] ~~**Phase 4: Delta undo**~~ — already implemented: boardDelta.js computes structural diffs (row/column/card level), undo stack stores compact deltas not full board clones
- [x] ~~**Phase 5: Targeted DOM updates (expand)**~~ (0ba07962) — card edit, add, reorder, checkbox toggle now skip renderColumns() with targeted element updates
- [x] ~~**Phase 6: Virtual scrolling**~~ — already implemented: `LexeraVirtualScroll` activates after `renderColumns()` and virtualises large column card lists behind placeholder sentinels
- [x] **Phase 7: Delta sync on poll** — polling now requests `/boards/:id/changes?since_generation=...` first and applies compact board deltas before falling back to a full board reload
- [x] **Phase 8: Split board API contracts by use-case** — board list, hierarchy, dashboard, poll delta, and editable snapshot paths are now separated so sidebar/dashboard refreshes no longer hit the full editable board payload contract
- [x] **Phase 9: Cached board summary + hierarchy indexes** — `/boards` and `/boards/:id/hierarchy` now read maintained summary/tree data from `BoardState` instead of recomputing from full board snapshots
- [x] **Phase 10: Backend dashboard aggregation** — dashboard search/todos/tag/calendar refreshes now collapse into one backend `/dashboard/data` endpoint backed by cached board search docs
- [x] **Phase 11: Include dependency graph** — include watcher events now refresh only matching include-backed columns via `reload_board_include_path()` instead of forcing full board reloads

## Long Term — Architecture
- [x] ~~**Frontend settings model** — unified via GET/PUT /config/settings API with 4-tier resolution (board YAML > workspace > global > localStorage)~~ (6db5e037)
- [x] ~~**Frontend startup smoke tests** — startupSmoke.test.js (173 lines) verifies all scripts load and 38 modules available, plus moduleRuntime health report at startup~~ (already done)
- [x] ~~**Backend auth extractor unification** — extract_bearer_from_headers shared between auth_middleware.rs and collab_api.rs~~ (this commit)
- [x] i want you to make another test-round if all changes the user makes and applied, and that all changed data can be saved securely. it must not undo anything by mistake or ignore a change, nor must it ever loose any data! verify and give me a detailed analysis for every point that misses these requirements!
  yes fix all of them. but never implement and guards that prevent problems, allways solve the underlying problem. if you encounter guards we must remove them and solve the problam that cause them!
- [x] if a board is switched to kanban mode, the canvas mode values must not be deleted. they can stay in the values and be ignored. also when saving! (verified: parser roundtrips all params regardless of mode, test added in parser.rs — `test_canvas_params_preserved_after_kanban_mode_switch`)
- [x] ~~file watcher~~ (duplicate of L228, already implemented)
- [x] I want a web clipper similar to markdowner / Marksnip or obsidian webclipper to archive links, websites, images etc. directly into a kanban board as cards. It's should be using the same method as the quick capture. But it would also be good if it could access the browser data (cache, reader mode) (if the user is logged in somewhere or we cant access the data from playwright). What system would you suggest? 
  - ok, after searching the uer must move down with the arrows first to focus one of the results, only then does the movement within the results work. the same applies to pasting. pasting in the search will paste into the searcch field if that is selected. the currently selected content is pasted into the element on enter or on meta+v / ctrl+v . when opening the web clipper it depends on the user action. if it's an arrow movement we move within the boards, if it's pasting we paste the content into the search field as well as any letter or key other then arrow keys start the search
  - make sure the web clipper also downloads all images and replaces links and media within the document with the downloaded media!
  - reader mode content is preferred over a website content!
  - if a link on a website provides a valid rss feed, give this as an option for the user to read the content from! for example the following feed provides a valid content for the link in the first rss element!
    - https://www.reddit.com/r/IndieDev/comments/1rwey0e/the_part_nobody_sees_is_the_most_important_part/
    - https://www.reddit.com/r/IndieDev/comments/1rwey0e/the_part_nobody_sees_is_the_most_important_part.rss
- [x] combine the "Empty", "Template" and "Clipboard" into a "New". It's ordered by Row, Stack, Column, Card groups:
  - Row
    - Empty Row
    - Row templates the user has defined
  - Stack 
    - Empty Stack
    - Stack templates the user has defined
  - Column
    - Empty Column
    - Column templates the user has defined
    - Clipboard layouted as Column (handled as if it's a presentation format)
  - Card 
    - Empty Card
    - Empty Drawio Diagram
    - Empty Excalidraw Diagram
    - Clipboard layouted as Card (just the markdown content in it)
- [x] Rename the "Export All" to "Move to Archive" in the "Archive" Source
  Also Incoming should only list the contents as cards!
  The Park should be listed in a group with Incoming!
- [x] Add a tag that adds a theme based color (usualy dark more black, light mode white) (non transparent) background to a card (we need that in canvas mode)
- [x] A Row, Stack or Card should not allow !!!include(filename.md)!!! within it or it must not parse that in any way. That is only supposted to have an effect in the Column Header! Embeds ![]() only works in the Cards. 
- [x] Tags can be in all Elements (rows, stacks, columns, cards) and is even differently handled in the Card Title (first line) versus being on the normal content lines (all except the first line). in the title it applies to the whole card, on any line it's only considered for the line itself!
- [x] Before closing a board or when closing the application, it should check if it has contents in the trash or the archive. If any board has that, it should ask individually for each board wether the user wants to clean up (Empty Trash, Move to Archive). It should give the option to repeat the action for all boards!
- [x] repeat the analysis and improve the functionality! make sure the original kanban layout stays functional as it is. We call the layout types "Kanban" and "Canvas" . We mostly change the styling of the stacks, columns, cards.
  in canvas mode:
  - stacks cannot be folded
  - columns in stacks can be ordered horizontal and vertical
  - columns and cards cannot be folded
  - stacks have a defined width
  - columns behave like cards that fill up the space, they can have parts of the width (100%, 33%/66%, etc.)
  - stacks can be placed anywhere (also above behind each other). they are in order of the stacks in the source file.
  - stacks can have connections using the markdown format [#tag]{parameters like source position and target position}
  - boards have this setting individually set and it's stored in the header
  in kanban mode:
  - rows, stacks/columns, cards are placed as the version 1 structure (as the original plan)
  
  both modes:
  - are data compatible, but ignore the parameters of the other structure
- ~~incoming is allways only a card. it lists all elemtns that have been added to the board by the quick clipboard tool. if elements arent added to a specific location they are only added to the incoming (using a tag)~~ (done: ca6bc56d — quick-capture board-level paste applies #hidden-internal-incoming tag, incoming dropdown with Place/Trash actions, drag-drop target support)
- ~~remove the split view icon from the view. we just keep it in the menu bar.~~ (done: 2d3d9b42 — removed split view buttons from board header, available via native View menu)
- ~~paths of embeds within included files are relative to the include file, not the main file.~~ (done: 922d995e — adjustPathForIncludeContext converts board-relative paths to include-relative)
- ~~automatic path fix doesnt work. it doesnt seem to replace the path or re-render the board after the modification.~~ (done: 922d995e — find-file API now returns board-relative paths instead of absolute)
- ~~retry render in a drawio file doesnt render the image, and it doesnt show any logs apart from that the button is pressed!~~ (done: c1b6c0ef — forceRerender flag bypasses disk cache, added diagnostic logging)
- [x] ~~we need shortcuts to be defineable. for example meta+1 should do \n\n---:\n\n where the cursor is placed. i'd like a system as vscode has it, which is configurable.~~ (done: keybindingRegistry.js + ~/.config/lexera/keybindings.json)
- [x]~~the options what shows in the hierarchy should be in a burger menu on the top right of the hierarchy display. move the lock and the fold icons there as well!~~ (done: a7b9fe40)
- [x] if i alt click on a fold icon in the hierarchy, it should fold all children, but not the item itself (the same as in the view)! (done: ea066a8d)
- [x] ~~when i disable elements that show in the sidebar (cound, users, darg icon) it should free up space for the titles!~~ (done: d898ec74)
- ~~we want an open canvas board styling option (alternative setting to the current layout structure).~~ (done: 907fc923 + 8adaae04 — {key:value} param parser in Rust, canvas layout mode with absolute positioning, board layout toggle in Format menu)
- ~~in the open canvas mode i must be able to position the stacks anywhere on the board, not locked next to each other (or only if placed nearby). ITS an open board layout. where users can move stacks anywhere. like in miro!~~ (done: ea40f312 — canvas mode drag moves stacks freely, persists x/y as inline params)
- ~~i want the top menu bar have the following structure~~ (already done: 3-zone header layout with left=filename+file settings, middle=Empty/Template/Clipboard+separator+Incoming/Park/Archive/Trash, right=Pin Headers/Changes/Themes+Zoom/Export+Pack/burger menu. Fold all moved to native View menu per L262, processes to bottom bar per L262, burger menu scoped to style settings per L265)
- ~~smaller problems~~ (all sub-items resolved)
  - ~~the management window must have sharing as the first tab, and configuration as second!~~ (already done)
  - ~~it should open the small folded window! not the large one! but the folded app doesnt appear until i copy something!~~ (fixed: ea6215e0 — trust initial HTML strip-mode class instead of querying window.innerWidth on startup)
  - ~~the system beeps when i press escape while having the board open. why?~~ (fixed: 8abf6ee8)
  - ~~when i click outside the quick capture window it should get small immediately~~ (already done: Focused(false) handler)
  - ~~the quick capture should have written a short form of the clipbaord text in it when folded as well. vertical text!~~ (already done: strip-clip-label with writing-mode: vertical-rl and renderClipboardSummary() populates it; was invisible until L44 fix)
  - ~~also when searching the user should be able to go into elements, if the search finds a board, the user should be able to move into it's stacks/colums/cards~~ (already done: unfoldSearchTarget + focusSearchResultCard navigates through hierarchy)
  - ~~fix the structure how we define workspaces. we can create workspaces, kanban boards can be part of one or many workspaces!~~ (already done: management UI has full workspace CRUD, multi-workspace board assignment with checkboxes, default workspace selection via config_api.rs)
    - ~~the lexera kanban view can have one or multiple windows open~~ (already done: f0d93979 — Cmd+N opens new windows)
    - ~~find a solution for the management interface to solve this.~~ (already done: shared management.js with workspace tab, board assignment checkboxes)
  - ~~it might be that the background of the application is not transparent? because on the right side the rounded border shows the background, but on the left side it shows some white parts~~ (fixed: 4c065526 — added transparent: true to tauri.conf.json)
- [x] make the management interface being shared between the backend and the frontend kanban (collaboration)
- [x] make the board zoomable by scrolling. (already done: Cmd/Ctrl+Scroll zoom via nudgeUiScale)
- ~~the clipboard should only show the current level within the search and not a hierarchical display. it lists the items and if i press left it goes higher, right it goes into the objects. it should show immediately if a new item is added by cmd+v~~ (already done: V4 quick-capture uses flat level-based navigation with Left=up, Right=drill, Cmd+V=paste+reload)
- ~~the clipboard should only be a vertical line with the title of the last copy-paste value. can we somehow detect/hide passwords? it should fold similar to the columns. when unfolded it displays the same way we have right now. the user can define a default workspace which is used as board search area, if he presses left it switches to workspace selection. we must have a hierarchy stored "workspaces > kanban boards" (with the subitems > rows > stacks > columns > cards shown when going right with the cursor). the backend must store the workspaces and boards, the frontend and the clipboard accesses these settings and uses the backend to navigate the contents of the boards.~~ (already done: strip-mode vertical line with clipboard summary, looksLikePassword() hides passwords, expandPanel/collapseToStrip fold/unfold, default_workspace in config, flat navigation with Workspaces→Boards→Rows→Stacks→Columns→Cards hierarchy via buildWorkspaceItems+drillInto)
- ~~make sure the clipboard and the backend also use light / dark styles. templates that should be applied to all parts of the application. for that the backend should have a separate "configuration" which doesnt do regular maintenence and sharing aspects. the server bind address and port, as well as the identity should be there as well as the theme selection. theme should be shared among front and backend. the settings should be stored.~~ (done: ccdb7ce3 — themes.js shared via lexera-shared, kanban syncs theme with backend via GET/PUT /config/theme, all UIs use same theme)
~~in the sharing settings workspaces are defined, workspaces can contain one or more boards. boards can be defined and invitations as well as connecting to peers and joining, fix the details in the invitations, there are options that dont work. invitations should work for full workspaces, or individual boards!~~ (done: workspace invite endpoints added — create/list/revoke invites per workspace, accepting a workspace invite grants access to all boards in that workspace, management UI shows invite controls per workspace block)
- ~~we hide the clipboard history for now, we might use it later, but currently it's disabled. we show the current clipboard entry, for example if an image has been copyied (binary) we decode and show it. or if it's a link we try to open the page, whatever document it is we try to generate a preview. this is shown at the top with the cursor in the search field below. by searching we search within the activated workspaces & boards. by default downward clicks show the boards or workspaces. right clicking opens each element until we see the cards.~~ (done: 35875baa — rich clipboard preview with image display, clickable URL links, multi-line text excerpt)
~~if the clipboard is pasted:
- into a board : its placed in the incomding (same as park)
- into a row, stack, column : it's placed at the end as a card, if needed stack or columns are created to accomodate the card.
- into a card : its appended to the cards content.~~ (already done: pasteIntoSelected() in quick-capture.js handles all target types — board→first column, row/stack→resolved column, column→new card, card→append content)
- [x] integrate this https://sidemark.org/guide/examples.html or https://github.com/TheGesturalist/gest-critic-markup-kit (i actually prefer critic-markdown) (done: ea6215e0 — CriticMarkup inline rendering: {++add++}, {--del--}, {~~sub~>new~~}, {>>comment<<}, {==highlight==})
- [x] add a theme that allows setting these style settings:
  - the stack title and frame only is a line of text, as if it's on the top of the row. content below should not be indented. If it's empty we show an empty line. we show a 2 pixel dashed line below it and no other styling, except if it's defined by tags that style content.
  - stacks are separated by a vertical line of 1px solid it's at least the height of the view.
  - the columns are separated by a 2 pixel solid line.
  - the cards are separated by a 1 pixel solid line.
  - rows are sre separated by a horizontal line of 3px solid, it's at least the width of the view.
  what values do we need to make configurable for this to work.
  (done: ad8387eb — 'Lines' visual theme with line separators, no boxes)
- [x] restore the layout settings from the old version. there should be a default value settable for the stack width (which changes columns and cards as well.) but an value that can be asssigned to the stack directly to override it. we could use #width{integer} to define it using a tag. The rows could also use a similar setting where it defines a max-height for example using #height{integer}. (done: ad8387eb — #width{N} on stacks overrides column width, #height{N} on rows overrides row height, values in px)
- ~~in the packages/lexera folders work on feature parity with the code in the src folder. there is some difference as we added row, stack structures in lexera. also the splitting of features are different and a backend data realtime syncing. but for the user perspective the features must be equal.  there is a lot of features that are missing or not functioning well. do an state analysis first~~ (done: full audit completed — V2 context menus EXCEED V1 with row/stack menus, move operations, tag management, Marp directives. V1 had no row/stack/board context menus. Remaining parity items tracked as separate TODOs: file watcher L122, workspace structure L60-62, file format L106-120)
- ~~the backend needs a small interface that allows adding and removing kanban boards from/to it and of course list the ones that are currently included. it must show if users are working on them and if this machine is autoritative for the board (maybe other network relevant informations). it must communicate with the frontend when it changes this.~~ (done: 55dd8a11 — board management UI shows presence indicators (green dot + peer count) and Local/Remote authority badges, add/remove already existed)
- ~~i want to be able to setup multiple workspaces.~~ (done: workspace CRUD already existed; c9b2cd8b adds per-workspace theme and layout_preset fields, PUT /config/workspaces/{id}/appearance endpoint, management UI appearance section, kanban applies workspace theme on switch)
  - ~~each workspace has specific boards open~~ (already done: board-to-workspace assignment via management UI)
  - ~~it can have specific layouts~~ (done: c9b2cd8b — layout_preset field on WorkspaceEntry)
  - ~~it can have a specific theme~~ (done: c9b2cd8b — theme field on WorkspaceEntry, applied on workspace switch)
- [x] the file format should be changed to \                                                                
  ---\                                                                                                  
  yaml-header\                                                                                          
  ---\                                                                                                  
  # row name\                                                                                           
  ## stack name\                                                                                        
  ### column name\                                                                                      
  - [ ] card name\                                                                                      
    ...\                                                                                                
  - [ ] ...\                                                                                            
  \                                                                                                     
  all of the elements should be moveable and foldable individuall. so a row can be folded, a stack can  
  be folded and columns as well and cards. they can be dragged around and placed as needed. we will     
  think about layout options for the groups later. currently rows are horizontally listed items,        
  stacks are vertically listed items, column contain verticall listed items (the cards).
- [x] when searching allow to limit seaches for l: links
- [x] fix the font in the kanban workspace selection (font-family: inherit already present)
- [x] right clicking on board elements should allow adding row/stack/column/card which are appended after the current element. (insert-after/add-after actions already registered)
- [x] dragging an element (row/stack/column/card) from the view to the hierarchy should allow positioning it within a specific place! also dragging within the hiearchy and within the view must still work for all elements. (fixed: 55af9ab3 — board card drags now support precise between-card positioning in hierarchy; rows/stacks/columns already supported both directions)
- [x] when editing it should do the least possible changes versus non editing the same field. curently it seems to add a margin padding around the text which serves no functionality! (fixed: 3c68600b — removed 120px min-height, textarea now sizes to content, font-size inherits board setting)
- [x] the title of a row is not properly cut off. it overlaps the right burger menu. (overflow/ellipsis CSS already present)
- [x] the burger menu over an image is barely visible on hover. make it have a stronger contrast bg/fg (fixed: 15ed3d7e)
- ~~Add workspace file/media search and indexing so users can search for files across the workspace when embedding images, documents, and media into cards, with format-aware results and batch selection.~~ (done: 825b77c5 — POST /search/files endpoint with workspace/category filtering, "Files" button in card editor toolbar opens search dialog with category tabs and clickable results inserting markdown embeds)

### Native OS Menu Bar (done)
- [x] Add native OS menu bar with File, Edit, View, Go, Board, Help menus via Tauri `app_menu.rs`.
- [x] Wire all menu actions to frontend via `menu-action` event → `handleBoardAction()`.
- [x] Remove duplicate display settings from file header burger menu (now in native menus).
- [x] Fix file header menu slowness — don't block menu display on async backend refreshes.
- [x] Add Smart Paste (Shift+Cmd+V): detect clipboard content type (URL, image path, markdown, presentation slides) and paste with appropriate formatting.

### Alt+Click to Open Links and Embeds (done)
- [x] Add Alt+Click handler on rendered card content: Alt+clicking a link opens it in the system browser, Alt+clicking an image opens the file in the system app, Alt+clicking an embed opens the source file. Use the existing `openInSystem` Tauri command.

### Card Editor Improvements
- [x] Add drag-and-drop file support in the card overlay editor: dropping an image file into the editor textarea inserts a markdown image embed `![](relative-path)`, dropping other files inserts a file link. Resolve paths relative to the board file location. (resolveDropContent + uploadFileAndBuildMarkdown already implemented)
- [x] Add image paste support in the card editor: pasting an image from clipboard saves it to a media folder next to the board file and inserts the markdown image embed. (handleEditorPasteImage already implemented)

### Fold State Improvements (done)
- [x] Persist row and stack fold states across board reloads — save fold state for each element by ID in localStorage alongside the existing column/card fold state, and restore on board render.

### Layout Presets
- [x] Add named layout presets beyond Normal/Spacious — allow saving current board layout (column width, row height, spacing, font size, sticky mode) as a named preset, and loading/deleting saved presets from the Board menu or burger menu. (done: 3c68600b — save/load/delete custom presets via board context menu, stored in localStorage)

### Plugin Refactoring (app.js structural decomposition)
Specs: `packages/agent/specs/plugins/diagram/SPEC.md`, `plugins/enhancer/SPEC.md`, `ux/actions/SPEC.md`, `ux/menu-contributors/SPEC.md`, `ux/board-settings/SPEC.md`
#### Phase 1 — Standalone registries (no cross-dependencies) ✅
- [x] **Diagram Renderer Registry**: `diagramRegistry.js` — unified queue replacing hardcoded Mermaid/PlantUML.
- [x] **Content Enhancer Pipeline**: `contentEnhaNOncerRegistry.js` — priority-sorted pipeline replacing hardcoded chain.
- [x] **Action Dispatch Registry**: `actionRegistry.js` — pattern-matched dispatch replacing 5 if/else chains.
#### Phase 2 — Registry consumers (depend on Phase 1) ✅
- [x] **Menu Contributor Registry**: `menuContributorRegistry.js` — 14 contributors replacing 4 inline menu builders. Unified `showElementContextMenu()`.
- [x] **Board Settings Descriptor Registry**: `boardSettingRegistry.js` — 16 descriptors replacing 15 build*ModeItems functions + auto-wired action handlers.
#### Phase 3 — Cross-boundary (Rust + JS) ✅
- [x] **Rust Menu Simplification**: Replaced 96-arm match in `app_menu.rs` with data-driven `MENU_ACTION_MAP` const array + lookup function.

### Board Visual Theme System
- [x] Extract all layout-relevant CSS into a theme variable layer: row/stack/column/card border (style, width, color, radius), background, box-shadow, gap sizes (row-gap, stack-gap, column-gap, card-gap), inner padding, and header separator styles.
- [x] Define a "bordered" theme preset (the current look) that maps to the existing variable values — serves as the default and reference.
- [x] Define a "gap-highlight" theme preset: removes borders and box-shadows from row/stack/column/card, increases gap sizes, applies a visible accent background color to the gap areas (board body, row content, stack content, column card-list), and uses flat/borderless element surfaces.
- [x] Add theme-aware header separator styling so row/stack/column headers can switch between border-bottom dividers (bordered theme) and subtle background tint differences (gap-highlight theme).
- [x] Add theme-aware card styling so cards can switch between bordered+shadow (current) and flat/elevated-on-gap (gap-highlight) appearances while keeping tag accent borders, highlight, and focus ring behavior unchanged.
- [x] Add theme-aware drag-drop feedback: drop zone indicators, drag-over highlights, and insertion markers must remain visible and clear in both themes.
- [x] Store active theme selection in localStorage and load it on startup, applying the matching CSS variable set to `:root`.
- [x] Add a "Board Theme" submenu to the board context menu with checkmark selection between available theme presets.
- [x] Verify print CSS, filter bar, stats bar, search-replace panel, and overlay dialogs render correctly under both themes.

## Done
- [x] Reworked the board header into left file controls, middle creation/incoming controls, and right board/runtime controls.
- [x] Moved removed top-row actions into the right burger menu and kept a single `Backend Settings` entry.
- [x] Made the header fold into the compact v1 icon mode based on actual overflow instead of only fixed breakpoints.
- [x] Switched quick capture to expose workspaces at the highest level instead of boards.
- [x] Merged draw.io and Excalidraw into the normal template flow and removed the duplicate template structure.
- [x] Kept `Incoming` clipboard-fed only instead of inventing a separate "new incoming card" flow.
- [x] Restored the main row, stack, column, and card context-menu actions.
- [x] Restored parked, archived, and trash dropdown handling and drag targets for hidden-item recovery.
- [x] Ported the richer tag-style layer for borders, header/footer styling, badges, and numeric tag visuals.
- [x] Expanded v2 tag categories and tag menus toward the broader v1 category set.
- [x] Added rendered-tag click menus for filtering, search, rename, recoloring, and copy.
- [x] Stopped treating Markdown heading markers as tags while still parsing real tags inside heading lines.
- [x] Verified template inserts prompt for variables and copy companion files.
- [x] Replaced the placeholder per-element Marp menu with real Marp Classes, Colors, and Header & Footer submenus.
- [x] Added local and scoped Marp class toggles for row, stack, column, and card menus.
- [x] Added local and scoped Marp directive editing for colors, backgrounds, header, footer, and paginate.
- [x] Preserved Marp HTML comments in source while stripping them from visible labels.
- [x] Added regression coverage for HTML-comment and Marp directive helpers.
- [x] Restored board-level Marp enable/disable, presentation frontmatter, metadata, slide-settings, and styling.
- [x] Restored file-header YAML preview/copy submenu.
- [x] Added regression coverage for board-level YAML frontmatter mutation helpers.
- [x] Restored file-header Pandoc status, quick actions, output-format and page-break mutators.
- [x] Restored export-dialog persistence for Pandoc, Marp, and exclude-tag settings.
- [x] Added regression coverage for export-dialog preference helpers.
- [x] Restored archive dropdown per-item and bulk export actions, archive-file generation, and append logic.
- [x] Extended archive export formatting to cover row/stack/column/card hierarchy.
- [x] Added regression coverage for archive helpers.
- [x] Restored Marp class discovery from workspace config and theme CSS files.
- [x] Restored file-header and element-level Marp class refresh and menus.
- [x] Verified dragged template sources route through the full template application flow.
- [x] Replaced top-bar popups with draggable source-item lists and backed Incoming with quick-capture history.
- [x] Restored card/column/stack drag/drop parity with auto-creation and cleanup of unnamed containers.
- [x] Restored drag/drop feedback and hidden item drag-out capture.
- [x] Kept inline card editing open when the app loses focus.
- [x] Restored export scope selection, scope combinations, entry-point parity, and backend subset handling.
- [x] Added regression coverage for export-tree scope selection and backend subset helpers.
- [x] Restored inline Escape cancel, export presets, reset-to-custom, exclude-tags, merge-includes, and auto-export-on-save.
- [x] Restored export embed-handling, Marp browser dropdown, and link-and-asset packing with suboptions.
- [x] Added frontend export link rewriting and Tauri-backed asset copying.
- [x] Extended Share content preset with pack-all defaults.
- [x] Added shared file-format plugin registry replacing hardcoded embed detection.
- [x] Added export-time rendered embed replacement for supported file types.
- [x] Added Tauri-backed embedded-file renderer and Excalidraw SVG rendering.
- [x] Surfaced embedded renderer failures in preview placeholders and embed menus.
- [x] Added CSV table rendering to plugin pipeline.
- [x] Exposed embedded renderer availability in file-header settings menu.
- [x] Added direct Excalidraw overlay editor with file-backed save/reload.
- [x] Added TSV, RTF, and plain-text file format plugins with backend renderers.
- [x] Added regression coverage for TSV, plain-text, and RTF plugin detection.
- [x] Integrated draw.io external-edit bridge with preview refresh.
- [x] Replaced tag recoloring prompt with visual color picker popover.
- [x] Column sort UI with Title, Tag Value, and Due Date options.
- [x] Added board-level tag filtering with multi-tag AND logic and filter bar.
- [x] Added keyboard shortcuts help overlay.
- [x] Added undo/redo buttons in board header.
- [x] Added sort direction toggle with ascending/descending arrows.
- [x] Added board-level search-and-replace panel.
- [x] Added "Duplicate to Column" submenu in card context menu.
- [x] Added board statistics summary bar.
- [x] Added "Sort all cards" to row and stack context menus.
- [x] Enhanced print-friendly CSS.
- [x] Added card checklist progress badge and visual due date badge.
- [x] Replaced column width toggle with Span 1-4 submenu.
- [x] Enhanced board statistics with word count and checklist counts.
- [x] Added empty column placeholder, recent boards submenu, column WIP limits.
- [x] Added move to top/bottom, sort by due date, add card at top, copy board as markdown, paste as card.
- [x] Added plain-text overlay editor for text/config/CSV/TSV files.
- [x] Added keyboard shortcuts for focused card actions (duplicate, delete, navigate, park, edit, copy, reveal, insert, column jump).
- [x] Added Alt+Arrow card move and Space context menu shortcuts.
- [x] Added configurable tag style system with presets and per-tag/category overrides.
- [x] put another tab into the bottom bar that manages the running processes! remove the processes bar from the top bar!
- [x] remove undo/redo from the top bar! put it into the menu-bar (edit).
- [x] put the "stats" into the bottom bar using another tab! remove it from the top bar!
- [x] in the burger menu (top right) there should only be style settings (global ones for the kanban board). put everything else into the menu bars! remove things that are in the view directly and in the burger menu (show parked, show trash, rename, open folder, copy as markdown, ...)
- [x] put everything that we add into a menubar not the burger menu!
- [x] the row and stack info at the end is not needed, remove them.
- [x] can a window detect when its moved? the should immediately snap to the border when its moved in any way (dragging is not the only way).
- [x] all elements (rows, stacks, columns, cards) share the same button order! drag, title, fold, burger-menu . we remove the edit button from all!
- [x] when pressing any fold button it folds the item. if alt+pressing it folds all children!
- [x] the border lines should use the full height for rows (vertical row separators) and be at least the full height of the view (apart from the margins)
- [x] the burger menu next to the filename and the burger menu to the right in the top bar have overlapping items. we dont need them multiple times.
- [x] ADD additional features to the menu bar! do you understand what the menu bar is!?! it's the os options bar!on windows it's within the window, on osx it's in the top left of the window! Any additional features not directly in the view and placed there! DO NOT ANY FEATURES IN THE WINDOW UNLESS I TELL YOU TO DO SO!
- [x] put as many features of the general features (not the location specific ones such as row, stack, column, card burger menu) to the menu-bar!
- [x] make all icons within buttons the same size. some are very small others are quite big!
- [x] there should be no left border on a row!
- [x] the burger menu next to the filename is not working reliably. maybe it's so slow, or the button clicks dont allways react. it seems to open an external programm sometimes when i click it (the draw.io.app)
- ~~i want to be able to open 2 windows at once!~~ (done: f0d93979 — Cmd+N opens new windows, menu events route to focused window, secondary windows close normally)
- [x] remove the "collapse or expand all cards" and the "fold/unfold all columns" from the top bar and put it into a menu-bar option.

### Shared Code / Package Boundaries
- [x] **Stop importing package source across package boundaries** — done: the web clipper now imports `@ludos/shared` through the package entrypoint and build contract instead of reaching into `packages/shared/src`.

## Additional Completed Items

- ~~remove the split view icon from the view. we just keep it in the menu bar.~~ (done: 2d3d9b42 — removed split view buttons from board header, available via native View menu)
- ~~paths of embeds within included files are relative to the include file, not the main file.~~ (done: 922d995e — adjustPathForIncludeContext converts board-relative paths to include-relative)
- ~~automatic path fix doesnt work. it doesnt seem to replace the path or re-render the board after the modification.~~ (done: 922d995e — find-file API now returns board-relative paths instead of absolute)
- ~~retry render in a drawio file doesnt render the image, and it doesnt show any logs apart from that the button is pressed!~~ (done: c1b6c0ef — forceRerender flag bypasses disk cache, added diagnostic logging)
- ~~we want an open canvas board styling option (alternative setting to the current layout structure).~~ (done: 907fc923 + 8adaae04 — {key:value} param parser in Rust, canvas layout mode with absolute positioning, board layout toggle in Format menu)
- ~~in the open canvas mode i must be able to position the stacks anywhere on the board, not locked next to each other (or only if placed nearby). ITS an open board layout. where users can move stacks anywhere. like in miro!~~ (done: ea40f312 — canvas mode drag moves stacks freely, persists x/y as inline params)
- ~~i want the top menu bar have the following structure~~ (already done: 3-zone header layout with left=filename+file settings, middle=Empty/Template/Clipboard+separator+Incoming/Park/Archive/Trash, right=Pin Headers/Changes/Themes+Zoom/Export+Pack/burger menu. Fold all moved to native View menu per L262, processes to bottom bar per L262, burger menu scoped to style settings per L265)
- ~~smaller problems~~ (all sub-items resolved)
  - ~~the management window must have sharing as the first tab, and configuration as second!~~ (already done)
  - ~~it should open the small folded window! not the large one! but the folded app doesnt appear until i copy something!~~ (fixed: ea6215e0 — trust initial HTML strip-mode class instead of querying window.innerWidth on startup)
  - ~~the system beeps when i press escape while having the board open. why?~~ (fixed: 8abf6ee8)
  - ~~when i click outside the quick capture window it should get small immediately~~ (already done: Focused(false) handler)
  - ~~the quick capture should have written a short form of the clipbaord text in it when folded as well. vertical text!~~ (already done: strip-clip-label with writing-mode: vertical-rl and renderClipboardSummary() populates it; was invisible until L44 fix)
  - ~~also when searching the user should be able to go into elements, if the search finds a board, the user should be able to move into it's stacks/colums/cards~~ (already done: unfoldSearchTarget + focusSearchResultCard navigates through hierarchy)
  - ~~fix the structure how we define workspaces. we can create workspaces, kanban boards can be part of one or many workspaces!~~ (already done: management UI has full workspace CRUD, multi-workspace board assignment with checkboxes, default workspace selection via config_api.rs)
    - ~~the lexera kanban view can have one or multiple windows open~~ (already done: f0d93979 — Cmd+N opens new windows)
    - ~~find a solution for the management interface to solve this.~~ (already done: shared management.js with workspace tab, board assignment checkboxes)
  - ~~it might be that the background of the application is not transparent? because on the right side the rounded border shows the background, but on the left side it shows some white parts~~ (fixed: 4c065526 — added transparent: true to tauri.conf.json)
- ~~the clipboard should only show the current level within the search and not a hierarchical display. it lists the items and if i press left it goes higher, right it goes into the objects. it should show immediately if a new item is added by cmd+v~~ (already done: V4 quick-capture uses flat level-based navigation with Left=up, Right=drill, Cmd+V=paste+reload)
- ~~the clipboard should only be a vertical line with the title of the last copy-paste value. can we somehow detect/hide passwords? it should fold similar to the columns. when unfolded it displays the same way we have right now. the user can define a default workspace which is used as board search area, if he presses left it switches to workspace selection. we must have a hierarchy stored "workspaces > kanban boards" (with the subitems > rows > stacks > columns > cards shown when going right with the cursor). the backend must store the workspaces and boards, the frontend and the clipboard accesses these settings and uses the backend to navigate the contents of the boards.~~ (already done: strip-mode vertical line with clipboard summary, looksLikePassword() hides passwords, expandPanel/collapseToStrip fold/unfold, default_workspace in config, flat navigation with Workspaces→Boards→Rows→Stacks→Columns→Cards hierarchy via buildWorkspaceItems+drillInto)
- ~~make sure the clipboard and the backend also use light / dark styles. templates that should be applied to all parts of the application. for that the backend should have a separate "configuration" which doesnt do regular maintenence and sharing aspects. the server bind address and port, as well as the identity should be there as well as the theme selection. theme should be shared among front and backend. the settings should be stored.~~ (done: ccdb7ce3 — themes.js shared via lexera-shared, kanban syncs theme with backend via GET/PUT /config/theme, all UIs use same theme)
~~in the sharing settings workspaces are defined, workspaces can contain one or more boards. boards can be defined and invitations as well as connecting to peers and joining, fix the details in the invitations, there are options that dont work. invitations should work for full workspaces, or individual boards!~~ (done: workspace invite endpoints added — create/list/revoke invites per workspace, accepting a workspace invite grants access to all boards in that workspace, management UI shows invite controls per workspace block)
- ~~we hide the clipboard history for now, we might use it later, but currently it's disabled. we show the current clipboard entry, for example if an image has been copyied (binary) we decode and show it. or if it's a link we try to open the page, whatever document it is we try to generate a preview. this is shown at the top with the cursor in the search field below. by searching we search within the activated workspaces & boards. by default downward clicks show the boards or workspaces. right clicking opens each element until we see the cards.~~ (done: 35875baa — rich clipboard preview with image display, clickable URL links, multi-line text excerpt)
~~if the clipboard is pasted:
- ~~in the packages/lexera folders work on feature parity with the code in the src folder. there is some difference as we added row, stack structures in lexera. also the splitting of features are different and a backend data realtime syncing. but for the user perspective the features must be equal.  there is a lot of features that are missing or not functioning well. do an state analysis first~~ (done: full audit completed — V2 context menus EXCEED V1 with row/stack menus, move operations, tag management, Marp directives. V1 had no row/stack/board context menus. Remaining parity items tracked as separate TODOs: file watcher L122, workspace structure L60-62, file format L106-120)
- ~~the backend needs a small interface that allows adding and removing kanban boards from/to it and of course list the ones that are currently included. it must show if users are working on them and if this machine is autoritative for the board (maybe other network relevant informations). it must communicate with the frontend when it changes this.~~ (done: 55dd8a11 — board management UI shows presence indicators (green dot + peer count) and Local/Remote authority badges, add/remove already existed)
- ~~i want to be able to setup multiple workspaces.~~ (done: workspace CRUD already existed; c9b2cd8b adds per-workspace theme and layout_preset fields, PUT /config/workspaces/{id}/appearance endpoint, management UI appearance section, kanban applies workspace theme on switch)
  - ~~each workspace has specific boards open~~ (already done: board-to-workspace assignment via management UI)
  - ~~it can have specific layouts~~ (done: c9b2cd8b — layout_preset field on WorkspaceEntry)
  - ~~it can have a specific theme~~ (done: c9b2cd8b — theme field on WorkspaceEntry, applied on workspace switch)
- ~~Add workspace file/media search and indexing so users can search for files across the workspace when embedding images, documents, and media into cards, with format-aware results and batch selection.~~ (done: 825b77c5 — POST /search/files endpoint with workspace/category filtering, "Files" button in card editor toolbar opens search dialog with category tabs and clickable results inserting markdown embeds)

## Session 2026-03-30

- [x] ~~stack delete not removing until re-render~~ (c6d98022) — wrong variable names in DOM selector
- [x] ~~dropdown menus broken~~ (0938d5cb) — restored missing HiddenItemsDropdown.init() call
- [x] ~~tab too wide when single board~~ (69e0c590) — .ws-view-title flex:0 1 auto instead of 1 1 auto
- [x] ~~Export: target folder, browse button, Save→Export~~ (b0b8de9c) — default to {board-folder}/_Export, browse_folder Tauri command, label fixed
- [x] ~~canvas drag logging spam~~ (69e0c590) — ResizeObserver debounced timer now also checks for active drag
- [x] ~~board switch lockup~~ (ce4201a0, dcbfeb1f) — dashboard refresh deferred after loadBoard, iframe cascade prevented
- [x] ~~dashboard tag tree indentation~~ (ce4201a0) — section header padding aligned with tree nodes
- [x] ~~unified hierarchical display style~~ (04733655) — hierarchical.css with shared base classes, dashboard tree aligned to tokens
- [x] ~~visual theme not propagating to board iframes~~ (c1ba4713) — broadcasts data-visual-theme to all iframes
- [x] ~~stats tab empty in logs~~ (c6d98022) — removed from index.html + sharedPanels.js
- [x] ~~**Repository promotion**~~ (a681e184) — root package.json cleaned (211KB → 370B), VS Code extension manifest removed
- [x] ~~**Style token file**~~ (2917651e) — tokens.css with typography, spacing, control size tokens. 112 font-size declarations migrated.
- [x] ~~**Unify theme systems**~~ (7b79ca3d) — themes.js colors only, visualThemes.js board style only, workspace appearance maps to board style IDs, --font-ui from tokens.css

## Verified 2026-03-31

- [x] ~~gap theme padding 8px~~ — already has `padding: 8px !important` in app.css
- [x] ~~backend settings not showing~~ — ManagementUI.init with error handling already in place
- [x] ~~workspace appearance not modifying kanban theme~~ — visual theme system + palette tokens implemented
- [x] ~~delete row not working~~ — deleteRow() uses correct variable names, has confirmation dialog
- [x] ~~dashboard hierarchical indentation~~ — tree CSS with .tree-indent, .tree-node implemented
- [x] ~~hierarchy in workspaces not showing~~ — sidebar tree rendering + drag/reorder handlers present

## Session: Architecture + Performance + Features
- [x] ~~Dashboard scope~~ (35db71de), ~~reorderBoards crash~~ (cd849d0a), ~~board reorder~~ (16494248)
- [x] ~~SettingsStore~~ (ac3103cb) — 32+ keys, 15 modules migrated, 128 calls
- [x] ~~Parser shared fixtures~~ (69946a76) — 7 fixtures validated against Rust parser
- [x] ~~View states extended~~ (1b2b5d95) — .view-error + .view-disconnected
- [x] ~~Special characters~~ (77f416a2), ~~marp toggle removed~~ (5054580d)
- [x] ~~Config dialog~~ (5fdd8c8a), ~~board clipping~~ (0d5f2476), ~~log status bar~~ (e4d95166)
- [x] ~~Dashboard chip buttons~~ (a03a776c), ~~theme test fix~~ (c73ab47c)
- [x] ~~Fold hover + cached sizing~~ (ee6be11a)
- [x] ~~Dashboard list rebuild cache~~ (b79f437a)
- [x] ~~Mirror cloning skip invisible~~ (944ddb3e)
- [x] ~~Broken scan deferred + inventory cached~~ (92606536)
- [x] ~~Polling UI churn~~ (e18b429a)
- [x] ~~Embedded iframe interval~~ (6208eb5d)
- [x] ~~Post-render passes batched~~ (be73e721)
- [x] ~~Board-load payload trimmed~~ (d05652c7)
- [x] ~~File search cache~~ (c7591137)
- [x] ~~Include-watch incremental~~ (ea004b74)
- [x] ~~Sidebar tree incremental~~ (0ae134e2)
- [x] ~~Dashboard preview lightweight~~ (dcb2dafe)
- [x] ~~Drag geometry cached~~ (9b6ac7cc)
- [x] ~~Perf audit fixes~~ (ff4942ed) — cheap hash, broken scan race fix
- [x] ~~Embedded iframe poll reduced~~ (6208eb5d)
- [x] ~~Post-render passes batched~~ (be73e721)
- [x] ~~Board-load payload trimmed~~ (d05652c7)
- [x] ~~File search cache~~ (c7591137)
- [x] ~~Include-watch incremental~~ (ea004b74)
- [x] ~~Targeted board patching~~ (efb021c3, 4023fb42)
- [x] ~~Virtual-scroll incremental~~ (ae32d04b)
- [x] ~~Shell panel overhead~~ (04e8506a)
- [x] ~~Dashboard speed~~ (fd72b2ba)
- [x] ~~Parallel polling~~ (cb169b9b)

## Session: Architecture + UI
- [x] ~~ViewStateStore~~ (44ca0f88)
- [x] ~~ConfigService~~ (4327c6ac)
- [x] ~~Style layers~~ (d8f198e6)
- [x] ~~Board settings extracted~~ (156d57f2)
- [x] ~~Shared packages unified~~ (1609fb40)
- [x] ~~Function catalog~~ (f67eb8ea)
- [x] ~~Workspace config icons removed~~ (59ae86bf)
- [x] ~~Hierarchy tree lines improved~~ (b75a9edc)
- [x] ~~Broken elements focus fixed~~ (342df375)
- [x] ~~Hierarchy context menu~~ (cab7dfe4)

## Archived During Frontend Test Sprint — 2026-04-08

### Frontend test additions (implemented in frontendTests.js)
- [x] Same-column reorder: last card moves to start
- [x] Cross-column move: inserted card asserted first in target column
- [x] Source-column card order remains stable after moving first card out
- [x] `setTestBoard(...)` rerenders row and column counts to match `fullBoardData`
- [x] Add empty column renders with expected `data-column-id`
- [x] Add row with multiple columns renders both row and nested column structure
- [x] Remove empty column disappears from board view and sidebar
- [x] Remove empty row disappears from board view
- [x] `#hidden-internal` cards excluded from visible DOM card counts
- [x] View/sidebar consistency after removing a card
- [x] View/sidebar consistency after adding a column
- [x] View/sidebar consistency after adding a row
- [x] Column identity stays stable after card move
- [x] Total column count stays constant after card moves
- [x] Total row count stays constant after card moves
- [x] Dashboard refresh scheduled after add/remove/move card, add column, add row
- [x] Temporal tags (#today, #tomorrow, #yesterday, #week, date(...)) render and classify correctly
- [x] Cards with temporal tags consistent across board view, sidebar, and dashboard

### Bug investigations
- [x] View→workspace drag bug: root cause found in `dragDropHandlers.js` `resolveCardDropTarget()` — sidebar drops use `getVisibleCardCountInColumn()` (always appends to end) instead of `findCardInsertIndex(mouseY)` like main view
- [x] BeforeDevCommand error: missing react UMD file from node_modules

### Frontend integration test infrastructure (completed)
- [x] Exposed test API on `window.LexeraTestApi`: `setTestBoard`, `moveCard`, `getActiveBoardId`, `loadBoard`, `renderColumns`, `selectBoard`, `addCardToActiveBoard`, `getAllFullColumns`, `getFullColumn`, `getTemporalTagType`, `describeTemporalTag`, `resolveTemporalTag`
- [x] Created `src/test/frontendTests.js` — 63-test suite with `register()`, `runAll()`, `run(name)`, UI panel, result copy
- [x] Same-board card moves: same-column reorder (first→last, last→first), cross-column, workspace→view, view→workspace, workspace→workspace
- [x] Structural mutations: add/remove card, add/remove column, add/remove row, multi-column row
- [x] Sidebar tree sync after all mutation types
- [x] Render integrity: no duplicate IDs, total card count constant, column/row count stability, column identity stability
- [x] Data integrity: getAllFullColumns, getFullColumn bounds, DOM↔data parity, unique IDs
- [x] Hidden-internal card filtering (archived + deleted excluded from DOM)

## Archived During Sessions — 2026-04-09

### Frontend tests (additional batches)
- [x] Create new row/stack/column/card actions create entities in data, DOM, sidebar, dashboard
- [x] Moving entities to Trash/Archive/Park/Incoming updates visibility and derived surfaces
- [x] Marp export tests: succeeds, preserves content, reflects ordering
- [x] Dashboard search results update after setTestBoard mutations
- [x] Dashboard queries scoped to active board stay in sync
- [x] Time-tag parsing correct across date boundaries (explicit formats, minute slots, weekday-is-future, days±N equivalence)
- [x] Burger-menu test helper exposed for dispatching actions without native menu automation

### Bug fixes
- [x] View→workspace drag bug fixed in `dragDropHandlers.js` — `findSidebarCardInsertIndex()` respects mouse Y
- [x] tree-children-guide extra separator line fixed in sleek theme CSS
- [x] Include-link auto-rewrite: `setColumnIncludePath` now triggers `loadBoard()` after path change
- [x] Stack include text clearing: inline edit strips `!!!include(...)!!!` syntax, handles empty results

### CSS simplification
- [x] Fix font-size dual-variable problem — removed redundant per-element declarations where containers inherit
- [x] Replace 86 hardcoded px font-sizes with CSS variables
- [x] Remove 6 unused CSS variables
- [x] Merge duplicate selectors
- [x] Shrink sleek theme (1,310 → 1,205 lines) via `:is()` mega-resets
- [x] Unify visual styles — consolidated menu-item/danger/divider, removed redundant icon button overrides
- [x] Unify icon sizes on `--icon-glyph-size`, made remaining px font-sizes respect `--ui-scale`

### JS simplification
- [x] Extract action registry config → `core/actionRegistrations.js` (830 lines), app.js reduced by 630 lines
- [x] Create state key registry — 40 localStorage keys documented in `shared/stateKeyRegistry.js`
- [x] Create StateManager facade — `shared/stateManager.js` wraps Settings Store + localStorage
- [x] Audit event listener lifecycle — 0 active leaks, report in `shared/eventListenerAudit.md`

### Hierarchy unification (Phase 1)
- [x] Consolidate `createHierarchyNode()` — already in `hierarchyContract.js`
- [x] Consolidate title helpers — already in `titleHelpers.js` and `tagSystem.js`
- [x] Standardize nav-target extraction — investigated: 3 fundamentally different data shapes, current separation appropriate
