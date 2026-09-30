/**
 * 32D: the animal part of the offline Card snapshot. Holds come from the
 * same projection the C-35 guard compares (D1-01), the state key moves with
 * every hold fact (D0-9), a crop-only farm pays nothing, and a large herd
 * stays inside the snapshot budget.
 */

import { randomUUID } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { db } from '$lib/db/client';
import { animalCarePlans, owners } from '$lib/db/schema';
import { runWithTenant, runWithTenantAsync, tenantValues } from '$lib/db/tenant';
import { createBlock } from '$lib/db/blocks';
import { createField } from '$lib/db/fields';
import { insertAnimalGroup } from '$lib/db/animalGroups';
import { insertAnimal } from '$lib/db/animals';
import { insertStay } from '$lib/db/animalLocations';
import { insertHealthEvent } from '$lib/db/animalHealth';
import { insertProductionLog } from '$lib/db/animalProduction';
import { insertGrazingAttestation } from '$lib/db/grazingAttestations';
import { buildDeck } from '$lib/cards/build';
import type { HoldProjection } from '$lib/safety/holdLedger';
import {
  SNAPSHOT_HOLD_HORIZON_MS,
  buildFarmSnapshot,
  snapshotHolds,
  snapshotStateKey,
  snapshotWindowTime
} from './cardSnapshot';
import { DAY, UNKNOWN_HERBICIDE_ID, seedFarm, seedOwner, spray } from './holdGuard.fixtures';

const inFarm = <T>(ownerId: string, fn: () => Promise<T>) => runWithTenantAsync(ownerId, fn);

function wormer(subjectType: 'animal' | 'group', subjectId: string, atMs: number) {
  return insertHealthEvent({
    subjectType,
    subjectId,
    kind: 'deworm',
    productName: 'Unlabelled wormer',
    administeredAt: atMs,
    withdrawalClear: null,
    rulesVersion: 'test',
    foodProducingAtRecord: true,
    performedById: null,
    createdAt: atMs
  });
}

describe('snapshotHolds', () => {
  const projection: HoldProjection = {
    holds: new Map([
      [
        'group:g1|eggs',
        [
          { fromMs: 0, toMs: 50, basis: 'known' },
          { fromMs: 50, toMs: 200, basis: 'known' }
        ]
      ],
      ['animal:a1|preSlaughter', [{ fromMs: 10, toMs: Infinity, basis: 'unknown' }]],
      ['animal:a2|meat', [{ fromMs: 10, toMs: Infinity, basis: 'prohibited' }]],
      ['animal:gone|milk', [{ fromMs: 10, toMs: 500, basis: 'known' }]],
      ['area:f1|graze', [{ fromMs: 0, toMs: 300, basis: 'known' }]],
      ['area:f1|hay', [{ fromMs: 0, toMs: Infinity, basis: 'unknown' }]],
      ['block:b1|graze', [{ fromMs: 0, toMs: 300, basis: 'known' }]]
    ]),
    covered: new Map()
  };
  const subjects = new Set(['group:g1', 'animal:a1', 'animal:a2']);

  it('keeps open spans only, maps pre-slaughter to meat and drops subjects not shown', () => {
    const out = snapshotHolds(projection, 100, subjects);
    expect(out.animalHolds).toEqual([
      { subject: 'animal:a1', food: 'meat', fromMs: 10, clearMs: null, status: 'unknown' },
      { subject: 'animal:a2', food: 'meat', fromMs: 10, clearMs: null, status: 'prohibited' },
      { subject: 'group:g1', food: 'eggs', fromMs: 50, clearMs: 200, status: 'held' }
    ]);
    expect(out.areaHolds).toEqual([
      { areaId: 'f1', kind: 'graze', fromMs: 0, clearMs: 300, status: 'held' },
      { areaId: 'f1', kind: 'hay', fromMs: 0, clearMs: null, status: 'unknown' }
    ]);
  });

  it('keeps a hold that never ends at any age', () => {
    const out = snapshotHolds(projection, 1e15, subjects);
    expect(out.animalHolds.map((h) => h.status)).toEqual(['unknown', 'prohibited']);
    expect(out.areaHolds.map((h) => h.kind)).toEqual(['hay']);
  });
});

