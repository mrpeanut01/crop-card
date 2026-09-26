// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { db } from '$lib/db/client';
import { owners } from '$lib/db/schema';
import { runWithTenantAsync } from '$lib/db/tenant';
import { applyFrostPlan, loadStoredFrost } from '$lib/climate/frostSettings.server';

vi.mock('$lib/server/auth', () => ({
  requireOwner: () => ({ id: 'user-1', role: 'owner' })
}));

import { DELETE, POST } from './+server';

function seedOwner(): string {
  const id = `settings-frost-${randomUUID()}`;
  db.insert(owners).values({ id, name: id, slug: id, billingStatus: 'active' }).run();
  return id;
}

function stationPlan(hard: 'data' | 'fallback' = 'data') {
  applyFrostPlan({
    set: { lastFrost: '04-20', firstFrost: '10-18' },
    clear: ['lastHardFrost', 'firstHardFrost'],
    provenance: {
      values: {
        lastFrost: 'data',
        firstFrost: 'data',
        lastHardFrost: hard,
        firstHardFrost: hard
      },
      source: 'Dulles Intl, 6 mi',
      probability: 'median'
    }
  });
}

const post = (key: string, value: unknown) =>
  POST({
    request: new Request('http://localhost/api/settings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key, value })
    })
  } as never);

const del = (key: string) =>
  DELETE({ url: new URL(`http://localhost/api/settings?key=${key}`) } as never);

describe('/api/settings frost dates keep frost provenance honest', () => {
  it('a typed date becomes manual and a cleared one fallback', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      stationPlan();
      expect((await post('last_frost_date', '05-01')).status).toBe(200);
      let prov = loadStoredFrost().provenance;
      expect(prov.values.lastFrost).toBe('manual');
      expect(prov.values.firstFrost).toBe('data');
      expect(prov.source).toBe('Dulles Intl, 6 mi');

      expect((await del('first_frost_date')).status).toBe(200);
      prov = loadStoredFrost().provenance;
      expect(prov.values.firstFrost).toBe('fallback');
      expect(prov.source).toBe('Dulles Intl, 6 mi');
    });
  });

  it('drops the station once no date is station data', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      stationPlan('fallback');
      await post('last_frost_date', '05-01');
      expect(loadStoredFrost().provenance.source).toBe('Dulles Intl, 6 mi');
      await post('first_frost_date', '10-01');
      const prov = loadStoredFrost().provenance;
      expect(prov.values).toMatchObject({ lastFrost: 'manual', firstFrost: 'manual' });
      expect(prov.source).toBeNull();
      expect(prov.probability).toBeNull();
    });
  });

  it('refuses a frost date that no year has', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      for (const bad of ['02-30', '04-31', '13-01', '00-10']) {
        const res = await post('last_frost_date', bad).catch((e: { status?: number }) => e);
        expect((res as { status?: number }).status, bad).toBe(400);
      }
      expect((await post('last_frost_date', '02-29')).status).toBe(200);
    });
  });
});
