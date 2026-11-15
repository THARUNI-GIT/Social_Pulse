import {
  buildAuthUrl,
  codeChallenge,
  googleConfigured,
  handleBaseFromEmail,
  isValidRedirectUri,
  newCodeVerifier,
  newState,
  profileFromClaims,
  safeReturnTo,
  uniqueHandle,
} from './google';

describe('google oauth helpers', () => {
  describe('codeChallenge (PKCE S256)', () => {
    it('matches the RFC 7636 reference vector', () => {
      expect(codeChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
    });
    it('produces a verifier inside the 43-128 char window Google requires', () => {
      const v = newCodeVerifier();
      expect(v.length).toBeGreaterThanOrEqual(43);
      expect(v.length).toBeLessThanOrEqual(128);
      expect(codeChallenge(v)).toMatch(/^[A-Za-z0-9_-]+$/);
    });
    it('never repeats a state value', () => {
      expect(newState()).not.toBe(newState());
    });
  });

  describe('safeReturnTo', () => {
    it('keeps an ordinary same-origin path', () => {
      expect(safeReturnTo('/chat')).toBe('/chat');
    });
    it.each(['//evil.com', 'https://evil.com', '/\\evil.com', 'javascript:alert(1)', 'chat'])(
      'rejects %p as an open-redirect vector',
      (bad) => expect(safeReturnTo(bad)).toBe('/')
    );
    it('falls back for empty/undefined input', () => {
      expect(safeReturnTo(undefined)).toBe('/');
      expect(safeReturnTo('')).toBe('/');
    });
    it('caps runaway values', () => {
      expect(safeReturnTo(`/${'a'.repeat(900)}`).length).toBe(512);
    });
  });

  describe('profileFromClaims', () => {
    const base = { sub: '123', email: 'Person@Example.com', email_verified: true, name: 'Person' };
    it('accepts a verified address and lowercases the email', () => {
      expect(profileFromClaims(base)).toEqual({
        sub: '123', email: 'person@example.com', emailVerified: true, name: 'Person',
      });
    });
    it('refuses an unverified address so it cannot take over an existing account', () => {
      expect(profileFromClaims({ ...base, email_verified: false })).toEqual({ error: 'EMAIL_UNVERIFIED' });
    });
    it('treats a missing email_verified as unverified (fails closed)', () => {
      expect(profileFromClaims({ sub: '1', email: 'a@b.com' })).toEqual({ error: 'EMAIL_UNVERIFIED' });
    });
    it('reports a missing email', () => {
      expect(profileFromClaims({ sub: '1', email_verified: true })).toEqual({ error: 'NO_EMAIL' });
    });
    it('accepts the legacy string form of email_verified', () => {
      const p = profileFromClaims({ ...base, email_verified: 'true' });
      expect(p).toMatchObject({ emailVerified: true });
    });
  });

  describe('handles', () => {
    it('derives a legal handle from the local part', () => {
      expect(handleBaseFromEmail('jane.doe+news@example.com')).toBe('janedoenews');
    });
    it('falls back when the local part is too short or unusable', () => {
      expect(handleBaseFromEmail('a@b.com')).toBe('user');
      expect(handleBaseFromEmail('---@b.com')).toBe('user');
    });
    it('never exceeds the 20-char handle limit', () => {
      expect(handleBaseFromEmail(`${'x'.repeat(60)}@b.com`).length).toBeLessThanOrEqual(20);
    });
    it('appends a suffix while the handle is taken', () => {
      expect(uniqueHandle('jane', new Set(['jane']))).toBe('jane1');
      expect(uniqueHandle('jane', new Set(['jane', 'jane1']))).toBe('jane2');
      expect(uniqueHandle('jane', new Set(['jane', 'jane1', 'jane2']))).toBe('jane3');
    });
    it('returns the base untouched when it is free', () => {
      expect(uniqueHandle('jane', new Set())).toBe('jane');
    });
  });

  describe('configuration guards', () => {
    it('requires all three credential values', () => {
      expect(googleConfigured({} as any)).toBe(false);
      expect(googleConfigured({ GOOGLE_CLIENT_ID: 'a', GOOGLE_CLIENT_SECRET: 'b' } as any)).toBe(false);
      expect(googleConfigured({ GOOGLE_CLIENT_ID: 'a', GOOGLE_CLIENT_SECRET: 'b', GOOGLE_REDIRECT_URI: 'http://x/y' } as any)).toBe(true);
    });
    it('rejects a relative or malformed redirect URI', () => {
      expect(isValidRedirectUri('/auth/google/callback')).toBe(false);
      expect(isValidRedirectUri('not a url')).toBe(false);
      expect(isValidRedirectUri('http://localhost:8180/api/auth/google/callback')).toBe(true);
    });
  });

  describe('buildAuthUrl', () => {
    const url = new URL(buildAuthUrl({
      clientId: 'cid.apps.googleusercontent.com',
      redirectUri: 'http://localhost:8180/api/auth/google/callback',
      state: 'st-123',
      codeChallenge: 'chal-456',
      returnTo: '/chat',
    }));

    it('targets Google with the code flow and S256 PKCE', () => {
      expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
      expect(url.searchParams.get('response_type')).toBe('code');
      expect(url.searchParams.get('code_challenge_method')).toBe('S256');
      expect(url.searchParams.get('code_challenge')).toBe('chal-456');
    });
    it('carries the state and the exact redirect URI back to the provider', () => {
      expect(url.searchParams.get('state')).toBe('st-123');
      expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:8180/api/auth/google/callback');
    });
    it('requests only openid/email/profile scopes', () => {
      expect(url.searchParams.get('scope')).toBe('openid email profile');
    });
  });
});
