/**
 * aiGuard service-account quota tests (Phase 24, Sub-task D / #58).
 *
 * Verifies that when a Bearer-authed service-account token calls a
 * rate-limited AI endpoint, the daily quota keys on the TOKEN id rather
 * than the underlying user id — so a runaway scouting drone cannot drain
 * the human owner's per-user quota.
 *
 * Three scenarios from the epic:
 *   1. Service-account quota is independent of user quota.
 *   2. Runaway service account still hits the global monthly USD cap.
 *   3. Personal-use Bearer token (isServiceAccount=false) shares the
 *      user quota — there's no quota arbitrage for non-service-account
 *      tokens.
 *
 * Existing aiGuard.test.ts (none today) and cookie-session paths stay
 * unchanged; this is purely additive.
 */

import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { checkGuard, recordCall } from './aiGuard';
import { issueToken } from './apiTokens';
import { eq } from 'drizzle-orm';
import { db } from '$lib/db/client';
import { owners, users, helperAssignments, aiCallLog, apiTokens } from '$lib/db/schema';
import { runWithTenant } from '$lib/db/tenant';

function uniq(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

interface SeedResult {
  ownerId: string;
  userId: string;
  tokenId: string;
}

function seedServiceAccountToken(): SeedResult {
  const ownerId = uniq('owner-sa');
  const userId = uniq('user-sa');
  db.insert(owners)
    .values({ id: ownerId, name: ownerId, slug: ownerId, billingStatus: 'active' })
    .run();
  db.insert(users).values({ id: userId, email: `${userId}@test`, role: 'owner' }).run();
  db.insert(helperAssignments)
    .values({ ownerId, userId, roleWithinOwner: 'owner', status: 'active' })
    .run();
  const { id: tokenId } = issueToken({
    ownerId,
    userId,
    label: 'service-acct',
    isServiceAccount: true
  });
  return { ownerId, userId, tokenId };
}

function seedPersonalToken(): SeedResult {
  const ownerId = uniq('owner-pers');
  const userId = uniq('user-pers');
  db.insert(owners)
    .values({ id: ownerId, name: ownerId, slug: ownerId, billingStatus: 'active' })
    .run();
  db.insert(users).values({ id: userId, email: `${userId}@test`, role: 'owner' }).run();
  db.insert(helperAssignments)
    .values({ ownerId, userId, roleWithinOwner: 'owner', status: 'active' })
    .run();
  const { id: tokenId } = issueToken({
    ownerId,
    userId,
    label: 'personal-use',
    isServiceAccount: false
  });
  return { ownerId, userId, tokenId };
}

/** Simulate N prior `allocate` calls by writing ai_call_log rows. We
 *  hand-write rather than going through recordCall() because recordCall
 *  also increments the usage counter; for quota testing we only need the
 *  rows that checkGuard counts.
 *
 *  usdEstimate is intentionally tiny ($0.0001) so seeding hundreds of rows
 *  for quota tests doesn't inadvertently bump the GLOBAL monthly USD cap
 *  (default $5) and conflate cap-exceeded with quota-exceeded. The
 *  monthly-cap test below uses its own oversized row for the cap check. */
function seedCalls(opts: {
  ownerId: string;
  userId: string | null;
  tokenId: string | null;
  endpoint: 'allocate' | 'inputs';
  count: number;
}): void {
  for (let i = 0; i < opts.count; i++) {
    db.insert(aiCallLog)
      .values({
        id: randomUUID(),
        ownerId: opts.ownerId,
        userId: opts.userId,
        tokenId: opts.tokenId,
        endpoint: opts.endpoint,
        model: 'claude-opus-4-7',
        inputTokens: 10,
        cachedInputTokens: 0,
        outputTokens: 5,
        usdEstimate: 0.0001,
        success: true
      })
      .run();
  }
}

describe('Phase 24 — service-account quota independence', () => {
  it('a runaway service-account token does NOT drain the underlying user\'s daily quota', () => {
    const { ownerId, userId, tokenId } = seedServiceAccountToken();
    // Saturate the SERVICE-ACCOUNT path with hundreds of `allocate` calls.
    seedCalls({ ownerId, userId: null, tokenId, endpoint: 'allocate', count: 200 });

    runWithTenant(ownerId, () => {
      // The same underlying user, calling via a cookie session, sees full
      // quota still available. Default daily quota for `allocate` is 5;
      // we've spent zero of it under the user-keyed path.
      const cookieCall = checkGuard(userId, 'allocate');
      expect(cookieCall.ok).toBe(true);

      // The service-account token, however, is over its own quota. Default
      // service-account override is null → falls back to the per-user
      // default of 5; with 200 calls logged against tokenId, this is blocked.
      const tokenCall = checkGuard(userId, 'allocate', {
        tokenId,
        isServiceAccount: true
      });
      expect(tokenCall.ok).toBe(false);
      if (!tokenCall.ok) {
        expect(tokenCall.reason).toBe('quota-exceeded');
        expect(tokenCall.message).toContain('Service-account');
      }
    });
  });

  it('respects a per-token daily_quota_* override when set', () => {
    const { ownerId, userId, tokenId } = seedServiceAccountToken();
    // Bump the token's allocate quota to 1000 via Drizzle.
    db.update(apiTokens)
      .set({ dailyQuotaAllocate: 1000 })
      .where(eq(apiTokens.id, tokenId))
      .run();

    // Log 100 calls under the token — well under 1000 but well over the
    // default of 5.
    seedCalls({ ownerId, userId: null, tokenId, endpoint: 'allocate', count: 100 });
    runWithTenant(ownerId, () => {
      const tokenCall = checkGuard(userId, 'allocate', {
        tokenId,
        isServiceAccount: true
      });
      expect(tokenCall.ok).toBe(true);
    });
  });

  it('personal-use Bearer token (isServiceAccount=false) shares the user quota', () => {
    const { ownerId, userId, tokenId } = seedPersonalToken();
    // Spend the user's daily allocate quota (default 5) under the user id.
    seedCalls({ ownerId, userId, tokenId: null, endpoint: 'allocate', count: 5 });
    runWithTenant(ownerId, () => {
      // Token call with isServiceAccount=false → uses user-keyed quota
      // and finds it spent.
      const tokenCall = checkGuard(userId, 'allocate', {
        tokenId,
        isServiceAccount: false
      });
      expect(tokenCall.ok).toBe(false);
      if (!tokenCall.ok) expect(tokenCall.reason).toBe('quota-exceeded');
    });
  });

  it('cookie sessions are unaffected by Phase 24 changes (no regression)', () => {
    const { ownerId, userId } = seedServiceAccountToken();
    runWithTenant(ownerId, () => {
      // No tokenContext arg → the original per-user behavior.
      const guard = checkGuard(userId, 'allocate');
      expect(guard.ok).toBe(true);
    });
  });
});

describe('Phase 24 — recordCall stamps tokenId on the audit row', () => {
  it('stores the tokenId so callsTodayByToken finds the row on the next iteration', () => {
    const { ownerId, userId, tokenId } = seedServiceAccountToken();
    runWithTenant(ownerId, () => {
      recordCall({
        userId,
        tokenId,
        endpoint: 'allocate',
        model: 'claude-opus-4-7',
        inputTokens: 100,
        cachedInputTokens: 0,
        outputTokens: 50,
        usdEstimate: 0.0001,
        success: true
      });
      // Next checkGuard call under the same token sees one entry against it.
      const guard = checkGuard(userId, 'allocate', {
        tokenId,
        isServiceAccount: true
      });
      expect(guard.ok).toBe(true); // 1 of 5
    });
  });
});

// Run the cap-exceeded test LAST — it intentionally seeds a $999,999 row
// that saturates the GLOBAL monthly cap and would cause any subsequent
// quota test in this file to fail with cap-exceeded instead of the
// expected quota-exceeded.
describe('Phase 24 — monthly USD cap stays global', () => {
  it('a service-account token cannot bypass the monthly USD cap', () => {
    const { ownerId, userId, tokenId } = seedServiceAccountToken();
    // The cap is global by design (safety brake against a runaway agent);
    // one oversized row anywhere proves a service-account token gets
    // blocked just like a cookie session would.
    db.insert(aiCallLog)
      .values({
        id: randomUUID(),
        ownerId,
        userId,
        endpoint: 'allocate',
        model: 'claude-opus-4-7',
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        usdEstimate: 999_999,
        success: true
      })
      .run();

    runWithTenant(ownerId, () => {
      const tokenCall = checkGuard(userId, 'allocate', {
        tokenId,
        isServiceAccount: true
      });
      expect(tokenCall.ok).toBe(false);
      if (!tokenCall.ok) expect(tokenCall.reason).toBe('cap-exceeded');
    });
  });
});
