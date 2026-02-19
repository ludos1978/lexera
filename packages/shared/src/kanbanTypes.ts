/**
 * Core Kanban data types shared between the VS Code extension and ludos-sync.
 *
 * These types mirror the canonical definitions in src/board/KanbanTypes.ts
 * but without any VS Code or plugin dependencies.
 *
 * Only the fields relevant for sync are included here.
 * The VS Code extension may extend these with UI-specific fields.
 */

/** Internal tags applied by the kanban board to mark hidden items */
export const HIDDEN_TAGS = {
  PARKED:   '#hidden-internal-parked',
  DELETED:  '#hidden-internal-deleted',
  ARCHIVED: '#hidden-internal-archived',
} as const;

/**
 * Check whether a text block is archived or deleted (should be excluded
 * from dashboard results, calendar sync, etc.).
 * Note: parked items are NOT excluded — they are temporarily hidden
 * from the board view but still active.
 */
export function isArchivedOrDeleted(text: string): boolean {
  return text.includes(HIDDEN_TAGS.DELETED)
    || text.includes(HIDDEN_TAGS.ARCHIVED);
}

export interface KanbanTask {
  id: string;
  content: string;
  checked?: boolean;
}

export interface KanbanColumn {
  id: string;
  title: string;
  tasks: KanbanTask[];
}

export interface BoardSettings {
  columnWidth?: string;
  layoutRows?: number;
  maxRowHeight?: number;
  rowHeight?: string;
  layoutPreset?: string;
  stickyStackMode?: string;
  tagVisibility?: string;
  taskMinHeight?: string;
  fontSize?: string;
  fontFamily?: string;
  whitespace?: string;
  htmlCommentRenderMode?: string;
  htmlContentRenderMode?: string;
  arrowKeyFocusScroll?: string;
  boardColor?: string;
  boardColorDark?: string;
  boardColorLight?: string;
}

export interface KanbanBoard {
  valid: boolean;
  title: string;
  columns: KanbanColumn[];
  yamlHeader: string | null;
  kanbanFooter: string | null;
  boardSettings?: BoardSettings;
}
