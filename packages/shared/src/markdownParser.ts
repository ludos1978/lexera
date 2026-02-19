/**
 * Lightweight markdown parser for Kanban boards.
 *
 * Handles the core format:
 *   --- YAML header (must contain kanban-plugin: board) ---
 *   ## Column Title
 *   - [ ] Task summary
 *     description line
 *   %% footer %%
 *
 * No VS Code dependencies, no plugin system, no include resolution.
 * Used by ludos-sync standalone server.
 */

import { KanbanCard, KanbanColumn, KanbanBoard, BoardSettings } from './kanbanTypes';

const BOARD_SETTING_KEYS: Array<keyof BoardSettings> = [
  'columnWidth',
  'layoutRows',
  'maxRowHeight',
  'rowHeight',
  'layoutPreset',
  'stickyStackMode',
  'tagVisibility',
  'cardMinHeight',
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

let nextId = 1;
function generateId(prefix: string): string {
  return `${prefix}-${nextId++}-${Date.now().toString(36)}`;
}

export class SharedMarkdownParser {

  /**
   * Parse kanban markdown content into a board structure.
   * Simplified version: no includes, no plugins.
   */
  static parseMarkdown(content: string): KanbanBoard {
    const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

    const board: KanbanBoard = {
      valid: false,
      title: '',
      columns: [],
      yamlHeader: null,
      kanbanFooter: null
    };

    let currentColumn: KanbanColumn | null = null;
    let currentTask: KanbanCard | null = null;
    let collectingDescription = false;
    let inYamlHeader = false;
    let inKanbanFooter = false;
    let yamlLines: string[] = [];
    let footerLines: string[] = [];
    let yamlStartFound = false;

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
        } else if (inYamlHeader) {
          yamlLines.push(line);
          board.yamlHeader = yamlLines.join('\n');
          board.valid = board.yamlHeader.includes('kanban-plugin: board');
          if (!board.valid) {
            return board;
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
        if (collectingDescription && currentTask && currentColumn) {
          currentColumn.cards.push(currentTask);
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

      // Parse column header
      if (line.startsWith('## ')) {
        if (collectingDescription && currentTask && currentColumn) {
          currentColumn.cards.push(currentTask);
          collectingDescription = false;
        }
        currentTask = null;
        if (currentColumn) {
          board.columns.push(currentColumn);
        }

        const columnTitle = line.substring(3);
        currentColumn = {
          id: generateId('col'),
          title: columnTitle,
          cards: []
        };
        continue;
      }

      // Parse task
      if (line.startsWith('- ')) {
        if (collectingDescription && currentTask && currentColumn) {
          currentColumn.cards.push(currentTask);
          collectingDescription = false;
        }

        if (currentColumn) {
          const checked = /^- \[[xX]\] /.test(line);
          const taskSummary = line.substring(6); // skip "- [ ] " or "- [x] "
          currentTask = {
            id: generateId('task'),
            content: taskSummary,
            ...(checked ? { checked: true } : {})
          };
          collectingDescription = true;
        }
        continue;
      }

      // Collect description lines
      if (currentTask && collectingDescription) {
        if (trimmedLine === '' && !line.startsWith('  ')) {
          // Check if next non-empty line is a structural boundary
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
        if (line.startsWith('  ')) {
          descLine = line.substring(2);
        }
        currentTask.content += `\n${descLine}`;
        continue;
      }

      if (trimmedLine === '') {
        continue;
      }
    }

    // Finalize last task and column
    if (collectingDescription && currentTask && currentColumn) {
      currentColumn.cards.push(currentTask);
    }
    if (currentColumn) {
      board.columns.push(currentColumn);
    }

    if (footerLines.length > 0) {
      board.kanbanFooter = footerLines.join('\n');
    }

    board.boardSettings = this.parseBoardSettings(board.yamlHeader || '');

    return board;
  }

  /**
   * Generate markdown from a board structure.
   */
  static generateMarkdown(board: KanbanBoard): string {
    let markdown = '';

    if (board.yamlHeader || board.boardSettings) {
      const updatedYaml = this.updateYamlWithBoardSettings(board.yamlHeader, board.boardSettings || {});
      markdown += updatedYaml + '\n\n';
    }

    for (const column of board.columns) {
      markdown += `## ${column.title}\n`;

      for (const task of column.cards) {
        const normalizedContent = (task.content || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        const contentLines = normalizedContent.split('\n');
        const summaryLine = contentLines[0] || '';

        const checkbox = task.checked ? '- [x] ' : '- [ ] ';
        markdown += `${checkbox}${summaryLine}\n`;

        if (contentLines.length > 1) {
          for (let i = 1; i < contentLines.length; i++) {
            markdown += `  ${contentLines[i]}\n`;
          }
        }
      }

      markdown += '\n';
    }

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

  private static parseBoardSettings(yamlHeader: string): BoardSettings {
    const settings: BoardSettings = {};
    if (!yamlHeader) return settings;

    const lines = yamlHeader.split('\n');
    for (const line of lines) {
      const match = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
      if (match) {
        const key = match[1] as keyof BoardSettings;
        const value = match[2].trim();
        if (!BOARD_SETTING_KEYS.includes(key) || !value) continue;

        if (key === 'layoutRows' || key === 'maxRowHeight') {
          const numericValue = Number(value);
          if (!Number.isFinite(numericValue)) continue;
          if (key === 'layoutRows') {
            if (numericValue >= 1) settings.layoutRows = Math.floor(numericValue);
          } else if (numericValue >= 0) {
            settings.maxRowHeight = Math.floor(numericValue);
          }
          continue;
        }

        (settings as Record<string, string>)[key] = value;
      }
    }
    return settings;
  }

  static updateYamlWithBoardSettings(yamlHeader: string | null, settings: BoardSettings): string {
    if (!yamlHeader) {
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
      return yaml;
    }

    const lines = yamlHeader.split('\n');
    const result: string[] = [];
    const settingsToAdd = { ...settings };

    for (const line of lines) {
      const match = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
      if (match && BOARD_SETTING_KEYS.includes(match[1] as keyof BoardSettings)) {
        const key = match[1] as keyof BoardSettings;
        if (settingsToAdd[key] !== undefined) {
          result.push(`${key}: ${String(settingsToAdd[key])}`);
          delete settingsToAdd[key];
        } else {
          result.push(line);
        }
      } else {
        result.push(line);
      }
    }

    const closingIndex = result.lastIndexOf('---');
    if (closingIndex > 0) {
      const newSettings: string[] = [];
      for (const key of BOARD_SETTING_KEYS) {
        const value = settingsToAdd[key];
        if (value !== undefined) {
          newSettings.push(`${key}: ${String(value)}`);
        }
      }
      if (newSettings.length > 0) {
        result.splice(closingIndex, 0, ...newSettings);
      }
    }

    return result.join('\n');
  }
}
