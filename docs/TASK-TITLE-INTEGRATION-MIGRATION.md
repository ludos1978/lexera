# Task Title Integration Migration Notes

## Objective
Remove the separate task `title` data handling and move to a single `content` field everywhere.

Behavior goals:
- Folded task: show one derived summary line in the title area, read-only.
- Unfolded task: show and edit full task content (including what used to be the title line).
- End state: no task-title-specific data type, message, command, or parser branch remains.

## Current Status (2026-02-09)

### Completed
- Task model is unified on `task.content`; direct `task.title` / `task.description` usage has been removed from runtime code.
- Core task actions/CRUD/commands/messages were migrated to content-only task payloads.
- Markdown parser/generator and save round-trip checks now operate on content-first semantics.
- Webview-side edits and sync flows now send `taskData: { content }` for task updates.
- Drag/drop, clipboard, include sync, template parsing, archive/export task flows were migrated to content-first handling.
- Stop-edit captured task edits now use a unified captured edit type: `task-content`.
- Search location semantics were collapsed from split task fields to a unified task field (`taskContent`) with `taskSummary` for display context.
- Unit tests and fixtures were migrated to content-first task shapes.
- Folded task header now renders a plain-text summary only (no markdown/media/embed rendering in title area).
- Task title row is now shown only in folded state; unfolded cards show full `task.content` only.
- Include scope migration: only column-header `!!!include(...)!!!` remains active.
- Task include mode and regular body include rendering paths are disabled.
- Non-column include use-cases are now expected via `![](...)` embeds.
- Inline embed extension added for text-like files (including markdown) via scrollable iframe containers with max height.
- Legacy include-task/include-regular file types were removed from backend contracts (`MarkdownFile`, `IncludeFileType`, conflict/message payload unions).
- Legacy task/regular include import plugins and frontend markdown-it include bridge were deleted.
- Include command/message handling was reduced to column-include operations only.

### Validation
- `npm run check-types` passes.
- `npm run test:unit` passes (21 suites, 128 tests).
- `npm run lint` passes with existing repository-wide warnings (no errors).

### Remaining Optional Cleanup (Non-blocking for functional migration)
- Internal naming still includes legacy "title" terms in some metadata-only contexts:
  - include-mode metadata fields (`originalTitle`, `displayTitle`)
- Some UI variable names still mention historical task-include wording (`currentTaskIncludeContext`), but behavior is now column-include/embed only.

## Target Model

### Task structure
- Replace:
  - `task.title: string`
  - `task.description?: string`
- With:
  - `task.content: string`

### Derived summary (folded display only)
- Add a pure helper (`summaryFromContent(content: string): string`) used by renderers.
- Suggested rule:
  - first non-empty line from `content`
  - normalized whitespace
  - optional max length trim with ellipsis
- Summary is visual only and never stored separately.

### Editability
- Folded summary area is non-editable (same interaction policy as current "no title" fallback).
- Unfolded state edits only `task.content`.

## Migration Invariants
- No data loss:
  - Legacy `title + description` -> unified `content` must preserve both values.
  - Unified `content` -> markdown save/load round-trip is stable.
- Folded cards are always read-only in the summary/title area.
- Includes, tags, temporal highlighting, and search still work on task content.

## Phased Execution

## Phase 0: Guardrails
- Add/update tests that assert:
  - legacy task input is converted to unified content
  - folded summary is derived and read-only
  - unfolded edit updates full content only
  - markdown round-trip stability
- Add temporary conversion helpers:
  - `mergeLegacyTaskText(title, description) -> content`
  - `splitContentForMarkdown(content) -> checkboxLine + indentedLines`

## Phase 1: Core Model + Markdown I/O
- Update `KanbanTask` type in `src/board/KanbanTypes.ts`.
- Update parser in `src/markdownParser.ts`:
  - parse checkbox + indented lines into one `content` string
  - keep backward load support for old in-memory fields if needed during transition
- Update serializer in `src/markdownParser.ts` to write markdown from `content`.

## Phase 2: UI Rendering + Editing
- `src/html/boardRenderer.js`:
  - remove title/description split rendering logic
  - always compute folded summary from content
  - unfolded rendering shows full content block
- `src/html/taskEditor.js`:
  - remove `task-title` edit mode branches
  - keep one task-content edit path
  - keep folded summary non-editable
- `src/html/webview.css`:
  - remove title-vs-description specific edit classes/selectors
  - keep styles for summary (folded) vs full content (unfolded)
- `src/html/overlayEditor.js` + `src/html/webview.html`:
  - remove dedicated title input
  - use one content input source

## Phase 3: Bridge Contracts + Commands
- `src/core/bridge/MessageTypes.ts`:
  - remove `editTaskTitle`, `taskTitle`, `originalTitle`, `contentType: 'title'`
  - unify payloads around `content`
- `src/actions/task.ts`, `src/commands/TaskCommands.ts`, `src/commands/UICommands.ts`, `src/actions/executor.ts`:
  - replace title/description update methods with unified content update methods
- `src/files/FileInterfaces.ts`, `src/files/MainKanbanFile.ts`:
  - remove captured edit variants for task-title/task-description split

## Phase 4: Subsystems Depending on Title
- Include system:
  - `src/plugins/interfaces/ImportPlugin.ts`
  - `src/plugins/import/TaskIncludePlugin.ts`
  - `src/files/FileFactory.ts`
  - `src/core/IncludeLoadingProcessor.ts`
  - `src/core/ChangeStateMachine.ts`
  - `src/panel/IncludeFileCoordinator.ts`
  - `src/core/events/BoardSyncHandler.ts`
  - Migrate contexts from `task-title` to content-based semantics.
- Search/navigation:
  - `src/services/BoardContentScanner.ts`
  - `src/html/searchPanel.js`
  - `src/html/webview.js`
  - `src/kanbanWebviewPanel.ts`
  - Collapse `taskTitle`/`description` locations into one task-content location.
- Export/dashboard/link replacement:
  - `src/services/export/*`
  - `src/dashboard/*`
  - `src/services/LinkReplacementService.ts`
  - Ensure filtering and replacement scan unified content only.

## Phase 5: Cleanup (Hard Removal)
- Remove legacy compatibility shims and deprecated fields.
- Remove old message handlers and stale UI selectors.
- Delete or rewrite tests asserting separate title behavior.
- Final grep gates before merge:
  - no remaining `task.title` writes/reads (except explicit legacy parser migration comments if any)
  - no `taskTitle` message fields
  - no `task-title` edit mode usage

## Impact Matrix (High Risk First)
- Include subsystem and change-state propagation:
  - highest regression risk because includes currently anchor on `task-title`.
- Parser/serializer:
  - data integrity risk if split/merge logic is inconsistent.
- Webview bridge + editor:
  - behavioral risk around folded read-only summary and edit routing.
- Search/export/dashboard:
  - moderate risk; mostly field renames and semantics alignment.

## Validation Checklist
- Unit tests:
  - parser/generator round-trip
  - command handlers and message payloads
  - include update propagation
- Integration/manual checks:
  - fold/unfold interaction across keyboard/mouse flows
  - drag/drop and paste task creation
  - overlay editor save flow
  - search jump targets from results
  - export outputs (presentation/kanban variants)

## Recommended Implementation Order
1. Add conversion helpers and tests.
2. Migrate model + parser/serializer.
3. Migrate renderer/editor + CSS for folded/unfolded behavior.
4. Migrate bridge contracts + command handlers.
5. Migrate include/search/export/dashboard.
6. Remove legacy paths and run final grep/test gates.
