# Lexera Kanban Todo

## High Priority — Security & Reliability

- [ ] horizontal dont look and behave the same as vertical moveable borders between views! they should share the style!

- [ ] i currently cant put the log viewer into the window bottom when the view is split with the left/right panes, i can only split the kanban/canvas views top/bottom. when very close (~6pix) to the window borders allways snap to the border areas.

- [ ] the log viewer should show the number of logs that fit into the view. it's current limited in height.

- [x] ~~tab overflow dropdown + reduced close button size~~ (4ec0e383)

- [x] ~~make the drag borders between views always at least 3 pixels~~ (66249ffa)

- [x] ~~frontend settings: fixed hierarchy/editor/theme reactivity, removed diagnostics~~ (ec84756d)

- [x] ~~double clicking any title starts modifying the text.~~ (4aade867)

- [x] ~~each view must also have a close button in the top right.~~ (89dc578b)

- [x] ~~the burger menu of stacks must contain: add (column, stack before/after), rename~~ (89dc578b)

- [x] ~~drawio retry render fix — cache-buster URL parameter fixed~~ (3eaf7260)

- [ ]  i want the views (kanban view or canvas view) to be able to be individual windows. when a new board is opened its opening a new tab, when i drag a tab out of the window, it creates a separate window. the tabs can be modularely placed  so the view is for example split vertically or horizontally! this is a major refactor, do a deep analysis first!

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

- [ ] **Frontend modularization** — app.js reduced from 28K to ~16.5K lines (41% reduction). Extracted: loggingSystem.js, virtualScroll.js, pathUtils.js, tagColors.js, dropZoneIndicators.js, archiveFormatting.js (4aade867), sidebarResize.js (0b8c1442), exportToolStatus.js (5f6ed8c0), renderAppsSettings.js (5f6ed8c0), boardSearchReplace.js (4a40e43c), boardStatsFilter.js (0165eec3), hiddenItemsDropdown.js (53e2f15c), cardContentRenderer.js (56b557c7), inlineCardEditor.js (56b557c7), embedEnhancer.js (56b557c7), canvasLayout.js (28abc26e), contextMenuBuilders.js (a72a6f55), dragDropHandlers.js (a812bd68), sidebarSync.js (084bc543), orderHelpers.js (3d6b4a6d), embedMenu.js (649926c1), keyboardNavigation.js (2d223eda), boardList.js (85999a98). Previously: foldState.js, boardNavigation.js, sidebarTree.js, tagSystem.js. Next targets: canvas pan, card editing, card context menu, column context menu, row/stack context menus, search.

- [x] **Fix duplicate code paths producing inconsistent results:**
  - [x] **CRDT card ID collision** — replaced inline `crdt-{hex_timestamp}` ID generation in `bridge.rs:read_card()` with `crate::parser::generate_id("crdt")` which uses atomic sequence counter for guaranteed uniqueness.
  - [x] **Missing tag interactions on re-rendered cards** — added `attachRenderedTagInteractions(cardEl)` call to `renderCardDisplayState()` so tags in re-rendered cards keep click handlers.
  - [x] **Card title include resolution inconsistency** — editor title bar now uses `getIncludeResolvedContent(value, currentCardEditor.colIndex)` before extracting title, matching the initial render path.
  - [x] **SSE settings merge can't delete** — `onBoardSettingsSaved` now uses `delete fullBoardData.boardSettings[s]` when incoming value is null, matching full-reload behavior.
  - [x] **applyBoardSettings not called in rebase/live-sync paths** — added `applyBoardSettings()` before `renderColumns()` in both `applyRebasedBoardSnapshot` and `applyLiveSyncBoardSnapshot`.

## Open — Features

- [ ] file watcher, but we need a strong change handling from either user changes and file system (data storage backend) changes. plan with a multi-user system in mind and a system that is safe to never lose any data. it uses the known system of main file, included file we have in the version 1 system.

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

- [ ] **Repository promotion** — move packages/ to top-level structure (see packages/todo.md for full plan)
- [ ] **Frontend build pipeline** — replace script-tag loading with module bundler (blocked by app.js monolith split)
- [ ] **Plugin architecture** — unify plugin registration across kanban, backend, shared (manifests, not hardcoded lists)
- [ ] **Board schema centralization** — single canonical schema for rows, stacks, columns, cards, settings, metadata
- [ ] **Storage abstraction** — replace broad BoardStorage trait with narrower capability-focused services




- [x] i want you to make another test-round if all changes the user makes and applied, and that all changed data can be saved securely. it must not undo anything by mistake or ignore a change, nor must it ever loose any data! verify and give me a detailed analysis for every point that misses these requirements!
  yes fix all of them. but never implement and guards that prevent problems, allways solve the underlying problem. if you encounter guards we must remove them and solve the problam that cause them!


- [x] if a board is switched to kanban mode, the canvas mode values must not be deleted. they can stay in the values and be ignored. also when saving! (verified: parser roundtrips all params regardless of mode, test added in parser.rs — `test_canvas_params_preserved_after_kanban_mode_switch`)

- [ ] file watcher, but we need a strong change handling from eigther user changes and file system (data storage backend) changes. plan with a multi-user system in mind and a system that is save to never loose any data. it uses the known system of main file, included file we have in the version 1 syste

- [x] I want a web clipper similar to markdowner / Marksnip or obsidian webclipper to archive links, websites, images etc. directly into a kanban board as cards. It's should be using the same method as the quick capture. But it would also be good if it could access the browser data (cache, reader mode) (if the user is logged in somewhere or we cant access the data from playwright). What system would you suggest? 
  - ok, after searching the uer must move down with the arrows first to focus one of the results, only then does the movement within the results work. the same applies to pasting. pasting in the search will paste into the searcch field if that is selected. the currently selected content is pasted into the element on enter or on meta+v / ctrl+v . when opening the web clipper it depends on the user action. if it's an arrow movement we move within the boards, if it's pasting we paste the content into the search field as well as any letter or key other then arrow keys start the search
  - make sure the web clipper also downloads all images and replaces links and media within the document with the downloaded media!
  - reader mode content is preferred over a website content!
  - if a link on a website provides a valid rss feed, give this as an option for the user to read the content from! for example the following feed provides a valid content for the link in the first rss element!
    - https://www.reddit.com/r/IndieDev/comments/1rwey0e/the_part_nobody_sees_is_the_most_important_part/
    - https://www.reddit.com/r/IndieDev/comments/1rwey0e/the_part_nobody_sees_is_the_most_important_part.rss

- [ ] I am planning on adding other sources that could be used to directly integrate date into the kanban baords. Ideas that pop up are: RSS, EMail, Filesystem. 

- [ ] An mobile web clipper (something that can run on an ios and or android) would be best as well.

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

## Style Simplification Todo

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
## Interface Quality Standardization Todo

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
## Application Spacing Unification Todo

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
