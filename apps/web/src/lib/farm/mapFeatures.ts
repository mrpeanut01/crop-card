/**
 * Map lines and points (LiteFarm style): fences, gates, water sources,
 * hydrants, irrigation lines and paths. Stored in `map_features`; each kind
 * is either a line (GeoJSON LineString) or a point (GeoJSON Point). Only
 * water sources carry details today.
 */

import { z } from 'zod';
import { haversineMeters } from '$lib/geo/area';

export const MAP_FEATURE_KINDS = [
  'fence',
  'gate',
  'water_source',
  'hydrant',
  'irrigation_line',
  'path'
] as const;
export type MapFeatureKind = (typeof MAP_FEATURE_KINDS)[number];

export const LINE_FEATURE_KINDS = ['fence', 'irrigation_line', 'path'] as const;
export const POINT_FEATURE_KINDS = ['gate', 'water_source', 'hydrant'] as const;
export type LineFeatureKind = (typeof LINE_FEATURE_KINDS)[number];
export type PointFeatureKind = (typeof POINT_FEATURE_KINDS)[number];

export type FeatureGeometryType = 'LineString' | 'Point';

export function isMapFeatureKind(value: unknown): value is MapFeatureKind {
  return typeof value === 'string' && (MAP_FEATURE_KINDS as readonly string[]).includes(value);
}

export function isLineKind(kind: MapFeatureKind): kind is LineFeatureKind {
  return (LINE_FEATURE_KINDS as readonly string[]).includes(kind);
}

export function geometryTypeFor(kind: MapFeatureKind): FeatureGeometryType {
  return isLineKind(kind) ? 'LineString' : 'Point';
}

export const MAP_FEATURE_LABELS: Readonly<Record<MapFeatureKind, string>> = {
  fence: 'Fence',
  gate: 'Gate',
  water_source: 'Water source',
  hydrant: 'Hydrant',
  irrigation_line: 'Irrigation line',
  path: 'Path'
};

export const MAP_FEATURE_PLURAL: Readonly<Record<MapFeatureKind, string>> = {
  fence: 'Fences',
  gate: 'Gates',
  water_source: 'Water sources',
  hydrant: 'Hydrants',
  irrigation_line: 'Irrigation lines',
  path: 'Paths'
};

export const MAP_FEATURE_HINT: Readonly<Record<MapFeatureKind, string>> = {
  fence: 'Draw along the fence line',
  gate: 'Tap where the gate is',
  water_source: 'Well, spigot, pond pump or rain tank',
  hydrant: 'Tap where the hydrant is',
  irrigation_line: 'Draw along the main line',
  path: 'Lane, track or walkway'
};

export const MAP_FEATURE_NAME_PLACEHOLDER: Readonly<Record<MapFeatureKind, string>> = {
  fence: 'e.g. Pasture fence',
  gate: 'e.g. Lane gate',
  water_source: 'e.g. Barn well',
  hydrant: 'e.g. Garden hydrant',
  irrigation_line: 'e.g. Main drip line',
  path: 'e.g. Farm lane'
};

/**
 * Leaflet writes these into SVG attributes, so they are literal hex values.
 * `symbol` is the letter printed on a point's dot; `colorName` is the plain
 * words the printed legend uses, since color can't be relied on in print.
 */
export interface FeatureStyle {
  color: string;
  weight: number;
  dashArray?: string;
  symbol?: string;
  colorName: string;
}

export const MAP_FEATURE_STYLE: Readonly<Record<MapFeatureKind, FeatureStyle>> = {
  fence: { color: '#6b4a2b', weight: 3, colorName: 'brown line' },
  irrigation_line: {
    color: '#2f6f9f',
    weight: 3,
    dashArray: '8 5',
    colorName: 'blue dashed line'
  },
  path: { color: '#9a7b4f', weight: 3, dashArray: '2 6', colorName: 'tan dotted line' },
  gate: { color: '#6b4a2b', weight: 2, symbol: 'G', colorName: 'brown dot marked G' },
  water_source: { color: '#2f6f9f', weight: 2, symbol: 'W', colorName: 'blue dot marked W' },
  hydrant: { color: '#a63a2a', weight: 2, symbol: 'H', colorName: 'red dot marked H' }
};

