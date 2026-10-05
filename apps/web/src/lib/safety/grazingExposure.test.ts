import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { GrazingRestrictions } from '$lib/plugins/schemas';
import { ymdInZone } from '$lib/prefs';
import {
  DAY_MS,
  GRAZING_LOOKBACK_DAYS,
  roundedClearMs,
  startOfNextLocalDay,
  type GrazingApplication
} from './grazingInterval';
import {
  evaluateExposureFoodUse,
  exposureFloorFor,
  exposureHolds,
  exposureSpans,
  exposureSpansFast,
  parseExposureFloor,
  serializeExposureFloor,
  stayWasExposed,
  type ExposureFloorEntry,
  type ExposureStay,
  type GrazingExposureInput
} from './grazingExposure';
import { FOODS, PRODUCTION_USES, type Food, type ProductionUse } from './animalWithdrawal';

const TZ = 'America/New_York';
const T = Date.UTC(2027, 4, 10, 16);
const fmt = (ms: number) => new Date(ms).toISOString().slice(0, 10);

function app(over: Partial<GrazingApplication> = {}): GrazingApplication {
  return {
    ref: 'spray:e1',
    source: 'spray',
    blockId: 'b1',
    appliedAtMs: T,
    productPluginId: 'weedkill',
    productName: 'Weedkill',
    restrictions: null,
    ...over
  };
}

const full: GrazingRestrictions = {
  source: 'test label',
  grazeDays: 7,
  hayDays: 30,
  lactatingDairyGrazeDays: 14,
  meatAnimalRemovalBeforeSlaughterDays: 3
};

function input(over: Partial<GrazingExposureInput> & { apps?: GrazingApplication[] } = {}) {
  const { apps = [app()], ...rest } = over;
  return {
    stays: [{ fieldId: 'f1', fromMs: T - DAY_MS, toMs: null }] as ExposureStay[],
    applicationsByField: new Map([['f1', apps]]),
    subject: { speciesId: 'sheep', lactating: true },
    food: 'milk' as Food,
    atMs: T + 2 * DAY_MS,
    timeZone: TZ,
    ...rest
  };
}

