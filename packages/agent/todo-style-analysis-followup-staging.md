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
