import { createHash, randomBytes } from 'crypto';
import * as jwt from 'jsonwebtoken';
const pem = (v?: string) => (v ?? '').replace(/\\n/g, '\n');
export { pem };
export const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');
export const newRefreshToken = () => randomBytes(48).toString('base64url');
/** 256 bits of entropy, URL-safe. Only the sha256 hash is ever persisted. */
export const newAuthToken = () => randomBytes(32).toString('base64url');
export const VERIFY_TTL_MS = () => parseInt(process.env.EMAIL_VERIFY_TTL_HOURS ?? '24', 10) * 3_600_000;
export const RESET_TTL_MS = () => parseInt(process.env.PASSWORD_RESET_TTL_MINUTES ?? '60', 10) * 60_000;
/** Google sign-in handoff ticket: long enough for the browser redirect, short enough to be useless if it leaks. */
export const OAUTH_TICKET_TTL_MS = 120_000;
/** Browser origin used to build the links we email (never derived from the request Host). */
export const appBaseUrl = () => (process.env.APP_ORIGIN ?? process.env.PUBLIC_API_URL ?? 'http://localhost:5173').replace(/\/+$/, '');
export const verifyLink = (token: string) => `${appBaseUrl()}/verify-email?token=${encodeURIComponent(token)}`;
export const resetLink = (token: string) => `${appBaseUrl()}/reset-password?token=${encodeURIComponent(token)}`;
export const normalizeHandle = (h: string) => h.trim().replace(/^@/, '').toLowerCase();
export const accessTtl = () => parseInt(process.env.ACCESS_TTL_SECONDS ?? '900', 10);
export function signAccess(userId: string, roles: string[]) {
  return jwt.sign({ roles }, pem(process.env.JWT_PRIVATE_KEY), { algorithm: 'RS256', subject: userId, expiresIn: accessTtl(), issuer: process.env.JWT_ISSUER ?? 'socialpulse' });
}
