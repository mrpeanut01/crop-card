import { describe, expect, it } from 'vitest';
import type { GrazingRestrictions } from '$lib/plugins/schemas';
import { ymdInZone } from '$lib/prefs';
import {
  DAY_MS,
  GRAZING_LOOKBACK_DAYS,
  STRICTEST_SUBJECT,
  canReassignBlock,
  evaluateGrazing,
  evaluateHayCut,
  farmCopyRestrictions,
  grazingExposureHolds,
  hasManureCarryover,
  labelGrazeDays,
  labelHayDays,
  presumeLactating,
  registryMaxIntervalDays,
  roundedClearMs,
  startOfNextLocalDay,
  type GrazingApplication,
  type GrazingAttestationInput,
  type GrazingSubject
} from './grazingInterval';

// Test values only; none of these numbers come from a label.
const TZ = 'America/New_York';
const SPRAYED = Date.UTC(2026, 5, 1, 14, 0);

function r(extra: Partial<GrazingRestrictions> = {}): GrazingRestrictions {
  return { source: 'test', ...extra };
}

function app(extra: Partial<GrazingApplication> = {}): GrazingApplication {
  return {
    ref: 'spray:e1',
    source: 'spray',
    blockId: 'b1',
    appliedAtMs: SPRAYED,
    productPluginId: 'herb-a',
    productName: 'Herb A',
    restrictions: r({ grazeDays: 7, hayDays: 14, lactatingDairyGrazeDays: 7 }),
    ...extra
  };
}

const EWE: GrazingSubject = { speciesId: 'sheep', foodProducing: true, lactating: false };
const MILKING_GOAT: GrazingSubject = { speciesId: 'goat', foodProducing: true, lactating: true };
const DOG: GrazingSubject = { speciesId: 'dog', foodProducing: false, lactating: false };

function att(extra: Partial<GrazingAttestationInput> = {}): GrazingAttestationInput {
  return {
    id: 'att1',
    sprayEventRef: 'spray:e1',
    productPluginId: 'herb-a',
    grazeDays: null,
    hayDays: null,
    ...extra
  };
}

const at = (days: number) => SPRAYED + days * DAY_MS;

describe('startOfNextLocalDay (C-04)', () => {
  const cases: Array<[string, number, string, string]> = [
    ['New York afternoon', Date.UTC(2026, 5, 1, 18), TZ, '2026-06-02'],
    ['New York just before midnight', Date.UTC(2026, 5, 2, 3, 59), TZ, '2026-06-02'],
    ['New York spring forward day', Date.UTC(2026, 2, 8, 12), TZ, '2026-03-09'],
    ['New York fall back day', Date.UTC(2026, 10, 1, 12), TZ, '2026-11-02'],
    ['UTC', Date.UTC(2026, 5, 1, 0, 0), 'UTC', '2026-06-02'],
    ['Honolulu', Date.UTC(2026, 5, 1, 12), 'Pacific/Honolulu', '2026-06-02'],
    ['Kiritimati +14', Date.UTC(2026, 5, 1, 12), 'Pacific/Kiritimati', '2026-06-03'],
    ['Santiago midnight gap', Date.UTC(2026, 8, 5, 20), 'America/Santiago', '2026-09-06']
  ];
  it.each(cases)('%s', (_label, ms, zone, nextDay) => {
    const next = startOfNextLocalDay(ms, zone);
    expect(next).toBeGreaterThan(ms);
    expect(ymdInZone(next, zone)).toBe(nextDay);
    expect(ymdInZone(next - 1, zone)).not.toBe(nextDay);
  });

  it('falls back to UTC for an unknown zone', () => {
    const ms = Date.UTC(2026, 5, 1, 18);
    expect(startOfNextLocalDay(ms, 'Not/AZone')).toBe(Date.UTC(2026, 5, 2));
  });

  it('zero days is no hold', () => {
    expect(roundedClearMs(SPRAYED, 0, TZ)).toBe(SPRAYED);
  });

  it('seven days from a Monday afternoon clears at the start of the next Tuesday', () => {
    const clear = roundedClearMs(SPRAYED, 7, TZ);
    expect(ymdInZone(clear, TZ)).toBe('2026-06-09');
    expect(clear).toBeGreaterThanOrEqual(SPRAYED + 7 * DAY_MS);
  });
});

