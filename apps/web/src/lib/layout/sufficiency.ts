/**
 * Geometry-aware usable-area + seed-vs-capacity sufficiency math (Phase 14e).
 *
 * Pure, no DB. Two responsibilities:
 *
 *   1. `usableSqft(block)` — derive plantable area, accounting for a
 *      perimeter dead-space buffer (turn-around, hose path, fence). When
 *      `geometryGeojson` is a convex polygon we inset each edge by a
 *      default 3 ft buffer and recompute area. Concave polygons fall
 *      back to a constant shrinkage factor because uniform offsets on
 *      reflex vertices produce self-intersecting rings.
 *
 *   2. `sufficiencyOf` — given seed-derived plant count and block
 *      capacity, classify the pairing as deficit / match / surplus and
 *      report utilisation + leftover.
 *
 * The buffer is *not* user-editable in v1: most CropCard farm blocks
 * are roughly rectangular and a 3 ft default is conservative-but-fair.
 * If users complain about mis-sized usable areas we can add a per-block
 * `perimeterBufferFt` column later — see plan, "Out of scope".
 */

import type { BlockWithPlantings } from '$lib/db/blocks';
import type { CropPlugin } from '$lib/plugins/schemas';

export const DEFAULT_PERIMETER_BUFFER_FT = 3;
const SQFT_PER_ACRE = 43_560;
const FT_PER_INCH = 1 / 12;
/** Conservative shrinkage when no geometry is available (or polygon is
 *  concave / unparseable). Captures average dead-space across CropCard
 *  blocks measured in pilot usage. */
const NO_GEOMETRY_SHRINKAGE = 0.85;

export interface UsableArea {
  sqft: number;
  source: 'geometry-inset' | 'acres-shrinkage' | 'unknown';
  /** True when we wanted to use geometry but had to fall back (concave,
   *  unparseable, or inset collapsed). The UI can show a "estimate" chip. */
  geometryFallback: boolean;
}

/** Compute the usable (plantable) square footage for a block. */
export function usableSqft(
  block: Pick<BlockWithPlantings, 'acres' | 'geometryGeojson'>,
  bufferFt: number = DEFAULT_PERIMETER_BUFFER_FT
): UsableArea {
  const fromGeo = usableFromGeometry(block.geometryGeojson, bufferFt);
  if (fromGeo) return fromGeo;

  if (block.acres && block.acres > 0) {
    return {
      sqft: block.acres * SQFT_PER_ACRE * NO_GEOMETRY_SHRINKAGE,
      source: 'acres-shrinkage',
      geometryFallback: false
    };
  }

  return { sqft: 0, source: 'unknown', geometryFallback: false };
}

/** Plants the block can hold given a crop plugin's row × in-row spacing,
 *  computed against `usableSqft` rather than raw acreage. */
export function plantsFitUsable(
  block: Pick<BlockWithPlantings, 'acres' | 'geometryGeojson'>,
  plugin: CropPlugin,
  bufferFt: number = DEFAULT_PERIMETER_BUFFER_FT
): number {
  const area = usableSqft(block, bufferFt);
  if (area.sqft <= 0) return 0;
  const perPlantSqft = footprintSqFt(plugin);
  if (perPlantSqft <= 0) return 0;
  return Math.floor(area.sqft / perPlantSqft);
}

export function footprintSqFt(plugin: CropPlugin): number {
  // v1.3 — pick the largest of three signals so we don't under-size vining
  // or wide-canopy crops:
  //   1) Explicit per-plant matureCanopyFtSq (operator-supplied truth)
  //   2) Vine spread (πr² of the larger end of the spread range)
  //   3) Row × in-row spacing (the traditional default)
  // Why MAX rather than sum: the row footprint represents the *seeded*
  // plot the plant claims; vine spread represents what it actually fills
  // at maturity. The bigger of the two is the real space requirement.
  const row = plugin.plantingGuide?.rowSpacingIn ?? plugin.defaultRowSpacingInches ?? 12;
  const inRow = plugin.plantingGuide?.inRowSpacingIn;
  const inRowAvg = inRow ? (inRow.min + inRow.max) / 2 : 12;
  const rowSqFt = row * FT_PER_INCH * (inRowAvg * FT_PER_INCH);

  const explicitCanopy = plugin.plantingGuide?.matureCanopyFtSq ?? 0;

  let vineSqFt = 0;
  const vine = plugin.plantingGuide?.vineSpreadFt;
  if (vine && vine.max > 0) {
    // Use the larger end of the spread range (planning conservatively for
    // mature spread). Treat as a circle of diameter = vine.max ft.
    const radius = vine.max / 2;
    vineSqFt = Math.PI * radius * radius;
  }

  return Math.max(rowSqFt, vineSqFt, explicitCanopy);
}

