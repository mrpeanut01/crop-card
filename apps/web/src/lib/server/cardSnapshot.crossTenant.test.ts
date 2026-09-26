/**
 * Phase 30F: cross-tenant isolation for the offline Card snapshot, in the
 * style of `exports.crossTenant.test.ts`. Two Owners get the same kinds of
 * rows; each Owner's snapshot (and the GET handler's bytes) must name only
 * its own ids, and a helper reads the same bundle an owner does.
 */

import { randomUUID } from 'node:crypto';
import type { RequestEvent } from '@sveltejs/kit';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { runWithTenant, runWithTenantAsync, tenantValues } from '$lib/db/tenant';
import { db } from '$lib/db/client';
import { crops, equipment, equipmentState, owners } from '$lib/db/schema';
import { createField } from '$lib/db/fields';
import { createBlock } from '$lib/db/blocks';
import { createTask } from '$lib/db/tasks';
import { createMapFeature } from '$lib/db/mapFeatures';
import { createStockItem, receiveLot } from '$lib/db/stock';
import { buildDeck } from '$lib/cards/build';
import type { FarmSnapshot } from '$lib/cards/snapshot';
import { buildFarmSnapshot, etagMatches, snapshotEtag } from './cardSnapshot';
import { GET } from '../../routes/api/cards/snapshot/+server';

const DAY = 86_400_000;

interface Seeded {
  ownerId: string;
  ids: string[];
}

function ensureOwner(ownerId: string): void {
  db.insert(owners)
    .values({
      id: ownerId,
      name: `Farm ${ownerId}`,
      slug: ownerId.replace(/[^a-z0-9-]/g, '-'),
      billingStatus: 'active'
    })
    .onConflictDoNothing()
    .run();
}

function seedOwner(ownerId: string, now: number, extraPlantings = 0): Seeded {
  ensureOwner(ownerId);
  return runWithTenant(ownerId, () => {
    const tag = randomUUID().slice(0, 6);
    const field = createField({ name: `${ownerId}-garden-${tag}`, kind: 'garden' });
    const block = createBlock({ name: `${ownerId}-bed-${tag}`, fieldId: field.id, acres: 0.01 });
    const ids = [field.id, block.id];
    for (let i = 0; i <= extraPlantings; i++) {
      const cropId = `crop-${ownerId}-${tag}-${i}`;
      db.insert(crops)
        .values(
          tenantValues({
            id: cropId,
            blockId: block.id,
            cropPluginId: 'tomato-cherokee-purple',
            varietyDisplayName: `${ownerId} tomato ${i}`,
            plantingDate: new Date(now - 20 * DAY),
            status: i % 2 === 0 ? ('active' as const) : ('planned' as const),
            spacingIn: 24,
            plantCount: 6,
            plantCountProvenance: 'data' as const
          })
        )
        .run();
      ids.push(cropId);
    }
    const sprayerId = `sprayer-${ownerId}-${tag}`;
    db.insert(equipment)
      .values(
        tenantValues({
          id: sprayerId,
          type: 'sprayer' as const,
          label: `${ownerId} boom ${tag}`,
          specJson: JSON.stringify({ tankGal: 50 })
        })
      )
      .run();
    db.insert(equipmentState)
      .values(tenantValues({ equipmentId: sprayerId, calibratedGpa: 20 }))
      .run();
    ids.push(sprayerId);
    const task = createTask({
      title: `${ownerId} stake ${tag}`,
      kind: 'primary',
      cropId: ids[2],
      scheduledFor: now + 2 * DAY
    });
    ids.push(task.id);
    const item = createStockItem({
      category: 'herbicide',
      displayName: `${ownerId} 2,4-D ${tag}`,
      defaultUnit: 'gal',
      pluginId: '24d'
    });
    receiveLot({ stockItemId: item.id, receivedQuantity: 2, unit: 'gal' });
    ids.push(item.id);
    const well = createMapFeature({
      kind: 'water_source',
      name: `${ownerId} well ${tag}`,
      geometry: { type: 'Point', coordinates: [-77.55, 39.1] },
      fieldId: field.id,
      details: { source: 'well' }
    });
    ids.push(well.id);
    return { ownerId, ids };
  });
}

function mentions(snapshot: FarmSnapshot, id: string): boolean {
  return JSON.stringify(snapshot).includes(id);
}

function eventFor(ownerId: string, role: 'owner' | 'helper', headers: HeadersInit = {}) {
  return {
    locals: {
      user: {
        id: `user-${ownerId}-${role}`,
        email: null,
        phone: null,
        role,
        activeOwnerId: ownerId,
        isSuperadmin: false,
        impersonating: false
      }
    },
    request: new Request('http://localhost/api/cards/snapshot', { headers }),
    cookies: { get: () => undefined }
  } as unknown as RequestEvent;
}

