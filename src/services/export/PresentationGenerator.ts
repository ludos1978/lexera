import { KanbanBoard, KanbanColumn, KanbanCard } from '../../board/KanbanTypes';
import { TagUtils, TagVisibility } from '../../utils/tagUtils';
import { INCLUDE_SYNTAX } from '../../constants/IncludeConstants';
import { escapeRegExp } from '../../utils/stringUtils';

/** Internal system tags that must ALWAYS be excluded from exports */
const INTERNAL_EXCLUDE_TAGS = [
    '#hidden-internal-deleted',
    '#hidden-internal-parked',
    '#hidden-internal-archived',
];

/**
 * Options for presentation generation
 */
export interface PresentationOptions {
    /** Whether to include Marp directives in YAML frontmatter (default: false) */
    includeMarpDirectives?: boolean;
    /** Remove !!!include()!!! syntax from titles */
    stripIncludes?: boolean;
    /** Filter out tasks with includeMode or includeFiles */
    filterIncludes?: boolean;
    /** Tag visibility settings */
    tagVisibility?: TagVisibility;
    /** Tags that exclude content from export (e.g., ['#exclude', '#private']) */
    excludeTags?: string[];
    /** Marp-specific options (theme, directives) */
    marp?: MarpOptions;
    /** Custom YAML to merge (will be merged with Marp directives if both present) */
    customYaml?: Record<string, any>;
}

/**
 * Marp-specific options
 */
export interface MarpOptions {
    /** Marp theme (default: 'default') */
    theme?: string;
    /** Additional Marp directives */
    directives?: Record<string, string | boolean | number>;
    /** Global CSS classes to apply to all slides (e.g., ['font24', 'center']) */
    globalClasses?: string[];
    /** Local CSS classes to apply to specific slides (e.g., ['invert', 'highlight']) */
    localClasses?: string[];
    /** Per-slide class overrides: map of slide index to class array */
    perSlideClasses?: Map<number, string[]>;
}

/**
 * Presentation Generator
 *
 * Converts Kanban data structures to presentation (Marp) format.
 * Works directly with KanbanCard, KanbanColumn, and KanbanBoard.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * CRITICAL: Presentation Format
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Format: slide\n\n---\n\nslide\n\n---\n\nslide\n
 *
 * Each slide is: title\n\ndescription
 * (title and description can be empty, but \n\n separator is always present)
 *
 * WRITING: Join slides with \n\n---\n\n, add trailing \n
 * READING: Strip trailing \n, split on \n\n---\n\n
 *
 * DO NOT CHANGE THIS WITHOUT UPDATING PresentationParser!
 * ═══════════════════════════════════════════════════════════════════════════
 */
export class PresentationGenerator {
    /**
     * Generate presentation from tasks
     *
     * @param tasks - Array of kanban tasks
     * @param options - Generation options
     * @returns Presentation markdown string
     */
    static fromTasks(tasks: KanbanCard[], options: PresentationOptions = {}): string {
        // Filter include tasks if requested
        let filteredTasks = tasks;
        if (options.filterIncludes) {
            filteredTasks = tasks.filter(task => !task.includeMode && !task.includeFiles);
        }
        // Filter tasks with exclude tags (always include internal system tags)
        // Only exclude full card if the first line (card header) contains the tag
        const effectiveExcludeTags = [...INTERNAL_EXCLUDE_TAGS, ...(options.excludeTags || [])];
        filteredTasks = filteredTasks.filter(task => {
            const firstLine = (task.content || '').split('\n')[0] || '';
            return !this.hasExcludeTag(firstLine, effectiveExcludeTags);
        });

        // Convert tasks to slide content strings
        const slideContents = filteredTasks.map(task => this.taskToSlideContent(task, options));

        return this.formatOutput(slideContents, options);
    }

    /**
     * Generate presentation from multiple columns
     *
     * @param columns - Array of kanban columns
     * @param options - Generation options
     * @returns Presentation markdown string
     */
    static fromColumns(columns: KanbanColumn[], options: PresentationOptions = {}): string {
        const slideContents: string[] = [];

        for (const column of columns) {
            // Column title slide
            const columnTitle = this.getProcessedColumnTitle(column, options);
            if (columnTitle === null) {
                continue;
            }
            slideContents.push(columnTitle + '\n\n');

            // Task slides
            const tasks = this.filterTasks(column.cards, options);
            for (const task of tasks) {
                slideContents.push(this.taskToSlideContent(task, options));
            }
        }

        return this.formatOutput(slideContents, options);
    }

