# Settings Architecture Analysis

## Current State

The app has **4 storage layers** with distinct scopes:

| Layer | Scope | Count | Sync | Frontend | Backend |
|-------|-------|-------|------|----------|---------|
| localStorage | Global/per-board | ~90 keys | No | Yes | No |
| Board YAML frontmatter | Per-board | ~20 keys | Yes (via save) | Read | Read/Write |
| Backend config (sync.json) | Global/per-workspace | ~30 fields | No | Read (via API) | Read/Write |
| LexeraRuntime state | Session-only | 11 keys | No | Yes | No |

## Problems

1. **No single source of truth** — the same setting can live in localStorage AND board YAML AND backend config (e.g. theme, tag visibility)
2. **Frontend defaults in localStorage can't sync** — layout presets, tag color overrides, editor preferences are machine-local and lost on new devices
3. **Workspace-level overrides are incomplete** — only theme, layoutPreset, and dashboardTags exist per-workspace in sync.json. Most visual settings (column width, font, spacing) have no workspace scope.
4. **Board YAML overrides are implicit** — `getBoardSettingValue` checks board YAML > localStorage default > fallback, but there's no UI to see which tier a value comes from.
5. **No per-board frontend settings in backend** — board-level frontend preferences (card collapsed state, drafts) are in localStorage, not synced.

## Proposed Architecture

### 3-Tier Resolution (already partially implemented)

```
Board Override > Workspace Override > Global Default
```

Where:
- **Board Override**: YAML frontmatter `boardSettings` (already exists)
- **Workspace Override**: sync.json `workspaces[].settings` (new)
- **Global Default**: sync.json `defaultSettings` (new, replaces localStorage `lexera-default-*`)

### Setting Categories

**Category A: Backend-Only (server config)**
- port, bind_address, templates_path, render_apps, remote_connections
- These never need frontend override or per-board scope
- Keep in sync.json root level

**Category B: Shared (visual/interaction settings)**
- theme, visual_theme, ui_scale, column_width, font_size, font_family, tag_visibility, scroll_speed, zoom_speed, html_comment_mode, html_content_mode, whitespace
- These need 3-tier resolution: board > workspace > global
- Move from localStorage `lexera-default-*` to sync.json `defaultSettings`
- Add to WorkspaceEntry as optional overrides

**Category C: Frontend UI State (navigation/session)**
- active_workspace, last_board, recent_boards, sidebar_width, sidebar_split_ratio, search_expanded, editor_mode, editor_font_scale
- These are machine-local preferences, not content
- Keep in localStorage (no sync needed)

**Category D: Per-Board State (local persistence)**
- card_collapsed, board_draft, fold_state, board_order
- These are per-device editing state
- Keep in localStorage keyed by board ID

### Migration Path

1. Add `defaultSettings: {}` and `workspaces[].settings: {}` to SyncConfig
2. Add `GET/PUT /config/settings?workspace={id}` API endpoint
3. Update `getBoardSettingValue` to check: board YAML > workspace settings > global settings > fallback
4. Migrate existing `lexera-default-*` localStorage keys to backend on first load
5. Frontend Settings panel shows effective value + which tier it comes from
