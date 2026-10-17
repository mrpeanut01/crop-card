// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { db } from '$lib/db/client';
import { owners, weatherForecastCache } from '$lib/db/schema';
import { runWithTenant, runWithTenantAsync } from '$lib/db/tenant';
import { createField } from '$lib/db/fields';
import { createBlock } from '$lib/db/blocks';
import { createEquipment, listEquipment } from '$lib/db/equipment';
import { insertIrrigationSkip, replaceWaterTargets } from '$lib/db/waterers';
import { runWithDbTiming } from '$lib/db/instrument';
import { observedRainKey } from './weatherObserved';
import { hourlyCacheKey } from './weatherHourly';
import { wateringCards } from './waterAdvice.server';
import type { TodayAdviceContext } from '$lib/today/advice';

const H = 3_600_000;
const NOW = Date.now();
/** KBZN (Bozeman) is about 7 miles from this pin. */
const NEAR = { lat: 45.7, lon: -111.1 };

const noNetwork = {
  nwsObservations: vi.fn(async () => {
    throw new Error('no network in tests');
  }),
  forecast: vi.fn(async () => [])
};

function seedOwner(): string {
  const id = `waterer-${randomUUID()}`;
  db.insert(owners).values({ id, name: id, slug: id, billingStatus: 'active' }).run();
  return id;
}

function seedGarden(ownerId: string, details: Record<string, boolean> | null = null) {
  return runWithTenant(ownerId, () => {
    const field = createField({
      name: details ? 'Windowsill' : 'Kitchen beds',
      kind: 'garden',
      widthFt: 20,
      lengthFt: 20,
      details
    });
    const bed = createBlock({ name: 'Bed 1', fieldId: field.id, widthFt: 4, lengthFt: 10 });
    return { fieldId: field.id, bed: bed.id };
  });
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

function timerOn(fieldId: string, inchesPerRun: number | null) {
  const timer = createEquipment({
    type: 'irrigation',
    label: 'Drip timer',
    spec: {
      schedule: {
        days: [0, 1, 2, 3, 4, 5, 6],
        start: '06:00',
        minutes: 20,
        method: 'drip',
        inchesPerRun,
        gallonsPerMinute: null,
        activeFrom: NOW - 30 * 24 * H
      }
    }
  });
  replaceWaterTargets(timer.id, [{ fieldId, blockId: null }]);
  return timer;
}

describe('Phase 37E watering advice', () => {
  it('counts past runs as water given and drops a skipped run, in one extra read', async () => {
    const owner = seedOwner();
    const g = seedGarden(owner);
    seedWeather();
    const timer = runWithTenant(owner, () => timerOn(g.fieldId, 0.1));
    const equipment = runWithTenant(owner, () => listEquipment());
    const c = ctx(g.bed, { equipment, canRecord: true });
    const { timing, result } = runWithDbTiming(() =>
      runWithTenantAsync(owner, () => wateringCards(c, noNetwork))
    );
    const [before] = await result;
    expect(timing.queries).toBeLessThanOrEqual(5);
    const watered = before.lines.find((l) => l.startsWith('Watering logged'));
    expect(watered).toMatch(/^Watering logged this week: 0\.[6-7] in\.$/);
    expect(before.lines.some((l) => l.startsWith('Drip timer gives 0.1 in'))).toBe(true);
    const didNot = before.actions.find((a) => a.kind === 'skip-run' && a.reason === 'did-not-run');
    expect(didNot).toBeDefined();
    runWithTenant(owner, () =>
      insertIrrigationSkip({
        equipmentId: timer.id,
        scheduledAt: (didNot as { scheduledAt: number }).scheduledAt,
        reason: 'did-not-run'
      })
    );
    const [after] = await runWithTenantAsync(owner, () => wateringCards(c, noNetwork));
    expect(after.lines.find((l) => l.startsWith('Watering logged'))).not.toBe(watered);
  });

  it('names the timer when its runs have no amount', async () => {
    const owner = seedOwner();
    const g = seedGarden(owner);
    seedWeather();
    runWithTenant(owner, () => timerOn(g.fieldId, null));
    const [card] = await runWithTenantAsync(owner, () => wateringCards(ctx(g.bed), noNetwork));
    expect(card.lines[0]).toMatch(/^Drip timer ran \w+, but its inches per run are not set\.$/);
  });

  it('says check the soil first on a dry-loving bed, from the planting need', async () => {
    const owner = seedOwner();
    const g = seedGarden(owner);
    seedWeather();
    const c = ctx(g.bed);
    const plantings = c.plantings.map((p) => ({
      ...p,
      cropPluginId: 'thyme-english',
      cropName: 'Thyme — English',
      waterNeed: 'low' as const
    }));
    const [card] = await runWithTenantAsync(owner, () =>
      wateringCards({ ...c, plantings }, noNetwork)
    );
    expect(card.title).toBe('Water the Kitchen beds');
    expect(card.lines).toContain('Check the soil first: thyme likes it dry.');
  });

  it('reads an indoor container Area as check the soil', async () => {
    const owner = seedOwner();
    const g = seedGarden(owner, { container: true, indoors: true });
    seedWeather();
    const [card] = await runWithTenantAsync(owner, () => wateringCards(ctx(g.bed), noNetwork));
    expect(card.lines).toEqual(["Rain doesn't reach indoor pots. Check the soil."]);
  });

  it('adds the sourced pots-in-heat line on an outdoor container Area only', async () => {
    const owner = seedOwner();
    const pots = seedGarden(owner, { container: true });
    const beds = seedGarden(owner);
    seedWeather();
    db.delete(weatherForecastCache)
      .where(eq(weatherForecastCache.cacheKey, hourlyCacheKey(NEAR.lat, NEAR.lon)))
      .run();
    const start = Math.floor(NOW / H) * H;
    const hot = Array.from({ length: 24 }, (_, i) => ({
      t: start + i * H,
      tempF: i === 12 ? 96 : 75,
      dewpointF: null,
      rhPct: null,
      popPct: null,
      precipMm: 0,
      windMph: null
    }));
    const deps = { ...noNetwork, forecast: vi.fn(async () => hot) };
    const cards = await runWithTenantAsync(owner, () =>
      wateringCards(
        {
          ...ctx(pots.bed),
          plantings: [...ctx(pots.bed).plantings, { ...ctx(beds.bed).plantings[0], id: 'p2' }]
        },
        deps
      )
    );
    const line = 'Hot day and warm night ahead: check the pots today.';
    expect(cards.find((c) => c.title.includes('Windowsill'))?.lines).toContain(line);
    expect(cards.find((c) => c.title.includes('Kitchen beds'))?.lines).not.toContain(line);
  });

  it('never shows another farm timer', async () => {
    const a = seedOwner();
    const b = seedOwner();
    const ga = seedGarden(a);
    const gb = seedGarden(b);
    seedWeather();
    runWithTenant(a, () => timerOn(ga.fieldId, 0.2));
    const [card] = await runWithTenantAsync(b, () => wateringCards(ctx(gb.bed), noNetwork));
    expect(card.lines.join(' ')).not.toContain('Drip timer');
  });
});
