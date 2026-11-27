import { t, type MessageKey } from '$lib/i18n';
import type { SoilSitingFlag, SoilSitingFlagId, SoilSurvey } from './types';

/**
 * Advisory flags for choosing a spot. Wet, droughty, flooding, hydric and
 * not-soil come only from the survey's own categorical classes. Slope and
 * depth have no NRCS category in this data, so they use the thresholds
 * below. Nothing here gates anything, and nothing in the safety kernel, the
 * Inputs Plan or fertility math reads it.
 */

// The slope and depth thresholds are a rough app guide for plain-word
// descriptions and flags. They are not an extension recommendation and not
// an NRCS class limit.
export const SLOPE_GENTLE_PCT = 3;
export const SLOPE_MODERATE_PCT = 8;
export const SLOPE_STEEP_PCT = 15;
export const SLOPE_VERY_STEEP_PCT = 30;
export const SHALLOW_BEDROCK_CAUTION_CM = 50;
export const SHALLOW_BEDROCK_NOTE_CM = 100;
export const HIGH_WATER_TABLE_CAUTION_CM = 50;
export const HIGH_WATER_TABLE_NOTE_CM = 100;

export type SlopeBand = 'flat' | 'gentle' | 'moderate' | 'steep' | 'very-steep';

export function slopeBand(slopePct: number): SlopeBand {
  if (slopePct >= SLOPE_VERY_STEEP_PCT) return 'very-steep';
  if (slopePct >= SLOPE_STEEP_PCT) return 'steep';
  if (slopePct >= SLOPE_MODERATE_PCT) return 'moderate';
  if (slopePct >= SLOPE_GENTLE_PCT) return 'gentle';
  return 'flat';
}

/** The map unit's slope, or the dominant component's when the unit has none. */
export function surveySlopePct(survey: SoilSurvey): number | null {
  return survey.slopePct ?? survey.components[0]?.slopePct ?? null;
}

function floodSeverity(words: string | null): SoilSitingFlag['severity'] | null {
  const w = words?.trim().toLowerCase();
  if (w === 'frequent' || w === 'very frequent') return 'caution';
  if (w === 'occasional') return 'note';
  return null;
}

export function soilSitingFlags(survey: SoilSurvey): SoilSitingFlag[] {
  const flags: SoilSitingFlag[] = [];
  const add = (id: SoilSitingFlagId, severity: SoilSitingFlag['severity']) =>
    flags.push({ id, severity });

  if (survey.notSoil) add('not-soil', 'note');

  const drainage = survey.drainageClass ?? survey.components[0]?.drainageClass ?? null;
  if (drainage === 'poorly' || drainage === 'very-poorly') add('wet', 'caution');
  else if (drainage === 'somewhat-poorly') add('wet', 'note');
  else if (drainage === 'excessively' || drainage === 'somewhat-excessively') {
    add('droughty', 'note');
  }

  const flood = floodSeverity(survey.floodFrequency);
  if (flood) add('floods', flood);

  if (survey.components.some((c) => c.hydric === true)) add('hydric', 'note');

  if (survey.waterTableDepthCm !== null) {
    if (survey.waterTableDepthCm <= HIGH_WATER_TABLE_CAUTION_CM) add('high-water-table', 'caution');
    else if (survey.waterTableDepthCm <= HIGH_WATER_TABLE_NOTE_CM) add('high-water-table', 'note');
  }

  if (survey.bedrockDepthCm !== null) {
    if (survey.bedrockDepthCm <= SHALLOW_BEDROCK_CAUTION_CM) add('shallow-bedrock', 'caution');
    else if (survey.bedrockDepthCm <= SHALLOW_BEDROCK_NOTE_CM) add('shallow-bedrock', 'note');
  }

  const slope = surveySlopePct(survey);
  if (slope !== null) {
    if (slope >= SLOPE_STEEP_PCT) add('steep', 'caution');
    else if (slope >= SLOPE_MODERATE_PCT) add('steep', 'note');
  }

  return flags;
}

const FLAG_KEYS: Record<
  SoilSitingFlagId,
  Partial<Record<SoilSitingFlag['severity'], MessageKey>>
> = {
  wet: { caution: 'soil.flag.wet.caution', note: 'soil.flag.wet.note' },
  droughty: { note: 'soil.flag.droughty.note' },
  floods: { caution: 'soil.flag.floods.caution', note: 'soil.flag.floods.note' },
  hydric: { note: 'soil.flag.hydric.note' },
  'high-water-table': {
    caution: 'soil.flag.highWaterTable.caution',
    note: 'soil.flag.highWaterTable.note'
  },
  'shallow-bedrock': {
    caution: 'soil.flag.shallowBedrock.caution',
    note: 'soil.flag.shallowBedrock.note'
  },
  steep: { caution: 'soil.flag.steep.caution', note: 'soil.flag.steep.note' },
  'not-soil': { note: 'soil.flag.notSoil.note' }
};

/** The sentence for a flag. English without a locale. */
export function soilSitingFlagText(flag: SoilSitingFlag, locale?: string | null): string {
  const keys = FLAG_KEYS[flag.id];
  const key = keys[flag.severity] ?? keys.note ?? keys.caution;
  return key ? t(locale, key) : '';
}
