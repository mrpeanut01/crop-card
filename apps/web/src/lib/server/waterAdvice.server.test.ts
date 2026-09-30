// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '$lib/db/client';
import { blockProtections, owners, weatherForecastCache } from '$lib/db/schema';
import { runWithTenant, runWithTenantAsync, tenantValues } from '$lib/db/tenant';
import { createField } from '$lib/db/fields';
import { createBlock } from '$lib/db/blocks';
import { insertIrrigationEvent, insertRainGaugeReading } from '$lib/db/irrigation';
import { setSetting } from '$lib/db/settings';
import { runWithDbTiming } from '$lib/db/instrument';
import { observedRainKey } from './weatherObserved';
import { hourlyCacheKey } from './weatherHourly';
import { loadAreasForBeds, resolveTarget, wateringCards } from './waterAdvice.server';
import { runAdviceProviders } from './todayAdvice.server';
import { waterTargetKey } from '$lib/weather/waterSources';
import type { TodayAdviceContext } from '$lib/today/advice';

const H = 3_600_000;
const NOW = Date.now();
/** KBZN (Bozeman) is about 7 miles from this pin; other weather tests use KJYO. */
const NEAR = { lat: 45.7, lon: -111.1 };
/** Lynchburg (KLYH) is the only station, about 25 miles off. */
const FAR = { lat: 37.6, lon: -79.5 };

function seedOwner(): string {
  const id = `water-${randomUUID()}`;
  db.insert(owners).values({ id, name: id, slug: id, billingStatus: 'active' }).run();
  return id;
}

function seedGarden(ownerId: string, kind: 'garden' | 'field' | 'greenhouse' = 'garden') {
  return runWithTenant(ownerId, () => {
    const field = createField({ name: 'Kitchen beds', kind, widthFt: 20, lengthFt: 20 });
    const bed1 = createBlock({ name: 'Bed 1', fieldId: field.id, widthFt: 4, lengthFt: 10 });
    const bed2 = createBlock({ name: 'Bed 2', fieldId: field.id, widthFt: 4, lengthFt: 10 });
    return { fieldId: field.id, bed1: bed1.id, bed2: bed2.id };
  });
}

function ctx(
  blocks: string[],
  point: { lat: number; lon: number } | null,
  over: Partial<TodayAdviceContext> = {}
): TodayAdviceContext {
  return {
    nowMs: NOW,
    seasonYear: 2026,
    farmLatLon: point,
    timeZone: 'America/New_York',
    plantings: blocks.map((b, i) => ({
      id: `p${i}`,
      blockId: b,
      fieldId: null,
      cropPluginId: 'tomato',
      cropFamily: 'solanaceae',
      status: 'active',
      plantingDate: NOW - 20 * 24 * H
    })),
    ...over
  };
}

function seedStationRain(icao: string, perHour: number | null) {
  const hours = [];
  const end = Math.floor(NOW / H) * H;
  for (let t = end - 170 * H; t <= end; t += H) hours.push({ t, inches: perHour });
  db.insert(weatherForecastCache)
    .values({
      id: randomUUID(),
      cacheKey: observedRainKey(icao),
      fetchedAt: new Date(NOW),
      expiresAt: new Date(NOW + H),
      payloadJson: JSON.stringify(hours)
    })
    .onConflictDoUpdate({
      target: weatherForecastCache.cacheKey,
      set: { expiresAt: new Date(NOW + H), payloadJson: JSON.stringify(hours) }
    })
    .run();
}

function seedForecast(point: { lat: number; lon: number }) {
  db.insert(weatherForecastCache)
    .values({
      id: randomUUID(),
      cacheKey: hourlyCacheKey(point.lat, point.lon),
      fetchedAt: new Date(NOW),
      expiresAt: new Date(NOW + H),
      payloadJson: JSON.stringify([])
    })
    .onConflictDoUpdate({
      target: weatherForecastCache.cacheKey,
      set: { expiresAt: new Date(NOW + H), payloadJson: '[]' }
    })
    .run();
}

const noNetwork = {
  nwsObservations: vi.fn(async () => {
    throw new Error('no network in tests');
  }),
  forecast: vi.fn(async () => [])
};

