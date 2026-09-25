/**
 * 6-digit sign-in and contact-verification codes, by email or SMS.
 *
 * - Email login: `requestMagicLink` issues a code alongside the link
 *   (`loginTokenId` ties them); redeeming either burns both.
 * - SMS login: `requestSmsLogin` texts a code. An unknown number is not an
 *   error: redeeming the code creates a phone-only account, so sign-up and
 *   sign-in are the same flow and the response never reveals which it was.
 * - Linking: `requestLinkCode` sends a code to a new email/phone for a
 *   signed-in user; `redeemLinkCode` attaches it to that user.
 *
 * Only an HMAC of each code is stored. Guessing is bounded by
 * MAX_ATTEMPTS per code and by the per-destination issue limit, so a
 * destination sees at most MAX_ATTEMPTS × MAX_PER_DESTINATION guesses per
 * RATE_WINDOW_MS. Only the newest live code for a destination is checked.
 *
 * `login_codes` is identity-level (sign-in precedes any Owner context), so
 * every query here is intentionally unscoped.
 */

import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { and, desc, eq, gt, isNull, lt, lte, sql } from 'drizzle-orm';
import { db } from '$lib/db/client';
import { loginCodes, loginTokens, users } from '$lib/db/schema';
import { unscopedQueryNote } from '$lib/db/tenant';
import { formatPhone, type Identifier } from '$lib/identity';
import { dispatchEmail } from './email';
import { dispatchSms } from './sms';

export const CODE_LENGTH = 6;
export const SMS_CODE_TTL_MS = 10 * 60 * 1000;
export const LINK_CODE_TTL_MS = 15 * 60 * 1000;
export const MAX_ATTEMPTS = 5;
export const RATE_WINDOW_MS = 15 * 60 * 1000;
export const MAX_PER_DESTINATION = 5;
/** Texts cost money, so the per-IP ceiling is lower than email's. */
export const MAX_SMS_PER_IP = 10;
export const MAX_SMS_UNATTRIBUTED = 100;
export const MAX_LINK_PER_USER = 10;
const PURGE_AFTER_MS = 24 * 60 * 60 * 1000;

type Channel = 'email' | 'sms';
type Purpose = 'login' | 'link';

function codeSecret(): string {
  return process.env.AUTH_SECRET ?? 'dev-only-not-secret-change-in-prod';
}

function hashCode(id: string, code: string): string {
  return createHmac('sha256', codeSecret()).update(`${id}:${code}`).digest('hex');
}

export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export function generateCode(): string {
  return String(randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, '0');
}

/** Accepts "123 456", "123-456"; anything else is not a code. */
export function normalizeCode(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const digits = input.replace(/[\s-]/g, '');
  return new RegExp(`^\\d{${CODE_LENGTH}}$`).test(digits) ? digits : null;
}

interface IssueInput {
  channel: Channel;
  purpose: Purpose;
  destination: string;
  userId?: string | null;
  loginTokenId?: string | null;
  ipHash?: string | null;
  ttlMs: number;
  now: number;
}

/** Insert a code row and return the plaintext. No rate limiting here. */
export function issueCode(input: IssueInput): { id: string; code: string; expiresAt: number } {
  unscopedQueryNote('login_codes is identity-level; issued before or outside any Owner context');
  const id = `lcd_${input.now}_${randomBytes(4).toString('hex')}`;
  const code = generateCode();
  const expiresAt = input.now + input.ttlMs;
  db.insert(loginCodes)
    .values({
      id,
      channel: input.channel,
      purpose: input.purpose,
      destination: input.destination,
      userId: input.userId ?? null,
      loginTokenId: input.loginTokenId ?? null,
      codeHash: hashCode(id, code),
      ipHash: input.ipHash ?? null,
      createdAt: new Date(input.now),
      expiresAt: new Date(expiresAt)
    })
    .run();
  return { id, code, expiresAt };
}

function countSince(
  where: ReturnType<typeof and>,
  now: number
): number {
  const row = db
    .select({ n: sql<number>`count(*)` })
    .from(loginCodes)
    .where(
      and(
        where,
        gt(loginCodes.createdAt, new Date(now - RATE_WINDOW_MS)),
        lte(loginCodes.createdAt, new Date(now))
      )
    )
    .get();
  return row?.n ?? 0;
}

