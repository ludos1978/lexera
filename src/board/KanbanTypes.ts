/**
 * KanbanTypes - Core data structure interfaces for Kanban boards
 *
 * Extracted from markdownParser.ts to break circular dependencies
 * with plugins that need to reference these types.
 *
 * @module board/KanbanTypes
 */

export interface KanbanTask {
  id: string;
  content: string;
  includeMode?: boolean;  // When true, content is generated from included files
  includeFiles?: string[]; // Paths to included files (for task includes - includeMode=true)
  regularIncludeFiles?: string[]; // Paths to regular includes (!!!include()!!! in task content)
  originalTitle?: string;  // Original summary line before include processing
  displayTitle?: string;   // Cleaned title for display (without include syntax)
  isLoadingContent?: boolean;  // When true, frontend shows loading indicator while include content loads
  includeError?: boolean;  // When true, include file was not found (broken include)
  includeContext?: {  // Context for dynamic image path resolution in include files
    includeFilePath: string;  // Absolute path to the include file
    includeDir: string;       // Directory of the include file
    mainFilePath: string;     // Absolute path to the main kanban file
    mainDir: string;          // Directory of the main kanban file
  };
}

export interface KanbanColumn {
  id: string;
  title: string;
  tasks: KanbanTask[];
  includeMode?: boolean;  // When true, tasks are generated from included files
  includeFiles?: string[]; // Paths to included presentation files
  originalTitle?: string;  // Original title before include processing
  displayTitle?: string;   // Cleaned title for display (without include syntax)
  isLoadingContent?: boolean;  // When true, frontend shows loading indicator while include content loads
  includeError?: boolean;  // When true, include file was not found (broken include)
}

/**
 * Board-specific settings stored in YAML frontmatter
 * These settings are per-board and travel with the markdown file
 */
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
  frontmatter?: Record<string, string>;
  boardSettings?: BoardSettings;
}
