import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  EXTRACTION_METHODS,
  OPTIMUM_BANDS,
  SOIL_SOURCES,
  computedNutrientClass,
  interpretSoilTest,
  isSoilTestStale,
  limeEstimate,
  parseLabRatings,
  phClass,
  toLbPerAcre,
  toPpm,
  type ExtractionMethod,
  type NutrientClass
} from './soilInterpret';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 8, 27);

describe('toPpm', () => {
  it('halves lb/acre and keeps ppm, with a missing basis meaning ppm', () => {
    expect(toPpm(120, 'lb-per-acre')).toBe(60);
    expect(toPpm(60, 'ppm')).toBe(60);
    expect(toPpm(60, null)).toBe(60);
    expect(toPpm(60, undefined)).toBe(60);
    expect(toPpm(null, 'ppm')).toBeNull();
    expect(toPpm(Number.NaN, 'ppm')).toBeNull();
  });

  it('property: lb/acre and ppm round-trip', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 5000, noNaN: true }), (ppm) => {
        expect(toPpm(toLbPerAcre(ppm), 'lb-per-acre')).toBeCloseTo(ppm, 9);
      })
    );
  });
});

describe('phClass', () => {
  const cases: Array<[number, string]> = [
    [3.2, 'ultra-acid'],
    [4.4, 'extremely-acid'],
    [4.5, 'very-strongly-acid'],
    [5.0, 'very-strongly-acid'],
    [5.04, 'very-strongly-acid'],
    [5.1, 'strongly-acid'],
    [5.5, 'strongly-acid'],
    [5.6, 'moderately-acid'],
    [6.0, 'moderately-acid'],
    [6.1, 'slightly-acid'],
    [6.5, 'slightly-acid'],
    [6.6, 'neutral'],
    [7.3, 'neutral'],
    [7.4, 'slightly-alkaline'],
    [7.8, 'slightly-alkaline'],
    [7.9, 'moderately-alkaline'],
    [8.4, 'moderately-alkaline'],
    [8.5, 'strongly-alkaline'],
    [9.0, 'strongly-alkaline'],
    [9.1, 'very-strongly-alkaline']
  ];
  it.each(cases)('pH %s is %s', (ph, cls) => {
    expect(phClass(ph)).toBe(cls);
  });

  it('has no class without a real pH', () => {
    for (const v of [null, undefined, Number.NaN, -1, 15]) expect(phClass(v)).toBeNull();
  });
});

