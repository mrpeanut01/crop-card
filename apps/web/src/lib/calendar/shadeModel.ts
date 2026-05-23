/**
 * Shade impact model (v2 — Phase 14 §shade-model).
 *
 * Replaces the v1 "eastWestIndex ±1 neighbor" heuristic with proper sun-path
 * geometry. Inputs:
 *   - emitters (shade-casting crops + external shade sources like tree rows)
 *   - target blocks (with optional geometry + slope)
 *   - farm lat/lon (used by solar.ts)
 *   - active date window (when canopy is up)
 *
 * For each emitter × target × sample-hour, the model computes:
 *   - shadow direction (from sun azimuth)
 *   - shadow length (from canopy height + sun elevation, modulated by slope)
 *   - whether the target falls within the shadow polygon
 *   - effective intensity = opacity × canopy-fraction × density-mod × distance-falloff
 *
 * Output is a flat list of `ShadeImpact` records, one per emitter × target ×
 * time-window. The engine wraps each in a `CalendarEvent` with kind
 * `shade-window` and the existing `ShadeImpactEvent.detail` shape.
 *
 * The model is a planning hint — directionally correct, ±1 day on activation
 * windows, ±10% on intensity. Not a yield/insolation model.
 */

import {
  bearingDeg,
  haversineMeters,
  metersSquaredToAcres,
  polygonAreaSqMeters
} from '$lib/geo/area';
import { feetToMeters, shadowDirectionDeg, shadowLengthMeters, solarPosition } from './solar';

/** Sample hours (clock-local) used to assess shadow projections across the
 *  diurnal arc. Clock time → solar time conversion happens inside solar.ts.
 *
 *  Loudoun-area DST note: clock-local 17:00 in summer maps to solar ~15:50,
 *  giving us the late-afternoon eastward-pointing shadow that would shade
 *  blocks east of a west-side emitter (e.g., a tree row west of a field
 *  shading the field's east side after lunch). Without this sample the
 *  model under-counts evening shade in DST regions. Solar elevation
 *  filter at 5° drops any sample where the sun is too low to matter. */
const SAMPLE_HOURS = [9, 12, 15, 17] as const;
type SampleHour = (typeof SAMPLE_HOURS)[number];

const SAMPLE_LABEL: Record<SampleHour, 'am' | 'mid' | 'pm'> = {
  9: 'am',
  12: 'mid',
  15: 'pm',
  17: 'pm'
};

/** Maximum useful shadow distance. At low sun angles shadows are technically
 *  hundreds of meters long but lose practical relevance. Loudoun-scale farms
 *  rarely have meaningful shading beyond ~60m. */
const MAX_SHADOW_METERS = 60;

/** Default approximate block radius in meters when no footprint is provided.
 *  ~6 m corresponds to a 0.04-acre (≈ 12m × 12m) sub-plot — typical for the
 *  small-plot operations CropCard targets. The model subtracts this from
 *  centroid-to-centroid distance to approximate edge-to-edge shadow reach. */
const DEFAULT_BLOCK_RADIUS_M = 6;

/**
 * One emitter contributing shadow into the model. Crops and external shade
 * sources both flatten into this shape so the projection logic is uniform.
 */
