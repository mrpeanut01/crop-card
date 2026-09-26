/**
 * Invariant 6: a farm's monthly AI cap is measured against that farm's own
 * spend. Another farm's usage must neither trip it nor show up in its
 * spend snapshot. The deployment-wide brake is operator-set only.
 */

import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { db } from '$lib/db/client';
import { owners, users } from '$lib/db/schema';
import { runWithTenant } from '$lib/db/tenant';
import { checkGuard, recordCall, spendSnapshot } from './aiGuard';

vi.mock('$lib/schedule/settings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/schedule/settings')>()),
  getAiMonthlyUsdCap: () => 10
}));

function seedFarm(): { ownerId: string; userId: string } {
  const ownerId = `cap-owner-${randomUUID().slice(0, 8)}`;
  const userId = `cap-user-${randomUUID().slice(0, 8)}`;
  db.insert(owners)
    .values({ id: ownerId, name: ownerId, slug: ownerId, billingStatus: 'active' })
    .run();
  db.insert(users)
    .values({ id: userId, email: `${userId}@test` })
    .run();
  return { ownerId, userId };
}

function spend(ownerId: string, userId: string, usd: number): void {
  runWithTenant(ownerId, () =>
    recordCall({
      userId,
      endpoint: 'inputs',
      model: 'test',
      inputTokens: 100,
      cachedInputTokens: 0,
      outputTokens: 100,
      usdEstimate: usd,
      success: true
    })
  );
}

afterEach(() => {
  delete process.env.AI_GLOBAL_MONTHLY_USD_CAP;
});

describe('aiGuard monthly cap is per farm', () => {
  it("another farm's spend neither trips this farm's cap nor appears in its snapshot", () => {
    const a = seedFarm();
    const b = seedFarm();
    spend(a.ownerId, a.userId, 50);

    runWithTenant(a.ownerId, () => {
      const out = checkGuard(a.userId, 'inputs');
      expect(out.ok).toBe(false);
      if (!out.ok) expect(out.reason).toBe('cap-exceeded');
    });
    runWithTenant(b.ownerId, () => {
      expect(checkGuard(b.userId, 'inputs').ok).toBe(true);
      expect(spendSnapshot().monthlyUsdSoFar).toBe(0);
    });
  });

  it('the operator-set deployment brake stops every farm', () => {
    const a = seedFarm();
    const b = seedFarm();
    spend(a.ownerId, a.userId, 1);
    process.env.AI_GLOBAL_MONTHLY_USD_CAP = '0.5';
    runWithTenant(b.ownerId, () => {
      const out = checkGuard(b.userId, 'inputs');
      expect(out.ok).toBe(false);
      if (!out.ok) expect(out.reason).toBe('cap-exceeded');
    });
  });
});
