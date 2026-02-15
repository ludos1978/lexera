/**
 * Nephele Resource implementation for bookmark XBEL files.
 *
 * Two resource types:
 * 1. Collection (root "/bookmarks/") — lists XBEL files
 * 2. XBEL file ("/bookmarks/board-name.xbel") — serves/accepts XBEL XML
 */

import { Readable } from 'node:stream';
import type {
  Adapter,
  Lock,
  Properties,
  Resource,
  User,
} from 'nephele';
import {
  MethodNotSupportedError,
  ResourceNotFoundError,
  ForbiddenError,
} from 'nephele';
import { BookmarkProperties } from './BookmarkProperties';
import type { BoardFileWatcher, BoardState } from '../fileWatcher';
import { log } from '../logger';

export class BookmarkResource implements Resource {
  adapter: Adapter;
  baseUrl: URL;

  private isRoot: boolean;
  private boardState: BoardState | null;
  private boardWatcher: BoardFileWatcher;
  private resourceName: string;
  private resourcePath: string;

  constructor(
    adapter: Adapter,
    baseUrl: URL,
    isRoot: boolean,
    boardState: BoardState | null,
    boardWatcher: BoardFileWatcher,
    resourceName: string,
    resourcePath: string,
  ) {
    this.adapter = adapter;
    this.baseUrl = baseUrl;
    this.isRoot = isRoot;
    this.boardState = boardState;
    this.boardWatcher = boardWatcher;
    this.resourceName = resourceName;
    this.resourcePath = resourcePath;
  }

  // Lock management — no lock support
  async getLocks(): Promise<Lock[]> {
    return [];
  }

  async getLocksByUser(_user: User): Promise<Lock[]> {
    return [];
  }

  async createLockForUser(_user: User): Promise<Lock> {
    throw new ForbiddenError('Locking is not supported.');
  }

  async getProperties(): Promise<Properties> {
    return new BookmarkProperties(this);
  }

  /**
   * GET: serve XBEL content for a board.
   */
  async getStream(_range?: { start: number; end: number }): Promise<Readable> {
    if (this.isRoot) {
      throw new MethodNotSupportedError('Cannot GET a collection.');
    }

    if (!this.boardState) {
      log.warn(`GET ${this.resourceName}: board not found`);
      throw new ResourceNotFoundError('Board not found.');
    }

    const content = this.boardState.xbelCache;
    log.verbose(`GET ${this.resourceName}: serving ${content.length} bytes, etag=${this.boardState.etag}`);
    return Readable.from(Buffer.from(content, 'utf8'));
  }

  /**
   * PUT: receive XBEL from Floccus and update the board file.
   */
  async setStream(input: Readable, _user: User, _mediaType?: string): Promise<void> {
    if (this.isRoot) {
      throw new MethodNotSupportedError('Cannot PUT to a collection.');
    }

    if (!this.boardState) {
      log.warn(`PUT ${this.resourceName}: board not found`);
      throw new ResourceNotFoundError('Board not found.');
    }

    // Read the full XBEL body
    const chunks: Buffer[] = [];
    for await (const chunk of input) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const xbelXml = Buffer.concat(chunks).toString('utf8');

    log.info(`PUT ${this.resourceName}: received ${xbelXml.length} bytes from client`);
    log.verbose(`PUT ${this.resourceName}: applying XBEL to ${this.boardState.filePath}`);

    await this.boardWatcher.applyXbelToBoard(this.boardState.filePath, xbelXml);

    // Refresh board state reference
    this.boardState = this.boardWatcher.getBoardState(this.boardState.filePath) || null;
    log.info(`PUT ${this.resourceName}: board updated, new etag=${this.boardState?.etag}`);
  }

  async create(_user: User): Promise<void> {
    // Resources are virtual; nothing to create on disk
  }

  async delete(_user: User): Promise<void> {
    throw new ForbiddenError('Cannot delete bookmark resources.');
  }

  async copy(_destination: URL, _baseUrl: URL, _user: User): Promise<void> {
    throw new ForbiddenError('Cannot copy bookmark resources.');
  }

  async move(_destination: URL, _baseUrl: URL, _user: User): Promise<void> {
    throw new ForbiddenError('Cannot move bookmark resources.');
  }

  async getLength(): Promise<number> {
    if (this.isRoot) return 0;
    if (!this.boardState) return 0;
    return Buffer.byteLength(this.boardState.xbelCache, 'utf8');
  }

  async getEtag(): Promise<string> {
    if (this.isRoot) return '"root-collection"';
    if (!this.boardState) return '"empty"';
    return this.boardState.etag;
  }

  async getMediaType(): Promise<string | null> {
    if (this.isRoot) return null;
    return 'application/xml';
  }

  async getCanonicalName(): Promise<string> {
    return this.resourceName;
  }

  async getCanonicalPath(): Promise<string> {
    const url = await this.getCanonicalUrl();
    return url.pathname;
  }

  async getCanonicalUrl(): Promise<URL> {
    if (this.isRoot) {
      return new URL(this.baseUrl.toString().replace(/\/?$/, '/'));
    }
    // Use resourceName (no leading /) so URL resolves relative to baseUrl
    const base = this.baseUrl.toString().replace(/\/?$/, '/');
    return new URL(this.resourceName, base);
  }

  async isCollection(): Promise<boolean> {
    return this.isRoot;
  }

  /**
   * PROPFIND on root collection: list all tracked boards as .xbel files.
   */
  async getInternalMembers(_user: User): Promise<Resource[]> {
    if (!this.isRoot) return [];

    const members: Resource[] = [];
    for (const state of this.boardWatcher.getAllBoardStates()) {
      members.push(new BookmarkResource(
        this.adapter,
        this.baseUrl,
        false,
        state,
        this.boardWatcher,
        state.xbelName,
        `/${state.xbelName}`,
      ));
    }
    return members;
  }
}