describe('exposureHolds (C-30, C-31)', () => {
  it('holds milk until the lactating interval clears when a spray lands on grazing animals', () => {
    const holds = exposureHolds(input({ apps: [app({ restrictions: full })] }));
    expect(holds).toHaveLength(1);
    expect(holds[0].reason).toBe('GRAZING_INTERVAL');
    expect(holds[0].clearsAtMs).toBe(roundedClearMs(T, 14, TZ));
    expect(holds[0].exposedAtMs).toBe(T);
  });

  it('uses the general interval for animals known not to be milking', () => {
    const holds = exposureHolds(
      input({
        apps: [app({ restrictions: full })],
        subject: { speciesId: 'sheep', lactating: false }
      })
    );
    expect(holds[0].clearsAtMs).toBe(roundedClearMs(T, 7, TZ));
  });

  it('adds the pre-slaughter removal days for meat', () => {
    const holds = exposureHolds(input({ apps: [app({ restrictions: full })], food: 'meat' }));
    expect(holds[0].clearsAtMs).toBe(roundedClearMs(roundedClearMs(T, 14, TZ), 3, TZ));
  });

  it('holds meat as unknown until the lookback ends when the removal days are missing', () => {
    const r: GrazingRestrictions = { ...full };
    delete r.meatAnimalRemovalBeforeSlaughterDays;
    const holds = exposureHolds(input({ apps: [app({ restrictions: r })], food: 'meat' }));
    expect(holds[0].reason).toBe('GRAZING_UNKNOWN');
    expect(holds[0].clearsAtMs).toBeNull();
    expect(holds[0].endsAtMs).toBe(startOfNextLocalDay(T + GRAZING_LOOKBACK_DAYS * DAY_MS, TZ));
  });

  it('holds every food as unknown for a product with no label data', () => {
    for (const food of FOODS) {
      const holds = exposureHolds(input({ food }));
      expect(holds).toHaveLength(1);
      expect(holds[0].reason).toBe('GRAZING_UNKNOWN');
      expect(holds[0].clearsAtMs).toBeNull();
    }
  });

  it('lets an owner attestation date the milk and egg hold for exactly that application', () => {
    const attestations = [
      {
        id: 'a1',
        sprayEventRef: 'spray:e1',
        productPluginId: 'weedkill',
        grazeDays: 5,
        hayDays: null,
        lactatingGrazeDays: 5
      }
    ];
    const holds = exposureHolds(input({ attestations, atMs: T + 3 * DAY_MS }));
    expect(holds[0].clearsAtMs).toBe(roundedClearMs(T, 5, TZ));
    expect(exposureHolds(input({ attestations, atMs: roundedClearMs(T, 5, TZ) }))).toEqual([]);
    const other = [{ ...attestations[0], sprayEventRef: 'spray:e2' }];
    expect(
      exposureHolds(input({ attestations: other, atMs: T + 30 * DAY_MS }))[0].clearsAtMs
    ).toBeNull();
  });

  it('keeps the meat hold unknown until the owner gives the removal days (review finding)', () => {
    const att = (extra: object = {}) => [
      {
        id: 'a1',
        sprayEventRef: 'spray:e1',
        productPluginId: 'weedkill',
        grazeDays: 0,
        hayDays: 30,
        lactatingGrazeDays: 0,
        ...extra
      }
    ];
    const dry = { speciesId: 'sheep', lactating: false };
    const meat = (attestations: ReturnType<typeof att>, atMs = T + 2 * DAY_MS) =>
      exposureHolds(input({ attestations, subject: dry, food: 'meat', atMs }));
    const unknown = meat(att());
    expect(unknown).toHaveLength(1);
    expect(unknown[0]).toMatchObject({ reason: 'GRAZING_UNKNOWN', clearsAtMs: null });
    const stays = [{ fieldId: 'f1', fromMs: T - DAY_MS, toMs: T + DAY_MS }];
    const dated = exposureHolds(
      input({
        attestations: att({ meatRemovalDays: 3 }),
        subject: dry,
        food: 'meat',
        stays,
        atMs: T + 2 * DAY_MS
      })
    );
    expect(dated[0]).toMatchObject({
      reason: 'GRAZING_INTERVAL',
      clearsAtMs: roundedClearMs(T + DAY_MS, 3, TZ)
    });
    expect(
      exposureHolds(
        input({
          attestations: att({ meatRemovalDays: 0 }),
          subject: dry,
          food: 'meat',
          stays,
          atMs: T + 2 * DAY_MS
        })
      )
    ).toEqual([]);
    expect(exposureHolds(input({ attestations: att(), subject: dry, food: 'eggs' }))).toEqual([]);
  });

  it('an attested removal never shortens the label value', () => {
    const stays = [{ fieldId: 'f1', fromMs: T + 8 * DAY_MS, toMs: T + 9 * DAY_MS }];
    const holds = exposureHolds(
      input({
        apps: [app({ restrictions: full })],
        attestations: [
          {
            id: 'a1',
            sprayEventRef: 'spray:e1',
            productPluginId: 'weedkill',
            grazeDays: null,
            hayDays: null,
            meatRemovalDays: 1
          }
        ],
        subject: { speciesId: 'sheep', lactating: false },
        food: 'meat',
        stays,
        atMs: T + 11 * DAY_MS
      })
    );
    expect(holds).toHaveLength(1);
    expect(holds[0].clearsAtMs).toBe(roundedClearMs(T + 9 * DAY_MS, 3, TZ));
  });

  it('marks a label that forbids pasture use as prohibited', () => {
    const holds = exposureHolds(
      input({ apps: [app({ restrictions: { source: 'x', notForPasture: true } })] })
    );
    expect(holds[0].reason).toBe('GRAZING_PROHIBITED');
  });

  it('holds animals that arrived inside the interval of an earlier spray', () => {
    const stays = [{ fieldId: 'f1', fromMs: T + 3 * DAY_MS, toMs: null }];
    const holds = exposureHolds(
      input({ stays, apps: [app({ restrictions: full })], atMs: T + 4 * DAY_MS })
    );
    expect(holds[0].exposedAtMs).toBe(T + 3 * DAY_MS);
  });

  it('ignores animals that arrived after the interval ended', () => {
    const stays = [{ fieldId: 'f1', fromMs: T + 20 * DAY_MS, toMs: null }];
    expect(
      exposureHolds(input({ stays, apps: [app({ restrictions: full })], atMs: T + 21 * DAY_MS }))
    ).toEqual([]);
  });

  it('ignores animals that left before the spray', () => {
    const stays = [{ fieldId: 'f1', fromMs: T - 5 * DAY_MS, toMs: T }];
    expect(exposureHolds(input({ stays }))).toEqual([]);
  });

  it('ignores food collected before the exposure', () => {
    expect(exposureHolds(input({ atMs: T - 1 }))).toEqual([]);
  });

  it('ignores sprays on another Area', () => {
    expect(exposureHolds(input({ applicationsByField: new Map([['f2', [app()]]]) }))).toEqual([]);
  });

  it('keeps holding after the animals leave, until the hold ends', () => {
    const stays = [{ fieldId: 'f1', fromMs: T - DAY_MS, toMs: T + DAY_MS }];
    const holds = exposureHolds(
      input({ stays, apps: [app({ restrictions: full })], atMs: T + 10 * DAY_MS })
    );
    expect(holds).toHaveLength(1);
  });
});

