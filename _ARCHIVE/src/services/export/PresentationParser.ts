import * as path from 'path';
import { KanbanCard } from '../../board/KanbanTypes';
import { IdGenerator } from '../../utils/idGenerator';

export interface PresentationSlide {
  title?: string;
  content: string;
  slideNumber: number;
}

export class PresentationParser {
  /**
   * Parse presentation markdown content into individual slides
   * Slides are separated by '---'
   *
   * Format:
   * With title:
   *   [1 blank line]
   *   Title
   *   [1 blank line]
   *   Description
   *   [1 blank line]
   *   ---
   *   [next slide...]
   *
   * Without title (description only):
   *   [2+ blank lines]
   *
   *   Description
   *   [1 blank line]
   *   ---
   *   [next slide...]
   *
   * Note: Any '---' at the beginning or end of the file are ignored (treated as empty slides)
   */
  static parsePresentation(content: string): PresentationSlide[] {
    // CRITICAL: Only skip if content is null/undefined/empty string
    // Do NOT use trim() - whitespace/newlines ARE valid content
    if (!content) {
      return [];
    }

    // CRITICAL: Normalize CRLF to LF (Windows line endings to Unix)
    // This MUST happen FIRST before any other processing!
    // Without this, \r would remain at end of lines after split('\n')
    // and break all empty line checks (since '\r' !== '')
    let workingContent = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    // Strip YAML frontmatter if present (e.g., ---\nmarp: true\n---\n)
    // This is critical for parsing include files that have Marp YAML headers
    // NOTE: Must use workingContent (normalized) not original content!
    // Allow trailing spaces/tabs after --- (common from editors)
    const yamlMatch = workingContent.match(/^---[ \t]*\n[\s\S]*?\n---[ \t]*\n/);
    if (yamlMatch) {
      workingContent = workingContent.substring(yamlMatch[0].length);
    }

    // NO newline manipulation - content is read exactly as-is

    // CRITICAL: Temporarily replace HTML comments with placeholders
    // This prevents '---' inside comments from being treated as slide separators
    // while preserving the comments in the output
    const comments: string[] = [];
    const contentWithPlaceholders = workingContent.replace(/<!--[\s\S]*?-->/g, (match) => {
      const index = comments.length;
      comments.push(match);
      return `__COMMENT_PLACEHOLDER_${index}__`;
    });

    // Split by slide separators: \n\n---\n\n (blank line + --- + blank line)
    // This consumes the blank lines around ---, so slides don't have extra leading/trailing empties
    // CRITICAL: Only plain --- is a separator, others are Marp column layout markers (---:, :--:, :---)
    // Allow whitespace on "empty" lines and after --- (common from editors)
    const rawSlides = contentWithPlaceholders.split(/\n[ \t]*\n---[ \t]*\n[ \t]*\n/g);
    const slides: PresentationSlide[] = [];

    rawSlides.forEach((slideContent, index) => {
      // ═══════════════════════════════════════════════════════════════════════════
      // SIMPLIFIED: Keep raw slide content as-is
      // ═══════════════════════════════════════════════════════════════════════════
      //
      // READING: Split on \n\n---\n\n (consumes blank before + --- + blank after)
      // WRITING: Join with \n\n---\n\n
      // NO newline manipulation - content is preserved exactly as-is
      //
      // DO NOT CHANGE THIS WITHOUT UPDATING PresentationGenerator.formatOutput!
      // ═══════════════════════════════════════════════════════════════════════════

      // Restore HTML comments from placeholders
      // CRITICAL: ALL content including comments must be preserved
      const rawContent = slideContent.replace(/__COMMENT_PLACEHOLDER_(\d+)__/g, (match, idx) => {
        return comments[parseInt(idx)] || match;
      });

      slides.push({
        title: undefined, // No longer used - everything is content
        content: rawContent,
        slideNumber: index + 1
      });
    });

    return slides;
  }

  /**
   * Convert presentation slides to kanban tasks
   */
  static slidesToTasks(slides: PresentationSlide[], includeFilePath?: string, mainFilePath?: string): KanbanCard[] {
    return slides.map((slide, _index) => {
      const task: KanbanCard = {
        id: IdGenerator.generateCardId(),
        // SIMPLIFIED: Use raw slide content directly - no title/description merge
        // This preserves all newlines exactly for round-trip consistency
        content: slide.content
      };

      // Add includeContext for dynamic image path resolution
      if (includeFilePath && mainFilePath) {
        task.includeContext = {
          includeFilePath: includeFilePath,
          includeDir: path.dirname(includeFilePath),
          mainFilePath: mainFilePath,
          mainDir: path.dirname(mainFilePath)
        };
      }

      return task;
    });
  }

  /**
   * Convert kanban tasks back to presentation format
   * This enables bidirectional editing
   *
   * Format:
   * With title:
   *   [1 blank line]
   *   Title
   *   [1 blank line]
   *   Description
   *   [1 blank line]
   *   ---
   *   [next slide...]
   *
   * Without title (description only):
   *   [3 blank lines]
   *
   *
   *   Description
   *   [1 blank line]
   *   ---
   *   [next slide...]
   *
   * Note: No --- at the beginning or end of the file, only between slides
   */

  /**
   * Parse a markdown file and convert to kanban tasks
   * This is the main entry point for column includes
   */
  static parseMarkdownToTasks(content: string, includeFilePath?: string, mainFilePath?: string): KanbanCard[] {
    const slides = this.parsePresentation(content);
    return this.slidesToTasks(slides, includeFilePath, mainFilePath);
  }
}
