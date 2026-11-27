/**
 * Find a spot (Phase 38D). The deterministic result (sun math, the owner's
 * map, the USDA soil survey and, since Phase 38E, the ground's slope and
 * facing direction from USGS 3DEP elevation) is always computed first. The
 * elevation lookup is not an AI call and runs on every search; when it
 * fails the ground is treated as level. When the owner
 * asks for it, Claude also reads one USDA NAIP aerial photo through
 * `tryAiWithGuard`; what it saw is added as `ai` obstacles and the engine
 * ranks again. The order is always the engine's. Any reason the reading
 * cannot be used gives the deterministic result tagged `fallback` (P-7).
 * Nothing is saved here except the AI call log.
 */

import { aiLimitReason, type AiLimit } from '$lib/billing/aiLimit';
import { listBlocks } from '$lib/db/blocks';
import { listFields } from '$lib/db/fields';
import { listMapFeatureViews } from '$lib/db/mapFeatures';
import { listShadeSources, type ShadeSource } from '$lib/db/shadeSources';
import { snapshotFrostFromSettings } from '$lib/climate/frostSettings.server';
import { t, type MessageKey } from '$lib/i18n';
import { aiLimitOf, recordFallback, tryAiWithGuard } from '$lib/server/aiDegrade';
import { recordCall } from '$lib/server/aiGuard';
import { allowSoilLookup, soilSurveyAt } from '$lib/server/soil/ssurgo.server';
import { currentSprayTerms } from '$lib/server/sprayTerms';
import type { SoilLookup } from '$lib/soil/types';
import { seenFeatures, type AiReading, type SeenFeature } from '$lib/siteFinder/aiAnswer';
import {
  NAIP_SOURCE_NAME,
  type AiSpotNote,
  type SeenItem,
  type SiteFinderRequest,
  type SiteFinderResponse,
  type SiteFinderTerrain,
  type SiteFinderWhy
} from '$lib/siteFinder/apiSchemas';
import {
  findSpots,
  nearObstacle,
  rescoreWithSoil,
  whyBlocked,
  type FinderInput,
  type WaterPoint
} from '$lib/siteFinder/candidates';
import {
  boxCenter,
  FT_TO_M,
  geojsonShape,
  imageToLonLat,
  localFrame,
  photoExtentFor,
  toLocal
} from '$lib/siteFinder/geometry';
import { TERRAIN_SOURCE_NAME, type OwnerSlope, type TerrainLookup } from '$lib/siteFinder/terrain';
import {
  FALLBACK_SEASON,
  type AreaShape,
  type Candidate,
  type Obstacle,
  type ObstacleKind,
  type SunSeason
} from '$lib/siteFinder/types';
import { readSitePhoto, SiteReadRefusedError, type SiteReadResult } from './aiSiteRead';
import { naipPhotoFor, type NaipFetcher, type NaipPhoto } from './naip.server';
import { allowTerrainLookup, terrainGridFor } from './terrain.server';

export const SITE_FINDER_TIMEOUT_MS = 30_000;
/** At most this many soil survey lookups per run: the box centre and the
 *  offered spots. */
export const MAX_SOIL_LOOKUPS = 4;
/** Spots closer together than this share one soil lookup. */
export const SOIL_SAME_POINT_M = 15;
/** Something Claude saw this close to something already on the owner's map
 *  is the same thing. A rough app value. */
export const SAME_FEATURE_MARGIN_M = 3;
// Shapes for drawn shade sources that are a point or a line. Rough app values.
export const DRAWN_POINT_RADIUS_M = 3;
export const DRAWN_LINE_HALF_WIDTH_M = 2;

class NoPhotoError extends Error {
  constructor(readonly status: NaipPhoto['status']) {
    super(`no aerial photo: ${status}`);
    this.name = 'NoPhotoError';
  }
}

