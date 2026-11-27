import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { SoilLookup } from '$lib/soil/types';
import { es } from '$lib/i18n/catalogs/es';
import { en } from '$lib/i18n/catalogs/en';
import {
  GOOD_SCORE,
  HOUSE_FAR_M,
  WATER_FAR_M,
  WATER_FLOOR,
  WATER_NEAR_M,
  combine,
  depthScore,
  distanceValue,
  drainageScore,
  houseScore,
  slopeScore,
  sunScore,
  sunValue,
  treeScore,
  verdictOf,
  waterScore,
  type FactorScore
} from './score';
import {
  confidenceText,
  distanceText,
  factorLines,
  factorText,
  spotLabel,
  spotLabelText
} from './explain';
import { survey } from './testSupport';
import { GOALS, PLANTING_GOALS, SCORE_FACTOR_IDS, type Factor, type SunEstimate } from './types';

const ok = (patch = {}): SoilLookup => ({ status: 'ok', survey: survey(patch) });
const dist = fc.double({ min: 0, max: 500, noNaN: true });

function sun(hoursSummer: number, hoursSpringFall = hoursSummer): SunEstimate {
  return {
    hoursSummer,
    hoursSpringFall,
    morningVsAfternoon: 'even',
    shadedHoursSummer: 0,
    mainShade: null,
    heightGuessed: false,
    provenance: 'fallback'
  };
}

describe('distance factors', () => {
  it('closer water never scores lower', () => {
    fc.assert(
      fc.property(dist, dist, (a, b) => {
        const near = Math.min(a, b);
        const far = Math.max(a, b);
        expect(waterScore({ m: near, name: 'Tap' }).value!).toBeGreaterThanOrEqual(
          waterScore({ m: far, name: 'Tap' }).value!
        );
        expect(houseScore(near).value!).toBeGreaterThanOrEqual(houseScore(far).value!);
      })
    );
  });

  it('is full up to near and the floor from far on', () => {
    expect(distanceValue(0, WATER_NEAR_M, WATER_FAR_M, WATER_FLOOR)).toBe(1);
    expect(distanceValue(WATER_NEAR_M, WATER_NEAR_M, WATER_FAR_M, WATER_FLOOR)).toBe(1);
    expect(distanceValue(WATER_FAR_M, WATER_NEAR_M, WATER_FAR_M, WATER_FLOOR)).toBe(WATER_FLOOR);
    expect(distanceValue(9999, WATER_NEAR_M, WATER_FAR_M, WATER_FLOOR)).toBe(WATER_FLOOR);
    expect(houseScore(HOUSE_FAR_M * 2).value).toBeLessThan(1);
  });

  it('no water point or house is unknown, with the tip to mark it', () => {
    expect(waterScore(null)).toMatchObject({ value: null });
    expect(waterScore(null).factors[0]).toMatchObject({ key: 'water.unknown', verdict: 'unknown' });
    expect(houseScore(null).factors[0]).toMatchObject({ key: 'house.unknown' });
  });
});

