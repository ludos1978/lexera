/**
 * Bidirectional XBEL XML <-> KanbanColumn/KanbanTask mapper.
 *
 * XBEL (XML Bookmark Exchange Language) is the format Floccus uses over WebDAV.
 *
 * Mapping rules:
 *   Each XBEL folder with bookmarks <-> ## Full / Path / Title (kanban column)
 *   Each <bookmark>                  <-> [Title](url "xbel-id") as individual task
 *   XBEL ID                          <-> stored in the link's title attribute
 *   #stack tag                        <-> added to consecutive columns sharing top-level folder
 *
 * Folders are flattened: "Bookmarks Bar / Shopping / Deals" becomes a column title.
 * Consecutive columns from the same top-level XBEL folder get a #stack tag for
 * visual grouping in the kanban board.
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

  // ── XBEL XML parsing (tree structure) ──

  /**
   * Parse XBEL XML string into a tree of XbelFolder nodes.
   * Preserves the nested folder hierarchy.
   * Root-level bookmarks (not inside any folder) go into an "Unsorted" folder.
   */
  static parseXbel(xml: string): XbelRoot {
    const parsed = this.xmlParser.parse(xml);
    const xbel = parsed.xbel || parsed;
    const result: XbelRoot = { folders: [] };

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

    const rawFolders = xbel.folder || [];
    for (const folder of rawFolders) {
      result.folders.push(this.parseFolderRecursive(folder));
    }

    const totalBookmarks = this.countBookmarks(result.folders);
    log.verbose(`[XbelMapper.parseXbel] ${result.folders.length} top-level folders, ${totalBookmarks} total bookmarks`);

    return result;
  }

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

  private static countBookmarks(folders: XbelFolder[]): number {
    let count = 0;
    for (const folder of folders) {
      count += folder.bookmarks.length;
      count += this.countBookmarks(folder.children);
    }
    return count;
  }

  private static parseBookmarks(node: Record<string, unknown>): XbelBookmark[] {
    const rawBookmarks = (node.bookmark as Record<string, unknown>[]) || [];
    return rawBookmarks.map(bm => ({
      id: (bm['@_id'] as string) || '',
      title: (bm.title as string) || '',
      href: (bm['@_href'] as string) || '',
      description: (bm.desc as string) || undefined,
    }));
  }

  // ── XBEL XML generation (tree structure) ──

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

  // ── XBEL tree <-> Kanban columns ──

  /**
   * Convert XBEL tree to kanban columns.
   * Each folder with bookmarks -> one column with full " / " path title.
   * Each bookmark -> individual task as [Title](url "xbel-id").
   * Consecutive columns sharing the same two topmost folder segments get #stack tag.
   */
  static xbelToColumns(root: XbelRoot): KanbanColumn[] {
    const flatEntries: { path: string; bookmarks: XbelBookmark[] }[] = [];

    for (const folder of root.folders) {
      this.flattenFolderTree(folder, folder.title, flatEntries);
    }

    const columns: KanbanColumn[] = [];
    let prevStackKey = '';

    for (let i = 0; i < flatEntries.length; i++) {
      const { path, bookmarks } = flatEntries[i];
      const segments = path.split(' / ');
      const stackKey = segments.slice(0, 2).join(' / ');
      const needsStack = stackKey === prevStackKey;
      const title = needsStack ? `${path} #stack` : path;

      const tasks: KanbanTask[] = bookmarks.map((bm, bmIdx) => ({
        id: `sync-task-${i}-${bmIdx}`,
        content: this.bookmarkToTaskContent(bm),
      }));

      columns.push({
        id: `sync-col-${i}`,
        title,
        tasks,
      });

      prevStackKey = stackKey;
    }

    log.verbose(`[XbelMapper.xbelToColumns] ${flatEntries.length} folders -> ${columns.length} columns`);
    return columns;
  }

  /**
   * Walk the folder tree depth-first, collecting (fullPath, bookmarks) entries.
   * Only creates entries for nodes that have direct bookmarks.
   */
  private static flattenFolderTree(
    folder: XbelFolder,
    currentPath: string,
    out: { path: string; bookmarks: XbelBookmark[] }[],
  ): void {
    if (folder.bookmarks.length > 0) {
      out.push({ path: currentPath, bookmarks: folder.bookmarks });
    }

    for (const child of folder.children) {
      this.flattenFolderTree(child, `${currentPath} / ${child.title}`, out);
    }
  }

  /**
   * Format a single bookmark as task content.
   */
  private static bookmarkToTaskContent(bm: XbelBookmark): string {
    const link = `[${bm.title}](${bm.href} "${bm.id}")`;
    return bm.description ? `${link}\n${bm.description}` : link;
  }

  /**
   * Convert kanban columns to XBEL tree.
   * Columns with " / " paths are grouped by top-level folder and nested.
   * Each task is a single bookmark: [Title](url "xbel-id").
   */
  static columnsToXbel(columns: KanbanColumn[]): XbelRoot {
    const topFolderMap = new Map<string, XbelFolder>();
    const topFolderOrder: string[] = [];

    for (const column of columns) {
      const folderPath = this.extractFolderPath(column.title);
      if (!folderPath) continue;

      const segments = folderPath.split(' / ');
      const topName = segments[0];

      if (!topFolderMap.has(topName)) {
        topFolderMap.set(topName, {
          id: `folder-${topName.toLowerCase().replace(/\s+/g, '-')}`,
          title: topName,
          bookmarks: [],
          children: [],
        });
        topFolderOrder.push(topName);
      }

      const topFolder = topFolderMap.get(topName)!;

      // Collect bookmarks from tasks
      const bookmarks: XbelBookmark[] = [];
      let bmCounter = 0;
      for (const task of column.tasks) {
        const bm = this.taskContentToBookmark(task.content, bmCounter);
        if (bm) {
          bookmarks.push(bm);
          bmCounter++;
        }
      }

      if (bookmarks.length === 0) continue;

      if (segments.length === 1) {
        // Bookmarks at the top-level folder root
        topFolder.bookmarks.push(...bookmarks);
      } else {
        // Insert into nested sub-folder tree
        this.insertBookmarksAtPath(topFolder, segments.slice(1), bookmarks);
      }
    }

    const folders = topFolderOrder.map(name => topFolderMap.get(name)!);
    return { folders };
  }

  /**
   * Parse task content as a single bookmark link.
   * Returns null if the content doesn't contain a link.
   */
  private static taskContentToBookmark(content: string, fallbackIdx: number): XbelBookmark | null {
    if (!content) return null;
    const firstLine = content.split('\n')[0].trim();
    const match = firstLine.match(LINK_REGEX);
    if (!match) return null;

    const descriptionLines = content.split('\n').slice(1).map(l => l.trim()).filter(l => l);
    const description = descriptionLines.length > 0 ? descriptionLines.join('\n') : undefined;

    return {
      id: match[3] || `bm-auto-${fallbackIdx}`,
      title: match[1],
      href: match[2],
      description,
    };
  }

  /**
   * Insert bookmarks into the folder tree at the given path segments.
   * Creates intermediate folders as needed.
   */
  private static insertBookmarksAtPath(
    root: XbelFolder,
    segments: string[],
    bookmarks: XbelBookmark[],
  ): void {
    let current = root;
    const pathParts: string[] = [root.title];

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
   * Extract the folder path from a column title by stripping #tags.
   * "Bookmarks Bar / Shopping #stack" -> "Bookmarks Bar / Shopping"
   */
  static extractFolderPath(title: string): string {
    if (!title) return '';
    return title.replace(/\s+#\S+/g, '').trim();
  }

  // ── Merge ──

  /**
   * Merge incoming XBEL data into existing columns.
   * - Matches columns by folder path (title stripped of #tags)
   * - Within a column, matches tasks by xbel-id
   * - Preserves kanban task IDs for matched tasks
   * - Tasks without links are preserved unchanged
   * - Non-synced columns are preserved
   */
  static mergeXbelIntoColumns(
    incoming: XbelRoot,
    existingColumns: KanbanColumn[]
  ): KanbanColumn[] {
    const result: KanbanColumn[] = [];

    const existingByPath = new Map<string, KanbanColumn>();
    for (const col of existingColumns) {
      const path = this.extractFolderPath(col.title);
      existingByPath.set(path, col);
    }

    const incomingColumns = this.xbelToColumns(incoming);

    for (const incomingCol of incomingColumns) {
      const incomingPath = this.extractFolderPath(incomingCol.title);
      const existingCol = existingByPath.get(incomingPath);

      if (existingCol) {
        const mergedTasks: KanbanTask[] = [];

        // Map existing tasks by xbel-id
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

        // Process incoming tasks: update content, preserve kanban task ID
        for (const inTask of incomingCol.tasks) {
          const xbelId = this.extractXbelId(inTask.content);
          const existing = xbelId ? existingByXbelId.get(xbelId) : undefined;

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

        existingByPath.delete(incomingPath);
      } else {
        result.push(incomingCol);
      }
    }

    // Preserve non-synced columns
    for (const [, col] of existingByPath) {
      result.push(col);
    }

    return result;
  }

  // ── ID extraction ──

  /**
   * Extract XBEL ID from a task's content (single link per task).
   */
  static extractXbelId(content: string): string | null {
    if (!content) return null;
    const firstLine = content.split('\n')[0].trim();
    const match = firstLine.match(LINK_REGEX);
    return match?.[3] || null;
  }
}
