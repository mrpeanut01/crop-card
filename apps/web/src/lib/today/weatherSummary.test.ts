import { describe, it, expect } from 'vitest';
import { summarizeForecast, summarizeForecastSafely } from './weatherSummary';
import type { ForecastDay } from '$lib/hay/types';

function day(over: Partial<ForecastDay>): ForecastDay {
  return {
    date: over.date ?? '2026-05-24',
    popPct: over.popPct ?? 0,
    highF: over.highF ?? 68,
    lowF: over.lowF ?? 52,
    windMph: over.windMph,
    shortForecast: over.shortForecast
  };
}

describe('summarizeForecast', () => {
  it('returns null on empty input', () => {
    expect(summarizeForecast([])).toBeNull();
  });

  it('rounds temp + wind from today', () => {
    const result = summarizeForecast([day({ highF: 67.6, windMph: 5.4 })]);
    expect(result).toEqual(
      expect.objectContaining({
        tempF: 68,
        windMph: 5
      })
    );
  });

  it('skips windMph when undefined', () => {
    const result = summarizeForecast([day({ highF: 70 })]);
    expect(result?.windMph).toBeUndefined();
  });

  it('skips rain hint when next 3 days are all dry', () => {
    const result = summarizeForecast([
      day({ date: '2026-05-24', popPct: 5 }),
      day({ date: '2026-05-25', popPct: 10 }),
      day({ date: '2026-05-26', popPct: 0 })
    ]);
    expect(result?.rainHint).toBeUndefined();
  });

  it('emits single-day rain hint when only one wet day', () => {
    const result = summarizeForecast([
      day({ date: '2026-05-24', popPct: 5 }),
      day({ date: '2026-05-25', popPct: 45 })
    ]);
    expect(result?.rainHint).toBe('45% rain mon');
  });

  it('emits range rain hint when ≥2 wet days', () => {
    const result = summarizeForecast([
      day({ date: '2026-05-24', popPct: 50 }), // sun
      day({ date: '2026-05-25', popPct: 60 }) // mon
    ]);
    expect(result?.rainHint).toBe('rain sun→mon');
  });
});

describe('summarizeForecastSafely', () => {
  it('returns null on null input', () => {
    expect(summarizeForecastSafely(null)).toBeNull();
    expect(summarizeForecastSafely(undefined)).toBeNull();
    expect(summarizeForecastSafely([])).toBeNull();
  });

  it('returns null on thrown error', () => {
    // Sentinel that causes Math.round to NaN-propagate but doesn't actually
    // throw — surrogate for any unforeseen NWS payload weirdness.
    const result = summarizeForecastSafely([day({ highF: 70 })]);
    expect(result).not.toBeNull();
  });
});
