/**
 * HMAC-signed cookie session.
 *
 * Phase 18c — multi-tenant: the payload now carries `activeOwnerId` (the
 * Owner the user has selected for the current session) and `activeRole`
 * (their role *within* that Owner). A partial session has
 * `activeOwnerId=null` and lives just long enough for the Owner-picker
 * page to mint a full one.
 *
 * The single global identity fields (`userId`, `email`, `isSuperadmin`)
 * persist across owner switches; only the active tenant context is
 * re-minted.
 *
 * Cookie format: `${base64url(payload)}.${base64url(hmac)}`. Server signs
 * with AUTH_SECRET. Tampering fails the HMAC check; expired sessions are
 * rejected.
 *
 * Server-only.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Cookies } from '@sveltejs/kit';

const COOKIE_NAME = 'cropcard.session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type SessionRole = 'owner' | 'helper' | 'inspector' | 'custom-operator';

export const ALL_SESSION_ROLES: ReadonlyArray<SessionRole> = [
  'owner',
  'helper',
  'inspector',
  'custom-operator'
];

/**
 * Permission semantics — applied WITHIN the active Owner context:
 *   owner            — full read/write across the farm
 *   helper           — read-only for plan/plugins/equipment, can record
 *                      sprays (kernel-validated), cannot apply custom rates
 *   inspector        — read-only across EVERYTHING incl. records, exports.
 *                      No mutations whatsoever. For audits + cost-share visits.
 *   custom-operator  — like helper but scoped to assigned blocks. Cannot
 *                      see /stock financial cost data.
 *
 * `isSuperadmin` is cross-tenant and orthogonal to role; it allows
 * impersonating any Owner with a persistent banner + audit trail.
 */
export function isReadOnly(role: SessionRole): boolean {
  return role === 'inspector';
}

export function canMutate(role: SessionRole): boolean {
  return role !== 'inspector';
}

export function isOwner(role: SessionRole): boolean {
  return role === 'owner';
}

export interface SessionPayload {
  userId: string;
  email: string;
  /** Cross-tenant support / abuse role. Read-only by default; impersonation
   *  requires a separate banner + audit trail. */
  isSuperadmin: boolean;
  /** The Owner this session is currently acting for. Null on a partial
   *  session (issued before the Owner-picker) — repos refuse to run. */
  activeOwnerId: string | null;
  /** Role within `activeOwnerId`. Sourced from
   *  `helper_assignments.role_within_owner` at login / Owner-switch time. */
  activeRole: SessionRole;
  /** True when a superadmin is acting as `activeOwnerId`. UI surfaces a
   *  red banner and the impersonation auto-expires. */
  impersonating?: boolean;
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
    !('exp' in parsed)
  ) {
    return null;
  }
  const p = parsed as Partial<SessionPayload>;
  if (typeof p.exp !== 'number' || p.exp < Date.now()) return null;
  // Legacy cookies (pre Phase 18c) only carry `role`. Promote to the new
  // shape with `activeRole = role`, `activeOwnerId = null` (the hooks
  // layer falls back to Home Farm), `isSuperadmin = false`. This lets
  // existing sessions survive the migration without forcing a re-login.
  const legacyRole = (parsed as { role?: SessionRole }).role;
  const activeRole = (p.activeRole as SessionRole) ?? legacyRole;
  if (!activeRole || !ALL_SESSION_ROLES.includes(activeRole)) return null;
  return {
    userId: p.userId as string,
    email: p.email as string,
    isSuperadmin: p.isSuperadmin ?? false,
    activeOwnerId: p.activeOwnerId ?? null,
    activeRole,
    impersonating: p.impersonating,
    exp: p.exp
  };
}

export function readSession(cookies: Cookies): SessionPayload | null {
  const c = cookies.get(COOKIE_NAME);
  return c ? verify(c) : null;
}

export interface WriteSessionInput {
  id: string;
  email: string;
  isSuperadmin?: boolean;
  activeOwnerId: string | null;
  activeRole: SessionRole;
  impersonating?: boolean;
}

export function writeSession(cookies: Cookies, user: WriteSessionInput): void {
  const payload: SessionPayload = {
    userId: user.id,
    email: user.email,
    isSuperadmin: user.isSuperadmin ?? false,
    activeOwnerId: user.activeOwnerId,
    activeRole: user.activeRole,
    impersonating: user.impersonating,
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
