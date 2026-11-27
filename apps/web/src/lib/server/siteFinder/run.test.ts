// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';

const claude = vi.hoisted(() => ({
  text: '' as string,
  calls: [] as Array<{ model: string; max_tokens: number; content: unknown }>,
  usage: { input_tokens: 2100, output_tokens: 300 },
  delayMs: 0
}));

vi.mock('$lib/server/anthropicClient', () => ({
  anthropicClient: () => ({
    messages: {
      create: async (params: {
        model: string;
        max_tokens: number;
        messages: Array<{ content: unknown }>;
      }) => {
        claude.calls.push({
          model: params.model,
          max_tokens: params.max_tokens,
          content: params.messages[0].content
        });
        if (claude.delayMs) await new Promise((r) => setTimeout(r, claude.delayMs));
        return { content: [{ type: 'text', text: claude.text }], usage: claude.usage };
      }
    }
  })
}));

import { db } from '$lib/db/client';
import { createBlock, updateBlock } from '$lib/db/blocks';
import { createField } from '$lib/db/fields';
import { createMapFeature } from '$lib/db/mapFeatures';
import { aiCallLog, helperAssignments, owners, users } from '$lib/db/schema';
import { setSetting } from '$lib/db/settings';
import { createShadeSource } from '$lib/db/shadeSources';
import { runWithTenant, runWithTenantAsync, withTenant } from '$lib/db/tenant';
import type { PlanId } from '$lib/billing/plans';
import { AI_RESERVE_USD, PLANS } from '$lib/billing/plans';
import { SETTINGS_KEYS } from '$lib/schedule/constants';
import { resetFreePoolCache, resetGuardLedger } from '$lib/server/aiGuard';
import { selectModel, maxTokensFor } from '$lib/server/aiPlanning';
import {
  SITE_FINDER_FIXTURE_ANSWER,
  SITE_FINDER_FIXTURE_MARKER
} from '$lib/server/aiFixture/siteFinder';
import { resetSoilRateLimit } from '$lib/server/soil/ssurgo.server';
import type { SoilLookup } from '$lib/soil/types';
import type { SiteFinderRequest } from '$lib/siteFinder/apiSchemas';
import { boxAround, localFrame, toLonLat, type XY } from '$lib/siteFinder/geometry';
import { factorText } from '$lib/siteFinder/explain';
import type { TerrainLookup } from '$lib/siteFinder/terrain';
import { planeGrid, survey } from '$lib/siteFinder/testSupport';
import type { LonLat } from '$lib/siteFinder/types';
import { buildSiteReadPrompt } from './aiSiteRead';
import type { NaipFetcher } from './naip.server';
import { MAX_SOIL_LOOKUPS, loadSiteData, runSiteFinder, sunSeasonFromSettings } from './run';
import { TERRAIN_PER_MINUTE, resetTerrainRateLimit } from './terrain.server';

const DAY = 86_400_000;
const CENTER: LonLat = [-77.69888, 39.07881];
const frame = localFrame(CENTER);
const ll = (p: XY) => toLonLat(frame, p);
const ring = (c: XY, half: number) =>
  (
    [
      [c[0] - half, c[1] - half],
      [c[0] + half, c[1] - half],
      [c[0] + half, c[1] + half],
      [c[0] - half, c[1] + half],
      [c[0] - half, c[1] - half]
    ] as XY[]
  ).map(ll);
const polygon = (c: XY, half: number) =>
  JSON.stringify({ type: 'Polygon', coordinates: [ring(c, half)] });

function farm(plan: PlanId | null = 'farm') {
  const ownerId = `sf-owner-${randomUUID().slice(0, 10)}`;
  const userId = `sf-user-${randomUUID().slice(0, 10)}`;
  db.insert(owners)
    .values({
      id: ownerId,
      name: ownerId,
      slug: ownerId,
      billingStatus: 'active',
      planOverride: plan,
      createdAt: new Date(Date.now() - 90 * DAY)
    })
    .run();
  db.insert(users)
    .values({ id: userId, email: `${userId}@test` })
    .run();
  db.insert(helperAssignments)
    .values({ ownerId, userId, roleWithinOwner: 'owner', status: 'active' })
    .run();
  return { ownerId, userId };
}

