/**
 * Scoring for Find a spot. Pure and client-safe. Each factor gives a value
 * from 0 to 1 or "unknown"; the score is the weighted average of the known
 * ones for the goal. An unknown factor lowers confidence, never the score.
 * Every weight and threshold is an app-owned rough guide (P-6).
 */

import { soilSitingFlags, slopeBand, surveySlopePct, type SlopeBand } from '$lib/soil/siting';
import type { SoilLookup, SoilSitingFlag } from '$lib/soil/types';
import { FULL_SUN_HOURS, PART_SUN_HOURS, sunBand } from './sun';
import type {
  Confidence,
  Factor,
  FactorVerdict,
  GoalSpec,
  ScoreFactorId,
  SunEstimate
} from './types';

// Rough-guide constants. Not an extension recommendation.
/** Weighted summer and season-end sun hours that earn the top sun value. */
export const SUN_HOURS_FOR_TOP_SCORE = 8;
export const SUN_SUMMER_SHARE = 0.7;
/** Water tap distance: full value up to NEAR, sliding to the floor at FAR. */
export const WATER_NEAR_M = 15;
export const WATER_FAR_M = 90;
export const WATER_FLOOR = 0.2;
/** Walk from the house, the same way. */
export const HOUSE_NEAR_M = 15;
export const HOUSE_FAR_M = 120;
export const HOUSE_FLOOR = 0.3;
/** Tree roots and shade reach: closer than CLOSE is poor, closer than NEAR
 *  is fair. */
export const TREE_CLOSE_M = 6;
export const TREE_NEAR_M = 12;
export const TREE_CLOSE_VALUE = 0.3;
export const TREE_NEAR_VALUE = 0.7;
export const SLOPE_VALUE: Record<SlopeBand, number> = {
  flat: 1,
  gentle: 0.9,
  moderate: 0.6,
  steep: 0.3,
  'very-steep': 0.1
};
export const FLAG_CAUTION_VALUE = 0.15;
export const FLAG_NOTE_VALUE = 0.55;
export const DROUGHTY_VALUE = 0.7;
/** Value bands for the plain verdict words. */
export const GOOD_VALUE = 0.75;
export const OK_VALUE = 0.45;
/** Score bands for the card heading. */
export const GOOD_SCORE = 60;
/** Share of the goal's weight that was known, for the confidence words. */
export const HIGH_CONFIDENCE_SHARE = 0.8;
export const MEDIUM_CONFIDENCE_SHARE = 0.5;

