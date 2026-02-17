import { IdGenerator } from './utils/idGenerator';
import { PresentationParser } from './services/export/PresentationParser';
import { PathResolver } from './services/PathResolver';
import { sortColumnsByRow } from './utils/columnUtils';
import { MarkdownFile } from './files/MarkdownFile'; // FOUNDATION-1: For path comparison
import { createDisplayTitleWithPlaceholders } from './constants/IncludeConstants';
import { PluginRegistry, IncludeContextLocation } from './plugins';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from './utils/logger';

// Re-export types from KanbanTypes
export { KanbanTask, KanbanColumn, KanbanBoard, BoardSettings } from './board/KanbanTypes';

// Import types for internal use
import { KanbanTask, KanbanColumn, KanbanBoard, BoardSettings } from './board/KanbanTypes';

const BOARD_SETTING_KEYS: Array<keyof BoardSettings> = [
  'columnWidth',
  'layoutRows',
  'maxRowHeight',
  'rowHeight',
  'layoutPreset',
  'stickyStackMode',
  'tagVisibility',
  'taskMinHeight',
  'sectionHeight',
  'fontSize',
  'fontFamily',
  'whitespace',
  'htmlCommentRenderMode',
  'htmlContentRenderMode',
  'arrowKeyFocusScroll',
  'boardColor',
  'boardColorDark',
  'boardColorLight'
];

export class MarkdownKanbanParser {
  // Runtime-only ID generation - no persistence to markdown

  /**
   * Find existing column by position with content verification
   * Backend markdown is source of truth - preserve IDs only when content matches
   */
  /**
   * Find existing column by POSITION ONLY
   * CRITICAL: NEVER match by title - position determines identity
   * Titles can be duplicated, changed, or empty
   */
  private static findExistingColumn(existingBoard: KanbanBoard | undefined, _title: string, columnIndex?: number, _newTasks?: KanbanTask[]): KanbanColumn | undefined {
    if (!existingBoard) return undefined;

    // ONLY match by position - title/content matching is FORBIDDEN
    if (columnIndex !== undefined && columnIndex >= 0 && columnIndex < existingBoard.columns.length) {
      return existingBoard.columns[columnIndex];
    }

    // No position provided or out of bounds - this is a NEW column
    return undefined;
  }

  // ============= PLUGIN-BASED INCLUDE DETECTION =============

  /**
   * Detect includes in content using plugin system
   *
   * Uses PluginRegistry.detectIncludes() exclusively.
   * Plugins MUST be loaded via PluginLoader.loadBuiltinPlugins() at extension activation.
   *
   * @param content - Content to search for includes
   * @param contextLocation - Where the content comes from (column-header, task-title, description)
   * @returns Array of detected include file paths
   * @throws Error if plugin system is not available
   */
  private static detectIncludes(content: string, contextLocation: IncludeContextLocation): string[] {
    const registry = PluginRegistry.getInstance();
    const matches = registry.detectIncludes(content, { location: contextLocation });
    return matches.map(m => m.filePath);
  }

  // Include match detection handled directly via PluginRegistry.detectIncludes()

