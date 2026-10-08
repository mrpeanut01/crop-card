import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { forecastWords } from './forecastText';

describe('forecastWords (#613)', () => {
  it('returns NWS text unchanged in English or without a locale', () => {
    expect(forecastWords('Mostly Sunny')).toEqual({ text: 'Mostly Sunny', lang: null });
    expect(forecastWords('Mostly Sunny', 'en')).toEqual({ text: 'Mostly Sunny', lang: null });
    expect(forecastWords('', 'es')).toBeNull();
    expect(forecastWords(undefined, 'es')).toBeNull();
  });

  it('translates known NWS phrases into Spanish', () => {
    expect(forecastWords('Sunny', 'es')).toEqual({ text: 'Soleado', lang: null });
    expect(forecastWords('Partly Cloudy', 'es')?.text).toBe('Parcialmente nublado');
    expect(forecastWords('Chance Rain Showers', 'es')?.text).toBe('Probabilidad de chubascos');
    expect(forecastWords('Slight Chance Showers And Thunderstorms', 'es')?.text).toBe(
      'Ligera probabilidad de chubascos y tormentas eléctricas'
    );
    expect(forecastWords('Rain Likely', 'es')?.text).toBe('Alta probabilidad de lluvia');
    expect(forecastWords('Patchy Fog then Mostly Sunny', 'es')?.text).toBe(
      'Niebla en zonas y luego mayormente soleado'
    );
  });

  it('keeps unknown phrases in English, marked as English', () => {
    expect(forecastWords('Sunny and Breezy', 'es')).toEqual({
      text: 'Sunny and Breezy',
      lang: 'en'
    });
    expect(forecastWords('Sunny then Volcanic Ash', 'es')).toEqual({
      text: 'Sunny then Volcanic Ash',
      lang: 'en'
    });
  });

  it('never invents text: Spanish output is a translation or the exact English', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const w = forecastWords(s, 'es');
        if (!s.trim()) return w === null;
        if (w!.lang === 'en') return w!.text === s.trim();
        return w!.text.length > 0;
      })
    );
  });
});
