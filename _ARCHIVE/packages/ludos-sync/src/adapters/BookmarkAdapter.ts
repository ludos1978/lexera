/**
 * Nephele Adapter for bookmark sync.
 *
 * Maps WebDAV URLs to virtual XBEL resources backed by kanban .md files.
 *
 * URL structure:
 *   /                     -> root collection (lists .xbel files)
 *   /board-name.xbel      -> XBEL file for a specific board
 */

import type { Request } from 'express';
import type {
  Adapter,
  AuthResponse,
  Resource,
  User,
} from 'nephele';
import {
  ResourceNotFoundError,
  MethodNotImplementedError,
  Method,
} from 'nephele';
import { BookmarkResource } from './BookmarkResource';
import { LockResource } from './LockResource';
import type { BoardFileWatcher } from '../fileWatcher';
import { log } from '../logger';

export class BookmarkAdapter implements Adapter {
  private boardWatcher: BoardFileWatcher;

  constructor(boardWatcher: BoardFileWatcher) {
    this.boardWatcher = boardWatcher;
  }

  async getComplianceClasses(
    _url: URL,
    _request: Request,
    _response: AuthResponse,
  ): Promise<string[]> {
    // No lock support (class 1 only)
    return [];
  }

  async getAllowedMethods(
    _url: URL,
    _request: Request,
    _response: AuthResponse,
  ): Promise<string[]> {
    return [];
  }

  async getOptionsResponseCacheControl(
    _url: URL,
    _request: Request,
    _response: AuthResponse,
  ): Promise<string> {
    return 'no-cache';
  }

  async isAuthorized(
    _url: URL,
    _method: string,
    _baseUrl: URL,
    _user: User,
  ): Promise<boolean> {
    // LocalhostAuth handles authorization; once authenticated, all operations allowed.
    return true;
  }

  async getResource(url: URL, baseUrl: URL): Promise<Resource> {
    const resourcePath = decodeURIComponent(url.pathname);
    const basePath = decodeURIComponent(baseUrl.pathname);

    // Strip base path to get relative path within adapter
    let relativePath = resourcePath;
    if (resourcePath.startsWith(basePath)) {
      relativePath = resourcePath.substring(basePath.length);
    }
    // Normalize: remove leading/trailing slashes
    relativePath = relativePath.replace(/^\/+|\/+$/g, '');

    log.verbose(`getResource: url=${resourcePath} base=${basePath} relative="${relativePath}"`);

    if (relativePath === '') {
      log.verbose('getResource: returning root collection');
      return new BookmarkResource(
        this,
        baseUrl,
        true,
        null,
        this.boardWatcher,
        '',
        '/',
      );
    }

    // Handle .lock files (Floccus concurrency control)
    if (relativePath.endsWith('.lock')) {
      if (LockResource.exists(relativePath)) {
        log.verbose(`getResource: returning existing lock file "${relativePath}"`);
        return new LockResource(this, baseUrl, relativePath);
      }
      log.verbose(`getResource: lock file "${relativePath}" not found`);
      throw new ResourceNotFoundError(`Lock file not found: ${relativePath}`);
    }

    // Find the board matching this .xbel filename
    const boardState = this.findBoardByXbelName(relativePath);
    if (!boardState) {
      const tracked = this.boardWatcher.getAllBoardStates().map(s => s.xbelName);
      log.verbose(`getResource: "${relativePath}" not found, tracked xbelNames: [${tracked.join(', ')}]`);
      throw new ResourceNotFoundError(`Resource not found: ${relativePath}`);
    }

    log.verbose(`getResource: "${relativePath}" matched board ${boardState.filePath}`);
    return new BookmarkResource(
      this,
      baseUrl,
      false,
      boardState,
      this.boardWatcher,
      relativePath,
      `/${relativePath}`,
    );
  }

  async newResource(url: URL, baseUrl: URL): Promise<Resource> {
    const resourcePath = decodeURIComponent(url.pathname);
    const basePath = decodeURIComponent(baseUrl.pathname);
    let relativePath = resourcePath;
    if (resourcePath.startsWith(basePath)) {
      relativePath = resourcePath.substring(basePath.length);
    }
    relativePath = relativePath.replace(/^\/+|\/+$/g, '');

    // Handle .lock files (Floccus concurrency control)
    if (relativePath.endsWith('.lock')) {
      log.verbose(`newResource: returning new lock file "${relativePath}"`);
      return new LockResource(this, baseUrl, relativePath);
    }

    // Try to match an existing board
    const boardState = this.findBoardByXbelName(relativePath);
    log.verbose(`newResource: "${relativePath}" -> board ${boardState ? boardState.filePath : 'NOT FOUND'}`);

    return new BookmarkResource(
      this,
      baseUrl,
      false,
      boardState || null,
      this.boardWatcher,
      relativePath,
      `/${relativePath}`,
    );
  }

  async newCollection(_url: URL, _baseUrl: URL): Promise<Resource> {
    throw new MethodNotImplementedError('Creating collections is not supported.');
  }

  getMethod(_method: string): typeof Method {
    throw new MethodNotImplementedError(`Method ${_method} is not supported.`);
  }

  /**
   * Find a tracked board by matching .xbel filename.
   * Matches against the configured xbelName on each board state.
   */
  private findBoardByXbelName(xbelName: string): ReturnType<BoardFileWatcher['getBoardState']> {
    for (const state of this.boardWatcher.getAllBoardStates()) {
      if (state.xbelName === xbelName) {
        return state;
      }
    }
    return undefined;
  }
}
