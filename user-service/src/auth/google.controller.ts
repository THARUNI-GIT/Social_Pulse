import { Controller, Get, HttpCode, Post, Query, Req, Res, Body, Logger } from '@nestjs/common';
import { ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';
import type { Request, Response } from 'express';
import { GoogleService } from './google.service';
import { OAUTH_STATE_COOKIE } from './google';

class ExchangeDto {
  @ApiProperty({ description: 'Single-use ticket from the OAuth callback redirect' })
  @IsString() @Length(16, 200) ticket: string;
}

/**
 * Google sign-in. These routes are public (see api-gateway `isPublic`) because a browser
 * navigates to them directly, before any session exists.
 */
@ApiTags('auth')
@Controller('auth')
export class GoogleController {
  private log = new Logger('GoogleOAuth');
  constructor(private google: GoogleService) {}

  private secure(req: Request) {
    if (process.env.COOKIE_SECURE === 'true') return true;
    if (process.env.COOKIE_SECURE === 'false') return false;
    return req.protocol === 'https' || String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim() === 'https';
  }

  /** Lets the SPA decide whether to render the button, and which path prefix the browser must use. */
  @Get('google/available')
  available() {
    return this.google.describe();
  }

  /**
   * Kicks off the flow. Returns a 302 to Google's consent screen plus the signed state cookie.
   * Failures redirect back to the SPA with an error code so a full-page navigation still shows
   * a readable message instead of raw JSON.
   */
  @Get('google/start')
  start(@Req() req: Request, @Res() res: Response, @Query('from') from?: string) {
    const secure = this.secure(req);
    try {
      const { redirectUrl, cookie } = this.google.start(from, secure);
      res.setHeader('Set-Cookie', cookie);
      return res.redirect(302, redirectUrl);
    } catch (e: any) {
      const code = e?.response?.code ?? 'GOOGLE_START_FAILED';
      this.log.warn(`google/start refused: ${code}`);
      return res.redirect(302, this.google.frontendError(code));
    }
  }

  /** Google redirects the browser here. Any failure still lands the user back on the SPA. */
  @Get('google/callback')
  async callback(@Req() req: Request, @Res() res: Response, @Query('code') code?: string, @Query('state') state?: string, @Query('error') providerError?: string) {
    const secure = this.secure(req);
    const cookieHeader = req.headers.cookie;
    this.log.debug(`google/callback: cookie header present = ${Boolean(cookieHeader)}`);

    if (providerError) return res.redirect(302, this.google.frontendError(providerError === 'access_denied' ? 'CONSENT_DENIED' : 'PROVIDER_ERROR'));
    if (!code) return res.redirect(302, this.google.frontendError('MISSING_CODE'));

    const parsed = this.google.readState(cookieHeader, state);
    if ('error' in parsed) {
      this.log.warn(`google/callback state rejected: ${parsed.error}`);
      // Always clear the state cookie on failure too, so a retry starts clean.
      res.setHeader('Set-Cookie', this.google.clearCookie(OAUTH_STATE_COOKIE, secure));
      return res.redirect(302, this.google.frontendError(parsed.error));
    }

    try {
      const profile = await this.google.getProfile(code, parsed.verifier);
      const { user } = await this.google.resolveUser(profile);
      const ticket = await this.google.issueTicket(user.id);
      // The state cookie is single-use: clear it now that we have validated it.
      res.setHeader('Set-Cookie', this.google.clearCookie(OAUTH_STATE_COOKIE, secure));
      return res.redirect(302, this.google.frontendCallback(ticket, parsed.returnTo));
    } catch (e: any) {
      const code2 = e?.response?.code ?? e?.code ?? 'OAUTH_FAILED';
      this.log.warn(`google/callback failed: ${code2}`);
      res.setHeader('Set-Cookie', this.google.clearCookie(OAUTH_STATE_COOKIE, secure));
      return res.redirect(302, this.google.frontendError(code2));
    }
  }

  /** Trades the single-use ticket for a normal session (same shape as POST /auth/login). */
  @Post('google/exchange')
  @HttpCode(200)
  exchange(@Body() dto: ExchangeDto) {
    return this.google.exchangeTicket(dto.ticket);
  }
}