describe('evaluateExposureFoodUse', () => {
  const base = { ...input({ apps: [app({ restrictions: full })] }), formatDate: fmt };

  it('blocks food and sale with a date and offers discard', () => {
    for (const use of ['food', 'sale'] as const) {
      const v = evaluateExposureFoodUse({ ...base, use });
      expect(v.status).toBe('block');
      if (v.status === 'safe') throw new Error('expected a block');
      expect(v.reason).toBe('GRAZING_INTERVAL');
      expect(v.clearsAtMs).toBe(roundedClearMs(T, 14, TZ));
      expect(v.resubmitAs).toBe('discard');
      expect(v.message).toContain(fmt(roundedClearMs(T, 14, TZ)));
      expect(v.message).toContain('Weedkill');
    }
  });

  it('warns for feed-to-animals and unknown', () => {
    for (const use of ['feed-to-animals', 'unknown'] as const) {
      const v = evaluateExposureFoodUse({ ...base, use });
      expect(v.status).toBe('warn');
    }
  });

  it('always accepts discard', () => {
    expect(evaluateExposureFoodUse({ ...base, use: 'discard' }).status).toBe('safe');
  });

  it('names the date a label that forbids grazing stops counting', () => {
    const v = evaluateExposureFoodUse({
      ...input({ apps: [app({ restrictions: { source: 'x', notForPasture: true } })] }),
      use: 'food',
      formatDate: fmt
    });
    if (v.status === 'safe') throw new Error('expected a block');
    expect(v.reason).toBe('GRAZING_PROHIBITED');
    expect(v.holdEndsAtMs).toBe(startOfNextLocalDay(T + GRAZING_LOOKBACK_DAYS * DAY_MS, TZ));
    expect(v.message).toContain(`until ${fmt(v.holdEndsAtMs)}`);
  });

  it('names the owner when the grazing time is not on file', () => {
    const v = evaluateExposureFoodUse({ ...input(), formatDate: fmt, use: 'food' });
    if (v.status === 'safe') throw new Error('expected a block');
    expect(v.reason).toBe('GRAZING_UNKNOWN');
    expect(v.clearsAtMs).toBeNull();
    expect(v.message).toContain('The owner can add it from the label.');
  });
});

