import { describe, expect, it } from 'vitest';
import {
  FACT_EFFECT,
  FACT_KINDS,
  HOLD_FACT_KINDS,
  canonicalDiff,
  diffIsVoidable,
  holdMapKey,
  holdStartsAfter,
  isEmptyDiff,
  normalizeSpans,
  projectHolds,
  shortenings,
  subtractSpans,
  type HoldFact,
  type ProjectionContext,
  type Span,
  type StayFact
} from './holdLedger';
import {
  longerHold,
  computeWithdrawalClear,
  type AnimalHealthProductData,
  type TreatmentRecord
} from './animalWithdrawal';
import type { GrazingApplication } from './grazingInterval';

const TZ = 'America/New_York';
const DAY = 86_400_000;
const NOW = Date.parse('2026-09-20T16:00:00Z');

const WORMER: AnimalHealthProductData = {
  pluginId: 'wormer',
  displayName: 'Wormer',
  activeIngredients: [{ name: 'testazole' }],
  labelUses: [
    { speciesId: 'chicken', class: 'all', withdrawal: { meatDays: 14, eggsDays: 7 } },
    { speciesId: 'sheep', class: 'all', withdrawal: { meatDays: 10 } },
    { speciesId: 'sheep', class: 'lactating-dairy', withdrawal: { milkHours: 72 } }
  ]
};

const ctx: ProjectionContext = {
  plugins: (id) => (id === 'wormer' ? WORMER : undefined),
  timeZone: TZ,
  registryMaxIntervalDays: 0
};

function hen(id: string, groupId: string | null = null): HoldFact {
  return {
    kind: 'subject',
    subjectType: 'animal',
    id,
    speciesId: 'chicken',
    sex: 'female',
    currentGroupId: groupId,
    speciesProducts: ['eggs', 'meat']
  };
}

function flock(id: string): HoldFact {
  return {
    kind: 'subject',
    subjectType: 'group',
    id,
    speciesId: 'chicken',
    sex: null,
    currentGroupId: null,
    speciesProducts: ['eggs', 'meat']
  };
}

function dose(
  id: string,
  subjectType: 'animal' | 'group',
  subjectId: string,
  atMs: number,
  extra: Partial<TreatmentRecord> = {}
): HoldFact {
  return {
    kind: 'dose',
    treatment: {
      id,
      subjectType,
      subjectId,
      speciesId: 'chicken',
      kind: 'deworm',
      productPluginId: 'wormer',
      productName: null,
      route: null,
      labelUse: 'label',
      administeredAtMs: atMs,
      courseEndAtMs: null,
      entries: [],
      ...extra
    }
  };
}

function stay(
  p: Partial<StayFact> & Pick<StayFact, 'id' | 'subjectId' | 'fieldId' | 'fromMs'>
): HoldFact {
  return {
    kind: 'stay',
    subjectType: 'animal',
    toMs: null,
    fromGroupId: null,
    toGroupId: null,
    floor: [],
    deleted: false,
    ...p
  };
}

function spray(
  ref: string,
  blockId: string,
  atMs: number,
  restrictions: GrazingApplication['restrictions']
): HoldFact {
  return {
    kind: 'application',
    application: {
      ref,
      source: 'spray',
      blockId,
      appliedAtMs: atMs,
      productPluginId: 'weedkiller',
      productName: 'Weedkiller',
      restrictions
    }
  };
}

const eggsOf = (key: string) => holdMapKey(key, 'eggs');

describe('span algebra', () => {
  it('merges overlaps and keeps the strongest basis where spans overlap', () => {
    const spans: Span[] = [
      { fromMs: 0, toMs: 10, basis: 'unknown' },
      { fromMs: 5, toMs: 20, basis: 'known' },
      { fromMs: 20, toMs: 25, basis: 'known' }
    ];
    expect(normalizeSpans(spans)).toEqual([
      { fromMs: 0, toMs: 5, basis: 'unknown' },
      { fromMs: 5, toMs: 25, basis: 'known' }
    ]);
  });

  it('subtracts including an infinite end', () => {
    const a: Span[] = [{ fromMs: 0, toMs: Infinity, basis: 'prohibited' }];
    const b: Span[] = [{ fromMs: 10, toMs: 20, basis: 'prohibited' }];
    expect(subtractSpans(a, b)).toEqual([
      { fromMs: 0, toMs: 10, basis: 'prohibited' },
      { fromMs: 20, toMs: Infinity, basis: 'prohibited' }
    ]);
  });

  it('only a span at least as strong covers: a weaker one leaves the time lost', () => {
    const a: Span[] = [{ fromMs: 0, toMs: Infinity, basis: 'prohibited' }];
    expect(subtractSpans(a, [{ fromMs: 0, toMs: Infinity, basis: 'unknown' }])).toEqual(a);
    expect(subtractSpans(a, [{ fromMs: 0, toMs: Infinity, basis: 'known' }])).toEqual(a);
    const k: Span[] = [{ fromMs: 0, toMs: 10, basis: 'known' }];
    expect(subtractSpans(k, [{ fromMs: 0, toMs: Infinity, basis: 'prohibited' }])).toEqual([]);
    expect(subtractSpans(k, [{ fromMs: 0, toMs: Infinity, basis: 'unknown' }])).toEqual(k);
  });
});

