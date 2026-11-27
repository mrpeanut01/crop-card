/**
 * Candidate spots for Find a spot. Pure and client-safe. A grid of
 * footprint-sized rectangles is laid over the search box, the ones that sit
 * on something that cannot be planted are dropped, the rest are scored, and
 * the best three that do not overlap each other are returned. The result is
 * the same for the same input, whatever order the inputs arrive in.
 */

import type { AreaKind } from '$lib/farm/areaKinds';
import type { SoilLookup } from '$lib/soil/types';
import {
  boxCenter,
  boxSizeM,
  compassFrom,
  footprintM,
  localFrame,
  pointInRing,
  pointShapeDist,
  rectLonLatRing,
  rectOf,
  rectShapeDist,
  rectsOverlap,
  shapeCenter,
  shapeToLocal,
  toLocal,
  toLonLat,
  type LocalFrame,
  type LocalShape,
  type Rect,
  type XY
} from './geometry';
import {
  combine,
  depthScore,
  drainageScore,
  houseScore,
  slopeScore,
  sunScore,
  treeScore,
  waterScore,
  type FactorScore
} from './score';
import { estimateSun, shadeCasters, sunDays, type ShadeCaster, type SunDays } from './sun';
import {
  GOALS,
  type AreaShape,
  type Candidate,
  type Factor,
  type Footprint,
  type LonLat,
  type Obstacle,
  type PlantingGoal,
  type SearchBox,
  type SunSeason
} from './types';

/** Grid step as a share of the footprint, and the most cells per run. Rough
 *  app values that keep a run quick. */
export const GRID_STEP_SHARE = 1 / 3;
export const MAX_GRID_CELLS = 900;
export const MAX_SPOTS = 3;

/** Area kinds nothing is planted on. */
export const BLOCKED_AREA_KINDS: ReadonlySet<AreaKind> = new Set<AreaKind>([
  'barn',
  'coop_pen',
  'residence',
  'natural_area',
  'water'
]);
/** Area kinds that are already growing space: skipped unless the owner
 *  says a spot may overlap them. */
export const PLANTED_AREA_KINDS: ReadonlySet<AreaKind> = new Set<AreaKind>([
  'field',
  'garden',
  'greenhouse',
  'orchard',
  'pasture'
]);
const BLOCKING_OBSTACLES: ReadonlySet<Obstacle['kind']> = new Set([
  'building',
  'water',
  'pavement'
]);
const TREE_KINDS: ReadonlySet<Obstacle['kind']> = new Set(['tree', 'tree-line']);

export interface WaterPoint {
  id: string;
  name: string;
  point: LonLat;
}

export interface FinderInput {
  goal: PlantingGoal;
  box: SearchBox;
  footprint: Footprint;
  obstacles: readonly Obstacle[];
  areas: readonly AreaShape[];
  /** Planted Areas a spot may overlap (the owner ticked them). */
  allowOverlapAreaIds: readonly string[];
  water: readonly WaterPoint[];
  /** The survey at the centre of the search box. */
  soil: SoilLookup;
  season: SunSeason;
  /** True when trees and buildings were checked: at least one is drawn, or
   *  Claude read the aerial photo. */
  shadeChecked: boolean;
}

export type BlockReason = 'outside-box' | 'outside-boundary' | 'area' | 'obstacle';

export interface FinderResult {
  candidates: Candidate[];
  /** Grid cells looked at, and how many were dropped. */
  considered: number;
  blocked: number;
  /** True when the footprint does not fit inside the search box. */
  tooBig: boolean;
}

interface Ctx {
  input: FinderInput;
  frame: LocalFrame;
  half: { x: number; y: number };
  size: { widthM: number; heightM: number };
  days: SunDays;
  casters: ShadeCaster[];
  blockedAreas: Array<{ area: AreaShape; ring: XY[] }>;
  allowedAreas: Array<{ area: AreaShape; ring: XY[] }>;
  boundaries: XY[][];
  houses: LocalShape[];
  blockers: Array<{ o: Obstacle; shape: LocalShape }>;
  trees: Array<{ o: Obstacle; shape: LocalShape }>;
  obstacleShapes: Map<string, { o: Obstacle; shape: LocalShape }>;
  water: Array<{ w: WaterPoint; p: XY }>;
}

const byId = <T extends { id: string }>(rows: readonly T[]): T[] =>
  [...rows].sort((a, b) => a.id.localeCompare(b.id));