describe('exposure properties', () => {
  const DAYS = fc.integer({ min: 0, max: 120 });
  const restrictionsArb: fc.Arbitrary<GrazingRestrictions | null> = fc.option(
    fc.record({
      source: fc.constant('prop'),
      grazeDays: DAYS,
      hayDays: DAYS,
      lactatingDairyGrazeDays: DAYS,
      meatAnimalRemovalBeforeSlaughterDays: DAYS
    }),
    { nil: null }
  );
  const offset = fc.integer({ min: -60, max: 60 }).map((d) => T + d * DAY_MS);
  const stayArb = fc
    .tuple(offset, fc.option(fc.integer({ min: 1, max: 90 }), { nil: null }))
    .map(([fromMs, len]) => ({
      fieldId: 'f1',
      fromMs,
      toMs: len === null ? null : fromMs + len * DAY_MS
    }));
  const caseArb = fc.record({
    restrictions: restrictionsArb,
    appliedAtMs: offset,
    stays: fc.array(stayArb, { minLength: 1, maxLength: 3 }),
    atMs: fc.integer({ min: -60, max: 500 }).map((d) => T + d * DAY_MS),
    food: fc.constantFrom(...FOODS),
    lactating: fc.option(fc.boolean(), { nil: undefined })
  });

  type Case = typeof caseArb extends fc.Arbitrary<infer R> ? R : never;

  function build(c: Case) {
    return {
      stays: c.stays,
      applicationsByField: new Map([
        ['f1', [app({ appliedAtMs: c.appliedAtMs, restrictions: c.restrictions })]]
      ]),
      subject: { speciesId: 'goat', lactating: c.lactating },
      food: c.food,
      atMs: c.atMs,
      timeZone: TZ
    };
  }

  it('discard is always accepted', () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        expect(
          evaluateExposureFoodUse({ ...build(c), use: 'discard', formatDate: fmt }).status
        ).toBe('safe');
      }),
      { numRuns: 300 }
    );
  });

  it('a hold never ends before the grazing interval clears from exposure', () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        for (const h of exposureHolds(build(c))) {
          expect(h.endsAtMs).toBeGreaterThan(c.atMs);
          expect(h.exposedAtMs).toBeLessThanOrEqual(c.atMs);
          if (c.restrictions) {
            const days =
              c.lactating === false
                ? c.restrictions.grazeDays!
                : Math.max(c.restrictions.grazeDays!, c.restrictions.lactatingDairyGrazeDays!);
            expect(h.endsAtMs).toBeGreaterThanOrEqual(roundedClearMs(c.appliedAtMs, days, TZ));
          }
        }
      }),
      { numRuns: 300 }
    );
  });

  it('meat is held at least as long as milk and eggs', () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const meat = exposureHolds({ ...build(c), food: 'meat' });
        for (const food of ['milk', 'eggs'] as const) {
          for (const h of exposureHolds({ ...build(c), food })) {
            const m = meat.find((x) => x.ref === h.ref && x.exposedAtMs === h.exposedAtMs);
            expect(m).toBeDefined();
            expect(m!.endsAtMs).toBeGreaterThanOrEqual(h.endsAtMs);
          }
        }
      }),
      { numRuns: 300 }
    );
  });

  it('a stored floor never removes a hold or brings a dated one forward', () => {
    fc.assert(
      fc.property(
        caseArb,
        fc.integer({ min: -30, max: 400 }),
        fc.integer({ min: 0, max: 400 }),
        fc.boolean(),
        (c, exposedDay, clearDays, floorLactating) => {
          const floor: ExposureFloorEntry[] = [
            {
              ref: 'spray:e1',
              productPluginId: 'weedkill',
              food: c.food,
              lactating: floorLactating,
              exposedAtMs: T + exposedDay * DAY_MS,
              clearsAtMs: T + (exposedDay + clearDays) * DAY_MS
            }
          ];
          for (const st of c.stays) {
            const plain = exposureHolds({ ...build(c), stays: [st] });
            const floored = exposureHolds({ ...build(c), stays: [{ ...st, floor }] });
            expect(floored.length).toBeGreaterThanOrEqual(plain.length);
            if (plain.length === 0) continue;
            const [h] = plain;
            const [g] = floored;
            if (h.clearsAtMs === null) expect(g.clearsAtMs).toBeNull();
            else expect(g.clearsAtMs).toBeGreaterThanOrEqual(h.clearsAtMs);
            expect(g.endsAtMs).toBeGreaterThanOrEqual(h.endsAtMs);
          }
        }
      ),
      { numRuns: 300 }
    );
  });

  it('staying longer never removes a hold', () => {
    fc.assert(
      fc.property(caseArb, fc.integer({ min: 1, max: 60 }), (c, extra) => {
        const before = exposureHolds(build(c));
        const longer = {
          ...c,
          stays: c.stays.map((s) => ({
            ...s,
            toMs: s.toMs === null ? null : s.toMs + extra * DAY_MS
          }))
        };
        const after = exposureHolds(build(longer));
        for (const h of before) {
          expect(after.some((a) => a.ref === h.ref && a.endsAtMs >= h.endsAtMs)).toBe(true);
        }
      }),
      { numRuns: 300 }
    );
  });

  it('food and sale block exactly when a hold runs; other uses never block', () => {
    fc.assert(
      fc.property(caseArb, fc.constantFrom(...PRODUCTION_USES), (c, use: ProductionUse) => {
        const held = exposureHolds(build(c)).length > 0;
        const v = evaluateExposureFoodUse({ ...build(c), use, formatDate: fmt });
        if (use === 'food' || use === 'sale') expect(v.status).toBe(held ? 'block' : 'safe');
        else if (use === 'discard' || !held) expect(v.status).toBe('safe');
        else expect(v.status).toBe('warn');
      }),
      { numRuns: 300 }
    );
  });
});

