// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { like } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '$lib/db/client';
import { owners, weatherForecastCache } from '$lib/db/schema';
import { runWithTenantAsync, runWithTenant } from '$lib/db/tenant';
import { runWithDbTiming } from '$lib/db/instrument';
import { listBiofixes, setBiofix } from '$lib/db/pestBiofix';
import { SPRAY_WORDS } from '$lib/plugins/schemas';
import { E2E_TRAP_MODEL } from '$lib/ipm/pestModel.fixtures';
import { watchForView } from '$lib/ipm/watchFor';
import type { TodayAdviceContext } from '$lib/today/advice';
import { registerTestPestModel } from './registry';
import {
  degreeDayAdvice,
  degreeDayCards,
  degreeDayStations,
  FAILED_FETCH_TTL_MS,
  gddDailyKey,
  getDailyTemps,
  loadDegreeDays,
  nceiDailyUrl,
  parseDailyRows,
  passesGhcndQc,
  type NceiDailyRow
} from './degreeDays.server';
import { OPEN_MONTH_TTL_MS, CLOSED_MONTH_TTL_MS } from './weatherObserved';

const LEESBURG = { lat: 39.1157, lon: -77.5636 };
const MID_ATLANTIC_OCEAN = { lat: 30, lon: -40 };
const NOW = Date.UTC(2026, 6, 2, 16);
const TZ = 'America/New_York';
const MODEL = E2E_TRAP_MODEL.pluginId;

function rows(from: string, to: string, tmax: number, tmin: number, skip: string[] = []) {
  const out: NceiDailyRow[] = [];
  for (let d = new Date(`${from}T00:00:00Z`); ; d = new Date(d.getTime() + 86_400_000)) {
    const ymd = d.toISOString().slice(0, 10);
    if (ymd > to) break;
    if (skip.includes(ymd)) continue;
    out.push({ DATE: ymd, TMAX: String(tmax), TMIN: String(tmin) });
  }
  return out;
}

function fetchOf(r: NceiDailyRow[]) {
  return vi.fn(async (_url: string) => JSON.stringify(r));
}

function clearCache() {
  db.delete(weatherForecastCache).where(like(weatherForecastCache.cacheKey, 'gdd-daily:%')).run();
}

function seedOwner(): string {
  const id = `dd-${randomUUID()}`;
  db.insert(owners).values({ id, name: id, slug: id, billingStatus: 'active' }).run();
  return id;
}

beforeAll(async () => {
  await registerTestPestModel(E2E_TRAP_MODEL);
});
beforeEach(clearCache);

describe('NCEI daily summaries', () => {
  it('asks for TMAX and TMIN in Fahrenheit with attributes', () => {
    const url = new URL(nceiDailyUrl('USW00093738', '2026-01-01', '2026-07-02'));
    expect(url.origin + url.pathname).toBe('https://www.ncei.noaa.gov/access/services/data/v1');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      dataset: 'daily-summaries',
      stations: 'USW00093738',
      dataTypes: 'TMAX,TMIN',
      units: 'standard',
      includeAttributes: 'true'
    });
  });

  it('drops values with a quality flag, blanks and junk, and never fills them', () => {
    expect(passesGhcndQc(undefined)).toBe(true);
    expect(passesGhcndQc(',,W,2400')).toBe(true);
    expect(passesGhcndQc(',I,W,2400')).toBe(false);
    const parsed = parseDailyRows([
      { DATE: '2026-06-02', TMAX: '  88', TMIN: '66' },
      { DATE: '2026-06-01', TMAX: '90', TMIN: '70', TMAX_ATTRIBUTES: ',X,W,' },
      { DATE: '2026-06-03', TMAX: '', TMIN: '60' },
      { DATE: 'garbage', TMAX: '80', TMIN: '60' },
      { DATE: '2026-06-04', TMAX: '999', TMIN: '60' }
    ]);
    expect(parsed).toEqual([
      { ymd: '2026-06-01', tmaxF: null, tminF: 70 },
      { ymd: '2026-06-02', tmaxF: 88, tminF: 66 },
      { ymd: '2026-06-03', tmaxF: null, tminF: 60 },
      { ymd: '2026-06-04', tmaxF: null, tminF: 60 }
    ]);
  });

  it('uses USW stations within 30 miles, and none far from land', () => {
    const s = degreeDayStations(LEESBURG.lat, LEESBURG.lon);
    expect(s.length).toBeGreaterThan(0);
    expect(s.every((x) => x.ghcnId.startsWith('USW') && x.distanceMiles <= 30)).toBe(true);
    expect(degreeDayStations(MID_ATLANTIC_OCEAN.lat, MID_ATLANTIC_OCEAN.lon)).toEqual([]);
  });
});