describe('projectHolds', () => {
  it('holds eggs from the dose to the label clear date', () => {
    const p = projectHolds([hen('h1'), dose('d1', 'animal', 'h1', NOW - 2 * DAY)], NOW, ctx);
    const spans = p.holds.get(eggsOf('animal:h1'))!;
    expect(spans).toHaveLength(1);
    expect(spans[0].fromMs).toBe(NOW - 2 * DAY);
    expect(spans[0].toMs).toBeGreaterThanOrEqual(NOW + 5 * DAY);
    expect(spans[0].basis).toBe('known');
    expect(p.holds.get(holdMapKey('animal:h1', 'milk'))![0]).toMatchObject({
      toMs: Infinity,
      basis: 'unknown'
    });
  });

  it('closes an open course at now (truncation)', () => {
    const open = dose('d1', 'animal', 'h1', NOW - 5 * DAY, { courseOpen: true });
    const p = projectHolds([hen('h1'), open], NOW, ctx);
    const spans = p.holds.get(eggsOf('animal:h1'))!;
    expect(spans[0].toMs).toBeGreaterThanOrEqual(NOW + 7 * DAY);
    expect(spans[0].toMs).toBeLessThan(NOW + 9 * DAY);
  });

  it("holds a flock's eggs only while the treated hen is a member", () => {
    const facts: HoldFact[] = [
      flock('g1'),
      hen('h1'),
      dose('d1', 'animal', 'h1', NOW - 3 * DAY),
      stay({
        id: 's-leave',
        subjectId: 'h1',
        fieldId: 'barn',
        fromMs: NOW - DAY,
        fromGroupId: 'g1'
      })
    ];
    const p = projectHolds(facts, NOW, ctx);
    const spans = p.holds.get(eggsOf('group:g1'))!;
    expect(spans).toHaveLength(1);
    expect(spans[0]).toMatchObject({ fromMs: NOW - 3 * DAY, toMs: NOW - DAY });
  });

  it('round 7: a named hen in a split-off group carries the parent flock dose given before the split only', () => {
    const facts: HoldFact[] = [
      flock('g1'),
      flock('g2'),
      hen('h1', 'g2'),
      dose('before', 'group', 'g1', NOW - 4 * DAY),
      stay({
        id: 's-split',
        subjectType: 'group',
        subjectId: 'g2',
        fieldId: 'coop-b',
        fromMs: NOW - 2 * DAY,
        fromGroupId: 'g1'
      })
    ];
    const p = projectHolds(facts, NOW, ctx);
    const spans = p.holds.get(eggsOf('animal:h1'))!;
    expect(spans).toHaveLength(1);
    expect(spans[0]).toMatchObject({ fromMs: NOW - 4 * DAY, basis: 'known' });
    expect(spans[0].toMs).toBeGreaterThan(NOW);

    const after = projectHolds(
      [...facts.filter((f) => f.kind !== 'dose'), dose('after', 'group', 'g1', NOW - DAY)],
      NOW,
      ctx
    );
    expect(after.holds.get(eggsOf('animal:h1')) ?? []).toEqual([]);
  });

  it('holds a pasture for grazing and hay from the spray to its label clear date', () => {
    const facts: HoldFact[] = [
      { kind: 'block-assignment', blockId: 'b1', fieldId: 'pasture' },
      spray('spray:1', 'b1', NOW - DAY, {
        source: 'label',
        grazeDays: 7,
        hayDays: 30,
        lactatingDairyGrazeDays: 7
      })
    ];
    const p = projectHolds(facts, NOW, ctx);
    expect(p.holds.get(holdMapKey('area:pasture', 'graze'))![0]).toMatchObject({
      fromMs: NOW - DAY,
      basis: 'known'
    });
    expect(p.holds.get(holdMapKey('area:pasture', 'hay'))![0].toMs).toBeGreaterThan(NOW + 28 * DAY);
  });

  it('holds a grazing animal and marks its stay as covered', () => {
    const facts: HoldFact[] = [
      hen('h1'),
      { kind: 'block-assignment', blockId: 'b1', fieldId: 'pasture' },
      spray('spray:1', 'b1', NOW - 2 * DAY, {
        source: 'label',
        grazeDays: 7,
        hayDays: 7,
        lactatingDairyGrazeDays: 7,
        meatAnimalRemovalBeforeSlaughterDays: 3
      }),
      stay({ id: 's1', subjectId: 'h1', fieldId: 'pasture', fromMs: NOW - DAY })
    ];
    const p = projectHolds(facts, NOW, ctx);
    expect(p.holds.get(eggsOf('animal:h1'))?.length).toBeGreaterThan(0);
    expect(p.covered.get('stay:s1')).toBe('known');
  });

  it('covers a food log inside a hold (the C-06 set)', () => {
    const facts: HoldFact[] = [
      hen('h1'),
      dose('d1', 'animal', 'h1', NOW - 3 * DAY),
      {
        kind: 'production',
        id: 'log1',
        subjectType: 'animal',
        subjectId: 'h1',
        food: 'eggs',
        declaredUse: 'sale',
        occurredAtMs: NOW - DAY,
        deleted: false
      }
    ];
    expect(projectHolds(facts, NOW, ctx).covered.get('log:log1')).toBe('known');
  });
});

