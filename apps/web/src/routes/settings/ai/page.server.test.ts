import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { db } from '$lib/db/client';
import { aiCallLog, owners, users } from '$lib/db/schema';
import { runWithTenant, tenantValues } from '$lib/db/tenant';
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

describe('/settings/ai recent calls', () => {
  it('returns the 50 most recent calls, newest first, when more than 50 exist', () => {
    const { ownerId, userId } = seed();
    const base = Date.now() - 60 * 60_000;
    const data = runWithTenant(ownerId, () => {
      for (let i = 0; i < 60; i++) {
        db.insert(aiCallLog)
          .values(
            tenantValues({
              id: randomUUID(),
              userId,
              endpoint: 'scan-label' as const,
              model: 'claude',
              createdAt: new Date(base + i * 1000)
            })
          )
          .run();
      }
      return load({
        locals: { user: { id: userId, role: 'owner', activeOwnerId: ownerId } }
      } as never) as { recentCalls: Array<{ createdAt: Date }> };
    });
    const times = data.recentCalls.map((c) => c.createdAt.getTime());
    expect(times).toHaveLength(50);
    expect(times[0]).toBe(base + 59 * 1000);
    expect(times[49]).toBe(base + 10 * 1000);
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });
});
