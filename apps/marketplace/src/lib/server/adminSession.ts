/**
 * HMAC-signed cookie session for the marketplace admin UI.
 *
 * Copy of apps/web/src/lib/server/session.ts with an admin-only payload
 * (no Owner / role complexity — the marketplace's admin UI is a single
 * privilege tier).
 *
 * Cookie format: `${base64url(payload)}.${base64url(hmac)}`. Server signs
 * with AUTH_SECRET. Tampering fails the HMAC; expired sessions are
 * rejected.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Cookies } from '@sveltejs/kit';

const COOKIE_NAME = 'marketplace.session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface AdminSession {
  adminUserId: string;
  email: string;
  exp: number;
}

function secret(): string {
  return process.env.AUTH_SECRET ?? 'dev-only-not-secret-change-in-prod';
}

function b64url(input: string | Buffer): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function fromB64url(input: string): Buffer {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
  return Buffer.from(padded + pad, 'base64');
}

function sign(payload: AdminSession): string {
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac('sha256', secret()).update(body).digest();
  return `${body}.${b64url(sig)}`;
}

function verify(cookie: string): AdminSession | null {
  const dot = cookie.lastIndexOf('.');
  if (dot === -1) return null;
  const body = cookie.slice(0, dot);
  const givenSig = cookie.slice(dot + 1);
  const expectedSig = createHmac('sha256', secret()).update(body).digest();
  const givenSigBuf = fromB64url(givenSig);
  if (givenSigBuf.length !== expectedSig.length) return null;
  if (!timingSafeEqual(givenSigBuf, expectedSig)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(fromB64url(body).toString('utf-8'));
  } catch {
    return null;
  }
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    !('adminUserId' in parsed) ||
    !('email' in parsed) ||
    !('exp' in parsed)
  ) {
    return null;
  }
  const p = parsed as Partial<AdminSession>;
  if (typeof p.exp !== 'number' || p.exp < Date.now()) return null;
  return {
    adminUserId: p.adminUserId as string,
    email: p.email as string,
    exp: p.exp
  };
}

export function readAdminSession(cookies: Cookies): AdminSession | null {
  const c = cookies.get(COOKIE_NAME);
  return c ? verify(c) : null;
}

export function writeAdminSession(
  cookies: Cookies,
  input: { adminUserId: string; email: string }
): void {
  const payload: AdminSession = {
    adminUserId: input.adminUserId,
    email: input.email,
    exp: Date.now() + SESSION_TTL_MS
  };
  cookies.set(COOKIE_NAME, sign(payload), {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_TTL_MS / 1000
  });
}

export function clearAdminSession(cookies: Cookies): void {
  cookies.delete(COOKIE_NAME, { path: '/' });
}
