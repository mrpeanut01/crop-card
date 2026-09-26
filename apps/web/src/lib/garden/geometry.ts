/**
 * Pure designer geometry in Area feet. No DOM, no DB. Spec:
 * docs/design/GARDEN_DESIGNER.md ("Geometry rules").
 */

import { geojsonBBox, haversineMeters } from '$lib/geo/area';
import type {
  AreaCanvas,
  BedLayout,
  BedPreset,
  BedPresetId,
  Footprint,
  PointFt,
  RectFt,
  Rotation
} from './types';

export const SNAP_FT = 0.5;
export const FOOTPRINT_SNAP_IN = 6;
export const SFG_SNAP_IN = 12;
export const MIN_BED_FT = 1;
export const DEFAULT_CANVAS_FT = { widthFt: 20, lengthFt: 30 } as const;
export const ADJACENT_GAP_FT = 4;

export const BED_PRESETS: Record<BedPresetId, BedPreset> = {
  'raised-4x8': {
    id: 'raised-4x8',
    label: '4×8 raised bed',
    kind: 'bed',
    bedStyle: 'raised',
    widthFt: 4,
    lengthFt: 8
  },
  'in-ground-3x10': {
    id: 'in-ground-3x10',
    label: '3×10 in-ground bed',
    kind: 'bed',
    bedStyle: 'in-ground',
    widthFt: 3,
    lengthFt: 10
  },
  'row-30in': {
    id: 'row-30in',
    label: '30 in row',
    kind: 'bed',
    bedStyle: 'in-ground',
    widthFt: 2.5,
    lengthFt: 20
  },
  'container-5gal': {
    id: 'container-5gal',
    label: '5 gal container',
    kind: 'container',
    bedStyle: 'container',
    widthFt: 1,
    lengthFt: 1
  },
  custom: {
    id: 'custom',
    label: 'Custom size',
    kind: 'bed',
    bedStyle: 'raised',
    widthFt: 4,
    lengthFt: 4
  }
};

export function pointFt(x: number, y: number): PointFt {
  return { x, y } as PointFt;
}

export function rectFt(x: number, y: number, w: number, l: number): RectFt {
  return { x, y, w, l } as RectFt;
}

const EPS = 1e-9;
const FT_PER_M = 3.280_839_895;

function roundHalfAway(value: number): number {
  const r = Math.sign(value) * Math.round(Math.abs(value));
  return r === 0 ? 0 : r;
}

function floorStep(value: number, step: number): number {
  const r = Math.floor(value / step + EPS) * step;
  return r === 0 ? 0 : r;
}

function ceilStep(value: number, step: number): number {
  const r = Math.ceil(value / step - EPS) * step;
  return r === 0 ? 0 : r;
}

