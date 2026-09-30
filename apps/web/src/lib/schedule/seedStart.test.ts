import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  DAY_MS,
  HARDEN_TIMING_UNKNOWN,
  PAST_START_BODY,
  dtmCountsFromTransplantNote,
  germinationMax,
  germinationText,
  maturityStartMs,
  preselectedEstablishment,
  resolveSeedStartTiming,
  seedStartPlan,
  seedStartStepOf,
  seedStartTaskId,
  seedStartTaskText,
  seedStartTemplateKey,
  sowLeadDays,
  suggestedTransplantMs
} from './seedStart';
import { frostInYearOf } from '$lib/garden/occupancy';

const utc = (s: string) => Date.parse(`${s}T00:00:00Z`);

const cabbage = {
  cropFamily: 'brassica' as const,
  plantingGuide: {
    establishment: 'transplant' as const,
    startIndoorsWeeks: { min: 4, max: 6 },
    hardenOffDays: { min: 5, max: 14 }
  }
};

describe('resolveSeedStartTiming', () => {
  it('uses sourced plugin values tagged plugin', () => {
    const t = resolveSeedStartTiming(cabbage);
    expect(t.startIndoorsWeeks).toEqual({ min: 4, max: 6, source: 'plugin' });
    expect(t.hardenOffDays).toEqual({ min: 5, max: 14, source: 'plugin' });
  });

  it('is not known when neither the plugin nor a sourced family has a value', () => {
    const t = resolveSeedStartTiming({ cropFamily: 'root', plantingGuide: {} });
    expect(t).toEqual({ startIndoorsWeeks: null, hardenOffDays: null });
  });

  it('tags the sow timing manual when the owner typed a date', () => {
    const t = resolveSeedStartTiming(cabbage, { sowIndoorsOnMs: utc('2026-07-01') });
    expect(t.startIndoorsWeeks?.source).toBe('manual');
  });
});

describe('seedStartPlan', () => {
  it('backs off from the in-ground date by the midpoint and the longest hardening', () => {
    const inGround = utc('2026-05-10');
    const plan = seedStartPlan(inGround, resolveSeedStartTiming(cabbage));
    expect(sowLeadDays({ min: 4, max: 6 })).toBe(35);
    expect(plan.steps).toEqual([
      { step: 'sow', dateMs: inGround - 35 * DAY_MS, source: 'plugin' },
      { step: 'harden', dateMs: inGround - 14 * DAY_MS, source: 'plugin' },
      { step: 'transplant', dateMs: inGround, source: 'plugin' }
    ]);
    expect(plan.unknown).toEqual([]);
  });

  it('handles a fall brassica started in July across a year-crossing frost season', () => {
    // A farm whose first fall frost (Dec 10) comes before its last spring
    // frost (Feb 20) in calendar order: the frost season crosses the new year.
    const lastSpring = utc('2026-02-20');
    const firstFall = utc('2025-12-10');
    const inGround = utc('2026-08-20');
    const plan = seedStartPlan(inGround, resolveSeedStartTiming(cabbage));
    const sow = plan.steps.find((s) => s.step === 'sow')!;
    expect(new Date(sow.dateMs).toISOString().slice(0, 10)).toBe('2026-07-16');
    const harden = plan.steps.find((s) => s.step === 'harden')!;
    expect(new Date(harden.dateMs).toISOString().slice(0, 10)).toBe('2026-08-06');
    // Every step is before the frost that ends this season, and none moved
    // to the frost date: the anchor is the in-ground date alone.
    const seasonEnd = frostInYearOf(firstFall, inGround, lastSpring);
    expect(seasonEnd).toBeGreaterThan(inGround);
    for (const s of plan.steps) expect(s.dateMs).toBeLessThanOrEqual(inGround);
  });

  it('leaves out unknown steps and keeps the transplant', () => {
    const plan = seedStartPlan(utc('2026-05-10'), { startIndoorsWeeks: null, hardenOffDays: null });
    expect(plan.steps.map((s) => s.step)).toEqual(['transplant']);
    expect(plan.unknown).toEqual(['sow', 'harden']);
  });

  it('uses the owner sow date when timing is not known', () => {
    const sowOn = utc('2026-03-01');
    const plan = seedStartPlan(
      utc('2026-05-10'),
      { startIndoorsWeeks: null, hardenOffDays: null },
      { sowIndoorsOnMs: sowOn }
    );
    expect(plan.steps[0]).toEqual({ step: 'sow', dateMs: sowOn, source: 'manual' });
    expect(plan.unknown).toEqual(['harden']);
  });

  it('refuses a typed sow date on or after the transplant', () => {
    const inGround = utc('2026-05-10');
    for (const sowOn of [inGround, utc('2026-05-20')]) {
      const plan = seedStartPlan(
        inGround,
        { startIndoorsWeeks: null, hardenOffDays: null },
        { sowIndoorsOnMs: sowOn }
      );
      expect(plan.steps.map((s) => s.step)).toEqual(['transplant']);
      expect(plan.unknown).toContain('sow');
      expect(plan.sowAfterTransplant).toBe(true);
    }
  });

  it('never puts a step after the transplant (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: utc('2020-01-01'), max: utc('2035-01-01') }),
        fc.integer({ min: 0, max: 16 }),
        fc.integer({ min: 0, max: 8 }),
        fc.integer({ min: 0, max: 21 }),
        fc.integer({ min: 0, max: 14 }),
        (inGround, wMin, wSpan, dMin, dSpan) => {
          const plan = seedStartPlan(inGround, {
            startIndoorsWeeks: { min: wMin, max: wMin + wSpan, source: 'plugin' },
            hardenOffDays: { min: dMin, max: dMin + dSpan, source: 'plugin' }
          });
          const sow = plan.steps[0].dateMs;
          const harden = plan.steps[1].dateMs;
          return sow <= inGround && harden <= inGround && (inGround - sow) % DAY_MS === 0;
        }
      )
    );
  });
});

