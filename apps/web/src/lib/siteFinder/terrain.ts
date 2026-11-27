/**
 * The lay of the land for Find a spot (Phase 38E). Pure and client-safe.
 * A small grid of ground elevations across the search box is turned into a
 * slope and a facing direction for each spot by fitting a flat plane to the
 * grid points on and around it. It describes the place only. Nothing gates
 * anything, and nothing in the safety kernel reads it.
 */

import {
  COMPASS,
  METERS_PER_DEG_LAT,
  pointInRing,
  toLocal,
  type Compass,
  type LocalFrame,
  type Rect,
  type XY
} from './geometry';
import type { LonLat, SearchBox } from './types';

export const TERRAIN_SOURCE_NAME = 'USGS 3DEP';
/** Grid points along each side of the search box. */
export const TERRAIN_GRID_N = 9;
export const TERRAIN_GRID_N_SMALL = 7;
/** Ground flatter than this has no facing direction worth naming. A rough
 *  app guide, not an extension figure. */
export const FLAT_SLOPE_PCT = 2;
/** A plane needs at least this many known grid points that are not in a
 *  line. */
export const MIN_PLANE_POINTS = 4;
/** Elevations outside this range are not ground: the service's no-data
 *  sentinels are large negative numbers. Metres. */
export const MIN_ELEVATION_M = -500;
export const MAX_ELEVATION_M = 9000;

const DEG = Math.PI / 180;

/** Ground elevations on a regular grid over a box. Row-major from the
 *  southwest corner: `elevM[j * n + i]`, `i` west to east, `j` south to
 *  north. Null where the source had no value. */
export interface TerrainGrid {
  box: SearchBox;
  n: number;
  elevM: Array<number | null>;
  /** Ground size of one cell of the source data, in metres. */
  resolutionM: number | null;
}

export type TerrainLookup =
  | { status: 'ok'; grid: TerrainGrid }
  /** The service answered, but it has no elevations for this ground. */
  | { status: 'no-data' }
  /** The service could not be reached or sent something unusable. */
  | { status: 'unavailable' };

export interface SpotTerrain {
  slopePct: number;
  slopeDeg: number;
  /** Compass bearing the ground faces (the downhill direction): 0 north,
   *  90 east. Null when the ground is level. */
  aspectDeg: number | null;
  /** `data` from the elevation grid, `manual` from the block's own values. */
  provenance: 'data' | 'manual';
  resolutionM: number | null;
  /** True when the elevation data is coarser than the spot itself. */
  coarse: boolean;
}

/** A drawn block whose owner typed both its slope and the way it faces. */
export interface OwnerSlope {
  id: string;
  ring: LonLat[];
  slopePct: number;
  aspectDeg: number;
}

export function validElevationM(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > MIN_ELEVATION_M && v < MAX_ELEVATION_M
    ? v
    : null;
}

/** The grid's sample points, in the order of `TerrainGrid.elevM`. */
export function gridPoints(box: SearchBox, n: number): LonLat[] {
  const out: LonLat[] = [];
  const last = Math.max(1, n - 1);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      out.push([
        box.minLon + (i / last) * (box.maxLon - box.minLon),
        box.minLat + (j / last) * (box.maxLat - box.minLat)
      ]);
    }
  }
  return out;
}

/** The least-squares plane z = a x + b y + c through the points, as its two
 *  gradients (rise per metre east and per metre north). Null with too few
 *  points or when they lie in a line. */
export function fitPlane(
  points: ReadonlyArray<readonly [x: number, y: number, z: number]>
): { dzdx: number; dzdy: number } | null {
  const pts = points.filter((p) => p.every((v) => Number.isFinite(v)));
  if (pts.length < MIN_PLANE_POINTS) return null;
  let mx = 0;
  let my = 0;
  let mz = 0;
  for (const [x, y, z] of pts) {
    mx += x;
    my += y;
    mz += z;
  }
  mx /= pts.length;
  my /= pts.length;
  mz /= pts.length;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  let sxz = 0;
  let syz = 0;
  for (const [x, y, z] of pts) {
    const dx = x - mx;
    const dy = y - my;
    const dz = z - mz;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
    sxz += dx * dz;
    syz += dy * dz;
  }
  const det = sxx * syy - sxy * sxy;
  if (!(det > 1e-9 * (sxx + syy) ** 2) || !(det > 0)) return null;
  const dzdx = (sxz * syy - syz * sxy) / det;
  const dzdy = (syz * sxx - sxz * sxy) / det;
  return Number.isFinite(dzdx) && Number.isFinite(dzdy) ? { dzdx, dzdy } : null;
}

const norm360 = (deg: number) => ((deg % 360) + 360) % 360;

/** Slope and facing direction of a plane from its gradients. The ground
 *  faces the way it falls. */
