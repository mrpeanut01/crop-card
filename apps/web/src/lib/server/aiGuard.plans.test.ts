/**
 * Plan-aware AI guard: the plan budget is the ceiling, an owner can only
 * lower it, 0 means off, each call reserves its worst case first, and free
 * farms share one pool. Every block degrades (402/429 + aiTry fallback);
 * nothing here gates a non-AI feature.
 */

import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { db } from '$lib/db/client';
import { helperAssignments, owners, users } from '$lib/db/schema';
import { runWithTenant } from '$lib/db/tenant';
import { setSetting } from '$lib/db/settings';
import { SETTINGS_KEYS } from '$lib/schedule/constants';
import type { PlanId } from '$lib/billing/plans';
import { checkGuard, recordCall, resetFreePoolCache, spendSnapshot } from './aiGuard';
import { issueToken } from './apiTokens';

const DAY = 86_400_000;

function farm(plan: PlanId | null, opts: { young?: boolean } = {}) {
  const ownerId = `guard-plan-${randomUUID().slice(0, 10)}`;
  const userId = `guard-user-${randomUUID().slice(0, 10)}`;
  db.insert(owners)
    .values({
      id: ownerId,
      name: ownerId,
      slug: ownerId,
      billingStatus: 'active',
      planOverride: plan,
      createdAt: new Date(Date.now() - (opts.young ? 1 : 90) * DAY)
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

function spend(
  ownerId: string,
  userId: string | null,
  usd: number,
  extra: { tokenId?: string; endpoint?: 'inputs' | 'suggest' } = {}
) {
  runWithTenant(ownerId, () =>
    recordCall({
      userId,
      tokenId: extra.tokenId ?? null,
      endpoint: extra.endpoint ?? 'inputs',
      model: 'test',
      inputTokens: 10,
      cachedInputTokens: 0,
      outputTokens: 10,
      usdEstimate: usd,
      success: true
    })
  );
}

afterEach(() => {
  process.env.AI_FREE_POOL_MONTHLY_USD = '0';
  delete process.env.AI_GLOBAL_MONTHLY_USD_CAP;
  resetFreePoolCache();
});

describe('monthly budget comes from the plan', () => {
  it('an owner setting above the plan budget does not raise it', () => {
    const f = farm(null);
    runWithTenant(f.ownerId, () => setSetting(SETTINGS_KEYS.aiMonthlyUsdCap, '50'));
    spend(f.ownerId, f.userId, 0.49);
    runWithTenant(f.ownerId, () => {
      const g = checkGuard(f.userId, 'suggest');
      expect(g.ok).toBe(false);
      if (!g.ok) {
        expect(g).toMatchObject({ reason: 'cap-exceeded', detail: 'monthly-budget' });
        expect(g.upgrade).toBe('grower');
        expect(g.message).toContain('More AI on Grower');
      }
      expect(spendSnapshot()).toMatchObject({ cap: 0.5, planBudget: 0.5, plan: 'free' });
    });
  });

  it('an owner can lower the budget below the plan', () => {
    const f = farm('grower');
    runWithTenant(f.ownerId, () => setSetting(SETTINGS_KEYS.aiMonthlyUsdCap, '1'));
    spend(f.ownerId, f.userId, 0.99);
    runWithTenant(f.ownerId, () => {
      const g = checkGuard(f.userId, 'suggest');
      expect(g.ok).toBe(false);
      if (!g.ok) expect(g.message).toContain('you set');
    });
  });

  it('regression: an owner cap of 0 turns AI off instead of removing the cap', () => {
    const f = farm('farm');
    runWithTenant(f.ownerId, () => {
      setSetting(SETTINGS_KEYS.aiMonthlyUsdCap, '0');
      const g = checkGuard(f.userId, 'suggest');
      expect(g.ok).toBe(false);
      if (!g.ok) {
        expect(g).toMatchObject({
          reason: 'cap-exceeded',
          detail: 'owner-disabled',
          upgrade: null
        });
      }
      expect(spendSnapshot()).toMatchObject({ aiOff: true, exhausted: true });
    });
  });

  it('the starter boost lifts a young Free farm to $1.00', () => {
    const f = farm(null, { young: true });
    spend(f.ownerId, f.userId, 0.7);
    runWithTenant(f.ownerId, () => {
      expect(checkGuard(f.userId, 'suggest').ok).toBe(true);
      expect(spendSnapshot()).toMatchObject({ cap: 1, starterBoost: true });
    });
  });
});

describe('the meter agrees with the guard', () => {
  it('$0.99 of $1.00 reads as used up, because no feature can start', () => {
    const f = farm(null, { young: true });
    spend(f.ownerId, f.userId, 0.99);
    runWithTenant(f.ownerId, () => {
      expect(checkGuard(f.userId, 'suggest').ok).toBe(false);
      expect(spendSnapshot()).toMatchObject({ exhausted: true, cap: 1, upgrade: 'grower' });
    });
  });

  it('with less left than a full plan needs, the meter says quick help only', () => {
    const f = farm(null);
    spend(f.ownerId, f.userId, 0.3);
    runWithTenant(f.ownerId, () => {
      expect(checkGuard(f.userId, 'allocate').ok).toBe(false);
      expect(checkGuard(f.userId, 'suggest').ok).toBe(true);
      expect(spendSnapshot()).toMatchObject({ exhausted: false, quickOnly: true });
    });
  });
});

describe('reserve before each call', () => {
  it('refuses a call whose worst case would overshoot the budget', () => {
    const f = farm('grower');
    spend(f.ownerId, f.userId, 3.8);
    runWithTenant(f.ownerId, () => {
      const plan = checkGuard(f.userId, 'allocate');
      expect(plan.ok).toBe(false);
      if (!plan.ok) expect(plan.detail).toBe('monthly-budget');
      expect(checkGuard(f.userId, 'suggest').ok).toBe(true);
    });
  });

  it('a receipt counts what it has already spent before each line lookup', () => {
    const f = farm('grower');
    spend(f.ownerId, f.userId, 3);
    runWithTenant(f.ownerId, () => {
      expect(checkGuard(f.userId, 'plugin-search', undefined, 0.5).ok).toBe(true);
      expect(checkGuard(f.userId, 'plugin-search', undefined, 0.8).ok).toBe(false);
    });
  });
});

describe('who spends the budget', () => {
  it("a helper's calls come out of the owner's budget", () => {
    const f = farm(null);
    const helperId = `guard-helper-${randomUUID().slice(0, 8)}`;
    db.insert(users)
      .values({ id: helperId, email: `${helperId}@test` })
      .run();
    spend(f.ownerId, helperId, 0.5);
    runWithTenant(f.ownerId, () => expect(checkGuard(f.userId, 'suggest').ok).toBe(false));
  });

  it("Bearer token calls come out of the owner's budget", () => {
    const f = farm(null);
    const { id: tokenId } = issueToken({
      ownerId: f.ownerId,
      userId: f.userId,
      label: 'drone',
      isServiceAccount: true
    });
    spend(f.ownerId, null, 0.5, { tokenId });
    runWithTenant(f.ownerId, () => {
      expect(checkGuard(f.userId, 'suggest').ok).toBe(false);
      expect(checkGuard(f.userId, 'suggest', { tokenId, isServiceAccount: true }).ok).toBe(false);
    });
  });
});

describe('daily caps', () => {
  it('a feature with a 0 cap on the plan degrades as over-cap with an upgrade', () => {
    const f = farm(null);
    runWithTenant(f.ownerId, () => {
      for (const endpoint of ['optimize', 'rationale', 'plugin-batch-scan'] as const) {
        const g = checkGuard(f.userId, endpoint);
        expect(g.ok).toBe(false);
        if (!g.ok) {
          expect(g).toMatchObject({
            reason: 'cap-exceeded',
            status: 402,
            detail: 'plan-excluded',
            upgrade: 'grower'
          });
        }
      }
    });
  });

  it('the plan cap applies and an owner can only lower it', () => {
    const f = farm('grower');
    runWithTenant(f.ownerId, () => {
      setSetting(SETTINGS_KEYS.aiDailyCallQuota, JSON.stringify({ suggest: 1, succession: 999 }));
    });
    spend(f.ownerId, f.userId, 0.001, { endpoint: 'suggest' });
    runWithTenant(f.ownerId, () => {
      const g = checkGuard(f.userId, 'suggest');
      expect(g.ok).toBe(false);
      if (!g.ok) expect(g).toMatchObject({ reason: 'quota-exceeded', detail: 'daily-quota' });
    });
    for (let i = 0; i < 20; i++) {
      runWithTenant(f.ownerId, () =>
        recordCall({
          userId: f.userId,
          endpoint: 'succession',
          model: 'test',
          inputTokens: 1,
          cachedInputTokens: 0,
          outputTokens: 1,
          usdEstimate: 0.001,
          success: true
        })
      );
    }
    runWithTenant(f.ownerId, () => expect(checkGuard(f.userId, 'succession').ok).toBe(false));
  });
});

describe('free pool', () => {
  it('stops free farms once all free AI spend reaches the pool, and never paid farms', () => {
    const free = farm(null);
    const paid = farm('grower');
    spend(free.ownerId, free.userId, 0.01);
    process.env.AI_FREE_POOL_MONTHLY_USD = '0.005';
    resetFreePoolCache();
    runWithTenant(free.ownerId, () => {
      const other = farm(null);
      runWithTenant(other.ownerId, () => {
        const g = checkGuard(other.userId, 'suggest');
        expect(g.ok).toBe(false);
        if (!g.ok) {
          expect(g).toMatchObject({ reason: 'cap-exceeded', detail: 'free-pool' });
          expect(g.message).not.toMatch(/—/);
        }
      });
    });
    runWithTenant(paid.ownerId, () => expect(checkGuard(paid.userId, 'suggest').ok).toBe(true));
  });

  it('a pool of 0 is off and a large pool leaves free farms alone', () => {
    const f = farm(null);
    process.env.AI_FREE_POOL_MONTHLY_USD = '0';
    resetFreePoolCache();
    runWithTenant(f.ownerId, () => expect(checkGuard(f.userId, 'suggest').ok).toBe(true));
    process.env.AI_FREE_POOL_MONTHLY_USD = '1000000000';
    resetFreePoolCache();
    runWithTenant(f.ownerId, () => expect(checkGuard(f.userId, 'suggest').ok).toBe(true));
  });
});

describe('guard copy', () => {
  it('is plain and warm with no em dashes', () => {
    const f = farm(null);
    spend(f.ownerId, f.userId, 5);
    runWithTenant(f.ownerId, () => {
      const g = checkGuard(f.userId, 'suggest');
      expect(g.ok).toBe(false);
      if (!g.ok) {
        expect(g.message).toContain("You've used this month's AI help");
        expect(g.message).not.toMatch(/—/);
      }
    });
  });
});