describe('labelGrazeDays: interval selection (C-24, C-25)', () => {
  const R = r({
    grazeDays: 7,
    lactatingDairyGrazeDays: 14,
    speciesExceptions: [
      { speciesId: 'horse', grazeDays: 3 },
      { speciesId: 'goat', grazeDays: 10 },
      { speciesId: 'goat', lactating: true, grazeDays: 20 },
      { speciesId: 'cattle', lactating: true, grazeDays: 5 },
      { speciesId: 'pig', hayDays: 40 }
    ]
  });
  const cases: Array<[string, string | null, boolean | undefined, number | 'unknown']> = [
    ['general', 'sheep', false, 7],
    ['lactating uses the dairy value', 'sheep', true, 14],
    ['lactating left unknown is read as lactating', 'sheep', undefined, 14],
    ['a species exception replaces the general value', 'horse', false, 3],
    ['a longer species exception', 'goat', false, 10],
    ['lactating species exception', 'goat', true, 20],
    ['lactating never below the species general value', 'cattle', true, 7],
    ['an exception with only hay days leaves grazing general', 'pig', false, 7],
    ['any species takes the longest general value', null, false, 10],
    ['any species lactating takes the longest of everything', null, true, 20]
  ];
  it.each(cases)('%s', (_l, speciesId, lactating, expected) => {
    expect(labelGrazeDays(R, { speciesId, lactating })).toBe(expected);
  });

  const unknown: Array<[string, GrazingRestrictions, string | null, boolean]> = [
    ['no general value', r({ hayDays: 3 }), 'sheep', false],
    ['no general value, any species', r({ lactatingDairyGrazeDays: 3 }), null, false],
    ['no lactating value for a lactating subject', r({ grazeDays: 7 }), 'sheep', true],
    ['no lactating value, any species', r({ grazeDays: 7 }), null, true]
  ];
  it.each(unknown)('unknown when %s', (_l, restrictions, speciesId, lactating) => {
    expect(labelGrazeDays(restrictions, { speciesId, lactating })).toBe('unknown');
  });

  it('a species with its own lactating value does not need the dairy value', () => {
    const g = r({
      grazeDays: 7,
      speciesExceptions: [{ speciesId: 'goat', lactating: true, grazeDays: 9 }]
    });
    expect(labelGrazeDays(g, { speciesId: 'goat', lactating: true })).toBe(9);
    expect(labelGrazeDays(g, { speciesId: 'sheep', lactating: true })).toBe('unknown');
  });

  it('zero means the label states none', () => {
    expect(
      labelGrazeDays(r({ grazeDays: 0, lactatingDairyGrazeDays: 0 }), {
        speciesId: 'sheep',
        lactating: true
      })
    ).toBe(0);
  });
});

describe('labelHayDays', () => {
  it.each<[string, GrazingRestrictions, number | 'unknown']>([
    ['general', r({ hayDays: 14 }), 14],
    ['missing', r({ grazeDays: 7 }), 'unknown'],
    [
      'a longer species value wins',
      r({ hayDays: 14, speciesExceptions: [{ speciesId: 'goat', hayDays: 30 }] }),
      30
    ],
    [
      'a shorter species value does not',
      r({ hayDays: 14, speciesExceptions: [{ speciesId: 'goat', hayDays: 2 }] }),
      14
    ],
    ['zero', r({ hayDays: 0 }), 0]
  ])('%s', (_l, restrictions, expected) => {
    expect(labelHayDays(restrictions)).toBe(expected);
  });
});