describe('animal snapshot from the kernel', () => {
  it('a crop-only farm gets no animal keys at all', async () => {
    const ownerId = seedOwner('snap-crop');
    runWithTenant(ownerId, () => createBlock({ name: 'Bed 1' }));
    const snap = await inFarm(ownerId, () => buildFarmSnapshot());
    for (const k of ['animals', 'animalGroups', 'animalHolds', 'areaHolds', 'carePlans'] as const) {
      expect(k in snap).toBe(false);
    }
    expect(snap.version).toBe(3);
  });

  it('ships the flock, its species and the holds the guard would compare', async () => {
    const ownerId = seedOwner('snap-hold');
    const farm = runWithTenant(ownerId, () => seedFarm(Date.now() - 60 * DAY));
    const now = Date.now();
    const clean = await inFarm(ownerId, () => buildFarmSnapshot({ now }));
    expect(clean.animalGroups).toEqual([
      expect.objectContaining({ id: farm.groupId, total: 7, namedCount: 1, foodProducing: true })
    ]);
    expect(clean.animals?.[0]).toMatchObject({ id: farm.henId, housingFieldId: farm.barnId });
    expect(clean.species?.chicken).toMatchObject({ groupNoun: 'flock', label: 'Chickens' });
    expect(clean.animalHolds).toEqual([]);
    expect(clean.holdTimeZone).toBeTruthy();
    expect(clean.holdsProjectedTo).toBe(snapshotWindowTime(now) + SNAPSHOT_HOLD_HORIZON_MS);

    runWithTenant(ownerId, () => {
      wormer('group', farm.groupId, now - 2 * DAY);
      spray(farm, now - DAY, UNKNOWN_HERBICIDE_ID);
    });
    const held = await inFarm(ownerId, () => buildFarmSnapshot({ now }));
    expect(held.animalHolds).toContainEqual(
      expect.objectContaining({ subject: `group:${farm.groupId}`, food: 'eggs', status: 'unknown' })
    );
    expect(held.areaHolds).toContainEqual(
      expect.objectContaining({ areaId: farm.pastureId, kind: 'graze', status: 'unknown' })
    );
    expect(held.treatments?.[0]?.productName).toBe('Unlabelled wormer');

    const deck = buildDeck(held, { now });
    const flock = deck.find((c) => c.key === `fl_${farm.groupId}`)!;
    expect(flock.notices).toContain(
      'HOLD eggs: end date not known. The owner can add the label or vet time when online.'
    );
    const pasture = deck.find((c) => c.key === `ar_${farm.pastureId}`)!;
    expect(pasture.sections.find((s) => s.title === 'Grazing')?.safety).toBe(true);
  });

  it('carries care plans with undated ones last', async () => {
    const ownerId = seedOwner('snap-care');
    const farm = runWithTenant(ownerId, () => seedFarm(Date.now() - 10 * DAY));
    runWithTenant(ownerId, () => {
      for (const [id, due] of [
        ['p-late', Date.now() + 20 * DAY],
        ['p-none', null],
        ['p-soon', Date.now() + 2 * DAY]
      ] as const) {
        db.insert(animalCarePlans)
          .values(
            tenantValues({
              id: `${ownerId}-${id}`,
              subjectType: 'group' as const,
              subjectId: farm.groupId,
              kind: 'deworm' as const,
              title: id,
              intervalDays: 90,
              nextDueAt: due === null ? null : new Date(due),
              provenance: 'manual' as const
            })
          )
          .run();
      }
      db.insert(animalCarePlans)
        .values(
          tenantValues({
            id: `${ownerId}-off`,
            subjectType: 'group' as const,
            subjectId: farm.groupId,
            kind: 'deworm' as const,
            title: 'off',
            nextDueAt: new Date(),
            active: false,
            provenance: 'manual' as const
          })
        )
        .run();
    });
    const snap = await inFarm(ownerId, () => buildFarmSnapshot());
    expect(snap.carePlans?.map((p) => p.title)).toEqual(['p-soon', 'p-late', 'p-none']);
  });
});

