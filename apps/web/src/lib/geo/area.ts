/**
 * Spherical-excess polygon area for lon/lat rings.
 *
 * Loudoun-scale farms are mid-latitude and small (< 1 km² typical), so the
 * standard formula is plenty accurate. We avoid bringing in turf.js to keep
 * the offline-first PWA bundle small.
 *
 * Coordinate convention: GeoJSON [lon, lat] pairs, decimal degrees.
 */

const EARTH_RADIUS_M = 6_378_137; // WGS-84 equatorial radius
const SQ_M_TO_ACRES = 0.000_247_105_381; // 1 m² → acres

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Spherical polygon area in m² for a single linear ring.
 * Implementation: Green's theorem on the sphere, sum over edges.
 * Returns the absolute value so winding direction doesn't matter.
 */
export function polygonAreaSqMeters(ring: Array<[number, number]>): number {
  if (ring.length < 4) return 0; // need a closed ring (last == first)
  let total = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [lon1, lat1] = ring[i];
    const [lon2, lat2] = ring[i + 1];
    total += toRad(lon2 - lon1) * (2 + Math.sin(toRad(lat1)) + Math.sin(toRad(lat2)));
  }
  return Math.abs((total * EARTH_RADIUS_M * EARTH_RADIUS_M) / 2);
}

export function metersSquaredToAcres(m2: number): number {
  return m2 * SQ_M_TO_ACRES;
}

/**
 * Sum the outer ring of every Polygon / MultiPolygon found in a GeoJSON
 * string and return acres. Returns null on parse failure or unrecognized
 * shape so callers can skip silently.
 */
export function geojsonAreaAcres(geojson: string | null | undefined): number | null {
  if (!geojson) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(geojson);
  } catch {
    return null;
  }
  const rings = collectOuterRings(parsed);
  if (rings.length === 0) return null;
  let m2 = 0;
  for (const r of rings) m2 += polygonAreaSqMeters(r);
  return metersSquaredToAcres(m2);
}

/**
 * Centroid of a GeoJSON geometry, as [lon, lat].
 *
 * Supported types:
 *   - Polygon / MultiPolygon: shoelace area-weighted centroid of the first
 *     outer ring. Accurate to a few cm at sub-km farm scales.
 *   - LineString / MultiLineString: length-weighted midpoint (the centroid
 *     in the 1-D sense — useful for tree rows / fences / hedges).
 *   - Point: the point itself.
 *
 * Returns null when geometry is absent, unparseable, or unsupported.
 */
export function geojsonCentroid(geojson: string | null | undefined): [number, number] | null {
  if (!geojson) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(geojson);
  } catch {
    return null;
  }
  const rings = collectOuterRings(parsed);
  if (rings.length > 0) return ringCentroid(rings[0]);
  const lines = collectLines(parsed);
  if (lines.length > 0) return lineMidpoint(lines[0]);
  const point = collectPoint(parsed);
  return point;
}

function collectLines(obj: unknown): Array<Array<[number, number]>> {
  const out: Array<Array<[number, number]>> = [];
  const visit = (geom: unknown) => {
    if (!geom || typeof geom !== 'object') return;
    const g = geom as { type?: string; coordinates?: unknown };
    if (g.type === 'LineString' && Array.isArray(g.coordinates)) {
      out.push(g.coordinates as Array<[number, number]>);
    } else if (g.type === 'MultiLineString' && Array.isArray(g.coordinates)) {
      for (const line of g.coordinates as unknown[][]) {
        if (Array.isArray(line)) out.push(line as Array<[number, number]>);
      }
    }
  };
  if (obj && typeof obj === 'object') {
    const root = obj as { type?: string; geometry?: unknown; features?: unknown };
    if (root.type === 'Feature') visit(root.geometry);
    else if (root.type === 'FeatureCollection' && Array.isArray(root.features)) {
      for (const f of root.features) visit((f as { geometry?: unknown }).geometry);
    } else visit(obj);
  }
  return out;
}

function collectPoint(obj: unknown): [number, number] | null {
  if (!obj || typeof obj !== 'object') return null;
  const root = obj as { type?: string; coordinates?: unknown; geometry?: unknown };
  if (root.type === 'Point' && Array.isArray(root.coordinates)) {
    const [lon, lat] = root.coordinates as number[];
    if (typeof lon === 'number' && typeof lat === 'number') return [lon, lat];
  }
  if (root.type === 'Feature' && root.geometry) return collectPoint(root.geometry);
  return null;
}