describe('evaluateGrazing', () => {
  it('blocks a food animal inside the label interval with the clear date', () => {
    const v = evaluateGrazing({ applications: [app()], subject: EWE, atMs: at(3), timeZone: TZ });
    expect(v.status).toBe('block');
    expect(v.reason).toBe('GRAZING_INTERVAL');
    expect(ymdInZone(v.clearsAtMs!, TZ)).toBe('2026-06-09');
    expect(v.ownerCanAttest).toBe(false);
    expect(v.findings[0]).toMatchObject({ days: 7, basis: 'label', active: true });
  });

  it('clears from the start of the rounded day and not a moment before', () => {
    const clear = roundedClearMs(SPRAYED, 7, TZ);
    const before = evaluateGrazing({
      applications: [app()],
      subject: EWE,
      atMs: clear - 1,
      timeZone: TZ
    });
    const on = evaluateGrazing({ applications: [app()], subject: EWE, atMs: clear, timeZone: TZ });
    expect(before.status).toBe('block');
    expect(on.status).toBe('clear');
    expect(on.clearsAtMs).toBeNull();
  });

  it('a pet gets a warning, never a block', () => {
    const v = evaluateGrazing({ applications: [app()], subject: DOG, atMs: at(1), timeZone: TZ });
    expect(v.status).toBe('warn');
    expect(v.reason).toBe('GRAZING_INTERVAL');
  });

  it('no applications is clear, whatever the Area', () => {
    const v = evaluateGrazing({ applications: [], subject: EWE, atMs: at(1), timeZone: TZ });
    expect(v).toMatchObject({ status: 'clear', reason: null, findings: [] });
  });

  it('a lactating subject waits the longer lactating interval', () => {
    const a = app({ restrictions: r({ grazeDays: 3, lactatingDairyGrazeDays: 10, hayDays: 1 }) });
    const dry = evaluateGrazing({
      applications: [a],
      subject: { ...MILKING_GOAT, lactating: false },
      atMs: at(5),
      timeZone: TZ
    });
    const milking = evaluateGrazing({
      applications: [a],
      subject: MILKING_GOAT,
      atMs: at(5),
      timeZone: TZ
    });
    expect(dry.status).toBe('clear');
    expect(milking.status).toBe('block');
    expect(milking.findings[0].basis).toBe('lactating');
  });

  describe('unknown data (Q5)', () => {
    const unknownApp = app({ restrictions: null });

    it('blocks a food animal with GRAZING_UNKNOWN and no date', () => {
      const v = evaluateGrazing({
        applications: [unknownApp],
        subject: EWE,
        atMs: at(200),
        timeZone: TZ
      });
      expect(v).toMatchObject({
        status: 'block',
        reason: 'GRAZING_UNKNOWN',
        clearsAtMs: null,
        ownerCanAttest: true
      });
    });

    it('warns a pet', () => {
      const v = evaluateGrazing({
        applications: [unknownApp],
        subject: DOG,
        atMs: at(1),
        timeZone: TZ
      });
      expect(v.status).toBe('warn');
    });

    it('a missing field inside grazingRestrictions is unknown too', () => {
      const v = evaluateGrazing({
        applications: [app({ restrictions: r({ hayDays: 5 }) })],
        subject: EWE,
        atMs: at(100),
        timeZone: TZ
      });
      expect(v.reason).toBe('GRAZING_UNKNOWN');
    });

    it('stops once the application leaves the lookback window (inclusive edge)', () => {
      const edge = SPRAYED + GRAZING_LOOKBACK_DAYS * DAY_MS;
      expect(
        evaluateGrazing({ applications: [unknownApp], subject: EWE, atMs: edge, timeZone: TZ })
          .status
      ).toBe('block');
      expect(
        evaluateGrazing({ applications: [unknownApp], subject: EWE, atMs: edge + 1, timeZone: TZ })
          .status
      ).toBe('clear');
    });

    it('the registry maximum widens the window and is snapshotted (C-23)', () => {
      const v = evaluateGrazing({
        applications: [unknownApp],
        subject: EWE,
        atMs: at(500),
        timeZone: TZ,
        registryMaxIntervalDays: 540
      });
      expect(v).toMatchObject({ status: 'block', lookbackDays: 540, registryMaxIntervalDays: 540 });
    });

    it('a long interval in the input widens the window too', () => {
      const long = app({
        ref: 'spray:e2',
        restrictions: r({ grazeDays: 400, lactatingDairyGrazeDays: 400, hayDays: 400 })
      });
      const v = evaluateGrazing({
        applications: [long],
        subject: EWE,
        atMs: at(390),
        timeZone: TZ
      });
      expect(v.lookbackDays).toBe(400);
      expect(v.status).toBe('block');
    });

    it('an interval as long as the lookback holds to the midnight after its last day', () => {
      const long = app({
        ref: 'spray:e3',
        restrictions: r({ grazeDays: 400, lactatingDairyGrazeDays: 400, hayDays: 400 })
      });
      const clears = roundedClearMs(SPRAYED, 400, TZ);
      const inside = SPRAYED + 400 * DAY_MS + 1;
      expect(clears).toBeGreaterThan(inside);
      const held = evaluateGrazing({
        applications: [long],
        subject: EWE,
        atMs: inside,
        timeZone: TZ
      });
      expect(held.status).toBe('block');
      expect(held.clearsAtMs).toBe(clears);
      expect(evaluateHayCut({ applications: [long], atMs: inside, timeZone: TZ }).status).toBe(
        'block'
      );
      expect(
        evaluateGrazing({ applications: [long], subject: EWE, atMs: clears, timeZone: TZ }).status
      ).toBe('clear');
    });
  });

  describe('attestations (C-27)', () => {
    const unknownApp = app({ restrictions: null });

    it('clears exactly the attested interval', () => {
      const a = att({ grazeDays: 10 });
      const clear = roundedClearMs(SPRAYED, 10, TZ);
      const before = evaluateGrazing({
        applications: [unknownApp],
        attestations: [a],
        subject: EWE,
        atMs: clear - 1,
        timeZone: TZ
      });
      const after = evaluateGrazing({
        applications: [unknownApp],
        attestations: [a],
        subject: EWE,
        atMs: clear,
        timeZone: TZ
      });
      expect(before).toMatchObject({
        status: 'block',
        reason: 'GRAZING_INTERVAL',
        clearsAtMs: clear
      });
      expect(before.findings[0]).toMatchObject({ basis: 'attestation', attestationIds: ['att1'] });
      expect(after.status).toBe('clear');
    });

    it('matches one application and product only', () => {
      const other = [
        att({ sprayEventRef: 'spray:e9', grazeDays: 1 }),
        att({ productPluginId: 'herb-b', grazeDays: 1 }),
        att({ sprayEventRef: null, grazeDays: 1 }),
        att({ hayDays: 1 })
      ];
      const v = evaluateGrazing({
        applications: [unknownApp],
        attestations: other,
        subject: EWE,
        atMs: at(30),
        timeZone: TZ
      });
      expect(v.reason).toBe('GRAZING_UNKNOWN');
    });

    it('never shortens a known label interval', () => {
      const v = evaluateGrazing({
        applications: [app()],
        attestations: [att({ grazeDays: 1 })],
        subject: EWE,
        atMs: at(3),
        timeZone: TZ
      });
      expect(v.status).toBe('block');
      expect(v.findings[0]).toMatchObject({ days: 7, basis: 'label', attestationIds: [] });
    });

    it('can lengthen a known label interval', () => {
      const v = evaluateGrazing({
        applications: [app()],
        attestations: [att({ grazeDays: 30 })],
        subject: EWE,
        atMs: at(20),
        timeZone: TZ
      });
      expect(v.findings[0]).toMatchObject({ days: 30, basis: 'attestation' });
    });

    it('fills a missing lactating value but keeps a longer known general value', () => {
      const a = app({ restrictions: r({ grazeDays: 12 }) });
      const v = evaluateGrazing({
        applications: [a],
        attestations: [att({ grazeDays: 5, lactatingGrazeDays: 5 })],
        subject: MILKING_GOAT,
        atMs: at(8),
        timeZone: TZ
      });
      expect(v.status).toBe('block');
      expect(v.findings[0].days).toBe(12);
    });

    it('a general time alone leaves the lactating path unknown (C-25)', () => {
      const general = evaluateGrazing({
        applications: [unknownApp],
        attestations: [att({ grazeDays: 0, hayDays: 30 })],
        subject: MILKING_GOAT,
        atMs: at(2),
        timeZone: TZ
      });
      expect(general).toMatchObject({ status: 'block', reason: 'GRAZING_UNKNOWN' });
      const labelled = evaluateGrazing({
        applications: [unknownApp],
        attestations: [att({ grazeDays: 0, hayDays: 30, lactatingGrazeDays: 7 })],
        subject: MILKING_GOAT,
        atMs: at(2),
        timeZone: TZ
      });
      expect(labelled).toMatchObject({ status: 'block', reason: 'GRAZING_INTERVAL' });
      expect(labelled.findings[0].days).toBe(7);
      const dry = evaluateGrazing({
        applications: [unknownApp],
        attestations: [att({ grazeDays: 0, hayDays: 30 })],
        subject: EWE,
        atMs: at(2),
        timeZone: TZ
      });
      expect(dry.status).toBe('clear');
    });

    it('a general time counts for milking animals when the label has a lactating value', () => {
      const a = app({ restrictions: r({ lactatingDairyGrazeDays: 4 }) });
      const v = evaluateGrazing({
        applications: [a],
        attestations: [att({ grazeDays: 9 })],
        subject: MILKING_GOAT,
        atMs: at(2),
        timeZone: TZ
      });
      expect(v.findings[0].days).toBe(9);
    });

    it('the longest of several attestations wins', () => {
      const v = evaluateGrazing({
        applications: [unknownApp],
        attestations: [att({ id: 'a', grazeDays: 3 }), att({ id: 'b', grazeDays: 9 })],
        subject: EWE,
        atMs: at(5),
        timeZone: TZ
      });
      expect(v.findings[0]).toMatchObject({ days: 9, attestationIds: ['b'] });
    });

    it('never clears a label prohibition (C-24)', () => {
      const a = app({ restrictions: r({ notForPasture: true, grazeDays: 0 }) });
      const v = evaluateGrazing({
        applications: [a],
        attestations: [att({ grazeDays: 0, hayDays: 0 })],
        subject: EWE,
        atMs: at(100),
        timeZone: TZ
      });
      expect(v).toMatchObject({
        status: 'block',
        reason: 'GRAZING_PROHIBITED',
        clearsAtMs: null,
        ownerCanAttest: false
      });
    });
  });

  it('the strictest reason wins and an undated finding keeps the date unknown', () => {
    const v = evaluateGrazing({
      applications: [
        app(),
        app({ ref: 'spray:e2', restrictions: null }),
        app({ ref: 'spray:e3', restrictions: r({ notForPasture: true }) })
      ],
      subject: EWE,
      atMs: at(2),
      timeZone: TZ
    });
    expect(v.reason).toBe('GRAZING_PROHIBITED');
    expect(v.clearsAtMs).toBeNull();
    expect(ymdInZone(v.knownClearsAtMs!, TZ)).toBe('2026-06-09');
  });

  it('counts every block of the Area, spot sprays included (C-21)', () => {
    const v = evaluateGrazing({
      applications: [
        app({ blockId: 'b1' }),
        app({
          ref: 'insecticide:i1',
          source: 'insecticide',
          blockId: 'b2',
          restrictions: r({ grazeDays: 21, lactatingDairyGrazeDays: 21, hayDays: 21 })
        })
      ],
      subject: EWE,
      atMs: at(10),
      timeZone: TZ
    });
    expect(v.status).toBe('block');
    expect(ymdInZone(v.clearsAtMs!, TZ)).toBe('2026-06-23');
  });

  it('an application after the move time still holds the Area', () => {
    const v = evaluateGrazing({
      applications: [app()],
      subject: EWE,
      atMs: SPRAYED - 5 * DAY_MS,
      timeZone: TZ
    });
    expect(v.status).toBe('block');
  });

  it('a zero-day label interval never holds', () => {
    const a = app({ restrictions: r({ grazeDays: 0, lactatingDairyGrazeDays: 0, hayDays: 0 }) });
    expect(
      evaluateGrazing({ applications: [a], subject: MILKING_GOAT, atMs: SPRAYED, timeZone: TZ })
        .status
    ).toBe('clear');
  });

  it('ignores a non-finite application time', () => {
    const v = evaluateGrazing({
      applications: [app({ appliedAtMs: Number.NaN })],
      subject: EWE,
      atMs: at(1),
      timeZone: TZ
    });
    expect(v.status).toBe('clear');
  });
});

