// Mock nephele since it uses ESM (import.meta.url) which Jest can't handle
jest.mock('nephele', () => ({
  ForbiddenError: class ForbiddenError extends Error {
    constructor(msg: string) { super(msg); this.name = 'ForbiddenError'; }
  },
}));

import { LocalhostAuth } from './LocalhostAuth';

// Minimal mock for Express Request
function mockRequest(remoteAddress: string): any {
  return {
    socket: { remoteAddress },
    headers: {},
  };
}

describe('LocalhostAuth', () => {
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
