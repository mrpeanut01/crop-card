// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { db } from '$lib/db/client';
import { owners, users } from '$lib/db/schema';
import { runWithTenant, runWithTenantAsync } from '$lib/db/tenant';
import { createField } from '$lib/db/fields';
import { createBlock } from '$lib/db/blocks';
import { createPlanned } from '$lib/db/crops';
import { getHarvestEvent } from '$lib/db/harvestEvents';
import { POST } from './+server';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

db.insert(users)
  .values({ id: 'hdet-owner', email: 'hdet-owner@test.local' })
  .onConflictDoNothing()
  .run();

async function post(ownerId: string, body: unknown): Promise<{ status: number; body: Json }> {
  const url = new URL('http://localhost/api/harvest/record');
  return runWithTenantAsync(ownerId, async () => {
    const res = await (POST as (e: never) => Promise<Response>)({
      params: {},
      url,
      request: new Request(url.href, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      }),
      locals: {
        authVia: 'cookie',
        user: {
          id: 'hdet-owner',
          email: null,
          phone: null,
          role: 'owner',
          activeOwnerId: ownerId,
          isSuperadmin: false,
          impersonating: false
        }
      },
      cookies: { get: () => undefined }
    } as never);
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : {} };
  });
}

function seed() {
  const ownerId = `hdet-${randomUUID()}`;
  db.insert(owners)
    .values({ id: ownerId, name: ownerId, slug: ownerId, billingStatus: 'active' })
    .run();
  return runWithTenant(ownerId, () => {
    const field = createField({ name: 'Garden', kind: 'garden' });
    const block = createBlock({ name: 'Bed 5', fieldId: field.id, acres: 0.01 });
    const crop = createPlanned({
      blockId: block.id,
      cropPluginId: 'tomato-amish-paste',
      varietyDisplayName: 'Amish Paste'
    });
    return { ownerId, blockId: block.id, cropId: crop.id };
  });
}

describe('POST /api/harvest/record details (#662, #718)', () => {
  it('stores the pick number and grade apart from an empty lot number, with the planting', async () => {
    const farm = seed();
    const res = await post(farm.ownerId, {
      blockId: farm.blockId,
      cropId: farm.cropId,
      cropPluginId: 'tomato-amish-paste',
      quantity: '6.5 lb',
      details: { pickNumber: 3, marketablePct: 92 }
    });
    expect(res.status).toBe(200);
    const saved = runWithTenant(farm.ownerId, () => getHarvestEvent(res.body.event.id))!;
    expect(saved.lotNumber).toBeUndefined();
    expect(saved.cropId).toBe(farm.cropId);
    expect(saved.details).toEqual({ pickNumber: 3, marketablePct: 92 });
  });

  it('keeps a grower lot code exactly as typed', async () => {
    const farm = seed();
    const res = await post(farm.ownerId, {
      blockId: farm.blockId,
      cropPluginId: 'tomato-amish-paste',
      lotNumber: 'WR-270725-TOM',
      details: { brix: 17.5, ph: 3.3, taGPerL: 7.2 }
    });
    expect(res.status).toBe(200);
    const saved = runWithTenant(farm.ownerId, () => getHarvestEvent(res.body.event.id))!;
    expect(saved.lotNumber).toBe('WR-270725-TOM');
    expect(saved.details).toEqual({ brix: 17.5, ph: 3.3, taGPerL: 7.2 });
  });

  it('refuses unknown or out-of-range details', async () => {
    const farm = seed();
    const base = { blockId: farm.blockId, cropPluginId: 'tomato-amish-paste' };
    expect((await post(farm.ownerId, { ...base, details: { lot: 'x' } })).status).toBe(400);
    expect((await post(farm.ownerId, { ...base, details: { ph: 15 } })).status).toBe(400);
    expect((await post(farm.ownerId, { ...base, details: { pickNumber: 0 } })).status).toBe(400);
  });
});