const SHADE_KIND: Record<ShadeSource['kind'], ObstacleKind> = {
  'tree-row': 'tree-line',
  'tree-grove': 'tree',
  'tree-single': 'tree',
  hedge: 'tree-line',
  building: 'building',
  fence: 'other',
  structure: 'building',
  other: 'other'
};

function shadeObstacle(s: ShadeSource): Obstacle | null {
  const g = geojsonShape(s.geometryGeojson);
  if (!g) return null;
  return {
    id: `shade:${s.id}`,
    kind: SHADE_KIND[s.kind] ?? 'other',
    shape:
      g.type === 'polygon'
        ? { type: 'polygon', ring: g.ring }
        : g.points.length === 1
          ? { type: 'circle', center: g.points[0], radiusM: DRAWN_POINT_RADIUS_M }
          : { type: 'line', points: g.points, halfWidthM: DRAWN_LINE_HALF_WIDTH_M },
    heightFt: s.heightFt,
    deciduous: s.isDeciduous
      ? { leafOnDay: s.leafOnDayOfYear, leafOffDay: s.leafOffDayOfYear }
      : null,
    name: s.name,
    provenance: 'manual'
  };
}

function dayOfYearOf(mmdd: string | null): number | null {
  const m = /^(\d{2})-(\d{2})$/.exec(mmdd ?? '');
  if (!m) return null;
  const ms = Date.UTC(2025, Number(m[1]) - 1, Number(m[2]));
  const day = Math.round((ms - Date.UTC(2025, 0, 0)) / 86_400_000);
  return day >= 1 && day <= 366 ? day : null;
}

export function sunSeasonFromSettings(): SunSeason {
  const frost = snapshotFrostFromSettings();
  const start = dayOfYearOf(frost.lastSpring);
  const end = dayOfYearOf(frost.firstFall);
  if (start === null || end === null) return FALLBACK_SEASON;
  return { startDay: start, endDay: end, provenance: frost.provenance };
}

export interface SiteData {
  areas: AreaShape[];
  obstacles: Obstacle[];
  water: WaterPoint[];
  season: SunSeason;
  /** Drawn blocks whose owner typed both a slope and the way it faces. */
  ownerSlopes: OwnerSlope[];
}

/** Everything the finder reads from the active Owner's farm. Tenant-scoped
 *  repos only. */
export function loadSiteData(): SiteData {
  const areas: AreaShape[] = [];
  const obstacles: Obstacle[] = [];
  const ownerSlopes: OwnerSlope[] = [];
  const fields = listFields();
  const kindOf = new Map(fields.map((f) => [f.id, f.kind]));
  for (const f of fields) {
    const g = geojsonShape(f.geometryGeojson);
    if (g?.type !== 'polygon') continue;
    areas.push({ id: `area:${f.id}`, areaId: f.id, name: f.name, kind: f.kind, ring: g.ring });
    if (f.kind === 'barn' || f.kind === 'residence' || f.kind === 'coop_pen') {
      obstacles.push({
        id: `building:${f.id}`,
        kind: 'building',
        shape: { type: 'polygon', ring: g.ring },
        heightFt: null,
        name: f.name,
        provenance: 'manual'
      });
    } else if (f.kind === 'natural_area') {
      obstacles.push({
        id: `woods:${f.id}`,
        kind: 'tree',
        shape: { type: 'polygon', ring: g.ring },
        heightFt: null,
        name: f.name,
        provenance: 'manual'
      });
    }
  }
  for (const b of listBlocks({ plantings: 'none' })) {
    const g = geojsonShape(b.geometryGeojson);
    if (g?.type !== 'polygon') continue;
    areas.push({
      id: `block:${b.id}`,
      areaId: b.fieldId ?? b.id,
      name: b.name,
      kind: (b.fieldId && kindOf.get(b.fieldId)) || 'field',
      ring: g.ring
    });
    if (
      typeof b.slopePercent === 'number' &&
      typeof b.slopeAspectDeg === 'number' &&
      Number.isFinite(b.slopePercent) &&
      Number.isFinite(b.slopeAspectDeg) &&
      b.slopePercent >= 0
    ) {
      ownerSlopes.push({
        id: b.id,
        ring: g.ring,
        slopePct: b.slopePercent,
        aspectDeg: b.slopeAspectDeg
      });
    }
  }
  for (const s of listShadeSources()) {
    const o = shadeObstacle(s);
    if (o) obstacles.push(o);
  }
  const water: WaterPoint[] = [];
  for (const m of listMapFeatureViews()) {
    if ((m.kind !== 'water_source' && m.kind !== 'hydrant') || m.geometry?.type !== 'Point') {
      continue;
    }
    const [lon, lat] = m.geometry.coordinates;
    water.push({ id: m.id, name: m.name, point: [lon, lat] });
  }
  return { areas, obstacles, water, season: sunSeasonFromSettings(), ownerSlopes };
}