describe('evaluateHayCut (C-28)', () => {
  it('blocks inside the hay interval whatever animals the farm keeps', () => {
    const v = evaluateHayCut({ applications: [app()], atMs: at(10), timeZone: TZ });
    expect(v).toMatchObject({ kind: 'hay', status: 'block', reason: 'GRAZING_INTERVAL' });
    expect(ymdInZone(v.clearsAtMs!, TZ)).toBe('2026-06-16');
  });

  it('unknown hay data blocks until the owner attests hay days', () => {
    const a = app({ restrictions: r({ grazeDays: 7 }) });
    expect(evaluateHayCut({ applications: [a], atMs: at(100), timeZone: TZ }).reason).toBe(
      'GRAZING_UNKNOWN'
    );
    const graze = evaluateHayCut({
      applications: [a],
      attestations: [att({ grazeDays: 1 })],
      atMs: at(100),
      timeZone: TZ
    });
    expect(graze.reason).toBe('GRAZING_UNKNOWN');
    const hay = evaluateHayCut({
      applications: [a],
      attestations: [att({ hayDays: 20 })],
      atMs: at(100),
      timeZone: TZ
    });
    expect(hay.status).toBe('clear');
  });

  it('a hay attestation never undercuts a known species hay value', () => {
    const a = app({
      restrictions: r({ grazeDays: 7, speciesExceptions: [{ speciesId: 'goat', hayDays: 30 }] })
    });
    const v = evaluateHayCut({
      applications: [a],
      attestations: [att({ hayDays: 10 })],
      atMs: at(20),
      timeZone: TZ
    });
    expect(v.status).toBe('block');
    expect(v.findings[0]).toMatchObject({
      days: 30,
      basis: 'species-exception',
      attestationIds: ['att1']
    });
  });

  it('a not-for-pasture label blocks hay', () => {
    const a = app({ restrictions: r({ notForPasture: true, hayDays: 0 }) });
    expect(evaluateHayCut({ applications: [a], atMs: at(100), timeZone: TZ }).reason).toBe(
      'GRAZING_PROHIBITED'
    );
  });
});

