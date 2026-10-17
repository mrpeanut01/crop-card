/**
 * API token issue / lookup / revoke / touch (Phase 24, UC-43).
 *
 * Owner-scoped Bearer credentials for external Claude agents. Tokens are
 * random 32 bytes base64url-encoded, prefixed `cck_` (CropCard). Only the
 * SHA-256 hash lands in the DB — plaintext is shown to the operator once
 * on mint and never recoverable. Lookups are constant-time via
 * timingSafeEqual on the hash.
 *
 * Modeled on:
 *   - apps/web/src/lib/server/invites.ts (issue / list / revoke skeleton,
 *     ownerId scoping, unscopedQueryNote pattern).
 *   - apps/marketplace/src/lib/server/appCreds.ts (constant-time compare,
 *     debounced touch, request-count audit column).
 *
 * Unlike helper-invites, the LOOKUP path is cross-tenant by definition:
 * hooks.server.ts has no ownerId when it sees a Bearer header. The lookup
 * RESULT establishes the tenant context for the rest of the request via
 * runWithTenantAsync(tokenOwnerId, ...).
 *
 * Sub-task D (service-account quota) wires `isServiceAccount` +
 * `dailyQuota*` columns into aiGuard.checkGuard() so a runaway agent can't
 * drain the human owner's daily AI quota.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '$lib/db/client';
import { apiTokens } from '$lib/db/schema';
import { unscopedQueryNote } from '$lib/db/tenant';

const TOKEN_PREFIX = 'cck_';

export interface IssuedToken {
  id: string;
  token: string;
  createdAt: number;
}

export interface ApiTokenSummary {
  id: string;
  ownerId: string;
  userId: string;
  label: string;
  isServiceAccount: boolean;
  dailyQuota: {
    allocate: number | null;
    schedule: number | null;
    inputs: number | null;
    stockRefresh: number | null;
  };
  createdAt: number;
  lastUsedAt: number | null;
  requestCount: number;
  revokedAt: number | null;
}

/** Resolved Bearer credential — what hooks.server.ts hands to the rest of
 *  the request after authVia='bearer' is established. */
