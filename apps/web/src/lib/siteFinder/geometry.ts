/**
 * Geometry for Find a spot. Pure and client-safe. Two frames are used:
 *
 * - a local flat frame in metres (x east, y north) around a centre point,
 *   for sun, distance and overlap math at garden and field scale;
 * - Web Mercator, for the aerial photo, so a photo position (0 to 1 from the
 *   top left, north up) maps back to the exact lon/lat it shows.
 */

import type { Footprint, LonLat, ObstacleShape, SearchBox } from './types';

const DEG = Math.PI / 180;
export const METERS_PER_DEG_LAT = 111_320;
export const FT_TO_M = 0.3048;
/** Web Mercator sphere radius (EPSG:3857). */
export const MERCATOR_R = 6_378_137;
export const MAX_MERCATOR_LAT = 85;

export type XY = [x: number, y: number];

export interface LocalFrame {
  lon0: number;
  lat0: number;
  mPerDegLon: number;
}

export function localFrame(center: LonLat): LocalFrame {
  return {
    lon0: center[0],
    lat0: center[1],
    mPerDegLon: Math.max(1e-6, METERS_PER_DEG_LAT * Math.cos(center[1] * DEG))
  };
}

export function toLocal(f: LocalFrame, p: LonLat): XY {
  return [(p[0] - f.lon0) * f.mPerDegLon, (p[1] - f.lat0) * METERS_PER_DEG_LAT];
}

export function toLonLat(f: LocalFrame, p: XY): LonLat {
  return [f.lon0 + p[0] / f.mPerDegLon, f.lat0 + p[1] / METERS_PER_DEG_LAT];
}

export function boxCenter(box: SearchBox): LonLat {
  return [(box.minLon + box.maxLon) / 2, (box.minLat + box.maxLat) / 2];
}

/** Ground width (east to west) and height (north to south) in metres. */
export function boxSizeM(box: SearchBox): { widthM: number; heightM: number } {
  const f = localFrame(boxCenter(box));
  return {
    widthM: (box.maxLon - box.minLon) * f.mPerDegLon,
    heightM: (box.maxLat - box.minLat) * METERS_PER_DEG_LAT
  };
}

/** A box of the given ground size centred on a point. */
export function boxAround(center: LonLat, widthM: number, heightM = widthM): SearchBox {
  const f = localFrame(center);
  const dLon = widthM / 2 / f.mPerDegLon;
  const dLat = heightM / 2 / METERS_PER_DEG_LAT;
  return {
    minLon: center[0] - dLon,
    maxLon: center[0] + dLon,
    minLat: center[1] - dLat,
    maxLat: center[1] + dLat
  };
}

export function validBox(box: SearchBox): boolean {
  const n = [box.minLon, box.minLat, box.maxLon, box.maxLat];
  return (
    n.every((v) => typeof v === 'number' && Number.isFinite(v)) &&
    box.minLon < box.maxLon &&
    box.minLat < box.maxLat &&
    box.minLon >= -180 &&
    box.maxLon <= 180 &&
    box.minLat >= -MAX_MERCATOR_LAT &&
    box.maxLat <= MAX_MERCATOR_LAT
  );
}

// ─── Aerial photo frame (Web Mercator) ───────────────────────────────

export interface PhotoExtent {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  /** Ground width of the photo in metres at its centre latitude. */
  groundM: number;
}

export function mercatorOf(p: LonLat): XY {
  const lat = Math.max(-MAX_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, p[1]));
  return [MERCATOR_R * p[0] * DEG, MERCATOR_R * Math.log(Math.tan(Math.PI / 4 + (lat * DEG) / 2))];
}

export function lonLatOfMercator(p: XY): LonLat {
  return [
    p[0] / MERCATOR_R / DEG,
    (2 * Math.atan(Math.exp(p[1] / MERCATOR_R)) - Math.PI / 2) / DEG
  ];
}

/** The square Web Mercator extent whose ground footprint is `groundM` on a
 *  side at the centre's latitude. Mercator stretches distance by 1/cos(lat),
 *  so the projected half-size is the ground half-size over cos(lat). */