const WHY_KEY: Record<SiteFinderWhy, MessageKey> = {
  'no-key': 'sitefinder.why.noKey',
  'over-cap': 'sitefinder.why.overCap',
  quota: 'sitefinder.why.quota',
  'rate-limit': 'sitefinder.why.rateLimit',
  offline: 'sitefinder.why.offline',
  timeout: 'sitefinder.why.timeout',
  invalid: 'sitefinder.why.invalid',
  'no-photo': 'sitefinder.why.noPhoto'
};

/** The banner over a result when the photo reading was asked for and did
 *  not happen. */
export function siteFinderMessage(
  why: SiteFinderWhy,
  limit: AiLimit | null,
  locale?: string | null
): string {
  const lead = limit
    ? t(locale, 'sitefinder.why.limit', { reason: aiLimitReason(limit, locale) })
    : t(locale, WHY_KEY[why]);
  return `${lead} ${t(locale, 'sitefinder.why.still')}`;
}

export interface RunArgs {
  userId: string;
  req: SiteFinderRequest;
  locale?: string | null;
  /** Test seams. */
  naipFetcher?: NaipFetcher;
  soilAt?: (lat: number, lon: number) => Promise<SoilLookup>;
  terrainFor?: (box: SiteFinderRequest['box']) => Promise<TerrainLookup>;
  sprayTerms?: readonly string[];
}

/** The elevation grid for the search box. Any failure, and a user past the
 *  per-minute limit, is "unavailable": the ground is then treated as level. */
async function terrainFor(args: RunArgs): Promise<TerrainLookup> {
  if (!allowTerrainLookup(args.userId)) return { status: 'unavailable' };
  try {
    return await (args.terrainFor ?? terrainGridFor)(args.req.box);
  } catch {
    return { status: 'unavailable' };
  }
}

function terrainSummary(lookup: TerrainLookup): SiteFinderTerrain {
  const resolutionM = lookup.status === 'ok' ? lookup.grid.resolutionM : null;
  return {
    status: lookup.status,
    source: TERRAIN_SOURCE_NAME,
    ...(resolutionM !== null ? { resolutionM } : {})
  };
}

async function soilFor(args: RunArgs, lon: number, lat: number): Promise<SoilLookup> {
  if (!allowSoilLookup(args.userId)) return { status: 'unavailable' };
  try {
    return await (args.soilAt ?? soilSurveyAt)(lat, lon);
  } catch {
    return { status: 'unavailable' };
  }
}

/** Ranks, then scores each offered spot with the survey at its own centre
 *  (at most `MAX_SOIL_LOOKUPS` lookups a run, the box centre included). */
