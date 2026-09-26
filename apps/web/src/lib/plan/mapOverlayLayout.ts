/**
 * Planar layout for the Plan map overlay. Fields and blocks with drawn
 * geometry are projected to a local metric plane so their real outlines show;
 * a farm mapped only by width × length falls back to the dimension sketch.
 * Client-safe: no DB or node imports.
 */

import { layoutSketch, type SketchBlockInput, type SketchInput } from '$lib/farm/sketch';

type Ring = Array<[number, number]>;

export interface MapShape {
  id: string;
  name: string;
  kind: 'field' | 'block';
  /** Outer rings in overlay units, y growing downward (north up). */
  rings: Ring[];
  labelX: number;
  labelY: number;
  /** Northernmost y of the shape, for edge labels. */
  topY: number;
}

export interface MapOverlayLayout {
  mode: 'geometry' | 'sketch' | 'none';
  minX: number;
  minY: number;
  width: number;
  height: number;
  fields: MapShape[];
  blocks: MapShape[];
  /** Blocks that can't be placed (no geometry, no dimensions, no acres). */
  undrawn: Array<{ id: string; name: string }>;
}

export interface OverlayFieldInput extends SketchInput {
  geometryGeojson?: string;
}

export interface OverlayBlockInput extends SketchBlockInput {
  geometryGeojson?: string;
}

export function outerRings(geojson: string | undefined): Ring[] {
  if (!geojson) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(geojson);
  } catch {
    return [];
  }
  let geom = parsed as { type?: string; coordinates?: unknown; geometry?: unknown };
  if (geom?.type === 'Feature' && geom.geometry) geom = geom.geometry as typeof geom;
  const valid = (r: unknown): r is Ring =>
    Array.isArray(r) &&
    r.length >= 3 &&
    r.every(
      (p) => Array.isArray(p) && Number.isFinite(p[0] as number) && Number.isFinite(p[1] as number)
    );
  if (geom?.type === 'Polygon' && Array.isArray(geom.coordinates)) {
    const r = geom.coordinates[0];
    return valid(r) ? [r] : [];
  }
  if (geom?.type === 'MultiPolygon' && Array.isArray(geom.coordinates)) {
    return (geom.coordinates as unknown[][]).map((p) => p?.[0]).filter(valid);
  }
  return [];
}

const M_PER_DEG_LAT = 111_320;

/** Shoelace area and centroid, offset to the first vertex to keep precision. */
function ringStats(ring: Ring): { area: number; cx: number; cy: number } {
  const [ox, oy] = ring[0];
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < ring.length; i++) {
    const x0 = ring[i][0] - ox;
    const y0 = ring[i][1] - oy;
    const x1 = ring[(i + 1) % ring.length][0] - ox;
    const y1 = ring[(i + 1) % ring.length][1] - oy;
    const f = x0 * y1 - x1 * y0;
    a += f;
    cx += (x0 + x1) * f;
    cy += (y0 + y1) * f;
  }
  if (Math.abs(a) < 1e-9) {
    const n = ring.length;
    return {
      area: 0,
      cx: ring.reduce((s, p) => s + p[0], 0) / n,
      cy: ring.reduce((s, p) => s + p[1], 0) / n
    };
  }
  return { area: Math.abs(a) / 2, cx: ox + cx / (3 * a), cy: oy + cy / (3 * a) };
}

function shape(id: string, name: string, kind: MapShape['kind'], rings: Ring[]): MapShape {
  const stats = rings.map(ringStats);
  const main = stats.reduce((best, st) => (st.area > best.area ? st : best), stats[0]);
  const [labelX, labelY] = [main.cx, main.cy];
  const topY = Math.min(...rings.flat().map((p) => p[1]));
  return { id, name, kind, rings, labelX, labelY, topY };
}

function bounds(shapes: MapShape[]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of shapes)
    for (const r of s.rings)
      for (const [x, y] of r) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
  return { minX, minY, width: Math.max(maxX - minX, 1), height: Math.max(maxY - minY, 1) };
}

export function layoutMapOverlay(
  fields: OverlayFieldInput[],
  blocks: OverlayBlockInput[]
): MapOverlayLayout {
  const fieldRings = fields.map((f) => ({ f, rings: outerRings(f.geometryGeojson) }));
  const blockRings = blocks.map((b) => ({ b, rings: outerRings(b.geometryGeojson) }));
  const all = [...fieldRings, ...blockRings].flatMap((x) => x.rings);

  if (all.length > 0) {
    const lat0 = all.flat().reduce((s, p) => s + p[1], 0) / all.flat().length;
    const kx = M_PER_DEG_LAT * Math.cos((lat0 * Math.PI) / 180);
    const project = (r: Ring): Ring => r.map(([lon, lat]) => [lon * kx, -lat * M_PER_DEG_LAT]);

    const fieldShapes = fieldRings
      .filter((x) => x.rings.length > 0)
      .map(({ f, rings }) => shape(f.id, f.name, 'field', rings.map(project)));
    const blockShapes = blockRings
      .filter((x) => x.rings.length > 0)
      .map(({ b, rings }) => shape(b.id, b.name, 'block', rings.map(project)));
    const undrawn = blockRings
      .filter((x) => x.rings.length === 0)
      .map(({ b }) => ({ id: b.id, name: b.name }));
    return {
      mode: 'geometry',
      ...bounds([...fieldShapes, ...blockShapes]),
      fields: fieldShapes,
      blocks: blockShapes,
      undrawn
    };
  }

  const sketch = layoutSketch(fields, blocks);
  if (sketch.fields.length === 0) {
    return {
      mode: 'none',
      minX: 0,
      minY: 0,
      width: 1,
      height: 1,
      fields: [],
      blocks: [],
      undrawn: blocks.map((b) => ({ id: b.id, name: b.name }))
    };
  }
  const rect = (x: number, y: number, w: number, h: number): Ring => [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h]
  ];
  const fieldShapes = sketch.fields.map((f) =>
    shape(f.id, f.name, 'field', [rect(f.x, f.y, f.w, f.h)])
  );
  const blockShapes = sketch.fields.flatMap((f) =>
    f.blocks.map((b) => shape(b.id, b.name, 'block', [rect(b.x, b.y, b.w, b.h)]))
  );
  const placed = new Set(blockShapes.map((b) => b.id));
  return {
    mode: 'sketch',
    minX: 0,
    minY: 0,
    width: Math.max(sketch.width, 1),
    height: Math.max(sketch.height, 1),
    fields: fieldShapes,
    blocks: blockShapes,
    undrawn: blocks.filter((b) => !placed.has(b.id)).map((b) => ({ id: b.id, name: b.name }))
  };
}
