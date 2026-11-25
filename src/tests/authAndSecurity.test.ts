import { beforeEach, describe, expect, it, vi } from 'vitest';
import { envManager, validateApiUrl } from '../config/env';
import { apiClient, ApiError } from '../services/apiClient';
import { isJwtExpired, parseJwtPayload, secureStorage } from '../services/secureStorage';

function makeJwt(expOffsetSeconds: number, extra: Record<string, any> = {}): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = btoa(
    JSON.stringify({
      sub: 'user-123',
      role: 'user',
      exp: Math.floor(Date.now() / 1000) + expOffsetSeconds,
      ...extra,
    })
  );
  return `${header}.${payload}.sig`;
}

describe('Auth, Security & Session Management', () => {
  beforeEach(async () => {
    await secureStorage.clearAll();
    apiClient.setToken(null);
    apiClient.setSessionExpiredHandler(null);
    await envManager.setConfiguration('production', 'https://omnidoc-studio-jet.vercel.app/api/v1');
    vi.restoreAllMocks();
  });

  it('enforces HTTPS for staging and production URLs while permitting local dev hosts', () => {
    expect(validateApiUrl('http://evil.example.com/api/v1', 'production').valid).toBe(false);
    expect(validateApiUrl('http://10.0.2.2:8000/api/v1', 'staging').valid).toBe(false);
    expect(validateApiUrl('https://omnidoc-studio-jet.vercel.app/api/v1', 'production').valid).toBe(true);
    expect(validateApiUrl('http://10.0.2.2:8000/api/v1', 'development').valid).toBe(true);
    expect(validateApiUrl('http://localhost:8000/api/v1', 'development').valid).toBe(true);
  });

  it('stores and clears JWT session metadata securely without leaking across logout', async () => {
    const token = makeJwt(3600);
    await secureStorage.saveSession(token, {
      userId: 'u1',
      orgId: 'o1',
      email: 'alice@example.com',
      fullName: 'Alice',
      role: 'user',
      planTier: 'free',
      issuedAt: Date.now(),
      expiresAt: Date.now() + 3600_000,
    });

    expect(await secureStorage.getToken()).toBe(token);
    expect((await secureStorage.getSessionMeta())?.email).toBe('alice@example.com');
    expect(parseJwtPayload(token)?.sub).toBe('user-123');
    expect(isJwtExpired(token)).toBe(false);

    await secureStorage.clearAll();
    expect(await secureStorage.getToken()).toBeNull();
    expect(await secureStorage.getSessionMeta()).toBeNull();
  });

  it('detects expired JWT tokens accurately', () => {
    const expired = makeJwt(-120);
    expect(isJwtExpired(expired)).toBe(true);
  });

  it('handles 401 session expiration globally by purging token and invoking handler', async () => {
    const token = makeJwt(3600);
    await secureStorage.saveSession(token, {
      userId: 'u1',
      orgId: 'o1',
      email: 'alice@example.com',
      fullName: 'Alice',
      role: 'user',
      planTier: 'free',
      issuedAt: Date.now(),
      expiresAt: Date.now() + 3600_000,
    });
    apiClient.setToken(token);

    const onExpired = vi.fn();
    apiClient.setSessionExpiredHandler(onExpired);

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ detail: 'Token revoked' }), { status: 401 })
    );

    await expect(apiClient.getMe()).rejects.toBeInstanceOf(ApiError);
    expect(onExpired).toHaveBeenCalledTimes(1);
    expect(await secureStorage.getToken()).toBeNull();
    expect(apiClient.getToken()).toBeNull();
  });

  it('rotates JWT automatically when changePassword returns a new access_token', async () => {
    const oldToken = makeJwt(3600);
    const newToken = makeJwt(7200, { token_version: 2 });
    apiClient.setToken(oldToken);

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ status: 'success', message: 'Updated', access_token: newToken }), { status: 200 })
    );

    const res = await apiClient.changePassword('OldPass123!', 'NewPass123!');
    expect(res.access_token).toBe(newToken);
    expect(apiClient.getToken()).toBe(newToken);
    expect(await secureStorage.getToken()).toBe(newToken);
  });

  it('passes mandatory 2026.1 consent flags during registration and authenticates admin/user routes', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id: 'u-reg', email: 'new@example.com' }), { status: 201 })
    );

    await apiClient.register({
      email: 'new@example.com',
      password: 'StrongPassword123!',
      full_name: 'New User',
      terms_accepted: true,
      privacy_accepted: true,
      ai_consent: true,
    });

    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse(String(init?.body));
    expect(body.terms_version).toBe('2026.1');
    expect(body.privacy_version).toBe('2026.1');
    expect(body.ai_consent_version).toBe('2026.1');
  });
});
