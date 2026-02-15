/**
 * Core Kanban data types shared between the VS Code extension and ludos-sync.
 *
 * These types mirror the canonical definitions in src/board/KanbanTypes.ts
 * but without any VS Code or plugin dependencies.
 *
 * Only the fields relevant for sync are included here.
 * The VS Code extension may extend these with UI-specific fields.
 */

export interface KanbanTask {
  id: string;
  content: string;
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
  sectionHeight?: string;
  fontSize?: string;
  fontFamily?: string;
  whitespace?: string;
  htmlCommentRenderMode?: string;
  htmlContentRenderMode?: string;
  arrowKeyFocusScroll?: string;
}

export interface KanbanBoard {
  valid: boolean;
  title: string;
  columns: KanbanColumn[];
  yamlHeader: string | null;
  kanbanFooter: string | null;
  boardSettings?: BoardSettings;
}
