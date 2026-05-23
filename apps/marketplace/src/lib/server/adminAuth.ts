/**
 * Magic-link sign-in for marketplace admin operators.
 *
 * Operators are gated by the MARKETPLACE_ADMIN_EMAILS env var (comma-
 * separated). On `/admin/login` POST, an admin_users row is upserted by
 * email, a single-use token is minted, hashed into admin_login_tokens,
 * and the magic link URL is emailed (stdout stub in dev).
 *
 * On `/admin/verify/[token]`, the token is hashed and looked up; if
 * unredeemed + unexpired, the admin session cookie is written.
 *
 * Tokens live 15 min (short for security) and are single-use (redeemedAt
 * marker). Hash is SHA-256.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { getDb } from '$lib/db';
import { adminLoginTokens, adminUsers } from '$lib/db/schema';
import { dispatchEmail } from './email';

const TOKEN_TTL_MS = 15 * 60 * 1000;

function allowedEmails(): Set<string> {
  const raw = process.env.MARKETPLACE_ADMIN_EMAILS ?? '';
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export function isAllowedAdminEmail(email: string): boolean {
  return allowedEmails().has(normalizeEmail(email));
}

/**
 * Upsert an admin_users row by email. Returns the row id.
 */
function ensureAdminUser(email: string): string {
  const norm = normalizeEmail(email);
  const db = getDb();
  const existing = db.select().from(adminUsers).where(eq(adminUsers.email, norm)).get();
  if (existing) return existing.id;
  const id = `adm_${Date.now()}_${randomBytes(4).toString('hex')}`;
  db.insert(adminUsers).values({ id, email: norm }).run();
  return id;
}

/**
 * Mint a magic-link token and email it. Returns the redeem URL for
 * dev visibility (also logged via the email stub).
 */
export async function loginByEmail(input: {
  email: string;
  origin: string;
}): Promise<{ sent: boolean; loginUrl?: string }> {
  if (!isAllowedAdminEmail(input.email)) {
    // Don't reveal whether the email is on the allowlist — pretend success
    // to avoid enumeration. Still log internally.
    console.log(`[adminAuth] login attempt for non-allowlisted email ${input.email}`);
    return { sent: true };
  }
  const adminUserId = ensureAdminUser(input.email);
  const plaintext = randomBytes(32).toString('base64url');
  const id = `lgn_${Date.now()}_${randomBytes(4).toString('hex')}`;
  const now = Date.now();
  const expiresAt = now + TOKEN_TTL_MS;
  getDb()
    .insert(adminLoginTokens)
    .values({
      id,
      tokenHash: sha256Hex(plaintext),
      adminUserId,
      createdAt: new Date(now),
      expiresAt: new Date(expiresAt),
      redeemedAt: null
    })
    .run();
  const loginUrl = `${input.origin}/admin/verify/${plaintext}`;
  await dispatchEmail({
    kind: 'admin-magic-link',
    to: input.email,
    loginUrl,
    expiresAt
  });
  return { sent: true, loginUrl };
}

export interface RedeemedToken {
  adminUserId: string;
  email: string;
}

/**
 * Validate + single-use-mark a magic-link token. Returns the admin row
 * on success, null on bad/expired/used token.
 */
export function redeemLoginToken(plaintext: string): RedeemedToken | null {
  if (!plaintext || plaintext.length < 16) return null;
  const tokenHash = sha256Hex(plaintext);
  const db = getDb();
  // Find the matching row. UNIQUE INDEX on token_hash makes this single.
  const rows = db
    .select()
    .from(adminLoginTokens)
    .where(and(eq(adminLoginTokens.tokenHash, tokenHash), isNull(adminLoginTokens.redeemedAt)))
    .all();
  if (rows.length === 0) return null;
  const row = rows[0];
  // Constant-time compare (defense in depth — hash collision space already covers this).
  const expected = Buffer.from(tokenHash, 'hex');
  const given = Buffer.from(row.tokenHash, 'hex');
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  const now = Date.now();
  const expiresAt = row.expiresAt instanceof Date ? row.expiresAt.getTime() : (row.expiresAt as number);
  if (now > expiresAt) return null;
  // Mark redeemed.
  db.update(adminLoginTokens)
    .set({ redeemedAt: new Date(now) })
    .where(eq(adminLoginTokens.id, row.id))
    .run();
  // Update admin last-login.
  const admin = db.select().from(adminUsers).where(eq(adminUsers.id, row.adminUserId)).get();
  if (!admin) return null;
  db.update(adminUsers)
    .set({ lastLoginAt: new Date(now) })
    .where(eq(adminUsers.id, admin.id))
    .run();
  return { adminUserId: admin.id, email: admin.email };
}