describe('ids and keys', () => {
  it('matches the ruling shapes', () => {
    expect(seedStartTaskId('c1', 'sow')).toBe('tk_seed_c1_sow');
    expect(seedStartTemplateKey('c1', 'harden')).toBe('seedstart:c1:harden');
    expect(seedStartStepOf('seedstart:c1:transplant')).toBe('transplant');
    expect(seedStartStepOf('crop:x:pre:y')).toBeNull();
  });
});

describe('seedStartTaskText', () => {
  const timing = resolveSeedStartTiming(cabbage);
  it('titles each step', () => {
    const base = { cropName: 'Red Acre', bedName: 'Bed 3', timing, nowMs: utc('2026-01-01') };
    expect(seedStartTaskText({ ...base, step: 'sow', dateMs: utc('2026-04-01') }).title).toBe(
      'Sow Red Acre indoors'
    );
    expect(seedStartTaskText({ ...base, step: 'sow', dateMs: utc('2026-04-01') }).body).toContain(
      '4 to 6 weeks before transplant'
    );
    expect(seedStartTaskText({ ...base, step: 'harden', dateMs: utc('2026-04-01') }).title).toBe(
      'Start hardening off Red Acre'
    );
    expect(
      seedStartTaskText({ ...base, step: 'transplant', dateMs: utc('2026-04-01') }).title
    ).toBe('Transplant Red Acre to Bed 3');
  });

  it('says a past sow date is late instead of moving it', () => {
    const t = seedStartTaskText({
      step: 'sow',
      cropName: 'Red Acre',
      bedName: 'Bed 3',
      timing,
      dateMs: utc('2026-03-01'),
      nowMs: utc('2026-03-20')
    });
    expect(t.body).toContain(PAST_START_BODY);
  });

  it('tells the grower to harden off when the timing is not known', () => {
    const t = seedStartTaskText({
      step: 'transplant',
      cropName: 'X',
      bedName: 'B',
      timing: { startIndoorsWeeks: null, hardenOffDays: null },
      dateMs: 0,
      nowMs: 0
    });
    expect(t.body).toBe(HARDEN_TIMING_UNKNOWN);
  });
});

describe('maturityStartMs (E1-11)', () => {
  const planted = utc('2026-05-10');
  const sown = utc('2026-03-20');
  it('stays on the in-ground date unless all three conditions hold', () => {
    const cases: Array<
      [Parameters<typeof maturityStartMs>[0], 'direct-seed' | 'transplant' | undefined]
    > = [
      [{ plantingDate: planted, establishment: null, sownIndoorsAt: sown }, 'direct-seed'],
      [{ plantingDate: planted, establishment: 'direct-seed', sownIndoorsAt: sown }, 'direct-seed'],
      [{ plantingDate: planted, establishment: 'transplant', sownIndoorsAt: null }, 'direct-seed'],
      [{ plantingDate: planted, establishment: 'transplant', sownIndoorsAt: sown }, 'transplant'],
      [{ plantingDate: planted, establishment: 'transplant', sownIndoorsAt: sown }, undefined]
    ];
    for (const [crop, dtmFrom] of cases) {
      expect(maturityStartMs(crop, { plantingGuide: { dtmFrom } })).toBe(planted);
    }
  });

  it('counts from the indoor sowing for a transplant whose DTM counts from seeding', () => {
    expect(
      maturityStartMs(
        { plantingDate: planted, establishment: 'transplant', sownIndoorsAt: sown },
        { plantingGuide: { dtmFrom: 'direct-seed' } }
      )
    ).toBe(sown);
  });

  it('only notes a direct-seeded crop whose DTM counts from transplant', () => {
    expect(
      dtmCountsFromTransplantNote('direct-seed', { plantingGuide: { dtmFrom: 'transplant' } })
    ).toBe(true);
    expect(
      dtmCountsFromTransplantNote('transplant', { plantingGuide: { dtmFrom: 'transplant' } })
    ).toBe(false);
  });
});

describe('preselection and prefill', () => {
  it('preselects only a plain answer', () => {
    expect(preselectedEstablishment(cabbage)).toBe('transplant');
    expect(
      preselectedEstablishment({ cropFamily: 'root', plantingGuide: { establishment: 'either' } })
    ).toBeNull();
    expect(preselectedEstablishment(undefined)).toBeNull();
  });

  it('prefills frost plus offset, clamped into the window, and nothing without an offset', () => {
    const frost = utc('2026-04-20');
    const withOffset = {
      cropFamily: 'solanaceae' as const,
      plantingGuide: { transplantOffsetDays: 14 }
    };
    expect(suggestedTransplantMs(withOffset, frost)).toBe(utc('2026-05-04'));
    expect(
      suggestedTransplantMs(withOffset, frost, {
        startMs: utc('2026-05-10'),
        endMs: utc('2026-06-01')
      })
    ).toBe(utc('2026-05-10'));
    expect(suggestedTransplantMs(cabbage, frost)).toBeNull();
  });
});

describe('germination', () => {
  it('bounds and words the count', () => {
    expect(germinationMax(72, 1)).toBe(72);
    expect(germinationMax(null, 2)).toBe(10_000);
    expect(germinationText(12, 72, 1)).toBe('12 of 72 up');
    expect(germinationText(null, null, null)).toBe('0 up');
  });
});
