import { hashToken, newAuthToken, resetLink, verifyLink } from './tokens';

describe('auth tokens', () => {
  const ORIG = process.env.APP_ORIGIN;
  afterEach(() => { process.env.APP_ORIGIN = ORIG; });

  it('generates high-entropy, URL-safe single-use tokens', () => {
    const a = newAuthToken();
    const b = newAuthToken();
    expect(a).not.toEqual(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/); // base64url: safe in a query string
    expect(a.length).toBeGreaterThanOrEqual(43); // 32 random bytes
  });

  it('never stores the raw token - only its sha256 hash', () => {
    const t = newAuthToken();
    const h = hashToken(t);
    expect(h).toHaveLength(64);
    expect(h).not.toContain(t);
    expect(hashToken(t)).toBe(h); // deterministic lookup key
  });

  it('builds links against APP_ORIGIN (never the request host) and URL-encodes the token', () => {
    process.env.APP_ORIGIN = 'http://localhost:5173/';
    expect(verifyLink('abc')).toBe('http://localhost:5173/verify-email?token=abc');
    expect(resetLink('a b+c')).toBe('http://localhost:5173/reset-password?token=a%20b%2Bc');
  });
});
