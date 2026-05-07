/**
 * HMAC-signed cookie session for v1.
 *
 * Single-farm, low-stakes. Production should swap to Auth.js magic-link
 * (the @auth/sveltekit dep is already installed); the role plumbing
 * (`event.locals.user`) is unchanged across that swap.
 *
 * Cookie format: `${base64url(payload)}.${base64url(hmac)}`. Payload is
 * `{ userId, email, role, exp }`. Server signs with AUTH_SECRET. Tampering
 * fails the HMAC check; expired sessions are rejected.
 *
 * Server-only.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Cookies } from '@sveltejs/kit';

const COOKIE_NAME = 'cropcard.session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type SessionRole = 'owner' | 'helper';

export interface SessionPayload {
  userId: string;
  email: string;
  role: SessionRole;
  /** Expiry ms epoch. */
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

function sign(payload: SessionPayload): string {
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac('sha256', secret()).update(body).digest();
  return `${body}.${b64url(sig)}`;
}

function verify(cookie: string): SessionPayload | null {
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
    !('userId' in parsed) ||
    !('email' in parsed) ||
    !('role' in parsed) ||
    !('exp' in parsed)
  ) {
    return null;
  }
  const p = parsed as SessionPayload;
  if (typeof p.exp !== 'number' || p.exp < Date.now()) return null;
  if (p.role !== 'owner' && p.role !== 'helper') return null;
  return p;
}

export function readSession(cookies: Cookies): SessionPayload | null {
  const c = cookies.get(COOKIE_NAME);
  return c ? verify(c) : null;
}

export function writeSession(
  cookies: Cookies,
  user: { id: string; email: string; role: SessionRole }
): void {
  const payload: SessionPayload = {
    userId: user.id,
    email: user.email,
    role: user.role,
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

export function clearSession(cookies: Cookies): void {
  cookies.delete(COOKIE_NAME, { path: '/' });
}
