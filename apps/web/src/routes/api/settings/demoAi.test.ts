// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { db } from '$lib/db/client';
import { owners } from '$lib/db/schema';
import { runWithTenantAsync } from '$lib/db/tenant';
import { getSetting, setSetting } from '$lib/db/settings';
import { SETTINGS_KEYS } from '$lib/schedule/constants';
import { DEMO_EMAIL_DOMAIN } from '$lib/demo/identity';

const who = vi.hoisted(() => ({ email: '' }));

vi.mock('$lib/server/auth', () => ({
  requireOwner: () => ({ id: 'user-1', role: 'owner', email: who.email, phone: null })
}));

import { DELETE, POST } from './+server';

function seedOwner(): string {
  const id = `owner_demo_${randomUUID().replace(/-/g, '')}`;
  db.insert(owners)
    .values({
      id,
      name: id,
      slug: id,
      billingStatus: 'active',
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
    }),
    locals: {}
  } as never);

const del = (key: string) =>
  DELETE({ url: new URL(`http://localhost/api/settings?key=${key}`), locals: {} } as never);

describe('/api/settings on a demo farm', () => {
  it('refuses to turn AI back on or change the key', async () => {
    who.email = `visitor-x@${DEMO_EMAIL_DOMAIN}`;
    await runWithTenantAsync(seedOwner(), async () => {
      setSetting(SETTINGS_KEYS.aiMonthlyUsdCap, '0');
      const raised = await post(SETTINGS_KEYS.aiMonthlyUsdCap, 10_000);
      expect(raised.status).toBe(403);
      expect((await raised.json()).code).toBe('DEMO_DISABLED');
      expect((await del(SETTINGS_KEYS.aiMonthlyUsdCap)).status).toBe(403);
      expect(getSetting(SETTINGS_KEYS.aiMonthlyUsdCap)).toBe('0');
      expect((await post('anthropic_api_key', 'sk-test')).status).toBe(403);
      expect((await post(SETTINGS_KEYS.aiDailyCallQuota, { allocate: 1 })).status).toBe(403);
      expect((await post(SETTINGS_KEYS.showShadeMarkers, true)).status).toBe(200);
    });
  });

  it('leaves a real owner free to change the AI limit', async () => {
    who.email = 'owner@example.com';
    await runWithTenantAsync(seedOwner(), async () => {
      expect((await post(SETTINGS_KEYS.aiMonthlyUsdCap, 0)).status).toBe(200);
      expect(getSetting(SETTINGS_KEYS.aiMonthlyUsdCap)).toBe('0');
    });
  });
});
