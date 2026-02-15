/**
 * Nephele authenticator that only accepts connections from localhost.
 * When auth credentials are configured, also requires HTTP Basic Auth.
 *
 * Connections from 127.0.0.1, ::1, or ::ffff:127.0.0.1 are accepted.
 * All other connections are rejected with 403 Forbidden.
 */

import type { Request } from 'express';
import type { Authenticator, AuthResponse, User } from 'nephele';
import { ForbiddenError, UnauthorizedError } from 'nephele';
import { log } from '../logger';

const LOCALHOST_ADDRESSES = new Set([
  '127.0.0.1',
  '::1',
  '::ffff:127.0.0.1',
]);

export interface AuthCredentials {
  username: string;
  password: string;
}

export class LocalhostAuth implements Authenticator {
  private credentials: AuthCredentials | undefined;

  constructor(credentials?: AuthCredentials) {
    this.credentials = credentials;
  }

  async authenticate(request: Request, _response: AuthResponse): Promise<User> {
    const remoteAddress = request.socket.remoteAddress || '';

    if (!LOCALHOST_ADDRESSES.has(remoteAddress)) {
      log.warn(`Auth rejected: ${remoteAddress} is not localhost`);
      throw new ForbiddenError(
        `Connection rejected: only localhost connections are accepted (got ${remoteAddress})`
      );
    }

    if (this.credentials) {
      const authHeader = request.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Basic ')) {
        log.verbose('Auth rejected: missing Basic Auth header');
        throw new UnauthorizedError('Authentication required');
      }

      const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf8');
      const colonIndex = decoded.indexOf(':');
      if (colonIndex === -1) {
        log.verbose('Auth rejected: malformed Basic Auth header');
        throw new UnauthorizedError('Authentication required');
      }

      const username = decoded.slice(0, colonIndex);
      const password = decoded.slice(colonIndex + 1);

      if (username !== this.credentials.username || password !== this.credentials.password) {
        log.warn(`Auth rejected: invalid credentials for user "${username}"`);
        throw new UnauthorizedError('Invalid credentials');
      }

      log.verbose(`Auth accepted: ${remoteAddress} (user: ${username})`);
      return { username };
    }

    log.verbose(`Auth accepted: ${remoteAddress}`);
    return { username: 'localhost' };
  }

  async cleanAuthentication(_request: Request, _response: AuthResponse): Promise<void> {
    // Nothing to clean up
  }
}
