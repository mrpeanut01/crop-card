import { describe, expect, it } from 'vitest';
import { checkEnvironment, ENV_BOUNDS } from './environment';

const ok = { windMph: 5, tempF: 70, rainForecastMmNext24h: 0 };

describe('checkEnvironment', () => {
  it('passes within all bounds', () => {
    expect(checkEnvironment(ok)).toEqual([]);
  });

  it('flags wind above max', () => {
    const v = checkEnvironment({ ...ok, windMph: ENV_BOUNDS.maxWindMph + 0.1 });
    expect(v[0].code).toBe('ENV_WIND');
  });

  it('flags temperature below min', () => {
    const v = checkEnvironment({ ...ok, tempF: ENV_BOUNDS.minTempF - 1 });
    expect(v[0].code).toBe('ENV_TEMP');
  });

  it('flags temperature above max', () => {
    const v = checkEnvironment({ ...ok, tempF: ENV_BOUNDS.maxTempF + 1 });
    expect(v[0].code).toBe('ENV_TEMP');
  });

  it('flags rain forecast above max', () => {
    const v = checkEnvironment({
      ...ok,
      rainForecastMmNext24h: ENV_BOUNDS.maxRainForecastMmNext24h + 0.1
    });
    expect(v[0].code).toBe('ENV_RAIN');
  });

  it('emits multiple violations independently', () => {
    const v = checkEnvironment({
      windMph: 999,
      tempF: 999,
      rainForecastMmNext24h: 999
    });
    expect(v.map((x) => x.code).sort()).toEqual(['ENV_RAIN', 'ENV_TEMP', 'ENV_WIND']);
  });
});