function clampNum(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

function isQuarterTurn(rotationDeg: Rotation): boolean {
  return rotationDeg === 90 || rotationDeg === 270;
}

function canvasOf(
  area: { id: string; name: string },
  widthFt: number,
  lengthFt: number,
  source: AreaCanvas['source']
): AreaCanvas {
  return {
    areaId: area.id,
    name: area.name,
    widthFt,
    lengthFt,
    source,
    hasNorth: source === 'polygon-bbox'
  } as AreaCanvas;
}

/** Canvas from the Area's typed Size, else its polygon's bounding box in
 *  feet, else `DEFAULT_CANVAS_FT`. */
export function canvasFromArea(area: {
  id: string;
  name: string;
  widthFt: number | null;
  lengthFt: number | null;
  geojson: string | null;
}): AreaCanvas {
  const { widthFt, lengthFt } = area;
  if (
    widthFt != null &&
    lengthFt != null &&
    Number.isFinite(widthFt) &&
    Number.isFinite(lengthFt) &&
    widthFt > 0 &&
    lengthFt > 0
  ) {
    return canvasOf(
      area,
      Math.max(MIN_BED_FT, snap(widthFt)),
      Math.max(MIN_BED_FT, snap(lengthFt)),
      'dimensions'
    );
  }
  const bbox = geojsonBBox(area.geojson);
  if (bbox) {
    const [minLon, minLat, maxLon, maxLat] = bbox;
    const midLat = (minLat + maxLat) / 2;
    const midLon = (minLon + maxLon) / 2;
    const w = haversineMeters([minLon, midLat], [maxLon, midLat]) * FT_PER_M;
    const l = haversineMeters([midLon, minLat], [midLon, maxLat]) * FT_PER_M;
    if (w >= MIN_BED_FT && l >= MIN_BED_FT) {
      return canvasOf(area, ceilStep(w, SNAP_FT), ceilStep(l, SNAP_FT), 'polygon-bbox');
    }
  }
  return canvasOf(area, DEFAULT_CANVAS_FT.widthFt, DEFAULT_CANVAS_FT.lengthFt, 'default');
}

/** Nearest multiple of `step`, rounded half away from zero. */
export function snap(value: number, step: number = SNAP_FT): number {
  if (!Number.isFinite(value) || !(step > 0)) return 0;
  const units = roundHalfAway(value / step + Math.sign(value) * EPS);
  const r = Math.round(units * step * 1e6) / 1e6;
  return r === 0 ? 0 : r;
}

/** Snaps every edge; width and length never drop below one step. */
export function snapRect(rect: RectFt, step: number = SNAP_FT): RectFt {
  return rectFt(
    snap(rect.x, step),
    snap(rect.y, step),
    Math.max(step, snap(rect.w, step)),
    Math.max(step, snap(rect.l, step))
  );
}

/** Canvas box a bed of this size covers at this rotation, top-left at x, y. */
export function bedRect(
  xFt: number,
  yFt: number,
  widthFt: number,
  lengthFt: number,
  rotationDeg: Rotation
): RectFt {
  return isQuarterTurn(rotationDeg)
    ? rectFt(xFt, yFt, lengthFt, widthFt)
    : rectFt(xFt, yFt, widthFt, lengthFt);
}

/** Shift `rect` the least distance that puts it fully inside the canvas.
 *  Null when it is larger than the canvas in either direction. */
export function clampToArea(rect: RectFt, canvas: AreaCanvas): RectFt | null {
  if (rect.w > canvas.widthFt + EPS || rect.l > canvas.lengthFt + EPS) return null;
  return rectFt(
    clampNum(rect.x, 0, Math.max(0, canvas.widthFt - rect.w)),
    clampNum(rect.y, 0, Math.max(0, canvas.lengthFt - rect.l)),
    rect.w,
    rect.l
  );
}

function withRect(bed: BedLayout, rect: RectFt): BedLayout {
  return { ...bed, rect };
}

/** Moves by whole snap steps, then clamps. */
export function nudge(bed: BedLayout, dxFt: number, dyFt: number, canvas: AreaCanvas): BedLayout {
  const moved = rectFt(bed.rect.x + snap(dxFt), bed.rect.y + snap(dyFt), bed.rect.w, bed.rect.l);
  const clamped = clampToArea(moved, canvas);
  return clamped ? withRect(bed, clamped) : bed;
}

/** Next 90° step clockwise about the bed's center, snapped and clamped.
 *  Null when the rotated bed cannot fit the canvas. Half-step centres round
 *  one way into 90/270 and the other way back, so two turns (and so four)
 *  land exactly where the bed started. */
export function rotate90(bed: BedLayout, canvas: AreaCanvas): BedLayout | null {
  const next = ((bed.rotationDeg + 90) % 360) as Rotation;
  const target = bedRect(0, 0, bed.widthFt, bed.lengthFt, next);
  const half = (target.w - bed.rect.w) / 2;
  const shift = isQuarterTurn(next) ? ceilStep(half, SNAP_FT) : floorStep(half, SNAP_FT);
  const halfL = (target.l - bed.rect.l) / 2;
  const shiftL = isQuarterTurn(next) ? floorStep(halfL, SNAP_FT) : ceilStep(halfL, SNAP_FT);
  const turned = rectFt(snap(bed.rect.x - shift), snap(bed.rect.y - shiftL), target.w, target.l);
  const clamped = clampToArea(turned, canvas);
  if (!clamped) return null;
  return { ...bed, rotationDeg: next, rect: clamped };
}

/** Resize from the bottom-right handle, snapped, at least `MIN_BED_FT`,
 *  clamped to the canvas. Sizes are canvas-oriented and mapped back to the
 *  bed's own width and length for its rotation. */
export function resize(bed: BedLayout, rect: RectFt, canvas: AreaCanvas): BedLayout {
  const minW = Math.min(MIN_BED_FT, canvas.widthFt);
  const minL = Math.min(MIN_BED_FT, canvas.lengthFt);
  let x = clampNum(snap(rect.x), 0, canvas.widthFt);
  let y = clampNum(snap(rect.y), 0, canvas.lengthFt);
  let w = Math.max(minW, snap(rect.w));
  let l = Math.max(minL, snap(rect.l));
  w = Math.min(w, Math.max(minW, canvas.widthFt - x));
  l = Math.min(l, Math.max(minL, canvas.lengthFt - y));
  x = Math.min(x, canvas.widthFt - w);
  y = Math.min(y, canvas.lengthFt - l);
  const quarter = isQuarterTurn(bed.rotationDeg);
  return {
    ...bed,
    widthFt: quarter ? l : w,
    lengthFt: quarter ? w : l,
    rect: rectFt(x, y, w, l)
  };
}

function contains(rect: RectFt, point: PointFt): boolean {
  return (
    point.x >= rect.x - EPS &&
    point.x <= rect.x + rect.w + EPS &&
    point.y >= rect.y - EPS &&
    point.y <= rect.y + rect.l + EPS
  );
}

/** Topmost bed under the point (last in array order wins), or null. */
export function hitTest(point: PointFt, beds: readonly BedLayout[]): string | null {
  for (let i = beds.length - 1; i >= 0; i--) {
    if (contains(beds[i].rect, point)) return beds[i].blockId;
  }
  return null;
}

function spansOverlap(a0: number, a1: number, b0: number, b1: number): boolean {
  return a0 < b1 - EPS && b0 < a1 - EPS;
}

/** Interiors intersect; shared edges do not count. */
export function rectsOverlap(a: RectFt, b: RectFt): boolean {
  return (
    spansOverlap(a.x, a.x + a.w, b.x, b.x + b.w) && spansOverlap(a.y, a.y + a.l, b.y, b.y + b.l)
  );
}

/** Ids of beds that overlap `rect`, excluding `ignoreBlockId`. */
export function overlappingBeds(
  rect: RectFt,
  beds: readonly BedLayout[],
  ignoreBlockId?: string
): string[] {
  return beds
    .filter((b) => b.blockId !== ignoreBlockId && rectsOverlap(rect, b.rect))
    .map((b) => b.blockId);
}

function inflate(r: RectFt, by: number): RectFt {
  return by > 0 ? rectFt(r.x - by, r.y - by, r.w + 2 * by, r.l + 2 * by) : r;
}

function firstFree(
  ys: readonly number[],
  xs: readonly number[],
  w: number,
  l: number,
  beds: readonly BedLayout[],
  aisleFt = 0
): RectFt | null {
  for (const y of ys) {
    for (const x of xs) {
      const r = rectFt(x, y, w, l);
      if (!beds.some((b) => rectsOverlap(r, inflate(b.rect, aisleFt)))) return r;
    }
  }
  return null;
}

/** Room left for walking: `aisleFt` between beds and `insetFt` from the
 *  Area's edge. */
export interface SpotSpacing {
  aisleFt?: number;
  insetFt?: number;
}

/** A 2 ft path between beds and 1 ft in from the edge, so a new bed never
 *  lands flush against another one or the fence. */
export const DEFAULT_SPOT_SPACING: Required<SpotSpacing> = { aisleFt: 2, insetFt: 1 };

function sortedUnique(values: number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

/** First free snapped spot for a new or duplicated bed of this size, scanning
 *  right of `near` and then row by row. Null when the Area is full. The
 *  lowest free row and leftmost free column always start at 0 or at another
 *  bed's far edge, so only those positions are tried. */
export function freeSpot(
  widthFt: number,
  lengthFt: number,
  rotationDeg: Rotation,
  beds: readonly BedLayout[],
  canvas: AreaCanvas,
  near?: RectFt,
  spacing: SpotSpacing = {}
): RectFt | null {
  const aisle = Math.max(0, spacing.aisleFt ?? 0);
  const inset = Math.max(0, spacing.insetFt ?? 0);
  const spaced =
    aisle > 0 || inset > 0
      ? freeSpotWith(widthFt, lengthFt, rotationDeg, beds, canvas, near, aisle, inset)
      : null;
  return spaced ?? freeSpotWith(widthFt, lengthFt, rotationDeg, beds, canvas, near, 0, 0);
}

function freeSpotWith(
  widthFt: number,
  lengthFt: number,
  rotationDeg: Rotation,
  beds: readonly BedLayout[],
  canvas: AreaCanvas,
  near: RectFt | undefined,
  aisle: number,
  inset: number
): RectFt | null {
  const size = bedRect(0, 0, widthFt, lengthFt, rotationDeg);
  const start0 = ceilStep(inset, SNAP_FT);
  const maxX = floorStep(canvas.widthFt - inset - size.w, SNAP_FT);
  const maxY = floorStep(canvas.lengthFt - inset - size.l, SNAP_FT);
  if (maxX < start0 - EPS || maxY < start0 - EPS) return null;
  const rights = beds.map((b) => ceilStep(b.rect.x + b.rect.w + aisle, SNAP_FT));
  const bottoms = beds.map((b) => ceilStep(b.rect.y + b.rect.l + aisle, SNAP_FT));
  const xs = sortedUnique([start0, ...rights]).filter((x) => x >= start0 - EPS && x <= maxX + EPS);
  const ys = sortedUnique([start0, ...bottoms]).filter((y) => y >= start0 - EPS && y <= maxY + EPS);

  if (near) {
    const nearY = snap(near.y);
    const start = ceilStep(near.x + near.w + aisle, SNAP_FT);
    if (nearY >= 0 && nearY <= maxY + EPS) {
      const rowXs = sortedUnique([start, ...rights]).filter((x) => x >= start && x <= maxX + EPS);
      const hit = firstFree([nearY], rowXs, size.w, size.l, beds, aisle);
      if (hit) return hit;
    }
  }
  return firstFree(ys, xs, size.w, size.l, beds, aisle);
}

function rectGap(a: RectFt, b: RectFt): number {
  const dx = Math.max(0, b.x - (a.x + a.w), a.x - (b.x + b.w));
  const dy = Math.max(0, b.y - (a.y + a.l), a.y - (b.y + b.l));
  return Math.hypot(dx, dy);
}

/** Bed pairs whose edges are within `gapFt` of each other, ids sorted. */
export function adjacentBeds(
  beds: readonly BedLayout[],
  gapFt: number = ADJACENT_GAP_FT
): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (let i = 0; i < beds.length; i++) {
    for (let j = i + 1; j < beds.length; j++) {
      const a = beds[i];
      const b = beds[j];
      if (a.blockId === b.blockId) continue;
      if (rectGap(a.rect, b.rect) <= gapFt + EPS) {
        out.push(a.blockId < b.blockId ? [a.blockId, b.blockId] : [b.blockId, a.blockId]);
      }
    }
  }
  return out.sort((p, q) => (p[0] === q[0] ? cmp(p[1], q[1]) : cmp(p[0], q[0])));
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Snap to `FOOTPRINT_SNAP_IN` (or `SFG_SNAP_IN`), at least one step in each
 *  direction, clamped inside the bed's own unrotated inches. */
export function clampFootprint(
  fp: Footprint,
  bed: Pick<BedLayout, 'widthFt' | 'lengthFt'>,
  sfg = false
): Footprint {
  const step = sfg ? SFG_SNAP_IN : FOOTPRINT_SNAP_IN;
  const bedW = bed.widthFt * 12;
  const bedL = bed.lengthFt * 12;
  const maxW = bedW >= step ? floorStep(bedW, step) : bedW;
  const maxL = bedL >= step ? floorStep(bedL, step) : bedL;
  const w = Math.min(Math.max(step, snap(fp.w_in, step)), maxW);
  const l = Math.min(Math.max(step, snap(fp.l_in, step)), maxL);
  const x = clampNum(snap(fp.x_in, step), 0, floorStep(Math.max(0, bedW - w), step));
  const y = clampNum(snap(fp.y_in, step), 0, floorStep(Math.max(0, bedL - l), step));
  return { x_in: x, y_in: y, w_in: w, l_in: l };
}

export function footprintsOverlap(a: Footprint, b: Footprint): boolean {
  return (
    spansOverlap(a.x_in, a.x_in + a.w_in, b.x_in, b.x_in + b.w_in) &&
    spansOverlap(a.y_in, a.y_in + a.l_in, b.y_in, b.y_in + b.l_in)
  );
}

function bedToCanvas(u: number, v: number, bed: BedLayout): [number, number] {
  const W = bed.widthFt;
  const L = bed.lengthFt;
  switch (bed.rotationDeg) {
    case 90:
      return [bed.rect.x + (L - v), bed.rect.y + u];
    case 180:
      return [bed.rect.x + (W - u), bed.rect.y + (L - v)];
    case 270:
      return [bed.rect.x + v, bed.rect.y + (W - u)];
    default:
      return [bed.rect.x + u, bed.rect.y + v];
  }
}

/** Canvas box a footprint covers once its bed's position and rotation apply. */
export function footprintBounds(fp: Footprint, bed: BedLayout): RectFt {
  const [ax, ay] = bedToCanvas(fp.x_in / 12, fp.y_in / 12, bed);
  const [bx, by] = bedToCanvas((fp.x_in + fp.w_in) / 12, (fp.y_in + fp.l_in) / 12, bed);
  return rectFt(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay));
}

/** Canvas point to the bed's own unrotated inches, for drops and taps inside
 *  a bed. Null when the point is outside the bed. */
export function pointInBedIn(point: PointFt, bed: BedLayout): { xIn: number; yIn: number } | null {
  if (!contains(bed.rect, point)) return null;
  const X = point.x - bed.rect.x;
  const Y = point.y - bed.rect.y;
  const W = bed.widthFt;
  const L = bed.lengthFt;
  let u: number;
  let v: number;
  switch (bed.rotationDeg) {
    case 90:
      u = Y;
      v = L - X;
      break;
    case 180:
      u = W - X;
      v = L - Y;
      break;
    case 270:
      u = W - Y;
      v = X;
      break;
    default:
      u = X;
      v = Y;
  }
  return { xIn: clampNum(u, 0, W) * 12, yIn: clampNum(v, 0, L) * 12 };
}

interface FreeGrid {
  cols: number;
  rows: number;
  isFree(i: number, j: number, cw: number, cl: number): boolean;
}

function freeGrid(
  bed: Pick<BedLayout, 'widthFt' | 'lengthFt'>,
  taken: readonly Footprint[],
  step: number
): FreeGrid {
  const cols = Math.max(0, Math.floor((bed.widthFt * 12) / step + EPS));
  const rows = Math.max(0, Math.floor((bed.lengthFt * 12) / step + EPS));
  const stride = cols + 1;
  const sum = new Int32Array(stride * (rows + 1));
  const blocked = new Uint8Array(cols * rows);
  for (const t of taken) {
    const i0 = Math.max(0, Math.floor(t.x_in / step + EPS));
    const i1 = Math.min(cols, Math.ceil((t.x_in + t.w_in) / step - EPS));
    const j0 = Math.max(0, Math.floor(t.y_in / step + EPS));
    const j1 = Math.min(rows, Math.ceil((t.y_in + t.l_in) / step - EPS));
    for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) blocked[j * cols + i] = 1;
  }
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      sum[(j + 1) * stride + (i + 1)] =
        blocked[j * cols + i] +
        sum[j * stride + (i + 1)] +
        sum[(j + 1) * stride + i] -
        sum[j * stride + i];
    }
  }
  return {
    cols,
    rows,
    isFree(i, j, cw, cl) {
      const s =
        sum[(j + cl) * stride + (i + cw)] -
        sum[j * stride + (i + cw)] -
        sum[(j + cl) * stride + i] +
        sum[j * stride + i];
      return s === 0;
    }
  };
}

