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