describe('soil factors', () => {
  it('a poor drainage flag never raises the drainage value', () => {
    const good = drainageScore(ok()).value!;
    for (const patch of [
      { drainageClass: 'poorly' },
      { drainageClass: 'very-poorly' },
      { drainageClass: 'somewhat-poorly' },
      { floodFrequency: 'Frequent' },
      { floodFrequency: 'Occasional' },
      { waterTableDepthCm: 20 },
      { waterTableDepthCm: 80 },
      { drainageClass: 'excessively' }
    ] as const) {
      expect(drainageScore(ok(patch)).value!, JSON.stringify(patch)).toBeLessThan(good);
    }
    expect(drainageScore(ok({ drainageClass: 'very-poorly' })).value!).toBeLessThan(
      drainageScore(ok({ drainageClass: 'somewhat-poorly' })).value!
    );
  });

  it('survey facts are tagged data', () => {
    for (const s of [drainageScore(ok()), depthScore(ok()), slopeScore(ok())]) {
      expect(s.factors.every((f) => f.provenance === 'data')).toBe(true);
    }
    expect(drainageScore(ok()).factors[0].key).toBe('drainage.cls.well');
  });

  it('unreachable, missing and not-soil surveys are unknown and never the same words', () => {
    const unavailable = drainageScore({ status: 'unavailable' });
    const noData = drainageScore({ status: 'no-data' });
    const notSoil = drainageScore(ok({ notSoil: true }));
    expect([unavailable.value, noData.value, notSoil.value]).toEqual([null, null, null]);
    expect(unavailable.factors[0].key).toBe('soil.unavailable');
    expect(noData.factors[0].key).toBe('soil.noData');
    expect(notSoil.factors[0].key).toBe('soil.notSoil');
    expect(slopeScore({ status: 'unavailable' }).value).toBeNull();
    expect(depthScore({ status: 'no-data' }).value).toBeNull();
  });

  it('steeper ground and shallower rock never score higher', () => {
    const slopes = [0, 2, 5, 10, 20, 40].map((slopePct) => slopeScore(ok({ slopePct })).value!);
    expect([...slopes].sort((a, b) => b - a)).toEqual(slopes);
    expect(depthScore(ok({ bedrockDepthCm: 30 })).value!).toBeLessThan(
      depthScore(ok({ bedrockDepthCm: 80 })).value!
    );
    expect(depthScore(ok({ bedrockDepthCm: 80 })).value!).toBeLessThan(depthScore(ok()).value!);
  });
});

describe('sun and trees', () => {
  it('more sun never scores lower', () => {
    const h = fc.double({ min: 0, max: 15, noNaN: true });
    fc.assert(
      fc.property(h, h, h, (a, b, c) => {
        expect(sunValue(sun(Math.max(a, b), c))).toBeGreaterThanOrEqual(
          sunValue(sun(Math.min(a, b), c))
        );
      })
    );
    expect(sunScore(sun(9)).factors[0]).toMatchObject({ key: 'sun.full', provenance: 'fallback' });
    expect(sunScore(sun(5)).factors[0].key).toBe('sun.part');
    expect(sunScore(sun(2)).factors[0].key).toBe('sun.shade');
  });

  it('a closer tree never scores higher, and what Claude saw is tagged ai', () => {
    fc.assert(
      fc.property(dist, dist, (a, b) => {
        expect(
          treeScore({ m: Math.min(a, b), provenance: 'manual' }, true).value!
        ).toBeLessThanOrEqual(treeScore({ m: Math.max(a, b), provenance: 'manual' }, true).value!);
      })
    );
    expect(treeScore({ m: 2, provenance: 'ai' }, true).factors[0]).toMatchObject({
      key: 'roots.close',
      provenance: 'ai'
    });
    expect(treeScore(null, false).value).toBeNull();
    expect(treeScore(null, true).value).toBe(1);
  });
});