  /**
   * Parse kanban markdown content into a board structure
   * @param content - Markdown content to parse
   * @param basePath - Base path for resolving relative paths
   * @param existingBoard - Existing board for ID preservation
   * @param mainFilePath - Path to the main file for include resolution
   * @param resolveIncludes - Whether to read and resolve include files (default: true)
   *                          When false, includes are detected but not read, preventing
   *                          duplicate content when exporting with mergeIncludes=false
   */
  static parseMarkdown(content: string, basePath?: string, existingBoard?: KanbanBoard, mainFilePath?: string, resolveIncludes: boolean = true): { board: KanbanBoard, includedFiles: string[], columnIncludeFiles: string[], taskIncludeFiles: string[] } {
      // First parse with original content to preserve raw task content
      const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

      // Location-based include detection:
      // - Column includes: !!!include()!!! in column headers (## header)
      // Task and regular includes are intentionally disabled.
      let includedFiles: string[] = [];
      let columnIncludeFiles: string[] = [];
      let taskIncludeFiles: string[] = [];
      const board: KanbanBoard = {
        valid: false,
        title: '',
        columns: [],
        yamlHeader: null,
        kanbanFooter: null
      };

      let currentColumn: KanbanColumn | null = null;
      let currentTask: KanbanTask | null = null;
      let collectingDescription = false;
      let inYamlHeader = false;
      let inKanbanFooter = false;
      let yamlLines: string[] = [];
      let footerLines: string[] = [];
      let yamlStartFound = false;
      let columnIndex = 0;  // Add counter for columns
      let taskIndexInColumn = 0;  // Add counter for tasks within column

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmedLine = line.trim();

        // Handle YAML front matter
        if (line.startsWith('---')) {
          if (!yamlStartFound) {
            yamlStartFound = true;
            inYamlHeader = true;
            yamlLines.push(line);
            continue;
          } 
          // finish the header reading
          else if (inYamlHeader) {
            yamlLines.push(line);
            board.yamlHeader = yamlLines.join('\n');
            board.valid = board.yamlHeader.includes('kanban-plugin: board');
            if (!board.valid) {
              return { board, includedFiles, columnIncludeFiles, taskIncludeFiles };
            }
            inYamlHeader = false;
            continue;
          }
        }

        if (inYamlHeader) {
          yamlLines.push(line);
          continue;
        }

        // Handle Kanban footer
        if (line.startsWith('%%')) {
          if (collectingDescription) {
            this.finalizeCurrentTask(currentTask, currentColumn, existingBoard, columnIndex - 1);
            collectingDescription = false;
          }
          inKanbanFooter = true;
          footerLines.push(line);
          continue;
        }

        if (inKanbanFooter) {
          footerLines.push(line);
          continue;
        }

        // Parse column with runtime UUID generation
        if (line.startsWith('## ')) {
          if (collectingDescription) {
            this.finalizeCurrentTask(currentTask, currentColumn, existingBoard, columnIndex - 1);
            collectingDescription = false;
          }
          currentTask = null;
          if (currentColumn) {
            board.columns.push(currentColumn);
          }

          const columnTitle = line.substring(3);

          // Check for include syntax in column header (location-based: column includes)
          // Uses plugin system exclusively (no fallback)
          const includeFilePaths = this.detectIncludes(columnTitle, 'column-header');

          if (includeFilePaths.length > 0) {
            // This is a column include - process included files as Marp presentations
            const includeFiles: string[] = [];
            includeFilePaths.forEach(filePath => {
              includeFiles.push(filePath);
              // Track for file watching (FOUNDATION-1: Use normalized comparison)
              if (!columnIncludeFiles.some(p => MarkdownFile.isSameFile(p, filePath))) {
                columnIncludeFiles.push(filePath);
              }
            });

            // Generate tasks from included files (only when resolveIncludes is true)
            // When resolveIncludes=false (e.g., exporting with mergeIncludes=false),
            // we skip reading files to prevent duplicate content in the output
            const includeTasks: KanbanTask[] = [];
            let hasIncludeError = false;

            if (resolveIncludes) {
              for (const filePath of includeFiles) {
                const resolvedPath = basePath ? PathResolver.resolve(basePath, filePath) : filePath;
                try {
                  if (fs.existsSync(resolvedPath)) {
                    const fileContent = fs.readFileSync(resolvedPath, 'utf8');
                    const slideTasks = PresentationParser.parseMarkdownToTasks(fileContent, resolvedPath, mainFilePath);
                    includeTasks.push(...slideTasks);
                  } else {
                    logger.warn(`[Parser] Column include file not found: ${resolvedPath}`);
                    hasIncludeError = true;
                  }
                } catch (error) {
                  logger.error(`[Parser] Error processing column include ${filePath}:`, error);
                  hasIncludeError = true;
                }
              }
            }

            // Replace !!!include()!!! with placeholder for frontend badge rendering
            // This preserves the position of the include in the title
            // SINGLE SOURCE OF TRUTH: Use shared utility function
            let displayTitle = createDisplayTitleWithPlaceholders(columnTitle, includeFiles);

            // Use filename as title if no display title provided
            if (!displayTitle && includeFiles.length > 0) {
              displayTitle = path.basename(includeFiles[0], path.extname(includeFiles[0]));
            }

            // Preserve existing column ID by position (NOT title - title changes with include switches!)
            const existingCol = this.findExistingColumn(existingBoard, columnTitle, columnIndex);
            currentColumn = {
              id: existingCol?.id || IdGenerator.generateColumnId(),
              title: columnTitle, // Keep full title with include syntax for editing
              tasks: includeTasks,
              includeMode: true,
              includeFiles: includeFiles,
              includeError: hasIncludeError, // Set error flag if file not found
              originalTitle: columnTitle,
              displayTitle: displayTitle || 'Included Column' // Store cleaned title for display
            };
          } else {
            // Regular column - preserve existing ID by position
            const existingCol = this.findExistingColumn(existingBoard, columnTitle, columnIndex);
            currentColumn = {
              id: existingCol?.id || IdGenerator.generateColumnId(),
              title: columnTitle,
              tasks: []
            };
          }

          columnIndex++;
          taskIndexInColumn = 0;  // Reset task counter for new column
          continue;
        }

        // Parse task with runtime UUID generation
        if (line.startsWith('- ')) {
          if (collectingDescription) {
            this.finalizeCurrentTask(currentTask, currentColumn, existingBoard, columnIndex - 1);
            collectingDescription = false;
          }

          if (currentColumn && !currentColumn.includeMode) {
            // Only parse tasks for non-include columns
            const taskSummary = line.substring(6);

            // Create task with temporary ID - will be matched by content during finalization
            currentTask = {
              id: IdGenerator.generateTaskId(), // Temporary, replaced if content matches
              content: taskSummary
            };

            taskIndexInColumn++;
            collectingDescription = true;
          } else if (currentColumn && currentColumn.includeMode) {
            // For include columns, skip task parsing as tasks are already generated
            currentTask = null;
            collectingDescription = false;
          }
          continue;
        }

        // Collect remaining task content from indented lines
        if (currentTask && collectingDescription) {
          if (trimmedLine === '' && !line.startsWith('  ')) {
            // Skip blank separator lines before a new task/column/footer/YAML or end of file
            let nextIndex = i + 1;
            while (nextIndex < lines.length && lines[nextIndex].trim() === '') {
              nextIndex++;
            }
            const nextLine = nextIndex < lines.length ? lines[nextIndex] : null;
            const isStructuralBoundary = nextLine === null
              || nextLine.startsWith('## ')
              || nextLine.startsWith('- ')
              || nextLine.startsWith('%%')
              || nextLine.startsWith('---');
            if (isStructuralBoundary) {
              continue;
            }
          }
          let descLine = line;
          // remove the first leading spaces if there
          if (line.startsWith('  ')) {
            descLine = line.substring(2);
          }

          // Preserve the markdown split format in unified content:
          // first line = summary, remaining lines = details
          currentTask.content += `\n${descLine}`;
          continue;
        }

        if (trimmedLine === '') {
          continue;
        }
      }

