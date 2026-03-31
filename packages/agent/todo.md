# Lexera Kanban Todo

## Bugs
- [x] ~~Dashboard scope~~ (35db71de) — defaults to all in workspace shell mode
- [x] ~~reorderBoards crash~~ (cd849d0a) — guard against non-array boards dep
- [ ] changing the order of boards in the workspace view isnt working.

## Active Features
- [ ] Add pptx rendering (needs esbuild bundle of @jvmr/pptx-to-html)
- [ ] Mobile web clipper — finish lexera-capture-ios

- [ ] the dashboard takes long to populate. can we somehow massively improve that?
- [ ] could the tauri frontend benefit from parallel requests and processing? i think it's slow in a lot of areas, but i am unsure what the best approach is to increase performance 10fold!

- [ ] create a list of functions we have in the code and make a short description for each. who uses it, what it does what is it calling. in a second iteration compare all features and check for refactoring opportunities of the code!

## Code Quality
- [ ] **App.js modularization** — 11,927 lines (down from 25K+). Remaining: Main View (~6600 lines core rendering) is the only major section left. All small sections extracted.

## Performance — Do Next
- [ ] **Replace full board rerenders with targeted patching** — `renderColumns()` still clears and rebuilds the entire board DOM for many small mutations. Add row/stack/column/card-level patch rendering so edits do not pay full-board cost.
- [ ] **Stop rebuilding the full board/workspace sidebar tree on routine refreshes** — `renderBoardList()` clears and rebuilds the entire hierarchy, and hierarchy hydration can trigger more rerenders while polling. Make sidebar updates keyed and incremental.
- [x] ~~**Fold hover stop rerendering + cached sizing**~~ (ee6be11a) — DOM class toggle instead of rerenderDockTree(), cached pre-fold dimensions instead of forced max-content measurement
- [ ] **Make folded dashboard preview lightweight** — hovering the folded dashboard currently reattaches a large live dashboard DOM subtree into the dock preview. Add a lighter preview path or keep the panel mounted so hover does not move and rebuild the whole dashboard surface.
- [x] ~~**Stop full dashboard list rebuilds**~~ (b79f437a) — fingerprint-based render cache skips unchanged section rebuilds
- [x] ~~**Reduce mirrored dashboard cloning**~~ (944ddb3e) — skip invisible mirrors, mark stale, flush on tab activation
- [x] ~~**Broken-element scan deferred + dashboard refresh separated**~~ (92606536) — requestIdleCallback for DOM scan, file inventory skip-when-clean, dirty-flag system
- [x] ~~**Reduce polling UI churn**~~ (e18b429a) — fingerprint change detection for workspaces/boards/remote, skip redundant renders
- [x] ~~**Embedded iframe poll interval reduced**~~ (6208eb5d) — embedded mode already skipped heavy polls; interval reduced from 5s to 15s
- [ ] **Rework drag/drop hit-testing and layout locking for large boards** — pointer drag currently locks many board nodes, inserts indicators, and repeatedly scans live DOM geometry on global `mousemove`. Cache geometry per drag and avoid full-board queries per move.
- [ ] **Reduce workspace shell panel move/iframe overhead** — shell tab and dock rendering still moves panel DOM around and keeps iframe-backed board views. Cut DOM shuffling on tab activation and continue the path away from iframe-based in-window composition.
- [ ] **Collapse post-render board enhancement passes** — after each board rebuild the frontend re-runs embed enhancement, tag visibility, comment visibility, row-width syncing, and virtual-scroll activation over the rendered subtree. Combine or defer these passes so a single render does not trigger several full DOM scans.
- [ ] **Make virtual-scroll activation incremental** — current activation scans every `.column-cards`, measures every card height, and installs observers after major renders. Avoid a full-card measurement pass when only a small part of the board changed.
- [x] ~~**Trim duplicate board-load payloads**~~ (d05652c7) — removed unused columns field from /boards/{id}/columns response; frontend only uses fullBoard
- [ ] **Parallelize or cache backend file metadata scans** — `/boards/{id}/file-info-batch` resolves and stats paths one-by-one, and `/search/files` recursively walks directories on every request. Add batching, caching, and smarter invalidation for large media-heavy workspaces.
- [ ] **Stop full include-watch resync after every file-watcher event** — backend watcher handling currently re-syncs all include watch paths after board/include reloads. Update include watches incrementally so large include graphs do not pay repeated full rescan cost.

## Misc
- [x] ~~Color theme integrated into visual theme~~ (7c212e7c)
- [x] ~~Overlay editor always available~~ (709cdae2) — setting controls default only, never blocks
- [x] ~~Overlay editor activation from settings~~ (709cdae2) — double-click + Enter respect setting
- [x] ~~#exclude diagonal hatching~~ (fd8ee2e9) — SVG hatch pattern at 20% opacity
- [x] ~~show special characters~~ (77f416a2) — visible whitespace markers (·→¶) in card content

- [x] ~~remove marp settings toggle~~ (5054580d) — option removed, marp always enabled, all functionality intact