describe('snapshotStateKey (D0-9)', () => {
  it('moves when a treatment, move, production log or attestation is written', async () => {
    const ownerId = seedOwner('snap-key');
    const farm = runWithTenant(ownerId, () => seedFarm(Date.now() - 30 * DAY));
    const now = Date.now();
    const key = () => inFarm(ownerId, () => snapshotStateKey({ now, origin: null }));
    const writes: [string, () => unknown][] = [
      ['treatment', () => wormer('animal', farm.henId, now - DAY)],
      [
        'move',
        () =>
          insertStay({
            subject: { subjectType: 'animal', subjectId: farm.henId },
            fieldId: farm.pastureId,
            atMs: now - 1000,
            movedBy: null
          })
      ],
      [
        'production',
        () =>
          insertProductionLog({
            subjectType: 'group',
            subjectId: farm.groupId,
            kind: 'eggs',
            quantity: 5,
            unit: 'eggs',
            occurredAt: now - 1000,
            use: 'discard',
            rulesVersion: 'test',
            performedById: null
          })
      ],
      [
        'attestation',
        () => {
          const s = spray(farm, now - DAY, UNKNOWN_HERBICIDE_ID);
          return insertGrazingAttestation({
            fieldId: farm.pastureId,
            sprayEventRef: `spray:${s.id}`,
            productPluginId: UNKNOWN_HERBICIDE_ID,
            grazeDays: 30,
            hayDays: 30,
            reason: 'label',
            attestedBy: null
          });
        }
      ]
    ];
    for (const [name, write] of writes) {
      const before = await key();
      runWithTenant(ownerId, write);
      expect(await key(), name).not.toBe(before);
    }
  });
});

describe('snapshot size budget (D0-9)', () => {
  it('500 animals in 20 flocks with 2,000 treatments gzips under 256 KB', async () => {
    const ownerId = `snap-size-${randomUUID()}`;
    db.insert(owners)
      .values({ id: ownerId, name: ownerId, slug: ownerId, billingStatus: 'active' })
      .run();
    const now = Date.now();
    runWithTenant(ownerId, () => {
      const barn = createField({ name: 'Barn', kind: 'barn' }).id;
      db.transaction(() => {
        for (let g = 0; g < 20; g++) {
          const group = insertAnimalGroup({
            name: `Herd ${g + 1}`,
            speciesId: g % 2 ? 'goat' : 'sheep',
            purpose: 'production',
            headCount: 0,
            foodProducing: true,
            housingFieldId: barn
          });
          insertStay({
            subject: { subjectType: 'group', subjectId: group.id },
            fieldId: barn,
            atMs: now - 200 * DAY,
            movedBy: null
          });
          for (let i = 0; i < 25; i++) {
            const a = insertAnimal({
              speciesId: g % 2 ? 'goat' : 'sheep',
              groupId: group.id,
              name: `Animal ${g + 1}-${i + 1}`,
              tag: `T-${g + 1}-${i + 1}`,
              sex: 'female',
              purpose: 'production',
              foodProducing: true,
              housingFieldId: barn
            });
            for (let t = 0; t < 4; t++) wormer('animal', a.id, now - (5 + t * 20 + i) * DAY);
          }
        }
      });
    });
    const started = performance.now();
    const snap = await inFarm(ownerId, () => buildFarmSnapshot({ now }));
    const buildMs = performance.now() - started;
    const json = JSON.stringify(snap);
    const gz = gzipSync(json).length;
    console.info(
      `[snapshot budget] 500 animals / 20 groups / 2000 treatments: ${json.length} bytes JSON, ${gz} bytes gzip, ${snap.animalHolds?.length} hold spans, ${snap.treatments?.length} treatments shipped, built in ${Math.round(buildMs)} ms`
    );
    expect(snap.animals).toHaveLength(500);
    expect(gz).toBeLessThanOrEqual(256 * 1024);
  }, 120_000);
});