describe('pre-slaughter removal (meat)', () => {
  const noGrazeLimit: GrazingRestrictions = {
    source: 'test label',
    grazeDays: 0,
    hayDays: 30,
    lactatingDairyGrazeDays: 7,
    meatAnimalRemovalBeforeSlaughterDays: 3
  };
  const steer = { speciesId: 'cattle', lactating: false };

  it('holds meat of a steer still on the pasture even with no grazing interval', () => {
    const v = evaluateExposureFoodUse({
      ...input({ apps: [app({ restrictions: noGrazeLimit })], food: 'meat', subject: steer }),
      atMs: T + DAY_MS,
      use: 'food',
      formatDate: fmt
    });
    expect(v.status).toBe('block');
    expect(v.status === 'block' && v.clearsAtMs).toBe(roundedClearMs(T + DAY_MS, 3, TZ));
  });

  it('counts the removal days from when the animals left, then clears', () => {
    const left = T + 10 * DAY_MS;
    const base = input({
      apps: [app({ restrictions: noGrazeLimit })],
      food: 'meat',
      subject: steer,
      stays: [{ fieldId: 'f1', fromMs: T - DAY_MS, toMs: left }]
    });
    const clears = roundedClearMs(left, 3, TZ);
    expect(exposureHolds({ ...base, atMs: left + DAY_MS })[0].clearsAtMs).toBe(clears);
    expect(exposureHolds({ ...base, atMs: clears })).toHaveLength(0);
  });

  it('keeps meat unknown when the label block has no removal value', () => {
    const r: GrazingRestrictions = { ...noGrazeLimit };
    delete r.meatAnimalRemovalBeforeSlaughterDays;
    const holds = exposureHolds(
      input({
        apps: [app({ restrictions: r })],
        food: 'meat',
        subject: steer,
        atMs: T + 40 * DAY_MS
      })
    );
    expect(holds).toHaveLength(1);
    expect(holds[0]).toMatchObject({ reason: 'GRAZING_UNKNOWN', clearsAtMs: null });
  });

  it('never touches milk or eggs', () => {
    expect(
      exposureHolds(
        input({
          apps: [app({ restrictions: noGrazeLimit })],
          food: 'eggs',
          subject: steer,
          atMs: T + DAY_MS
        })
      )
    ).toHaveLength(0);
  });

  it('property: meat never clears before the last exposure plus the removal days', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 60 }),
        fc.integer({ min: 1, max: 30 }),
        fc.integer({ min: -30, max: 30 }),
        fc.option(fc.integer({ min: 1, max: 60 }), { nil: null }),
        fc.integer({ min: 0, max: 400 }),
        (grazeDays, removal, fromDay, len, atDay) => {
          const fromMs = T + fromDay * DAY_MS;
          const toMs = len === null ? null : fromMs + len * DAY_MS;
          const atMs = T + atDay * DAY_MS;
          const holds = exposureHolds({
            stays: [{ fieldId: 'f1', fromMs, toMs }],
            applicationsByField: new Map([
              [
                'f1',
                [
                  app({
                    restrictions: {
                      source: 'p',
                      grazeDays,
                      hayDays: 0,
                      lactatingDairyGrazeDays: grazeDays,
                      meatAnimalRemovalBeforeSlaughterDays: removal
                    }
                  })
                ]
              ]
            ]),
            subject: steer,
            food: 'meat',
            atMs,
            timeZone: TZ
          });
          const exposedAt = Math.max(fromMs, T);
          if ((toMs !== null && exposedAt >= toMs) || exposedAt > atMs) return;
          const windowEnd = startOfNextLocalDay(T + GRAZING_LOOKBACK_DAYS * DAY_MS, TZ);
          const lastThere = Math.min(toMs ?? Number.POSITIVE_INFINITY, atMs, windowEnd);
          if (atMs < lastThere + removal * DAY_MS) expect(holds.length).toBeGreaterThan(0);
          for (const h of holds)
            expect(h.endsAtMs).toBeGreaterThanOrEqual(lastThere + removal * DAY_MS);
        }
      ),
      { numRuns: 300 }
    );
  });
});

