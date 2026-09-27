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

function stay(p: Partial<StayFact> & Pick<StayFact, 'id' | 'subjectId' | 'fieldId' | 'fromMs'>): HoldFact {
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

function spray(ref: string, blockId: string, atMs: number, restrictions: GrazingApplication['restrictions']): HoldFact {
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
    const b: Span[] = [{ fromMs: 10, toMs: 20, basis: 'known' }];
    expect(subtractSpans(a, b)).toEqual([
      { fromMs: 0, toMs: 10, basis: 'prohibited' },
      { fromMs: 20, toMs: Infinity, basis: 'prohibited' }
    ]);
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

  it('holds a pasture for grazing and hay from the spray to its label clear date', () => {
    const facts: HoldFact[] = [
      { kind: 'block-assignment', blockId: 'b1', fieldId: 'pasture' },
      spray('spray:1', 'b1', NOW - DAY, { source: 'label', grazeDays: 7, hayDays: 30, lactatingDairyGrazeDays: 7 })
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
      spray('spray:1', 'b1', NOW - 2 * DAY, { source: 'label', grazeDays: 7, hayDays: 7, lactatingDairyGrazeDays: 7, meatAnimalRemovalBeforeSlaughterDays: 3 }),
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
    const diff = shortenings(projectHolds([...base, log], NOW, ctx), projectHolds([...base, moved], NOW, ctx));
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
    expect(canonicalDiff(shortenings(before, after))).toBe(canonicalDiff(shortenings(before, after)));
    expect(canonicalDiff(shortenings(before, after))).toContain('inf');
  });
});

describe('holdStartsAfter (§4c)', () => {
  it('finds a hold already on file that starts after a declaration date', () => {
    const p = projectHolds([hen('h1'), dose('d1', 'animal', 'h1', NOW - 2 * DAY)], NOW, ctx);
    expect(holdStartsAfter(p, [eggsOf('animal:h1')], NOW - 3 * DAY, NOW)?.fromMs).toBe(NOW - 2 * DAY);
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
    const until = { status: 'until' as const, clearsAtMs: 5, exactClearsAtMs: 5, source: 'label' as const };
    const unknown = { status: 'unknown' as const, why: 'no-value' as const, labelPathOpen: true };
    expect(longerHold(until, unknown)).toBe(unknown);
    expect(longerHold(until, { ...until, clearsAtMs: 9 }).status).toBe('until');
    expect(
      longerHold(unknown, { status: 'prohibited', cfr: ['x'], drugs: ['y'] }).status
    ).toBe('prohibited');
  });
});

describe('FACT_EFFECT', () => {
  it('classifies every fact kind', () => {
    expect(Object.keys(FACT_EFFECT).sort()).toEqual([...FACT_KINDS].sort());
    for (const kind of FACT_KINDS) expect(['opens', 'closes', 'declares']).toContain(FACT_EFFECT[kind]);
  });

  it('maps every stored fact to classified kinds', () => {
    for (const kinds of Object.values(HOLD_FACT_KINDS)) {
      for (const k of kinds) expect(FACT_KINDS).toContain(k);
    }
  });
});