describe('card snapshot cross-tenant isolation', () => {
  const now = Date.now();
  const x = seedOwner(`cards-owner-x-${randomUUID().slice(0, 6)}`, now);
  const y = seedOwner(`cards-owner-y-${randomUUID().slice(0, 6)}`, now);

  it("each Owner's snapshot holds its own rows and none of the other's", async () => {
    for (const [self, other] of [
      [x, y],
      [y, x]
    ] as const) {
      const snap = await runWithTenantAsync(self.ownerId, () => buildFarmSnapshot({ now }));
      expect(snap.ownerId).toBe(self.ownerId);
      expect(snap.farmName).toBe(`Farm ${self.ownerId}`);
      for (const id of self.ids) expect(mentions(snap, id), id).toBe(true);
      for (const id of other.ids) expect(mentions(snap, id), id).toBe(false);
      expect(mentions(snap, other.ownerId)).toBe(false);
    }
  });

  it('carries the stocked pesticide, the referenced crop plugin and the sprayer tank', async () => {
    const snap = await runWithTenantAsync(x.ownerId, () => buildFarmSnapshot({ now }));
    expect(snap.sprayProducts?.['24d']?.mixSteps.length).toBeGreaterThan(0);
    expect(snap.cropPlugins['tomato-cherokee-purple']?.pluginId).toBe('tomato-cherokee-purple');
    expect(snap.equipment.find((e) => e.id === x.ids[3])?.tankGal).toBe(50);
    expect(snap.plantings.find((p) => p.id === x.ids[2])).toMatchObject({
      spacingIn: 24,
      plantCount: 6,
      plantCountProvenance: 'data'
    });
    const deck = buildDeck(snap, { now });
    expect(deck.some((c) => c.key === `sp_${x.ids[3]}~24d`)).toBe(true);
    for (const card of deck) {
      for (const id of y.ids) expect(JSON.stringify(card)).not.toContain(id);
    }
  });

  it('property: any number of plantings on either farm never crosses over', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 4 }),
        fc.integer({ min: 0, max: 4 }),
        async (a, b) => {
          const p = seedOwner(`cards-prop-p-${randomUUID().slice(0, 6)}`, now, a);
          const q = seedOwner(`cards-prop-q-${randomUUID().slice(0, 6)}`, now, b);
          const sp = await runWithTenantAsync(p.ownerId, () => buildFarmSnapshot({ now }));
          const sq = await runWithTenantAsync(q.ownerId, () => buildFarmSnapshot({ now }));
          expect(sp.plantings).toHaveLength(a + 1);
          expect(sq.plantings).toHaveLength(b + 1);
          for (const id of q.ids) expect(mentions(sp, id)).toBe(false);
          for (const id of p.ids) expect(mentions(sq, id)).toBe(false);
        }
      ),
      { numRuns: 8 }
    );
  });

  it('the ETag ignores the build time and changes when the farm changes', async () => {
    const a = await runWithTenantAsync(x.ownerId, () => buildFarmSnapshot({ now }));
    const b = await runWithTenantAsync(x.ownerId, () => buildFarmSnapshot({ now: now + 1 }));
    const other = await runWithTenantAsync(y.ownerId, () => buildFarmSnapshot({ now }));
    expect(snapshotEtag(a)).toBe(snapshotEtag(b));
    expect(snapshotEtag(a)).not.toBe(snapshotEtag(other));
    expect(etagMatches(snapshotEtag(a), snapshotEtag(a))).toBe(true);
    expect(etagMatches(`"x", ${snapshotEtag(a).slice(2)}`, snapshotEtag(a))).toBe(true);
    expect(etagMatches('"nope"', snapshotEtag(a))).toBe(false);
    expect(etagMatches(null, snapshotEtag(a))).toBe(false);
  });

  it('GET answers 200 with an ETag, then 304 to a matching If-None-Match, for owner and helper', async () => {
    const first = await runWithTenantAsync(x.ownerId, async () =>
      GET(eventFor(x.ownerId, 'owner') as Parameters<typeof GET>[0])
    );
    expect(first.status).toBe(200);
    const etag = first.headers.get('etag')!;
    expect(etag).toMatch(/^W\/"/);
    const body = (await first.json()) as FarmSnapshot;
    expect(body.ownerId).toBe(x.ownerId);
    for (const id of y.ids) expect(mentions(body, id)).toBe(false);

    const again = await runWithTenantAsync(x.ownerId, async () =>
      GET(eventFor(x.ownerId, 'helper', { 'if-none-match': etag }) as Parameters<typeof GET>[0])
    );
    expect(again.status).toBe(304);
    expect(await again.text()).toBe('');

    const crossed = await runWithTenantAsync(y.ownerId, async () =>
      GET(eventFor(y.ownerId, 'helper', { 'if-none-match': etag }) as Parameters<typeof GET>[0])
    );
    expect(crossed.status).toBe(200);
    expect(((await crossed.json()) as FarmSnapshot).ownerId).toBe(y.ownerId);
  });
});