describe('exposure floors (grazing C-18)', () => {
  const labelled = app({ restrictions: full });
  const stay = { fieldId: 'f1', fromMs: T + DAY_MS, toMs: null };

  it('stores the dated holds of an arrival for both readings of the subject', () => {
    const entries = exposureFloorFor({
      fieldId: 'f1',
      arrivedAtMs: T + DAY_MS,
      applications: [labelled],
      speciesId: 'sheep',
      timeZone: TZ
    });
    const milk = entries.find((e) => e.food === 'milk' && e.lactating);
    const dryMilk = entries.find((e) => e.food === 'milk' && !e.lactating);
    expect(milk?.clearsAtMs).toBe(roundedClearMs(T, 14, TZ));
    expect(dryMilk?.clearsAtMs).toBe(roundedClearMs(T, 7, TZ));
    expect(
      exposureFloorFor({
        fieldId: 'f1',
        arrivedAtMs: T + DAY_MS,
        applications: [app()],
        speciesId: 'sheep',
        timeZone: TZ
      })
    ).toEqual([]);
    const round = parseExposureFloor(serializeExposureFloor({ rulesVersion: 'x', entries }));
    expect(round).toEqual(entries);
    expect(parseExposureFloor('not json')).toEqual([]);
  });

  it('keeps the stored hold when the label data later drops the interval', () => {
    const floor = exposureFloorFor({
      fieldId: 'f1',
      arrivedAtMs: T + DAY_MS,
      applications: [labelled],
      speciesId: 'sheep',
      timeZone: TZ
    });
    const relabelled = app({ restrictions: { ...full, grazeDays: 0, lactatingDairyGrazeDays: 0 } });
    const atMs = T + 5 * DAY_MS;
    const run = (st: ExposureStay) =>
      exposureHolds(input({ apps: [relabelled], stays: [st], atMs, food: 'eggs' }));
    expect(run(stay)).toEqual([]);
    const held = run({ ...stay, floor });
    expect(held).toHaveLength(1);
    expect(held[0].clearsAtMs).toBe(roundedClearMs(T, 14, TZ));
    expect(
      exposureHolds(input({ apps: [], stays: [{ ...stay, floor }], atMs, food: 'eggs' }))
    ).toEqual([]);
    const later = { ...stay, fromMs: T + 3 * DAY_MS, floor };
    expect(run(later)).toEqual([]);
  });
});

describe('stayWasExposed (undoing a move)', () => {
  const base = {
    applicationsByField: new Map([['f1', [app({ restrictions: full })]]]),
    subject: { speciesId: 'sheep', lactating: true },
    timeZone: TZ
  };

  it('a stay on the Area inside the interval was exposed', () => {
    expect(
      stayWasExposed({
        ...base,
        stay: { fieldId: 'f1', fromMs: T - 2 * DAY_MS, toMs: null },
        nowMs: T + DAY_MS
      })
    ).toBe(true);
  });

  it('a stay that ended before the spray was not', () => {
    expect(
      stayWasExposed({
        ...base,
        stay: { fieldId: 'f1', fromMs: T - 5 * DAY_MS, toMs: T - DAY_MS },
        nowMs: T + DAY_MS
      })
    ).toBe(false);
  });

  it('a stay on an Area with nothing recorded was not', () => {
    expect(
      stayWasExposed({
        ...base,
        stay: { fieldId: 'f2', fromMs: T - 2 * DAY_MS, toMs: null },
        nowMs: T + DAY_MS
      })
    ).toBe(false);
  });

  it('an unsourced product always exposes', () => {
    expect(
      stayWasExposed({
        ...base,
        applicationsByField: new Map([['f1', [app()]]]),
        stay: { fieldId: 'f1', fromMs: T + 100 * DAY_MS, toMs: null },
        nowMs: T + 101 * DAY_MS
      })
    ).toBe(true);
  });
});