function prepare(input: FinderInput): Ctx {
  const center = boxCenter(input.box);
  const frame = localFrame(center);
  const { widthM, heightM } = boxSizeM(input.box);
  const allow = new Set(input.allowOverlapAreaIds);
  const blockedAreas: Ctx['blockedAreas'] = [];
  const allowedAreas: Ctx['allowedAreas'] = [];
  const boundaries: XY[][] = [];
  const houses: LocalShape[] = [];
  for (const area of byId(input.areas)) {
    const ring = area.ring.map((p) => toLocal(frame, p));
    if (ring.length < 3) continue;
    if (area.kind === 'boundary') boundaries.push(ring);
    else if (BLOCKED_AREA_KINDS.has(area.kind)) blockedAreas.push({ area, ring });
    else if (PLANTED_AREA_KINDS.has(area.kind)) {
      if (allow.has(area.areaId)) allowedAreas.push({ area, ring });
      else blockedAreas.push({ area, ring });
    }
    if (area.kind === 'residence') houses.push({ type: 'polygon', ring });
  }
  const obstacles = byId(input.obstacles).map((o) => ({ o, shape: shapeToLocal(frame, o.shape) }));
  return {
    input,
    frame,
    half: { x: widthM / 2, y: heightM / 2 },
    size: footprintM(input.footprint),
    days: sunDays(center[1], center[0], input.season),
    casters: shadeCasters(frame, byId(input.obstacles)),
    blockedAreas,
    allowedAreas,
    boundaries,
    houses,
    blockers: obstacles.filter((x) => BLOCKING_OBSTACLES.has(x.o.kind)),
    trees: obstacles.filter((x) => TREE_KINDS.has(x.o.kind)),
    obstacleShapes: new Map(obstacles.map((x) => [x.o.id, x])),
    water: byId(input.water).map((w) => ({ w, p: toLocal(frame, w.point) }))
  };
}

function rectCorners(r: Rect): XY[] {
  return [
    [r.minX, r.minY],
    [r.maxX, r.minY],
    [r.maxX, r.maxY],
    [r.minX, r.maxY],
    [(r.minX + r.maxX) / 2, (r.minY + r.maxY) / 2]
  ];
}

function blockReason(ctx: Ctx, r: Rect): BlockReason | null {
  const eps = 1e-6;
  if (
    r.minX < -ctx.half.x - eps ||
    r.maxX > ctx.half.x + eps ||
    r.minY < -ctx.half.y - eps ||
    r.maxY > ctx.half.y + eps
  ) {
    return 'outside-box';
  }
  if (
    ctx.boundaries.length > 0 &&
    !ctx.boundaries.some((ring) => rectCorners(r).every((p) => pointInRing(p, ring)))
  ) {
    return 'outside-boundary';
  }
  for (const a of ctx.blockedAreas) {
    if (rectShapeDist(r, { type: 'polygon', ring: a.ring }) <= 0) return 'area';
  }
  for (const b of ctx.blockers) if (rectShapeDist(r, b.shape) <= 0) return 'obstacle';
  return null;
}

function scoreRect(ctx: Ctx, id: string, r: Rect, soil: SoilLookup): Candidate {
  const { input } = ctx;
  const c: XY = [(r.minX + r.maxX) / 2, (r.minY + r.maxY) / 2];
  const sun = estimateSun(c, ctx.days, ctx.casters);

  let water: { m: number; name: string } | null = null;
  for (const w of ctx.water) {
    const m = Math.hypot(w.p[0] - c[0], w.p[1] - c[1]);
    if (!water || m < water.m) water = { m, name: w.w.name };
  }
  let house: number | null = null;
  for (const h of ctx.houses) {
    const m = rectShapeDist(r, h);
    if (house === null || m < house) house = m;
  }
  let tree: { m: number; provenance: 'manual' | 'ai' } | null = null;
  for (const t of ctx.trees) {
    const m = rectShapeDist(r, t.shape);
    if (!tree || m < tree.m) tree = { m, provenance: t.o.provenance };
  }

  const scores: FactorScore[] = [
    sunScore(sun),
    drainageScore(soil),
    depthScore(soil),
    slopeScore(soil),
    waterScore(water),
    houseScore(house),
    treeScore(tree, input.shadeChecked)
  ];
  const goal = GOALS[input.goal];
  const factors: Factor[] = [];
  for (const s of scores) {
    if (goal.weights[s.id] > 0) factors.push(...s.factors);
    if (s.id === 'sun' && sun.mainShade) {
      const main = ctx.obstacleShapes.get(sun.mainShade.obstacleId);
      if (main) {
        factors.push({
          id: 'shade',
          verdict: sun.shadedHoursSummer >= 3 ? 'poor' : 'ok',
          key: `shade.${sun.mainShade.when}`,
          params: {
            thing: main.o.kind,
            dir: compassFrom(c, shapeCenter(main.shape)),
            guessed: sun.heightGuessed ? 1 : 0
          },
          provenance: main.o.provenance
        });
      }
    }
  }
  for (const a of ctx.allowedAreas) {
    if (rectShapeDist(r, { type: 'polygon', ring: a.ring }) <= 0) {
      factors.push({
        id: 'overlap',
        verdict: 'ok',
        key: 'overlap.inside',
        params: { name: a.area.name },
        provenance: 'manual'
      });
      break;
    }
  }

  const { score, confidence } = combine(goal, scores, input.shadeChecked);
  return {
    id,
    center: toLonLat(ctx.frame, c),
    polygon: rectLonLatRing(ctx.frame, r),
    score,
    confidence,
    factors
  };
}

