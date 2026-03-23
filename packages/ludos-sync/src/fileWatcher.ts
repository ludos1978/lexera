/**
 * File watcher for kanban .md files.
 *
 * Watches configured board files via chokidar.
 * On change: re-parses with SharedMarkdownParser, regenerates XBEL cache.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { watch as chokidarWatch, FSWatcher } from 'chokidar';
import { SharedMarkdownParser, KanbanBoard, KanbanColumn } from '@ludos/shared';
import { XbelMapper, XbelRoot } from './mappers/XbelMapper';
import { IcalMapper, IcalTask } from './mappers/IcalMapper';
import { log } from './logger';

export interface BoardState {
  filePath: string;
  xbelName: string;
  board: KanbanBoard;
  xbelCache: string;
  etag: string;
  lastModified: Date;
  calendarSlug?: string;
  calendarName?: string;
  icalCache?: string;
  icalEtag?: string;
  icalTasks?: IcalTask[];
}

export class BoardFileWatcher {
  private boardStates = new Map<string, BoardState>();
  private watchers = new Map<string, FSWatcher>();
  private suppressPaths = new Set<string>();
  private mutex = new Map<string, Promise<void>>();
  private onBoardChanged: ((filePath: string) => void) | null = null;

  setOnBoardChanged(callback: (filePath: string) => void): void {
    this.onBoardChanged = callback;
  }

  /**
   * Start watching a board file.
   * @param xbelName Custom XBEL filename (e.g. "bookmarks.xbel"). If omitted, derived from .md filename.
   * @param options Optional calendar config: { calendarSlug, calendarName }
   */
  addBoard(filePath: string, xbelName?: string, options?: { calendarSlug?: string; calendarName?: string }): void {
    const resolved = path.resolve(filePath);

    // If already watching, merge calendar options into existing state
    if (this.watchers.has(resolved)) {
      if (options?.calendarSlug) {
        const state = this.boardStates.get(resolved);
        if (state && !state.calendarSlug) {
          state.calendarSlug = options.calendarSlug;
          state.calendarName = options.calendarName || state.calendarName;
          // Regenerate iCal cache for existing board
          this.updateIcalCache(state);
        }
      }
      return;
    }

    // Compute the XBEL filename: use configured name, or derive from .md filename
    const effectiveXbelName = xbelName || path.basename(resolved, '.md') + '.xbel';

    // Initial load
    this.loadBoard(resolved, effectiveXbelName, options);

    // Watch for changes
    const watcher = chokidarWatch(resolved, {
      persistent: false,
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
    });

    watcher.on('change', () => {
      if (this.suppressPaths.has(resolved)) {
        log.verbose(`File change suppressed (self-write): ${resolved}`);
        this.suppressPaths.delete(resolved);
        return;
      }
      log.verbose(`Board file changed externally: ${resolved}`);
      // Preserve calendar config across reloads
      const existingState = this.boardStates.get(resolved);
      this.loadBoard(resolved, effectiveXbelName, {
        calendarSlug: existingState?.calendarSlug,
        calendarName: existingState?.calendarName,
      });
      if (this.onBoardChanged) {
        this.onBoardChanged(resolved);
      }
    });

    this.watchers.set(resolved, watcher);
  }

  /**
   * Stop watching a board file.
   */
  removeBoard(filePath: string): void {
    const resolved = path.resolve(filePath);
    const watcher = this.watchers.get(resolved);
    if (watcher) {
      watcher.close();
      this.watchers.delete(resolved);
    }
    this.boardStates.delete(resolved);
  }

  /**
   * Stop all watchers.
   */
  stopAll(): void {
    for (const watcher of this.watchers.values()) {
      watcher.close();
    }
    this.watchers.clear();
    this.boardStates.clear();
  }

  /**
   * Load/reload a board file from disk.
   * Creates the file with a minimal kanban board if it doesn't exist.
   */
  private loadBoard(filePath: string, xbelName: string, options?: { calendarSlug?: string; calendarName?: string }): void {
    try {
      if (!fs.existsSync(filePath)) {
        this.createEmptyBoard(filePath);
      }

      const content = fs.readFileSync(filePath, 'utf8');
      const fileMtime = fs.statSync(filePath).mtime;
      const board = SharedMarkdownParser.parseMarkdown(content);

      if (!board.valid) {
        log.warn(`Board file is not a valid kanban: ${filePath}`);
        return;
      }

      const xbelRoot = XbelMapper.columnsToXbel(board.columns);
      const xbelXml = XbelMapper.generateXbel(xbelRoot);
      const etag = this.computeEtag(xbelXml);

      const state: BoardState = {
        filePath,
        xbelName,
        board,
        xbelCache: xbelXml,
        etag,
        lastModified: fileMtime,
        calendarSlug: options?.calendarSlug,
        calendarName: options?.calendarName,
      };

      // Generate iCal cache if calendar sync is configured
      if (state.calendarSlug) {
        this.updateIcalCache(state);
      }

      this.boardStates.set(filePath, state);

      log.verbose(`Board loaded: ${filePath} (${board.columns.length} columns, etag=${etag})`);
      log.verbose(`Board "${board.title}" columns: [${board.columns.map(c => c.title).join(', ')}]`);
      log.verbose(`XBEL cache: ${xbelXml.length} bytes`);
      if (state.icalCache) {
        log.verbose(`iCal cache: ${state.icalCache.length} bytes, ${state.icalTasks?.length} tasks`);
      }
    } catch (err) {
      log.error(`Failed to load board ${filePath}:`, err);
    }
  }

  /**
   * Generate/update iCal cache for a board state.
   */
  private updateIcalCache(state: BoardState): void {
    if (!state.calendarSlug) return;
    // Use filePath as boardId so tasks from different boards get unique UIDs
    // even when multiple boards share the same calendar slug (workspace mode)
    const tasks = IcalMapper.columnsToIcalTasks(state.board.columns, state.filePath, state.lastModified);
    const calName = state.calendarName || state.board.title || state.calendarSlug;
    const ical = IcalMapper.generateCalendar(tasks, calName);
    state.icalTasks = tasks;
    state.icalCache = ical;
    state.icalEtag = this.computeEtag(ical);
  }

  /**
   * Create an empty kanban board file, including parent directories.
   */
  private createEmptyBoard(filePath: string): void {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      log.verbose(`Created directory: ${dir}`);
    }

    const title = path.basename(filePath, '.md');
    const content = `---\nkanban-plugin: board\n---\n\n# ${title}\n`;

    fs.writeFileSync(filePath, content, 'utf8');
    log.verbose(`Created new board file: ${filePath}`);
  }

  /**
   * Get the current board state for a file.
   */
  getBoardState(filePath: string): BoardState | undefined {
    return this.boardStates.get(path.resolve(filePath));
  }

  /**
   * Get all board states.
   */
  getAllBoardStates(): BoardState[] {
    return Array.from(this.boardStates.values());
  }

  /**
   * Find a board state by its calendar slug (returns first match).
   */
  getBoardByCalendarSlug(slug: string): BoardState | undefined {
    for (const state of this.boardStates.values()) {
      if (state.calendarSlug === slug) return state;
    }
    return undefined;
  }

  /**
   * Get ALL board states matching a calendar slug.
   * Multiple boards share a slug when "As workspace name" is used.
   */
  getBoardsByCalendarSlug(slug: string): BoardState[] {
    const result: BoardState[] = [];
    for (const state of this.boardStates.values()) {
      if (state.calendarSlug === slug) result.push(state);
    }
    return result;
  }

  /**
   * Get all board states that have calendar sync configured.
   */
  getCalendarBoards(): BoardState[] {
    return Array.from(this.boardStates.values()).filter(s => !!s.calendarSlug);
  }

  /**
   * Apply incoming XBEL data (from Floccus PUT) to a board file.
   * Uses mutex to prevent concurrent read-modify-write.
   */
  async applyXbelToBoard(filePath: string, xbelXml: string): Promise<void> {
    const resolved = path.resolve(filePath);

    // Acquire mutex for this file
    const existing = this.mutex.get(resolved) || Promise.resolve();
    const operation = existing.then(async () => {
      const state = this.boardStates.get(resolved);
      if (!state) {
        log.error(`applyXbel: board not tracked: ${resolved}`);
        throw new Error(`Board not tracked: ${resolved}`);
      }

      log.verbose(`applyXbel: parsing incoming XBEL (${xbelXml.length} bytes)`);
      const incomingXbel = XbelMapper.parseXbel(xbelXml);
      log.verbose(`applyXbel: incoming XBEL has ${incomingXbel.folders?.length || 0} folders`);

      // Read current board from disk (freshest state)
      const currentContent = fs.readFileSync(resolved, 'utf8');
      const currentBoard = SharedMarkdownParser.parseMarkdown(currentContent);

      if (!currentBoard.valid) {
        log.error(`applyXbel: board file is not valid kanban: ${resolved}`);
        throw new Error(`Board file is not valid kanban: ${resolved}`);
      }

      log.verbose(`applyXbel: current board has ${currentBoard.columns.length} columns`);

      // Merge: update columns that match XBEL folders
      const mergedColumns = XbelMapper.mergeXbelIntoColumns(incomingXbel, currentBoard.columns);
      currentBoard.columns = mergedColumns;

      log.verbose(`applyXbel: merged result has ${mergedColumns.length} columns`);

      // Generate updated markdown
      const newMarkdown = SharedMarkdownParser.generateMarkdown(currentBoard);

      // Suppress file watcher for our own write
      this.suppressPaths.add(resolved);

      // Atomic write: write to .tmp, then rename
      const tmpPath = resolved + '.ludos-sync.tmp';
      fs.writeFileSync(tmpPath, newMarkdown, 'utf8');
      fs.renameSync(tmpPath, resolved);

      // Update cache
      const newXbelRoot = XbelMapper.columnsToXbel(mergedColumns);
      const newXbelXml = XbelMapper.generateXbel(newXbelRoot);
      const newEtag = this.computeEtag(newXbelXml);

      const updatedState: BoardState = {
        filePath: resolved,
        xbelName: state.xbelName,
        board: currentBoard,
        xbelCache: newXbelXml,
        etag: newEtag,
        lastModified: new Date(),
        calendarSlug: state.calendarSlug,
        calendarName: state.calendarName,
      };

      if (updatedState.calendarSlug) {
        this.updateIcalCache(updatedState);
      }

      this.boardStates.set(resolved, updatedState);
    });

    this.mutex.set(resolved, operation.catch(() => {}));
    return operation;
  }

  /**
   * Add a card to a specific column in a board file.
   * Uses mutex to prevent concurrent read-modify-write.
   * Follows the applyXbelToBoard pattern.
   */
  async addCardToColumn(filePath: string, colIndex: number, content: string): Promise<void> {
    const resolved = path.resolve(filePath);

    const existing = this.mutex.get(resolved) || Promise.resolve();
    const operation = existing.then(async () => {
      const state = this.boardStates.get(resolved);
      if (!state) {
        throw new Error(`Board not tracked: ${resolved}`);
      }

      // Read current board from disk (freshest state)
      const currentContent = fs.readFileSync(resolved, 'utf8');
      const currentBoard = SharedMarkdownParser.parseMarkdown(currentContent);

      if (!currentBoard.valid) {
        throw new Error(`Board file is not valid kanban: ${resolved}`);
      }

      if (colIndex < 0 || colIndex >= currentBoard.columns.length) {
        throw new Error(`Column index ${colIndex} out of range (0-${currentBoard.columns.length - 1})`);
      }

      // Add the new card to the target column
      const newCard: import('@ludos/shared').KanbanCard = {
        id: `task-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`,
        content,
        checked: false,
      };
      currentBoard.columns[colIndex].cards.push(newCard);

      // Generate updated markdown
      const newMarkdown = SharedMarkdownParser.generateMarkdown(currentBoard);

      // Suppress file watcher for our own write
      this.suppressPaths.add(resolved);

      // Atomic write
      const tmpPath = resolved + '.ludos-sync.tmp';
      fs.writeFileSync(tmpPath, newMarkdown, 'utf8');
      fs.renameSync(tmpPath, resolved);

      // Update cache
      const xbelRoot = XbelMapper.columnsToXbel(currentBoard.columns);
      const xbelXml = XbelMapper.generateXbel(xbelRoot);
      const etag = this.computeEtag(xbelXml);

      const updatedState: BoardState = {
        filePath: resolved,
        xbelName: state.xbelName,
        board: currentBoard,
        xbelCache: xbelXml,
        etag,
        lastModified: new Date(),
        calendarSlug: state.calendarSlug,
        calendarName: state.calendarName,
      };

      if (updatedState.calendarSlug) {
        this.updateIcalCache(updatedState);
      }

      this.boardStates.set(resolved, updatedState);
      log.verbose(`[API] Added card to column ${colIndex} of ${resolved}`);
    });

    this.mutex.set(resolved, operation.catch(() => {}));
    return operation;
  }

  private computeEtag(content: string): string {
    return '"' + crypto.createHash('md5').update(content).digest('hex') + '"';
  }
}
