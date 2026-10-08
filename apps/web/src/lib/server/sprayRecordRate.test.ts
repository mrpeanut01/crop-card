// @vitest-environment node
/**
 * Ruling LF-2 (#737 follow-up): the spray record stores the low end of a
 * label rate range (Banvel corn ½ pt), never a rate the client sends, so no
 * rate above the range's top can be saved; marking a custom rate is owner
 * only (Invariant 5).
 */
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ ownerId: '', role: 'owner' as 'owner' | 'helper' }));

vi.mock('$lib/server/auth', () => {
  const user = () => ({
    id: 'lf2-rate-user',
    email: 'lf2-rate@example.test',
    phone: null,
    role: m.role,
    activeOwnerId: m.ownerId,
    isSuperadmin: false
  });
  return { currentUser: user, requireUser: user };
});

import { db } from '$lib/db/client';
import { owners, users } from '$lib/db/schema';
import { runWithTenant, runWithTenantAsync } from '$lib/db/tenant';
import { createEquipment } from '$lib/db/equipment';
import { createField } from '$lib/db/fields';
import { createBlock } from '$lib/db/blocks';
import { getSprayEvent } from '$lib/db/sprayEvents';
import { POST } from '../../routes/api/spray/record/+server';
import { POST as EVALUATE } from '../../routes/api/spray/evaluate/+server';

db.insert(users)
  .values({ id: 'lf2-rate-user', email: 'lf2-rate@example.test' })
  .onConflictDoNothing()
  .run();

function seedFarm() {
  const ownerId = `lf2-rate-${randomUUID()}`;
  db.insert(owners)
    .values({ id: ownerId, name: ownerId, slug: ownerId, billingStatus: 'active' })
    .run();
  return runWithTenant(ownerId, () => {
    const field = createField({ name: 'Field', kind: 'field', acres: 5 });
    const block = createBlock({ name: 'Corn block', fieldId: field.id, acres: 5 });
    const sprayer = createEquipment({ type: 'sprayer', label: 'Boom' });
    return { ownerId, blockId: block.id, sprayerId: sprayer.id };
  });
}

async function record(
  farm: ReturnType<typeof seedFarm>,
  extra: Record<string, unknown>,
  handler: unknown = POST
) {
  m.ownerId = farm.ownerId;
  const url = new URL('http://localhost/api/spray/record');
  const body = {
    blockId: farm.blockId,
    blockCrops: { primary: { cropPluginId: 'corn-feed-dent-pioneer' } },
    productPluginIds: ['banvel'],
    sprayer: { id: farm.sprayerId },
    conditions: { windMph: 4, tempF: 68, rainForecastMmNext24h: 0 },
    ...extra
  };
  return runWithTenantAsync(farm.ownerId, async () => {
    const res = await (handler as (e: never) => Promise<Response>)({
      params: {},
      url,
      request: new Request(url.href, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      }),
      locals: {}
    } as never);
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  });
}

function storedRate(farm: ReturnType<typeof seedFarm>, id: unknown) {
  return runWithTenant(farm.ownerId, () => getSprayEvent(String(id)))?.products[0]?.rate;
}

describe('Banvel mix rate on the spray record (ruling LF-2)', () => {
  it('stores the low end of the corn range', async () => {
    m.role = 'owner';
    const farm = seedFarm();
    const res = await record(farm, {});
    expect(res.status).toBe(200);
    expect(storedRate(farm, (res.body.event as { id: string }).id)).toEqual({
      amount: 0.5,
      unit: 'pt'
    });
  });

  it("never stores a rate the client sends, even above the range's top", async () => {
    m.role = 'owner';
    const farm = seedFarm();
    const res = await record(farm, {
      customRateOverride: true,
      customRatePerAcre: { amount: 99, unit: 'pt' },
      products: [{ pluginId: 'banvel', rate: { amount: 99, unit: 'pt' } }]
    });
    expect(res.status).toBe(200);
    expect(storedRate(farm, (res.body.event as { id: string }).id)).toEqual({
      amount: 0.5,
      unit: 'pt'
    });
  });

  it('a helper cannot mark a custom rate', async () => {
    m.role = 'helper';
    const farm = seedFarm();
    const res = await record(farm, { customRateOverride: true });
    expect(res.status).toBe(403);
  });

  it('a helper records at the label low end', async () => {
    m.role = 'helper';
    const farm = seedFarm();
    const res = await record(farm, {});
    expect(res.status).toBe(200);
    expect(storedRate(farm, (res.body.event as { id: string }).id)).toEqual({
      amount: 0.5,
      unit: 'pt'
    });
  });
});

describe('/api/spray/evaluate (ruling LF-2)', () => {
  it('sends the earlier-registration label with the Banvel corn rows', async () => {
    m.role = 'helper';
    const farm = seedFarm();
    const res = await record(farm, { tankSizeGallons: 25 }, EVALUATE);
    expect(res.status).toBe(200);
    expect(res.body.cropLabel).toEqual([
      expect.objectContaining({
        pluginId: 'banvel',
        earlierLabels: [{ registration: '66330-276', year: '2009' }]
      })
    ]);
    const [line] = res.body.dilutions as Array<{ display: string }>;
    expect(line).toBeDefined();
  });
});
