import { beforeEach, describe, expect, it, vi } from 'vitest';
import { envManager, validateApiUrl } from '../config/env';
import { apiClient, ApiError } from '../services/apiClient';
import { parseDeepLinkUrl } from '../services/nativeBridge';
import { isJwtExpired, parseJwtPayload, secureStorage, validateJwtStructure } from '../services/secureStorage';

function toBase64Url(obj: Record<string, any>): string {
  return btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function makeJwt(expOffsetSeconds: number, extra: Record<string, any> = {}): string {
  const header = toBase64Url({ alg: 'HS256', typ: 'JWT' });
  const payload = toBase64Url({
    sub: 'user-123',
    role: 'user',
    exp: Math.floor(Date.now() / 1000) + expOffsetSeconds,
    ...extra,
  });
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
    expect(validateApiUrl('', 'production').valid).toBe(false);
    expect(validateApiUrl('ftp://files.example.com/api/v1', 'production').valid).toBe(false);
    expect(validateApiUrl('http://evil.example.com/api/v1', 'production').valid).toBe(false);
    expect(validateApiUrl('http://10.0.2.2:8000/api/v1', 'staging').valid).toBe(false);
    expect(validateApiUrl('https://omnidoc-studio-jet.vercel.app/', 'production')).toEqual({
      valid: true,
      normalized: 'https://omnidoc-studio-jet.vercel.app/api/v1',
    });
    expect(validateApiUrl('http://10.0.2.2:8000/api/v1', 'development').valid).toBe(true);
    expect(validateApiUrl('http://localhost:8000/api/v1', 'development').valid).toBe(true);
    expect(validateApiUrl('http://127.0.0.1:8000', 'development')).toEqual({
      valid: true,
      normalized: 'http://127.0.0.1:8000/api/v1',
    });
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

  it('detects expired JWT tokens and fails closed on malformed or missing-exp payloads', () => {
    const expired = makeJwt(-120);
    const expiringInsideSkew = makeJwt(15);
    expect(isJwtExpired(expired)).toBe(true);
    expect(isJwtExpired(expiringInsideSkew, 30)).toBe(true);
    expect(isJwtExpired(expiringInsideSkew, 5)).toBe(false);

    // Malformed / missing exp / alg=none / missing sub must fail closed (never treated as valid/unexpired)
    const missingExp = `${btoa(JSON.stringify({ alg: 'HS256' }))}.${btoa(JSON.stringify({ sub: 'u1' }))}.sig`;
    const algNone = `${btoa(JSON.stringify({ alg: 'none' }))}.${btoa(JSON.stringify({ sub: 'u1', exp: 9999999999 }))}.sig`;
    const futureNbf = makeJwt(3600, { nbf: Math.floor(Date.now() / 1000) + 600 });

    expect(parseJwtPayload('not-a-jwt')).toBeNull();
    expect(validateJwtStructure(missingExp)).toBe(false);
    expect(isJwtExpired('not-a-jwt')).toBe(true);
    expect(isJwtExpired(missingExp)).toBe(true);
    expect(isJwtExpired(algNone)).toBe(true);
    expect(isJwtExpired(futureNbf)).toBe(true);
  });

  it('validates deep links strictly and blocks embedded access_token parameters', () => {
    const appLink = parseDeepLinkUrl('https://omnidoc-studio-jet.vercel.app/mobile/auth/callback?code=one_time_code_123');
    expect(appLink?.host).toBe('auth');
    expect(appLink?.params.code).toBe('one_time_code_123');

    const unsafeQuery = parseDeepLinkUrl('omnidoc://auth/callback?access_token=jwt.secret.token');
    expect(unsafeQuery?.host).toBe('rejected');
    expect(unsafeQuery?.securityWarning).toBeTruthy();

    const unsafeHash = parseDeepLinkUrl('https://omnidoc-studio-jet.vercel.app/mobile/auth/callback#access_token=leak');
    expect(unsafeHash?.host).toBe('rejected');

    expect(parseDeepLinkUrl('https://evil.example.com/mobile/auth/callback?code=123')).toBeNull();
    expect(parseDeepLinkUrl('omnidoc://unknown_route/foo')).toBeNull();
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

  it('passes mandatory 2026.1 consent flags during registration and validates token shapes', async () => {
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

  it('deduplicates rapid identical mutations and supports renameProject PATCH with version guard', async () => {
    apiClient.setToken(makeJwt(3600));
    let callCount = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      callCount += 1;
      await new Promise((r) => setTimeout(r, 15));
      return new Response(
        JSON.stringify({
          id: 'proj-1',
          org_id: 'org-1',
          owner_user_id: 'user-123',
          title: 'Renamed Deck',
          project_type: 'slides',
          version: 2,
          size_bytes: 512,
          content_hash_sha256: 'hash',
          tags: [],
          is_deleted: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }),
        { status: 200 }
      );
    });

    const [first, second] = await Promise.all([
      apiClient.renameProject('proj-1', 'Renamed Deck', 1),
      apiClient.renameProject('proj-1', 'Renamed Deck', 1),
    ]);
    expect(callCount).toBe(1);
    expect(first.title).toBe('Renamed Deck');
    expect(second.version).toBe(2);
    await expect(apiClient.renameProject('proj-1', '   ')).rejects.toBeInstanceOf(ApiError);
  });
});