describe('combine', () => {
  const all = (value: number | null): FactorScore[] =>
    SCORE_FACTOR_IDS.map((id) => ({ id, value, factors: [] }));

  it('is 0 to 100 for every goal', () => {
    for (const goal of PLANTING_GOALS) {
      expect(combine(GOALS[goal], all(1), true).score).toBe(100);
      expect(combine(GOALS[goal], all(0), true).score).toBe(0);
      expect(combine(GOALS[goal], all(null), true)).toEqual({ score: 0, confidence: 'low' });
    }
  });

  it('raising one factor never lowers the score', () => {
    const v = fc.double({ min: 0, max: 1, noNaN: true });
    fc.assert(
      fc.property(
        fc.constantFrom(...PLANTING_GOALS),
        fc.array(v, { minLength: 7, maxLength: 7 }),
        fc.integer({ min: 0, max: 6 }),
        v,
        (goal, values, i, bump) => {
          const base = SCORE_FACTOR_IDS.map((id, n) => ({ id, value: values[n], factors: [] }));
          const up = base.map((s, n) => (n === i ? { ...s, value: Math.max(s.value, bump) } : s));
          expect(combine(GOALS[goal], up, true).score).toBeGreaterThanOrEqual(
            combine(GOALS[goal], base, true).score
          );
        }
      )
    );
  });

  it('an unknown factor lowers confidence, not the score', () => {
    const goal = GOALS['vegetable-garden'];
    const known = combine(goal, all(0.8), true);
    const partly = combine(
      goal,
      all(0.8).map((s) =>
        s.id === 'water-distance' || s.id === 'soil-drainage' ? { ...s, value: null } : s
      ),
      true
    );
    expect(partly.score).toBe(known.score);
    expect(known.confidence).toBe('high');
    expect(partly.confidence).not.toBe('high');
    expect(combine(goal, all(0.8), false).confidence).not.toBe('high');
  });

  it('leaves out a factor the goal gives no weight', () => {
    const goal = GOALS['row-crop-field'];
    const far = all(1).map((s) => (s.id === 'house-distance' ? { ...s, value: 0 } : s));
    expect(combine(goal, far, true).score).toBe(100);
  });

  it('verdict words follow the value bands', () => {
    expect([verdictOf(null), verdictOf(0.9), verdictOf(0.5), verdictOf(0.1)]).toEqual([
      'unknown',
      'good',
      'ok',
      'poor'
    ]);
  });
});

