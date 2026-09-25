import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { db } from '$lib/db/client';
import { owners, users } from '$lib/db/schema';
import { runWithTenant } from '$lib/db/tenant';
import { recordCall } from '$lib/server/aiGuard';
import { load } from './+page.server';

function seed(): { ownerId: string; userId: string } {
  const ownerId = `sai-owner-${randomUUID().slice(0, 8)}`;
  const userId = `sai-user-${randomUUID().slice(0, 8)}`;
  db.insert(owners)
    .values({ id: ownerId, name: ownerId, slug: ownerId, billingStatus: 'active' })
    .run();
  db.insert(users)
    .values({ id: userId, email: `${userId}@test` })
    .run();
  return { ownerId, userId };
}

function call(userId: string, endpoint: 'scan-label' | 'scan-url', tokens: number) {
  recordCall({
    userId,
    endpoint,
    model: tokens > 0 ? 'claude' : 'none',
    inputTokens: tokens,
    cachedInputTokens: 0,
    outputTokens: 0,
    usdEstimate: 0,
    success: tokens > 0
  });
}

describe('/settings/ai per-endpoint usage', () => {
  it('counts today’s token-consuming calls per endpoint, including scan endpoints', () => {
    const { ownerId, userId } = seed();
    const data = runWithTenant(ownerId, () => {
      call(userId, 'scan-label', 100);
      call(userId, 'scan-label', 100);
      call(userId, 'scan-label', 0);
      call(userId, 'scan-url', 50);
      return load({
        locals: { user: { id: userId, role: 'owner', activeOwnerId: ownerId } }
      } as never) as { usedToday: Record<string, number>; dailyQuotas: Record<string, number> };
    });
    expect(data.usedToday['scan-label']).toBe(2);
    expect(data.usedToday['scan-url']).toBe(1);
    expect(data.usedToday['scan-barcode']).toBeUndefined();
    expect(data.dailyQuotas['scan-label']).toBeGreaterThan(0);
    expect(data.dailyQuotas['scan-url']).toBeGreaterThan(0);
    expect(data.dailyQuotas['scan-barcode']).toBeGreaterThan(0);
  });
});
