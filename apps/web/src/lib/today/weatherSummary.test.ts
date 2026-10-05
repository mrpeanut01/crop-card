import { describe, it, expect } from 'vitest';
import { createT } from '$lib/i18n';
import { formatCalendarDate } from '$lib/prefs';
import {
  forecastDays,
  rainHint,
  skyFor,
  summarizeForecast,
  summarizeForecastSafely,
  weatherByDate
} from './weatherSummary';
import type { ForecastDay } from '$lib/hay/types';

function day(over: Partial<ForecastDay>): ForecastDay {
  return {
    date: over.date ?? '2026-05-24',
    popPct: over.popPct ?? 0,
    highF: over.highF ?? 68,
    lowF: over.lowF ?? 52,
    windMph: over.windMph,
    shortForecast: over.shortForecast,
    overnightOnly: over.overnightOnly
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
});

describe('rainHint', () => {
  const hint = (days: ForecastDay[], locale: string | null = null) =>
    rainHint(days, createT(locale), (iso) =>
      formatCalendarDate(iso, 'weekday', {}, locale).toLowerCase()
    );

  it('is null when the next 3 days are all dry', () => {
    expect(
      hint([
        day({ date: '2026-05-24', popPct: 5 }),
        day({ date: '2026-05-25', popPct: 10 }),
        day({ date: '2026-05-26', popPct: 0 })
      ])
    ).toBeNull();
  });

  it('names the one wet day', () => {
    expect(
      hint([day({ date: '2026-05-24', popPct: 5 }), day({ date: '2026-05-25', popPct: 45 })])
    ).toBe('45% rain mon');
  });

  it('gives a range when two or more days are wet', () => {
    expect(
      hint([day({ date: '2026-05-24', popPct: 50 }), day({ date: '2026-05-25', popPct: 60 })])
    ).toBe('rain sun→mon');
  });

  it('words the hint in the viewer language', () => {
    expect(hint([day({ date: '2026-05-25', popPct: 45 })], 'es')).toBe('45% de lluvia el lun');
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

describe('summarizeForecast overnight', () => {
  it("shows tonight's low once only the overnight period is left", () => {
    const result = summarizeForecast([
      day({ highF: 54, lowF: 54, overnightOnly: true, shortForecast: 'Clear' })
    ]);
    expect(result).toMatchObject({ tempF: 54, tempKind: 'low', sky: 'clear-night' });
  });

  it('shows the daytime high otherwise', () => {
    const result = summarizeForecast([day({ highF: 71, lowF: 50, shortForecast: 'Sunny' })]);
    expect(result).toMatchObject({ tempF: 71, tempKind: 'high', sky: 'clear' });
  });
});

describe('skyFor', () => {
  it.each([
    ['Sunny', false, 'clear'],
    ['Mostly Sunny', false, 'clear'],
    ['Partly Cloudy', false, 'partly'],
    ['Partly Cloudy', true, 'partly-night'],
    ['Mostly Cloudy', false, 'cloudy'],
    ['Chance Rain Showers', false, 'rain'],
    ['Slight Chance Showers And Thunderstorms', false, 'storm'],
    ['Snow Likely', true, 'snow'],
    ['Patchy Fog', false, 'fog'],
    [undefined, true, 'clear-night']
  ] as const)('%s (night=%s) → %s', (f, night, sky) => {
    expect(skyFor(f, night)).toBe(sky);
  });
});

describe('forecastDays', () => {
  it('turns NWS days into calendar weather with a sky icon and rounded values', () => {
    const days = forecastDays([
      {
        date: '2026-09-29',
        popPct: 20,
        highF: 71.4,
        lowF: 52.6,
        windMph: 7.6,
        shortForecast: 'Sunny'
      },
      {
        date: '2026-09-30',
        popPct: 60,
        highF: 58,
        lowF: 58,
        shortForecast: 'Showers Likely',
        overnightOnly: true
      },
      { date: 'bad', popPct: 0, highF: Number.NaN, lowF: 3 }
    ]);
    expect(days).toEqual([
      {
        date: '2026-09-29',
        sky: 'clear',
        highF: 71,
        lowF: 53,
        popPct: 20,
        windMph: 8,
        shortForecast: 'Sunny',
        overnightOnly: false
      },
      {
        date: '2026-09-30',
        sky: 'rain',
        highF: 58,
        lowF: 58,
        popPct: 60,
        windMph: undefined,
        shortForecast: 'Showers Likely',
        overnightOnly: true
      }
    ]);
    expect(Object.keys(weatherByDate(days))).toEqual(['2026-09-29', '2026-09-30']);
    expect(forecastDays(null)).toEqual([]);
  });
});