const okSoil: SoilLookup = { status: 'ok', survey: survey() };

function req(patch: Partial<SiteFinderRequest> = {}): SiteFinderRequest {
  return {
    goal: 'vegetable-garden',
    box: boxAround(CENTER, 60),
    footprintFt: { width: 20, length: 30 },
    useAerial: true,
    ...patch
  };
}

function naip(kind: 'jpeg' | 'png' | 'down' = 'jpeg') {
  const calls: string[] = [];
  const fetcher: NaipFetcher = async (url) => {
    calls.push(url);
    if (kind === 'down') throw new Error('ENOTFOUND');
    const bytes = new Uint8Array(20_000);
    bytes.set([0xff, 0xd8, 0xff, 0xe0]);
    return {
      url,
      status: 200,
      contentType: kind === 'png' ? 'image/png' : 'image/jpeg',
      readText: async () => ({ text: '', truncated: false }),
      readBytes: async () => ({ bytes, truncated: false }),
      cancel: () => {}
    };
  };
  return { fetcher, calls };
}

function run(
  f: { ownerId: string; userId: string },
  patch: Partial<SiteFinderRequest> = {},
  opts: {
    naip?: ReturnType<typeof naip>;
    soilAt?: (lat: number, lon: number) => Promise<SoilLookup>;
    terrainFor?: (box: SiteFinderRequest['box']) => Promise<TerrainLookup>;
    locale?: string;
  } = {}
) {
  return runWithTenantAsync(f.ownerId, () =>
    runSiteFinder({
      userId: f.userId,
      req: req(patch),
      locale: opts.locale,
      naipFetcher: (opts.naip ?? naip()).fetcher,
      soilAt: opts.soilAt ?? (async () => okSoil),
      // No elevation unless a test asks for it: the ground is level, as it
      // was before slopes were read.
      terrainFor: opts.terrainFor ?? (async () => ({ status: 'unavailable' })),
      sprayTerms: ['roundup']
    })
  );
}

function logRows(ownerId: string) {
  return runWithTenant(ownerId, () =>
    db
      .select()
      .from(aiCallLog)
      .where(withTenant(aiCallLog, eq(aiCallLog.endpoint, 'site-finder')))
      .all()
  );
}

const savedKey = process.env.ANTHROPIC_API_KEY;
beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = 'sk-ant-unit-test';
  process.env.AI_FREE_POOL_MONTHLY_USD = '0';
  delete process.env.WEATHER_FEEDS;
  delete process.env.E2E_NAIP_FIXTURE;
  claude.text = JSON.stringify(SITE_FINDER_FIXTURE_ANSWER);
  claude.calls.length = 0;
  claude.delayMs = 0;
  resetGuardLedger();
  resetFreePoolCache();
  resetSoilRateLimit();
  resetTerrainRateLimit();
});
afterEach(() => {
  if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = savedKey;
  resetFreePoolCache();
});