describe('shortenings', () => {
  const base: HoldFact[] = [hen('h1'), dose('d1', 'animal', 'h1', NOW - 2 * DAY)];

  it('is empty when a write only adds a hold', () => {
    const before = projectHolds(base, NOW, ctx);
    const after = projectHolds([...base, dose('d2', 'animal', 'h1', NOW - 10 * DAY)], NOW, ctx);
    expect(isEmptyDiff(shortenings(before, after))).toBe(true);
  });

  it('reports a key that disappears as never held', () => {
    const before = projectHolds(base, NOW, ctx);
    const after = projectHolds([hen('h1')], NOW, ctx);
    const diff = shortenings(before, after);
    expect(diff.holds.map((h) => h.kind).sort()).toEqual(['eggs', 'meat', 'milk']);
    expect(diff.holds.find((h) => h.kind === 'eggs')?.clearAfter).toBeNull();
  });

  it('checks all of time, past holds included', () => {
    const old: HoldFact[] = [hen('h1'), dose('d1', 'animal', 'h1', NOW - 300 * DAY)];
    const diff = shortenings(projectHolds(old, NOW, ctx), projectHolds([hen('h1')], NOW, ctx));
    expect(diff.holds.some((h) => h.kind === 'eggs')).toBe(true);
  });

  it('reports lost coverage', () => {
    const log: HoldFact = {
      kind: 'production',
      id: 'log1',
      subjectType: 'animal',
      subjectId: 'h1',
      food: 'eggs',
      declaredUse: 'food',
      occurredAtMs: NOW - DAY,
      deleted: false
    };
    const moved: HoldFact = { ...log, occurredAtMs: NOW - 5 * DAY };
    const diff = shortenings(
      projectHolds([...base, log], NOW, ctx),
      projectHolds([...base, moved], NOW, ctx)
    );
    expect(diff.coverage).toEqual([{ id: 'log:log1', basis: 'known' }]);
  });

  it('lets an owner fill in an unknown, but never shortens a known hold', () => {
    const before = projectHolds(base, NOW, ctx);
    const after = projectHolds([hen('h1')], NOW, ctx);
    const diff = shortenings(before, after, { resolvesUnknown: true });
    expect(diff.holds.map((h) => h.kind).sort()).toEqual(['eggs', 'meat']);
  });

  it('is voidable only when every lost stretch is known and ends', () => {
    const before = projectHolds(base, NOW, ctx);
    const after = projectHolds([hen('h1')], NOW, ctx);
    expect(diffIsVoidable(shortenings(before, after))).toBe(false);
    expect(diffIsVoidable(shortenings(before, after, { resolvesUnknown: true }))).toBe(true);
  });

  it('has a stable canonical text for the diff hash', () => {
    const before = projectHolds(base, NOW, ctx);
    const after = projectHolds([hen('h1')], NOW, ctx);
    expect(canonicalDiff(shortenings(before, after))).toBe(
      canonicalDiff(shortenings(before, after))
    );
    expect(canonicalDiff(shortenings(before, after))).toContain('inf');
  });
});