describe('canReassignBlock (C-21)', () => {
  it('refuses while any hold is open and allows once all are clear', () => {
    expect(canReassignBlock({ applications: [app()], atMs: at(3), timeZone: TZ }).ok).toBe(false);
    expect(
      canReassignBlock({ applications: [app({ restrictions: null })], atMs: at(300), timeZone: TZ })
        .ok
    ).toBe(false);
    expect(canReassignBlock({ applications: [app()], atMs: at(30), timeZone: TZ }).ok).toBe(true);
    expect(canReassignBlock({ applications: [], atMs: at(3), timeZone: TZ }).ok).toBe(true);
  });

  it('uses the strictest subject', () => {
    expect(STRICTEST_SUBJECT).toEqual({ speciesId: null, foodProducing: true, lactating: true });
  });
});

describe('presumeLactating (C-10)', () => {
  it.each<[string, string[], string | null | undefined, boolean]>([
    ['milk species, unknown sex', ['meat', 'milk'], undefined, true],
    ['milk species, female', ['milk'], 'female', true],
    ['milk species, spayed', ['milk'], 'spayed-female', true],
    ['milk species, unknown', ['milk'], 'unknown', true],
    ['milk species, male', ['milk'], 'male', false],
    ['milk species, wether', ['milk'], 'neutered-male', false],
    ['eggs only', ['eggs', 'meat'], 'female', false]
  ])('%s', (_l, products, sex, expected) => {
    expect(presumeLactating({ speciesProducts: products, sex })).toBe(expected);
  });
});