describe('the deterministic finder', () => {
  it('answers without asking for the photo: no fetch, no Claude call, no log row', async () => {
    const f = farm();
    const photo = naip();
    const out = await run(f, { useAerial: false }, { naip: photo });
    expect(out.provenance).toBe('fallback');
    expect(out.fallbackReason).toBeNull();
    expect(out.message).toBeNull();
    expect(out.candidates).toHaveLength(3);
    expect(out.imagery).toEqual({ source: 'USDA NAIP via USGS The National Map', used: false });
    expect(out.seen).toEqual([]);
    expect(out.soil.status).toBe('ok');
    expect(out.shadeChecked).toBe(false);
    expect(photo.calls).toHaveLength(0);
    expect(claude.calls).toHaveLength(0);
    expect(logRows(f.ownerId)).toHaveLength(0);
  });

  it('works with no key: the same spots, tagged fallback with the reason', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const f = farm();
    const photo = naip();
    const plain = await run(f, { useAerial: false });
    const out = await run(f, {}, { naip: photo });
    expect(out.provenance).toBe('fallback');
    expect(out.fallbackReason).toBe('no-key');
    expect(out.message).toMatch(/Claude is not set up for this farm/);
    expect(out.message).toMatch(/sun, your map and the soil survey/);
    expect(out.candidates).toEqual(plain.candidates);
    expect(photo.calls).toHaveLength(0);
    expect(claude.calls).toHaveLength(0);
    const rows = logRows(f.ownerId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      provenance: 'fallback',
      fallbackReason: 'no-key',
      inputTokens: 0,
      outputTokens: 0,
      usdEstimate: 0
    });
  });

  it('writes the banner in Spanish for a Spanish viewer', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const out = await run(farm(), {}, { locale: 'es' });
    expect(out.message).toMatch(/Claude no está configurado para esta granja/);
  });

  it('works for a farm with AI turned off, as every demo farm is', async () => {
    const f = farm();
    runWithTenant(f.ownerId, () => setSetting(SETTINGS_KEYS.aiMonthlyUsdCap, '0'));
    const photo = naip();
    const out = await run(f, {}, { naip: photo });
    expect(out.provenance).toBe('fallback');
    expect(out.fallbackReason).toBe('over-cap');
    expect(out.aiLimit).toMatchObject({ detail: 'owner-disabled' });
    expect(out.candidates).toHaveLength(3);
    expect(photo.calls).toHaveLength(0);
    expect(claude.calls).toHaveLength(0);
  });

  it('reads the farm map: areas block, shade sources shade, water points count', async () => {
    const f = farm();
    runWithTenant(f.ownerId, () => {
      createField({ name: 'Barn', kind: 'barn', geometryGeojson: polygon([15, 15], 6) });
      createField({ name: 'House', kind: 'residence', geometryGeojson: polygon([-20, 20], 5) });
      createField({ name: 'Undrawn', kind: 'garden' });
      createShadeSource({
        name: 'Oak',
        kind: 'tree-single',
        heightFt: 60,
        isDeciduous: true,
        geometryGeojson: polygon([-15, -15], 4)
      });
      createMapFeature({
        kind: 'hydrant',
        name: 'Yard tap',
        geometry: { type: 'Point', coordinates: ll([0, 25]) }
      } as never);
    });
    const out = await run(f, { useAerial: false });
    expect(out.shadeChecked).toBe(true);
    expect(out.hasWaterPoint).toBe(true);
    expect(out.hasHouse).toBe(true);
    const kinds = out.obstacles.map((o) => `${o.kind}:${o.provenance}`).sort();
    expect(kinds).toEqual(['building:manual', 'building:manual', 'tree:manual']);
    const oak = out.obstacles.find((o) => o.name === 'Oak')!;
    expect(oak).toMatchObject({ heightFt: 60, deciduous: { leafOnDay: 105, leafOffDay: 305 } });
    const factors = out.candidates[0].factors;
    expect(factors.find((x) => x.id === 'water-distance')).toMatchObject({
      key: 'water.dist',
      provenance: 'manual'
    });
    expect(factors.find((x) => x.id === 'house-distance')?.key).toBe('house.dist');
    expect(factors.find((x) => x.id === 'sun')?.provenance).toBe('fallback');
    expect(factors.find((x) => x.id === 'soil-drainage')?.provenance).toBe('data');
  });

  it("never reads another Owner's map", async () => {
    const mine = farm();
    const theirs = farm();
    runWithTenant(theirs.ownerId, () => {
      createField({ name: 'Their barn', kind: 'barn', geometryGeojson: polygon([0, 0], 40) });
      createShadeSource({ name: 'Their oak', heightFt: 80, geometryGeojson: polygon([5, 5], 6) });
      createMapFeature({
        kind: 'water_source',
        name: 'Their well',
        geometry: { type: 'Point', coordinates: ll([0, 0]) }
      } as never);
    });
    const out = await run(mine, { useAerial: false });
    expect(out.candidates).toHaveLength(3);
    expect(out.obstacles).toEqual([]);
    expect(out.hasWaterPoint).toBe(false);
    expect(JSON.stringify(out)).not.toMatch(/Their/);
    const blocked = await run(theirs, { useAerial: false });
    expect(blocked.candidates).toEqual([]);
    runWithTenant(mine.ownerId, () => expect(loadSiteData().areas).toEqual([]));
  });

  it('looks the soil survey up at the box centre and each spot, never more than the cap', async () => {
    const f = farm();
    runWithTenant(f.ownerId, () =>
      createField({ name: 'Barn', kind: 'barn', geometryGeojson: polygon([0, 0], 25) })
    );
    const seen: Array<[number, number]> = [];
    const wet: SoilLookup = { status: 'ok', survey: survey({ drainageClass: 'very-poorly' }) };
    const out = await run(
      f,
      { useAerial: false, box: boxAround(CENTER, 120) },
      {
        soilAt: async (lat, lon) => {
          seen.push([lat, lon]);
          return seen.length === 2 ? wet : okSoil;
        }
      }
    );
    expect(seen.length).toBeGreaterThan(1);
    expect(seen.length).toBeLessThanOrEqual(MAX_SOIL_LOOKUPS);
    expect(seen[0][0]).toBeCloseTo(CENTER[1], 6);
    expect(Object.keys(out.soilBySpot).sort()).toEqual(out.candidates.map((c) => c.id).sort());
    const scores = out.candidates.map((c) => c.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it('an unreachable survey leaves soil unknown and still gives spots', async () => {
    const out = await run(
      farm(),
      { useAerial: false },
      { soilAt: async () => ({ status: 'unavailable' }) }
    );
    expect(out.soil).toEqual({ status: 'unavailable' });
    expect(out.candidates).toHaveLength(3);
    expect(out.candidates[0].factors.find((x) => x.id === 'soil-drainage')).toMatchObject({
      key: 'soil.unavailable',
      verdict: 'unknown'
    });
  });

  it('takes the season from saved frost dates, else the tagged fallback', () => {
    const f = farm();
    runWithTenant(f.ownerId, () => {
      expect(sunSeasonFromSettings().provenance).toBe('fallback');
      setSetting(SETTINGS_KEYS.lastFrost, '05-01');
      setSetting(SETTINGS_KEYS.firstFrost, '10-01');
      const season = sunSeasonFromSettings();
      expect(season.startDay).toBe(121);
      expect(season.endDay).toBe(274);
    });
  });
});

describe('the lay of the land (Phase 38E)', () => {
  const northSlope = (slopePct = 12, resolutionM: number | null = 1) => {
    const calls: Array<SiteFinderRequest['box']> = [];
    return {
      calls,
      terrainFor: async (box: SiteFinderRequest['box']): Promise<TerrainLookup> => {
        calls.push(box);
        return { status: 'ok', grid: planeGrid(box, slopePct, 0, { resolutionM }) };
      }
    };
  };
  const factor = (c: { factors: Array<{ id: string }> }, id: string) =>
    c.factors.find((x) => x.id === id) as
      { key: string; provenance: string; source?: string; verdict: string } | undefined;

  it('reads the slope and the way each spot faces from the elevation grid, once per run', async () => {
    const f = farm();
    const terrain = northSlope();
    const out = await run(f, { useAerial: false }, terrain);
    expect(terrain.calls).toHaveLength(1);
    expect(terrain.calls[0]).toEqual(req().box);
    expect(out.terrain).toEqual({ status: 'ok', source: 'USGS 3DEP', resolutionM: 1 });
    expect(out.candidates).toHaveLength(3);
    for (const c of out.candidates) {
      expect(factor(c, 'facing')).toMatchObject({
        key: 'facing.north',
        provenance: 'data',
        source: 'elevation'
      });
      expect(factor(c, 'slope')).toMatchObject({
        key: 'slope.here.moderate',
        provenance: 'data',
        source: 'elevation'
      });
    }
    const line = out.candidates[0].factors.find((x) => x.id === 'facing')!;
    expect(factorText(line, { units: 'us' })).toBe(
      'Slopes down to the north, so the sun is weaker here in spring and fall.'
    );
    expect(factorText(line, { units: 'us', locale: 'es' })).toBe(
      'Baja hacia el norte, así que el sol es más débil aquí en primavera y otoño.'
    );
    // Not an AI call: nothing is logged and no budget is touched.
    expect(claude.calls).toHaveLength(0);
    expect(logRows(f.ownerId)).toHaveLength(0);
  });

  it('runs with no key and for a farm with AI turned off, as every demo farm is', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const noKey = await run(farm(), {}, northSlope());
    expect(noKey.fallbackReason).toBe('no-key');
    expect(noKey.terrain.status).toBe('ok');
    expect(factor(noKey.candidates[0], 'facing')?.key).toBe('facing.north');

    process.env.ANTHROPIC_API_KEY = 'sk-ant-unit-test';
    const off = farm();
    runWithTenant(off.ownerId, () => setSetting(SETTINGS_KEYS.aiMonthlyUsdCap, '0'));
    const out = await run(off, {}, northSlope());
    expect(out.fallbackReason).toBe('over-cap');
    expect(out.terrain.status).toBe('ok');
    expect(factor(out.candidates[0], 'facing')?.key).toBe('facing.north');
  });

  it('unreachable or missing elevation gives exactly the level-ground result and says so', async () => {
    const f = farm();
    const level = await run(f, { useAerial: false });
    expect(level.terrain).toEqual({ status: 'unavailable', source: 'USGS 3DEP' });
    for (const c of level.candidates) {
      expect(factor(c, 'facing')).toBeUndefined();
      // The soil survey's slope for the map unit is still used for steepness.
      expect(factor(c, 'slope')).toMatchObject({ key: 'slope.flat', provenance: 'data' });
      expect(factor(c, 'slope')?.source).toBeUndefined();
    }
    const noData = await run(
      f,
      { useAerial: false },
      { terrainFor: async () => ({ status: 'no-data' }) }
    );
    expect(noData.terrain).toEqual({ status: 'no-data', source: 'USGS 3DEP' });
    expect(noData.candidates).toEqual(level.candidates);
    const thrown = await run(
      f,
      { useAerial: false },
      {
        terrainFor: async () => {
          throw new Error('boom');
        }
      }
    );
    expect(thrown.terrain.status).toBe('unavailable');
    expect(thrown.candidates).toEqual(level.candidates);
  });

  it('a level grid changes only where the slope line comes from', async () => {
    const f = farm();
    const level = await run(f, { useAerial: false });
    const flat = await run(f, { useAerial: false }, northSlope(0.5));
    expect(flat.candidates.map((c) => c.id)).toEqual(level.candidates.map((c) => c.id));
    for (const [i, c] of flat.candidates.entries()) {
      expect(factor(c, 'facing')).toBeUndefined();
      expect(factor(c, 'slope')).toMatchObject({ key: 'slope.here.flat', source: 'elevation' });
      expect(factor(c, 'sun')).toEqual(factor(level.candidates[i], 'sun'));
    }
  });

  it('says when the elevation data is coarser than the spot', async () => {
    const out = await run(farm(), { useAerial: false }, northSlope(12, 30));
    expect(out.terrain.resolutionM).toBe(30);
    const line = out.candidates[0].factors.find((x) => x.id === 'slope')!;
    expect(factorText(line, { units: 'us' })).toMatch(/coarse elevation data/);
  });

  it("the owner's slope for a drawn block wins over the elevation grid, tagged manual", async () => {
    const f = farm();
    const areaId = runWithTenant(f.ownerId, () => {
      const area = createField({
        name: 'Old garden',
        kind: 'garden',
        geometryGeojson: polygon([0, 0], 40)
      });
      const block = createBlock({
        name: 'Bed',
        fieldId: area.id,
        geometryGeojson: polygon([0, 0], 40)
      });
      updateBlock(block.id, { slopePercent: 6, slopeAspectDeg: 180 });
      const other = createBlock({ name: 'Half', geometryGeojson: polygon([200, 200], 5) });
      updateBlock(other.id, { slopePercent: 9 });
      return area.id;
    });
    runWithTenant(f.ownerId, () => {
      const slopes = loadSiteData().ownerSlopes;
      expect(slopes).toHaveLength(1);
      expect(slopes[0]).toMatchObject({ slopePct: 6, aspectDeg: 180 });
    });
    const out = await run(f, { useAerial: false, allowOverlapAreaIds: [areaId] }, northSlope(20));
    expect(out.candidates.length).toBeGreaterThan(0);
    for (const c of out.candidates) {
      expect(factor(c, 'slope')).toMatchObject({ key: 'slope.here.gentle', provenance: 'manual' });
      expect(factor(c, 'slope')?.source).toBeUndefined();
      expect(factor(c, 'facing')).toMatchObject({ key: 'facing.south', provenance: 'manual' });
    }
    // With the elevation service out of reach the owner's values still count.
    const offline = await run(f, { useAerial: false, allowOverlapAreaIds: [areaId] });
    expect(offline.terrain.status).toBe('unavailable');
    expect(factor(offline.candidates[0], 'facing')).toMatchObject({ provenance: 'manual' });
  });

  it("never reads another Owner's block slopes", async () => {
    const mine = farm();
    const theirs = farm();
    runWithTenant(theirs.ownerId, () => {
      const block = createBlock({ name: 'Their bed', geometryGeojson: polygon([0, 0], 28) });
      updateBlock(block.id, { slopePercent: 30, slopeAspectDeg: 0 });
    });
    runWithTenant(mine.ownerId, () => expect(loadSiteData().ownerSlopes).toEqual([]));
    const out = await run(mine, { useAerial: false });
    expect(out.candidates.every((c) => !factor(c, 'facing'))).toBe(true);
  });

  it('a user past the per-minute limit gets level ground, not an error', async () => {
    const f = farm();
    const terrain = northSlope();
    for (let i = 0; i < TERRAIN_PER_MINUTE; i++) {
      resetSoilRateLimit();
      expect((await run(f, { useAerial: false }, terrain)).terrain.status).toBe('ok');
    }
    resetSoilRateLimit();
    const over = await run(f, { useAerial: false }, terrain);
    expect(over.terrain.status).toBe('unavailable');
    expect(over.candidates).toHaveLength(3);
    expect(terrain.calls).toHaveLength(TERRAIN_PER_MINUTE);
  });

  it("keeps the terrain when Claude's reading is used, and tells Claude nothing about it", async () => {
    const f = farm();
    const out = await run(f, {}, northSlope());
    expect(out.provenance).toBe('ai');
    expect(out.terrain.status).toBe('ok');
    expect(out.candidates.every((c) => factor(c, 'facing')?.key === 'facing.north')).toBe(true);
    const sent = JSON.stringify(claude.calls);
    expect(sent).not.toMatch(/elevation|3DEP|aspect|facing|percent|12%/i);
    // The prompt is the one Phase 38D shipped: its only mention of slope is
    // the instruction not to guess it.
    expect(sent.match(/slope/gi)).toHaveLength(1);
  });
});

