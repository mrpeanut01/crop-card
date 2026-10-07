// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { db } from '$lib/db/client';
import { owners } from '$lib/db/schema';
import { runWithTenant } from '$lib/db/tenant';
import { setSetting } from '$lib/db/settings';
import { SETTINGS_KEYS } from '$lib/schedule/constants';

vi.mock('./scanResult', () => ({ getApiKey: () => 'sk-ant-test' }));

import { getUserAiEnabled } from './aiTry';

function seedOwner(): string {
  const id = `owner_ai_${randomUUID().replace(/-/g, '')}`;
  db.insert(owners)
    .values({ id, name: id, slug: id, billingStatus: 'active', createdAt: new Date() })
    .run();
  return id;
}

describe('getUserAiEnabled against the farm settings (#611)', () => {
  it('reads the owner limit of 0 that demo farms store as AI off', () => {
    const off = seedOwner();
    const on = seedOwner();
    runWithTenant(off, () => setSetting(SETTINGS_KEYS.aiMonthlyUsdCap, '0'));
    runWithTenant(on, () => setSetting(SETTINGS_KEYS.aiMonthlyUsdCap, '3'));
    expect(runWithTenant(off, () => getUserAiEnabled('user-1'))).toBe(false);
    expect(runWithTenant(on, () => getUserAiEnabled('user-1'))).toBe(true);
    expect(runWithTenant(seedOwner(), () => getUserAiEnabled('user-1'))).toBe(true);
  });
});
