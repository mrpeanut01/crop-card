/**
 * Find a spot (Phase 38D). Client-safe types and the goal table. Everything
 * here is an app-owned rough guide for choosing where to plant: nothing gates
 * anything, and nothing in the safety kernel reads it (P-6, P-8).
 */

import type { AreaKind } from '$lib/farm/areaKinds';

export const PLANTING_GOALS = [
  'vegetable-garden',
  'herb-garden',
  'flower-garden',
  'raised-beds',
  'fruit-trees',
  'berry-patch',
  'row-crop-field'
] as const;
export type PlantingGoal = (typeof PLANTING_GOALS)[number];

export type LonLat = [lon: number, lat: number];

/** The rectangle the owner positions on the map. */
export interface SearchBox {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

/** The plot being placed, in feet: `widthFt` runs east to west, `lengthFt`
 *  north to south. */
export interface Footprint {
  widthFt: number;
  lengthFt: number;
}

export const SCORE_FACTOR_IDS = [
  'sun',
  'soil-drainage',
  'soil-depth',
  'slope',
  'water-distance',
  'house-distance',
  'tree-roots'
] as const;
export type ScoreFactorId = (typeof SCORE_FACTOR_IDS)[number];

export interface GoalSpec {
  /** A starting size the owner can change. An app default, not a
   *  recommendation. */
  defaultFootprint: Footprint;
  /** The Area kind "Create this Area here" makes. */
  areaKind: Extract<AreaKind, 'garden' | 'orchard' | 'field'>;
  /** The longest side of the search box, in metres, so the aerial photo
   *  keeps enough detail. */
  maxBoxM: number;
  /** How much each factor counts for this goal. A rough app guide; 0 leaves
   *  the factor out. */
  weights: Record<ScoreFactorId, number>;
}

export const GARDEN_BOX_MAX_M = 120;
export const FIELD_BOX_MAX_M = 400;
export const MIN_BOX_M = 8;
export const MIN_FOOTPRINT_FT = 2;
export const MAX_FOOTPRINT_FT = 1000;

const w = (
  sun: number,
  drainage: number,
  depth: number,
  slope: number,
  water: number,
  house: number,
  roots: number
): Record<ScoreFactorId, number> => ({
  sun,
  'soil-drainage': drainage,
  'soil-depth': depth,
  slope,
  'water-distance': water,
  'house-distance': house,
  'tree-roots': roots
});

// Sizes and weights below are app-owned starting values and a rough guide.
// They are not an extension recommendation.
export const GOALS: Readonly<Record<PlantingGoal, GoalSpec>> = {
  'vegetable-garden': {
    defaultFootprint: { widthFt: 20, lengthFt: 30 },
    areaKind: 'garden',
    maxBoxM: GARDEN_BOX_MAX_M,
    weights: w(5, 3, 1, 2, 2, 1, 2)
  },
  'herb-garden': {
    defaultFootprint: { widthFt: 4, lengthFt: 8 },
    areaKind: 'garden',
    maxBoxM: GARDEN_BOX_MAX_M,
    weights: w(5, 3, 1, 1, 2, 3, 2)
  },
  'flower-garden': {
    defaultFootprint: { widthFt: 6, lengthFt: 12 },
    areaKind: 'garden',
    maxBoxM: GARDEN_BOX_MAX_M,
    weights: w(4, 3, 1, 1, 2, 2, 2)
  },
  'raised-beds': {
    defaultFootprint: { widthFt: 12, lengthFt: 16 },
    areaKind: 'garden',
    maxBoxM: GARDEN_BOX_MAX_M,
    weights: w(5, 1, 0, 3, 2, 2, 1)
  },
  'fruit-trees': {
    defaultFootprint: { widthFt: 40, lengthFt: 60 },
    areaKind: 'orchard',
    maxBoxM: FIELD_BOX_MAX_M,
    weights: w(5, 4, 3, 1, 1, 0, 1)
  },
  'berry-patch': {
    defaultFootprint: { widthFt: 10, lengthFt: 30 },
    areaKind: 'garden',
    maxBoxM: GARDEN_BOX_MAX_M,
    weights: w(4, 4, 2, 1, 2, 1, 2)
  },
  'row-crop-field': {
    defaultFootprint: { widthFt: 100, lengthFt: 200 },
    areaKind: 'field',
    maxBoxM: FIELD_BOX_MAX_M,
    weights: w(3, 4, 2, 4, 1, 0, 1)
  }
};

export function isPlantingGoal(v: unknown): v is PlantingGoal {
  return typeof v === 'string' && (PLANTING_GOALS as readonly string[]).includes(v);
}

export type ObstacleKind = 'tree' | 'tree-line' | 'building' | 'water' | 'pavement' | 'other';

export type ObstacleShape =
  | { type: 'circle'; center: LonLat; radiusM: number }
  | { type: 'polygon'; ring: LonLat[] }
  | { type: 'line'; points: LonLat[]; halfWidthM: number };

/** Something that casts shade or cannot be planted on. `manual` is what the
 *  owner drew; `ai` is what Claude saw in the aerial photo and stays a
 *  suggestion until the owner adds it to the map (P-6). */
export interface Obstacle {
  id: string;
  kind: ObstacleKind;
  shape: ObstacleShape;
  /** Null when nobody gave a height. The sun estimate then uses an app
   *  default and says the height was guessed. */
  heightFt: number | null;
  /** Leaf-on and leaf-off day of year for a deciduous tree. */
  deciduous?: { leafOnDay: number; leafOffDay: number } | null;
  name?: string;
  /** Claude's short note about it, after the server's guard. */
  note?: string;
  provenance: 'manual' | 'ai';
}

export type FactorId =
  | 'sun'
  | 'shade'
  | 'soil-drainage'
  | 'soil-depth'
  | 'slope'
  | 'water-distance'
  | 'house-distance'
  | 'overlap'
  | 'tree-roots'
  | 'ai-note';

export type FactorVerdict = 'good' | 'ok' | 'poor' | 'unknown';
export type FactorProvenance = 'data' | 'manual' | 'ai' | 'fallback';

export interface Factor {
  id: FactorId;
  verdict: FactorVerdict;
  /** A message key under `sitefinder.f.`, with its parameters. Lengths ride
   *  in metres (`m`) and are formatted for the viewer's units; text Claude
   *  wrote rides in `text` after the server's guard. */
  key: string;
  params: Record<string, string | number>;
  provenance: FactorProvenance;
}

export type Confidence = 'high' | 'medium' | 'low';

export interface Candidate {
  id: string;
  center: LonLat;
  /** The footprint rectangle, north-aligned, as a closed ring. */
  polygon: LonLat[];
  /** 0 to 100. A rough guide. */
  score: number;
  confidence: Confidence;
  factors: Factor[];
}

/** An existing Area or block outline the finder works around. */
export interface AreaShape {
  id: string;
  /** The Area id an "allow overlap" tick names (a block carries its Area's). */
  areaId: string;
  name: string;
  kind: AreaKind;
  ring: LonLat[];
}

export interface SunSeason {
  /** Day of year the frost-free season starts and ends. */
  startDay: number;
  endDay: number;
  /** `data` or `manual` from the farm's saved frost dates; `fallback` for
   *  the fixed mid-month days used when none are saved. */
  provenance: 'data' | 'manual' | 'fallback';
}

// Used only when the farm has no saved frost dates: mid April to mid
// October. An app default, tagged `fallback`.
export const FALLBACK_SEASON: SunSeason = { startDay: 105, endDay: 288, provenance: 'fallback' };

export interface SunEstimate {
  /** Estimated hours of direct sun on a midsummer day. */
  hoursSummer: number;
  /** The same at the two ends of the frost-free season, averaged. */
  hoursSpringFall: number;
  /** Which half of a summer day gets more of the sun. */
  morningVsAfternoon: 'morning' | 'afternoon' | 'even';
  /** Summer hours lost to shade. */
  shadedHoursSummer: number;
  /** The obstacle that takes the most summer sun, when one does. */
  mainShade: { obstacleId: string; when: 'morning' | 'afternoon' | 'all-day' } | null;
  /** True when a shading obstacle's height was an app default. */
  heightGuessed: boolean;
  provenance: 'fallback';
}