export type SufficiencyStatus = 'deficit' | 'match' | 'surplus';

export interface SufficiencyInput {
  /** Plant count derived from the seed quantity the farmer has. */
  plantsAvailable: number;
  /** Plants the block can fit at the crop's spacing. */
  plantsFit: number;
}

export interface SufficiencyResult {
  status: SufficiencyStatus;
  plantsAvailable: number;
  plantsFit: number;
  /** plantsAvailable / plantsFit, clamped to [0, ∞). */
  utilizationPct: number;
  /** Positive when seed > block capacity (surplus); negative when seed
   *  < block capacity (deficit). */
  leftoverPlants: number;
}

/** Tri-state classifier with a 10% tolerance band around 1.0 utilisation. */
export function sufficiencyOf(input: SufficiencyInput): SufficiencyResult {
  const fit = Math.max(0, Math.floor(input.plantsFit));
  const have = Math.max(0, Math.floor(input.plantsAvailable));
  const utilizationPct = fit > 0 ? have / fit : have > 0 ? Infinity : 0;
  let status: SufficiencyStatus;
  if (fit === 0) {
    status = have > 0 ? 'surplus' : 'match';
  } else if (have < fit * 0.9) {
    status = 'deficit';
  } else if (have > fit * 1.1) {
    status = 'surplus';
  } else {
    status = 'match';
  }
  return {
    status,
    plantsAvailable: have,
    plantsFit: fit,
    utilizationPct,
    leftoverPlants: have - fit
  };
}

// ─── geometry helpers ────────────────────────────────────────────────────

/** Approx feet per degree of latitude / longitude (corrected for lat at
 *  given centre). Matches the conversion used in `engine.ts`. */
const FT_PER_DEGREE_LAT = 364_488;

function usableFromGeometry(
  geometryGeojson: string | undefined,
  bufferFt: number
): UsableArea | null {
  if (!geometryGeojson) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(geometryGeojson);
  } catch {
    return null;
  }
  const ring = extractOuterRing(parsed);
  if (!ring || ring.length < 3) return null;

  const meanLat = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  const ftPerLon = FT_PER_DEGREE_LAT * Math.cos((meanLat * Math.PI) / 180);
  const projected = ring.map<[number, number]>((p) => [p[0] * ftPerLon, p[1] * FT_PER_DEGREE_LAT]);

  const cleaned = stripDuplicateLastVertex(projected);
  if (cleaned.length < 3) return null;

  const fullArea = Math.abs(signedArea(cleaned));
  if (fullArea <= 0) return null;

  if (!isConvex(cleaned)) {
    return {
      sqft: fullArea * NO_GEOMETRY_SHRINKAGE,
      source: 'geometry-inset',
      geometryFallback: true
    };
  }

  const oriented = signedArea(cleaned) > 0 ? cleaned : [...cleaned].reverse();
  const inset = insetCcwPolygon(oriented, bufferFt);
  if (!inset || inset.length < 3) {
    return { sqft: 0, source: 'geometry-inset', geometryFallback: false };
  }
  // `oriented` is CCW (signedArea > 0). If the inset's signed area is
  // not positive, the buffer ate more than the narrow dimension —
  // the block has no usable area at this buffer size.
  const insetSigned = signedArea(inset);
  if (insetSigned <= 0) {
    return { sqft: 0, source: 'geometry-inset', geometryFallback: false };
  }
  const insetArea = insetSigned;
  if (insetArea > fullArea) {
    return {
      sqft: fullArea * NO_GEOMETRY_SHRINKAGE,
      source: 'geometry-inset',
      geometryFallback: true
    };
  }

  return {
    sqft: insetArea,
    source: 'geometry-inset',
    geometryFallback: false
  };
}

