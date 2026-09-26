import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '$lib/db/client';
import { helperAssignments, owners, users } from '$lib/db/schema';
import { runWithTenant } from '$lib/db/tenant';
import type { PlanId } from '$lib/billing/plans';
import {
  checkGuard,
  guardLedgerSize,
  recordCall,
  reserveGuard,
  resetFreePoolCache,
  resetGuardLedger,
  spendSnapshot
} from './aiGuard';
import { tryAiWithGuard } from './aiDegrade';

const DAY = 86_400_000;

function farm(plan: PlanId | null) {
  const ownerId = `ledger-${randomUUID().slice(0, 10)}`;
  const userId = `ledger-user-${randomUUID().slice(0, 10)}`;
  db.insert(owners)
    .values({
      id: ownerId,
      name: ownerId,
      slug: ownerId,
      billingStatus: 'active',
      planOverride: plan,
      createdAt: new Date(Date.now() - 90 * DAY)
    })
    .run();
  db.insert(users)
    .values({ id: userId, email: `${userId}@test` })
    .run();
  db.insert(helperAssignments)
    .values({ ownerId, userId, roleWithinOwner: 'owner', status: 'active' })
    .run();
  return { ownerId, userId };
}

function spend(ownerId: string, userId: string, usd: number) {
  runWithTenant(ownerId, () =>
    recordCall({
      userId,
      endpoint: 'inputs',
      model: 'test',
      inputTokens: 10,
      cachedInputTokens: 0,
      outputTokens: 10,
      usdEstimate: usd,
      success: true
    })
  );
}

const savedKey = process.env.ANTHROPIC_API_KEY;

beforeEach(() => {
  process.env.AI_FREE_POOL_MONTHLY_USD = '0';
  resetFreePoolCache();
  resetGuardLedger();
});

afterEach(() => {
  delete process.env.AI_GLOBAL_MONTHLY_USD_CAP;
  if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = savedKey;
  resetGuardLedger();
});

describe('calls in flight hold their reserve', () => {
  it('ten reservations with nothing logged in between give exactly one Free allocate', () => {
    const f = farm(null);
    runWithTenant(f.ownerId, () => {
      const oks = Array.from({ length: 10 }, () => reserveGuard(f.userId, 'allocate')).filter(
        (g) => g.ok
      );
      expect(oks).toHaveLength(1);
    });
  });

  it('parallel reservations never add up past the monthly budget', () => {
    const f = farm('grower');
    spend(f.ownerId, f.userId, 3);
    runWithTenant(f.ownerId, () => {
      const oks = Array.from({ length: 10 }, () => reserveGuard(f.userId, 'plugin-search')).filter(
        (g) => g.ok
      );
      expect(oks).toHaveLength(4);
      const blocked = reserveGuard(f.userId, 'plugin-search');
      expect(blocked.ok).toBe(false);
      if (!blocked.ok) expect(blocked.detail).toBe('monthly-budget');
    });
  });

  it('checkGuard sees calls in flight but holds nothing itself', () => {
    const f = farm(null);
    runWithTenant(f.ownerId, () => {
      expect(checkGuard(f.userId, 'allocate').ok).toBe(true);
      expect(checkGuard(f.userId, 'allocate').ok).toBe(true);
      const held = reserveGuard(f.userId, 'allocate');
      expect(held.ok).toBe(true);
      expect(checkGuard(f.userId, 'allocate').ok).toBe(false);
      if (held.ok) held.hold?.release();
      expect(checkGuard(f.userId, 'allocate').ok).toBe(true);
    });
  });

  it('a settled call stays held until its row is logged, then the row takes over', () => {
    const f = farm('grower');
    runWithTenant(f.ownerId, () => {
      const g = reserveGuard(f.userId, 'suggest');
      expect(g.ok).toBe(true);
      if (!g.ok) return;
      g.hold?.settle(0.1);
      expect(guardLedgerSize()).toBe(1);
      recordCall({
        userId: f.userId,
        endpoint: 'suggest',
        model: 'test',
        inputTokens: 100,
        cachedInputTokens: 0,
        outputTokens: 10,
        usdEstimate: 0.1,
        success: true
      });
      expect(guardLedgerSize()).toBe(0);
      expect(spendSnapshot().monthlyUsdSoFar).toBeCloseTo(0.1, 5);
    });
  });

  it('free-plan calls in flight count toward the free pool', () => {
    process.env.AI_FREE_POOL_MONTHLY_USD = '1000000';
    resetFreePoolCache();
    const a = farm(null);
    runWithTenant(a.ownerId, () => {
      expect(reserveGuard(a.userId, 'allocate').ok).toBe(true);
    });
    process.env.AI_FREE_POOL_MONTHLY_USD = '0.2';
    const b = farm(null);
    runWithTenant(b.ownerId, () => {
      const g = checkGuard(b.userId, 'suggest');
      expect(g.ok).toBe(false);
      if (!g.ok) expect(g.detail).toBe('free-pool');
    });
  });

  it('twenty parallel AI plans on a Free farm reach the model exactly once', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    const f = farm(null);
    let calls = 0;
    const results = await runWithTenant(f.ownerId, () =>
      Promise.all(
        Array.from({ length: 20 }, () =>
          tryAiWithGuard({
            endpoint: 'allocate',
            userId: f.userId,
            prompt: async () => {
              calls += 1;
              await new Promise((r) => setTimeout(r, 20));
              return {
                meta: {
                  model: 'test',
                  inputTokens: 100,
                  cachedInputTokens: 0,
                  outputTokens: 100,
                  usdEstimate: 0.12
                }
              };
            }
          })
        )
      )
    );
    expect(calls).toBe(1);
    expect(results.filter((r) => r.provenance === 'ai')).toHaveLength(1);
    expect(results.filter((r) => r.provenance === 'fallback')).toHaveLength(19);
  });

  it('a failed call gives its hold back', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    const f = farm(null);
    await runWithTenant(f.ownerId, async () => {
      const tried = await tryAiWithGuard({
        endpoint: 'allocate',
        userId: f.userId,
        prompt: async () => {
          throw new Error('boom');
        }
      });
      expect(tried.provenance).toBe('fallback');
      expect(guardLedgerSize()).toBe(0);
      expect(checkGuard(f.userId, 'allocate').ok).toBe(true);
    });
  });
});
