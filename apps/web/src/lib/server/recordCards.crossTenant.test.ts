/**
 * Phase 30G: a /records row's Card is built only from the active Owner's
 * rows. Another Owner's record id finds nothing (404), and a card never
 * names another Owner's ids.
 */

import { randomUUID } from 'node:crypto';
import type { RequestEvent } from '@sveltejs/kit';
import { describe, expect, it } from 'vitest';
import { runWithTenant, runWithTenantAsync, tenantValues } from '$lib/db/tenant';
import { db } from '$lib/db/client';
import { crops, equipment, equipmentLog, equipmentState, owners, users } from '$lib/db/schema';
import { createField } from '$lib/db/fields';
import { createBlock } from '$lib/db/blocks';
import { insertSprayEvent } from '$lib/db/sprayEvents';
import { insertScoutObservation } from '$lib/db/scoutObservations';
import { insertHarvestEvent } from '$lib/db/harvestEvents';
import { RECORD_KINDS, type RecordKind } from '$lib/db/recordKinds';
import { parseRecordCardKey } from '$lib/cards/model';
import { SPRAY_REFERENCE_NOTICE } from '$lib/cards/build/spray';
import { DEFAULT_PREFS } from '$lib/prefs';
import { buildRecordCards, isRecordKind } from './recordCards';
import { GET } from '../../routes/api/records/[kind]/[id]/card/+server';

const DAY = 86_400_000;

interface Seeded {
  ownerId: string;
  userId: string;
  records: Array<[RecordKind, string]>;
  ids: string[];
}

function seed(ownerId: string, now: number): Seeded {
  db.insert(owners)
    .values({
      id: ownerId,
      name: `Farm ${ownerId}`,
      slug: ownerId.replace(/[^a-z0-9-]/g, '-'),
      billingStatus: 'active'
    })
    .onConflictDoNothing()
    .run();
  const userId = `user-${ownerId}`;
  db.insert(users)
    .values({ id: userId, email: `${userId}@test.local` })
    .onConflictDoNothing()
    .run();
  return runWithTenant(ownerId, () => {
    const tag = randomUUID().slice(0, 6);
    const field = createField({ name: `${ownerId}-field-${tag}` });
    const block = createBlock({ name: `${ownerId}-block-${tag}`, fieldId: field.id, acres: 1 });
    const oldCrop = `crop-old-${ownerId}-${tag}`;
    db.insert(crops)
      .values(
        tenantValues({
          id: oldCrop,
          blockId: block.id,
          cropPluginId: 'tomato-cherokee-purple',
          varietyDisplayName: `${ownerId} old tomato`,
          plantingDate: new Date(now - 400 * DAY),
          harvestedAt: new Date(now - 300 * DAY),
          status: 'harvested' as const
        })
      )
      .run();
    const sprayerId = `sprayer-${ownerId}-${tag}`;
    db.insert(equipment)
      .values(tenantValues({ id: sprayerId, type: 'sprayer' as const, label: `${ownerId} boom` }))
      .run();
    db.insert(equipmentState)
      .values(tenantValues({ equipmentId: sprayerId, calibratedGpa: 20 }))
      .run();
    const spray = insertSprayEvent({
      blockId: block.id,
      sprayerId,
      performedById: userId,
      occurredAt: now - 5 * DAY,
      products: [
        {
          pluginId: '24d',
          chemistryClasses: ['synthetic-auxin'],
          rate: { amount: 16, unit: 'fl-oz' }
        }
      ],
      conditions: {
        tempF: 70,
        windMph: 5,
        rainForecastMmNext24h: 0,
        conditionsProvenance: 'measured'
      },
      rulesVersion: 'rules-at-record-time',
      pluginHashes: { '24d': 'abc' }
    });
    const scout = insertScoutObservation({
      blockId: block.id,
      performedById: userId,
      pest: `${ownerId} hornworm`,
      metric: 'per_plant',
      value: 3,
      notes: 'north row',
      occurredAt: now - DAY
    });
    const harvest = insertHarvestEvent({
      blockId: block.id,
      cropPluginId: 'tomato-cherokee-purple',
      occurredAt: now - 300 * DAY,
      quantity: '20 lb'
    });
    const deconId = `decon-${ownerId}-${tag}`;
    db.insert(equipmentLog)
      .values(
        tenantValues({
          id: deconId,
          equipmentId: sprayerId,
          occurredAt: new Date(now - 2 * DAY),
          kind: 'decon' as const,
          performedById: userId
        })
      )
      .run();
    return {
      ownerId,
      userId,
      records: [
        ['spray', spray.id],
        ['scout', scout.id],
        ['harvest', harvest.id],
        ['planting', oldCrop],
        ['decon', deconId]
      ],
      ids: [field.id, block.id, oldCrop, sprayerId, spray.id, scout.id, harvest.id, deconId]
    };
  });
}

