/**
 * Which Areas sit next to a point on the map (#478): a hydrant or waterer
 * pre-checks every Area whose outline is within `WATERER_NEAR_FT` of it.
 * Only a starting suggestion; the owner ticks what it really serves, and
 * undrawn Areas can still be ticked by hand.
 */

import type { Position } from './mapFeatures';

export const WATERER_NEAR_FT = 50;

const FT_PER_M = 3.280_839_895;
const M_PER_DEG_LAT = 111_320;

type Ring = Position[];

function rings(geojson: string | null | undefined): Ring[] {
  if (!geojson) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(geojson);
  } catch {
    return [];
  }
  const out: Ring[] = [];
  const visit = (g: unknown) => {
    if (!g || typeof g !== 'object') return;
    const o = g as { type?: string; coordinates?: unknown; geometry?: unknown; features?: unknown };
    if (o.type === 'Feature') return visit(o.geometry);
    if (o.type === 'FeatureCollection' && Array.isArray(o.features)) {
      for (const f of o.features) visit(f);
      return;
    }
    if (o.type === 'Polygon' && Array.isArray(o.coordinates)) {
      const r = (o.coordinates as unknown[])[0];
      if (Array.isArray(r)) out.push(r as Ring);
    } else if (o.type === 'MultiPolygon' && Array.isArray(o.coordinates)) {
      for (const poly of o.coordinates as unknown[][]) {
        if (Array.isArray(poly?.[0])) out.push(poly[0] as Ring);
      }
    }
  };
  visit(parsed);
  return out.filter((r) => r.length >= 3 && r.every((p) => Array.isArray(p) && p.length >= 2));
}

function inside(pt: [number, number], ring: Array<[number, number]>): boolean {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) {
      hit = !hit;
    }
  }
  return hit;
}

function segDist(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t =
    len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Feet from a point to an Area's outline; 0 inside it, null when the Area
 *  has no drawn outline. */
export function distanceToAreaFt(
  point: Position,
  geometryGeojson: string | null | undefined
): number | null {
  const rs = rings(geometryGeojson);
  if (!rs.length) return null;
  const [lon0, lat0] = point;
  const mPerDegLon = M_PER_DEG_LAT * Math.cos((lat0 * Math.PI) / 180);
  const toFt = ([lon, lat]: Position): [number, number] => [
    (lon - lon0) * mPerDegLon * FT_PER_M,
    (lat - lat0) * M_PER_DEG_LAT * FT_PER_M
  ];
  let best = Infinity;
  for (const r of rs) {
    const local = r.map(toFt);
    if (inside([0, 0], local)) return 0;
    for (let i = 0; i < local.length; i++) {
      best = Math.min(best, segDist([0, 0], local[i], local[(i + 1) % local.length]));
    }
  }
  return Number.isFinite(best) ? best : null;
}

/** Ids of Areas whose outline is within `maxFt` of the point, nearest first. */
export function areasNearPoint(
  point: Position,
  areas: ReadonlyArray<{ id: string; geometryGeojson?: string | null }>,
  maxFt: number = WATERER_NEAR_FT
): string[] {
  return areas
    .map((a) => ({ id: a.id, d: distanceToAreaFt(point, a.geometryGeojson) }))
    .filter((x): x is { id: string; d: number } => x.d !== null && x.d <= maxFt)
    .sort((a, b) => a.d - b.d || a.id.localeCompare(b.id))
    .map((x) => x.id);
}