export function slopeOfPlane(
  dzdx: number,
  dzdy: number
): Pick<SpotTerrain, 'slopePct' | 'slopeDeg' | 'aspectDeg'> {
  const rise = Math.hypot(dzdx, dzdy);
  const slopePct = rise * 100;
  return {
    slopePct,
    slopeDeg: Math.atan(rise) / DEG,
    aspectDeg: slopePct < FLAT_SLOPE_PCT ? null : norm360(Math.atan2(-dzdx, -dzdy) / DEG)
  };
}

/** The slope at a spot from the elevation grid: a plane through every grid
 *  point on the spot or within one grid step of it. Null when too few of
 *  those points are known. */
export function spotTerrainFromGrid(
  grid: TerrainGrid,
  frame: LocalFrame,
  rect: Rect
): SpotTerrain | null {
  const { n, box } = grid;
  if (!(n >= 2) || grid.elevM.length !== n * n) return null;
  const stepX = ((box.maxLon - box.minLon) * frame.mPerDegLon) / (n - 1);
  const stepY = ((box.maxLat - box.minLat) * METERS_PER_DEG_LAT) / (n - 1);
  if (!(stepX > 0) || !(stepY > 0)) return null;
  const eps = 1e-6;
  const pts: Array<[number, number, number]> = [];
  const all = gridPoints(box, n);
  for (let k = 0; k < all.length; k++) {
    const z = validElevationM(grid.elevM[k]);
    if (z === null) continue;
    const [x, y] = toLocal(frame, all[k]);
    if (
      x < rect.minX - stepX - eps ||
      x > rect.maxX + stepX + eps ||
      y < rect.minY - stepY - eps ||
      y > rect.maxY + stepY + eps
    ) {
      continue;
    }
    pts.push([x, y, z]);
  }
  const plane = fitPlane(pts);
  if (!plane) return null;
  const resolutionM =
    typeof grid.resolutionM === 'number' && grid.resolutionM > 0 ? grid.resolutionM : null;
  const longer = Math.max(rect.maxX - rect.minX, rect.maxY - rect.minY);
  return {
    ...slopeOfPlane(plane.dzdx, plane.dzdy),
    provenance: 'data',
    resolutionM,
    coarse: resolutionM !== null && resolutionM > longer
  };
}

function rectProbe(r: Rect): XY[] {
  return [
    [r.minX, r.minY],
    [r.maxX, r.minY],
    [r.maxX, r.maxY],
    [r.minX, r.maxY],
    [(r.minX + r.maxX) / 2, (r.minY + r.maxY) / 2]
  ];
}

/** The owner's own slope for a spot that lies wholly inside one of their
 *  drawn blocks. The first block by id wins when several contain it. */
export function spotTerrainFromOwner(
  blocks: readonly OwnerSlope[],
  frame: LocalFrame,
  rect: Rect
): SpotTerrain | null {
  const probe = rectProbe(rect);
  for (const b of [...blocks].sort((a, z) => a.id.localeCompare(z.id))) {
    if (
      !Number.isFinite(b.slopePct) ||
      !Number.isFinite(b.aspectDeg) ||
      b.slopePct < 0 ||
      b.ring.length < 3
    ) {
      continue;
    }
    const ring = b.ring.map((p) => toLocal(frame, p));
    if (!probe.every((p) => pointInRing(p, ring))) continue;
    return {
      slopePct: b.slopePct,
      slopeDeg: Math.atan(b.slopePct / 100) / DEG,
      aspectDeg: b.slopePct < FLAT_SLOPE_PCT ? null : norm360(b.aspectDeg),
      provenance: 'manual',
      resolutionM: null,
      coarse: false
    };
  }
  return null;
}

export interface TerrainInput {
  grid: TerrainGrid | null;
  ownerSlopes: readonly OwnerSlope[];
}

/** Owner-entered values win, then the elevation grid, then nothing. */
export function spotTerrain(
  input: TerrainInput | null | undefined,
  frame: LocalFrame,
  rect: Rect
): SpotTerrain | null {
  if (!input) return null;
  return (
    spotTerrainFromOwner(input.ownerSlopes, frame, rect) ??
    (input.grid ? spotTerrainFromGrid(input.grid, frame, rect) : null)
  );
}

/** The eight-point compass word for a bearing. */
export function compassOf(bearingDeg: number): Compass {
  return COMPASS[Math.round(norm360(bearingDeg) / 45) % 8];
}

/** The tilt the sun math uses: null for level or unknown ground. */
export function tiltOf(
  terrain: SpotTerrain | null
): { slopeDeg: number; aspectDeg: number } | null {
  if (!terrain || terrain.aspectDeg === null || !(terrain.slopeDeg > 0)) return null;
  return { slopeDeg: terrain.slopeDeg, aspectDeg: terrain.aspectDeg };
}
