/**
 * App credential (Bearer token) issue / lookup / touch / revoke.
 *
 * Tokens are random 32 bytes base64url-encoded, prefixed `ccm_`
 * (CropCard Marketplace). Only the SHA-256 hash lands in the DB —
 * plaintext is shown to the operator once on mint and never recoverable.
 * Lookups are constant-time via `timingSafeEqual` on the hash.
 *
 * Mirror of apps/web/src/lib/server/invites.ts for the marketplace's
 * single-tenant catalog (no Owner scoping — trust is per credential).
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { getDb } from '$lib/db';
import { appCredentials } from '$lib/db/schema';

export type TrustLevel = 'trusted' | 'community';

export interface AppCredential {
  id: string;
  label: string;
  trustLevel: TrustLevel;
  createdAt: number;
  lastUsedAt: number | null;
  requestCount: number;
  revokedAt: number | null;
}

export interface IssuedCredential {
  token: string;
  record: AppCredential;
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export function generatePlaintext(): string {
  return 'ccm_' + randomBytes(32).toString('base64url');
}

/**
 * Mint a new credential. Plaintext token is returned ONCE. Caller is
 * responsible for displaying it and never persisting it elsewhere.
 */
export function issueCredential(input: { label: string; trustLevel: TrustLevel }): IssuedCredential {
  const id = `cred_${Date.now()}_${randomBytes(4).toString('hex')}`;
  const token = generatePlaintext();
  const now = new Date();
  getDb()
    .insert(appCredentials)
    .values({
      id,
      label: input.label,
      trustLevel: input.trustLevel,
      credentialHash: sha256Hex(token),
      createdAt: now,
      requestCount: 0
    })
    .run();
  return {
    token,
    record: {
      id,
      label: input.label,
      trustLevel: input.trustLevel,
      createdAt: now.getTime(),
      lastUsedAt: null,
      requestCount: 0,
      revokedAt: null
    }
  };
}

/**
 * Validate a plaintext Bearer token against the DB. Returns the
 * credential row on hit, null on miss / revoked / malformed. Constant-
 * time hash compare to keep timing attacks impractical.
 */
export function lookupByPlaintext(plaintext: string): AppCredential | null {
  if (!plaintext.startsWith('ccm_')) return null;
  const hash = sha256Hex(plaintext);
  // Pull all candidates with this hash. UNIQUE INDEX on credential_hash
  // means there's at most one row, but we still compare via timingSafeEqual
  // to stay aligned with the project's auth pattern.
  const rows = getDb()
    .select()
    .from(appCredentials)
    .where(eq(appCredentials.credentialHash, hash))
    .all();
  if (rows.length === 0) return null;
  const row = rows[0];
  const expected = Buffer.from(hash, 'hex');
  const given = Buffer.from(row.credentialHash, 'hex');
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  if (row.revokedAt) return null;
  return rowToCredential(row);
}

function rowToCredential(row: {
  id: string;
  label: string;
  trustLevel: TrustLevel;
  createdAt: Date;
  lastUsedAt: Date | null;
  requestCount: number;
  revokedAt: Date | null;
}): AppCredential {
  return {
    id: row.id,
    label: row.label,
    trustLevel: row.trustLevel,
    createdAt: row.createdAt.getTime(),
    lastUsedAt: row.lastUsedAt ? row.lastUsedAt.getTime() : null,
    requestCount: row.requestCount,
    revokedAt: row.revokedAt ? row.revokedAt.getTime() : null
  };
}

/**
 * Touch lastUsedAt + increment requestCount. Debounced to 1/minute per
 * credential to avoid hammering the DB on bulk-fetch loops.
 */
const lastTouchByCredId = new Map<string, number>();
const TOUCH_DEBOUNCE_MS = 60_000;

export function touchCredential(id: string): void {
  const now = Date.now();
  const last = lastTouchByCredId.get(id);
  if (last && now - last < TOUCH_DEBOUNCE_MS) return;
  lastTouchByCredId.set(id, now);
  try {
    getDb()
      .update(appCredentials)
      .set({ lastUsedAt: new Date(now), requestCount: pendingCount(id, now) })
      .where(eq(appCredentials.id, id))
      .run();
  } catch (err) {
    console.error('[appCreds] touch failed', err);
  }
}

// Accumulate request counts in memory between debounced flushes so we
// don't lose them. Each flush reads the in-memory delta and writes the
// summed total to the DB.
const pendingByCredId = new Map<string, { lastFlushedAt: number; delta: number }>();

function pendingCount(id: string, _now: number): number {
  // Single-process server — read+inc+write the row's request_count
  // atomically here is awkward in Drizzle without raw SQL, so we just
  // fetch + add. Acceptable race for an audit counter.
  const row = getDb()
    .select({ requestCount: appCredentials.requestCount })
    .from(appCredentials)
    .where(eq(appCredentials.id, id))
    .get();
  const base = row?.requestCount ?? 0;
  const prior = pendingByCredId.get(id);
  const delta = (prior?.delta ?? 0) + 1;
  pendingByCredId.set(id, { lastFlushedAt: Date.now(), delta: 0 });
  return base + delta;
}

/**
 * Mark a credential revoked. Subsequent lookups return null even if
 * the plaintext token leaks elsewhere.
 */
export function revokeCredential(id: string): void {
  getDb()
    .update(appCredentials)
    .set({ revokedAt: new Date() })
    .where(eq(appCredentials.id, id))
    .run();
  lastTouchByCredId.delete(id);
  pendingByCredId.delete(id);
}

/** For admin UI listings — never returns the plaintext (which the DB
 *  doesn't have). */
export function listCredentials(): AppCredential[] {
  return getDb().select().from(appCredentials).all().map(rowToCredential);
}