describe('hasManureCarryover', () => {
  it.each<[string, Partial<GrazingApplication>, boolean]>([
    ['label flag', { restrictions: r({ manureCarryover: true }) }, true],
    ['aminopyralid active', { restrictions: null, activeIngredients: ['Aminopyralid'] }, true],
    [
      'picloram active',
      { restrictions: null, activeIngredients: ['picloram potassium salt'] },
      true
    ],
    ['clopyralid active', { restrictions: null, activeIngredients: ['clopyralid'] }, true],
    ['glyphosate', { restrictions: null, activeIngredients: ['glyphosate'] }, false],
    ['nothing known', { restrictions: null }, false]
  ])('%s', (_l, extra, expected) => {
    expect(hasManureCarryover([app(extra)])).toBe(expected);
  });

  it('is on the verdict', () => {
    const v = evaluateGrazing({
      applications: [
        app({
          restrictions: r({ manureCarryover: true, grazeDays: 0, lactatingDairyGrazeDays: 0 })
        })
      ],
      subject: EWE,
      atMs: at(1),
      timeZone: TZ
    });
    expect(v.manureCarryover).toBe(true);
  });
});

describe('registryMaxIntervalDays', () => {
  it('takes every day count, species values included', () => {
    expect(
      registryMaxIntervalDays([
        null,
        undefined,
        r({ grazeDays: 7 }),
        r({ meatAnimalRemovalBeforeSlaughterDays: 30 }),
        r({ hayDays: 1, speciesExceptions: [{ speciesId: 'goat', hayDays: 45 }] })
      ])
    ).toBe(45);
    expect(registryMaxIntervalDays([])).toBe(0);
  });
});

