/** Test support for the Find a spot unit tests. Not used by the app. */
import type { SoilSurvey } from '$lib/soil/types';

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
