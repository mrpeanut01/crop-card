// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { db } from '$lib/db/client';
import { equipment, owners, users } from '$lib/db/schema';
import { runWithTenant, runWithTenantAsync, tenantValues } from '$lib/db/tenant';
import { createField } from '$lib/db/fields';
import { createBlock } from '$lib/db/blocks';
import { createCutting } from '$lib/db/hayCuttings';
import { insertSprayEvent } from '$lib/db/sprayEvents';
import { load as DETAIL } from './+page.server';
import { load as LEDGER } from '../../+page.server';

const USER = 'record-detail-owner';

db.insert(users)
  .values({ id: USER, email: `${USER}@test.local` })
  .onConflictDoNothing()
  .run();

function seed() {
  const ownerId = `record-detail-${randomUUID()}`;
  db.insert(owners)
    .values({ id: ownerId, name: ownerId, slug: ownerId, billingStatus: 'active' })
    .run();
  return runWithTenant(ownerId, () => {
    const field = createField({ name: 'Hay field', kind: 'field', acres: 4 });
    const block = createBlock({ name: 'Hay block', fieldId: field.id, acres: 4 });
    const cutting = createCutting({
      blockId: block.id,
      cropPluginId: 'alfalfa-vernema',
      year: 2026,
      mowAt: Date.now() - 60_000,
      performedById: USER,
      rulesVersion: 'rv-test'
    });
    const sprayIds: Record<string, string> = {};
    for (const label of ['Boom', 'Backpack']) {
      const sprayerId = `sprayer-${label}-${ownerId.slice(-6)}`;
      db.insert(equipment)
        .values(tenantValues({ id: sprayerId, type: 'sprayer' as const, label }))
        .run();
      sprayIds[label] = insertSprayEvent({
        blockId: block.id,
        sprayerId,
        performedById: USER,
        occurredAt: Date.now() - 120_000,
        products: [{ pluginId: '24d', chemistryClasses: ['synthetic-auxin'] }],
        conditions: { tempF: 70, windMph: 5, rainForecastMmNext24h: 0 },
        rulesVersion: 'rv-test',
        pluginHashes: {}
      } as never).id;
    }
    return { ownerId, cuttingId: cutting.id, sprayIds };
  });
}

function event(ownerId: string, path: string, params: Record<string, string> = {}) {
  return {
    params,
    url: new URL(`http://localhost${path}`),
    request: new Request(`http://localhost${path}`),
    locals: {
      locale: 'en',
      authVia: 'cookie',
      user: {
        id: USER,
        email: `${USER}@test.local`,
        phone: null,
        role: 'owner',
        activeOwnerId: ownerId,
        isSuperadmin: false,
        impersonating: false
      }
    },
    cookies: { get: () => undefined }
  } as never;
}

describe('/records/[kind]/[id]', () => {
  it('opens a hay cutting from the ledger', async () => {
    const { ownerId, cuttingId } = seed();
    const data = (await runWithTenantAsync(ownerId, async () =>
      DETAIL(event(ownerId, `/records/hay/${cuttingId}`, { kind: 'hay', id: cuttingId }))
    )) as unknown as { detail: Record<string, unknown>; occurredAt: number };
    expect(data.detail.blockLabel).toBe('Hay block');
    expect(data.detail.cuttingNumber).toBe(1);
    expect(data.occurredAt).toBeGreaterThan(0);
  });

  it('answers 404 for a hay id that is not on file', async () => {
    const { ownerId } = seed();
    await expect(
      runWithTenantAsync(ownerId, async () =>
        DETAIL(event(ownerId, '/records/hay/nope', { kind: 'hay', id: 'nope' }))
      )
    ).rejects.toMatchObject({ status: 404 });
  });

  it('does not open another farm’s hay cutting', async () => {
    const a = seed();
    const b = seed();
    await expect(
      runWithTenantAsync(b.ownerId, async () =>
        DETAIL(event(b.ownerId, `/records/hay/${a.cuttingId}`, { kind: 'hay', id: a.cuttingId }))
      )
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('/records sprayer filter', () => {
  it('keeps the ledger to the picked sprayer’s records', async () => {
    const { ownerId, sprayIds } = seed();
    const sprayerId = `sprayer-Boom-${ownerId.slice(-6)}`;
    const data = (await runWithTenantAsync(ownerId, async () =>
      LEDGER(event(ownerId, `/records?sprayerId=${sprayerId}`))
    )) as unknown as { records: Array<{ kind: string; rowId: string }> };
    expect(data.records.map((r) => `${r.kind}:${r.rowId}`)).toEqual([`spray:${sprayIds.Boom}`]);

    const all = (await runWithTenantAsync(ownerId, async () =>
      LEDGER(event(ownerId, '/records'))
    )) as unknown as { records: Array<{ kind: string }> };
    expect(all.records.filter((r) => r.kind === 'spray')).toHaveLength(2);
    expect(all.records.some((r) => r.kind === 'hay')).toBe(true);
  });
});
