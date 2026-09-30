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
  'gallonsPerSqFtInch'
] as const;

export const WATER_TARGET_SOURCE =
  'NC State Extension: vegetables need about one inch of water a week';

export const WATER_TARGET_MIN_IN = 0.1;
export const WATER_TARGET_MAX_IN = 5;

export function waterTargetKey(fieldId: string): string {
  return `water_target_in_week.${fieldId}`;
}