export function photoExtentAround(center: LonLat, groundM: number): PhotoExtent {
  const [cx, cy] = mercatorOf(center);
  const half = groundM / 2 / Math.max(1e-6, Math.cos(center[1] * DEG));
  return { minX: cx - half, minY: cy - half, maxX: cx + half, maxY: cy + half, groundM };
}

/** The photo that covers a search box: square, centred on it, as wide on the
 *  ground as the box's longer side. */
export function photoExtentFor(box: SearchBox): PhotoExtent {
  const { widthM, heightM } = boxSizeM(box);
  return photoExtentAround(boxCenter(box), Math.max(widthM, heightM));
}

/** Photo position (0 to 1 from the top left, north up) to lon/lat. */
export function imageToLonLat(extent: PhotoExtent, x: number, y: number): LonLat {
  return lonLatOfMercator([
    extent.minX + x * (extent.maxX - extent.minX),
    extent.maxY - y * (extent.maxY - extent.minY)
  ]);
}

export function lonLatToImage(extent: PhotoExtent, p: LonLat): XY {
  const [mx, my] = mercatorOf(p);
  return [
    (mx - extent.minX) / (extent.maxX - extent.minX),
    (extent.maxY - my) / (extent.maxY - extent.minY)
  ];
}

// ─── Flat geometry in the local frame ────────────────────────────────

export interface Rect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export type LocalShape =
  | { type: 'circle'; c: XY; r: number }
  | { type: 'polygon'; ring: XY[] }
  | { type: 'line'; pts: XY[]; hw: number };

export function shapeToLocal(f: LocalFrame, s: ObstacleShape): LocalShape {
  if (s.type === 'circle') return { type: 'circle', c: toLocal(f, s.center), r: s.radiusM };
  if (s.type === 'polygon') return { type: 'polygon', ring: s.ring.map((p) => toLocal(f, p)) };
  return { type: 'line', pts: s.points.map((p) => toLocal(f, p)), hw: s.halfWidthM };
}

export function rectOf(center: XY, widthM: number, heightM: number): Rect {
  return {
    minX: center[0] - widthM / 2,
    maxX: center[0] + widthM / 2,
    minY: center[1] - heightM / 2,
    maxY: center[1] + heightM / 2
  };
}

export function rectRing(r: Rect): XY[] {
  return [
    [r.minX, r.minY],
    [r.maxX, r.minY],
    [r.maxX, r.maxY],
    [r.minX, r.maxY]
  ];
}

export function footprintM(fp: Footprint): { widthM: number; heightM: number } {
  return { widthM: fp.widthFt * FT_TO_M, heightM: fp.lengthFt * FT_TO_M };
}

/** The footprint rectangle as a closed lon/lat ring (GeoJSON order). */
export function rectLonLatRing(f: LocalFrame, r: Rect): LonLat[] {
  const ring = rectRing(r).map((p) => toLonLat(f, p));
  return [...ring, ring[0]];
}