function eventFor(s: Seeded, kind: string, id: string, role: 'owner' | 'helper' = 'owner') {
  return {
    params: { kind, id },
    locals: {
      user: {
        id: s.userId,
        email: null,
        phone: null,
        role,
        activeOwnerId: s.ownerId,
        isSuperadmin: false,
        impersonating: false
      }
    },
    request: new Request(`http://localhost/api/records/${kind}/${id}/card`),
    cookies: { get: () => undefined }
  } as unknown as RequestEvent;
}

const opts = { prefs: DEFAULT_PREFS };

describe('record cards cross-tenant isolation', () => {
  const now = Date.now();
  const x = seed(`rec-cards-x-${randomUUID().slice(0, 6)}`, now);
  const y = seed(`rec-cards-y-${randomUUID().slice(0, 6)}`, now);

  it('every record kind is a record kind, and nothing else is', () => {
    for (const k of RECORD_KINDS) expect(isRecordKind(k)).toBe(true);
    expect(isRecordKind('nope')).toBe(false);
  });

  it("each Owner's records build cards that name none of the other Owner's rows", async () => {
    for (const [self, other] of [
      [x, y],
      [y, x]
    ] as const) {
      for (const [kind, id] of self.records) {
        const result = await runWithTenantAsync(self.ownerId, () =>
          buildRecordCards(kind, id, { ...opts, now })
        );
        expect(result, `${kind} ${id}`).not.toBeNull();
        expect(result!.cards.length, kind).toBeGreaterThan(0);
        const text = JSON.stringify(result);
        for (const foreign of other.ids)
          expect(text, `${kind} names ${foreign}`).not.toContain(foreign);
        expect(text).not.toContain(other.ownerId);
      }
    }
  });

  it("another Owner's record ids find nothing", async () => {
    for (const [kind, id] of y.records) {
      const result = await runWithTenantAsync(x.ownerId, () => buildRecordCards(kind, id, opts));
      expect(result, `${kind} ${id}`).toBeNull();
    }
  });

  it('a spray record card is the saved record, stamped with its own rules version', async () => {
    const [, sprayId] = x.records[0];
    const result = await runWithTenantAsync(x.ownerId, () =>
      buildRecordCards('spray', sprayId, opts)
    );
    const card = result!.cards[0];
    expect(card.kind).toBe('spray');
    expect(card.rulesVersion).toBe('rules-at-record-time');
    expect(card.notices).toContain(SPRAY_REFERENCE_NOTICE);
    expect(card.next).toBeUndefined();
    expect(parseRecordCardKey(card.key)).toEqual({ recordKind: 'spray', rowId: sprayId });
    expect(card.facts.find((f) => f.label === 'Recorded by')?.value).toBe(`${x.userId}@test.local`);
  });

  it('a harvest with no crop id shows the old planting it came from', async () => {
    const [, harvestId] = x.records[2];
    const result = await runWithTenantAsync(x.ownerId, () =>
      buildRecordCards('harvest', harvestId, opts)
    );
    const card = result!.cards[0];
    expect(card.kind).toBe('planting');
    expect(card.key).toBe(`pl_${x.ids[2]}`);
    expect(card.links?.at(-1)?.href).toBe(`/records/harvest/${harvestId}`);
  });

  it('GET answers owner and helper alike, and 404s a foreign or unknown record', async () => {
    const [, scoutId] = x.records[1];
    for (const role of ['owner', 'helper'] as const) {
      const res = await runWithTenantAsync(x.ownerId, async () =>
        GET(eventFor(x, 'scout', scoutId, role) as Parameters<typeof GET>[0])
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { cards: Array<{ kind: string; title: string }> };
      expect(body.cards[0]).toMatchObject({ kind: 'scout', title: `${x.ownerId} hornworm` });
    }
    const [, foreignScout] = y.records[1];
    await expect(
      runWithTenantAsync(x.ownerId, async () =>
        GET(eventFor(x, 'scout', foreignScout) as Parameters<typeof GET>[0])
      )
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      runWithTenantAsync(x.ownerId, async () =>
        GET(eventFor(x, 'nope', scoutId) as Parameters<typeof GET>[0])
      )
    ).rejects.toMatchObject({ status: 404 });
  });
});