// ─── Details ─────────────────────────────────────────────────────────────

export const WATER_SOURCE_TYPES = ['well', 'municipal', 'pond', 'rain'] as const;
export type WaterSourceType = (typeof WATER_SOURCE_TYPES)[number];

export const WATER_SOURCE_LABELS: Readonly<Record<WaterSourceType, string>> = {
  well: 'Well',
  municipal: 'Municipal (town water)',
  pond: 'Pond or stream',
  rain: 'Rain catchment'
};

export const MAX_FLOW_GPM = 5000;

export const waterSourceDetailsSchema = z.strictObject({
  source: z.enum(WATER_SOURCE_TYPES).optional(),
  flowRateGpm: z.number().positive().max(MAX_FLOW_GPM).optional()
});

const emptyDetailsSchema = z.strictObject({});

export const MAP_FEATURE_DETAILS_SCHEMAS = {
  fence: emptyDetailsSchema,
  gate: emptyDetailsSchema,
  water_source: waterSourceDetailsSchema,
  hydrant: emptyDetailsSchema,
  irrigation_line: emptyDetailsSchema,
  path: emptyDetailsSchema
} as const satisfies Record<MapFeatureKind, z.ZodType>;

export type WaterSourceDetails = z.infer<typeof waterSourceDetailsSchema>;
export type MapFeatureDetails = WaterSourceDetails;

export type FeatureDetailsResult =
  { ok: true; details: MapFeatureDetails | null } | { ok: false; message: string };

/** Validates `details` against `kind`; an empty object normalizes to null. */
export function validateFeatureDetails(
  kind: MapFeatureKind,
  details: unknown
): FeatureDetailsResult {
  if (details === null || details === undefined) return { ok: true, details: null };
  const parsed = MAP_FEATURE_DETAILS_SCHEMAS[kind].safeParse(details);
  if (!parsed.success) {
    return { ok: false, message: `details don't fit a ${MAP_FEATURE_LABELS[kind].toLowerCase()}` };
  }
  const clean = Object.fromEntries(
    Object.entries(parsed.data).filter(([, v]) => v !== undefined)
  ) as MapFeatureDetails;
  return { ok: true, details: Object.keys(clean).length === 0 ? null : clean };
}

export function parseFeatureDetails(
  kind: MapFeatureKind,
  json: string | null | undefined
): MapFeatureDetails | null {
  if (!json) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  const res = validateFeatureDetails(kind, raw);
  return res.ok ? res.details : null;
}

// ─── Geometry ────────────────────────────────────────────────────────────

export type Position = [number, number];
export type FeatureGeometry =
  { type: 'LineString'; coordinates: Position[] } | { type: 'Point'; coordinates: Position };

export const MAX_LINE_VERTICES = 2000;

function toPosition(p: unknown): Position | null {
  if (!Array.isArray(p) || p.length < 2) return null;
  const [lon, lat] = p;
  if (typeof lon !== 'number' || typeof lat !== 'number') return null;
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  if (lon < -180 || lon > 180 || lat < -90 || lat > 90) return null;
  return [lon, lat];
}

export type GeometryResult =
  { ok: true; geometry: FeatureGeometry } | { ok: false; message: string };

/**
 * Accepts a GeoJSON geometry (object or JSON string, bare or wrapped in a
 * Feature) and returns it normalized to 2D positions, or why it can't be
 * used. Lines need at least two distinct points; the geometry type must
 * match the kind.
 */