describe('the aerial photo reading', () => {
  it('sends only the NAIP photo to the Sonnet tier and tags what Claude saw as ai', async () => {
    const f = farm();
    const photo = naip();
    const out = await run(f, {}, { naip: photo });
    expect(out.provenance).toBe('ai');
    expect(out.imagery.used).toBe(true);
    expect(out.message).toBeNull();
    expect(photo.calls).toHaveLength(1);
    expect(new URL(photo.calls[0]).hostname).toBe('imagery.nationalmap.gov');
    expect(claude.calls).toHaveLength(1);
    expect(claude.calls[0].model).toBe(selectModel('siteFinder').model);
    expect(claude.calls[0].model).toMatch(/sonnet/);
    expect(claude.calls[0].max_tokens).toBe(maxTokensFor('siteFinder'));
    const content = claude.calls[0].content as Array<{
      type: string;
      source?: { media_type: string };
      text?: string;
    }>;
    expect(content.map((c) => c.type)).toEqual(['image', 'text']);
    expect(content[0].source?.media_type).toBe('image/jpeg');
    expect(content[1].text).toContain(SITE_FINDER_FIXTURE_MARKER);
    expect(content[1].text).toMatch(/North is up/);

    expect(out.seen.map((s) => s.kind)).toEqual(['tree', 'building', 'tree-line', 'open-lawn']);
    expect(out.seen.filter((s) => s.obstacleId).length).toBe(3);
    expect(out.obstacles.every((o) => o.provenance === 'ai' && o.heightFt === null)).toBe(true);
    expect(out.shadeChecked).toBe(true);
    expect(out.aiCaveats).toBe('Placeholder caveat.');
    expect(out.aiSpots).toHaveLength(1);
    expect(out.candidates).toHaveLength(3);

    const rows = logRows(f.ownerId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      provenance: 'ai',
      success: true,
      inputTokens: 2100,
      outputTokens: 300
    });
    expect(rows[0].usdEstimate).toBeGreaterThan(0);
    expect(rows[0].usdEstimate).toBeLessThanOrEqual(AI_RESERVE_USD['site-finder']);
  });

  it("puts Claude's reason on the spot it names, and the order stays the engine's", async () => {
    const f = farm();
    const plain = await run(f, { useAerial: false });
    claude.text = JSON.stringify({
      features: [],
      spots: [{ x: 0.5, y: 0.5, reason: 'Open ground in the middle.' }]
    });
    const out = await run(f);
    expect(out.candidates.map((c) => c.id)).toEqual(plain.candidates.map((c) => c.id));
    expect(out.candidates.map((c) => c.score)).toEqual(plain.candidates.map((c) => c.score));
    const note = out.aiSpots[0];
    expect(note.candidateId).toBe(
      out.candidates.find((c) => c.factors.some((x) => x.id === 'ai-note'))?.id ?? null
    );
    if (note.candidateId) {
      expect(note.engineReason).toBeNull();
      const factor = out.candidates
        .find((c) => c.id === note.candidateId)!
        .factors.find((x) => x.id === 'ai-note');
      expect(factor).toMatchObject({
        provenance: 'ai',
        params: { text: 'Open ground in the middle.' }
      });
    } else {
      expect(note.engineReason).toBe('lower-score');
    }
  });

  it('a spot Claude liked that the engine dropped is shown with the engine reason', async () => {
    const f = farm();
    runWithTenant(f.ownerId, () =>
      createField({ name: 'Barn', kind: 'barn', geometryGeojson: polygon([0, 0], 8) })
    );
    claude.text = JSON.stringify({
      features: [],
      spots: [{ x: 0.5, y: 0.5, reason: 'Looks open here.' }]
    });
    const out = await run(f);
    expect(out.aiSpots[0]).toMatchObject({ candidateId: null, engineReason: 'area' });
    expect(out.candidates.every((c) => !c.factors.some((x) => x.id === 'ai-note'))).toBe(true);
  });

  it('an ai tree shades and crowds spots, and one already on the map is not counted twice', async () => {
    const f = farm();
    runWithTenant(f.ownerId, () =>
      createShadeSource({
        name: 'Oak',
        kind: 'tree-single',
        heightFt: 60,
        geometryGeojson: polygon([0, 0], 4)
      })
    );
    claude.text = JSON.stringify({
      features: [
        { kind: 'tree', x: 0.5, y: 0.5, radius: 0.05, note: 'Tree in the middle' },
        { kind: 'tree', x: 0.1, y: 0.1, radius: 0.05 }
      ],
      spots: []
    });
    const out = await run(f);
    expect(out.seen[0]).toMatchObject({ onMap: true, obstacleId: null });
    expect(out.seen[1]).toMatchObject({ onMap: false, obstacleId: 'ai2' });
    expect(out.obstacles.filter((o) => o.provenance === 'ai').map((o) => o.id)).toEqual(['ai2']);
    expect(out.obstacles.filter((o) => o.provenance === 'manual')).toHaveLength(1);
  });

  it.each([
    ['prose around the JSON', 'Here you go: {"features":[],"spots":[]}'],
    ['not JSON at all', 'I cannot read this photo.'],
    [
      'a position outside the photo',
      JSON.stringify({ features: [{ kind: 'tree', x: 1.4, y: 0.2 }], spots: [] })
    ],
    [
      'too many spots',
      JSON.stringify({ features: [], spots: Array(4).fill({ x: 0.5, y: 0.5, reason: 'Open.' }) })
    ],
    [
      'a product name',
      JSON.stringify({
        features: [],
        spots: [{ x: 0.5, y: 0.5, reason: 'Spray Roundup here first.' }]
      })
    ],
    ['an extra field', JSON.stringify({ features: [], spots: [], advice: 'Add lime.' })]
  ])('an unusable reading (%s) falls back to the deterministic result', async (_name, text) => {
    const f = farm();
    const plain = await run(f, { useAerial: false });
    claude.text = text;
    const out = await run(f);
    expect(out.provenance).toBe('fallback');
    expect(out.fallbackReason).toBe('invalid');
    expect(out.message).toMatch(/could not be used/);
    expect(out.candidates).toEqual(plain.candidates);
    expect(out.seen).toEqual([]);
    expect(out.obstacles).toEqual([]);
    expect(out.imagery.used).toBe(false);
    expect(JSON.stringify(out)).not.toMatch(/Roundup|lime/i);
    const rows = logRows(f.ownerId);
    const spent = rows.filter((r) => r.inputTokens > 0);
    expect(spent).toHaveLength(1);
    expect(spent[0]).toMatchObject({ success: false, provenance: 'fallback' });
    expect(rows.some((r) => (r.errorClass ?? '').startsWith('reading-refused:'))).toBe(true);
  });

  it.each([
    ['no coverage', 'png'],
    ['service down', 'down']
  ] as const)('no usable photo (%s) never calls Claude and says so', async (_name, kind) => {
    const f = farm();
    const photo = naip(kind);
    const out = await run(f, {}, { naip: photo });
    expect(out.provenance).toBe('fallback');
    expect(out.fallbackReason).toBe('no-photo');
    expect(out.message).toMatch(/No USDA aerial photo could be loaded/);
    expect(out.aiLimit ?? null).toBeNull();
    expect(out.candidates).toHaveLength(3);
    expect(photo.calls).toHaveLength(1);
    expect(claude.calls).toHaveLength(0);
    const rows = logRows(f.ownerId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ inputTokens: 0, usdEstimate: 0, fallbackReason: 'offline' });
  });

  it('with weather feeds off there is no photo', async () => {
    process.env.WEATHER_FEEDS = 'off';
    const photo = naip();
    const out = await run(farm(), {}, { naip: photo });
    expect(out.fallbackReason).toBe('no-photo');
    expect(photo.calls).toHaveLength(0);
    expect(claude.calls).toHaveLength(0);
  });
});

