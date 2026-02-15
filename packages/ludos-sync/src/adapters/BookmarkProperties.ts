/**
 * Nephele Properties implementation for bookmark resources.
 *
 * Provides WebDAV properties (displayname, getcontenttype, getetag, etc.)
 * for the virtual XBEL bookmark resources.
 */

import type {
  Properties,
  Resource,
  User,
} from 'nephele';
import { PropertyIsProtectedError } from 'nephele';

const LIVE_PROPERTIES = [
  'creationdate',
  'displayname',
  'getcontentlanguage',
  'getcontentlength',
  'getcontenttype',
  'getetag',
  'getlastmodified',
  'resourcetype',
  'supportedlock',
];

const PROTECTED_PROPERTIES = new Set([
  'creationdate',
  'getcontentlength',
  'getcontenttype',
  'getetag',
  'getlastmodified',
  'resourcetype',
  'supportedlock',
]);

export class BookmarkProperties implements Properties {
  resource: Resource;
  private deadProps = new Map<string, string | Object | Object[]>();

  constructor(resource: Resource) {
    this.resource = resource;
  }

  async get(name: string): Promise<string | Object | Object[] | undefined> {
    switch (name) {
      case 'creationdate':
        return new Date().toISOString();
      case 'displayname':
        return await this.resource.getCanonicalName();
      case 'getcontentlanguage':
        return undefined;
      case 'getcontentlength':
        return String(await this.resource.getLength());
      case 'getcontenttype':
        return await this.resource.getMediaType() || undefined;
      case 'getetag':
        return await this.resource.getEtag();
      case 'getlastmodified':
        return new Date().toUTCString();
      case 'resourcetype':
        return (await this.resource.isCollection()) ? { collection: {} } : undefined;
      case 'supportedlock':
        return undefined; // No lock support
      default:
        return this.deadProps.get(name);
    }
  }

  async getByUser(name: string, _user: User): Promise<string | Object | Object[] | undefined> {
    return this.get(name);
  }

  async set(name: string, value: string | Object | Object[] | undefined): Promise<void> {
    if (PROTECTED_PROPERTIES.has(name)) {
      throw new PropertyIsProtectedError(`Property ${name} is protected.`);
    }
    if (value === undefined) {
      this.deadProps.delete(name);
    } else {
      this.deadProps.set(name, value);
    }
  }

  async setByUser(name: string, value: string | Object | Object[] | undefined, _user: User): Promise<void> {
    return this.set(name, value);
  }

  async remove(name: string): Promise<void> {
    if (PROTECTED_PROPERTIES.has(name)) {
      throw new PropertyIsProtectedError(`Property ${name} is protected.`);
    }
    this.deadProps.delete(name);
  }

  async removeByUser(name: string, _user: User): Promise<void> {
    return this.remove(name);
  }

  async runInstructions(instructions: ['set' | 'remove', string, any][]): Promise<undefined | [string, Error][]> {
    const errors: [string, Error][] = [];
    for (const [action, name, value] of instructions) {
      try {
        if (action === 'set') {
          await this.set(name, value);
        } else {
          await this.remove(name);
        }
      } catch (e) {
        errors.push([name, e as Error]);
      }
    }
    return errors.length > 0 ? errors : undefined;
  }

  async runInstructionsByUser(instructions: ['set' | 'remove', string, any][], _user: User): Promise<undefined | [string, Error][]> {
    return this.runInstructions(instructions);
  }

  async getAll(): Promise<{ [k: string]: string | Object | Object[] }> {
    const result: { [k: string]: string | Object | Object[] } = {};
    for (const name of LIVE_PROPERTIES) {
      const val = await this.get(name);
      if (val !== undefined) {
        result[name] = val;
      }
    }
    for (const [name, val] of this.deadProps) {
      result[name] = val;
    }
    return result;
  }

  async getAllByUser(_user: User): Promise<{ [k: string]: string | Object | Object[] }> {
    return this.getAll();
  }

  async list(): Promise<string[]> {
    return [...LIVE_PROPERTIES, ...this.deadProps.keys()];
  }

  async listByUser(_user: User): Promise<string[]> {
    return this.list();
  }

  async listLive(): Promise<string[]> {
    return [...LIVE_PROPERTIES];
  }

  async listLiveByUser(_user: User): Promise<string[]> {
    return this.listLive();
  }

  async listDead(): Promise<string[]> {
    return [...this.deadProps.keys()];
  }

  async listDeadByUser(_user: User): Promise<string[]> {
    return this.listDead();
  }
}