/** Length-weighted midpoint of a LineString. Walks the line summing
 *  segment lengths until half-length is reached, then linearly
 *  interpolates within that segment. Loudoun-scale precision is fine. */
function lineMidpoint(line: Array<[number, number]>): [number, number] | null {
  if (line.length < 2) return null;
  if (line.length === 2) {
    return [(line[0][0] + line[1][0]) / 2, (line[0][1] + line[1][1]) / 2];
  }
  // Use planar distance — adequate at farm scales.
  const segLengths: number[] = [];
  let total = 0;
  for (let i = 0; i < line.length - 1; i++) {
    const dx = line[i + 1][0] - line[i][0];
    const dy = line[i + 1][1] - line[i][1];
    const d = Math.hypot(dx, dy);
    segLengths.push(d);
    total += d;
  }
  if (total === 0) return [line[0][0], line[0][1]];
  const half = total / 2;
  let acc = 0;
  for (let i = 0; i < segLengths.length; i++) {
    if (acc + segLengths[i] >= half) {
      const t = (half - acc) / segLengths[i];
      return [
        line[i][0] + (line[i + 1][0] - line[i][0]) * t,
        line[i][1] + (line[i + 1][1] - line[i][1]) * t
      ];
    }
    acc += segLengths[i];
  }
  return [line[line.length - 1][0], line[line.length - 1][1]];
}

function ringCentroid(ring: Array<[number, number]>): [number, number] | null {
  if (ring.length < 4) return null;
  // Shift to a local frame at ring[0] to keep float precision when the
  // polygon's coordinates are large (e.g., GPS longitudes around -77°).
  const [ox, oy] = ring[0];
  let cx = 0;
  let cy = 0;
  let area = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const x0 = ring[i][0] - ox;
    const y0 = ring[i][1] - oy;
    const x1 = ring[i + 1][0] - ox;
    const y1 = ring[i + 1][1] - oy;
    const cross = x0 * y1 - x1 * y0;
    area += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  if (area === 0) return null;
  area /= 2;
  return [cx / (6 * area) + ox, cy / (6 * area) + oy];
}

/**
 * Great-circle distance in meters between two [lon, lat] points. Haversine —
 * good to <1m at farm scales.
 */
export function haversineMeters(a: [number, number], b: [number, number]): number {
  const [lon1, lat1] = a;
  const [lon2, lat2] = b;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);
  const h = sinDLat * sinDLat + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * sinDLon * sinDLon;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Bearing in degrees (0=N, 90=E, 180=S, 270=W) from point a to point b.
 * Forward azimuth on the great circle.
 */
export function bearingDeg(a: [number, number], b: [number, number]): number {
  const [lon1, lat1] = a;
  const [lon2, lat2] = b;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const dLambda = toRad(lon2 - lon1);
  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
  const theta = Math.atan2(y, x);
  return ((theta * 180) / Math.PI + 360) % 360;
}

function collectOuterRings(obj: unknown): Array<Array<[number, number]>> {
  const out: Array<Array<[number, number]>> = [];
  const visit = (geom: unknown) => {
    if (!geom || typeof geom !== 'object') return;
    const g = geom as { type?: string; coordinates?: unknown };
    if (g.type === 'Polygon' && Array.isArray(g.coordinates)) {
      const outer = g.coordinates[0];
      if (Array.isArray(outer)) out.push(outer as Array<[number, number]>);
    } else if (g.type === 'MultiPolygon' && Array.isArray(g.coordinates)) {
      for (const poly of g.coordinates as unknown[][]) {
        const outer = poly[0];
        if (Array.isArray(outer)) out.push(outer as Array<[number, number]>);
      }
    }
  };
  if (obj && typeof obj === 'object') {
    const root = obj as { type?: string; geometry?: unknown; features?: unknown };
    if (root.type === 'Feature') visit(root.geometry);
    else if (root.type === 'FeatureCollection' && Array.isArray(root.features)) {
      for (const f of root.features) visit((f as { geometry?: unknown }).geometry);
    } else visit(obj);
  }
  return out;
}
