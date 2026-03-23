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