export interface ResolvedApiToken {
  tokenId: string;
  ownerId: string;
  userId: string;
  isServiceAccount: boolean;
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export function generatePlaintext(): string {
  return TOKEN_PREFIX + randomBytes(32).toString('base64url');
}

export function hashToken(plaintext: string): string {
  return sha256Hex(plaintext);
}

/**
 * Mint a new owner-scoped API token. Plaintext is returned ONCE; the
 * caller (the POST endpoint) must surface it through a copy-once modal.
 *
 * `isServiceAccount` defaults to false. The owner can promote later via
 * the settings UI; promotion is a revoke + re-mint in one transaction
 * (Sub-task D) because the quota policy changes the token's behavior.
 */
export function issueToken(input: {
  ownerId: string;
  userId: string;
  label: string;
  isServiceAccount?: boolean;
}): IssuedToken {
  unscopedQueryNote(
    'apiTokens insert is owner-scoped via ownerId column; lookup path is by token_hash'
  );
  const id = `tok_${Date.now()}_${randomBytes(4).toString('hex')}`;
  const token = generatePlaintext();
  const now = new Date();
  db.insert(apiTokens)
    .values({
      id,
      ownerId: input.ownerId,
      userId: input.userId,
      label: input.label,
      tokenHash: sha256Hex(token),
      isServiceAccount: input.isServiceAccount ?? false,
      createdAt: now,
      requestCount: 0
    })
    .run();
  return { id, token, createdAt: now.getTime() };
}

/**
 * Cross-tenant lookup by plaintext Bearer. Returns the resolved tenant
 * triple on hit, null on miss / revoked / malformed. Constant-time hash
 * compare keeps timing attacks impractical even with a known prefix.
 *
 * Called from hooks.server.ts BEFORE runWithTenantAsync wraps the request
 * — that's why this is the one apiTokens function without an ownerId
 * argument.
 */
export function lookupByPlaintext(plaintext: string): ResolvedApiToken | null {
  if (!plaintext.startsWith(TOKEN_PREFIX)) return null;
  unscopedQueryNote(
    'Bearer lookup is cross-tenant by definition; result establishes tenant context'
  );
  const hash = sha256Hex(plaintext);
  const rows = db.select().from(apiTokens).where(eq(apiTokens.tokenHash, hash)).all();
  if (rows.length === 0) return null;
  const row = rows[0];
  // Constant-time compare even though UNIQUE INDEX guarantees one row.
  const expected = Buffer.from(hash, 'hex');
  const given = Buffer.from(row.tokenHash, 'hex');
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  if (row.revokedAt) return null;
  return {
    tokenId: row.id,
    ownerId: row.ownerId,
    userId: row.userId,
    isServiceAccount: row.isServiceAccount
  };
}

/**
 * Debounced touch — bumps lastUsedAt + increments requestCount at most
 * once per minute per token to avoid hammering the DB on tight agent
 * loops. Counter accumulates in memory between flushes so we don't lose
 * the bulk-fetch increments.
 */
const touchState = new Map<string, { last: number; seen: number; pending: number }>();
const TOUCH_DEBOUNCE_MS = 60_000;
export const MAX_TRACKED_TOKENS = 1_000;
let lastSweepAt = 0;

function writeTouch(id: string, delta: number, at: number): boolean {
  try {
    unscopedQueryNote(
      'touchToken is keyed by token primary key; safe to update without ownerId guard'
    );
    db.update(apiTokens)
      .set({ lastUsedAt: new Date(at), requestCount: sql`${apiTokens.requestCount} + ${delta}` })
      .where(eq(apiTokens.id, id))
      .run();
    return true;
  } catch (err) {
    console.error('[apiTokens] touch failed', err);
    return false;
  }
}

function evict(id: string, force = false): void {
  const entry = touchState.get(id);
  if (!entry) return;
  if (entry.pending > 0 && !writeTouch(id, entry.pending, entry.seen) && !force) return;
  touchState.delete(id);
}

function sweep(now: number): void {
  if (now - lastSweepAt < TOUCH_DEBOUNCE_MS && touchState.size <= MAX_TRACKED_TOKENS) return;
  lastSweepAt = now;
  for (const [id, entry] of touchState) {
    if (now - entry.last >= TOUCH_DEBOUNCE_MS) evict(id);
  }
  for (const id of touchState.keys()) {
    if (touchState.size <= MAX_TRACKED_TOKENS) break;
    evict(id, true);
  }
}

export function touchToken(id: string): void {
  const now = Date.now();
  const entry = touchState.get(id);
  if (entry && now - entry.last < TOUCH_DEBOUNCE_MS) {
    entry.pending += 1;
    entry.seen = now;
    return;
  }
  const delta = (entry?.pending ?? 0) + 1;
  touchState.delete(id);
  touchState.set(id, { last: now, seen: now, pending: writeTouch(id, delta, now) ? 0 : delta });
  sweep(now);
}

export function trackedTokenCount(): number {
  return touchState.size;
}

/** List tokens for an Owner — never returns the plaintext (DB doesn't
 *  have it). Owner-only endpoint gates against helpers in the route. */
export function listTokensForOwner(ownerId: string): ApiTokenSummary[] {
  unscopedQueryNote('owner-admin endpoint already gates by role; this lists their tenant only');
  return db.select().from(apiTokens).where(eq(apiTokens.ownerId, ownerId)).all().map(rowToSummary);
}

/** Revoke uses composite (owner_id, id) so an Owner cannot revoke
 *  another Owner's token even if they guess the id. */
export function revokeToken(ownerId: string, tokenId: string): boolean {
  const r = db
    .update(apiTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiTokens.ownerId, ownerId), eq(apiTokens.id, tokenId)))
    .run();
  if (r.changes === 0) return false;
  evict(tokenId, true);
  return true;
}

function rowToSummary(row: typeof apiTokens.$inferSelect): ApiTokenSummary {
  return {
    id: row.id,
    ownerId: row.ownerId,
    userId: row.userId,
    label: row.label,
    isServiceAccount: row.isServiceAccount,
    dailyQuota: {
      allocate: row.dailyQuotaAllocate,
      schedule: row.dailyQuotaSchedule,
      inputs: row.dailyQuotaInputs,
      stockRefresh: row.dailyQuotaStockRefresh
    },
    createdAt: row.createdAt.getTime(),
    lastUsedAt: row.lastUsedAt?.getTime() ?? null,
    requestCount: row.requestCount,
    revokedAt: row.revokedAt?.getTime() ?? null
  };
}
