import { BadRequestException, ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { PrismaService } from '../common/prisma.service';
import { EventsService } from '../events/events.service';
import { EmailService } from '../email/email.service';
import { ForgotPasswordDto, LoginDto, RegisterDto, ResetPasswordDto } from './auth.dto';
import {
  accessTtl,
  hashToken,
  newAuthToken,
  newRefreshToken,
  OAUTH_TICKET_TTL_MS,
  RESET_TTL_MS,
  resetLink,
  signAccess,
  VERIFY_TTL_MS,
  verifyLink,
} from './tokens';
import { toSelf } from '../users/users.service';

const bad = () => new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: 'Invalid credentials' });
const badToken = (code: string, message: string) => new BadRequestException({ code, message });

export const TOKEN_KIND = { verify: 'email_verification', reset: 'password_reset', oauth: 'oauth_ticket' } as const;

@Injectable()
export class AuthService {
  constructor(private db: PrismaService, private events: EventsService, private email: EmailService) {}

  private async issue(u: { id: string; roles: string[] }) {
    const refreshToken = newRefreshToken();
    const days = parseInt(process.env.REFRESH_TTL_DAYS ?? '30', 10);
    await this.db.refreshToken.create({ data: { userId: u.id, tokenHash: hashToken(refreshToken), expiresAt: new Date(Date.now() + days * 864e5) } });
    return { accessToken: signAccess(u.id, u.roles), refreshToken, expiresIn: accessTtl() };
  }

  /**
   * Local-development escape hatch: only when NODE_ENV !== 'production' *and*
   * AUTH_DEV_RETURN_LINKS=true does the response echo the emailed link, so a demo without an SMTP
   * account can still complete verification/reset. Production never sets either, so the token
   * stays out of the API surface there.
   */
  private devLink(link: string): { devLink?: string } {
    const enabled = process.env.AUTH_DEV_RETURN_LINKS === 'true' && process.env.NODE_ENV !== 'production';
    return enabled ? { devLink: link } : {};
  }