function purge(now: number): void {
  db.delete(loginCodes)
    .where(lt(loginCodes.expiresAt, new Date(now - PURGE_AFTER_MS)))
    .run();
}

/** The web-OTP suffix lets iOS/Android offer the code as a one-tap autofill. */
function smsLoginBody(code: string, origin: string | null): string {
  const lines = [`${code} is your CropCard sign-in code. It expires in 10 minutes. Don't share it.`];
  if (origin) {
    try {
      lines.push('', `@${new URL(origin).host} #${code}`);
    } catch {
      // Malformed origin: skip the autofill hint.
    }
  }
  return lines.join('\n');
}

export interface SmsLoginRequest {
  phone: string;
  ip: { hash: string; max: number };
  origin: string | null;
  now?: number;
}

export async function requestSmsLogin(
  req: SmsLoginRequest
): Promise<{ outcome: 'sent' | 'rate-limited' }> {
  unscopedQueryNote('login_codes is identity-level; sign-in precedes any Owner context');
  const now = req.now ?? Date.now();
  purge(now);
  if (countSince(eq(loginCodes.destination, req.phone), now) >= MAX_PER_DESTINATION) {
    return { outcome: 'rate-limited' };
  }
  if (
    countSince(and(eq(loginCodes.channel, 'sms'), eq(loginCodes.ipHash, req.ip.hash)), now) >=
    req.ip.max
  ) {
    return { outcome: 'rate-limited' };
  }
  const { code } = issueCode({
    channel: 'sms',
    purpose: 'login',
    destination: req.phone,
    ipHash: req.ip.hash,
    ttlMs: SMS_CODE_TTL_MS,
    now
  });
  await dispatchSms({ to: req.phone, kind: 'login-code', body: smsLoginBody(code, req.origin) });
  return { outcome: 'sent' };
}

export type CodeInvalidReason = 'invalid' | 'expired' | 'too-many-attempts';

export type CodeRedemption =
  | { ok: true; destination: string; channel: Channel; userId: string | null }
  | { ok: false; reason: CodeInvalidReason };

/**
 * Check `code` against the newest live code for this destination and
 * purpose (and user, for links). A wrong guess spends one attempt; the
 * right one is claimed with a single conditional UPDATE so concurrent
 * redemptions can't both win.
 */
export function redeemCode(opts: {
  destination: string;
  purpose: Purpose;
  code: unknown;
  userId?: string;
  now?: number;
}): CodeRedemption {
  unscopedQueryNote('login_codes redemption precedes any Owner context');
  const now = opts.now ?? Date.now();
  const code = normalizeCode(opts.code);
  const row = db
    .select()
    .from(loginCodes)
    .where(
      and(
        eq(loginCodes.destination, opts.destination),
        eq(loginCodes.purpose, opts.purpose),
        opts.userId ? eq(loginCodes.userId, opts.userId) : undefined,
        isNull(loginCodes.consumedAt)
      )
    )
    .orderBy(desc(loginCodes.createdAt))
    .limit(1)
    .get();
  if (!row) return { ok: false, reason: 'invalid' };
  if (row.expiresAt.getTime() <= now) return { ok: false, reason: 'expired' };
  if (row.attempts >= MAX_ATTEMPTS) return { ok: false, reason: 'too-many-attempts' };

  const expected = Buffer.from(row.codeHash, 'hex');
  const given = code ? Buffer.from(hashCode(row.id, code), 'hex') : Buffer.alloc(expected.length);
  if (!code || !timingSafeEqual(expected, given)) {
    db.update(loginCodes)
      .set({ attempts: sql`${loginCodes.attempts} + 1` })
      .where(eq(loginCodes.id, row.id))
      .run();
    return {
      ok: false,
      reason: row.attempts + 1 >= MAX_ATTEMPTS ? 'too-many-attempts' : 'invalid'
    };
  }

  const claimed = db
    .update(loginCodes)
    .set({ consumedAt: new Date(now) })
    .where(
      and(
        eq(loginCodes.id, row.id),
        isNull(loginCodes.consumedAt),
        gt(loginCodes.expiresAt, new Date(now)),
        lt(loginCodes.attempts, MAX_ATTEMPTS)
      )
    )
    .returning({ id: loginCodes.id })
    .get();
  if (!claimed) return { ok: false, reason: 'invalid' };
  if (row.loginTokenId) {
    db.update(loginTokens)
      .set({ consumedAt: new Date(now) })
      .where(and(eq(loginTokens.id, row.loginTokenId), isNull(loginTokens.consumedAt)))
      .run();
  }
  return { ok: true, destination: row.destination, channel: row.channel, userId: row.userId };
}