interface Cell {
  id: string;
  rect: Rect;
  centerDist: number;
}

function gridCells(ctx: Ctx): Cell[] {
  const { widthM, heightM } = ctx.size;
  const spanX = 2 * ctx.half.x - widthM;
  const spanY = 2 * ctx.half.y - heightM;
  if (spanX < -1e-6 || spanY < -1e-6) return [];
  let stepX = Math.max(0.3, widthM * GRID_STEP_SHARE);
  let stepY = Math.max(0.3, heightM * GRID_STEP_SHARE);
  const count = () =>
    (Math.floor(Math.max(0, spanX) / stepX) + 1) * (Math.floor(Math.max(0, spanY) / stepY) + 1);
  while (count() > MAX_GRID_CELLS) {
    stepX *= 1.15;
    stepY *= 1.15;
  }
  const nx = Math.floor(Math.max(0, spanX) / stepX);
  const ny = Math.floor(Math.max(0, spanY) / stepY);
  // Centre the grid so the margins are even on both sides.
  const x0 = -(nx * stepX) / 2;
  const y0 = (ny * stepY) / 2;
  const cells: Cell[] = [];
  for (let j = 0; j <= ny; j++) {
    for (let i = 0; i <= nx; i++) {
      const c: XY = [x0 + i * stepX, y0 - j * stepY];
      cells.push({
        id: `r${j}c${i}`,
        rect: rectOf(c, widthM, heightM),
        centerDist: Math.hypot(c[0], c[1])
      });
    }
  }
  return cells;
}

/** Best first; ties go to the spot nearer the middle of the box, then by id. */
function rank(a: { c: Candidate; cell: Cell }, b: { c: Candidate; cell: Cell }): number {
  return (
    b.c.score - a.c.score ||
    a.cell.centerDist - b.cell.centerDist ||
    a.cell.id.localeCompare(b.cell.id)
  );
}

export function findSpots(input: FinderInput): FinderResult {
  const ctx = prepare(input);
  const cells = gridCells(ctx);
  const open: Array<{ c: Candidate; cell: Cell }> = [];
  let blocked = 0;
  for (const cell of cells) {
    if (blockReason(ctx, cell.rect)) {
      blocked += 1;
      continue;
    }
    open.push({ c: scoreRect(ctx, cell.id, cell.rect, input.soil), cell });
  }
  open.sort(rank);
  const picked: Array<{ c: Candidate; cell: Cell }> = [];
  for (const row of open) {
    if (picked.length >= MAX_SPOTS) break;
    if (picked.some((p) => rectsOverlap(p.cell.rect, row.cell.rect))) continue;
    picked.push(row);
  }
  return {
    candidates: picked.map((p) => p.c),
    considered: cells.length,
    blocked,
    tooBig: cells.length === 0
  };
}

/** The same spots scored again with the survey at each one's own centre,
 *  best first. A spot with no entry keeps the box-centre survey. */
export function rescoreWithSoil(
  input: FinderInput,
  candidates: readonly Candidate[],
  soilById: ReadonlyMap<string, SoilLookup>
): Candidate[] {
  const ctx = prepare(input);
  const cells = new Map(gridCells(ctx).map((cell) => [cell.id, cell]));
  const rows: Array<{ c: Candidate; cell: Cell }> = [];
  for (const cand of candidates) {
    const cell = cells.get(cand.id);
    if (!cell) continue;
    rows.push({ c: scoreRect(ctx, cell.id, cell.rect, soilById.get(cand.id) ?? input.soil), cell });
  }
  return rows.sort(rank).map((r) => r.c);
}

/** Why a footprint centred on a point is not offered, or null when it could
 *  be. Used to explain a spot Claude liked that the engine dropped. */
export function whyBlocked(input: FinderInput, point: LonLat): BlockReason | null {
  const ctx = prepare(input);
  const c = toLocal(ctx.frame, point);
  return blockReason(ctx, rectOf(c, ctx.size.widthM, ctx.size.heightM));
}

/** True when a point lies on (or within `marginM` of) one of the obstacles. */
export function nearObstacle(
  box: SearchBox,
  point: LonLat,
  obstacles: readonly Obstacle[],
  marginM: number
): boolean {
  const frame = localFrame(boxCenter(box));
  const p = toLocal(frame, point);
  return obstacles.some((o) => pointShapeDist(p, shapeToLocal(frame, o.shape)) <= marginM);
}
