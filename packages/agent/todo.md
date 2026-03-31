# Lexera Kanban Todo

## Bugs
- [x] ~~Dashboard scope~~ (35db71de) — defaults to all in workspace shell mode
- [x] ~~reorderBoards crash~~ (cd849d0a) — guard against non-array boards dep

## Active Features
- [ ] Add pptx rendering (needs esbuild bundle of @jvmr/pptx-to-html)
- [ ] Mobile web clipper — finish lexera-capture-ios

## Code Quality
- [ ] **App.js modularization** — 11,927 lines (down from 25K+). Remaining: Main View (~6600 lines core rendering) is the only major section left. All small sections extracted.

## Misc
- [x] ~~Color theme integrated into visual theme~~ (7c212e7c)
- [x] ~~Overlay editor always available~~ (709cdae2) — setting controls default only, never blocks
- [x] ~~Overlay editor activation from settings~~ (709cdae2) — double-click + Enter respect setting
- [x] ~~#exclude diagonal hatching~~ (fd8ee2e9) — SVG hatch pattern at 20% opacity
- [x] ~~show special characters~~ (77f416a2) — visible whitespace markers (·→¶) in card content

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

- [ ] when the log view is folded it should show the same connected symbol as when unfolded, just in the one header line it shows. alignments should also stay in the right. number of logs should also be displayed (might be useful for performance issue debugging). if we have other important status informations it should go there (put that into the specs). for example the number of connected users in the current board. running processes. amount of backend calls currently avaiting a response!



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
- [ ] **Parser shared fixtures** — Rust parser is authoritative (1,751 lines). Add shared test fixtures to validate TS parser (337 lines) against it instead of hand-maintained parity.

## Style System — Do Next
- [ ] **Define two style layers** — Application Style (shell, menus, logs, settings) + Board Style (kanban/canvas content). No third overlapping layer.
- [x] ~~**Unify component primitives**~~ (1aea8ea1) — shared .btn base + primary/secondary/quiet/danger variants, existing classes inherit
- [ ] **Extend consistent states** — .view-loading/.view-empty exist for some views. Apply to all surfaces with shared model for connected/loading/empty/error/selected.

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