export interface FactorScore {
  id: ScoreFactorId;
  /** 0 to 1, or null when it could not be judged. */
  value: number | null;
  factors: Factor[];
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

export function verdictOf(value: number | null): FactorVerdict {
  if (value === null) return 'unknown';
  if (value >= GOOD_VALUE) return 'good';
  if (value >= OK_VALUE) return 'ok';
  return 'poor';
}

/** Closer is never worse: full value up to `near`, a straight slide down to
 *  `floor` at `far`, flat after that. */
export function distanceValue(m: number, near: number, far: number, floor: number): number {
  if (!(m > near)) return 1;
  if (m >= far) return floor;
  return 1 - ((m - near) / (far - near)) * (1 - floor);
}

export function sunValue(sun: Pick<SunEstimate, 'hoursSummer' | 'hoursSpringFall'>): number {
  return clamp01(
    (SUN_SUMMER_SHARE * sun.hoursSummer + (1 - SUN_SUMMER_SHARE) * sun.hoursSpringFall) /
      SUN_HOURS_FOR_TOP_SCORE
  );
}

export function sunScore(sun: SunEstimate): FactorScore {
  const band = sunBand(sun.hoursSummer);
  return {
    id: 'sun',
    value: sunValue(sun),
    factors: [
      {
        id: 'sun',
        verdict: band === 'full' ? 'good' : band === 'part' ? 'ok' : 'poor',
        key: `sun.${band}`,
        params: { hours: Math.round(sun.hoursSummer) },
        provenance: 'fallback'
      }
    ]
  };
}

const DRAINAGE_FLAGS = new Set(['wet', 'floods', 'high-water-table', 'droughty']);

function flagValue(flag: SoilSitingFlag): number {
  if (flag.id === 'droughty') return DROUGHTY_VALUE;
  return flag.severity === 'caution' ? FLAG_CAUTION_VALUE : FLAG_NOTE_VALUE;
}

function flagFactor(id: Factor['id'], flag: SoilSitingFlag): Factor {
  return {
    id,
    verdict: verdictOf(flagValue(flag)),
    key: 'soil.flag',
    params: { flag: flag.id, severity: flag.severity },
    provenance: 'data'
  };
}

function soilUnknown(id: Factor['id'], soil: SoilLookup): Factor {
  const key =
    soil.status === 'unavailable'
      ? 'soil.unavailable'
      : soil.status === 'no-data'
        ? 'soil.noData'
        : 'soil.notSoil';
  return { id, verdict: 'unknown', key, params: {}, provenance: 'data' };
}

/** Drainage, flooding and water table, from the survey's own classes. */
export function drainageScore(soil: SoilLookup): FactorScore {
  if (soil.status !== 'ok' || soil.survey.notSoil) {
    return { id: 'soil-drainage', value: null, factors: [soilUnknown('soil-drainage', soil)] };
  }
  const flags = soilSitingFlags(soil.survey).filter((f) => DRAINAGE_FLAGS.has(f.id));
  if (flags.length > 0) {
    return {
      id: 'soil-drainage',
      value: Math.min(...flags.map(flagValue)),
      factors: flags.map((f) => flagFactor('soil-drainage', f))
    };
  }
  const cls = soil.survey.drainageClass ?? soil.survey.components[0]?.drainageClass ?? null;
  if (!cls) {
    return {
      id: 'soil-drainage',
      value: null,
      factors: [
        {
          id: 'soil-drainage',
          verdict: 'unknown',
          key: 'drainage.unknown',
          params: {},
          provenance: 'data'
        }
      ]
    };
  }
  return {
    id: 'soil-drainage',
    value: 1,
    factors: [
      {
        id: 'soil-drainage',
        verdict: 'good',
        key: `drainage.cls.${cls}`,
        params: {},
        provenance: 'data'
      }
    ]
  };
}

export function depthScore(soil: SoilLookup): FactorScore {
  if (soil.status !== 'ok' || soil.survey.notSoil)
    return { id: 'soil-depth', value: null, factors: [] };
  const flag = soilSitingFlags(soil.survey).find((f) => f.id === 'shallow-bedrock');
  if (flag) {
    return { id: 'soil-depth', value: flagValue(flag), factors: [flagFactor('soil-depth', flag)] };
  }
  return {
    id: 'soil-depth',
    value: 1,
    factors: [
      { id: 'soil-depth', verdict: 'good', key: 'depth.good', params: {}, provenance: 'data' }
    ]
  };
}

export function slopeScore(soil: SoilLookup): FactorScore {
  const pct = soil.status === 'ok' && !soil.survey.notSoil ? surveySlopePct(soil.survey) : null;
  if (pct === null) return { id: 'slope', value: null, factors: [] };
  const band = slopeBand(pct);
  const value = SLOPE_VALUE[band];
  return {
    id: 'slope',
    value,
    factors: [
      {
        id: 'slope',
        verdict: verdictOf(value),
        key: `slope.${band}`,
        params: {},
        provenance: 'data'
      }
    ]
  };
}

export function waterScore(nearest: { m: number; name: string } | null): FactorScore {
  if (!nearest) {
    return {
      id: 'water-distance',
      value: null,
      factors: [
        {
          id: 'water-distance',
          verdict: 'unknown',
          key: 'water.unknown',
          params: {},
          provenance: 'manual'
        }
      ]
    };
  }
  const value = distanceValue(nearest.m, WATER_NEAR_M, WATER_FAR_M, WATER_FLOOR);
  return {
    id: 'water-distance',
    value,
    factors: [
      {
        id: 'water-distance',
        verdict: verdictOf(value),
        key: 'water.dist',
        params: { m: Math.round(nearest.m), name: nearest.name },
        provenance: 'manual'
      }
    ]
  };
}

export function houseScore(m: number | null): FactorScore {
  if (m === null) {
    return {
      id: 'house-distance',
      value: null,
      factors: [
        {
          id: 'house-distance',
          verdict: 'unknown',
          key: 'house.unknown',
          params: {},
          provenance: 'manual'
        }
      ]
    };
  }
  const value = distanceValue(m, HOUSE_NEAR_M, HOUSE_FAR_M, HOUSE_FLOOR);
  return {
    id: 'house-distance',
    value,
    factors: [
      {
        id: 'house-distance',
        verdict: verdictOf(value),
        key: 'house.dist',
        params: { m: Math.round(m) },
        provenance: 'manual'
      }
    ]
  };
}

/** `nearest` is the closest tree; null when the map and photo show none.
 *  With no tree known the factor says nothing and is left out of the score
 *  unless shade was checked, when "no trees close by" is a real finding. */
export function treeScore(
  nearest: { m: number; provenance: 'manual' | 'ai' } | null,
  shadeChecked: boolean
): FactorScore {
  if (!nearest) return { id: 'tree-roots', value: shadeChecked ? 1 : null, factors: [] };
  const value =
    nearest.m < TREE_CLOSE_M ? TREE_CLOSE_VALUE : nearest.m < TREE_NEAR_M ? TREE_NEAR_VALUE : 1;
  if (value === 1) return { id: 'tree-roots', value, factors: [] };
  return {
    id: 'tree-roots',
    value,
    factors: [
      {
        id: 'tree-roots',
        verdict: verdictOf(value),
        key: nearest.m < TREE_CLOSE_M ? 'roots.close' : 'roots.near',
        params: { m: Math.round(nearest.m) },
        provenance: nearest.provenance
      }
    ]
  };
}

export interface Combined {
  score: number;
  confidence: Confidence;
}

/** The weighted average of the known factors, 0 to 100, and how much of the
 *  goal's weight was known. `sunChecked` false means no trees or buildings
 *  were drawn or seen, so the sun number is open sky by assumption: it still
 *  counts in the score, but not as something that was checked. */
export function combine(
  goal: Pick<GoalSpec, 'weights'>,
  scores: readonly FactorScore[],
  sunChecked: boolean
): Combined {
  let total = 0;
  let known = 0;
  let sum = 0;
  for (const s of scores) {
    const weight = goal.weights[s.id];
    if (!(weight > 0)) continue;
    total += weight;
    if (s.value === null) continue;
    sum += weight * clamp01(s.value);
    if (s.id !== 'sun' || sunChecked) known += weight;
  }
  const knownWeight = scores.reduce(
    (acc, s) => acc + (s.value !== null && goal.weights[s.id] > 0 ? goal.weights[s.id] : 0),
    0
  );
  const share = total > 0 ? known / total : 0;
  return {
    score: knownWeight > 0 ? Math.round((sum / knownWeight) * 100) : 0,
    confidence:
      share >= HIGH_CONFIDENCE_SHARE ? 'high' : share >= MEDIUM_CONFIDENCE_SHARE ? 'medium' : 'low'
  };
}

export { FULL_SUN_HOURS, PART_SUN_HOURS };