export interface ShadeEmitter {
  id: string;
  /** Free-form display label used for attribution (`shade from <name>`). */
  displayName: string;
  /** What kind of emitter this is — drives UI grouping + tooltip wording. */
  kind:
    | 'crop'
    | 'tree-row'
    | 'tree-grove'
    | 'tree-single'
    | 'hedge'
    | 'building'
    | 'fence'
    | 'structure'
    | 'other';
  /** Source block id when the emitter is a crop, else null. */
  sourceBlockId: string | null;
  /** Source crop id when the emitter is a crop, else null. */
  sourceCropId: string | null;
  /** Centroid in [lon, lat]. Required for direction-aware projection.
   *  When null, the emitter contributes no impact (caller logs/skips). */
  centroidLonLat: [number, number] | null;
  /** Outer-ring footprint polygon in [lon, lat] (optional). When present
   *  the model uses bbox/edges for occlusion; otherwise uses centroid only. */
  footprint: Array<[number, number]> | null;
  /** Canopy height at maturity, in feet. */
  heightFt: number;
  /** Opacity 0..1. 1 = solid (building), 0.7 = leafed deciduous, 0.2 = bare. */
  opacity: number;
  /** Density multiplier (crops only). 1.0 = reference; range [0.5, 1.5].
   *  External sources should pass 1.0. */
  densityMultiplier: number;
  /** Returns canopy fraction 0..1 for a given epoch-ms date. Crops use stage
   *  projection; deciduous trees use leaf-on/leaf-off windows; evergreens 1. */
  canopyAtMs: (dateMs: number) => number;
  /** Optional absolute epoch-ms when canopy starts to matter (for window
   *  clamping). When omitted, defaults to the model's `fromMs`. */
  canopyStartMs?: number;
  /** Optional absolute epoch-ms when canopy stops mattering. */
  canopyEndMs?: number;
}

/** Target block — anything that can be shaded. */
export interface ShadeTarget {
  blockId: string;
  centroidLonLat: [number, number] | null;
  footprint: Array<[number, number]> | null;
  /** Optional fallback when geometry is absent. */
  eastWestIndex: number | null;
  northSouthIndex: number | null;
  /** Optional terrain slope. Null = treated as flat. */
  slopePercent: number | null;
  slopeAspectDeg: number | null;
}

export interface ShadeImpact {
  /** Affected block. */
  blockId: string;
  /** When the shading is active (epoch ms). */
  startMs: number;
  endMs: number;
  /** 0..1; aggregated across the active window. */
  intensity: number;
  /** Time-of-day buckets observed: any of 'am' (~9 AM sun), 'mid' (~noon),
   *  'pm' (~3 PM). Used by the UI to decide AM/PM emphasis. */
  slots: Array<'am' | 'mid' | 'pm'>;
  /** Source attribution — passes through the emitter id + display label. */
  emitterId: string;
  emitterKind: ShadeEmitter['kind'];
  emitterLabel: string;
  /** Source block id (crops) or null (external). */
  sourceBlockId: string | null;
  /** Source crop id (crops) or null (external). */
  sourceCropId: string | null;
}

export interface ShadeModelInput {
  emitters: ShadeEmitter[];
  targets: ShadeTarget[];
  /** Farm location for solar calc. */
  farmLat: number;
  farmLon: number;
  /** The active window — typically the year being rendered. The model
   *  evaluates impact for the union of (emitter canopy on) ∩ (window). */
  fromMs: number;
  toMs: number;
}

export function projectShadeImpacts(input: ShadeModelInput): ShadeImpact[] {
  const out: ShadeImpact[] = [];
  for (const e of input.emitters) {
    if (!e.centroidLonLat) continue;
    if (e.heightFt <= 0 || e.opacity <= 0) continue;
    for (const t of input.targets) {
      if (t.blockId === e.sourceBlockId) continue;
      const impact = projectOneToOne(e, t, input);
      if (impact) out.push(impact);
    }
  }
  return out;
}