describe('getDailyTemps cache', () => {
  const station = { ghcnId: 'USW00099999' };

  it('fetches once, then reads the global cache', async () => {
    const fetchText = fetchOf(rows('2026-01-01', '2026-06-30', 80, 60));
    const a = await getDailyTemps(station, 2026, NOW, { fetchText });
    const b = await getDailyTemps(station, 2026, NOW, { fetchText });
    expect(fetchText).toHaveBeenCalledTimes(1);
    expect(a.days).toHaveLength(181);
    expect(b.days).toEqual(a.days);
    const row = db
      .select()
      .from(weatherForecastCache)
      .where(like(weatherForecastCache.cacheKey, gddDailyKey(station.ghcnId, 2026)))
      .get();
    expect(row!.expiresAt.getTime() - NOW).toBe(OPEN_MONTH_TTL_MS);
  });

  it('a settled past year is cached for a month', async () => {
    const fetchText = fetchOf(rows('2024-01-01', '2024-12-31', 70, 50));
    await getDailyTemps(station, 2024, NOW, { fetchText });
    const row = db
      .select()
      .from(weatherForecastCache)
      .where(like(weatherForecastCache.cacheKey, gddDailyKey(station.ghcnId, 2024)))
      .get();
    expect(row!.expiresAt.getTime() - NOW).toBe(CLOSED_MONTH_TTL_MS);
    expect(new URL(fetchText.mock.calls[0][0]).searchParams.get('endDate')).toBe('2024-12-31');
  });

  it('remembers a failure briefly and never throws', async () => {
    const fetchText = vi.fn(async () => {
      throw new Error('boom');
    });
    const a = await getDailyTemps(station, 2026, NOW, { fetchText });
    expect(a).toEqual({ days: [], error: 'boom' });
    await getDailyTemps(station, 2026, NOW + 1000, { fetchText });
    expect(fetchText).toHaveBeenCalledTimes(1);
    await getDailyTemps(station, 2026, NOW + FAILED_FETCH_TTL_MS + 1, { fetchText });
    expect(fetchText).toHaveBeenCalledTimes(2);
  });
});