describe('round 4: exposure holds against an independent oracle', () => {
  const ZONES = ['America/New_York', 'UTC', 'Australia/Lord_Howe', 'America/St_Johns'];
  it('holds every food at every instant inside the grazing interval of a stay that overlapped the spray', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 60 }),
        fc.integer({ min: 0, max: 60 }),
        fc.option(fc.boolean(), { nil: undefined }),
        fc.integer({ min: -10 * 24, max: 70 * 24 }),
        fc.integer({ min: 0, max: 80 * 24 }),
        fc.constantFrom(...ZONES),
        fc.constantFrom(...FOODS),
        (general, dairy, lactating, stayOffsetH, hoursAfter, zone, food) => {
          const restrictions: GrazingRestrictions = {
            source: 'prop',
            grazeDays: general,
            hayDays: general,
            lactatingDairyGrazeDays: dairy,
            meatAnimalRemovalBeforeSlaughterDays: 0
          };
          const days = lactating === false ? general : Math.max(general, dairy);
          const fromMs = T + stayOffsetH * 3_600_000;
          const exposedAtMs = Math.max(fromMs, T);
          const atMs = exposedAtMs + hoursAfter * 3_600_000;
          const lastHeldDay = ymdInZone(T + days * DAY_MS, zone);
          const expected =
            days > 0 &&
            ymdInZone(exposedAtMs, zone) <= lastHeldDay &&
            ymdInZone(atMs, zone) <= lastHeldDay;
          const base = {
            stays: [{ fieldId: 'f1', fromMs, toMs: null }],
            applicationsByField: new Map([['f1', [app({ restrictions })]]]),
            subject: { speciesId: 'goat', lactating },
            food,
            atMs,
            timeZone: zone
          };
          expect(exposureHolds(base).length > 0).toBe(expected);
          for (const use of ['food', 'sale'] as const) {
            expect(evaluateExposureFoodUse({ ...base, use, formatDate: fmt }).status).toBe(
              expected ? 'block' : 'safe'
            );
          }
        }
      ),
      { numRuns: 300 }
    );
  });

  it('a stored milk floor holds at its lactating reading after the animal is read as dry', () => {
    const floor = exposureFloorFor({
      fieldId: 'f1',
      arrivedAtMs: T + DAY_MS,
      applications: [app({ restrictions: full })],
      speciesId: 'sheep',
      timeZone: TZ
    });
    const atMs = T + 10 * DAY_MS;
    const dry = { speciesId: 'sheep', lactating: false };
    const stay = { fieldId: 'f1', fromMs: T + DAY_MS, toMs: null };
    const run = (food: Food, st: ExposureStay) =>
      exposureHolds(
        input({ apps: [app({ restrictions: full })], stays: [st], atMs, food, subject: dry })
      );
    expect(run('milk', stay)).toEqual([]);
    const milk = run('milk', { ...stay, floor });
    expect(milk).toHaveLength(1);
    expect(milk[0].clearsAtMs).toBe(roundedClearMs(T, 14, TZ));
    expect(run('eggs', { ...stay, floor })).toEqual([]);
  });
});

describe('attested intervals longer than the 365-day lookback (review round 1)', () => {
  const long = {
    id: 'att-long',
    sprayEventRef: 'spray:e1',
    productPluginId: 'weedkill',
    grazeDays: 500,
    hayDays: 500,
    lactatingGrazeDays: 500,
    meatRemovalDays: 500
  };

  it('holds eggs of a flock that went onto the Area on day 399', () => {
    for (const food of ['eggs', 'milk', 'meat'] as Food[]) {
      const holds = exposureHolds(
        input({
          stays: [{ fieldId: 'f1', fromMs: T + 399 * DAY_MS, toMs: null }],
          attestations: [long],
          food,
          atMs: T + 420 * DAY_MS
        })
      );
      expect(holds.length, food).toBeGreaterThan(0);
      expect(holds[0].reason).toBe('GRAZING_INTERVAL');
    }
  });

  it('builds the ledger span past day 365', () => {
    const spans = exposureSpans({
      ...input({
        stays: [{ fieldId: 'f1', fromMs: T + 399 * DAY_MS, toMs: null }],
        attestations: [long],
        food: 'eggs'
      }),
      atMs: undefined
    } as unknown as Omit<GrazingExposureInput, 'atMs'>);
    expect(spans.length).toBeGreaterThan(0);
  });
});