describe('shortenings compare the basis, not only the time (round 3)', () => {
  const cow: HoldFact = {
    kind: 'subject',
    subjectType: 'animal',
    id: 'a1',
    speciesId: 'cattle',
    sex: 'female',
    currentGroupId: null,
    speciesProducts: ['meat', 'milk']
  };
  const cattleDose = (id: string, productName: string, extra: Partial<TreatmentRecord> = {}) =>
    dose('x', 'animal', 'a1', NOW - 400 * DAY, {
      id,
      speciesId: 'cattle',
      subjectSex: 'female',
      kind: 'treatment',
      productPluginId: null,
      productName,
      labelUse: null,
      ...extra
    });
  const P = cattleDose('P', 'Chloramphenicol');
  const U = cattleDose('U', 'Mystery drench');
  const vetDay = (food: 'meat' | 'milk') =>
    ({
      kind: 'vet',
      food,
      amount: 1,
      unit: 'days',
      vetName: 'Dr. Reyes',
      enteredAtMs: NOW
    }) as const;
  const meat = holdMapKey('animal:a1', 'meat');

  it('reports a prohibited hold turned unknown as lost, and resolving the unknown cannot drop it', () => {
    const before = projectHolds([cow, P, U], NOW, ctx);
    expect(before.holds.get(meat)?.[0].basis).toBe('prohibited');
    const neverGiven = cattleDose('P', 'Chloramphenicol', { deletion: { dosed: false } });
    const after = projectHolds([cow, neverGiven, U], NOW, ctx);
    expect(after.holds.get(meat)?.[0].basis).toBe('unknown');

    const diff = shortenings(before, after);
    const lost = diff.holds.find((h) => h.kind === 'meat')?.lost ?? [];
    expect(lost.map((l) => l.basis)).toEqual(['prohibited']);
    expect(diffIsVoidable(diff)).toBe(false);
    expect(isEmptyDiff(shortenings(before, after, { resolvesUnknown: true }))).toBe(false);
  });

  it('a later owner entry on the unknown dose never clears the prohibited time', () => {
    const before = projectHolds([cow, P, U], NOW, ctx);
    const U2 = cattleDose('U', 'Mystery drench', { entries: [vetDay('meat'), vetDay('milk')] });
    const diff = shortenings(before, projectHolds([cow, P, U2], NOW, ctx), {
      resolvesUnknown: true
    });
    expect(isEmptyDiff(diff)).toBe(true);
  });

  it('a known hold that only an unknown one still covers counts as lost', () => {
    const known = [hen('h1'), dose('K', 'animal', 'h1', NOW - 2 * DAY)];
    const unknownDose = dose('U', 'animal', 'h1', NOW - 2 * DAY, {
      productPluginId: null,
      productName: 'Mystery'
    });
    const before = projectHolds([...known, unknownDose], NOW, ctx);
    const after = projectHolds(
      [
        hen('h1'),
        dose('K', 'animal', 'h1', NOW - 2 * DAY, { deletion: { dosed: false } }),
        unknownDose
      ],
      NOW,
      ctx
    );
    const diff = shortenings(before, after, { resolvesUnknown: true });
    expect(diff.holds.find((h) => h.kind === 'eggs')?.lost.every((l) => l.basis === 'known')).toBe(
      true
    );
  });

  it('a sex change that stops a prohibited match is a loss the owner cannot resolve away', () => {
    const sulfa = (sex: string) =>
      cattleDose('S', 'Albon (sulfadimethoxine)', {
        subjectSex: sex,
        entries: [
          { kind: 'product', pluginId: 'wormer', onLabel: false, enteredAtMs: NOW - DAY }
        ] as TreatmentRecord['entries']
      });
    const before = projectHolds([cow, sulfa('female')], NOW, ctx);
    expect(before.holds.get(meat)?.[0].basis).toBe('prohibited');
    const bull = { ...cow, sex: 'male' } as HoldFact;
    const after = projectHolds([bull, sulfa('male')], NOW, ctx);
    expect(after.holds.get(meat)?.[0].basis).toBe('unknown');
    const diff = shortenings(before, after, { resolvesUnknown: true });
    const lost = diff.holds.find((h) => h.kind === 'meat')?.lost ?? [];
    expect(lost.length).toBeGreaterThan(0);
    expect(lost.every((l) => l.basis === 'prohibited')).toBe(true);
    expect(diffIsVoidable(diff)).toBe(false);
  });

  it('a covered record now covered only on a weaker basis is lost coverage', () => {
    const milkLog: HoldFact = {
      kind: 'production',
      id: 'm1',
      subjectType: 'animal',
      subjectId: 'a1',
      food: 'milk',
      declaredUse: 'food',
      occurredAtMs: NOW - DAY,
      deleted: false
    };
    const b = projectHolds([cow, P, U, milkLog], NOW, ctx);
    expect(b.covered.get('log:m1')).toBe('prohibited');
    const a = projectHolds(
      [cow, cattleDose('P', 'Chloramphenicol', { deletion: { dosed: false } }), U, milkLog],
      NOW,
      ctx
    );
    expect(a.covered.get('log:m1')).toBe('unknown');
    expect(shortenings(b, a, { resolvesUnknown: true }).coverage).toEqual([
      { id: 'log:m1', basis: 'prohibited' }
    ]);
  });
});