function bestPosition(
  grid: FreeGrid,
  cw: number,
  cl: number,
  step: number,
  at?: { xIn: number; yIn: number }
): Footprint | null {
  let best: Footprint | null = null;
  let bestD = Infinity;
  for (let j = 0; j + cl <= grid.rows; j++) {
    for (let i = 0; i + cw <= grid.cols; i++) {
      if (!grid.isFree(i, j, cw, cl)) continue;
      const fp = { x_in: i * step, y_in: j * step, w_in: cw * step, l_in: cl * step };
      if (!at) return fp;
      const d = Math.hypot(fp.x_in + fp.w_in / 2 - at.xIn, fp.y_in + fp.l_in / 2 - at.yIn);
      if (d < bestD - EPS) {
        bestD = d;
        best = fp;
      }
    }
  }
  return best;
}

/** Free snapped spot for a footprint of exactly `size` inside the bed that
 *  avoids `taken`, closest to `at` (centre distance) or else the first in
 *  reading order. Null when it does not fit anywhere. */
export function placeFootprint(
  bed: Pick<BedLayout, 'widthFt' | 'lengthFt'>,
  size: { w_in: number; l_in: number },
  taken: readonly Footprint[],
  at?: { xIn: number; yIn: number }
): Footprint | null {
  const step = FOOTPRINT_SNAP_IN;
  const grid = freeGrid(bed, taken, step);
  const cw = Math.round(Math.max(step, snap(size.w_in, step)) / step);
  const cl = Math.round(Math.max(step, snap(size.l_in, step)) / step);
  if (cw > grid.cols || cl > grid.rows) return null;
  return bestPosition(grid, cw, cl, step, at);
}

/** Largest free snapped footprint of about `want` inside the bed that avoids
 *  `taken`, preferring the spot closest to `at`. Null when nothing fits.
 *  Shrinks length first, then width, one step at a time. */
export function fitFootprint(
  bed: Pick<BedLayout, 'widthFt' | 'lengthFt'>,
  want: { w_in: number; l_in: number },
  taken: readonly Footprint[],
  at?: { xIn: number; yIn: number }
): Footprint | null {
  const step = FOOTPRINT_SNAP_IN;
  const grid = freeGrid(bed, taken, step);
  if (grid.cols === 0 || grid.rows === 0) return null;
  const wantW = clampNum(Math.round(snap(want.w_in, step) / step), 1, grid.cols);
  const wantL = clampNum(Math.round(snap(want.l_in, step) / step), 1, grid.rows);
  for (let cw = wantW; cw >= 1; cw--) {
    for (let cl = wantL; cl >= 1; cl--) {
      const hit = bestPosition(grid, cw, cl, step, at);
      if (hit) return hit;
    }
  }
  return null;
}