/** Project shade from ONE emitter onto ONE target across the active window. */
function projectOneToOne(
  e: ShadeEmitter,
  t: ShadeTarget,
  ctx: ShadeModelInput
): ShadeImpact | null {
  const eCenter = e.centroidLonLat!;
  const tCenter = t.centroidLonLat;
  // When neither has geometry, fall back to N-S/E-W index adjacency. This
  // keeps behaviour reasonable for blocks that never had a polygon drawn.
  const useGeometry = !!tCenter && !!eCenter;

  // Sample the active window at its midpoint for sun position. Shadow
  // length swings ~30% across a season, so midpoint is a good summary.
  const midMs =
    (Math.max(ctx.fromMs, e.canopyStartMs ?? ctx.fromMs) +
      Math.min(ctx.toMs, e.canopyEndMs ?? ctx.toMs)) /
    2;
  // The sample dates we evaluate canopy fraction at: midpoint — sufficient
  // since the engine bakes the active window via fromMs/toMs already.
  const canopy = e.canopyAtMs(midMs);
  if (canopy <= 0) return null;

  const heightM = feetToMeters(e.heightFt) * canopy;
  if (heightM <= 0.1) return null;

  // Slope adjustment: a target on a downhill aspect facing toward the sun
  // shortens effective shadow distance to it; uphill toward the sun
  // lengthens it. The factor is tan(slopeRad) projected on the sun-azimuth
  // axis. Capped to ±0.5 so a 30% slope can scale shadow reach by ±50%.
  let observedSlots: Array<'am' | 'mid' | 'pm'> = [];
  let totalIntensity = 0;
  let hits = 0;
  for (const hour of SAMPLE_HOURS) {
    const sun = solarPosition(ctx.farmLat, ctx.farmLon, midMs, hour);
    if (sun.elevationDeg < 5) continue; // sun too low to shade meaningfully
    const shadowAz = shadowDirectionDeg(sun.azimuthDeg);
    const shadowLenM = Math.min(MAX_SHADOW_METERS, shadowLengthMeters(heightM, sun.elevationDeg));
    if (!Number.isFinite(shadowLenM) || shadowLenM <= 0.5) continue;

    let distM: number;
    let bearingFromEmitter: number;
    if (useGeometry) {
      distM = haversineMeters(eCenter, tCenter!);
      bearingFromEmitter = bearingDeg(eCenter, tCenter!);
    } else {
      // Index fallback: assume 25 m between adjacent E-W blocks.
      const dE = (t.eastWestIndex ?? 0) - emitterAxisX(e);
      const dN = (t.northSouthIndex ?? 0) - emitterAxisY(e);
      distM = Math.hypot(dE, dN) * 25;
      bearingFromEmitter = (Math.atan2(dE, dN) * 180) / Math.PI;
      bearingFromEmitter = ((bearingFromEmitter % 360) + 360) % 360;
    }
    // Approximate edge-to-edge gap: subtract source + target radii from the
    // centroid-to-centroid distance. Footprints, when given, refine this;
    // otherwise both sides use DEFAULT_BLOCK_RADIUS_M.
    const sourceRadius = footprintRadiusMeters(e.footprint) ?? DEFAULT_BLOCK_RADIUS_M;
    const targetRadius = footprintRadiusMeters(t.footprint) ?? DEFAULT_BLOCK_RADIUS_M;
    const edgeGapM = Math.max(0, distM - sourceRadius - targetRadius);
    if (edgeGapM > shadowLenM) continue;

    // Angular alignment: how close is the target to the shadow's projection?
    const azDelta = angularDelta(shadowAz, bearingFromEmitter);
    if (azDelta > 35) continue; // too far off-axis to be in the shadow column

    // Slope of the TARGET adjusts shadow's effective reach. Aspect close to
    // shadow direction (downhill toward shadow) extends reach.
    const slopeFactor = slopeReachAdjustment(t, shadowAz);
    const reachM = shadowLenM * slopeFactor;
    if (edgeGapM > reachM) continue;

    // Intensity: lateral falloff (cosine of azDelta) × distance falloff
    // (linear within the shadow length, computed against the edge gap so
    // adjacent blocks read as fully shadowed) × emitter opacity × canopy ×
    // density.
    const lateralFalloff = Math.cos((azDelta * Math.PI) / 180);
    const distFalloff = Math.max(0, 1 - edgeGapM / Math.max(reachM, 1));
    const intensity = e.opacity * canopy * e.densityMultiplier * lateralFalloff * distFalloff;
    if (intensity < 0.05) continue;
    totalIntensity += intensity;
    hits += 1;
    observedSlots.push(SAMPLE_LABEL[hour]);
  }

  if (hits === 0) return null;
  const avgIntensity = Math.min(1, totalIntensity / hits);
  // De-dup slot list while preserving order of first observation.
  const slots = uniqOrdered(observedSlots);
  const window = clampWindow(e, ctx);

  return {
    blockId: t.blockId,
    startMs: window.startMs,
    endMs: window.endMs,
    intensity: avgIntensity,
    slots,
    emitterId: e.id,
    emitterKind: e.kind,
    emitterLabel: e.displayName,
    sourceBlockId: e.sourceBlockId,
    sourceCropId: e.sourceCropId
  };
}