describe('loadDegreeDays', () => {
  const cucurbits = new Set(['cucurbit']);

  it('without a location says so and shows only the trap prompt', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const r = await loadDegreeDays({
        year: 2026,
        nowMs: NOW,
        timeZone: TZ,
        farmLatLon: null,
        plantedFamilies: cucurbits,
        modelId: MODEL
      });
      expect(r).toMatchObject({ location: 'no-location', message: 'Set your farm location.' });
      expect(r.models[0].lines).toEqual(['Set traps. Record your first catch to start the count.']);
      expect(r.models[0].showOnToday).toBe(false);
    });
  });

  it('with no station within 30 miles says so', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const r = await loadDegreeDays({
        year: 2026,
        nowMs: NOW,
        timeZone: TZ,
        farmLatLon: MID_ATLANTIC_OCEAN,
        plantedFamilies: cucurbits,
        modelId: MODEL
      });
      expect(r.location).toBe('no-station');
      expect(r.message).toBe('Degree days need a weather station within 30 miles. None found.');
      expect(watchForView(r).show).toBe(true);
    });
  });

  it('counts from the recorded catch, reports gaps as a lower bound and never borrows data', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      setBiofix(MODEL, 2026, { date: '2026-06-20', byUserId: 'u', at: NOW });
      const fetchText = fetchOf(
        rows('2026-01-01', '2026-06-30', 80, 60, ['2026-06-25', '2026-06-26'])
      );
      const r = await loadDegreeDays({
        year: 2026,
        nowMs: NOW,
        timeZone: TZ,
        farmLatLon: LEESBURG,
        plantedFamilies: cucurbits,
        modelId: MODEL,
        deps: { fetchText }
      });
      const m = r.models[0];
      // 20 per day from Jun 20 to Jun 30, minus two missing days.
      expect(m).toMatchObject({ totalLowerBound: 180, missingDays: 2, throughYmd: '2026-06-30' });
      expect(m.biofix).toMatchObject({ date: '2026-06-20', provenance: 'manual' });
      expect(m.status).toMatchObject({ state: 'counting', inWindow: true, reached: true });
      expect(m.lines[0]).toBe(
        'At least 180 degree days since Jun 20, 2 days missing, through Jun 30.'
      );
      expect(fetchText).toHaveBeenCalledTimes(1);
      expect(r.station?.ghcnId.startsWith('USW')).toBe(true);
    });
  });

  it('no planted host crop means not applicable and nothing on the strip', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const r = await loadDegreeDays({
        year: 2026,
        nowMs: NOW,
        timeZone: TZ,
        farmLatLon: LEESBURG,
        plantedFamilies: new Set(['brassica']),
        modelId: MODEL,
        deps: { fetchText: fetchOf([]) }
      });
      expect(r.models[0].applicable).toBe(false);
      expect(watchForView(r).show).toBe(false);
    });
  });

  it('biofixes are per Owner', async () => {
    const a = seedOwner();
    const b = seedOwner();
    runWithTenant(a, () => setBiofix(MODEL, 2026, { date: '2026-06-01', byUserId: null, at: 1 }));
    expect(runWithTenant(b, () => listBiofixes(2026).size)).toBe(0);
    expect(runWithTenant(a, () => listBiofixes(2026).get(MODEL)?.date)).toBe('2026-06-01');
    expect(runWithTenant(a, () => listBiofixes(2025).size)).toBe(0);
  });
});

describe('/today degree-day card', () => {
  const ctx = (families: string[]): TodayAdviceContext => ({
    nowMs: NOW,
    seasonYear: 2026,
    farmLatLon: LEESBURG,
    timeZone: TZ,
    plantings: families.map((f, i) => ({
      id: `p${i}`,
      blockId: 'b',
      fieldId: null,
      cropPluginId: 'x',
      cropFamily: f,
      status: 'active'
    }))
  });

  it('shows no card without a host planting and runs no query', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const { timing, result } = runWithDbTiming(() => degreeDayAdvice(ctx(['brassica'])));
      expect(await result).toEqual([]);
      expect(timing.queries).toBe(0);
    });
  });

  it('shows one card per model in an active window, in at most two queries on a warm cache', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      setBiofix(MODEL, 2026, { date: '2026-06-20', byUserId: 'u', at: NOW });
      // Warm the global cache for the nearest station.
      const station = degreeDayStations(LEESBURG.lat, LEESBURG.lon)[0];
      await getDailyTemps(station, 2026, NOW, {
        fetchText: fetchOf(rows('2026-01-01', '2026-06-30', 80, 60))
      });
      const { timing, result } = runWithDbTiming(() => degreeDayAdvice(ctx(['cucurbit'])));
      const cards = await result;
      expect(timing.queries).toBeLessThanOrEqual(2);
      const mine = cards.filter((c) => c.id === `pest:${MODEL}`);
      expect(mine).toHaveLength(1);
      expect(mine[0]).toMatchObject({
        kind: 'degree-days',
        title: 'Watch for test trap borer',
        provenance: 'manual',
        tone: 'wheat'
      });
      for (const s of [mine[0].title, ...mine[0].lines, mine[0].detail ?? '']) {
        expect(s).not.toMatch(SPRAY_WORDS);
      }
      expect(mine[0].detail).toContain('Counting from your first trap catch on Jun 20');
    });
  });

  it('shows nothing before a catch is recorded', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const cards = await degreeDayAdvice(ctx(['cucurbit']));
      expect(cards.filter((c) => c.id === `pest:${MODEL}`)).toEqual([]);
    });
  });

  it('builds no cards without a station', () => {
    expect(
      degreeDayCards({
        year: 2026,
        location: 'no-station',
        message: 'x',
        station: null,
        dataError: null,
        models: []
      })
    ).toEqual([]);
  });
});