describe('grazing land (review round 3, C-21)', () => {
  const assign = (areaGrazeable: boolean, fieldId = 'garden1'): HoldFact => ({
    kind: 'block-assignment',
    blockId: 'bed1',
    fieldId,
    areaGrazeable
  });
  const sprayed = spray('spray:1', 'bed1', NOW - 200 * DAY, null);
  const graze = holdMapKey('area:garden1', 'graze');

  it('holds nothing for an Area that is not grazing land, only hay on the block itself', () => {
    const p = projectHolds([assign(false), sprayed], NOW, ctx);
    expect(p.holds.has(graze)).toBe(false);
    expect(p.holds.has(holdMapKey('area:garden1', 'hay'))).toBe(false);
    expect(p.holds.has(holdMapKey('block:bed1', 'hay'))).toBe(true);
  });

  it('lets a sprayed bed be deleted, since its own hay hold ends with it', () => {
    const before = projectHolds([assign(false), sprayed], NOW, ctx);
    expect(isEmptyDiff(shortenings(before, projectHolds([], NOW, ctx)))).toBe(true);
  });

  it('lets a sprayed bed move to another garden', () => {
    const before = projectHolds([assign(false), sprayed], NOW, ctx);
    const after = projectHolds([assign(false, 'garden2'), sprayed], NOW, ctx);
    expect(isEmptyDiff(shortenings(before, after))).toBe(true);
  });

  it('counts the whole Area once an animal has stayed on it', () => {
    const hens = stay({
      id: 's1',
      subjectId: 'h1',
      fieldId: 'garden1',
      fromMs: NOW - 300 * DAY,
      toMs: NOW - 250 * DAY
    });
    const before = projectHolds([hen('h1'), assign(false), sprayed], NOW, ctx);
    const after = projectHolds([hen('h1'), assign(false), sprayed, hens], NOW, ctx);
    expect(after.holds.has(graze)).toBe(true);
    expect(isEmptyDiff(shortenings(before, after))).toBe(true);
    const gone = projectHolds([hen('h1'), hens], NOW, ctx);
    expect(isEmptyDiff(shortenings(after, gone))).toBe(false);
  });

  it('refuses a pasture turning into a garden while a spray holds it', () => {
    const before = projectHolds([assign(true), sprayed], NOW, ctx);
    const after = projectHolds([assign(false), sprayed], NOW, ctx);
    expect(
      shortenings(before, after)
        .holds.map((h) => h.kind)
        .sort()
    ).toEqual(['graze', 'hay']);
  });

  it('holds no grazing on a block in no Area, and lets it be placed in a garden (review round 5)', () => {
    const loose: HoldFact = { kind: 'block-assignment', blockId: 'bed1', fieldId: null };
    const before = projectHolds([loose, sprayed], NOW, ctx);
    expect(before.holds.has(holdMapKey('block:bed1', 'graze'))).toBe(false);
    expect(before.holds.has(holdMapKey('block:bed1', 'hay'))).toBe(true);
    const placed = projectHolds([assign(false), sprayed], NOW, ctx);
    expect(isEmptyDiff(shortenings(before, placed))).toBe(true);
    const pasture = projectHolds([assign(true), sprayed], NOW, ctx);
    expect(isEmptyDiff(shortenings(before, pasture))).toBe(true);
    expect(isEmptyDiff(shortenings(pasture, before))).toBe(false);
  });

  it('still refuses deleting a sprayed pasture block', () => {
    const before = projectHolds([assign(true), sprayed], NOW, ctx);
    expect(isEmptyDiff(shortenings(before, projectHolds([], NOW, ctx)))).toBe(false);
  });
});