/**
 * Active-window clamp: emitter's canopy on/off intersected with the model's
 * fromMs/toMs. We rely on the caller to set canopyStartMs / canopyEndMs on
 * the emitter (set in the engine when constructing emitters); when absent,
 * fall back to the model window.
 */
function clampWindow(e: ShadeEmitter, ctx: ShadeModelInput): { startMs: number; endMs: number } {
  const start = Math.max(ctx.fromMs, e.canopyStartMs ?? ctx.fromMs);
  const end = Math.min(ctx.toMs, e.canopyEndMs ?? ctx.toMs);
  return { startMs: start, endMs: Math.max(start, end) };
}

/** When neither side has geometry, derive a faux X/Y from axis indices. */
function emitterAxisX(e: ShadeEmitter): number {
  return (e as ShadeEmitter & { _axisX?: number })._axisX ?? 0;
}
function emitterAxisY(e: ShadeEmitter): number {
  return (e as ShadeEmitter & { _axisY?: number })._axisY ?? 0;
}

/** Returns the smallest absolute angular difference between two bearings. */
function angularDelta(a: number, b: number): number {
  const raw = Math.abs(a - b) % 360;
  return raw > 180 ? 360 - raw : raw;
}

/**
 * Slope adjustment for shadow reach.
 *  - Slope aspect = direction the slope FACES (downhill).
 *  - When the slope aspect aligns with the shadow direction, the shadow runs
 *    downhill and reaches further (multiplier > 1).
 *  - When the aspect is opposite the shadow direction, the shadow climbs
 *    uphill and is foreshortened (multiplier < 1).
 *  - Capped to [0.5, 1.5] for any practical slope.
 */
function slopeReachAdjustment(t: ShadeTarget, shadowAzimuth: number): number {
  const slope = t.slopePercent ?? 0;
  if (slope <= 0 || t.slopeAspectDeg == null) return 1;
  const aspectDelta = angularDelta(t.slopeAspectDeg, shadowAzimuth);
  // cos(0)=1 (aligned downhill), cos(180)=-1 (uphill). Multiplier:
  // 1 + (slope/100) × cos(aspectDelta), clamped.
  const factor = 1 + (slope / 100) * Math.cos((aspectDelta * Math.PI) / 180);
  return Math.max(0.5, Math.min(1.5, factor));
}

/** Approximate radius of a footprint polygon — sqrt(area / π). Returns
 *  null when the polygon is missing or invalid. */
function footprintRadiusMeters(footprint: Array<[number, number]> | null): number | null {
  if (!footprint || footprint.length < 4) return null;
  const m2 = polygonAreaSqMeters(footprint);
  if (m2 <= 0) return null;
  return Math.sqrt(m2 / Math.PI);
}

function uniqOrdered<T>(xs: T[]): T[] {
  const seen = new Set<T>();
  const out: T[] = [];
  for (const x of xs) {
    if (!seen.has(x)) {
      seen.add(x);
      out.push(x);
    }
  }
  return out;
}

// Re-exports used elsewhere (tree-shake friendly).
export { metersSquaredToAcres, polygonAreaSqMeters };