export function parseFeatureGeometry(kind: MapFeatureKind, input: unknown): GeometryResult {
  let raw = input;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      return { ok: false, message: 'geometry is not valid JSON' };
    }
  }
  if (raw && typeof raw === 'object' && (raw as { type?: unknown }).type === 'Feature') {
    raw = (raw as { geometry?: unknown }).geometry;
  }
  if (!raw || typeof raw !== 'object') return { ok: false, message: 'geometry is missing' };
  const g = raw as { type?: unknown; coordinates?: unknown };
  const expected = geometryTypeFor(kind);
  if (g.type !== expected) {
    return {
      ok: false,
      message: `a ${MAP_FEATURE_LABELS[kind].toLowerCase()} needs a ${expected} geometry`
    };
  }
  if (expected === 'Point') {
    const p = toPosition(g.coordinates);
    return p
      ? { ok: true, geometry: { type: 'Point', coordinates: p } }
      : { ok: false, message: 'point coordinates are out of range' };
  }
  if (!Array.isArray(g.coordinates)) return { ok: false, message: 'line has no coordinates' };
  if (g.coordinates.length > MAX_LINE_VERTICES) {
    return { ok: false, message: 'line has too many points' };
  }
  const coords: Position[] = [];
  for (const c of g.coordinates) {
    const p = toPosition(c);
    if (!p) return { ok: false, message: 'line coordinates are out of range' };
    coords.push(p);
  }
  const distinct = new Set(coords.map(([x, y]) => `${x},${y}`));
  if (coords.length < 2 || distinct.size < 2) {
    return { ok: false, message: 'a line needs at least two different points' };
  }
  return { ok: true, geometry: { type: 'LineString', coordinates: coords } };
}

const FT_PER_M = 3.280_839_895;

/** Walked length of a line in feet, rounded to a whole foot; null for points. */
export function lineLengthFt(geometry: FeatureGeometry | null | undefined): number | null {
  if (!geometry || geometry.type !== 'LineString') return null;
  let m = 0;
  for (let i = 0; i < geometry.coordinates.length - 1; i++) {
    m += haversineMeters(geometry.coordinates[i], geometry.coordinates[i + 1]);
  }
  return m > 0 ? Math.round(m * FT_PER_M) : null;
}

// ─── Shared shapes ───────────────────────────────────────────────────────

/** The client-safe view of one row, used by the map and the offline card. */
export interface MapFeatureView {
  id: string;
  kind: MapFeatureKind;
  name: string;
  fieldId: string | null;
  geometry: FeatureGeometry | null;
  details: MapFeatureDetails | null;
  lengthFt: number | null;
}

export function featureCounts(
  features: ReadonlyArray<{ kind: MapFeatureKind }>
): Map<MapFeatureKind, number> {
  const counts = new Map<MapFeatureKind, number>();
  for (const k of MAP_FEATURE_KINDS) counts.set(k, 0);
  for (const f of features) counts.set(f.kind, (counts.get(f.kind) ?? 0) + 1);
  return counts;
}

/** One plain line for lists and the printed card, e.g. "Barn well · Well, 12 gal/min". */
export function describeFeature(
  feature: Pick<MapFeatureView, 'kind' | 'name' | 'details' | 'lengthFt'>,
  formatLength: (ft: number) => string = (ft) => `${ft.toLocaleString('en-US')} ft`
): string {
  const name = feature.name.trim() || MAP_FEATURE_LABELS[feature.kind];
  const extras: string[] = [];
  if (feature.lengthFt !== null && feature.lengthFt > 0) extras.push(formatLength(feature.lengthFt));
  if (feature.kind === 'water_source' && feature.details) {
    const d = feature.details;
    const bits: string[] = [];
    if (d.source) bits.push(WATER_SOURCE_LABELS[d.source]);
    if (d.flowRateGpm !== undefined) bits.push(`${trimFlow(d.flowRateGpm)} gal/min`);
    if (bits.length) extras.push(bits.join(', '));
  }
  return extras.length ? `${name} · ${extras.join(' · ')}` : name;
}

function trimFlow(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
}