  /** Creates a fresh single-use token of `kind`, invalidating any earlier unused one. */
  private async issueAuthToken(userId: string, kind: string, ttlMs: number): Promise<string> {
    const token = newAuthToken();
    await this.db.authToken.deleteMany({ where: { userId, kind, usedAt: null } });
    await this.db.authToken.create({ data: { userId, kind, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + ttlMs) } });
    return token;
  }

  /** Validates and atomically consumes a token. Throws with a distinct code on expiry/reuse. */
  private async consumeAuthToken(token: string, kind: string) {
    const row = await this.db.authToken.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
    if (!row || row.kind !== kind) throw badToken('INVALID_TOKEN', 'This link is invalid');
    if (row.usedAt) throw badToken('TOKEN_USED', 'This link has already been used');
    if (row.expiresAt < new Date()) throw badToken('TOKEN_EXPIRED', 'This link has expired');
    // Conditional update makes reuse safe even under concurrent requests.
    const { count } = await this.db.authToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
    if (!count) throw badToken('TOKEN_USED', 'This link has already been used');
    return row.user;
  }

  async register(dto: RegisterDto) {
    const dup = await this.db.user.findFirst({ where: { OR: [{ email: dto.email }, { handle: dto.handle }] }, select: { email: true } });
    if (dup) throw new ConflictException({ code: 'USER_EXISTS', message: dup.email === dto.email ? 'Email already registered' : 'Handle taken' });
    const user = await this.db.user.create({ data: { email: dto.email, handle: dto.handle, displayName: dto.displayName.trim(), passwordHash: await argon2.hash(dto.password) } });
    await this.events.publish('user.registered', { userId: user.id, handle: user.handle, displayName: user.displayName, createdAt: user.createdAt });
    const mail = await this.sendVerification(user.id, user.email);
    return { ...(await this.issue(user)), user: toSelf(user, { followers: 0, following: 0 }), emailVerificationSent: mail.delivered, ...this.devLink(mail.link) };
  }

  private async sendVerification(userId: string, email: string) {
    const token = await this.issueAuthToken(userId, TOKEN_KIND.verify, VERIFY_TTL_MS());
    const link = verifyLink(token);
    const { delivered } = await this.email.sendVerification(email, link);
    return { delivered, link };
  }

  async login(dto: LoginDto) {
    const user = await this.db.user.findFirst({ where: dto.identifier.includes('@') ? { email: dto.identifier } : { handle: dto.identifier } });
    if (!user || !(await argon2.verify(user.passwordHash, dto.password))) throw bad();
    if (user.suspendedAt) throw new UnauthorizedException({ code: 'ACCOUNT_SUSPENDED', message: 'Account suspended' });
    // Login policy: unverified accounts may sign in (so a demo never dead-ends) but the account is
    // flagged via `user.verified` and the UI prompts them to confirm their email.
    return { ...(await this.issue(user)), user: toSelf(user, await this.counts(user.id)) };
  }

  /** Rotation: old token is revoked on use. Reuse of a revoked token revokes every session (theft signal). */
  async refresh(token: string) {
    const row = await this.db.refreshToken.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
    if (!row) throw new UnauthorizedException({ code: 'INVALID_REFRESH', message: 'Invalid refresh token' });
    if (row.revokedAt) { await this.db.refreshToken.updateMany({ where: { userId: row.userId, revokedAt: null }, data: { revokedAt: new Date() } });
      throw new UnauthorizedException({ code: 'REFRESH_REUSED', message: 'Session revoked' }); }
    if (row.expiresAt < new Date() || row.user.suspendedAt) throw new UnauthorizedException({ code: 'INVALID_REFRESH', message: 'Refresh token expired' });
    const { count } = await this.db.refreshToken.updateMany({ where: { id: row.id, revokedAt: null }, data: { revokedAt: new Date() } });
    if (!count) throw new UnauthorizedException({ code: 'INVALID_REFRESH', message: 'Invalid refresh token' });
    return this.issue(row.user);
  }

  /**
   * Signed-in password change. Verifies the current password, stores the new hash and revokes every
   * session (a password change must not leave an old device signed in), then returns a fresh token
   * pair so the device that made the change stays signed in.
   */
  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.db.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Unknown account' });
    if (!(await argon2.verify(user.passwordHash, currentPassword))) {
      throw new BadRequestException({ code: 'INVALID_PASSWORD', message: 'Current password is incorrect' });
    }
    if (currentPassword === newPassword) {
      throw new BadRequestException({ code: 'SAME_PASSWORD', message: 'Choose a different password' });
    }
    const updated = await this.db.user.update({ where: { id: userId }, data: { passwordHash: await argon2.hash(newPassword) } });
    await this.db.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    return { ...(await this.issue(updated)), user: toSelf(updated, await this.counts(userId)) };
  }

  async logout(token: string) {
    await this.db.refreshToken.updateMany({ where: { tokenHash: hashToken(token), revokedAt: null }, data: { revokedAt: new Date() } });
    return { loggedOut: true };
  }

  // ---- email verification ----
  async verifyEmail(token: string) {
    const user = await this.consumeAuthToken(token, TOKEN_KIND.verify);
    if (!user.verified) await this.db.user.update({ where: { id: user.id }, data: { verified: true } });
    await this.events.publish('user.verified', { userId: user.id });
    return { verified: true };
  }

  /** Authenticated: resend to the caller's own address (no user enumeration). */
  async resendVerification(userId: string) {
    const user = await this.db.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Unknown account' });
    if (user.verified) throw new BadRequestException({ code: 'ALREADY_VERIFIED', message: 'This email is already verified' });
    const mail = await this.sendVerification(user.id, user.email);
    return { sent: mail.delivered, ...this.devLink(mail.link) };
  }

  // ---- password reset ----
  /** Always the same response, whether or not the address exists, to avoid account discovery. */
  async requestPasswordReset(dto: ForgotPasswordDto) {
    const user = await this.db.user.findUnique({ where: { email: dto.email } });
    if (!user || user.suspendedAt) return { sent: true };
    const token = await this.issueAuthToken(user.id, TOKEN_KIND.reset, RESET_TTL_MS());
    const link = resetLink(token);
    const { delivered } = await this.email.sendPasswordReset(user.email, link);
    return { sent: true, ...this.devLink(link), delivered };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const user = await this.consumeAuthToken(dto.token, TOKEN_KIND.reset);
    await this.db.user.update({ where: { id: user.id }, data: { passwordHash: await argon2.hash(dto.password) } });
    // A reset invalidates every existing session: the old password may be compromised.
    await this.db.refreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
    await this.events.publish('user.password_reset', { userId: user.id });
    return { reset: true };
  }

  /**
   * Google sign-in handoff. The callback redirects to the SPA with this single-use ticket instead
   * of tokens, so credentials never land in the URL, the browser history, or a Referer header.
   */
  issueOAuthTicket(userId: string): Promise<string> {
    return this.issueAuthToken(userId, TOKEN_KIND.oauth, OAUTH_TICKET_TTL_MS);
  }
  async exchangeOAuthTicket(ticket: string) {
    const user = await this.consumeAuthToken(ticket, TOKEN_KIND.oauth);
    if (user.suspendedAt) throw new UnauthorizedException({ code: 'ACCOUNT_SUSPENDED', message: 'Account suspended' });
    return { ...(await this.issue(user)), user: toSelf(user, await this.counts(user.id)) };
  }

  private async counts(id: string) {
    const [followers, following] = await Promise.all([this.db.follow.count({ where: { followingId: id } }), this.db.follow.count({ where: { followerId: id } })]);
    return { followers, following };
  }
}
