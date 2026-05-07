import type { EnvironmentalConditions, SafetyViolation } from './types';

/**
 * Pre-spray environmental gates. Bounds match VDACS guidance for small-plot
 * herbicide application; tightening these is a kernel change.
 */
export const ENV_BOUNDS = {
  maxWindMph: 10,
  minTempF: 40,
  maxTempF: 85,
  maxRainForecastMmNext24h: 5
} as const;

export function checkEnvironment(
  conditions: EnvironmentalConditions
): SafetyViolation[] {
  const violations: SafetyViolation[] = [];

  if (conditions.windMph > ENV_BOUNDS.maxWindMph) {
    violations.push({
      code: 'ENV_WIND',
      message: `Wind ${conditions.windMph} mph exceeds ${ENV_BOUNDS.maxWindMph} mph maximum`,
      detail: { windMph: conditions.windMph, max: ENV_BOUNDS.maxWindMph }
    });
  }

  if (conditions.tempF < ENV_BOUNDS.minTempF || conditions.tempF > ENV_BOUNDS.maxTempF) {
    violations.push({
      code: 'ENV_TEMP',
      message: `Temperature ${conditions.tempF}°F outside ${ENV_BOUNDS.minTempF}–${ENV_BOUNDS.maxTempF}°F range`,
      detail: {
        tempF: conditions.tempF,
        min: ENV_BOUNDS.minTempF,
        max: ENV_BOUNDS.maxTempF
      }
    });
  }

  if (conditions.rainForecastMmNext24h > ENV_BOUNDS.maxRainForecastMmNext24h) {
    violations.push({
      code: 'ENV_RAIN',
      message: `Rain forecast ${conditions.rainForecastMmNext24h}mm/24h exceeds ${ENV_BOUNDS.maxRainForecastMmNext24h}mm maximum`,
      detail: {
        rainForecastMmNext24h: conditions.rainForecastMmNext24h,
        max: ENV_BOUNDS.maxRainForecastMmNext24h
      }
    });
  }

  return violations;
}