describe('the ledger fast exposure path against the gate (0.7.3)', () => {
  const yearLong: GrazingRestrictions = {
    source: 'test label',
    grazeDays: GRAZING_LOOKBACK_DAYS,
    hayDays: GRAZING_LOOKBACK_DAYS,
    lactatingDairyGrazeDays: GRAZING_LOOKBACK_DAYS,
    meatAnimalRemovalBeforeSlaughterDays: 0
  };

  it('holds milk and eggs of animals arriving after the exact lookback, before the interval clears', () => {
    const arrive = T + GRAZING_LOOKBACK_DAYS * DAY_MS + 3_600_000;
    const clears = roundedClearMs(T, GRAZING_LOOKBACK_DAYS, TZ);
    expect(arrive).toBeLessThan(clears);
    for (const food of ['milk', 'eggs'] as Food[]) {
      const base = input({
        apps: [app({ restrictions: yearLong })],
        stays: [{ fieldId: 'f1', fromMs: arrive, toMs: arrive + DAY_MS }],
        food
      });
      expect(exposureHolds({ ...base, atMs: arrive }).length, food).toBeGreaterThan(0);
      const spans = exposureSpansFast(base);
      expect(
        spans.some((s) => s.fromMs <= arrive && arrive < s.toMs),
        food
      ).toBe(true);
    }
  });

  it('exposureSpansFast holds exactly when exposureHolds does, with intervals near the lookback', () => {
    const daysArb = fc.option(
      fc.oneof(
        { arbitrary: fc.integer({ min: 0, max: 40 }), weight: 1 },
        {
          arbitrary: fc.integer({ min: GRAZING_LOOKBACK_DAYS, max: GRAZING_LOOKBACK_DAYS + 2 }),
          weight: 3
        }
      ),
      { nil: undefined }
    );
    const restrictionsArb: fc.Arbitrary<GrazingRestrictions | null> = fc.oneof(
      fc.constant(null),
      fc.record({
        source: fc.constant('label'),
        grazeDays: daysArb,
        lactatingDairyGrazeDays: daysArb,
        meatAnimalRemovalBeforeSlaughterDays: fc.option(fc.integer({ min: 0, max: 30 }), {
          nil: undefined
        }),
        notForPasture: fc.option(fc.boolean(), { nil: undefined })
      })
    );
    fc.assert(
      fc.property(
        fc.array(
          fc.record({ at: fc.integer({ min: T, max: T + 2 * DAY_MS }), r: restrictionsArb }),
          { minLength: 1, maxLength: 3 }
        ),
        fc.array(
          fc.record({
            from: fc.oneof(
              fc.integer({ min: T, max: T + 400 * DAY_MS }),
              fc.integer({
                min: T + (GRAZING_LOOKBACK_DAYS - 1) * DAY_MS,
                max: T + (GRAZING_LOOKBACK_DAYS + 3) * DAY_MS
              })
            ),
            length: fc.integer({ min: 1, max: 10 * DAY_MS })
          }),
          { minLength: 1, maxLength: 3 }
        ),
        fc.constantFrom<Food>('meat', 'milk', 'eggs'),
        fc.boolean(),
        (apps, stays, food, lactating) => {
          const applications = apps.map((a, i) =>
            app({ ref: `spray:e${i}`, appliedAtMs: a.at, restrictions: a.r })
          );
          const base = {
            stays: stays.map((s) => ({ fieldId: 'f1', fromMs: s.from, toMs: s.from + s.length })),
            applicationsByField: new Map([['f1', applications]]),
            subject: { speciesId: 'sheep', lactating },
            food,
            timeZone: TZ,
            registryMaxIntervalDays: GRAZING_LOOKBACK_DAYS
          };
          const spans = exposureSpansFast(base);
          const points: number[] = [];
          for (const s of base.stays) points.push(s.fromMs, s.fromMs + 1, s.toMs - 1);
          for (const s of spans) {
            points.push(s.fromMs, s.fromMs - 1);
            if (Number.isFinite(s.toMs)) points.push(s.toMs, s.toMs - 1);
          }
          for (const a of applications) {
            const edge = a.appliedAtMs + GRAZING_LOOKBACK_DAYS * DAY_MS;
            points.push(edge, edge + 1, startOfNextLocalDay(edge, TZ) - 1);
          }
          for (const t of points) {
            const gate = exposureHolds({ ...base, atMs: t }).length > 0;
            const ledger = spans.some((s) => s.fromMs <= t && t < s.toMs);
            expect(ledger, `t=${t}`).toBe(gate);
          }
        }
      ),
      { numRuns: 500 }
    );
  }, 60_000);
});