- [x] ~~Integrated config dialog~~ (5fdd8c8a) — hierarchical workspace→board tree + inspector. Make the files and boards configuration more integrated. Remember this config dialogue is shared between front and backend and must function within both views!
  - on the left side there is a hierarchical display of the workspaces under the workspaces boards can be added. boards can be added to multiple workspaces.
  - when a markdown file is dragged into the config hierarchy it's added to the workspace. By default there is a "default" workspace. More workspaces can be added by pressing a "+ add workspace button" at the end of the hierarchy. the workspace order can be adjusted. the top workspace is the default workspace that is opened if nothing else is defined (restore last session is default). this hierarchy also corresponds to the hierarchy in the lexera frontend (however in the lexera frontend it also shows sub-elements such as rows, stacks, columns and cards), in the config view it only shows workspaces and boards.
  - on the right side is the config inspector. the item (workspace or board) selected on the left side can be configured.
  - config values are:
    generally backend settings, nothing relevant to the frontend or user specific. (remember this for the specs)
    - for workspaces
      - bookmark sync
      - calendar sync
      - invited users
    - for boards
      - bookmark override values (change defaults from workspace)
      - calendar override values (change defaults from workspace)
      - other backend relevant settings (not frontend or user specific settings)

- [x] ~~board visibility clipping~~ — already fixed, content scrolls past viewport width

- [x] ~~folded log status bar~~ (e4d95166) — shows [●] Connected | log count | user count | pending API calls when folded



## Disk / IO Audit — Do Next
- [x] ~~**Log rotation + retention**~~ (7c614dcb) — 10MB size limit, 2 rotated files, startup rotation
- [x] ~~**Lower log volume**~~ (7c614dcb) — noisy targets (tracing::span, loro_internal, storage) filtered to warn
- [x] ~~**Buffered writes**~~ (7c614dcb) — BufWriter, flush every 100 lines or 2s periodic
- [x] ~~**Measure + clean draft storage**~~ (56485a2c) — WebKit localStorage at ~/Library/WebKit/lexera-kanban/ = 2.1MB. Added pruneOrphanedDrafts to clean drafts for removed boards.
- [x] ~~**Write counters**~~ (b975861f) — write_count, skipped_write_count, last_write_time exposed via /diagnostics/disk
- [x] ~~**Reduce board-save amplification**~~ (ed9cdfec) — main file, include files, and CRDT now skip writes if content unchanged (hash compare before write)
- [x] ~~**Write-loop detection**~~ (b975861f) — write counters visible in diagnostics endpoint
- [x] ~~**Crashsave retention**~~ (ed9cdfec) — rotate_crashsaves keeps max 5 per board, list_crashsaves + 2 new tests
- [x] ~~**Disk diagnostics endpoint**~~ (b975861f) — GET /diagnostics/disk returns log, backup, crashsave, CRDT sizes

## Architecture — Do Next
- [x] ~~**SettingsStore**~~ (ac3103cb) — centralized typed localStorage API, 32+ key definitions, per-board keys, change listeners. 15 modules migrated, 128 SettingsStore calls.
- [ ] **ViewStateStore** — replace remaining ad-hoc closure vars for UI state (searchMode, isEditing, connected) with observable store.
- [ ] **Unify shared packages** — merge or clearly separate packages/shared (TS types) vs packages/lexera-shared (browser JS/CSS). Replace copy-based sync-runtime-assets.mjs with real package.
- [ ] **Remove iframe view composition** — replace in-window iframes + postMessage with native in-process view instances
- [ ] **Backend config + service cleanup** — extract ConfigService (lock/mutate/save/notify) from raw Mutex<SyncConfig>. Continue AppState decomposition into narrower services.
- [x] ~~**Parser shared fixtures**~~ (69946a76) — 7 fixture pairs validated against Rust parser. 6 expected files corrected to match authoritative output.

## Style System — Do Next
- [ ] **Define two style layers** — Application Style (shell, menus, logs, settings) + Board Style (kanban/canvas content). No third overlapping layer.
- [x] ~~**Unify component primitives**~~ (1aea8ea1) — shared .btn base + primary/secondary/quiet/danger variants, existing classes inherit
- [x] ~~**Extend consistent states**~~ (1b2b5d95) — added .view-error + .view-disconnected helpers and CSS. Applied to dashboard and log panel surfaces.

## Deferred (revisit when needed)
- [ ] Email + Filesystem data sources — filesystem watcher exists, email is large scope
- [ ] Office doc editor (OfficeIMO etc.) — no mature open-source browser editor exists yet
- [ ] Frontend build pipeline — raw serving works fine in Tauri, blocked by app.js split
- [ ] Typed API contract — nice-to-have, frontend/backend tightly coupled in one repo
- [ ] Per-user change isolation — needs Loro fork/branch API, no user demand
- [ ] Universal view contract — views work fine with current approach
- [ ] Retire legacy vs shell UI paths — both work, removing one is large effort
- [ ] Standardize panel anatomy — works fine, just inconsistent
- [ ] Tag styling under board style — tagColors.js works well independently
- [ ] Style regression checks — premature until tokens exist
- [ ] Consistent hit areas — low user impact
- [ ] Plugin architecture — only one plugin type exists, manifest system is over-engineering
- [ ] a Stack can have a defined width of: 1..12 . it fillst up with columns horizontally and then stacks them below the previous ones.
  - a column can have a defined width of 1/1, 1/2, 1/3, 1/4, 1/6, 1/12.