async function rankWithSoil(
  args: RunArgs,
  input: FinderInput
): Promise<{ candidates: Candidate[]; soilBySpot: Record<string, SoilLookup>; tooBig: boolean }> {
  const first = findSpots(input);
  const center = boxCenter(input.box);
  const frame = localFrame(center);
  const soilById = new Map<string, SoilLookup>();
  const looked: Array<{ p: [number, number]; soil: SoilLookup }> = [
    { p: [0, 0], soil: input.soil }
  ];
  for (const c of first.candidates) {
    const p = toLocal(frame, c.center);
    const same = looked.find((l) => Math.hypot(l.p[0] - p[0], l.p[1] - p[1]) <= SOIL_SAME_POINT_M);
    if (same) {
      soilById.set(c.id, same.soil);
      continue;
    }
    if (looked.length >= MAX_SOIL_LOOKUPS) continue;
    const soil = await soilFor(args, c.center[0], c.center[1]);
    looked.push({ p, soil });
    // A spot whose own lookup failed keeps the box-centre survey.
    soilById.set(c.id, soil.status === 'unavailable' ? input.soil : soil);
  }
  return {
    candidates: rescoreWithSoil(input, first.candidates, soilById),
    soilBySpot: Object.fromEntries(soilById),
    tooBig: first.tooBig
  };
}

function withAiNotes(
  input: FinderInput,
  candidates: Candidate[],
  reading: AiReading,
  extent: ReturnType<typeof photoExtentFor>
): { candidates: Candidate[]; aiSpots: AiSpotNote[] } {
  const frame = localFrame(boxCenter(input.box));
  const reach = (Math.max(input.footprint.widthFt, input.footprint.lengthFt) * FT_TO_M) / 2;
  const out = candidates.map((c) => ({ ...c, factors: [...c.factors] }));
  const aiSpots: AiSpotNote[] = [];
  for (const s of seenSpots(reading, extent)) {
    const p = toLocal(frame, s.center);
    let hit: Candidate | null = null;
    let best = Infinity;
    for (const c of out) {
      const q = toLocal(frame, c.center);
      const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
      if (d <= reach && d < best) {
        best = d;
        hit = c;
      }
    }
    if (hit) {
      hit.factors.push({
        id: 'ai-note',
        verdict: 'good',
        key: 'ai.note',
        params: { text: s.reason },
        provenance: 'ai'
      });
    }
    aiSpots.push({
      center: s.center,
      reason: s.reason,
      candidateId: hit?.id ?? null,
      engineReason: hit ? null : (whyBlocked(input, s.center) ?? 'lower-score')
    });
  }
  return { candidates: out, aiSpots };
}

function seenSpots(reading: AiReading, extent: ReturnType<typeof photoExtentFor>) {
  return reading.spots.map((s) => ({
    center: imageToLonLat(extent, s.x, s.y),
    reason: s.reason
  }));
}

