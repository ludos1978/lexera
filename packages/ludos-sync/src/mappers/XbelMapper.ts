/**
 * Bidirectional XBEL XML <-> KanbanColumn/KanbanTask mapper.
 *
 * XBEL (XML Bookmark Exchange Language) is the format Floccus uses over WebDAV.
 *
 * Mapping rules:
 *   Top-level <folder>  <-> ## Column Title (kanban column)
 *   Sub-folder path     <-> First line of task content (e.g., "Shopping/Deals")
 *   <bookmark>          <-> [Title](url "xbel-id") lines within the task
 *   XBEL ID             <-> stored in the link's title attribute for identity matching
 *
 * Each top-level XBEL folder becomes a kanban column. Sub-folders are flattened
 * into tasks where the sub-path is the first line and bookmarks are aggregated
 * as link lines. Bookmarks directly in a top-level folder become tasks without
 * a sub-path prefix.
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
  children: XbelFolder[];
}

export interface XbelRoot {
  folders: XbelFolder[];
}

/**
 * Regex to extract link with optional xbel-id from a single line.
 * Matches: [Title](url "xbel-id") or [Title](url)
 */
const LINK_REGEX = /^\[([^\]]*)\]\(([^)"]+)(?:\s+"([^"]*)")?\)(.*)$/;

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
   * Parse XBEL XML string into a tree of XbelFolder nodes.
   * Preserves the nested folder hierarchy.
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
        children: [],
      });
      log.verbose(`[XbelMapper.parseXbel] ${rootBookmarks.length} root-level bookmarks -> "Unsorted"`);
    }

    // Parse top-level folders as tree nodes
    const rawFolders = xbel.folder || [];
    for (const folder of rawFolders) {
      result.folders.push(this.parseFolderRecursive(folder));
    }

    const totalBookmarks = this.countBookmarks(result.folders);
    log.verbose(`[XbelMapper.parseXbel] ${result.folders.length} top-level folders, ${totalBookmarks} total bookmarks`);

    return result;
  }

  /**
   * Recursively parse a folder XML node into an XbelFolder tree node.
   */
  private static parseFolderRecursive(folder: Record<string, unknown>): XbelFolder {
    const title = (folder.title as string) || '';
    const id = (folder['@_id'] as string) || '';
    const bookmarks = this.parseBookmarks(folder);
    const children: XbelFolder[] = [];

    const subFolders = (folder.folder as Record<string, unknown>[]) || [];
    for (const sub of subFolders) {
      children.push(this.parseFolderRecursive(sub));
    }

    return { id, title, bookmarks, children };
  }

  /**
   * Count all bookmarks recursively in a folder tree.
   */
  private static countBookmarks(folders: XbelFolder[]): number {
    let count = 0;
    for (const folder of folders) {
      count += folder.bookmarks.length;
      count += this.countBookmarks(folder.children);
    }
    return count;
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
   * Generate XBEL XML string from the tree structure.
   * Recursively nests folder elements to preserve hierarchy.
   */
  static generateXbel(root: XbelRoot): string {
    const folders = root.folders.map(f => this.buildFolderXml(f));

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
   * Recursively build the XML object for a folder and its children.
   */
  private static buildFolderXml(folder: XbelFolder): Record<string, unknown> {
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

    const childFolders = folder.children.map(c => this.buildFolderXml(c));

    const result: Record<string, unknown> = {
      '@_id': folder.id,
      title: folder.title,
    };

    if (bookmarks.length > 0) {
      result.bookmark = bookmarks;
    }
    if (childFolders.length > 0) {
      result.folder = childFolders;
    }

    return result;
  }

  /**
   * Convert XBEL tree to kanban columns.
   * Each top-level folder -> one column.
   * Sub-folders with bookmarks -> tasks with sub-path as first line and links below.
   * Bookmarks directly in the top-level folder -> tasks with links only (no sub-path).
   */
  static xbelToColumns(root: XbelRoot): KanbanColumn[] {
    return root.folders.map((folder, folderIdx) => {
      const tasks: KanbanTask[] = [];
      let taskCounter = 0;

      // Collect (relativePath, bookmarks) pairs by walking the sub-tree
      const pathBookmarks: { path: string; bookmarks: XbelBookmark[] }[] = [];
      this.collectPathBookmarks(folder, '', pathBookmarks);

      for (const { path, bookmarks } of pathBookmarks) {
        const lines: string[] = [];
        if (path) {
          lines.push(path);
        }
        for (const bm of bookmarks) {
          lines.push(`[${bm.title}](${bm.href} "${bm.id}")`);
          if (bm.description) {
            lines.push(bm.description);
          }
        }

        tasks.push({
          id: `sync-task-${folderIdx}-${taskCounter++}`,
          content: lines.join('\n'),
        });
      }

      return {
        id: `sync-col-${folderIdx}`,
        title: folder.title,
        tasks,
      };
    });
  }

  /**
   * Walk the folder tree depth-first, collecting (relativePath, bookmarks) pairs.
   * Only creates entries for nodes that have direct bookmarks.
   * The parentPath is empty for the top-level folder itself.
   */
  private static collectPathBookmarks(
    folder: XbelFolder,
    parentPath: string,
    out: { path: string; bookmarks: XbelBookmark[] }[],
  ): void {
    // Bookmarks directly in this folder
    if (folder.bookmarks.length > 0) {
      out.push({ path: parentPath, bookmarks: folder.bookmarks });
    }

    // Recurse into children
    for (const child of folder.children) {
      const childPath = parentPath ? `${parentPath}/${child.title}` : child.title;
      this.collectPathBookmarks(child, childPath, out);
    }
  }

  /**
   * Convert kanban columns to XBEL tree.
   * Each column -> one top-level folder.
   * Tasks with a sub-path first line -> nested sub-folders with bookmarks.
   * Tasks with links only (no sub-path) -> bookmarks at the top-level folder root.
   */
  static columnsToXbel(columns: KanbanColumn[]): XbelRoot {
    const folders: XbelFolder[] = columns.map((column, colIdx) => {
      const rootFolder: XbelFolder = {
        id: `folder-${colIdx}`,
        title: column.title,
        bookmarks: [],
        children: [],
      };

      for (const task of column.tasks) {
        const parsed = this.parseTaskContent(task.content, colIdx);
        if (!parsed) continue; // no links found, skip

        if (!parsed.subPath) {
          // Bookmarks at root level of this column's folder
          rootFolder.bookmarks.push(...parsed.bookmarks);
        } else {
          // Build nested folders from the sub-path
          this.insertBookmarksAtPath(rootFolder, parsed.subPath, parsed.bookmarks);
        }
      }

      return rootFolder;
    });

    return { folders };
  }

  /**
   * Parse a task's content into sub-path and bookmarks.
   * Returns null if no links are found (task is not XBEL-related).
   *
   * Format:
   *   [optional sub-path line]
   *   [Title](url "xbel-id")
   *   [optional description lines]
   *   [Title2](url2 "xbel-id2")
   *   ...
   */
  private static parseTaskContent(
    content: string,
    colIdx: number,
  ): { subPath: string; bookmarks: XbelBookmark[] } | null {
    if (!content) return null;

    const lines = content.split('\n');
    let subPath = '';
    const bookmarks: XbelBookmark[] = [];
    let bmCounter = 0;
    let currentBookmark: XbelBookmark | null = null;
    let descLines: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      if (!trimmed) continue;

      const match = trimmed.match(LINK_REGEX);
      if (match) {
        // Finalize previous bookmark's description
        if (currentBookmark && descLines.length > 0) {
          currentBookmark.description = descLines.join('\n');
          descLines = [];
        }

        currentBookmark = {
          id: match[3] || `bm-${colIdx}-${bmCounter}`,
          title: match[1],
          href: match[2],
        };
        bookmarks.push(currentBookmark);
        bmCounter++;
      } else if (i === 0) {
        // First line is not a link -> it's a sub-path
        subPath = trimmed;
      } else if (currentBookmark) {
        // Non-link line after a bookmark -> description of previous bookmark
        descLines.push(trimmed);
      }
    }

    // Finalize last bookmark's description
    if (currentBookmark && descLines.length > 0) {
      currentBookmark.description = descLines.join('\n');
    }

    if (bookmarks.length === 0) return null;
    return { subPath, bookmarks };
  }

  /**
   * Insert bookmarks into the folder tree at the given sub-path.
   * Creates intermediate folders as needed.
   */
  private static insertBookmarksAtPath(
    root: XbelFolder,
    subPath: string,
    bookmarks: XbelBookmark[],
  ): void {
    const segments = subPath.split('/');
    let current = root;
    const pathParts: string[] = [];

    for (const segment of segments) {
      pathParts.push(segment);
      let child = current.children.find(c => c.title === segment);
      if (!child) {
        const pathSlug = pathParts.join('-').toLowerCase().replace(/\s+/g, '-');
        child = {
          id: `folder-${pathSlug}`,
          title: segment,
          bookmarks: [],
          children: [],
        };
        current.children.push(child);
      }
      current = child;
    }

    current.bookmarks.push(...bookmarks);
  }

  /**
   * Merge incoming XBEL data into existing columns.
   * - Matches columns by title
   * - Within a column, matches tasks by sub-path (first content line)
   * - Preserves kanban task IDs for matched tasks
   * - Tasks without links are preserved unchanged
   */
  static mergeXbelIntoColumns(
    incoming: XbelRoot,
    existingColumns: KanbanColumn[]
  ): KanbanColumn[] {
    const result: KanbanColumn[] = [];

    const existingByTitle = new Map<string, KanbanColumn>();
    for (const col of existingColumns) {
      existingByTitle.set(col.title, col);
    }

    // Convert incoming XBEL to columns for task-level comparison
    const incomingColumns = this.xbelToColumns(incoming);

    for (const incomingCol of incomingColumns) {
      const existingCol = existingByTitle.get(incomingCol.title);

      if (existingCol) {
        const mergedTasks: KanbanTask[] = [];

        // Build map of existing tasks by sub-path
        const existingBySubPath = new Map<string, KanbanTask>();
        const tasksWithoutLinks: KanbanTask[] = [];

        for (const task of existingCol.tasks) {
          const hasLinks = this.extractXbelIds(task.content).length > 0;
          if (hasLinks) {
            const subPath = this.extractTaskSubPath(task.content);
            existingBySubPath.set(subPath, task);
          } else {
            tasksWithoutLinks.push(task);
          }
        }

        // Process incoming tasks: update content, preserve kanban task ID
        for (const inTask of incomingCol.tasks) {
          const subPath = this.extractTaskSubPath(inTask.content);
          const existing = existingBySubPath.get(subPath);

          mergedTasks.push({
            id: existing?.id || inTask.id,
            content: inTask.content,
          });
        }

        // Preserve tasks without links
        mergedTasks.push(...tasksWithoutLinks);

        result.push({
          id: existingCol.id,
          title: incomingCol.title,
          tasks: mergedTasks,
        });

        existingByTitle.delete(incomingCol.title);
      } else {
        // New column from XBEL
        result.push(incomingCol);
      }
    }

    // Preserve columns that weren't in the XBEL (non-synced columns)
    for (const [, col] of existingByTitle) {
      result.push(col);
    }

    return result;
  }

  /**
   * Extract the sub-path from a task's content.
   * If the first line is not a link, it's the sub-path.
   * Returns empty string for tasks with links on the first line (root bookmarks).
   */
  static extractTaskSubPath(content: string): string {
    if (!content) return '';
    const firstLine = content.split('\n')[0].trim();
    if (firstLine.match(LINK_REGEX)) return '';
    return firstLine;
  }

  /**
   * Extract all XBEL IDs from a task's multi-line content.
   * Searches all lines for [Title](url "xbel-id") patterns.
   */
  static extractXbelIds(content: string): string[] {
    if (!content) return [];
    const ids: string[] = [];
    for (const line of content.split('\n')) {
      const match = line.trim().match(LINK_REGEX);
      if (match && match[3]) {
        ids.push(match[3]);
      }
    }
    return ids;
  }

  /**
   * Extract first XBEL ID from a task's content (convenience for single-link lookups).
   */
  static extractXbelId(content: string): string | null {
    const ids = this.extractXbelIds(content);
    return ids.length > 0 ? ids[0] : null;
  }
}
