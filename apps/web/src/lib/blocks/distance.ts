/**
 * Block-to-block distance for cross-pollination checks (Phase 19, A2).
 *
 * Uses the existing `geometryCentroid` helper from `db/blocks.ts` to derive
 * a centroid lat/lon for each block's `geometryGeojson` polygon, then
 * computes the great-circle distance between them via Haversine. Returns
 * `null` when either block lacks geometry — pollination advisories degrade
 * to "geometry required" rather than guessing.
 *
 * No external dep, no PostGIS, no projection step. Loudoun County, VA is
 * at ~39°N so the Haversine error vs. ellipsoidal is well under 0.5% at
 * relevant distances (<= 1 mile).
 */

import { geometryCentroid } from '$lib/db/blocks';

const EARTH_RADIUS_FT = 20_902_231; // mean Earth radius in feet

export interface BlockGeometryRef {
  id: string;
  geometryGeojson?: string | null;
}

/**
 * Distance in feet between the centroids of two blocks. Returns null when
 * either block lacks geometry (no centroid → caller surfaces a "geometry
 * required" banner). Returns 0 when both blocks resolve to the same point
 * (same block id, or coincident centroids).
 */
export function blockDistanceFt(a: BlockGeometryRef, b: BlockGeometryRef): number | null {
  if (a.id === b.id) return 0;
  if (!a.geometryGeojson || !b.geometryGeojson) return null;
  const ca = geometryCentroid(a.geometryGeojson);
  const cb = geometryCentroid(b.geometryGeojson);
  if (!ca || !cb) return null;
  return haversineFt(ca.lat, ca.lon, cb.lat, cb.lon);
}

/** Great-circle distance in feet between two lat/lon points. Exposed for
 *  reuse by `lib/plan/pollination.ts` when computing maximize-spacing
 *  candidate pairs against arbitrary anchor points. */
export function haversineFt(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const dPhi = toRad(lat2 - lat1);
  const dLambda = toRad(lon2 - lon1);
  const a = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_FT * c;
}

/** True when both blocks expose a parseable geometry centroid. Used by the
 *  allocator to decide whether to emit pollination advisories or to surface
 *  the "add geometry" banner. */
export function hasGeometry(b: BlockGeometryRef): boolean {
  if (!b.geometryGeojson) return false;
  return geometryCentroid(b.geometryGeojson) !== null;
}

const COMPASS_16 = [
  'N',
  'NNE',
  'NE',
  'ENE',
  'E',
  'ESE',
  'SE',
  'SSE',
  'S',
  'SSW',
  'SW',
  'WSW',
  'W',
  'WNW',
  'NW',
  'NNW'
] as const;
export type CompassDirection = (typeof COMPASS_16)[number];

/** Forward bearing from point A to point B in degrees (0=N, 90=E, 180=S, 270=W). */
export function bearingDegrees(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const dLambda = toRad(lon2 - lon1);
  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Map a bearing in degrees to a 16-point compass label ('N', 'NNE', …, 'NNW'). */
export function degreesToCompass16(deg: number): CompassDirection {
  const normalized = ((deg % 360) + 360) % 360;
  const idx = Math.round(normalized / 22.5) % 16;
  return COMPASS_16[idx];
}

/** Convenience wrapper: compass bearing FROM block A TO block B, or null
 *  if either block lacks geometry. Returns 16-point label. */
export function compassBearingFromTo(
  a: BlockGeometryRef,
  b: BlockGeometryRef
): CompassDirection | null {
  if (!a.geometryGeojson || !b.geometryGeojson) return null;
  const ca = geometryCentroid(a.geometryGeojson);
  const cb = geometryCentroid(b.geometryGeojson);
  if (!ca || !cb) return null;
  if (a.id === b.id) return null;
  return degreesToCompass16(bearingDegrees(ca.lat, ca.lon, cb.lat, cb.lon));
}
