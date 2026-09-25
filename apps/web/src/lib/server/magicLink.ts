/**
 * Magic-link email sign-in (UC-17).
 *
 * The link proves control of an email address; on success the caller runs
 * `loginByEmail` so the session layer stays the existing HMAC cookie with
 * every role/tenant field intact. @auth/sveltekit was evaluated and not
 * used: its email provider requires an Auth.js DB adapter and issues its
 * own session, which would duplicate the HMAC session layer.
 *
 * Tokens mirror invites.ts / apiTokens.ts: 32 random bytes base64url, only
 * the SHA-256 hash stored, 15-minute expiry, single use (atomic
 * `consumed_at` stamp), bound to the email they were issued for.
 *
 * `login_tokens` is identity-level (the email is unproven and no Owner is
 * chosen yet), so every query here is intentionally unscoped.
 */

import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, isNull, lt, lte, sql } from 'drizzle-orm';
import { db } from '$lib/db/client';
import { loginTokens } from '$lib/db/schema';
import { unscopedQueryNote } from '$lib/db/tenant';
import type { RequestEvent } from '@sveltejs/kit';
import { dispatchEmail } from './email';
import { isPublicAddress } from './safeFetch';

export const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;
export const RATE_WINDOW_MS = 15 * 60 * 1000;
export const MAX_PER_EMAIL = 5;
export const MAX_PER_IP = 20;
/** Shared ceiling for requests whose client address is missing or not a
 *  public unicast IP — i.e. the proxy's own address when ADDRESS_HEADER /
 *  XFF_DEPTH are not configured. High enough that a misconfigured proxy
 *  never locks every user out; low enough to still cap mass mailing. The
 *  per-email limit applies to every request regardless. */
export const MAX_PER_UNATTRIBUTED = 200;
const PURGE_AFTER_MS = 24 * 60 * 60 * 1000;

/** Same copy for every accepted request so the response never reveals
 *  whether an account exists or whether the request was throttled. */
export const MAGIC_LINK_GENERIC_MESSAGE =
  'If that address can sign in, a sign-in link is on its way. It expires in 15 minutes.';

export type AuthMode = 'magic-link' | 'direct';

/** Unset → 'direct' (dev/demo/e2e). Any unrecognised value fails closed to
 *  'magic-link' so a typo in production never re-enables direct login. */
export function authMode(): AuthMode {
  const raw = (process.env.AUTH_MODE ?? '').trim().toLowerCase();
  if (raw === '' || raw === 'direct') return 'direct';
  return 'magic-link';
}