describe('holdStartsAfter (§4c)', () => {
  it('finds a hold already on file that starts after a declaration date', () => {
    const p = projectHolds([hen('h1'), dose('d1', 'animal', 'h1', NOW - 2 * DAY)], NOW, ctx);
    expect(holdStartsAfter(p, [eggsOf('animal:h1')], NOW - 3 * DAY, NOW)?.fromMs).toBe(
      NOW - 2 * DAY
    );
    expect(holdStartsAfter(p, [eggsOf('animal:h1')], NOW - DAY, NOW)).toBeNull();
  });
});

describe('parameters take the longer of the snapshot and current data', () => {
  const t: TreatmentRecord = {
    id: 't1',
    subjectType: 'animal',
    subjectId: 'h1',
    speciesId: 'chicken',
    kind: 'deworm',
    productPluginId: 'wormer',
    productName: null,
    route: null,
    labelUse: 'label',
    administeredAtMs: NOW,
    courseEndAtMs: null,
    entries: []
  };
  const shorter: AnimalHealthProductData = {
    ...WORMER,
    labelUses: [{ speciesId: 'chicken', class: 'all', withdrawal: { meatDays: 1, eggsDays: 1 } }]
  };

  it('a shorter current label never shortens a recorded one', () => {
    const recorded = computeWithdrawalClear({ ...t, snapshotProduct: WORMER }, () => shorter, {
      timeZone: TZ
    });
    const plain = computeWithdrawalClear(t, () => WORMER, { timeZone: TZ });
    expect(recorded.foods.eggs).toEqual(plain.foods.eggs);
  });

  it('a product missing when recorded stays unknown', () => {
    const recorded = computeWithdrawalClear({ ...t, snapshotProduct: null }, () => WORMER, {
      timeZone: TZ
    });
    expect(recorded.foods.eggs.status).toBe('unknown');
  });

  it('longerHold ranks prohibited over unknown over a date', () => {
    const until = {
      status: 'until' as const,
      clearsAtMs: 5,
      exactClearsAtMs: 5,
      source: 'label' as const
    };
    const unknown = { status: 'unknown' as const, why: 'no-value' as const, labelPathOpen: true };
    expect(longerHold(until, unknown)).toBe(unknown);
    expect(longerHold(until, { ...until, clearsAtMs: 9 }).status).toBe('until');
    expect(longerHold(unknown, { status: 'prohibited', cfr: ['x'], drugs: ['y'] }).status).toBe(
      'prohibited'
    );
  });
});

describe('FACT_EFFECT', () => {
  it('classifies every fact kind', () => {
    expect(Object.keys(FACT_EFFECT).sort()).toEqual([...FACT_KINDS].sort());
    for (const kind of FACT_KINDS)
      expect(['opens', 'closes', 'declares']).toContain(FACT_EFFECT[kind]);
  });

  it('maps every stored fact to classified kinds', () => {
    for (const kinds of Object.values(HOLD_FACT_KINDS)) {
      for (const k of kinds) expect(FACT_KINDS).toContain(k);
    }
  });
});

describe('grazing exposure past the exact lookback (0.7.3)', () => {
  it('holds eggs of a hen that went onto a pasture whose year-long interval has not cleared', () => {
    const sprayedAt = NOW - 400 * DAY;
    const arrive = sprayedAt + 365 * DAY + 3_600_000;
    const facts: HoldFact[] = [
      hen('h1'),
      { kind: 'block-assignment', blockId: 'b1', fieldId: 'pasture' },
      spray('spray:s1', 'b1', sprayedAt, {
        source: 'label',
        grazeDays: 365,
        lactatingDairyGrazeDays: 365
      }),
      stay({ id: 'st1', subjectId: 'h1', fieldId: 'pasture', fromMs: arrive, toMs: arrive + DAY })
    ];
    const spans = projectHolds(facts, NOW, { ...ctx, registryMaxIntervalDays: 365 }).holds.get(
      eggsOf('animal:h1')
    );
    expect(spans?.some((s) => s.fromMs <= arrive && arrive < s.toMs)).toBe(true);
  });
});
