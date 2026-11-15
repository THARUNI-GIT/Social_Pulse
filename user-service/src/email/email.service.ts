import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

/** Result of an attempted send. `delivered: false` means no SMTP transport is configured. */
export interface SendResult {
  delivered: boolean;
}

const BRAND = 'SocialPulse';

const layout = (title: string, body: string, cta: { label: string; url: string }, footer: string) => `
<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#111827">
  <p style="font-weight:700;font-size:18px;margin:0 0 16px">${BRAND}</p>
  <h1 style="font-size:20px;margin:0 0 12px">${title}</h1>
  <p style="font-size:14px;line-height:1.6;margin:0 0 20px">${body}</p>
  <p style="margin:0 0 20px">
    <a href="${cta.url}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:10px 18px;border-radius:10px;font-size:14px">${cta.label}</a>
  </p>
  <p style="font-size:12px;color:#6b7280;margin:0 0 8px">If the button does not work, paste this link into your browser:</p>
  <p style="font-size:12px;color:#4f46e5;word-break:break-all;margin:0 0 20px">${cta.url}</p>
  <p style="font-size:12px;color:#6b7280;margin:0">${footer}</p>
</div>`;

/**
 * Transactional email for account verification and password reset.
 *
 * Everything is environment-driven; no credential is ever hardcoded or logged:
 *   SMTP_HOST  SMTP_PORT  SMTP_USER  SMTP_PASS  MAIL_FROM
 *
 * With no SMTP_HOST the service runs in *console mode*: the message is rendered by nodemailer's
 * json transport and never sent. The token/link is never written to the log — use
 * `AUTH_DEV_RETURN_LINKS=true` (rejected in production) or a local SMTP sink (Mailpit/MailHog/
 * Mailtrap) to read the link during development.
 */
@Injectable()
export class EmailService {
  private log = new Logger('Email');
  private from = process.env.MAIL_FROM ?? `${BRAND} <no-reply@socialpulse.local>`;
  private transport = this.buildTransport();

  private buildTransport() {
    const host = process.env.SMTP_HOST;
    if (!host) {
      this.log.warn('SMTP_HOST not set - running in console mode; no email will actually be sent');
      return nodemailer.createTransport({ jsonTransport: true });
    }
    const port = parseInt(process.env.SMTP_PORT ?? '587', 10);
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    return nodemailer.createTransport({
      host,
      port,
      secure: process.env.SMTP_SECURE === 'true' || port === 465,
      ...(user && pass ? { auth: { user, pass } } : {}),
    });
  }

  private async send(to: string, subject: string, html: string, text: string): Promise<SendResult> {
    try {
      await this.transport.sendMail({ from: this.from, to, subject, html, text });
      return { delivered: !!(process.env.SMTP_HOST) };
    } catch (e: any) {
      // Never surface provider errors (they can echo the recipient) to the API caller.
      this.log.error(`Failed to send "${subject}": ${e?.message}`);
      return { delivered: false };
    }
  }

  sendVerification(to: string, url: string): Promise<SendResult> {
    return this.send(
      to,
      `Confirm your ${BRAND} email`,
      layout('Confirm your email', `Welcome to ${BRAND}. Confirm this address to finish setting up your account.`, { label: 'Verify email', url }, 'This link expires in 24 hours. If you did not create an account, ignore this email.'),
      `Confirm your ${BRAND} email: ${url}\nThis link expires in 24 hours.`
    );
  }

  sendPasswordReset(to: string, url: string): Promise<SendResult> {
    return this.send(
      to,
      `Reset your ${BRAND} password`,
      layout('Reset your password', `We received a request to reset your ${BRAND} password.`, { label: 'Choose a new password', url }, 'This link expires in 1 hour and can be used once. If you did not request it, ignore this email.'),
      `Reset your ${BRAND} password: ${url}\nThis link expires in 1 hour.`
    );
  }
}
