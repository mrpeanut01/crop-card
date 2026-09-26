/**
 * Daily AI caps are per farm: the owner, helpers and every Bearer token draw
 * on the same allowance. A service-account token's own daily_quota_* column
 * applies on top as an extra limit, never as a way past the farm's cap.
 */

import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { checkGuard, recordCall } from './aiGuard';
import { issueToken } from './apiTokens';
import { eq } from 'drizzle-orm';
import { db } from '$lib/db/client';
import { owners, users, helperAssignments, aiCallLog, apiTokens } from '$lib/db/schema';
import { runWithTenant, tenantValues, withTenant } from '$lib/db/tenant';

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
    .values({
      id: ownerId,
      name: ownerId,
      slug: ownerId,
      billingStatus: 'active',
      planOverride: 'grower'
    })
    .run();
  db.insert(users)
    .values({ id: userId, email: `${userId}@test` })
    .run();
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
    .values({
      id: ownerId,
      name: ownerId,
      slug: ownerId,
      billingStatus: 'active',
      planOverride: 'grower'
    })
    .run();
  db.insert(users)
    .values({ id: userId, email: `${userId}@test` })
    .run();
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
    runWithTenant(opts.ownerId, () =>
      db
        .insert(aiCallLog)
        .values(
          tenantValues({
            id: randomUUID(),
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
        )
        .run()
    );
  }
}

describe('daily caps are per farm', () => {
  it("a service-account token's calls use the farm's daily allowance", () => {
    const { ownerId, userId, tokenId } = seedServiceAccountToken();
    seedCalls({ ownerId, userId: null, tokenId, endpoint: 'allocate', count: 5 });
    runWithTenant(ownerId, () => {
      const cookieCall = checkGuard(userId, 'allocate');
      expect(cookieCall.ok).toBe(false);
      if (!cookieCall.ok) {
        expect(cookieCall.reason).toBe('quota-exceeded');
        expect(cookieCall.detail).toBe('daily-quota');
      }
    });
  });

  it('a per-token override lower than the farm cap limits only that token', () => {
    const { ownerId, userId, tokenId } = seedServiceAccountToken();
    db.update(apiTokens).set({ dailyQuotaAllocate: 1 }).where(eq(apiTokens.id, tokenId)).run();
    seedCalls({ ownerId, userId: null, tokenId, endpoint: 'allocate', count: 1 });
    runWithTenant(ownerId, () => {
      const tokenCall = checkGuard(userId, 'allocate', { tokenId, isServiceAccount: true });
      expect(tokenCall.ok).toBe(false);
      if (!tokenCall.ok) {
        expect(tokenCall.detail).toBe('token-quota');
        expect(tokenCall.message).toContain('Service-account');
      }
      expect(checkGuard(userId, 'allocate').ok).toBe(true);
    });
  });

  it("a per-token override cannot raise the farm's cap", () => {
    const { ownerId, userId, tokenId } = seedServiceAccountToken();
    db.update(apiTokens).set({ dailyQuotaAllocate: 1000 }).where(eq(apiTokens.id, tokenId)).run();
    seedCalls({ ownerId, userId: null, tokenId, endpoint: 'allocate', count: 5 });
    runWithTenant(ownerId, () => {
      const tokenCall = checkGuard(userId, 'allocate', { tokenId, isServiceAccount: true });
      expect(tokenCall.ok).toBe(false);
      if (!tokenCall.ok) expect(tokenCall.detail).toBe('daily-quota');
    });
  });

  it('personal-use Bearer token (isServiceAccount=false) shares the farm allowance', () => {
    const { ownerId, userId, tokenId } = seedPersonalToken();
    seedCalls({ ownerId, userId, tokenId: null, endpoint: 'allocate', count: 5 });
    runWithTenant(ownerId, () => {
      const tokenCall = checkGuard(userId, 'allocate', { tokenId, isServiceAccount: false });
      expect(tokenCall.ok).toBe(false);
      if (!tokenCall.ok) expect(tokenCall.reason).toBe('quota-exceeded');
    });
  });

  it("a helper's calls on another farm do not count against this farm", () => {
    const home = seedServiceAccountToken();
    const other = seedPersonalToken();
    db.insert(helperAssignments)
      .values({
        ownerId: other.ownerId,
        userId: home.userId,
        roleWithinOwner: 'helper',
        status: 'active'
      })
      .run();
    seedCalls({
      ownerId: other.ownerId,
      userId: home.userId,
      tokenId: null,
      endpoint: 'allocate',
      count: 5
    });
    runWithTenant(home.ownerId, () => {
      expect(checkGuard(home.userId, 'allocate').ok).toBe(true);
    });
    runWithTenant(other.ownerId, () => {
      expect(checkGuard(home.userId, 'allocate').ok).toBe(false);
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
      const row = db
        .select()
        .from(aiCallLog)
        .where(withTenant(aiCallLog, eq(aiCallLog.tokenId, tokenId)))
        .get();
      expect(row?.endpoint).toBe('allocate');
      const guard = checkGuard(userId, 'allocate', {
        tokenId,
        isServiceAccount: true
      });
      expect(guard.ok).toBe(true);
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
    runWithTenant(ownerId, () =>
      db
        .insert(aiCallLog)
        .values(
          tenantValues({
            id: randomUUID(),
            userId,
            endpoint: 'allocate',
            model: 'claude-opus-4-7',
            inputTokens: 0,
            cachedInputTokens: 0,
            outputTokens: 0,
            usdEstimate: 999_999,
            success: true
          })
        )
        .run()
    );

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
