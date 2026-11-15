import { BadRequestException, ForbiddenException, Injectable, Logger, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import * as jwt from 'jsonwebtoken';
import { randomBytes } from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import { PrismaService } from '../common/prisma.service';
import { EventsService } from '../events/events.service';
import { AuthService } from './auth.service';
import {
  OAUTH_STATE_COOKIE,
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
import { pem } from './tokens';

const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const STATE_TTL_SECONDS = 600;

export interface OAuthStateCookie {
  state: string;
  verifier: string;
  returnTo: string;
}

/**
 * Google OAuth 2.0 authorization-code flow with PKCE.
 *
 * CSRF/state is handled *statelessly*: the state + PKCE verifier are signed with the service's
 * RS256 key and handed back to the browser in an httpOnly, SameSite=Lax cookie scoped to
 * /auth/google. The callback compares the cookie against the `state` query parameter, so no
 * server-side session store (and no extra database table) is needed and restarts are safe.
 *
 * The session itself is never put in a URL: the callback redirects to the frontend with a
 * single-use, 2-minute ticket which the SPA exchanges for tokens over POST.
 */
@Injectable()
export class GoogleService {
  private log = new Logger('GoogleOAuth');

  constructor(private db: PrismaService, private events: EventsService, private auth: AuthService) {}

  private clientId() { return process.env.GOOGLE_CLIENT_ID ?? process.env.GOOGLE_CLIENT_ID_WEB ?? ''; }
  private clientSecret() { return process.env.GOOGLE_CLIENT_SECRET ?? ''; }
  private redirectUri() { return process.env.GOOGLE_REDIRECT_URI ?? ''; }
  private appOrigin() { return (process.env.APP_ORIGIN ?? 'http://localhost:5173').replace(/\/+$/, ''); }

  /**
   * Path prefix of the registered redirect URI ("/api" for /api/auth/google/callback, else "").
   *
   * This must drive the state cookie's Path: the browser only attaches a cookie when the request
   * path path-matches the cookie path, and Google sends the user back to the *registered* URI. With
   * the /api alias registered, a cookie scoped to /auth/google is simply never sent on the callback,
   * so every real sign-in failed with MISSING_STATE while a hand-built curl (which sends any cookie
   * you give it) looked fine. The start route has to live under the same prefix so the browser will
   * store the cookie in the first place.
   */
  /**
   * Path prefix shared by the start, callback, and cookie-path routes. When the registered redirect
   * URI is e.g. /auth/google/callback or /api/auth/google/callback, all three routes live under the
   * same prefix so the browser stores the state cookie on the start navigation and sends it back on
   * the callback (cookie Path must path-match the callback URL the browser actually requests).
   */
  private pathPrefix(): string {
    const uri = this.redirectUri();
    if (!uri) return '';
    let pathname = '';
    try { pathname = new URL(uri).pathname.replace(/\/+$/, ''); } catch { return ''; }
    const marker = '/auth/google/callback';
    if (!pathname.endsWith(marker)) return '';
    const candidate = pathname.slice(0, pathname.length - marker.length) || '';
    return candidate;
  }
  /** The path the SPA navigates to in order to kick off the flow (and get the state cookie). */
  startPath() { return `${this.pathPrefix()}/auth/google/start`; }
  /** Cookie scope: a prefix that path-matches both the start and callback URLs. */
  private cookiePath() { return `${this.pathPrefix()}/auth/google`; }

  /** Whether the login button should be offered; never leaks the values themselves. */
  configured() { return googleConfigured() && isValidRedirectUri(this.redirectUri()); }

  /**
   * Public description of the flow for the SPA. `startPath` is the prefix the browser must use so
   * the state cookie is actually stored (see pathPrefix): the button navigates to `${origin}${startPath}`.
   */
  describe() { return { enabled: this.configured(), startPath: this.startPath() }; }

  private sign(payload: OAuthStateCookie & { exp?: number }): string {
    return jwt.sign(payload, pem(process.env.JWT_PRIVATE_KEY), { algorithm: 'RS256', expiresIn: STATE_TTL_SECONDS });
  }
  private unsign(token: string): OAuthStateCookie | null {
    try {
      const p: any = jwt.verify(token, pem(process.env.JWT_PUBLIC_KEY), { algorithms: ['RS256', 'ES256'] });
      if (!p?.state || !p?.verifier) return null;
      return { state: String(p.state), verifier: String(p.verifier), returnTo: String(p.returnTo ?? '/') };
    } catch { return null; }
  }

  /** Cookie attributes for the short-lived state; SameSite=Lax is required for the top-level redirect back. */
  cookie(name: string, value: string, maxAgeSeconds: number, secure: boolean) {
    const parts = [
      `${name}=${encodeURIComponent(value)}`,
      `Path=${this.cookiePath()}`,
      'HttpOnly',
      'SameSite=Lax',
      `Max-Age=${maxAgeSeconds}`,
    ];
    if (secure) parts.push('Secure');
    return parts.join('; ');
  }
  clearCookie(name: string, secure: boolean) {
    return this.cookie(name, '', 0, secure);
  }

  /** Builds the consent redirect and the Set-Cookie header(s) that later prove state ownership. */
  start(rawReturnTo: unknown, secure: boolean) {
    if (!this.configured()) {
      throw new ServiceUnavailableException({
        code: 'GOOGLE_NOT_CONFIGURED',
        message: 'Google sign-in is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URI.',
      });
    }
    const state = newState();
    const verifier = newCodeVerifier();
    const returnTo = safeReturnTo(rawReturnTo);
    const url = buildAuthUrl({
      clientId: this.clientId(),
      redirectUri: this.redirectUri(),
      state,
      codeChallenge: codeChallenge(verifier),
      returnTo,
    });
    // Exactly one Set-Cookie header on the start response: the signed state cookie scoped to a path
    // that the callback will also path-match (cookiePath). Multiple Set-Cookie directives for the same
    // name/path, or a clear+set paired in one header, are reliably ignored by several browsers and
    // surface as MISSING_STATE on the callback. The callback route clears this cookie after validation.
    return {
      redirectUrl: url,
      cookie: this.cookie(OAUTH_STATE_COOKIE, this.sign({ state, verifier, returnTo }), STATE_TTL_SECONDS, secure),
    };
  }

  /** Constant-time-ish comparison; both sides are equal-length random base64url strings. */
  private stateMatches(a: string, b: string): boolean {
    if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
  }

  /** Validates the callback against our signed cookie, returning the PKCE verifier and destination. */
  readState(rawCookie: string | undefined, stateParam: unknown): OAuthStateCookie | { error: string } {
    const cookie = typeof rawCookie === 'string' ? rawCookie : '';
    const entry = cookie.split(';').map((p) => p.trim()).find((p) => p.startsWith(`${OAUTH_STATE_COOKIE}=`));
    if (!entry) return { error: 'MISSING_STATE' };
    let signed = entry.slice(OAUTH_STATE_COOKIE.length + 1);
    try { signed = decodeURIComponent(signed); } catch { /* keep raw */ }
    const parsed = this.unsign(signed);
    if (!parsed) return { error: 'INVALID_STATE' };
    if (!this.stateMatches(parsed.state, String(stateParam ?? ''))) return { error: 'STATE_MISMATCH' };
    return parsed;
  }

  /** Exchanges the authorization code and verifies the returned id_token. */
  async getProfile(code: string, verifier: string) {
    const body = new URLSearchParams({
      code,
      client_id: this.clientId(),
      client_secret: this.clientSecret(),
      redirect_uri: this.redirectUri(),
      grant_type: 'authorization_code',
      code_verifier: verifier,
    });
    const res = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    const json: any = await res.json().catch(() => null);
    if (!res.ok || !json?.id_token) {
      // Never echo the provider response: it can contain the code or a token.
      this.log.warn(`token exchange failed with HTTP ${res.status}`);
      throw new UnauthorizedException({ code: 'GOOGLE_EXCHANGE_FAILED', message: 'Google sign-in could not be completed' });
    }
    const client = new OAuth2Client(this.clientId());
    const ticket = await client.verifyIdToken({ idToken: json.id_token, audience: this.clientId() }).catch(() => null);
    const payload = ticket?.getPayload();
    if (!payload) throw new UnauthorizedException({ code: 'GOOGLE_TOKEN_INVALID', message: 'Google could not verify that sign-in' });
    const profile = profileFromClaims(payload);
    if ('error' in profile) {
      const message = profile.error === 'EMAIL_UNVERIFIED'
        ? 'Your Google email address is not verified'
        : 'Google did not return an email address';
      throw new UnauthorizedException({ code: profile.error, message });
    }
    return profile;
  }

  /**
   * Finds or creates the local account for a verified Google identity.
   *
   * Linking rule: only a *verified* Google email may attach to an existing account, so an attacker
   * cannot claim someone else's address. A Google-only account gets an unguessable random password
   * hash (never disclosed) so the non-nullable column stays valid without granting password login.
   */
  async resolveUser(profile: { email: string; name?: string | null }) {
    const existing = await this.db.user.findUnique({ where: { email: profile.email } });
    if (existing) {
      if (existing.suspendedAt) throw new ForbiddenException({ code: 'ACCOUNT_SUSPENDED', message: 'Account suspended' });
      // Google has confirmed the address, so promote the local flag.
      if (!existing.verified) await this.db.user.update({ where: { id: existing.id }, data: { verified: true } });
      return { user: existing, created: false };
    }

    const taken = new Set(
      (await this.db.user.findMany({ select: { handle: true } })).map((u) => u.handle)
    );
    const base = handleBaseFromEmail(profile.email);
    const handle = uniqueHandle(base, taken);
    const displayName = (profile.name ?? '').trim().slice(0, 50) || handle;
    const user = await this.db.user.create({
      data: {
        email: profile.email,
        handle,
        displayName,
        verified: true,
        passwordHash: await argon2.hash(randomBytes(32).toString('hex')),
      },
    });
    await this.events.publish('user.registered', {
      userId: user.id, handle: user.handle, displayName: user.displayName, createdAt: user.createdAt, provider: 'google',
    });
    return { user, created: true };
  }

  /** Issues the single-use handoff ticket the SPA trades for a session. */
  issueTicket(userId: string) {
    return this.auth.issueOAuthTicket(userId);
  }

  /** Exchanges a handoff ticket for a real session. */
  exchangeTicket(ticket: unknown) {
    const t = String(ticket ?? '').trim();
    if (t.length < 16) throw new BadRequestException({ code: 'INVALID_TOKEN', message: 'This sign-in link is invalid' });
    return this.auth.exchangeOAuthTicket(t);
  }

  /** Where the callback should bounce the browser back to (always the configured frontend). */
  frontendCallback(ticket: string, returnTo: string) {
    const url = new URL(`${this.appOrigin()}/auth/callback`);
    url.searchParams.set('ticket', ticket);
    if (returnTo && returnTo !== '/') url.searchParams.set('from', returnTo);
    return url.toString();
  }
  frontendError(code: string) {
    const url = new URL(`${this.appOrigin()}/auth/callback`);
    url.searchParams.set('error', code);
    return url.toString();
  }

  static readonly stateCookieName = OAUTH_STATE_COOKIE;
}