export async function runSiteFinder(args: RunArgs): Promise<SiteFinderResponse> {
  const { req, userId, locale } = args;
  const data = loadSiteData();
  const center = boxCenter(req.box);
  const [soil, terrain] = await Promise.all([
    soilFor(args, center[0], center[1]),
    terrainFor(args)
  ]);
  const base: FinderInput = {
    goal: req.goal,
    box: req.box,
    footprint: { widthFt: req.footprintFt.width, lengthFt: req.footprintFt.length },
    obstacles: data.obstacles,
    areas: data.areas,
    allowOverlapAreaIds: req.allowOverlapAreaIds ?? [],
    water: data.water,
    soil,
    season: data.season,
    shadeChecked: data.obstacles.length > 0,
    terrain:
      terrain.status === 'ok' || data.ownerSlopes.length > 0
        ? { grid: terrain.status === 'ok' ? terrain.grid : null, ownerSlopes: data.ownerSlopes }
        : null
  };
  const common = {
    soil,
    terrain: terrainSummary(terrain),
    season: data.season,
    hasWaterPoint: data.water.length > 0,
    hasHouse: data.areas.some((a) => a.kind === 'residence')
  };

  const deterministic = async (
    extra: Pick<SiteFinderResponse, 'fallbackReason' | 'message' | 'aiLimit'> = {}
  ): Promise<SiteFinderResponse> => {
    const ranked = await rankWithSoil(args, base);
    return {
      provenance: 'fallback',
      fallbackReason: null,
      message: null,
      ...extra,
      candidates: ranked.candidates,
      obstacles: data.obstacles,
      seen: [],
      aiSpots: [],
      aiCaveats: null,
      soilBySpot: ranked.soilBySpot,
      shadeChecked: base.shadeChecked,
      tooBig: ranked.tooBig,
      imagery: { source: NAIP_SOURCE_NAME, used: false },
      ...common
    };
  };

  if (!req.useAerial) return deterministic();

  const extent = photoExtentFor(req.box);
  const sprayTerms = args.sprayTerms ?? (await currentSprayTerms());
  const tried = await tryAiWithGuard<SiteReadResult>({
    endpoint: 'site-finder',
    userId,
    timeoutMs: SITE_FINDER_TIMEOUT_MS,
    locale,
    prompt: async (signal) => {
      const photo = await naipPhotoFor(extent, { fetcher: args.naipFetcher });
      if (photo.status !== 'ok') throw new NoPhotoError(photo.status);
      return readSitePhoto(
        { goal: req.goal, footprint: base.footprint, photoWidthFt: extent.groundM / FT_TO_M },
        photo,
        sprayTerms,
        signal
      );
    }
  });

  if (tried.provenance === 'fallback') {
    const noPhoto = tried.error instanceof NoPhotoError;
    const refused = tried.error instanceof SiteReadRefusedError;
    const why: SiteFinderWhy = noPhoto
      ? 'no-photo'
      : refused
        ? 'invalid'
        : !tried.guard.ok && tried.guard.reason === 'quota-exceeded'
          ? 'quota'
          : tried.fallbackReason;
    recordFallback(
      userId,
      'site-finder',
      noPhoto ? 'offline' : tried.fallbackReason,
      refused ? `reading-refused:${(tried.error as SiteReadRefusedError).refusal}` : why
    );
    const limit = noPhoto || refused ? null : aiLimitOf(tried.guard);
    return deterministic({
      fallbackReason: why,
      message: siteFinderMessage(why, limit, locale),
      aiLimit: limit
    });
  }

  const { reading, meta } = tried.value;
  try {
    recordCall({
      userId,
      endpoint: 'site-finder',
      model: meta.model,
      inputTokens: meta.inputTokens,
      cachedInputTokens: meta.cachedInputTokens,
      outputTokens: meta.outputTokens,
      usdEstimate: meta.usdEstimate,
      success: true,
      provenance: 'ai'
    });
  } catch (err) {
    console.error('[ai] site-finder recordCall failed', err);
  }

  const seenAll: SeenFeature[] = seenFeatures(reading, extent);
  const seen: SeenItem[] = [];
  const aiObstacles: Obstacle[] = [];
  for (const s of seenAll) {
    const onMap =
      !!s.obstacle && nearObstacle(req.box, s.center, data.obstacles, SAME_FEATURE_MARGIN_M);
    if (s.obstacle && !onMap) aiObstacles.push(s.obstacle);
    seen.push({
      id: s.id,
      kind: s.kind,
      center: s.center,
      ...(s.note ? { note: s.note } : {}),
      obstacleId: s.obstacle && !onMap ? s.obstacle.id : null,
      onMap
    });
  }
  const withAi: FinderInput = {
    ...base,
    obstacles: [...data.obstacles, ...aiObstacles],
    shadeChecked: true
  };
  const ranked = await rankWithSoil(args, withAi);
  const noted = withAiNotes(withAi, ranked.candidates, reading, extent);
  return {
    provenance: 'ai',
    fallbackReason: null,
    message: null,
    candidates: noted.candidates,
    obstacles: [...withAi.obstacles],
    seen,
    aiSpots: noted.aiSpots,
    aiCaveats: reading.caveats ?? null,
    soilBySpot: ranked.soilBySpot,
    shadeChecked: true,
    tooBig: ranked.tooBig,
    imagery: { source: NAIP_SOURCE_NAME, used: true },
    ...common
  };
}
