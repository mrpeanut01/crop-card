/**
 * Signed unsubscribe tokens for opt-in email. A token names one user, one
 * Owner and one category (or `all`), so the link works without signing in
 * and can only ever turn that person's own alerts off or back on. Tokens do
 * not expire: an unsubscribe link in an old email must keep working. The key
 * is derived from AUTH_SECRET with a purpose label, so a token can never be
 * replayed as a session cookie or a login code.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { authSecret } from './session';
import { isEmailAlertCategory, type EmailAlertCategory } from '$lib/email/alertCategories';

export type UnsubscribeScope = EmailAlertCategory | 'all';

export interface UnsubscribeClaims {
  userId: string;
  ownerId: string;
  scope: UnsubscribeScope;
}

const VERSION = 'u1';

function key(): Buffer {
  return createHmac('sha256', authSecret()).update('cropcard:email-unsubscribe:v1').digest();
}

function mac(payload: string): string {
  return createHmac('sha256', key()).update(`${VERSION}.${payload}`).digest('base64url');
}

export function signUnsubscribeToken(claims: UnsubscribeClaims): string {
  const payload = Buffer.from(
    JSON.stringify({ u: claims.userId, o: claims.ownerId, c: claims.scope })
  ).toString('base64url');
  return `${VERSION}.${payload}.${mac(payload)}`;
}

export function verifyUnsubscribeToken(token: unknown): UnsubscribeClaims | null {
  if (typeof token !== 'string' || token.length > 1024) return null;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== VERSION) return null;
  const [, payload, sig] = parts;
  const expected = Buffer.from(mac(payload));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const { u, o, c } = parsed as Record<string, unknown>;
  if (typeof u !== 'string' || !u || typeof o !== 'string' || !o) return null;
  if (c !== 'all' && !isEmailAlertCategory(c)) return null;
  return { userId: u, ownerId: o, scope: c };
}

export interface UnsubscribeLinks {
  /** Human page: shows what will be turned off, one button, re-subscribe. */
  pageUrl: string;
  /** RFC 8058 one-click target for the List-Unsubscribe header. */
  oneClickUrl: string;
}

export function unsubscribeLinks(origin: string, claims: UnsubscribeClaims): UnsubscribeLinks {
  const token = signUnsubscribeToken(claims);
  const base = origin.replace(/\/+$/, '');
  return {
    pageUrl: `${base}/unsubscribe/${token}`,
    oneClickUrl: `${base}/api/email/unsubscribe?t=${encodeURIComponent(token)}`
  };
}
