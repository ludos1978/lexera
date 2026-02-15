/**
 * Bidirectional XBEL XML <-> KanbanColumn/KanbanTask mapper.
 *
 * XBEL (XML Bookmark Exchange Language) is the format Floccus uses over WebDAV.
 *
 * Mapping rules:
 *   <folder>      <-> ## Column Title (kanban column)
 *   <bookmark>    <-> - [ ] [Title](url "xbel-id") (kanban task with link)
 *   <desc>        <-> indented description lines under the task
 *   XBEL ID       <-> stored in the link's title attribute for identity matching
 *
 * Tasks without URLs in a synced column are preserved but invisible to Floccus.
 */

import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import { KanbanColumn, KanbanTask } from '@ludos/shared';
import { log } from '../logger';

export interface XbelBookmark {
  id: string;
  title: string;
  href: string;
  description?: string;
}

export interface XbelFolder {
  id: string;
  title: string;
  bookmarks: XbelBookmark[];
}

export interface XbelRoot {
  folders: XbelFolder[];
}

/**
 * Regex to extract link with optional xbel-id from task content.
 * Matches: [Title](url "xbel-id") or [Title](url)
 */
const LINK_REGEX = /^\[([^\]]*)\]\(([^)"]+)(?:\s+"([^"]*)")?\)(.*)$/;

/**
 * Regex to detect a checkbox prefix that may appear before the link.
 * The shared parser strips "- [ ] " but may leave content starting with the link directly.
 */

export class XbelMapper {

  private static xmlParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    isArray: (name) => name === 'folder' || name === 'bookmark',
  });

  private static xmlBuilder = new XMLBuilder({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    format: true,
    suppressEmptyNode: true,
  });

  /**
   * Parse XBEL XML string into structured data.
   *
   * Recursively flattens nested folder trees. Each folder at any depth
   * becomes a top-level XbelFolder. Nested folder titles are joined
   * with " / " (e.g. "Bookmarks Bar / Tech / Frontend").
   *
   * Root-level bookmarks (not inside any folder) go into an "Unsorted" folder.
   */
  static parseXbel(xml: string): XbelRoot {
    const parsed = this.xmlParser.parse(xml);
    const xbel = parsed.xbel || parsed;
    const result: XbelRoot = { folders: [] };

    // Collect root-level bookmarks (directly under <xbel>, not in a folder)
    const rootBookmarks = this.parseBookmarks(xbel);
    if (rootBookmarks.length > 0) {
      result.folders.push({
        id: 'root-unsorted',
        title: 'Unsorted',
        bookmarks: rootBookmarks,
      });
      log.verbose(`parseXbel: ${rootBookmarks.length} root-level bookmarks -> "Unsorted"`);
    }

    // Recursively flatten all nested folders
    const rawFolders = xbel.folder || [];
    for (const folder of rawFolders) {
      this.parseFolderRecursive(folder, [], result.folders);
    }

    const totalBookmarks = result.folders.reduce((sum, f) => sum + f.bookmarks.length, 0);
    log.verbose(`parseXbel: ${result.folders.length} folders, ${totalBookmarks} total bookmarks`);

    return result;
  }

  /**
   * Recursively parse a folder and its sub-folders.
   * Each folder with bookmarks becomes its own XbelFolder.
   * Sub-folder titles are prefixed with the parent path.
   */
  private static parseFolderRecursive(
    folder: Record<string, unknown>,
    parentPath: string[],
    out: XbelFolder[],
  ): void {
    const folderTitle = (folder.title as string) || '';
    const folderId = (folder['@_id'] as string) || '';
    const currentPath = [...parentPath, folderTitle];
    const displayTitle = currentPath.join(' / ');

    // Collect direct bookmarks in this folder
    const bookmarks = this.parseBookmarks(folder);

    if (bookmarks.length > 0) {
      out.push({
        id: folderId,
        title: displayTitle,
        bookmarks,
      });
      log.verbose(`parseXbel: folder "${displayTitle}" -> ${bookmarks.length} bookmarks`);
    }

    // Recurse into sub-folders
    const subFolders = (folder.folder as Record<string, unknown>[]) || [];
    for (const sub of subFolders) {
      this.parseFolderRecursive(sub, currentPath, out);
    }
  }

  /**
   * Extract bookmarks from a parsed XML node (folder or xbel root).
   */
  private static parseBookmarks(node: Record<string, unknown>): XbelBookmark[] {
    const rawBookmarks = (node.bookmark as Record<string, unknown>[]) || [];
    return rawBookmarks.map(bm => ({
      id: (bm['@_id'] as string) || '',
      title: (bm.title as string) || '',
      href: (bm['@_href'] as string) || '',
      description: (bm.desc as string) || undefined,
    }));
  }

  /**
   * Generate XBEL XML string from structured data.
   */
  static generateXbel(root: XbelRoot): string {
    const folders = root.folders.map(folder => {
      const bookmarks = folder.bookmarks.map(bm => {
        const bookmark: Record<string, unknown> = {
          '@_href': bm.href,
          '@_id': bm.id,
          title: bm.title,
        };
        if (bm.description) {
          bookmark.desc = bm.description;
        }
        return bookmark;
      });

      return {
        '@_id': folder.id,
        title: folder.title,
        bookmark: bookmarks.length > 0 ? bookmarks : undefined,
      };
    });

    const xbelObj = {
      '?xml': { '@_version': '1.0', '@_encoding': 'UTF-8' },
      xbel: {
        '@_version': '1.0',
        folder: folders.length > 0 ? folders : undefined,
      },
    };

    return this.xmlBuilder.build(xbelObj);
  }

  /**
   * Convert XBEL folders to kanban columns.
   * Each XBEL folder becomes a kanban column.
   * Each bookmark becomes a task with a markdown link storing the XBEL ID.
   */
  static xbelToColumns(root: XbelRoot): KanbanColumn[] {
    return root.folders.map((folder, folderIdx) => {
      const tasks: KanbanTask[] = folder.bookmarks.map((bm, bmIdx) => {
        // Format: [Title](url "xbel-id")
        let content = `[${bm.title}](${bm.href} "${bm.id}")`;
        if (bm.description) {
          content += '\n' + bm.description;
        }
        return {
          id: `sync-task-${folderIdx}-${bmIdx}`,
          content,
        };
      });

      return {
        id: `sync-col-${folderIdx}`,
        title: folder.title,
        tasks,
      };
    });
  }

  /**
   * Convert kanban columns to XBEL folders.
   * Only tasks that contain a markdown link are converted to bookmarks.
   * Tasks without links are silently skipped (invisible to Floccus).
   */
  static columnsToXbel(columns: KanbanColumn[]): XbelRoot {
    const folders: XbelFolder[] = columns.map((column, colIdx) => {
      const bookmarks: XbelBookmark[] = [];

      for (const task of column.tasks) {
        const firstLine = (task.content || '').split('\n')[0];
        const remainingLines = (task.content || '').split('\n').slice(1).join('\n').trim();

        const match = firstLine.match(LINK_REGEX);
        if (match) {
          const title = match[1];
          const href = match[2];
          const xbelId = match[3] || `bm-${colIdx}-${bookmarks.length}`;
          const trailingText = match[4].trim();

          const descParts: string[] = [];
          if (trailingText) descParts.push(trailingText);
          if (remainingLines) descParts.push(remainingLines);

          bookmarks.push({
            id: xbelId,
            title,
            href,
            description: descParts.length > 0 ? descParts.join('\n') : undefined,
          });
        }
        // Tasks without links are silently skipped
      }

      return {
        id: `folder-${colIdx}`,
        title: column.title,
        bookmarks,
      };
    });

    return { folders };
  }

  /**
   * Merge incoming XBEL data into existing columns.
   * Uses XBEL ID (stored in link title attribute) for identity matching.
   *
   * - Bookmarks with matching XBEL ID: update title/URL/description
   * - New bookmarks (no matching ID): add as new tasks
   * - Removed bookmarks (ID in column but not in XBEL): remove task
   * - Tasks without links: preserved unchanged
   */
  static mergeXbelIntoColumns(
    incoming: XbelRoot,
    existingColumns: KanbanColumn[]
  ): KanbanColumn[] {
    const result: KanbanColumn[] = [];

    // Build map of existing columns by title for matching
    const existingByTitle = new Map<string, KanbanColumn>();
    for (const col of existingColumns) {
      existingByTitle.set(col.title, col);
    }

    for (const folder of incoming.folders) {
      const existingCol = existingByTitle.get(folder.title);

      if (existingCol) {
        // Merge into existing column
        const mergedTasks: KanbanTask[] = [];

        // Build map of existing tasks by XBEL ID
        const existingByXbelId = new Map<string, KanbanTask>();
        const tasksWithoutLinks: KanbanTask[] = [];

        for (const task of existingCol.tasks) {
          const xbelId = this.extractXbelId(task.content);
          if (xbelId) {
            existingByXbelId.set(xbelId, task);
          } else {
            tasksWithoutLinks.push(task);
          }
        }

        // Process incoming bookmarks
        const processedIds = new Set<string>();
        for (const bm of folder.bookmarks) {
          processedIds.add(bm.id);
          const existing = existingByXbelId.get(bm.id);

          let content = `[${bm.title}](${bm.href} "${bm.id}")`;
          if (bm.description) {
            content += '\n' + bm.description;
          }

          mergedTasks.push({
            id: existing?.id || `sync-task-${mergedTasks.length}`,
            content,
          });
        }

        // Preserve tasks without links
        mergedTasks.push(...tasksWithoutLinks);

        result.push({
          id: existingCol.id,
          title: folder.title,
          tasks: mergedTasks,
        });

        existingByTitle.delete(folder.title);
      } else {
        // New column from XBEL
        const tasks: KanbanTask[] = folder.bookmarks.map((bm, idx) => {
          let content = `[${bm.title}](${bm.href} "${bm.id}")`;
          if (bm.description) {
            content += '\n' + bm.description;
          }
          return {
            id: `sync-task-new-${idx}`,
            content,
          };
        });

        result.push({
          id: `sync-col-new-${result.length}`,
          title: folder.title,
          tasks,
        });
      }
    }

    // Preserve columns that weren't in the XBEL (non-synced columns)
    for (const [, col] of existingByTitle) {
      result.push(col);
    }

    return result;
  }

  /**
   * Extract XBEL ID from a task's content.
   * Looks for [Title](url "xbel-id") pattern.
   */
  static extractXbelId(content: string): string | null {
    if (!content) return null;
    const firstLine = content.split('\n')[0];
    const match = firstLine.match(LINK_REGEX);
    if (match && match[3]) {
      return match[3];
    }
    return null;
  }
}
