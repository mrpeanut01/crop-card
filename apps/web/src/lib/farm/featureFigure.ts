import {
  layoutMapOverlay,
  outerRings,
  type MapOverlayLayout,
  type OverlayBlockInput,
  type OverlayFieldInput
} from '$lib/plan/mapOverlayLayout';
import type { MapFeatureKind, MapFeatureView } from './mapFeatures';

const M_PER_DEG_LAT = 111_320;

export interface FigureLine {
  id: string;
  kind: MapFeatureKind;
  name: string;
  points: Array<[number, number]>;
}

export interface FigurePoint {
  id: string;
  kind: MapFeatureKind;
  name: string;
  x: number;
  y: number;
}

export interface FarmFigureLayout {
  layout: MapOverlayLayout;
  lines: FigureLine[];
  points: FigurePoint[];
  /** Lines and points that can't be placed, e.g. on a farm sketched by size. */
  unplaced: number;
}

type FeatureInput = Pick<MapFeatureView, 'id' | 'kind' | 'name' | 'geometry'>;

/**
 * The Farm Map Card figure: Areas and blocks from `layoutMapOverlay`, plus
 * fences, gates and the rest projected onto the same plane. A sketched farm
 * has no real positions, so its lines and points are counted as unplaced
 * rather than drawn somewhere made up.
 */
export function layoutFarmFigure(
  fields: OverlayFieldInput[],
  blocks: OverlayBlockInput[],
  features: readonly FeatureInput[] = []
): FarmFigureLayout {
  const base = layoutMapOverlay(fields, blocks);
  const placed = features.filter((f) => f.geometry);
  if (base.mode === 'sketch' || placed.length === 0) {
    return { layout: base, lines: [], points: [], unplaced: placed.length };
  }

  const ringLats = [...fields, ...blocks]
    .flatMap((x) => outerRings(x.geometryGeojson))
    .flat()
    .map((p) => p[1]);
  const featureLats = placed.flatMap((f) =>
    f.geometry!.type === 'Point'
      ? [f.geometry!.coordinates[1]]
      : f.geometry!.coordinates.map((c) => c[1])
  );
  const lats = ringLats.length ? ringLats : featureLats;
  const lat0 = lats.reduce((s, v) => s + v, 0) / lats.length;
  const kx = M_PER_DEG_LAT * Math.cos((lat0 * Math.PI) / 180);
  const project = ([lon, lat]: [number, number]): [number, number] => [
    lon * kx,
    -lat * M_PER_DEG_LAT
  ];

  const lines: FigureLine[] = [];
  const points: FigurePoint[] = [];
  for (const f of placed) {
    const g = f.geometry!;
    if (g.type === 'LineString') {
      lines.push({ id: f.id, kind: f.kind, name: f.name, points: g.coordinates.map(project) });
    } else {
      const [x, y] = project(g.coordinates);
      points.push({ id: f.id, kind: f.kind, name: f.name, x, y });
    }
  }

  const xs = [...lines.flatMap((l) => l.points.map((p) => p[0])), ...points.map((p) => p.x)];
  const ys = [...lines.flatMap((l) => l.points.map((p) => p[1])), ...points.map((p) => p.y)];
  let minX = Math.min(...xs);
  let minY = Math.min(...ys);
  let maxX = Math.max(...xs);
  let maxY = Math.max(...ys);
  if (base.mode === 'geometry') {
    minX = Math.min(minX, base.minX);
    minY = Math.min(minY, base.minY);
    maxX = Math.max(maxX, base.minX + base.width);
    maxY = Math.max(maxY, base.minY + base.height);
  }
  const pad = placed.length === 1 && base.mode === 'none' ? 25 : 0;
  const layout: MapOverlayLayout = {
    ...base,
    mode: 'geometry',
    minX: minX - pad,
    minY: minY - pad,
    width: Math.max(maxX - minX + 2 * pad, 1),
    height: Math.max(maxY - minY + 2 * pad, 1)
  };
  return { layout, lines, points, unplaced: 0 };
}