export function isDirectLoginAllowed(): boolean {
  return authMode() === 'direct';
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeLoginEmail(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const e = input.trim().toLowerCase();
  if (!e || e.length > 254 || !EMAIL_RE.test(e)) return null;
  return e;
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export function hashLoginToken(token: string): string {
  return sha256(token);
}

/** The link must point at our own origin. Behind a proxy `event.url` is
 *  derived from the Host header, which a requester controls — so in
 *  production we insist on the configured ORIGIN rather than mail a valid
 *  token to an attacker-chosen host. */
export function magicLinkOrigin(requestOrigin: string): string {
  const configured = process.env.ORIGIN?.trim();
  if (configured) return configured.replace(/\/+$/, '');
  if (process.env.NODE_ENV === 'production') {
    throw new Error('ORIGIN must be set to send magic links in production');
  }
  return requestOrigin;
}

export function buildVerifyUrl(origin: string, token: string, inviteToken?: string | null): string {
  const u = new URL('/auth/verify', origin);
  u.searchParams.set('token', token);
  if (inviteToken) u.searchParams.set('invite', inviteToken);
  return u.toString();
}

export type MagicLinkRequestOutcome = 'sent' | 'rate-limited';

export interface IpRateBucket {
  key: string;
  max: number;
  attributed: boolean;
}

const UNATTRIBUTED_BUCKET: IpRateBucket = {
  key: 'ip:unattributed',
  max: MAX_PER_UNATTRIBUTED,
  attributed: false
};

/** Only a public client address gets its own per-IP bucket. A private,
 *  loopback or unparseable address is almost certainly the ingress proxy
 *  (adapter-node falls back to the socket peer when ADDRESS_HEADER is
 *  unset), and keying on it would put every user in one 20-request bucket. */
export function ipRateBucket(ip: string | null): IpRateBucket {
  if (ip && isPublicAddress(ip.trim())) {
    return { key: `ip:${ip.trim()}`, max: MAX_PER_IP, attributed: true };
  }
  return UNATTRIBUTED_BUCKET;
}

let warnedUnattributed = false;

export function resetUnattributedWarningForTests(): void {
  warnedUnattributed = false;
}

function warnUnattributedOnce(ip: string | null): void {
  if (warnedUnattributed || process.env.NODE_ENV !== 'production') return;
  warnedUnattributed = true;
  console.warn(
    `[magic-link] client address ${ip ?? '(none)'} is not a public IP; per-IP sign-in ` +
      'limits are using the shared unattributed bucket. Behind a reverse proxy set ' +
      'ADDRESS_HEADER=X-Forwarded-For and XFF_DEPTH to the number of trusted proxies.'
  );
}

export interface MagicLinkRequest {
  email: string;
  /** Raw client address; only its hash is stored. */
  ip: string | null;
  origin: string;
  inviteToken?: string | null;
  now?: number;
}

/**
 * Issue + email a link. Callers must already have normalized the email
 * (`normalizeLoginEmail`). Throttled requests return 'rate-limited'
 * without writing a row or sending mail; the HTTP layer maps both
 * outcomes to the same generic 200.
 */
export async function requestMagicLink(
  req: MagicLinkRequest
): Promise<{ outcome: MagicLinkRequestOutcome; expiresAt?: number }> {
  unscopedQueryNote('login_tokens is identity-level; sign-in precedes any Owner context');
  const now = req.now ?? Date.now();
  const bucket = ipRateBucket(req.ip);
  if (!bucket.attributed) warnUnattributedOnce(req.ip);
  const ipHash = sha256(bucket.key);

  db.delete(loginTokens)
    .where(lt(loginTokens.expiresAt, new Date(now - PURGE_AFTER_MS)))
    .run();

  const since = new Date(now - RATE_WINDOW_MS);
  const at = new Date(now);
  const perEmail = db
    .select({ n: sql<number>`count(*)` })
    .from(loginTokens)
    .where(
      and(
        eq(loginTokens.email, req.email),
        gt(loginTokens.createdAt, since),
        lte(loginTokens.createdAt, at)
      )
    )
    .get();
  if ((perEmail?.n ?? 0) >= MAX_PER_EMAIL) return { outcome: 'rate-limited' };
  const perIp = db
    .select({ n: sql<number>`count(*)` })
    .from(loginTokens)
    .where(
      and(
        eq(loginTokens.ipHash, ipHash),
        gt(loginTokens.createdAt, since),
        lte(loginTokens.createdAt, at)
      )
    )
    .get();
  if ((perIp?.n ?? 0) >= bucket.max) return { outcome: 'rate-limited' };

  const token = randomBytes(32).toString('base64url');
  const expiresAt = now + MAGIC_LINK_TTL_MS;
  db.insert(loginTokens)
    .values({
      id: `lgn_${now}_${randomBytes(4).toString('hex')}`,
      tokenHash: hashLoginToken(token),
      email: req.email,
      ipHash,
      createdAt: new Date(now),
      expiresAt: new Date(expiresAt)
    })
    .run();

  await dispatchEmail({
    kind: 'magic-link',
    to: req.email,
    loginUrl: buildVerifyUrl(req.origin, token, req.inviteToken),
    expiresAt
  });
  return { outcome: 'sent', expiresAt };
}

export type MagicLinkInvalidReason = 'invalid' | 'expired' | 'used';

export type MagicLinkCheck =
  { ok: true; email: string } | { ok: false; reason: MagicLinkInvalidReason };

function looksLikeToken(token: unknown): token is string {
  return typeof token === 'string' && token.length >= 32 && token.length <= 128;
}

/** Non-consuming check for the confirm screen. Link scanners that GET the
 *  URL therefore can't burn the token before the human clicks. */
export function peekMagicLink(token: unknown, now = Date.now()): MagicLinkCheck {
  unscopedQueryNote('login_tokens lookup by token hash precedes any Owner context');
  if (!looksLikeToken(token)) return { ok: false, reason: 'invalid' };
  const row = db
    .select()
    .from(loginTokens)
    .where(eq(loginTokens.tokenHash, hashLoginToken(token)))
    .get();
  if (!row) return { ok: false, reason: 'invalid' };
  if (row.consumedAt) return { ok: false, reason: 'used' };
  if (row.expiresAt.getTime() <= now) return { ok: false, reason: 'expired' };
  return { ok: true, email: row.email };
}

/** Atomically redeem: the single UPDATE both checks and stamps, so two
 *  concurrent redemptions of one token can't both succeed. */
export function consumeMagicLink(token: unknown, now = Date.now()): MagicLinkCheck {
  unscopedQueryNote('login_tokens redemption by token hash precedes any Owner context');
  if (!looksLikeToken(token)) return { ok: false, reason: 'invalid' };
  const tokenHash = hashLoginToken(token);
  const claimed = db
    .update(loginTokens)
    .set({ consumedAt: new Date(now) })
    .where(
      and(
        eq(loginTokens.tokenHash, tokenHash),
        isNull(loginTokens.consumedAt),
        gt(loginTokens.expiresAt, new Date(now))
      )
    )
    .returning({ email: loginTokens.email })
    .get();
  if (claimed) return { ok: true, email: claimed.email };
  const check = peekMagicLink(token, now);
  return check.ok ? { ok: false, reason: 'invalid' } : check;
}

const INVITE_TOKEN_RE = /^[A-Za-z0-9_-]{16,128}$/;

/** Invite tokens ride along in the link's query string (never stored
 *  here); only well-formed ones are threaded into a redirect. */
export function sanitizeInviteToken(input: unknown): string | null {
  return typeof input === 'string' && INVITE_TOKEN_RE.test(input) ? input : null;
}

/** adapter-node resolves this from ADDRESS_HEADER / XFF_DEPTH when set
 *  (and throws if the configured header is missing), else the socket peer. */
function clientAddress(event: RequestEvent): string | null {
  try {
    return event.getClientAddress();
  } catch {
    return null;
  }
}

export type MagicLinkHttpResult =
  { ok: true; message: string } | { ok: false; status: 400 | 503; error: string };

/** Shared by POST /api/auth/magic-link and the landing-page form action. */
export async function handleMagicLinkRequest(
  event: RequestEvent,
  rawEmail: unknown,
  rawInvite: unknown
): Promise<MagicLinkHttpResult> {
  const email = normalizeLoginEmail(rawEmail);
  if (!email) return { ok: false, status: 400, error: 'Enter a valid email address.' };
  let origin: string;
  try {
    origin = magicLinkOrigin(event.url.origin);
  } catch (e) {
    console.error('[magic-link]', e instanceof Error ? e.message : e);
    return { ok: false, status: 503, error: 'Email sign-in is not configured on this server.' };
  }
  try {
    await requestMagicLink({
      email,
      ip: clientAddress(event),
      origin,
      inviteToken: sanitizeInviteToken(rawInvite)
    });
  } catch (e) {
    console.error('[magic-link] dispatch failed', e instanceof Error ? e.message : e);
    return {
      ok: false,
      status: 503,
      error: "We couldn't send the email just now. Try again in a minute."
    };
  }
  return { ok: true, message: MAGIC_LINK_GENERIC_MESSAGE };
}