function extractOuterRing(g: unknown): [number, number][] | null {
  if (!g || typeof g !== 'object') return null;
  const obj = g as { type?: string; coordinates?: unknown };
  if (obj.type === 'Polygon' && Array.isArray(obj.coordinates)) {
    const ring = obj.coordinates[0];
    if (Array.isArray(ring)) return coerceRing(ring);
  }
  if (obj.type === 'MultiPolygon' && Array.isArray(obj.coordinates)) {
    const poly = obj.coordinates[0];
    if (Array.isArray(poly) && Array.isArray(poly[0])) return coerceRing(poly[0]);
  }
  if (obj.type === 'Feature') {
    const inner = (g as { geometry?: unknown }).geometry;
    return extractOuterRing(inner);
  }
  return null;
}

function coerceRing(raw: unknown): [number, number][] | null {
  if (!Array.isArray(raw)) return null;
  const out: [number, number][] = [];
  for (const v of raw) {
    if (Array.isArray(v) && typeof v[0] === 'number' && typeof v[1] === 'number') {
      out.push([v[0], v[1]]);
    } else {
      return null;
    }
  }
  return out;
}

function stripDuplicateLastVertex(ring: [number, number][]): [number, number][] {
  if (ring.length < 2) return ring;
  const a = ring[0];
  const b = ring[ring.length - 1];
  if (a[0] === b[0] && a[1] === b[1]) return ring.slice(0, -1);
  return ring;
}

function signedArea(ring: [number, number][]): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    sum += x1 * y2 - x2 * y1;
  }
  return sum / 2;
}

function isConvex(ring: [number, number][]): boolean {
  if (ring.length < 3) return false;
  let sign = 0;
  for (let i = 0; i < ring.length; i++) {
    const [ax, ay] = ring[i];
    const [bx, by] = ring[(i + 1) % ring.length];
    const [cx, cy] = ring[(i + 2) % ring.length];
    const cross = (bx - ax) * (cy - by) - (by - ay) * (cx - bx);
    if (Math.abs(cross) < 1e-9) continue;
    const cs = cross > 0 ? 1 : -1;
    if (sign === 0) sign = cs;
    else if (sign !== cs) return false;
  }
  return true;
}

/** Inset a CCW convex polygon by `bufferFt` along each inward normal.
 *  Caller is responsible for orienting the input CCW; that lets the
 *  caller compare signed areas directly to detect over-collapse. */
function insetCcwPolygon(
  oriented: [number, number][],
  bufferFt: number
): [number, number][] | null {
  if (bufferFt <= 0) return oriented;

  const shifted: { p: [number, number]; n: [number, number] }[] = [];
  for (let i = 0; i < oriented.length; i++) {
    const a = oriented[i];
    const b = oriented[(i + 1) % oriented.length];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len === 0) return null;
    // Inward normal for CCW polygon = (dy, -dx) / len, but we need *inward*
    // — for CCW, inward is (-dy, dx) / len rotated so the polygon shrinks.
    // Quick test: a square (0,0)-(10,0)-(10,10)-(0,10) is CCW; for the
    // bottom edge (a→b right), inward should be +y. dx=10,dy=0 → (-dy,dx)=(0,10). ✓
    const nx = -dy / len;
    const ny = dx / len;
    shifted.push({
      p: [a[0] + nx * bufferFt, a[1] + ny * bufferFt],
      n: [nx, ny]
    });
  }

  const result: [number, number][] = [];
  for (let i = 0; i < shifted.length; i++) {
    const e0 = shifted[i];
    const e1 = shifted[(i + 1) % shifted.length];
    // Shifted edge i runs along direction (oriented[i+1]-oriented[i]); we
    // intersect the lines of the two shifted edges meeting at oriented[i+1].
    const p0 = e0.p;
    const d0: [number, number] = [
      oriented[(i + 1) % oriented.length][0] - oriented[i][0],
      oriented[(i + 1) % oriented.length][1] - oriented[i][1]
    ];
    const p1 = e1.p;
    const d1: [number, number] = [
      oriented[(i + 2) % oriented.length][0] - oriented[(i + 1) % oriented.length][0],
      oriented[(i + 2) % oriented.length][1] - oriented[(i + 1) % oriented.length][1]
    ];
    const denom = d0[0] * d1[1] - d0[1] * d1[0];
    if (Math.abs(denom) < 1e-9) return null;
    const t = ((p1[0] - p0[0]) * d1[1] - (p1[1] - p0[1]) * d1[0]) / denom;
    result.push([p0[0] + d0[0] * t, p0[1] + d0[1] * t]);
  }
  return result;
}