describe('grazingExposureHolds (C-30, C-31)', () => {
  it('nothing is held when the verdict is clear', () => {
    const v = evaluateGrazing({ applications: [app()], subject: EWE, atMs: at(30), timeZone: TZ });
    const h = grazingExposureHolds(v, [app()], TZ);
    expect(h.milk.held || h.eggs.held || h.meat.held).toBe(false);
  });

  it('milk and eggs wait for the grazing clear time; meat adds the removal days', () => {
    const a = app({
      restrictions: r({
        grazeDays: 7,
        lactatingDairyGrazeDays: 7,
        meatAnimalRemovalBeforeSlaughterDays: 3
      })
    });
    const v = evaluateGrazing({ applications: [a], subject: EWE, atMs: at(1), timeZone: TZ });
    const h = grazingExposureHolds(v, [a], TZ);
    expect(h.milk).toEqual({ held: true, clearsAtMs: v.clearsAtMs });
    expect(h.eggs).toEqual({ held: true, clearsAtMs: v.clearsAtMs });
    expect(h.meat.clearsAtMs).toBe(roundedClearMs(v.clearsAtMs!, 3, TZ));
  });

  it('meat is unknown without the label removal value', () => {
    const v = evaluateGrazing({ applications: [app()], subject: EWE, atMs: at(1), timeZone: TZ });
    expect(grazingExposureHolds(v, [app()], TZ).meat).toEqual({ held: true, clearsAtMs: null });
  });

  it('everything is held with no date while the data is unknown', () => {
    const a = app({ restrictions: null });
    const v = evaluateGrazing({ applications: [a], subject: EWE, atMs: at(1), timeZone: TZ });
    const h = grazingExposureHolds(v, [a], TZ);
    expect(h.milk).toEqual({ held: true, clearsAtMs: null });
    expect(h.meat).toEqual({ held: true, clearsAtMs: null });
  });
});

