/**
 * USDA NRCS soil survey (SSURGO) data for one map point, as read through
 * Soil Data Access. Client-safe. Survey values are reference data: they
 * describe the mapped soil type, never a test of the ground itself, and
 * nothing in the safety kernel, the Inputs Plan or fertility math reads them.
 */

export const DRAINAGE_CLASSES = [
  'excessively',
  'somewhat-excessively',
  'well',
  'moderately-well',
  'somewhat-poorly',
  'poorly',
  'very-poorly'
] as const;
export type DrainageClass = (typeof DRAINAGE_CLASSES)[number];

export const SOIL_SOURCE_NAME = 'USDA NRCS Soil Survey (SSURGO)';
export const WEB_SOIL_SURVEY_URL = 'https://websoilsurvey.nrcs.usda.gov/app/';

/** The survey's low, typical and high pH (1:1 water) for the top mineral layer. */
export interface SoilPh {
  low: number | null;
  typical: number | null;
  high: number | null;
}

/** One major soil of the map unit, with its top mineral layer. */
export interface SoilComponent {
  name: string;
  /** Share of the map unit, in percent. */
  percent: number | null;
  drainageClass: DrainageClass | null;
  slopePct: number | null;
  hydric: boolean | null;
  /** NRCS texture words for the top mineral layer, e.g. "Silty clay loam". */
  surfaceTexture: string | null;
  sandPct: number | null;
  siltPct: number | null;
  clayPct: number | null;
  organicMatterPct: number | null;
  ph: SoilPh | null;
}

export interface SoilSurvey {
  mapUnitKey: string;
  mapUnitSymbol: string;
  mapUnitName: string;
  /** NRCS farmland classification words, e.g. "Not prime farmland". */
  farmlandClass: string | null;
  drainageClass: DrainageClass | null;
  slopePct: number | null;
  /** Shallowest depth to a water table in a typical year. */
  waterTableDepthCm: number | null;
  bedrockDepthCm: number | null;
  /** NRCS hydrologic soil group, e.g. "B" or "C/D". */
  hydrologicGroup: string | null;
  /** NRCS flooding frequency words, e.g. "None" or "Occasional". */
  floodFrequency: string | null;
  /** Water the top 100 cm can hold, in cm of water. */
  availableWaterCm: number | null;
  /** Major components, largest share first. */
  components: SoilComponent[];
  /** True when the dominant component is Urban land, Water, Pits, Udorthents
   *  with no data and the like: the survey has no usable soil properties. */
  notSoil: boolean;
  source: { name: typeof SOIL_SOURCE_NAME; fetchedAt: number };
}

/** `no-data`: the survey has nothing at this point. `unavailable`: the
 *  service could not be reached. They are never the same thing. */
export type SoilLookup =
  { status: 'ok'; survey: SoilSurvey } | { status: 'no-data' } | { status: 'unavailable' };

/** The lookup for an Area. `approximate` means the Area is not drawn, so the
 *  farm's saved location was used instead of the Area's own centre. */
export interface SoilAreaLookup {
  lookup: SoilLookup;
  approximate: boolean;
  lat: number;
  lon: number;
}

/** Body of `GET /api/soil/areas/[id]`. `located: false` means the Area is
 *  not drawn and the farm has no saved location. */
export type SoilAreaResponse =
  { located: false } | { located: true; approximate: boolean; lookup: SoilLookup };

export type SoilLineId =
  | 'name'
  | 'texture'
  | 'drainage'
  | 'slope'
  | 'water-table'
  | 'bedrock'
  | 'flooding'
  | 'ph'
  | 'organic-matter'
  | 'farmland';

export interface SoilLine {
  id: SoilLineId;
  label: string;
  value: string;
  note?: string;
  provenance: 'data';
}

export type SoilSitingFlagId =
  | 'wet'
  | 'steep'
  | 'shallow-bedrock'
  | 'high-water-table'
  | 'floods'
  | 'droughty'
  | 'not-soil'
  | 'hydric';

export interface SoilSitingFlag {
  id: SoilSitingFlagId;
  severity: 'note' | 'caution';
}
