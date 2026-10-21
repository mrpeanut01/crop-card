// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { db } from '$lib/db/client';
import { owners, users, weatherForecastCache } from '$lib/db/schema';
import { runWithTenant, runWithTenantAsync } from '$lib/db/tenant';
import { createField } from '$lib/db/fields';
import { createBlock } from '$lib/db/blocks';
import { createEquipment, listEquipment } from '$lib/db/equipment';
import { insertIrrigationSkip, replaceWaterTargets } from '$lib/db/waterers';
import { runWithDbTiming } from '$lib/db/instrument';
import { observedRainKey } from './weatherObserved';
import { hourlyCacheKey } from './weatherHourly';
import { loadAreasForBeds, loadTimers, wateringCards } from './waterAdvice.server';
import type { TodayAdviceContext } from '$lib/today/advice';

// #870 on /today: a timer that waters several Areas splits its gallons over
// all of them, not only the Areas with a crop in the ground (FU870-1), and
// the watering card lists logged skips with an Undo for those who may
// (FU870-2). Still one waterer read (R-22).

const H = 3_600_000;
const NOW = Date.now();
const NEAR = { lat: 45.7, lon: -111.1 };
const noNetwork = {
  nwsObservations: vi.fn(async () => {
    throw new Error('no network in tests');
  }),
  forecast: vi.fn(async () => [])
};

for (const id of ['fu870-adv-owner', 'fu870-adv-helper', 'fu870-adv-helper-2']) {
  db.insert(users)
    .values({ id, email: `${id}@test.local` })
    .onConflictDoNothing()
    .run();
}

function seedOwner(): string {
  const id = `fu870-adv-${randomUUID()}`;
  db.insert(owners).values({ id, name: id, slug: id, billingStatus: 'active' }).run();
  return id;
}

function seedWeather() {
  const end = Math.floor(NOW / H) * H;
  const hours = [];
  for (let t = end - 170 * H; t <= end; t += H) hours.push({ t, inches: 0 });
  for (const [key, payload] of [
    [observedRainKey('KBZN'), JSON.stringify(hours)],
    [hourlyCacheKey(NEAR.lat, NEAR.lon), '[]']
  ] as const) {
    db.insert(weatherForecastCache)
      .values({
        id: randomUUID(),
        cacheKey: key,
        fetchedAt: new Date(NOW),
        expiresAt: new Date(NOW + H),
        payloadJson: payload
      })
      .onConflictDoUpdate({
        target: weatherForecastCache.cacheKey,
        set: { expiresAt: new Date(NOW + H), payloadJson: payload }
      })
      .run();
  }
}

/** A planted 20 x 20 ft Area and an empty 10 x 10 ft one, both on one
 *  drip timer typed in gallons per minute. */
function seedTwoAreas(ownerId: string) {
  return runWithTenant(ownerId, () => {
    const kitchen = createField({
      name: 'Kitchen beds',
      kind: 'garden',
      widthFt: 20,
      lengthFt: 20
    });
    const bed = createBlock({ name: 'Bed 1', fieldId: kitchen.id, widthFt: 4, lengthFt: 10 });
    const back = createField({ name: 'Back beds', kind: 'garden', widthFt: 10, lengthFt: 10 });
    const timer = createEquipment({
      type: 'irrigation',
      label: 'Drip timer',
      spec: {
        schedule: {
          days: [0, 1, 2, 3, 4, 5, 6],
          start: '06:00',
          minutes: 20,
          method: 'drip',
          inchesPerRun: null,
          gallonsPerMinute: 2,
          activeFrom: NOW - 30 * 24 * H
        }
      }
    });
    replaceWaterTargets(timer.id, [
      { fieldId: kitchen.id, blockId: null },
      { fieldId: back.id, blockId: null }
    ]);
    return { kitchen: kitchen.id, back: back.id, bed: bed.id, timer: timer.id };
  });
}

function ctx(bed: string, over: Partial<TodayAdviceContext> = {}): TodayAdviceContext {
  return {
    nowMs: NOW,
    seasonYear: 2026,
    farmLatLon: NEAR,
    timeZone: 'America/New_York',
    plantings: [
      {
        id: 'p1',
        blockId: bed,
        fieldId: null,
        cropPluginId: 'tomato',
        cropFamily: 'solanaceae',
        status: 'active',
        plantingDate: NOW - 20 * 24 * H
      }
    ],
    ...over
  };
}