describe('explain', () => {
  const us = { units: 'us' as const };
  const factors: Factor[] = [
    { id: 'sun', verdict: 'good', key: 'sun.full', params: { hours: 9 }, provenance: 'fallback' },
    {
      id: 'shade',
      verdict: 'ok',
      key: 'shade.afternoon',
      params: { thing: 'tree', dir: 's', guessed: 0 },
      provenance: 'manual'
    },
    {
      id: 'shade',
      verdict: 'ok',
      key: 'shade.morning',
      params: { thing: 'building', dir: 'ne', guessed: 1 },
      provenance: 'ai'
    },
    {
      id: 'soil-drainage',
      verdict: 'good',
      key: 'drainage.cls.well',
      params: {},
      provenance: 'data'
    },
    {
      id: 'soil-drainage',
      verdict: 'poor',
      key: 'soil.flag',
      params: { flag: 'wet', severity: 'caution' },
      provenance: 'data'
    },
    { id: 'slope', verdict: 'good', key: 'slope.flat', params: {}, provenance: 'data' },
    {
      id: 'water-distance',
      verdict: 'good',
      key: 'water.dist',
      params: { m: 12.192, name: 'Tap' },
      provenance: 'manual'
    },
    {
      id: 'water-distance',
      verdict: 'unknown',
      key: 'water.unknown',
      params: {},
      provenance: 'manual'
    },
    {
      id: 'house-distance',
      verdict: 'ok',
      key: 'house.dist',
      params: { m: 30 },
      provenance: 'manual'
    },
    { id: 'tree-roots', verdict: 'poor', key: 'roots.close', params: { m: 3 }, provenance: 'ai' },
    {
      id: 'overlap',
      verdict: 'ok',
      key: 'overlap.inside',
      params: { name: 'Old garden' },
      provenance: 'manual'
    },
    {
      id: 'ai-note',
      verdict: 'good',
      key: 'ai.note',
      params: { text: 'Open lawn.' },
      provenance: 'ai'
    }
  ];

  it('writes plain English sentences', () => {
    const text = factors.map((f) => factorText(f, us));
    expect(text[0]).toBe('Gets sun most of the day in summer: about 9 hours, by a rough estimate.');
    expect(text[1]).toBe('A tree to the south shades this spot in the afternoon.');
    expect(text[2]).toBe(
      'A building to the northeast shades this spot in the morning. Its height is a guess.'
    );
    expect(text[3]).toBe('The soil survey calls this ground well drained.');
    expect(text[6]).toBe('About 40 ft from your water (Tap).');
    expect(text[7]).toBe('Mark your water tap on the map to include it.');
    expect(text[11]).toBe('Claude saw: Open lawn.');
    expect(factorText(factors[6], { units: 'metric' })).toBe('About 12 m from your water (Tap).');
    expect(distanceText(30.48, us)).toBe('100 ft');
  });

  it('English is byte-identical with no locale, with en and with an unknown locale', () => {
    for (const f of factors) {
      const plain = factorText(f, us);
      expect(factorText(f, { ...us, locale: 'en' })).toBe(plain);
      expect(factorText(f, { ...us, locale: null })).toBe(plain);
      expect(factorText(f, { ...us, locale: 'xx' })).toBe(plain);
    }
  });

  it('writes Spanish for every factor and leaves no placeholder or raw key', () => {
    for (const f of factors) {
      const english = factorText(f, us);
      const spanish = factorText(f, { ...us, locale: 'es' });
      expect(spanish, f.key).not.toBe(english);
      for (const text of [english, spanish]) {
        expect(text).not.toMatch(/[{}]/);
        expect(text).not.toMatch(/sitefinder\./);
        expect(text).not.toMatch(/[–—]/);
        expect(text.toLowerCase()).not.toMatch(/\bsafe\b/);
      }
    }
    expect(factorText(factors[1], { ...us, locale: 'es' })).toBe(
      'Un árbol al sur da sombra a este lugar por la tarde.'
    );
  });

  it('every factor key the engine can emit has a sentence in both languages', () => {
    const emitted = [
      'sun.full',
      'sun.part',
      'sun.shade',
      'shade.morning',
      'shade.afternoon',
      'shade.all-day',
      'shade.guessed',
      'soil.unavailable',
      'soil.noData',
      'soil.notSoil',
      'drainage.unknown',
      'drainage.cls.well',
      'drainage.cls.moderately-well',
      'depth.good',
      'slope.flat',
      'slope.gentle',
      'slope.moderate',
      'slope.steep',
      'slope.very-steep',
      'water.dist',
      'water.unknown',
      'house.dist',
      'house.unknown',
      'roots.close',
      'roots.near',
      'overlap.inside',
      'ai.note'
    ];
    for (const key of emitted) {
      const full = `sitefinder.f.${key}` as keyof typeof en;
      expect(en[full], full).toBeTruthy();
      expect(es[full], full).toBeTruthy();
    }
  });

  it('the whole sitefinder catalog has no dashes, no "safe" and a Spanish value', () => {
    const keys = (Object.keys(en) as Array<keyof typeof en>).filter((k) =>
      k.startsWith('sitefinder.')
    );
    expect(keys.length).toBeGreaterThan(100);
    for (const key of keys) {
      expect(es[key], key).toBeTruthy();
      for (const text of [en[key], es[key] as string]) {
        expect(text, key).not.toMatch(/[–—]/);
        expect(text.toLowerCase(), key).not.toMatch(/\bsafe\b|\bseguro\b/);
      }
    }
  });

  it('labels and lines', () => {
    expect(spotLabel(GOOD_SCORE, 0)).toBe('best');
    expect(spotLabel(GOOD_SCORE, 1)).toBe('good');
    expect(spotLabel(GOOD_SCORE - 1, 0)).toBe('look');
    expect(spotLabel(100, 0, true)).toBe('look');
    expect(spotLabelText('best')).toBe('Best match');
    expect(spotLabelText('look', 'es')).toBe('Vale la pena verla');
    expect(confidenceText('low')).toBe('Much could not be checked.');
    const lines = factorLines({ factors }, us);
    expect(lines).toHaveLength(factors.length);
    expect(lines[0]).toMatchObject({ id: 'sun', verdict: 'good', provenance: 'fallback' });
  });
});