    /**
     * Generate presentation from entire board
     *
     * @param board - Kanban board
     * @param options - Generation options
     * @returns Presentation markdown string
     */
    static fromBoard(board: KanbanBoard, options: PresentationOptions = {}): string {
        return this.fromColumns(board.columns, options);
    }

    /**
     * Generate document format from entire board
     *
     * Document format is designed for Pandoc export (DOCX, ODT, EPUB).
     * - Column titles become H1 headings
     * - Task titles and content are combined (no special formatting)
     * - Optional page breaks between tasks or columns
     *
     * @param board - Kanban board
     * @param pageBreaks - Page break mode: 'continuous', 'per-task', or 'per-column'
     * @param options - Generation options (for tag filtering, etc.)
     * @returns Document markdown string
     */
    static toDocument(
        board: KanbanBoard,
        pageBreaks: 'continuous' | 'per-task' | 'per-column' = 'continuous',
        options: PresentationOptions = {}
    ): string {
        const lines: string[] = [];

        for (const column of board.columns) {
            // Column title as H1
            const columnTitle = this.getProcessedColumnTitle(column, options);
            if (columnTitle === null) {
                continue;
            }
            lines.push(`# ${columnTitle}`, '');

            // Filter tasks
            const tasks = this.filterTasks(column.cards, options);

            for (const task of tasks) {
                // SIMPLIFIED: Use task.content directly, no title/description split
                let content = (task.content || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

                // Strip include syntax if requested
                if (options.stripIncludes) {
                    content = content.replace(INCLUDE_SYNTAX.REGEX, '').trim();
                }

                // Apply tag filtering if specified
                if (options.tagVisibility && options.tagVisibility !== 'all') {
                    content = TagUtils.processMarkdownContent(content, options.tagVisibility);
                }

                // Filter excluded lines (always include internal system tags)
                const lineExcludeTags = [...INTERNAL_EXCLUDE_TAGS, ...(options.excludeTags || [])];
                content = this.filterExcludedLines(content, lineExcludeTags);

                if (content) {
                    lines.push(content, '');
                }

                // Page break after task
                if (pageBreaks === 'per-task') {
                    lines.push('\\newpage', '');
                }
            }

            // Page break after column
            if (pageBreaks === 'per-column') {
                lines.push('\\newpage', '');
            }
        }

        return lines.join('\n');
    }

    /**
     * Convert a single task to slide content string
     *
     * SIMPLIFIED: Just pass through task.content as-is.
     * Parser now keeps raw slide content, so no title/description reconstruction needed.
     * This preserves all newlines exactly for round-trip consistency.
     */
    private static taskToSlideContent(task: KanbanCard, options: PresentationOptions): string {
        // Normalize line endings only (CRLF → LF)
        let content = (task.content || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

        // Strip include syntax from first line if requested
        if (options.stripIncludes) {
            const lines = content.split('\n');
            if (lines.length > 0) {
                lines[0] = lines[0].replace(INCLUDE_SYNTAX.REGEX, '').trim();
                content = lines.join('\n');
            }
        }

        // Filter excluded lines (always include internal system tags)
        const slideExcludeTags = [...INTERNAL_EXCLUDE_TAGS, ...(options.excludeTags || [])];
        content = this.filterExcludedLines(content, slideExcludeTags);

        return content;
    }

    /**
     * Format slide contents into final output string
     */
    private static formatOutput(slideContents: string[], options: PresentationOptions): string {
        // Apply tag filtering if specified
        let filteredContents = slideContents;
        if (options.tagVisibility && options.tagVisibility !== 'all') {
            filteredContents = slideContents.map(content =>
                TagUtils.processMarkdownContent(content, options.tagVisibility!)
            );
        }

        // Apply Marp class directives if specified
        const finalContents = filteredContents.map((content, index) => {
            let result = content;

            // Add local class directive for this specific slide if configured
            if (options.marp?.localClasses && options.marp.localClasses.length > 0) {
                const classDirective = `<!-- _class: ${options.marp.localClasses.join(' ')} -->\n\n`;
                result = classDirective + result;
            }

            // Add per-slide class overrides if specified
            if (options.marp?.perSlideClasses) {
                const slideClasses = options.marp.perSlideClasses.get(index);
                if (slideClasses && slideClasses.length > 0) {
                    const classDirective = `<!-- _class: ${slideClasses.join(' ')} -->\n\n`;
                    result = classDirective + result;
                }
            }

            return result;
        });

        // Join with \n\n---\n\n - content is NOT modified
        const content = finalContents.join('\n\n---\n\n');

        // Build YAML frontmatter if requested
        let yaml = '';
        if (options.includeMarpDirectives) {
            yaml = this.buildYamlFrontmatter(options);
        }

        // NO newline manipulation - content is output exactly as-is
        if (yaml) {
            return yaml + content;
        }

        return content;
    }

    /**
     * Build YAML frontmatter for Marp
     */
    private static buildYamlFrontmatter(options: PresentationOptions): string {
        const allYaml: Record<string, any> = {};

        // Add Marp directives
        allYaml.marp = true;
        allYaml.theme = options.marp?.theme || 'default';

        // Add global class directive if specified
        if (options.marp?.globalClasses && options.marp.globalClasses.length > 0) {
            allYaml.class = options.marp.globalClasses.join(' ');
        }

        // Merge additional Marp directives if provided
        if (options.marp?.directives) {
            Object.assign(allYaml, options.marp.directives);
        }

        // Merge custom YAML if provided
        if (options.customYaml) {
            Object.assign(allYaml, options.customYaml);
        }

        // Format YAML
        let result = '---\n';
        for (const [key, value] of Object.entries(allYaml)) {
            if (typeof value === 'string') {
                result += `${key}: "${value}"\n`;
            } else if (typeof value === 'boolean' || typeof value === 'number') {
                result += `${key}: ${value}\n`;
            } else {
                result += `${key}: ${JSON.stringify(value)}\n`;
            }
        }
        result += '---\n\n';

        return result;
    }

    /**
     * Get processed column title, or null if column should be excluded.
     * Handles exclude tag checking and include syntax stripping.
     */
    private static getProcessedColumnTitle(column: KanbanColumn, options: PresentationOptions): string | null {
        let columnTitle = column.originalTitle ?? column.title;
        const colExcludeTags = [...INTERNAL_EXCLUDE_TAGS, ...(options.excludeTags || [])];
        if (this.hasExcludeTag(columnTitle, colExcludeTags)) {
            return null;
        }
        if (options.stripIncludes) {
            columnTitle = columnTitle.replace(INCLUDE_SYNTAX.REGEX, '').trim();
        }
        return columnTitle;
    }

    /**
     * Filter tasks based on options (include mode, exclude tags).
     */
    private static filterTasks(tasks: KanbanCard[], options: PresentationOptions): KanbanCard[] {
        let filtered = tasks;
        if (options.filterIncludes) {
            filtered = filtered.filter(task => !task.includeMode && !task.includeFiles);
        }
        // Always include internal system tags (deleted/parked/archived)
        // Only exclude full card if the first line (card header) contains the tag
        const taskExcludeTags = [...INTERNAL_EXCLUDE_TAGS, ...(options.excludeTags || [])];
        filtered = filtered.filter(task => {
            const firstLine = (task.content || '').split('\n')[0] || '';
            return !this.hasExcludeTag(firstLine, taskExcludeTags);
        });
        return filtered;
    }

    /**
     * Check if text contains any of the exclude tags
     * Uses (?=\s|$) lookahead to match exact tags, preventing partial matches
     * (e.g., #hidden won't match #hidden-internal-parked)
     */
    private static hasExcludeTag(text: string, excludeTags?: string[]): boolean {
        if (!text || !excludeTags || excludeTags.length === 0) {
            return false;
        }
        for (const tag of excludeTags) {
            const tagPattern = new RegExp(`${escapeRegExp(tag)}(?=\\s|$)`, 'i');
            if (tagPattern.test(text)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Filter lines in content that contain exclude tags
     */
    private static filterExcludedLines(content: string, excludeTags?: string[]): string {
        if (!content || !excludeTags || excludeTags.length === 0) {
            return content;
        }
        return content
            .split('\n')
            .filter(line => !this.hasExcludeTag(line, excludeTags))
            .join('\n');
    }
}