/** Called when a magic link is redeemed so its backup code dies with it. */
export function burnCodesForLoginToken(loginTokenId: string, now = Date.now()): void {
  unscopedQueryNote('login_codes paired with a redeemed login token');
  db.update(loginCodes)
    .set({ consumedAt: new Date(now) })
    .where(and(eq(loginCodes.loginTokenId, loginTokenId), isNull(loginCodes.consumedAt)))
    .run();
}

export type LinkRequestResult =
  | { ok: true; expiresAt: number }
  | { ok: false; error: 'in-use' | 'already-yours' | 'rate-limited' };

/** Send a code to a new email/phone so a signed-in user can attach it. */
export async function requestLinkCode(opts: {
  userId: string;
  identifier: Identifier;
  now?: number;
}): Promise<LinkRequestResult> {
  unscopedQueryNote('linking a sign-in identity touches the global users table');
  const now = opts.now ?? Date.now();
  const { kind, value } = opts.identifier;
  const column = kind === 'email' ? users.email : users.phone;
  const owner = db.select({ id: users.id }).from(users).where(eq(column, value)).get();
  if (owner?.id === opts.userId) return { ok: false, error: 'already-yours' };
  if (owner) return { ok: false, error: 'in-use' };

  purge(now);
  if (countSince(eq(loginCodes.destination, value), now) >= MAX_PER_DESTINATION) {
    return { ok: false, error: 'rate-limited' };
  }
  if (
    countSince(and(eq(loginCodes.purpose, 'link'), eq(loginCodes.userId, opts.userId)), now) >=
    MAX_LINK_PER_USER
  ) {
    return { ok: false, error: 'rate-limited' };
  }

  const channel: Channel = kind === 'email' ? 'email' : 'sms';
  const { code, expiresAt } = issueCode({
    channel,
    purpose: 'link',
    destination: value,
    userId: opts.userId,
    ttlMs: LINK_CODE_TTL_MS,
    now
  });
  if (channel === 'email') {
    await dispatchEmail({ kind: 'contact-code', to: value, code, expiresAt });
  } else {
    await dispatchSms({
      to: value,
      kind: 'verify-phone',
      body: `${code} is your CropCard code to add ${formatPhone(value)} to your account. It expires in 15 minutes.`
    });
  }
  return { ok: true, expiresAt };
}

export type LinkRedeemResult =
  | { ok: true }
  | { ok: false; error: CodeInvalidReason | 'in-use' };

/** Verify a link code and attach the email/phone to the user. */
export function redeemLinkCode(opts: {
  userId: string;
  identifier: Identifier;
  code: unknown;
  now?: number;
}): LinkRedeemResult {
  unscopedQueryNote('linking a sign-in identity touches the global users table');
  const redeemed = redeemCode({
    destination: opts.identifier.value,
    purpose: 'link',
    code: opts.code,
    userId: opts.userId,
    now: opts.now
  });
  if (!redeemed.ok) return { ok: false, error: redeemed.reason };
  const patch =
    opts.identifier.kind === 'email'
      ? { email: opts.identifier.value }
      : { phone: opts.identifier.value };
  try {
    db.update(users).set(patch).where(eq(users.id, opts.userId)).run();
  } catch (e) {
    if (e instanceof Error && /UNIQUE/i.test(e.message)) return { ok: false, error: 'in-use' };
    throw e;
  }
  return { ok: true };
}

/** Remove one identity, refusing to leave the account with none. */
export function unlinkIdentity(
  userId: string,
  kind: Identifier['kind']
): { ok: true } | { ok: false; error: 'last-identity' } {
  unscopedQueryNote('unlinking a sign-in identity touches the global users table');
  const other = kind === 'email' ? users.phone : users.email;
  const r = db
    .update(users)
    .set(kind === 'email' ? { email: null } : { phone: null })
    .where(and(eq(users.id, userId), sql`${other} IS NOT NULL`))
    .run();
  return r.changes > 0 ? { ok: true } : { ok: false, error: 'last-identity' };
}