describe('#870 waterers on /today', () => {
  it('splits a run over every Area the timer waters, by size', () => {
    const owner = seedOwner();
    const s = seedTwoAreas(owner);
    runWithTenant(owner, () => {
      const areas = loadAreasForBeds([s.bed], NOW, NEAR);
      expect(areas.map((a) => a.fieldId)).toEqual([s.kitchen]);
      const { logs } = loadTimers(
        areas,
        { nowMs: NOW, equipment: listEquipment() },
        'America/New_York'
      );
      const kitchen = logs.get(s.kitchen) ?? [];
      expect(kitchen.length).toBeGreaterThan(0);
      for (const log of kitchen) {
        // Sizes go through stored acres, so 400 and 100 sq ft are not exact.
        expect(log.gallons).toBeCloseTo(40 * (400 / 500), 3);
        expect(log.provenance).toBe('manual');
      }
      expect(logs.has(s.back)).toBe(false);
    });
  });

  it('uses typed shares over the size split', () => {
    const owner = seedOwner();
    const s = seedTwoAreas(owner);
    runWithTenant(owner, () => {
      replaceWaterTargets(s.timer, [
        { fieldId: s.kitchen, blockId: null, sharePct: 25 },
        { fieldId: s.back, blockId: null, sharePct: 75 }
      ]);
      const { logs } = loadTimers(
        loadAreasForBeds([s.bed], NOW, NEAR),
        { nowMs: NOW, equipment: listEquipment() },
        'America/New_York'
      );
      expect((logs.get(s.kitchen) ?? []).every((l) => l.gallons === 10)).toBe(true);
    });
  });

  it('lists skips with Undo for the owner and the helper who logged it, in one waterer read', async () => {
    const owner = seedOwner();
    const s = seedTwoAreas(owner);
    seedWeather();
    runWithTenant(owner, () =>
      insertIrrigationSkip({
        equipmentId: s.timer,
        scheduledAt: NOW - 2 * H,
        reason: 'did-not-run',
        createdBy: 'fu870-adv-helper'
      })
    );
    const equipment = runWithTenant(owner, () => listEquipment());
    const view = async (over: Partial<TodayAdviceContext>) => {
      const [card] = await runWithTenantAsync(owner, () =>
        wateringCards(ctx(s.bed, { equipment, ...over }), noNetwork)
      );
      return card.skips ?? [];
    };
    const { timing, result } = runWithDbTiming(() =>
      runWithTenantAsync(owner, () =>
        wateringCards(
          ctx(s.bed, { equipment, isOwner: true, canRecord: true, viewerId: 'fu870-adv-owner' }),
          noNetwork
        )
      )
    );
    const [ownerCard] = await result;
    expect(timing.queries).toBeLessThanOrEqual(5);
    expect(ownerCard.skips).toHaveLength(1);
    expect(ownerCard.skips?.[0].text).toMatch(/^Drip timer skipped .+ \(it didn't run\)\.$/);
    expect(ownerCard.skips?.[0].canUndo).toBe(true);
    expect((await view({ canRecord: true, viewerId: 'fu870-adv-helper' }))[0]?.canUndo).toBe(true);
    expect((await view({ canRecord: true, viewerId: 'fu870-adv-helper-2' }))[0]?.canUndo).toBe(
      false
    );
    expect((await view({ canRecord: false, viewerId: 'fu870-adv-helper' }))[0]?.canUndo).toBe(
      false
    );
    const es = await view({ canRecord: true, viewerId: 'fu870-adv-helper', locale: 'es' });
    expect(es[0]?.text).toMatch(/^Drip timer: riego saltado .+ \(no regó\)\.$/);
  });

  it("never lists another farm's skips", async () => {
    const a = seedOwner();
    const b = seedOwner();
    const sa = seedTwoAreas(a);
    const sb = seedTwoAreas(b);
    seedWeather();
    runWithTenant(a, () =>
      insertIrrigationSkip({ equipmentId: sa.timer, scheduledAt: NOW - 2 * H, reason: 'other' })
    );
    const equipment = runWithTenant(b, () => listEquipment());
    const [card] = await runWithTenantAsync(b, () =>
      wateringCards(ctx(sb.bed, { equipment, isOwner: true, viewerId: 'x' }), noNetwork)
    );
    expect(card.skips ?? []).toEqual([]);
  });
});