      // Add the last task and column
      if (collectingDescription) {
        this.finalizeCurrentTask(currentTask, currentColumn, existingBoard, columnIndex - 1);
      }
      if (currentColumn) {
        board.columns.push(currentColumn);
      }

      if (footerLines.length > 0) {
        board.kanbanFooter = footerLines.join('\n');
      }

      // Task includes and regular includes are disabled.

      // Parse Marp global settings from YAML frontmatter
      board.frontmatter = this.parseMarpFrontmatter(board.yamlHeader || '');

      // Parse board-specific settings from YAML frontmatter
      board.boardSettings = this.parseBoardSettings(board.yamlHeader || '');

      return { board, includedFiles, columnIncludeFiles, taskIncludeFiles };
  }

  /**
   * Parse Marp global settings from YAML frontmatter
   */
  private static parseMarpFrontmatter(yamlHeader: string): Record<string, string> {
    const frontmatter: Record<string, string> = {};

    if (!yamlHeader) {
      return frontmatter;
    }

    const lines = yamlHeader.split('\n');
    const marpKeys = ['theme', 'style', 'headingDivider', 'size', 'math', 'title', 'author',
                      'description', 'keywords', 'url', 'image', 'marp', 'paginate',
                      'header', 'footer', 'class', 'backgroundColor', 'backgroundImage',
                      'backgroundPosition', 'backgroundRepeat', 'backgroundSize', 'color'];

    for (const line of lines) {
      const match = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
      if (match) {
        const key = match[1];
        const value = match[2].trim();
        if (marpKeys.includes(key)) {
          frontmatter[key] = value;
        }
      }
    }

    return frontmatter;
  }

  /**
   * Parse board-specific settings from YAML frontmatter
   * These settings are stored per-board and travel with the markdown file
   */
  private static parseBoardSettings(yamlHeader: string): BoardSettings {
    const settings: BoardSettings = {};

    if (!yamlHeader) {
      logger.debug('[MarkdownKanbanParser.parseBoardSettings] No YAML header');
      return settings;
    }

    const lines = yamlHeader.split('\n');

    for (const line of lines) {
      const match = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
      if (match) {
        const key = match[1] as keyof BoardSettings;
        const value = match[2].trim();
        if (!BOARD_SETTING_KEYS.includes(key) || !value) {
          continue;
        }

        if (key === 'layoutRows' || key === 'maxRowHeight') {
          const numericValue = Number(value);
          if (!Number.isFinite(numericValue)) {
            continue;
          }

          if (key === 'layoutRows') {
            if (numericValue >= 1) {
              settings.layoutRows = Math.floor(numericValue);
            }
          } else if (numericValue >= 0) {
            settings.maxRowHeight = Math.floor(numericValue);
          }
          continue;
        }

        settings[key] = value;
      }
    }

    logger.debug('[MarkdownKanbanParser.parseBoardSettings] Parsed settings:', settings);
    return settings;
  }

  /**
   * Update YAML header with board settings
   * Adds or updates board setting keys in the frontmatter
   */
  static updateYamlWithBoardSettings(yamlHeader: string | null, settings: BoardSettings): string {
    logger.debug('[MarkdownKanbanParser.updateYamlWithBoardSettings] Input yamlHeader:', yamlHeader ? 'present' : 'null', 'settings:', settings);

    if (!yamlHeader) {
      // Create new YAML header with kanban-plugin marker and settings
      const newSettings: string[] = [];
      for (const key of BOARD_SETTING_KEYS) {
        const value = settings[key];
        if (value !== undefined) {
          newSettings.push(`${key}: ${String(value)}`);
        }
      }

      let yaml = '---\nkanban-plugin: board\n';
      if (newSettings.length > 0) {
        yaml += `${newSettings.join('\n')}\n`;
      }
      yaml += '---';
      logger.debug('[MarkdownKanbanParser.updateYamlWithBoardSettings] Created new YAML:', yaml);
      return yaml;
    }

    const lines = yamlHeader.split('\n');
    const result: string[] = [];
    const settingsToAdd = { ...settings };

    for (const line of lines) {
      const match = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
      if (match && BOARD_SETTING_KEYS.includes(match[1] as keyof BoardSettings)) {
        const key = match[1] as keyof BoardSettings;
        // Update existing setting only when explicitly provided.
        // If missing from `settings`, preserve existing YAML value to avoid accidental data loss.
        if (settingsToAdd[key] !== undefined) {
          // Empty string means "remove this setting" — skip the line
          if (settingsToAdd[key] !== '') {
            result.push(`${key}: ${String(settingsToAdd[key])}`);
          }
          delete settingsToAdd[key];
        } else {
          result.push(line);
        }
      } else {
        result.push(line);
      }
    }

    // Add any new settings before the closing ---
    const closingIndex = result.lastIndexOf('---');
    if (closingIndex > 0) {
      const newSettings: string[] = [];
      for (const key of BOARD_SETTING_KEYS) {
        const value = settingsToAdd[key];
        if (value !== undefined && value !== '') {
          newSettings.push(`${key}: ${String(value)}`);
        }
      }
      if (newSettings.length > 0) {
        result.splice(closingIndex, 0, ...newSettings);
      }
    }

    const updatedYaml = result.join('\n');
    logger.debug('[MarkdownKanbanParser.updateYamlWithBoardSettings] Updated YAML:', updatedYaml);
    return updatedYaml;
  }

  private static finalizeCurrentTask(task: KanbanTask | null, column: KanbanColumn | null, existingBoard?: KanbanBoard, columnIndex?: number): void {
    if (!task || !column) {return;}

    // CRITICAL: NEVER delete or trim content - whitespace IS valid content
    // Content is always a string (empty string if not set)
    if (task.content === undefined) {
      task.content = '';
    }

    // CRITICAL: Match by POSITION to preserve ID (Backend is source of truth)
    // Content matching alone is WRONG - empty tasks would all share the same ID!
    let existingCol: KanbanColumn | undefined;
    if (existingBoard && columnIndex !== undefined && columnIndex >= 0 && columnIndex < existingBoard.columns.length) {
      existingCol = existingBoard.columns[columnIndex];
    }

    if (existingCol) {
      // CRITICAL FIX: Match by POSITION in array, not content
      // Position determines identity - content can be duplicated (e.g., multiple empty tasks)
      const taskPosition = column.tasks.length; // Current position being added
      const existingTask = existingCol.tasks[taskPosition];

      if (existingTask) {
        // Position matches - preserve the existing ID
        task.id = existingTask.id;
      }
      // else: New task at this position - keep the generated UUID
    }

    column.tasks.push(task);
  }

  static generateMarkdown(board: KanbanBoard): string {
    logger.debug('[MarkdownKanbanParser.generateMarkdown] Board has yamlHeader:', !!board.yamlHeader, 'boardSettings:', board.boardSettings);

    let markdown = '';

    // Add YAML front matter, updating with board settings if present
    // Also create YAML header if boardSettings exist but no yamlHeader yet
    if (board.yamlHeader || board.boardSettings) {
      const updatedYaml = this.updateYamlWithBoardSettings(board.yamlHeader, board.boardSettings || {});
      markdown += updatedYaml + '\n\n';
    }

    // Sort columns by row before saving to ensure correct order in file
    // This maintains row 1 columns before row 2 columns in the saved markdown
    const sortedColumns = sortColumnsByRow(board.columns);

    // Add columns (no ID persistence - runtime only)
    for (const column of sortedColumns) {
      if (column.includeMode) {
        // For include columns, use the current title (which may have been updated with tags)
        // column.title should contain the include syntax plus any added tags
        const titleToUse = column.title;
        markdown += `## ${titleToUse}\n`;
        // Skip generating tasks for include columns - they remain as includes
      } else {
        // Regular column processing
        markdown += `## ${column.title}\n`;

        for (const task of column.tasks) {
          // Normalize and split content into lines
          const normalizedContent = (task.content || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
          const contentLines = normalizedContent.split('\n');
          const summaryLine = contentLines[0] || '';

          markdown += `- [ ] ${summaryLine}\n`;

          // Add remaining content with proper indentation
          // CRITICAL: Check if there are lines AFTER the summary (contentLines.length > 1)
          // This preserves trailing newlines even when remainingContent would be empty string
          // Example: "summary\n" has contentLines = ["summary", ""], length 2, so we write the empty line
          if (contentLines.length > 1) {
            for (let i = 1; i < contentLines.length; i++) {
              markdown += `  ${contentLines[i]}\n`;
            }
          }
        }
      }

      markdown += '\n';
    }

    // Add Kanban footer if it exists
    if (board.kanbanFooter) {
      if (markdown.endsWith('\n\n')) {
        markdown = markdown.slice(0, -1);
      }
      markdown += board.kanbanFooter;
      if (!board.kanbanFooter.endsWith('\n')) {
        markdown += '\n';
      }
    } else {
      markdown += '\n';
    }

    return markdown;
  }
}
