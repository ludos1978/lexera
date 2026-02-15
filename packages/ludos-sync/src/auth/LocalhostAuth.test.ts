// Mock nephele since it uses ESM (import.meta.url) which Jest can't handle
jest.mock('nephele', () => ({
  ForbiddenError: class ForbiddenError extends Error {
    constructor(msg: string) { super(msg); this.name = 'ForbiddenError'; }
  },
  UnauthorizedError: class UnauthorizedError extends Error {
    constructor(msg: string) { super(msg); this.name = 'UnauthorizedError'; }
  },
}));

import { LocalhostAuth } from './LocalhostAuth';

// Minimal mock for Express Request
function mockRequest(remoteAddress: string, authorization?: string): any {
  return {
    socket: { remoteAddress },
    headers: authorization ? { authorization } : {},
  };
}

function basicAuth(username: string, password: string): string {
  return 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
}

describe('LocalhostAuth', () => {
  describe('without credentials', () => {
    const auth = new LocalhostAuth();

    it('should accept 127.0.0.1', async () => {
      const user = await auth.authenticate(mockRequest('127.0.0.1'), {} as any);
      expect(user.username).toBe('localhost');
    });

    it('should accept ::1', async () => {
      const user = await auth.authenticate(mockRequest('::1'), {} as any);
      expect(user.username).toBe('localhost');
    });

    it('should accept ::ffff:127.0.0.1', async () => {
      const user = await auth.authenticate(mockRequest('::ffff:127.0.0.1'), {} as any);
      expect(user.username).toBe('localhost');
    });

    it('should reject external addresses', async () => {
      await expect(auth.authenticate(mockRequest('192.168.1.100'), {} as any))
        .rejects.toThrow('Connection rejected');
    });

    it('should reject empty address', async () => {
      await expect(auth.authenticate(mockRequest(''), {} as any))
        .rejects.toThrow('Connection rejected');
    });

    it('cleanAuthentication should succeed', async () => {
      await expect(auth.cleanAuthentication({} as any, {} as any)).resolves.toBeUndefined();
    });
  });

  describe('with credentials', () => {
    const auth = new LocalhostAuth({ username: 'admin', password: 'secret' });

    it('should accept valid credentials from localhost', async () => {
      const user = await auth.authenticate(
        mockRequest('127.0.0.1', basicAuth('admin', 'secret')),
        {} as any,
      );
      expect(user.username).toBe('admin');
    });

    it('should reject missing auth header from localhost', async () => {
      await expect(auth.authenticate(mockRequest('127.0.0.1'), {} as any))
        .rejects.toThrow('Authentication required');
    });

    it('should reject wrong password from localhost', async () => {
      await expect(
        auth.authenticate(mockRequest('::1', basicAuth('admin', 'wrong')), {} as any),
      ).rejects.toThrow('Invalid credentials');
    });

    it('should reject wrong username from localhost', async () => {
      await expect(
        auth.authenticate(mockRequest('::1', basicAuth('nobody', 'secret')), {} as any),
      ).rejects.toThrow('Invalid credentials');
    });

    it('should still reject external addresses even with valid credentials', async () => {
      await expect(
        auth.authenticate(mockRequest('192.168.1.100', basicAuth('admin', 'secret')), {} as any),
      ).rejects.toThrow('Connection rejected');
    });

    it('should reject malformed auth header', async () => {
      await expect(
        auth.authenticate(mockRequest('127.0.0.1', 'Bearer token'), {} as any),
      ).rejects.toThrow('Authentication required');
    });
  });
});
