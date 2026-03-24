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
