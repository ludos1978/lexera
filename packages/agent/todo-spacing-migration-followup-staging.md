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