describe('plan allowances (owner ruling O-3)', () => {
  const small = { box: boxAround(CENTER, 20), footprintFt: { width: 30, length: 30 } };

  it.each([
    [null, 1],
    ['grower', 5],
    ['farm', 10]
  ] as const)('plan %s gets %i photo readings a day, then the plain result', async (plan, cap) => {
    const f = farm(plan);
    const planId = plan ?? 'free';
    expect(PLANS[planId].dailyQuota['site-finder']).toBe(cap);
    for (let i = 0; i < cap; i++) {
      const out = await run(f, small);
      expect(out.provenance, `run ${i + 1}`).toBe('ai');
    }
    const over = await run(f, small);
    expect(over.provenance).toBe('fallback');
    expect(over.fallbackReason).toBe('quota');
    expect(over.aiLimit).toMatchObject({ detail: 'daily-quota' });
    expect(over.candidates.length).toBeGreaterThan(0);
    expect(claude.calls).toHaveLength(cap);
  });

  it('fallback rows do not use up the daily allowance', async () => {
    const f = farm(null);
    for (let i = 0; i < 3; i++) {
      const out = await run(f, small, { naip: naip('png') });
      expect(out.fallbackReason).toBe('no-photo');
    }
    expect((await run(f, small)).provenance).toBe('ai');
  });

  it('draws on the general monthly budget and stops when it is used up', async () => {
    const f = farm('grower');
    runWithTenant(f.ownerId, () => setSetting(SETTINGS_KEYS.aiMonthlyUsdCap, '0.03'));
    const out = await run(f, small);
    expect(out.provenance).toBe('fallback');
    expect(out.fallbackReason).toBe('over-cap');
    expect(out.aiLimit).toMatchObject({ detail: 'monthly-budget' });
    expect(claude.calls).toHaveLength(0);
  });

  it('the reserve covers one worst-case Sonnet vision call', () => {
    const { pricing } = selectModel('siteFinder');
    const imageTokens = (1024 * 1024) / 750;
    const promptTokens =
      buildSiteReadPrompt({
        goal: 'row-crop-field',
        footprint: { widthFt: 1000, lengthFt: 1000 },
        photoWidthFt: 1312
      }).length / 3;
    const worst =
      ((imageTokens + promptTokens) / 1e6) * pricing.inputUsdPerMTok +
      (maxTokensFor('siteFinder') / 1e6) * pricing.outputUsdPerMTok;
    expect(worst).toBeLessThanOrEqual(AI_RESERVE_USD['site-finder']);
    expect(AI_RESERVE_USD['site-finder']).toBeLessThan(0.1);
  });
});