describe('farmCopyRestrictions (C-24, C-27)', () => {
  const shared = r({
    grazeDays: 7,
    hayDays: 30,
    lactatingDairyGrazeDays: 14,
    meatAnimalRemovalBeforeSlaughterDays: 3,
    notForPasture: true,
    speciesExceptions: [{ speciesId: 'horse', grazeDays: 2 }]
  });

  it('a farm copy that zeroes every interval changes nothing', () => {
    const merged = farmCopyRestrictions(
      shared,
      r({ grazeDays: 0, hayDays: 0, lactatingDairyGrazeDays: 0, speciesExceptions: [] })
    );
    expect(merged).toMatchObject({
      grazeDays: 7,
      hayDays: 30,
      lactatingDairyGrazeDays: 14,
      meatAnimalRemovalBeforeSlaughterDays: 3,
      notForPasture: true,
      speciesExceptions: [{ speciesId: 'horse', grazeDays: 2 }]
    });
  });

  it('a farm copy can lengthen an interval', () => {
    expect(farmCopyRestrictions(r({ grazeDays: 7 }), r({ grazeDays: 30 }))?.grazeDays).toBe(30);
  });

  it('a value the shared label lacks stays unknown, whatever the farm copy says', () => {
    const merged = farmCopyRestrictions(r({ grazeDays: 7 }), r({ grazeDays: 7, hayDays: 0 }));
    expect(merged?.hayDays).toBeUndefined();
    expect(labelHayDays(merged!)).toBe('unknown');
  });

  it('with no shared data the farm copy only counts when it forbids pasture use', () => {
    expect(farmCopyRestrictions(null, r({ grazeDays: 0, hayDays: 0 }))).toBeNull();
    expect(farmCopyRestrictions(undefined, r({ notForPasture: true }))?.notForPasture).toBe(true);
  });

  it('keeps the shared data when the farm has no copy', () => {
    expect(farmCopyRestrictions(shared, null)).toBe(shared);
  });
});

describe('attested intervals longer than the 365-day lookback (review round 1)', () => {
  const unsourced = app({ restrictions: null });
  const long = att({
    grazeDays: 500,
    hayDays: 500,
    lactatingGrazeDays: 500,
    meatRemovalDays: 500
  });

  it('keeps holding grazing and hay until the attested end, past day 365', () => {
    for (const subject of [EWE, MILKING_GOAT]) {
      const v = evaluateGrazing({
        applications: [unsourced],
        subject,
        attestations: [long],
        atMs: at(400),
        timeZone: TZ
      });
      expect(v.status).toBe('block');
      expect(v.reason).toBe('GRAZING_INTERVAL');
      expect(v.clearsAtMs).toBe(roundedClearMs(SPRAYED, 500, TZ));
      expect(v.lookbackDays).toBeGreaterThanOrEqual(500);
    }
    const hay = evaluateHayCut({
      applications: [unsourced],
      attestations: [long],
      atMs: at(400),
      timeZone: TZ
    });
    expect(hay.status).toBe('block');
    expect(hay.clearsAtMs).toBe(roundedClearMs(SPRAYED, 500, TZ));
  });

  it('clears once the attested interval has run', () => {
    const v = evaluateGrazing({
      applications: [unsourced],
      subject: EWE,
      attestations: [long],
      atMs: at(501),
      timeZone: TZ
    });
    expect(v.status).toBe('clear');
  });

  it('an attestation for another application does not widen this one', () => {
    const v = evaluateGrazing({
      applications: [unsourced],
      subject: EWE,
      attestations: [{ ...long, sprayEventRef: 'spray:other' }],
      atMs: at(400),
      timeZone: TZ
    });
    expect(v.lookbackDays).toBe(GRAZING_LOOKBACK_DAYS);
    expect(v.status).toBe('clear');
  });
});