beforeEach(() => {
  db.delete(weatherForecastCache)
    .where(eq(weatherForecastCache.cacheKey, 'observed-rain:KBZN'))
    .run();
  noNetwork.nwsObservations.mockClear();
  noNetwork.forecast.mockClear();
});

describe('wateringCards', () => {
  it('shows unknown and names the 25-mile station without fetching', async () => {
    const owner = seedOwner();
    const g = seedGarden(owner);
    const cards = await runWithTenantAsync(owner, () =>
      wateringCards(ctx([g.bed1], FAR), noNetwork)
    );
    expect(cards).toHaveLength(1);
    expect(cards[0].title).toBe('Kitchen beds: rain unknown here');
    expect(cards[0].lines).toContain('Rain unknown here, check your gauge.');
    expect(cards[0].detail).toMatch(
      /Lynchburg Rgnl AP \(KLYH\), 2[45](\.\d)? mi away, too far to count/
    );
    expect(noNetwork.nwsObservations).not.toHaveBeenCalled();
  });

  it('says water when a near station saw a dry week', async () => {
    const owner = seedOwner();
    const g = seedGarden(owner);
    seedStationRain('KBZN', 0);
    const cards = await runWithTenantAsync(owner, () =>
      wateringCards(ctx([g.bed1], NEAR), noNetwork)
    );
    expect(cards[0].title).toBe('Water the Kitchen beds');
    expect(cards[0].provenance).toBe('data');
    expect(cards[0].detail).toContain('(KBZN)');
  });

  it('lets a gauge reading override the station and says skip', async () => {
    const owner = seedOwner();
    const g = seedGarden(owner);
    seedStationRain('KBZN', 0);
    runWithTenant(owner, () => {
      insertRainGaugeReading({ fieldId: g.fieldId, readAt: NOW - 160 * H, inches: 0 });
      insertRainGaugeReading({ fieldId: g.fieldId, readAt: NOW - H, inches: 1.3 });
    });
    const cards = await runWithTenantAsync(owner, () =>
      wateringCards(ctx([g.bed1], NEAR), noNetwork)
    );
    expect(cards[0].title).toBe('Skip watering the Kitchen beds today');
    expect(cards[0].provenance).toBe('manual');
  });

  it('counts logged watering per bed and uses the owner target', async () => {
    const owner = seedOwner();
    const g = seedGarden(owner);
    seedStationRain('KBZN', 0);
    runWithTenant(owner, () => {
      setSetting(waterTargetKey(g.fieldId), '0.5');
      insertIrrigationEvent({
        fieldId: g.fieldId,
        blockId: g.bed2,
        occurredAt: NOW - 2 * H,
        gallons: 25
      });
    });
    const cards = await runWithTenantAsync(owner, () =>
      wateringCards(ctx([g.bed1, g.bed2], NEAR), noNetwork)
    );
    expect(cards[0].title).toBe('Watering the Kitchen beds');
    expect(cards[0].lines[0]).toBe('Water Bed 1. About 0.5 in short this week.');
    expect(cards[0].lines[1]).toBe('Bed 2: watered enough this week.');
    expect(cards[0].detail).toContain('Target 0.5 in a week (your setting)');
  });

  it('lists a bed under a low tunnel as check by hand', async () => {
    const owner = seedOwner();
    const g = seedGarden(owner);
    seedStationRain('KBZN', 0);
    runWithTenant(owner, () =>
      db
        .insert(blockProtections)
        .values(
          tenantValues({
            id: randomUUID(),
            blockId: g.bed2,
            kind: 'low-tunnel' as const,
            provenance: 'manual' as const,
            installedOn: new Date(NOW - 5 * 24 * H)
          })
        )
        .run()
    );
    const cards = await runWithTenantAsync(owner, () =>
      wateringCards(ctx([g.bed1, g.bed2], NEAR), noNetwork)
    );
    expect(cards[0].lines.some((l) => l.startsWith('Check Bed 2 by hand.'))).toBe(true);
  });

  it("ignores last season's one-season cover", async () => {
    const owner = seedOwner();
    const g = seedGarden(owner);
    seedStationRain('KBZN', 0);
    runWithTenant(owner, () =>
      db
        .insert(blockProtections)
        .values(
          tenantValues({
            id: randomUUID(),
            blockId: g.bed2,
            kind: 'low-tunnel' as const,
            provenance: 'manual' as const,
            seasonYear: new Date(NOW).getFullYear() - 1
          })
        )
        .run()
    );
    const cards = await runWithTenantAsync(owner, () =>
      wateringCards(ctx([g.bed1, g.bed2], NEAR), noNetwork)
    );
    expect(cards[0].lines.some((l) => l.includes('by hand'))).toBe(false);
  });

  it('gives greenhouses and planned-only Areas no card', async () => {
    const owner = seedOwner();
    const gh = seedGarden(owner, 'greenhouse');
    const garden = seedGarden(owner);
    const cards = await runWithTenantAsync(owner, async () => [
      ...(await wateringCards(ctx([gh.bed1], NEAR), noNetwork)),
      ...(await wateringCards(
        ctx([garden.bed1], NEAR, {
          plantings: [
            {
              id: 'p',
              blockId: garden.bed1,
              fieldId: garden.fieldId,
              cropPluginId: 'tomato',
              cropFamily: null,
              status: 'planned',
              plantingDate: null
            }
          ]
        }),
        noNetwork
      ))
    ]);
    expect(cards).toEqual([]);
  });

  it("never reads another Owner's beds, logs or target", async () => {
    const a = seedOwner();
    const b = seedOwner();
    const ga = seedGarden(a);
    runWithTenant(a, () => setSetting(waterTargetKey(ga.fieldId), '3'));
    const cards = await runWithTenantAsync(b, () => wateringCards(ctx([ga.bed1], NEAR), noNetwork));
    expect(cards).toEqual([]);
    expect(runWithTenant(b, () => loadAreasForBeds([ga.bed1], NOW, NEAR))).toEqual([]);
  });

  it('reads the database at most four times on a warm cache (E0-11)', async () => {
    const owner = seedOwner();
    const g = seedGarden(owner);
    const g2 = seedGarden(owner, 'field');
    seedStationRain('KBZN', 0.01);
    seedForecast(NEAR);
    const { timing, result } = runWithDbTiming(() =>
      runWithTenantAsync(owner, () =>
        wateringCards(ctx([g.bed1, g.bed2, g2.bed1, g2.bed2], NEAR), noNetwork)
      )
    );
    const cards = await result;
    expect(cards).toHaveLength(2);
    expect(timing.queries).toBeLessThanOrEqual(4);
    expect(noNetwork.nwsObservations).not.toHaveBeenCalled();
    expect(noNetwork.forecast).not.toHaveBeenCalled();
  });

  it('reads as unknown when the rain feed fails on a cold cache', async () => {
    const owner = seedOwner();
    const g = seedGarden(owner);
    const cards = await runWithTenantAsync(owner, () =>
      wateringCards(ctx([g.bed1], NEAR), noNetwork)
    );
    expect(noNetwork.nwsObservations).toHaveBeenCalledTimes(1);
    expect(cards[0].lines).toContain('Rain unknown here, check your gauge.');
  });
});

describe('resolveTarget', () => {
  it('uses the owner value in range, else the sourced default', () => {
    expect(resolveTarget('1.5')).toEqual({ inches: 1.5, provenance: 'manual' });
    expect(resolveTarget('9')).toEqual({ inches: 1, provenance: 'fallback' });
    expect(resolveTarget(null)).toEqual({ inches: 1, provenance: 'fallback' });
  });
});

describe('runAdviceProviders', () => {
  it('drops a provider that throws and sorts the rest', async () => {
    const card = (id: string, sortKey: number) => ({
      id,
      kind: 'watering' as const,
      title: id,
      lines: [],
      provenance: 'data' as const,
      tone: 'info' as const,
      actions: [],
      sortKey
    });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const out = await runAdviceProviders(
      [
        async () => [card('b', 20)],
        async () => {
          throw new Error('boom');
        },
        async () => [card('a', 10)]
      ],
      ctx([], null)
    );
    expect(out.map((c) => c.id)).toEqual(['a', 'b']);
    errSpy.mockRestore();
  });
});
