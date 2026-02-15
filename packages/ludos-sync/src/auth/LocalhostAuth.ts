/**
 * Nephele authenticator that only accepts connections from localhost.
 *
 * Connections from 127.0.0.1, ::1, or ::ffff:127.0.0.1 are accepted.
 * All other connections are rejected with 403 Forbidden.
 */

import type { Request } from 'express';
import type { Authenticator, AuthResponse, User } from 'nephele';
import { ForbiddenError } from 'nephele';
import { log } from '../logger';

const LOCALHOST_ADDRESSES = new Set([
  '127.0.0.1',
  '::1',
  '::ffff:127.0.0.1',
]);

export class LocalhostAuth implements Authenticator {

  async authenticate(request: Request, _response: AuthResponse): Promise<User> {
    const remoteAddress = request.socket.remoteAddress || '';

    if (!LOCALHOST_ADDRESSES.has(remoteAddress)) {
      log.warn(`Auth rejected: ${remoteAddress} is not localhost`);
      throw new ForbiddenError(
        `Connection rejected: only localhost connections are accepted (got ${remoteAddress})`
      );
    }

    log.verbose(`Auth accepted: ${remoteAddress}`);
    return { username: 'localhost' };
  }

  async cleanAuthentication(_request: Request, _response: AuthResponse): Promise<void> {
    // Nothing to clean up
  }
}
