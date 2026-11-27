import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { SoilLookup } from '$lib/soil/types';
import { es } from '$lib/i18n/catalogs/es';
import { en } from '$lib/i18n/catalogs/en';
import {
  FACING_FLOOR_STRENGTH,
  FACING_GOOD_STRENGTH,
  FACING_OK_STRENGTH,
  GOOD_SCORE,
  HOUSE_FAR_M,
  WATER_FAR_M,
  WATER_FLOOR,
  WATER_NEAR_M,
  combine,
  depthScore,
  distanceValue,
  drainageScore,
  facingScore,
  facingValue,
  facingVerdict,
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
import type { SpotTerrain } from './terrain';
import {
  FACING_WEIGHT,
  GOALS,
  PLANTING_GOALS,
  SCORE_FACTOR_IDS,
  type Factor,
  type SunEstimate
} from './types';

function ground(patch: Partial<SpotTerrain> = {}): SpotTerrain {
  return {
    slopePct: 10,
    slopeDeg: Math.atan(0.1) * (180 / Math.PI),
    aspectDeg: 0,
    provenance: 'data',
    resolutionM: 1,
    coarse: false,
    ...patch
  };
}

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

describe('the lay of the land', () => {
  it("the spot's own slope wins over the soil survey's and says where it came from", () => {
    const fromSurvey = slopeScore(ok({ slopePct: 2 }));
    expect(fromSurvey.factors[0]).toMatchObject({ key: 'slope.flat', provenance: 'data' });
    expect(fromSurvey.factors[0].source).toBeUndefined();

    const fromElevation = slopeScore(ok({ slopePct: 2 }), ground({ slopePct: 20 }));
    expect(fromElevation.value).toBe(slopeScore(ok({ slopePct: 20 })).value);
    expect(fromElevation.factors[0]).toMatchObject({
      key: 'slope.here.steep',
      provenance: 'data',
      source: 'elevation',
      verdict: 'poor'
    });

    const fromOwner = slopeScore(
      ok({ slopePct: 20 }),
      ground({ slopePct: 1, provenance: 'manual' })
    );
    expect(fromOwner.factors[0]).toMatchObject({ key: 'slope.here.flat', provenance: 'manual' });
    expect(fromOwner.factors[0].source).toBeUndefined();
    expect(slopeScore({ status: 'unavailable' }, ground()).value).not.toBeNull();
    expect(slopeScore({ status: 'unavailable' }).value).toBeNull();
  });

  it('uses the same steepness bands for elevation data as for the survey', () => {
    for (const slopePct of [0, 2.9, 3, 7.9, 8, 14.9, 15, 29.9, 30, 60]) {
      expect(slopeScore({ status: 'no-data' }, ground({ slopePct })).value).toBe(
        slopeScore(ok({ slopePct })).value
      );
    }
  });

  it('stronger sun on the slope never scores lower, with named bands', () => {
    const r = fc.double({ min: 0, max: 1.6, noNaN: true });
    fc.assert(
      fc.property(r, r, (a, b) => {
        expect(facingValue(Math.max(a, b))).toBeGreaterThanOrEqual(facingValue(Math.min(a, b)));
      })
    );
    expect(facingValue(1)).toBe(1);
    expect(facingValue(1.3)).toBe(1);
    expect(facingValue(FACING_FLOOR_STRENGTH)).toBe(0);
    expect(facingVerdict(FACING_GOOD_STRENGTH)).toBe('good');
    expect(facingVerdict(FACING_GOOD_STRENGTH - 0.01)).toBe('ok');
    expect(facingVerdict(FACING_OK_STRENGTH)).toBe('ok');
    expect(facingVerdict(FACING_OK_STRENGTH - 0.01)).toBe('poor');
  });

  it('names the way the ground faces and tags it', () => {
    const north = facingScore(ground({ aspectDeg: 350 }), { relativeStrength: 0.9 });
    expect(north.factors[0]).toMatchObject({
      id: 'facing',
      key: 'facing.north',
      params: { dir: 'n' },
      verdict: 'ok',
      provenance: 'data',
      source: 'elevation'
    });
    expect(
      facingScore(ground({ aspectDeg: 135 }), { relativeStrength: 1.07 }).factors[0]
    ).toMatchObject({ key: 'facing.south', params: { dir: 'se' }, verdict: 'good' });
    expect(facingScore(ground({ aspectDeg: 90 }), { relativeStrength: 0.99 }).factors[0].key).toBe(
      'facing.east'
    );
    expect(facingScore(ground({ aspectDeg: 270 }), { relativeStrength: 0.99 }).factors[0].key).toBe(
      'facing.west'
    );
    expect(
      facingScore(ground({ aspectDeg: 0, slopePct: 40 }), { relativeStrength: 0.64 }).factors[0]
        .verdict
    ).toBe('poor');
    const owner = facingScore(ground({ aspectDeg: 180, provenance: 'manual' }), {
      relativeStrength: 1.1
    });
    expect(owner.factors[0].provenance).toBe('manual');
    expect(owner.factors[0].source).toBeUndefined();
  });

  it('level ground counts in full and adds no second line', () => {
    expect(facingScore(ground({ slopePct: 1, aspectDeg: null }), {})).toEqual({
      id: 'facing',
      value: 1,
      factors: []
    });
  });

  it('carries a small weight for the goals that want strong sun and none for a row-crop field', () => {
    for (const goal of PLANTING_GOALS) {
      const weights = GOALS[goal].weights;
      expect(weights.facing).toBe(goal === 'row-crop-field' ? 0 : FACING_WEIGHT);
      if (weights.facing > 0) expect(weights.facing).toBeLessThan(weights.sun);
    }
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
        fc.array(v, { minLength: SCORE_FACTOR_IDS.length, maxLength: SCORE_FACTOR_IDS.length }),
        fc.integer({ min: 0, max: SCORE_FACTOR_IDS.length - 1 }),
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
    },
    {
      id: 'slope',
      verdict: 'good',
      key: 'slope.here.flat',
      params: { coarse: 0 },
      provenance: 'data',
      source: 'elevation'
    },
    {
      id: 'slope',
      verdict: 'ok',
      key: 'slope.here.moderate',
      params: { coarse: 1 },
      provenance: 'data',
      source: 'elevation'
    },
    {
      id: 'facing',
      verdict: 'ok',
      key: 'facing.north',
      params: { dir: 'n' },
      provenance: 'data',
      source: 'elevation'
    },
    {
      id: 'facing',
      verdict: 'good',
      key: 'facing.south',
      params: { dir: 'sw' },
      provenance: 'manual'
    },
    { id: 'facing', verdict: 'good', key: 'facing.east', params: { dir: 'e' }, provenance: 'data' },
    { id: 'facing', verdict: 'good', key: 'facing.west', params: { dir: 'w' }, provenance: 'data' }
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
    expect(text[12]).toBe('The ground here is nearly level.');
    expect(text[13]).toBe(
      'The ground here has a moderate slope. This is from coarse elevation data, so small bumps and terraces do not show.'
    );
    expect(text[14]).toBe(
      'Slopes down to the north, so the sun is weaker here in spring and fall.'
    );
    expect(text[15]).toBe(
      'Slopes down to the southwest, so it gets stronger sun in spring and fall.'
    );
    expect(text[16]).toBe('Slopes down to the east, so it faces the morning sun.');
    expect(text[17]).toBe('Slopes down to the west, so it faces the afternoon sun.');
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
    expect(factorText(factors[14], { ...us, locale: 'es' })).toBe(
      'Baja hacia el norte, así que el sol es más débil aquí en primavera y otoño.'
    );
    expect(factorText(factors[13], { ...us, locale: 'es' })).toBe(
      'El terreno aquí tiene una pendiente moderada. Esto viene de datos de elevación poco detallados, así que no se ven los desniveles pequeños ni las terrazas.'
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
      'slope.here.flat',
      'slope.here.gentle',
      'slope.here.moderate',
      'slope.here.steep',
      'slope.here.very-steep',
      'terrain.coarse',
      'facing.north',
      'facing.south',
      'facing.east',
      'facing.west',
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
    expect(lines[0].source).toBeUndefined();
    expect(lines[12]).toMatchObject({ id: 'slope', provenance: 'data', source: 'elevation' });
  });
});
