/**
 * Numbers the watering advice uses. Each key has a quoted entry in
 * `apps/web/scripts/water-sources.json`, checked by
 * `water.sources.gate.test.ts`.
 */

/** The fallback weekly target, in inches of water from rain or watering. */
export const DEFAULT_WEEKLY_TARGET_IN: number | null = 1;

/** 1 inch over 1 square foot: 144 cubic inches, at 231 per US gallon. */
export const GALLONS_PER_SQFT_INCH = 144 / 231;

export const WATER_SOURCED_KEYS = [
  'weeklyTargetIn',
  'metarHourlyPrecipGroup',
  'metarPrecipSensorOut',
  'gallonsPerSqFtInch',
  'potHeatHighF',
  'potHeatLowF'
] as const;

export const WATER_TARGET_SOURCE =
  'NC State Extension: vegetables need about one inch of water a week';

export const WATER_TARGET_MIN_IN = 0.1;
export const WATER_TARGET_MAX_IN = 5;

export function waterTargetKey(fieldId: string): string {
  return `water_target_in_week.${fieldId}`;
}

/** Phase 37E (R-11): a forecast this hot by day and by night adds "check
 *  pots today" on container Areas. Each number needs a quoted entry under
 *  `potHeatHighF` / `potHeatLowF`; while either is null the line never shows. */
export const POT_HEAT_HIGH_F: number | null = 90;
export const POT_HEAT_LOW_F: number | null = 70;

export interface PotHeatThresholds {
  highF: number | null;
  lowF: number | null;
}

export const POT_HEAT_THRESHOLDS: PotHeatThresholds = {
  highF: POT_HEAT_HIGH_F,
  lowF: POT_HEAT_LOW_F
};

/** True when the next day's forecast high and low are both above the
 *  sourced thresholds; false whenever a threshold is not sourced. */
export function potHeatApplies(
  forecast: { highF: number; lowF: number },
  thresholds: PotHeatThresholds = POT_HEAT_THRESHOLDS
): boolean {
  if (thresholds.highF === null || thresholds.lowF === null) return false;
  return forecast.highF > thresholds.highF && forecast.lowF > thresholds.lowF;
}
