/**
 * Virtual resource for Floccus .lock files.
 *
 * Floccus creates bookmarks.xbel.lock alongside the main file to prevent
 * concurrent writes. These are simple in-memory resources that accept
 * GET/PUT/DELETE.
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
} from 'nephele';
import { BookmarkProperties } from './BookmarkProperties';
import { log } from '../logger';

/** In-memory store for lock file contents, keyed by resource name */
const lockStore = new Map<string, { content: string; modified: Date }>();

export class LockResource implements Resource {
  adapter: Adapter;
  baseUrl: URL;
  private resourceName: string;

  constructor(adapter: Adapter, baseUrl: URL, resourceName: string) {
    this.adapter = adapter;
    this.baseUrl = baseUrl;
    this.resourceName = resourceName;
  }

  async getLocks(): Promise<Lock[]> { return []; }
  async getLocksByUser(_user: User): Promise<Lock[]> { return []; }
  async createLockForUser(_user: User): Promise<Lock> {
    throw new MethodNotSupportedError('Locking not supported.');
  }

  async getProperties(): Promise<Properties> {
    return new BookmarkProperties(this);
  }

  async getStream(): Promise<Readable> {
    const entry = lockStore.get(this.resourceName);
    if (!entry) {
      throw new ResourceNotFoundError('Lock file not found.');
    }
    log.verbose(`GET lock: ${this.resourceName} (${entry.content.length} bytes)`);
    return Readable.from(Buffer.from(entry.content, 'utf8'));
  }

  async setStream(input: Readable, _user: User): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const chunk of input) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const content = Buffer.concat(chunks).toString('utf8');
    lockStore.set(this.resourceName, { content, modified: new Date() });
    log.verbose(`PUT lock: ${this.resourceName} (${content.length} bytes)`);
  }

  async create(_user: User): Promise<void> {
    // Accept creation silently
  }

  async delete(_user: User): Promise<void> {
    lockStore.delete(this.resourceName);
    log.verbose(`DELETE lock: ${this.resourceName}`);
  }

  async copy(): Promise<void> { throw new MethodNotSupportedError('Not supported.'); }
  async move(): Promise<void> { throw new MethodNotSupportedError('Not supported.'); }

  async getLength(): Promise<number> {
    const entry = lockStore.get(this.resourceName);
    return entry ? Buffer.byteLength(entry.content, 'utf8') : 0;
  }

  async getEtag(): Promise<string> {
    const entry = lockStore.get(this.resourceName);
    return entry ? `"lock-${entry.modified.getTime()}"` : '"no-lock"';
  }

  async getMediaType(): Promise<string | null> {
    return 'application/octet-stream';
  }

  async getCanonicalName(): Promise<string> {
    return this.resourceName;
  }

  async getCanonicalPath(): Promise<string> {
    const url = await this.getCanonicalUrl();
    return url.pathname;
  }

  async getCanonicalUrl(): Promise<URL> {
    const base = this.baseUrl.toString().replace(/\/?$/, '/');
    return new URL(this.resourceName, base);
  }

  async isCollection(): Promise<boolean> {
    return false;
  }

  async getInternalMembers(): Promise<Resource[]> {
    return [];
  }

  /** Check if a lock file exists in memory */
  static exists(resourceName: string): boolean {
    return lockStore.has(resourceName);
  }
}