describe('P and K class by extraction method', () => {
  const table: Array<[ExtractionMethod, 'p' | 'k', number, NutrientClass | null]> = [
    ['mehlich-1', 'p', 5, 'low'],
    ['mehlich-1', 'p', 6, 'optimum'],
    ['mehlich-1', 'p', 17.5, 'optimum'],
    ['mehlich-1', 'p', 18, 'high'],
    ['mehlich-1', 'k', 37, 'low'],
    ['mehlich-1', 'k', 60, 'optimum'],
    ['mehlich-1', 'k', 90, 'high'],
    ['mehlich-3', 'p', 49, 'low'],
    ['mehlich-3', 'p', 75, 'optimum'],
    ['mehlich-3', 'p', 101, 'high'],
    ['mehlich-3', 'k', 150, null],
    ['bray-p1', 'p', 30, null],
    ['bray-p1', 'k', 150, null],
    ['olsen', 'p', 15, null],
    ['olsen', 'k', 150, null],
    ['morgan', 'p', 10, null],
    ['morgan', 'k', 150, null],
    ['modified-morgan', 'p', 10, null],
    ['modified-morgan', 'k', 150, null],
    ['other', 'p', 30, null],
    ['other', 'k', 150, null]
  ];
  it.each(table)('%s %s at %s ppm is %s', (method, nutrient, ppm, want) => {
    expect(computedNutrientClass(nutrient, ppm, method)).toBe(want);
  });

  it('covers every extraction method', () => {
    expect(new Set(table.map(([m]) => m))).toEqual(new Set(EXTRACTION_METHODS));
  });

  it('every band names a source on file', () => {
    for (const bands of Object.values(OPTIMUM_BANDS)) {
      for (const band of Object.values(bands ?? {})) {
        const src = SOIL_SOURCES[band.source];
        expect(src.url).toMatch(/^https:\/\//);
        expect(src.quote.length).toBeGreaterThan(20);
      }
    }
  });

  it('has no class without a method', () => {
    expect(computedNutrientClass('p', 30, null)).toBeNull();
  });

  it('Virginia Tech Mehlich-1 in lb/acre lands in the same class as ppm', () => {
    const lb = interpretSoilTest(
      {
        sampledAt: NOW,
        phosphorusPpm: 30,
        potassiumPpm: 150,
        extractionMethod: 'mehlich-1',
        unitsBasis: 'lb-per-acre'
      },
      NOW
    );
    const ppm = interpretSoilTest(
      {
        sampledAt: NOW,
        phosphorusPpm: 15,
        potassiumPpm: 75,
        extractionMethod: 'mehlich-1',
        unitsBasis: 'ppm'
      },
      NOW
    );
    expect(lb.p.computed).toBe('optimum');
    expect(lb.k.computed).toBe('optimum');
    expect(lb.p).toEqual(ppm.p);
    expect(lb.k).toEqual(ppm.k);
    expect(lb.p.lbPerAcre).toBe(30);
  });
});

describe('the lab rating wins', () => {
  it('shows the typed rating over the computed class and tags it manual', () => {
    const r = interpretSoilTest(
      {
        sampledAt: NOW,
        phosphorusPpm: 5,
        extractionMethod: 'mehlich-1',
        labRatings: { p: 'high' }
      },
      NOW
    );
    expect(r.p.computed).toBe('low');
    expect(r.p.label).toBe('High');
    expect(r.p.provenance).toBe('manual');
  });

  it('tags a computed class fallback and leaves an unknown method blank', () => {
    const m3 = interpretSoilTest(
      { sampledAt: NOW, phosphorusPpm: 75, extractionMethod: 'mehlich-3' },
      NOW
    );
    expect(m3.p.label).toBe('Optimum');
    expect(m3.p.provenance).toBe('fallback');
    const olsen = interpretSoilTest(
      { sampledAt: NOW, phosphorusPpm: 12, extractionMethod: 'olsen' },
      NOW
    );
    expect(olsen.p.label).toBeNull();
    expect(olsen.p.provenance).toBeNull();
  });

  it('rates calcium and magnesium only from the lab', () => {
    const r = interpretSoilTest(
      { sampledAt: NOW, caPpm: 900, mgPpm: 80, labRatings: { mg: 'low' } },
      NOW
    );
    expect(r.ca.label).toBeNull();
    expect(r.mg.label).toBe('Low');
  });

  it('parses only known ratings from stored JSON', () => {
    expect(parseLabRatings('{"p":"high","k":"nope","ca":"low","x":"high"}')).toEqual({
      p: 'high',
      ca: 'low'
    });
    expect(parseLabRatings('not json')).toEqual({});
    expect(parseLabRatings(null)).toEqual({});
    expect(parseLabRatings('[1]')).toEqual({});
  });
});

describe('lime estimate', () => {
  it('is always tagged fallback and never gives an amount', () => {
    for (const ph of [null, 4.8, 5.8, 6.0, 6.1, 7.5]) {
      const est = limeEstimate(ph);
      expect(est.provenance).toBe('fallback');
      expect(est.text).not.toMatch(/\d+\s*(lb|ton)/);
    }
  });

  it('says lime is likely at pH 6.0 and below, not above', () => {
    expect(limeEstimate(5.2).status).toBe('likely');
    expect(limeEstimate(6.0).status).toBe('likely');
    expect(limeEstimate(6.1).status).toBe('not-needed');
    expect(limeEstimate(7.8).status).toBe('not-needed');
    expect(limeEstimate(undefined).status).toBe('unknown');
  });

  it('mentions the buffer pH when the lab measured one', () => {
    expect(limeEstimate(5.5, 6.6).text).toContain('buffer pH of 6.6');
  });
});

describe('staleness', () => {
  it('is stale after three years, not before', () => {
    expect(isSoilTestStale(NOW - 365 * 3 * DAY + DAY, NOW)).toBe(false);
    expect(isSoilTestStale(NOW - 365 * 3 * DAY - 2 * DAY, NOW)).toBe(true);
    const r = interpretSoilTest({ sampledAt: NOW - 4 * 365 * DAY }, NOW);
    expect(r.stale).toBe(true);
    expect(Math.floor(r.ageYears)).toBe(3);
  });
});
