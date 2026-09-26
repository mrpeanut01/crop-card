/**
 * Invariant 7 — no-key is a first-class mode. Deterministic-fallback
 * telemetry rows (zero tokens, no Claude call) must not count toward the
 * per-user daily AI quota, or a no-key user is eventually 429'd out of a
 * purely deterministic endpoint.
 */

import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { db } from '$lib/db/client';
import { owners, users } from '$lib/db/schema';
import { runWithTenant } from '$lib/db/tenant';
import { PLANS } from '$lib/billing/plans';
import { checkGuard, recordCall } from './aiGuard';

function seed(): { ownerId: string; userId: string } {
  const ownerId = `nk-owner-${randomUUID().slice(0, 8)}`;
  const userId = `nk-user-${randomUUID().slice(0, 8)}`;
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
  return { ownerId, userId };
}

describe('aiGuard daily quota ignores calls that never reached Claude', () => {
  it('fallback rows with zero tokens never exhaust the quota', () => {
    const { ownerId, userId } = seed();
    const quota = PLANS.grower.dailyQuota.inputs;
    runWithTenant(ownerId, () => {
      for (let i = 0; i < quota + 3; i++) {
        recordCall({
          userId,
          endpoint: 'inputs',
          model: 'n/a',
          inputTokens: 0,
          cachedInputTokens: 0,
          outputTokens: 0,
          usdEstimate: 0,
          success: false,
          errorClass: 'no-api-key'
        });
      }
      expect(checkGuard(userId, 'inputs').ok).toBe(true);
    });
  });

  it('real Claude calls still count toward the quota', () => {
    const { ownerId, userId } = seed();
    const quota = PLANS.grower.dailyQuota.inputs;
    runWithTenant(ownerId, () => {
      for (let i = 0; i < quota; i++) {
        recordCall({
          userId,
          endpoint: 'inputs',
          model: 'claude-sonnet',
          inputTokens: 100,
          cachedInputTokens: 0,
          outputTokens: 20,
          usdEstimate: 0,
          success: true
        });
      }
      const g = checkGuard(userId, 'inputs');
      expect(g.ok).toBe(false);
      if (!g.ok) expect(g.reason).toBe('quota-exceeded');
    });
  });
});
