// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { db } from '$lib/db/client';
import { owners } from '$lib/db/schema';
import { runWithTenantAsync } from '$lib/db/tenant';
import { getSetting } from '$lib/db/settings';
import { spendSnapshot } from '$lib/server/aiGuard';
import type { PlanId } from '$lib/billing/plans';

vi.mock('$lib/server/auth', () => ({
  requireOwner: () => ({ id: 'user-1', role: 'owner' })
}));

import { POST } from './+server';

function seedOwner(plan: PlanId | null): string {
  const id = `settings-cap-${randomUUID()}`;
  db.insert(owners)
    .values({
      id,
      name: id,
      slug: id,
      billingStatus: 'active',
      planOverride: plan,
      createdAt: new Date(Date.now() - 90 * 86_400_000)
    })
    .run();
  return id;
}

const post = (key: string, value: unknown) =>
  POST({
    request: new Request('http://localhost/api/settings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key, value })
    })
  } as never);

describe('/api/settings clamps AI limits to the plan', () => {
  it('a monthly cap at or above the plan budget means the full plan budget', async () => {
    await runWithTenantAsync(seedOwner('grower'), async () => {
      expect((await post('ai_monthly_usd_cap', 25)).status).toBe(200);
      expect(getSetting('ai_monthly_usd_cap')).toBeUndefined();
      await post('ai_monthly_usd_cap', 1.5);
      expect(getSetting('ai_monthly_usd_cap')).toBe('1.5');
      await post('ai_monthly_usd_cap', 0);
      expect(getSetting('ai_monthly_usd_cap')).toBe('0');
    });
  });

  it('daily limits are clamped per feature and unknown keys dropped', async () => {
    await runWithTenantAsync(seedOwner(null), async () => {
      const res = await post('ai_daily_call_quota', { suggest: 50, allocate: 0, bogus: 3 });
      expect(res.status).toBe(200);
      expect(JSON.parse(getSetting('ai_daily_call_quota') ?? '{}')).toEqual({
        allocate: 0
      });
    });
  });

  it('a limit typed on Free does not hold the farm back after it upgrades', async () => {
    const ownerId = seedOwner(null);
    await runWithTenantAsync(ownerId, async () => {
      await post('ai_monthly_usd_cap', 10);
      await post('ai_daily_call_quota', { optimize: 5, rationale: 3 });
      expect(getSetting('ai_monthly_usd_cap')).toBeUndefined();
      expect(JSON.parse(getSetting('ai_daily_call_quota') ?? '{}')).toEqual({});
    });
    db.update(owners).set({ planOverride: 'grower' }).where(eq(owners.id, ownerId)).run();
    await runWithTenantAsync(ownerId, async () => {
      const snap = spendSnapshot();
      expect(snap.cap).toBe(4);
      expect(snap.plan).toBe('grower');
    });
  });
});
