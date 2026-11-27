/** Test support for the Find a spot unit tests. Not used by the app. */
import type { SoilSurvey } from '$lib/soil/types';
import { boxCenter, localFrame, toLocal } from './geometry';
import { TERRAIN_GRID_N, gridPoints, type TerrainGrid } from './terrain';
import type { SearchBox } from './types';

/** An elevation grid over a box whose ground is one even plane: `slopePct`
 *  steep, falling toward the compass bearing `aspectDeg`, with `base` metres
 *  at the centre. */
export function planeGrid(
  box: SearchBox,
  slopePct: number,
  aspectDeg: number,
  opts: { n?: number; base?: number; resolutionM?: number | null } = {}
): TerrainGrid {
  const n = opts.n ?? TERRAIN_GRID_N;
  const f = localFrame(boxCenter(box));
  const az = (aspectDeg * Math.PI) / 180;
  return {
    box,
    n,
    elevM: gridPoints(box, n).map((p) => {
      const [x, y] = toLocal(f, p);
      return (opts.base ?? 100) - (slopePct / 100) * (x * Math.sin(az) + y * Math.cos(az));
    }),
    resolutionM: opts.resolutionM === undefined ? 1 : opts.resolutionM
  };
}

export function survey(patch: Partial<SoilSurvey> = {}): SoilSurvey {
  return {
    mapUnitKey: '1',
    mapUnitSymbol: 'A',
    mapUnitName: 'Test loam',
    farmlandClass: null,
    drainageClass: 'well',
    slopePct: 2,
    waterTableDepthCm: null,
    bedrockDepthCm: null,
    hydrologicGroup: 'B',
    floodFrequency: 'None',
    availableWaterCm: 15,
    components: [],
    notSoil: false,
    source: { name: 'USDA NRCS Soil Survey (SSURGO)', fetchedAt: 1 },
    ...patch
  };
}