export function pointInRing(p: XY, ring: readonly XY[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function cross(o: XY, a: XY, b: XY): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

export function segmentsIntersect(a: XY, b: XY, c: XY, d: XY): boolean {
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }
  return false;
}

export function pointSegmentDist(p: XY, a: XY, b: XY): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t =
    len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

export function segmentSegmentDist(a: XY, b: XY, c: XY, d: XY): number {
  if (segmentsIntersect(a, b, c, d)) return 0;
  return Math.min(
    pointSegmentDist(a, c, d),
    pointSegmentDist(b, c, d),
    pointSegmentDist(c, a, b),
    pointSegmentDist(d, a, b)
  );
}

function ringEdges(ring: readonly XY[]): Array<[XY, XY]> {
  const out: Array<[XY, XY]> = [];
  for (let i = 0; i < ring.length; i++) out.push([ring[i], ring[(i + 1) % ring.length]]);
  return out;
}

/** Shortest distance from a segment to a shape's footprint; 0 when it
 *  touches or starts inside. */
export function segmentShapeDist(a: XY, b: XY, s: LocalShape): number {
  if (s.type === 'circle') return Math.max(0, pointSegmentDist(s.c, a, b) - s.r);
  if (s.type === 'line') {
    let best = Infinity;
    if (s.pts.length === 1) best = pointSegmentDist(s.pts[0], a, b);
    for (let i = 0; i + 1 < s.pts.length; i++) {
      best = Math.min(best, segmentSegmentDist(a, b, s.pts[i], s.pts[i + 1]));
    }
    return Math.max(0, best - s.hw);
  }
  if (s.ring.length < 3) return Infinity;
  if (pointInRing(a, s.ring) || pointInRing(b, s.ring)) return 0;
  let best = Infinity;
  for (const [c, d] of ringEdges(s.ring)) best = Math.min(best, segmentSegmentDist(a, b, c, d));
  return best;
}

export function pointShapeDist(p: XY, s: LocalShape): number {
  return segmentShapeDist(p, p, s);
}

/** Shortest distance from a rectangle to a shape; 0 when they overlap. */
export function rectShapeDist(r: Rect, s: LocalShape): number {
  const ring = rectRing(r);
  const inRect = (p: XY) => p[0] >= r.minX && p[0] <= r.maxX && p[1] >= r.minY && p[1] <= r.maxY;
  if (s.type === 'circle' && inRect(s.c)) return 0;
  if (s.type === 'line' && s.pts.some(inRect)) return 0;
  if (s.type === 'polygon' && s.ring.some(inRect)) return 0;
  let best = Infinity;
  for (const [a, b] of ringEdges(ring)) best = Math.min(best, segmentShapeDist(a, b, s));
  return best;
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;
}

/** A representative centre for a shape, for bearings and labels. */
export function shapeCenter(s: LocalShape): XY {
  if (s.type === 'circle') return s.c;
  const pts = s.type === 'line' ? s.pts : s.ring;
  if (pts.length === 0) return [0, 0];
  let x = 0;
  let y = 0;
  for (const p of pts) {
    x += p[0];
    y += p[1];
  }
  return [x / pts.length, y / pts.length];
}

export const COMPASS = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'] as const;
export type Compass = (typeof COMPASS)[number];

/** The eight-point compass direction from one point to another. */
export function compassFrom(from: XY, to: XY): Compass {
  const bearing = (Math.atan2(to[0] - from[0], to[1] - from[1]) / DEG + 360) % 360;
  return COMPASS[Math.round(bearing / 45) % 8];
}

/** The outer ring of a GeoJSON Polygon or MultiPolygon (bare, Feature or
 *  FeatureCollection), or the points of a LineString or Point. */
export function geojsonShape(
  raw: string | null | undefined
): { type: 'polygon'; ring: LonLat[] } | { type: 'line'; points: LonLat[] } | null {
  if (!raw) return null;
  let g: unknown;
  try {
    g = JSON.parse(raw);
  } catch {
    return null;
  }
  for (let depth = 0; depth < 3 && g && typeof g === 'object'; depth++) {
    const o = g as { type?: unknown; geometry?: unknown; features?: unknown };
    if (o.type === 'Feature') g = o.geometry;
    else if (o.type === 'FeatureCollection') g = Array.isArray(o.features) ? o.features[0] : null;
    else break;
  }
  if (!g || typeof g !== 'object') return null;
  const geom = g as { type?: unknown; coordinates?: unknown };
  const pts = (v: unknown): LonLat[] | null => {
    if (!Array.isArray(v)) return null;
    const out: LonLat[] = [];
    for (const p of v) {
      if (!Array.isArray(p) || typeof p[0] !== 'number' || typeof p[1] !== 'number') return null;
      if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) return null;
      out.push([p[0], p[1]]);
    }
    return out;
  };
  const c = geom.coordinates;
  if (geom.type === 'Polygon' && Array.isArray(c)) {
    const ring = pts(c[0]);
    return ring && ring.length >= 3 ? { type: 'polygon', ring } : null;
  }
  if (geom.type === 'MultiPolygon' && Array.isArray(c) && Array.isArray(c[0])) {
    const ring = pts((c[0] as unknown[])[0]);
    return ring && ring.length >= 3 ? { type: 'polygon', ring } : null;
  }
  if (geom.type === 'LineString') {
    const points = pts(c);
    return points && points.length >= 2 ? { type: 'line', points } : null;
  }
  if (geom.type === 'Point') {
    const points = pts([c]);
    return points ? { type: 'line', points } : null;
  }
  return null;
}
