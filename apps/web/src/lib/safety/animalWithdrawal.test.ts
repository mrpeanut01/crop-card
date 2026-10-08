import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  activeHolds,
  appendWithdrawalEntry,
  carriesHold,
  checkWithdrawalEntry,
  computeWithdrawalClear,
  endOfLocalDateMs,
  evaluateFoodUse,
  FOODS,
  formatClearDate,
  isMeatDeclaration,
  isSaferUseChange,
  lastDoseAtMs,
  latestDoseReaching,
  localDateKey,
  localDayStartMs,
  logsCoveredByHolds,
  parseWithdrawalClear,
  parseWithdrawalEntries,
  PRODUCTION_USES,
  roundUpToLocalMidnight,
  serializeWithdrawalClear,
  serializeWithdrawalEntries,
  summarizeHolds,
  type AnimalHealthProductData,
  type Food,
  type FoodSubject,
  type GroupMembership,
  type LabelClass,
  type PluginLookup,
  type TreatmentRecord,
  type WithdrawalEntry,
  withdrawalNextStep
} from './animalWithdrawal';
import { RULES_VERSION } from './version';
import { ymdInZone } from '$lib/prefs';

const TZ = 'America/New_York';
const HOUR = 3_600_000;
const DAY = 86_400_000;
/** Monday 2026-05-04 10:00 EDT. */
const T0 = Date.parse('2026-05-04T14:00:00Z');

const midnight = (ymd: string) => localDayStartMs(ymd, TZ) as number;

const PLUGINS: Record<string, AnimalHealthProductData> = {
  'test-dewormer': {
    pluginId: 'test-dewormer',
    displayName: 'Test Dewormer',
    activeIngredients: [{ name: 'testazole' }],
    labelUses: [
      { speciesId: 'chicken', class: 'all', withdrawal: { meatDays: 14, eggsDays: 7 } },
      { speciesId: 'goat', class: 'all', routes: ['oral'], withdrawal: { meatDays: 10 } },
      {
        speciesId: 'goat',
        class: 'lactating-dairy',
        routes: ['oral'],
        withdrawal: { milkHours: 96 }
      },
      { speciesId: 'sheep', class: 'all', withdrawal: { meatDays: 5 } },
      { speciesId: 'sheep', class: 'non-lactating-dairy', withdrawal: { meatDays: 12 } }
    ]
  },
  'test-zero': {
    pluginId: 'test-zero',
    displayName: 'Test Zero',
    activeIngredients: [{ name: 'nothing' }],
    labelUses: [{ speciesId: 'chicken', class: 'all', withdrawal: { meatDays: 0, eggsDays: 0 } }]
  },
  'test-no-layers': {
    pluginId: 'test-no-layers',
    displayName: 'Test No Layers',
    activeIngredients: [{ name: 'otherazole' }],
    labelUses: [
      { speciesId: 'chicken', class: 'all', withdrawal: { meatDays: 5, doNotUseFor: ['eggs'] } }
    ]
  },
  'test-silent': {
    pluginId: 'test-silent',
    displayName: 'Test Silent',
    activeIngredients: [{ name: 'quietol' }],
    labelUses: [{ speciesId: 'cattle', class: 'all' }]
  },
  'test-enro': {
    pluginId: 'test-enro',
    displayName: 'Test Enro Injectable',
    activeIngredients: [{ name: 'enrofloxacin' }],
    labelUses: [
      { speciesId: 'cattle', class: 'all', routes: ['injection-sc'], withdrawal: { meatDays: 28 } }
    ]
  },
  'test-dry-cow': {
    pluginId: 'test-dry-cow',
    displayName: 'Test Dry Cow',
    activeIngredients: [{ name: 'dryol' }],
    labelUses: [{ speciesId: 'cattle', class: 'non-lactating-dairy', withdrawal: { meatDays: 30 } }]
  },
  'test-vaccine': {
    pluginId: 'test-vaccine',
    displayName: 'Test Dog Vaccine',
    activeIngredients: [{ name: 'antigen' }],
    labelUses: [{ speciesId: 'dog', class: 'all' }]
  }
};

const lookup: PluginLookup = (id) => PLUGINS[id];

let seq = 0;
function treat(overrides: Partial<TreatmentRecord> = {}): TreatmentRecord {
  seq += 1;
  return {
    id: `t${seq}`,
    subjectType: 'animal',
    subjectId: 'hen1',
    speciesId: 'chicken',
    subjectSex: null,
    kind: 'deworm',
    productPluginId: 'test-dewormer',
    productName: null,
    route: 'oral',
    labelUse: 'label',
    administeredAtMs: T0,
    courseEndAtMs: null,
    courseOpen: false,
    entries: [],
    storedClear: null,
    deletion: null,
    ...overrides
  };
}

const vet = (
  food: Food,
  amount: number,
  unit: 'days' | 'hours' = 'days',
  extra: Partial<WithdrawalEntry> = {}
) =>
  ({
    kind: 'vet',
    food,
    amount,
    unit,
    vetName: 'Dr. Reyes',
    enteredAtMs: T0 + HOUR,
    ...extra
  }) as WithdrawalEntry;
const label = (
  food: Food,
  amount: number,
  unit: 'days' | 'hours' = 'days',
  extra: Partial<WithdrawalEntry> = {}
) =>
  ({
    kind: 'label',
    food,
    amount,
    unit,
    labelNamesSpeciesAndClass: true,
    enteredAtMs: T0 + HOUR,
    ...extra
  }) as WithdrawalEntry;

const animal = (id = 'hen1', memberships: GroupMembership[] = []): FoodSubject => ({
  type: 'animal',
  id,
  memberships
});

function clear(t: TreatmentRecord) {
  return computeWithdrawalClear(t, lookup, { timeZone: TZ });
}

function food(t: TreatmentRecord, f: Food) {
  return clear(t).foods[f];
}

describe('computeWithdrawalClear — label data', () => {
  it('stamps the rules version and product', () => {
    const c = clear(treat());
    expect(c.rulesVersion).toBe(RULES_VERSION);
    expect(RULES_VERSION).toBe('0.7.8');
    expect(c.product).toBe('Test Dewormer');
  });

  it('rounds an on-label withdrawal up to the next farm-local midnight (C-04)', () => {
    const eggs = food(treat(), 'eggs');
    expect(eggs).toMatchObject({ status: 'until', source: 'label' });
    if (eggs.status !== 'until') throw new Error('expected until');
    expect(eggs.exactClearsAtMs).toBe(T0 + 7 * DAY);
    expect(eggs.clearsAtMs).toBe(midnight('2026-05-12'));
    const meat = food(treat(), 'meat');
    expect(meat.status === 'until' && meat.clearsAtMs).toBe(midnight('2026-05-19'));
  });

  it('a zero-day label holds until the next midnight', () => {
    const eggs = food(treat({ productPluginId: 'test-zero' }), 'eggs');
    expect(eggs.status === 'until' && eggs.clearsAtMs).toBe(midnight('2026-05-05'));
  });

  it('milk uses hours and the lactating class (C-10)', () => {
    const t = treat({ speciesId: 'goat', subjectId: 'doe1' });
    const milk = food(t, 'milk');
    expect(milk.status === 'until' && milk.exactClearsAtMs).toBe(T0 + 96 * HOUR);
    expect(milk.status === 'until' && milk.clearsAtMs).toBe(midnight('2026-05-09'));
  });

  it('meat takes the longest class on the label, since helpers never pick a class (C-10)', () => {
    const t = treat({ speciesId: 'sheep', subjectId: 'ewe1' });
    const meat = food(t, 'meat');
    expect(meat.status === 'until' && meat.exactClearsAtMs).toBe(T0 + 12 * DAY);
  });

  it.each([
    ['species not on the label', { speciesId: 'pig' }, 'meat', 'no-label-use', false],
    [
      'route not on the label',
      { speciesId: 'goat', route: 'injection-im' },
      'meat',
      'no-label-use',
      false
    ],
    [
      'route unrecorded while the label names routes',
      { speciesId: 'goat', route: null },
      'meat',
      'no-label-use',
      false
    ],
    [
      'no milk class on the label',
      { speciesId: 'cattle', productPluginId: 'test-dry-cow' },
      'milk',
      'no-label-use',
      false
    ],
    ['general class silent on milk', { speciesId: 'sheep' }, 'milk', 'no-value', true],
    [
      'label silent on this food',
      { speciesId: 'cattle', productPluginId: 'test-silent' },
      'meat',
      'no-value',
      true
    ],
    ['label forbids this food', { productPluginId: 'test-no-layers' }, 'eggs', 'do-not-use', false],
    ['extra-label use', { labelUse: 'extra-label-vet' as const }, 'eggs', 'extra-label', false],
    ['label use not stated', { labelUse: 'unknown' as const }, 'eggs', 'label-use-unknown', true],
    ['label use null', { labelUse: null }, 'eggs', 'label-use-unknown', true],
    [
      'free-text product',
      { productPluginId: null, productName: 'Farm store wormer' },
      'eggs',
      'no-plugin',
      true
    ],
    ['plugin missing from the registry', { productPluginId: 'gone' }, 'eggs', 'no-plugin', true],
    [
      'free-text extra-label',
      { productPluginId: null, productName: 'X', labelUse: 'extra-label-vet' as const },
      'eggs',
      'extra-label',
      false
    ],
    [
      'treatment with no product',
      { productPluginId: null, productName: null, kind: 'treatment' as const },
      'eggs',
      'no-product',
      false
    ],
    ['open course', { courseOpen: true }, 'eggs', 'course-open', false],
    ['unreadable entries', { entries: 'invalid' as const }, 'eggs', 'entries-invalid', false]
  ])('%s is unknown (C-11, C-12, C-19)', (_name, overrides, f, why, open) => {
    const hold = food(treat(overrides as Partial<TreatmentRecord>), f as Food);
    expect(hold).toEqual({ status: 'unknown', why, labelPathOpen: open });
  });
});

describe('computeWithdrawalClear — owner entries (C-01, C-02, C-03)', () => {
  it('a label entry resolves a free-text product for that food only', () => {
    const t = treat({
      productPluginId: null,
      productName: 'Farm store wormer',
      entries: [label('eggs', 3)]
    });
    const c = clear(t);
    expect(c.foods.eggs).toMatchObject({
      status: 'until',
      source: 'entry',
      exactClearsAtMs: T0 + 3 * DAY
    });
    expect(c.foods.meat.status).toBe('unknown');
    expect(c.foods.milk.status).toBe('unknown');
  });

  it('a label entry the owner did not confirm resolves nothing', () => {
    const t = treat({
      productPluginId: null,
      productName: 'X',
      entries: [label('eggs', 3, 'days', { labelNamesSpeciesAndClass: false })]
    });
    expect(food(t, 'eggs').status).toBe('unknown');
  });

  it('zero needs the explicit "label says no withdrawal" choice', () => {
    const plain = treat({ productPluginId: null, productName: 'X', entries: [label('eggs', 0)] });
    expect(food(plain, 'eggs').status).toBe('unknown');
    const none = treat({
      productPluginId: null,
      productName: 'X',
      entries: [label('eggs', 0, 'days', { labelSaysNone: true })]
    });
    expect(food(none, 'eggs')).toMatchObject({ status: 'until', exactClearsAtMs: T0 });
    const vetZero = treat({ productPluginId: null, productName: 'X', entries: [vet('eggs', 0)] });
    expect(food(vetZero, 'eggs').status).toBe('unknown');
    const vetNone = treat({
      productPluginId: null,
      productName: 'X',
      entries: [vet('eggs', 0, 'days', { vetSaysNone: true })]
    });
    expect(food(vetNone, 'eggs').status).toBe('until');
  });

  it.each([
    ['extra-label', { labelUse: 'extra-label-vet' as const }, 'eggs'],
    ['label forbids the food', { productPluginId: 'test-no-layers' }, 'eggs'],
    ['species mismatch', { speciesId: 'pig' }, 'meat'],
    [
      'no product at all',
      { productPluginId: null, productName: null, kind: 'treatment' as const },
      'eggs'
    ]
  ])('the label path is closed for %s; only a vet entry clears it', (_n, overrides, f) => {
    const withLabel = treat({
      ...(overrides as Partial<TreatmentRecord>),
      entries: [label(f as Food, 30)]
    });
    expect(food(withLabel, f as Food).status).toBe('unknown');
    const withVet = treat({
      ...(overrides as Partial<TreatmentRecord>),
      entries: [vet(f as Food, 30)]
    });
    expect(food(withVet, f as Food)).toMatchObject({
      status: 'until',
      exactClearsAtMs: T0 + 30 * DAY
    });
  });

  it('a vet entry without a vet name resolves nothing', () => {
    const t = treat({
      labelUse: 'extra-label-vet',
      entries: [vet('eggs', 30, 'days', { vetName: ' ' })]
    });
    expect(food(t, 'eggs').status).toBe('unknown');
  });

  it('the floor is max(label, every entry): a shorter vet value never shortens the label', () => {
    const t = treat({ labelUse: 'extra-label-vet', entries: [vet('eggs', 2)] });
    expect(food(t, 'eggs')).toMatchObject({
      status: 'until',
      exactClearsAtMs: T0 + 7 * DAY,
      source: 'label'
    });
    const longer = treat({ entries: [vet('eggs', 21)] });
    expect(food(longer, 'eggs')).toMatchObject({ exactClearsAtMs: T0 + 21 * DAY, source: 'entry' });
  });

  it('an unconfirmed label entry still lengthens, though it clears nothing', () => {
    const t = treat({ entries: [label('eggs', 20, 'days', { labelNamesSpeciesAndClass: false })] });
    expect(food(t, 'eggs')).toMatchObject({ exactClearsAtMs: T0 + 20 * DAY });
  });

  it('milk hours from the vet', () => {
    const t = treat({
      speciesId: 'cattle',
      subjectId: 'cow1',
      productPluginId: null,
      productName: 'Vet compounded',
      labelUse: 'extra-label-vet',
      entries: [vet('milk', 120, 'hours')]
    });
    expect(food(t, 'milk')).toMatchObject({ exactClearsAtMs: T0 + 120 * HOUR });
    expect(food(t, 'meat').status).toBe('unknown');
  });

  it('withdrawal runs from the last dose; a recorded end can only move it later', () => {
    const planned = treat({ courseEndAtMs: T0 + 4 * DAY });
    expect(lastDoseAtMs(planned)).toBe(T0 + 4 * DAY);
    expect(food(planned, 'eggs')).toMatchObject({ exactClearsAtMs: T0 + 11 * DAY });
    const earlyEnd = treat({
      courseEndAtMs: T0 + 4 * DAY,
      entries: [{ kind: 'course-end', endedAtMs: T0 + 2 * DAY, enteredAtMs: T0 }]
    });
    expect(lastDoseAtMs(earlyEnd)).toBe(T0 + 4 * DAY);
    const lateEnd = treat({
      courseEndAtMs: T0 + 4 * DAY,
      entries: [{ kind: 'course-end', endedAtMs: T0 + 6 * DAY, enteredAtMs: T0 }]
    });
    expect(lastDoseAtMs(lateEnd)).toBe(T0 + 6 * DAY);
  });

  it('an open course is unknown until its end is recorded', () => {
    const open = treat({ courseOpen: true });
    expect(lastDoseAtMs(open)).toBeNull();
    expect(food(open, 'eggs').status).toBe('unknown');
    const ended = treat({
      courseOpen: true,
      entries: [{ kind: 'course-end', endedAtMs: T0 + 3 * DAY, enteredAtMs: T0 + 3 * DAY }]
    });
    expect(food(ended, 'eggs')).toMatchObject({ status: 'until', exactClearsAtMs: T0 + 10 * DAY });
  });

  it('ignores out-of-range entry amounts', () => {
    const t = treat({ productPluginId: null, productName: 'X', entries: [vet('eggs', 999_999)] });
    expect(food(t, 'eggs').status).toBe('unknown');
  });
});

describe('which events carry a hold (C-19, C-26)', () => {
  it.each([
    ['vet visit with no product', { kind: 'vet-visit' as const, productPluginId: null }, false],
    ['note with no product', { kind: 'note' as const, productPluginId: null }, false],
    ['injury with no product', { kind: 'injury' as const, productPluginId: null }, false],
    [
      'vet visit naming a product',
      { kind: 'vet-visit' as const, productPluginId: 'test-dewormer' },
      true
    ],
    [
      'note naming free text',
      { kind: 'note' as const, productPluginId: null, productName: 'Penicillin' },
      true
    ],
    ['treatment with no product', { kind: 'treatment' as const, productPluginId: null }, true],
    ['vaccination', { kind: 'vaccination' as const }, true],
    ['force-deleted as never given', { deletion: { dosed: false } }, false],
    ['force-deleted but dosed', { deletion: { dosed: true } }, true]
  ])('%s → %s', (_n, overrides, expected) => {
    const t = treat(overrides as Partial<TreatmentRecord>);
    expect(carriesHold(t)).toBe(expected);
    const c = clear(t);
    for (const f of FOODS) expect(c.foods[f].status === 'none').toBe(!expected);
  });

  it('a dog vet visit never shows a hold', () => {
    const t = treat({
      speciesId: 'dog',
      subjectId: 'rex',
      kind: 'vet-visit',
      productPluginId: null
    });
    const s = summarizeHolds({
      subject: animal('rex'),
      atMs: T0 + DAY,
      treatments: [t],
      plugins: lookup,
      timeZone: TZ
    });
    expect(s).toEqual({
      meat: { status: 'clear' },
      milk: { status: 'clear' },
      eggs: { status: 'clear' }
    });
  });
});

describe('prohibited drugs (C-13, C-14)', () => {
  it.each(['Enroflox 100', 'Enrofloxacin'])(
    'a brand name typed alone (%s) stays prohibited after a vet entry (review round 4)',
    (productName) => {
      const t = treat({
        productPluginId: null,
        productName,
        entries: [vet('eggs', 0, 'days', { vetSaysNone: true } as Partial<WithdrawalEntry>)]
      });
      expect(food(t, 'eggs').status).toBe('prohibited');
    }
  );

  it.each(['Enrofloxacína', 'Ｂａｙｔｒｉｌ', 'Metronidazol'])(
    'an accented, full-width or foreign spelling (%s) stays prohibited after a vet entry',
    (productName) => {
      const t = treat({
        productPluginId: null,
        productName,
        entries: [vet('eggs', 0, 'days', { vetSaysNone: true } as Partial<WithdrawalEntry>)]
      });
      expect(food(t, 'eggs').status).toBe('prohibited');
    }
  );

  it('a free-text match holds every food forever', () => {
    const t = treat({ productPluginId: null, productName: 'Baytril 100' });
    for (const f of FOODS) {
      expect(food(t, f)).toMatchObject({ status: 'prohibited', cfr: ['21 CFR 530.41(a)(10)'] });
    }
    const v = evaluateFoodUse({
      subject: animal(),
      food: 'eggs',
      use: 'food',
      atMs: T0 + 3650 * DAY,
      treatments: [t],
      plugins: lookup,
      timeZone: TZ
    });
    expect(v).toMatchObject({
      status: 'block',
      reason: 'PROHIBITED_DRUG',
      clearsAtMs: null,
      resubmitAs: 'discard'
    });
  });

  it('an on-label plugin use of an approved drug is not prohibited', () => {
    const t = treat({
      speciesId: 'cattle',
      subjectId: 'steer',
      productPluginId: 'test-enro',
      route: 'injection-sc',
      labelUse: 'label'
    });
    expect(food(t, 'meat')).toMatchObject({ status: 'until', exactClearsAtMs: T0 + 28 * DAY });
  });

  it.each([
    ['extra-label', { labelUse: 'extra-label-vet' as const }],
    ['label use unknown', { labelUse: 'unknown' as const }],
    ['wrong route', { route: 'oral' }],
    ['not a labelled species', { speciesId: 'goat' }],
    [
      'free text alongside the plugin names another banned drug',
      { productName: 'enro plus metronidazole' }
    ]
  ])('the same plugin %s stays prohibited', (_n, overrides) => {
    const t = treat({
      speciesId: 'cattle',
      subjectId: 'steer',
      productPluginId: 'test-enro',
      route: 'injection-sc',
      labelUse: 'label',
      ...(overrides as Partial<TreatmentRecord>)
    });
    expect(food(t, 'meat').status).toBe('prohibited');
  });

  it('picking the on-label plugin later clears a free-text match', () => {
    const t = treat({
      speciesId: 'cattle',
      subjectId: 'steer',
      productPluginId: null,
      productName: 'enrofloxacin',
      route: 'injection-sc',
      labelUse: 'unknown',
      entries: [{ kind: 'product', pluginId: 'test-enro', onLabel: true, enteredAtMs: T0 + DAY }]
    });
    expect(food(t, 'meat')).toMatchObject({ status: 'until', exactClearsAtMs: T0 + 28 * DAY });
  });

  it('picking an unrelated plugin never clears the free-text match', () => {
    const t = treat({
      productPluginId: null,
      productName: 'Baytril',
      entries: [
        { kind: 'product', pluginId: 'test-dewormer', onLabel: true, enteredAtMs: T0 + DAY }
      ]
    });
    expect(food(t, 'eggs').status).toBe('prohibited');
  });

  it('drugs with no approved food-animal label cannot be exempted by a plugin', () => {
    const lk: PluginLookup = (id) =>
      id === 'fake-chloro'
        ? {
            pluginId: 'fake-chloro',
            activeIngredients: [{ name: 'chloramphenicol' }],
            labelUses: [{ speciesId: 'chicken', withdrawal: { eggsDays: 1, meatDays: 1 } }]
          }
        : undefined;
    const t = treat({ productPluginId: 'fake-chloro', labelUse: 'label' });
    expect(computeWithdrawalClear(t, lk).foods.eggs.status).toBe('prohibited');
  });

  it('a stored prohibited verdict survives a rules change unless a product entry corrects it', () => {
    const stored = clear(treat({ productPluginId: null, productName: 'Baytril' }));
    const now = treat({ productPluginId: 'test-dewormer', storedClear: stored });
    expect(food(now, 'eggs').status).toBe('prohibited');
    const corrected = treat({
      productPluginId: 'test-dewormer',
      storedClear: stored,
      entries: [{ kind: 'product', pluginId: 'test-dewormer', onLabel: true, enteredAtMs: T0 }]
    });
    expect(food(corrected, 'eggs').status).toBe('until');
  });

  it('a horse treated with a banned drug stays blocked for meat', () => {
    const t = treat({
      speciesId: 'horse',
      subjectId: 'nell',
      productPluginId: null,
      productName: 'Ventipulmin'
    });
    const v = evaluateFoodUse({
      subject: animal('nell'),
      food: 'meat',
      use: 'sale',
      atMs: T0 + 5000 * DAY,
      treatments: [t],
      plugins: lookup
    });
    expect(v).toMatchObject({ status: 'block', reason: 'PROHIBITED_DRUG' });
  });

  it('group members at the time and joiners during the course hold forever; later joiners do not', () => {
    const t = treat({
      subjectType: 'group',
      subjectId: 'flock',
      productPluginId: null,
      productName: 'enrofloxacin water soluble',
      route: 'drinking-water',
      courseEndAtMs: T0 + 5 * DAY
    });
    const far = T0 + 2000 * DAY;
    const run = (memberships: GroupMembership[]) =>
      evaluateFoodUse({
        subject: animal('hen', memberships),
        food: 'meat',
        use: 'food',
        atMs: far,
        treatments: [t],
        plugins: lookup
      }).status;
    expect(run([{ groupId: 'flock', fromMs: null, toMs: T0 + DAY }])).toBe('block');
    expect(run([{ groupId: 'flock', fromMs: T0 + 3 * DAY, toMs: null }])).toBe('block');
    expect(run([{ groupId: 'flock', fromMs: T0 + 5 * DAY, toMs: null }])).toBe('block');
    expect(run([{ groupId: 'flock', fromMs: T0 + 6 * DAY, toMs: null }])).toBe('safe');
    expect(run([{ groupId: 'flock', fromMs: null, toMs: T0 - 1 }])).toBe('safe');
  });
});

describe('stored verdicts only lengthen (C-18)', () => {
  it('keeps a later stored clear time', () => {
    const base = clear(treat());
    const eggs = base.foods.eggs;
    if (eggs.status !== 'until') throw new Error('expected until');
    const stored = {
      ...base,
      foods: {
        ...base.foods,
        eggs: {
          ...eggs,
          clearsAtMs: eggs.clearsAtMs + 5 * DAY,
          exactClearsAtMs: eggs.exactClearsAtMs + 5 * DAY
        }
      }
    };
    const merged = food(treat({ storedClear: stored }), 'eggs');
    expect(merged).toMatchObject({
      status: 'until',
      source: 'stored',
      clearsAtMs: eggs.clearsAtMs + 5 * DAY
    });
  });

  it('ignores an earlier stored clear time', () => {
    const base = clear(treat());
    const eggs = base.foods.eggs;
    if (eggs.status !== 'until') throw new Error('expected until');
    const stored = {
      ...base,
      foods: { ...base.foods, eggs: { ...eggs, clearsAtMs: T0, exactClearsAtMs: T0 } }
    };
    expect(food(treat({ storedClear: stored }), 'eggs')).toMatchObject({
      clearsAtMs: eggs.clearsAtMs
    });
  });

  it('a stored unknown yields once an entry resolves it', () => {
    const stored = clear(treat({ productPluginId: null, productName: 'X' }));
    expect(stored.foods.eggs.status).toBe('unknown');
    const t = treat({
      productPluginId: null,
      productName: 'X',
      storedClear: stored,
      entries: [label('eggs', 4)]
    });
    expect(food(t, 'eggs')).toMatchObject({ status: 'until' });
  });

  it('a recomputed unknown beats a stored clear time', () => {
    const stored = clear(treat());
    const t = treat({ productPluginId: 'gone', storedClear: stored });
    expect(food(t, 'eggs').status).toBe('unknown');
  });

  it('round-trips through JSON', () => {
    for (const t of [
      treat(),
      treat({ productPluginId: null, productName: 'Baytril' }),
      treat({ productPluginId: null, productName: 'X' }),
      treat({ kind: 'note', productPluginId: null })
    ]) {
      const c = clear(t);
      expect(parseWithdrawalClear(serializeWithdrawalClear(c))).toEqual(c);
    }
    expect(parseWithdrawalClear(null)).toBeNull();
    expect(parseWithdrawalClear('not json')).toBeNull();
    expect(parseWithdrawalClear('{"foods":{}}')).toBeNull();
  });
});

describe('evaluateFoodUse — uses (Q2, C-05, C-08)', () => {
  const t = treat();
  const run = (use: (typeof PRODUCTION_USES)[number], atMs: number, f: Food = 'eggs') =>
    evaluateFoodUse({
      subject: animal(),
      food: f,
      use,
      atMs,
      treatments: [t],
      plugins: lookup,
      timeZone: TZ
    });

  it('blocks food and sale inside the hold with the clear date and a discard resubmit', () => {
    for (const use of ['food', 'sale'] as const) {
      const v = run(use, T0 + 2 * DAY);
      expect(v).toMatchObject({
        status: 'block',
        reason: 'WITHDRAWAL_ACTIVE',
        clearsAtMs: midnight('2026-05-12'),
        products: ['Test Dewormer'],
        resubmitAs: 'discard'
      });
      if (v.status !== 'safe') expect(v.message).toContain('May 12, 2026');
    }
  });

  it('always accepts discard', () => {
    expect(run('discard', T0 + DAY).status).toBe('safe');
  });

  it('warns, without blocking, for feed-to-animals and unknown', () => {
    for (const use of ['feed-to-animals', 'unknown'] as const) {
      const v = run(use, T0 + DAY);
      expect(v.status).toBe('warn');
      if (v.status !== 'safe') expect(v.resubmitAs).toBeUndefined();
    }
  });

  it('eggs collected before the dose are safe', () => {
    expect(run('food', T0 - 1).status).toBe('safe');
  });

  it('clears exactly at the rounded clear time, not before', () => {
    expect(run('food', midnight('2026-05-12') - 1).status).toBe('block');
    expect(run('food', midnight('2026-05-12')).status).toBe('safe');
  });

  it('an unknown withdrawal blocks with no clear date', () => {
    const u = treat({ productPluginId: null, productName: 'Farm store wormer' });
    const v = evaluateFoodUse({
      subject: animal(),
      food: 'eggs',
      use: 'food',
      atMs: T0 + 900 * DAY,
      treatments: [u],
      plugins: lookup
    });
    expect(v).toMatchObject({ status: 'block', reason: 'WITHDRAWAL_UNKNOWN', clearsAtMs: null });
    if (v.status !== 'safe') expect(v.message).toContain("don't know the withdrawal time");
  });

  it('reports the latest clear time across several holds and names each product', () => {
    const a = treat();
    const b = treat({ productPluginId: 'test-zero', administeredAtMs: T0 + 5 * DAY });
    const v = evaluateFoodUse({
      subject: animal(),
      food: 'eggs',
      use: 'food',
      atMs: T0 + 5 * DAY,
      treatments: [a, b],
      plugins: lookup,
      timeZone: TZ
    });
    expect(v).toMatchObject({ status: 'block', clearsAtMs: midnight('2026-05-12') });
    if (v.status !== 'safe') expect(v.products.sort()).toEqual(['Test Dewormer', 'Test Zero']);
  });

  it('prefers PROHIBITED_DRUG over unknown over active', () => {
    const active = treat();
    const unknown = treat({ productPluginId: null, productName: 'X' });
    const banned = treat({ productPluginId: null, productName: 'Baytril' });
    const at = T0 + DAY;
    const reason = (ts: TreatmentRecord[]) => {
      const v = evaluateFoodUse({
        subject: animal(),
        food: 'eggs',
        use: 'food',
        atMs: at,
        treatments: ts,
        plugins: lookup
      });
      return v.status === 'safe' ? null : v.reason;
    };
    expect(reason([active])).toBe('WITHDRAWAL_ACTIVE');
    expect(reason([active, unknown])).toBe('WITHDRAWAL_UNKNOWN');
    expect(reason([active, unknown, banned])).toBe('PROHIBITED_DRUG');
  });
});

describe('group membership (Q1, C-14, C-15, C-16)', () => {
  const groupTreat = treat({ subjectType: 'group', subjectId: 'flock' });
  const hen1Treat = treat({ subjectType: 'animal', subjectId: 'hen1' });
  const at = T0 + 2 * DAY;

  const onAnimal = (memberships: GroupMembership[], f: Food = 'meat', atMs = at) =>
    evaluateFoodUse({
      subject: animal('x', memberships),
      food: f,
      use: 'food',
      atMs,
      treatments: [groupTreat],
      plugins: lookup,
      timeZone: TZ
    }).status;

  it('covers members at the time of treatment, even after they leave', () => {
    expect(onAnimal([{ groupId: 'flock', fromMs: null, toMs: null }])).toBe('block');
    expect(
      onAnimal([
        { groupId: 'flock', fromMs: null, toMs: T0 + DAY },
        { groupId: 'other', fromMs: T0 + DAY, toMs: null }
      ])
    ).toBe('block');
  });

  it('covers animals that join while the hold runs, and not after', () => {
    expect(onAnimal([{ groupId: 'flock', fromMs: T0 + DAY, toMs: null }])).toBe('block');
    expect(
      onAnimal(
        [{ groupId: 'flock', fromMs: midnight('2026-05-19'), toMs: null }],
        'meat',
        midnight('2026-05-20')
      )
    ).toBe('safe');
  });

  it('does not reach animals that left before the treatment', () => {
    expect(onAnimal([{ groupId: 'flock', fromMs: null, toMs: T0 - 1 }])).toBe('safe');
  });

  const flock = (members: { animalId: string; memberships: GroupMembership[] }[]): FoodSubject => ({
    type: 'group',
    id: 'flock',
    members
  });

  it("an individual treatment blocks the group's egg and milk food logs", () => {
    const subject = flock([
      { animalId: 'hen1', memberships: [{ groupId: 'flock', fromMs: null, toMs: null }] }
    ]);
    const v = evaluateFoodUse({
      subject,
      food: 'eggs',
      use: 'food',
      atMs: at,
      treatments: [hen1Treat],
      plugins: lookup
    });
    expect(v).toMatchObject({ status: 'block', reason: 'WITHDRAWAL_ACTIVE' });
    if (v.status !== 'safe') expect(v.holds[0]).toMatchObject({ via: 'member', animalId: 'hen1' });
  });

  it('stops once the treated member leaves the group', () => {
    const subject = flock([
      { animalId: 'hen1', memberships: [{ groupId: 'flock', fromMs: null, toMs: T0 + DAY }] }
    ]);
    const v = evaluateFoodUse({
      subject,
      food: 'eggs',
      use: 'food',
      atMs: at,
      treatments: [hen1Treat],
      plugins: lookup
    });
    expect(v.status).toBe('safe');
  });

  it('a moved hen carries her hold into her new flock', () => {
    const subject: FoodSubject = {
      type: 'group',
      id: 'flock2',
      members: [
        {
          animalId: 'hen1',
          memberships: [
            { groupId: 'flock', fromMs: null, toMs: T0 + DAY },
            { groupId: 'flock2', fromMs: T0 + DAY, toMs: null }
          ]
        }
      ]
    };
    const v = evaluateFoodUse({
      subject,
      food: 'eggs',
      use: 'food',
      atMs: at,
      treatments: [groupTreat],
      plugins: lookup
    });
    expect(v.status).toBe('block');
  });

  it("an individual treatment never blocks meat from the group's unnamed members (C-16)", () => {
    const subject = flock([
      { animalId: 'hen1', memberships: [{ groupId: 'flock', fromMs: null, toMs: null }] }
    ]);
    const v = evaluateFoodUse({
      subject,
      food: 'meat',
      use: 'food',
      atMs: at,
      treatments: [hen1Treat],
      plugins: lookup
    });
    expect(v.status).toBe('safe');
    const own = evaluateFoodUse({
      subject,
      food: 'meat',
      use: 'food',
      atMs: at,
      treatments: [groupTreat],
      plugins: lookup
    });
    expect(own.status).toBe('block');
  });

  it('a group split off a treated group carries its holds through lineage', () => {
    const subject: FoodSubject = {
      type: 'group',
      id: 'split',
      lineage: [{ groupId: 'flock', fromMs: null, toMs: T0 + DAY }],
      members: []
    };
    const v = evaluateFoodUse({
      subject,
      food: 'meat',
      use: 'food',
      atMs: at,
      treatments: [groupTreat],
      plugins: lookup
    });
    expect(v).toMatchObject({ status: 'block' });
    if (v.status !== 'safe') expect(v.holds[0].via).toBe('lineage');
  });

  it('activeHolds lists each treatment once', () => {
    const subject = flock([
      { animalId: 'hen1', memberships: [{ groupId: 'flock', fromMs: null, toMs: null }] }
    ]);
    const holds = activeHolds({
      subject,
      food: 'eggs',
      atMs: at,
      treatments: [groupTreat, hen1Treat],
      plugins: lookup
    });
    expect(holds.map((h) => h.treatmentId).sort()).toEqual([groupTreat.id, hen1Treat.id].sort());
  });
});

describe('summaries, logs and helpers', () => {
  it('summarizeHolds gives one chip per food (C-33)', () => {
    const t = treat({ speciesId: 'goat', subjectId: 'doe', productPluginId: 'test-dewormer' });
    const s = summarizeHolds({
      subject: animal('doe'),
      atMs: T0 + DAY,
      treatments: [t],
      plugins: lookup,
      timeZone: TZ
    });
    expect(s.milk).toEqual({
      status: 'hold',
      clearsAtMs: midnight('2026-05-09'),
      products: ['Test Dewormer']
    });
    expect(s.meat).toMatchObject({ status: 'hold', clearsAtMs: midnight('2026-05-15') });
    expect(s.eggs).toMatchObject({ status: 'unknown' });
  });

  it('formats the clear date in farm time', () => {
    expect(formatClearDate(midnight('2026-05-12'), TZ)).toBe('Tue, May 12, 2026');
  });

  it('logsCoveredByHolds flags saved food and sale logs a backdated treatment covers (C-06)', () => {
    const t = treat({ administeredAtMs: T0 - 3 * DAY });
    const logs = [
      {
        id: 'l1',
        food: 'eggs' as const,
        use: 'food' as const,
        occurredAtMs: T0,
        subject: animal()
      },
      {
        id: 'l2',
        food: 'eggs' as const,
        use: 'sale' as const,
        occurredAtMs: T0 + DAY,
        subject: animal()
      },
      {
        id: 'l3',
        food: 'eggs' as const,
        use: 'discard' as const,
        occurredAtMs: T0,
        subject: animal()
      },
      {
        id: 'l4',
        food: 'eggs' as const,
        use: 'food' as const,
        occurredAtMs: T0 - 4 * DAY,
        subject: animal()
      },
      {
        id: 'l5',
        food: 'eggs' as const,
        use: 'food' as const,
        occurredAtMs: T0 + 30 * DAY,
        subject: animal()
      }
    ];
    expect(logsCoveredByHolds(logs, [t], lookup, TZ).map((l) => l.id)).toEqual(['l1', 'l2']);
  });

  it.each([
    ['food', 'discard', true],
    ['sale', 'discard', true],
    ['unknown', 'discard', true],
    ['food', 'food', true],
    ['discard', 'food', false],
    ['discard', 'sale', false],
    ['discard', 'unknown', false],
    ['unknown', 'food', false],
    ['feed-to-animals', 'sale', false],
    ['food', 'unknown', false]
  ] as const)('isSaferUseChange(%s → %s) = %s (C-07)', (from, to, expected) => {
    expect(isSaferUseChange(from, to)).toBe(expected);
  });

  it.each([
    ['slaughtered', undefined, true],
    ['sold-for-meat', undefined, true],
    ['culled', true, true],
    ['culled', false, false],
    ['culled', undefined, false],
    ['sold', true, true],
    ['sold', undefined, false],
    ['rehomed', true, false],
    ['active', undefined, false]
  ] as const)('isMeatDeclaration(%s, %s) = %s (C-17)', (status, used, expected) => {
    expect(isMeatDeclaration(status, used)).toBe(expected);
  });
});

describe('checkWithdrawalEntry (C-01, C-02, C-03, Q11)', () => {
  const freeText = treat({ productPluginId: null, productName: 'Farm store wormer' });
  it.each([
    ['helper adding a vet entry', freeText, vet('eggs', 3), 'helper', 'OWNER_ONLY'],
    ['inspector', freeText, vet('eggs', 3), 'inspector', 'OWNER_ONLY'],
    ['owner vet entry', freeText, vet('eggs', 3), 'owner', null],
    [
      'vet entry without a name',
      freeText,
      vet('eggs', 3, 'days', { vetName: '' }),
      'owner',
      'VET_NAME_REQUIRED'
    ],
    ['fractional days', freeText, vet('eggs', 2.5), 'owner', 'INVALID_VALUE'],
    ['negative', freeText, vet('eggs', -1), 'owner', 'INVALID_VALUE'],
    ['too long', freeText, vet('eggs', 5000), 'owner', 'INVALID_VALUE'],
    ['vet zero unconfirmed', freeText, vet('eggs', 0), 'owner', 'ZERO_NOT_CONFIRMED'],
    ['label entry confirmed', freeText, label('eggs', 3), 'owner', null],
    [
      'label entry unconfirmed',
      freeText,
      label('eggs', 3, 'days', { labelNamesSpeciesAndClass: false }),
      'owner',
      'LABEL_NOT_CONFIRMED'
    ],
    ['label zero unconfirmed', freeText, label('eggs', 0), 'owner', 'ZERO_NOT_CONFIRMED'],
    [
      'label zero confirmed',
      freeText,
      label('eggs', 0, 'days', { labelSaysNone: true }),
      'owner',
      null
    ],
    [
      'label entry on extra-label use',
      treat({ labelUse: 'extra-label-vet' }),
      label('eggs', 9),
      'owner',
      'LABEL_PATH_CLOSED'
    ],
    [
      'label entry where the label forbids the food',
      treat({ productPluginId: 'test-no-layers' }),
      label('eggs', 9),
      'owner',
      'LABEL_PATH_CLOSED'
    ],
    [
      'label entry on a mismatched species',
      treat({ speciesId: 'pig' }),
      label('meat', 9),
      'owner',
      'LABEL_PATH_CLOSED'
    ],
    [
      'entry on a vet visit with no product',
      treat({ kind: 'vet-visit', productPluginId: null }),
      vet('eggs', 3),
      'owner',
      'NO_HOLD'
    ],
    [
      'course end before the first dose',
      freeText,
      { kind: 'course-end', endedAtMs: T0 - 1, enteredAtMs: T0 },
      'owner',
      'COURSE_END_BEFORE_START'
    ],
    [
      'course end earlier than planned',
      treat({ courseEndAtMs: T0 + 5 * DAY }),
      { kind: 'course-end', endedAtMs: T0 + 2 * DAY, enteredAtMs: T0 },
      'owner',
      'COURSE_END_EARLIER'
    ],
    [
      'course end later',
      treat({ courseEndAtMs: T0 + 5 * DAY }),
      { kind: 'course-end', endedAtMs: T0 + 6 * DAY, enteredAtMs: T0 },
      'owner',
      null
    ],
    [
      'course end by a helper',
      treat({ courseOpen: true }),
      { kind: 'course-end', endedAtMs: T0 + 6 * DAY, enteredAtMs: T0 },
      'helper',
      'OWNER_ONLY'
    ],
    [
      'product entry for an unknown plugin',
      freeText,
      { kind: 'product', pluginId: 'nope', onLabel: true, enteredAtMs: T0 },
      'owner',
      'UNKNOWN_PLUGIN'
    ],
    [
      'product entry for a known plugin',
      freeText,
      { kind: 'product', pluginId: 'test-enro', onLabel: true, enteredAtMs: T0 },
      'owner',
      null
    ]
  ] as [string, TreatmentRecord, WithdrawalEntry, string, string | null][])(
    '%s',
    (_n, t, entry, role, code) => {
      const result = checkWithdrawalEntry(entry, t, lookup, role);
      if (code === null) expect(result).toEqual({ ok: true });
      else {
        expect(result).toMatchObject({ ok: false, code });
        if (!result.ok) expect(result.message.length).toBeGreaterThan(10);
      }
    }
  );
});

describe('entry JSON', () => {
  it('round-trips and appends', () => {
    const entries = appendWithdrawalEntry([vet('eggs', 3)], label('meat', 5));
    expect(parseWithdrawalEntries(serializeWithdrawalEntries(entries))).toEqual(
      entries.map((e) => ({
        ...e,
        enteredById: null,
        ...(e.kind === 'vet' ? { vetSaysNone: false } : {}),
        ...(e.kind === 'label' ? { labelSaysNone: false } : {})
      }))
    );
  });

  it.each([
    [null, []],
    ['', []],
    ['[]', []],
    ['nope', 'invalid'],
    ['{}', 'invalid'],
    ['[{"kind":"vet"}]', 'invalid'],
    ['[{"kind":"label","food":"eggs","amount":3,"unit":"weeks","enteredAtMs":1}]', 'invalid'],
    ['[{"kind":"mystery","enteredAtMs":1}]', 'invalid'],
    ['[{"kind":"course-end","endedAtMs":"x","enteredAtMs":1}]', 'invalid']
  ])('parseWithdrawalEntries(%s)', (json, expected) => {
    expect(parseWithdrawalEntries(json)).toEqual(expected);
  });
});

describe('farm-local time (C-03, C-04)', () => {
  it('reads a date-only entry as 23:59 local, across a DST change', () => {
    const end = endOfLocalDateMs('2026-03-08', TZ) as number;
    expect(new Date(end).toISOString()).toBe('2026-03-09T03:59:00.000Z');
    const fall = endOfLocalDateMs('2026-11-01', TZ) as number;
    expect(new Date(fall).toISOString()).toBe('2026-11-02T04:59:00.000Z');
    expect(endOfLocalDateMs('2026-02-30', TZ)).toBeNull();
    expect(localDayStartMs('bad', TZ)).toBeNull();
  });

  it('keeps an exact midnight and rounds anything after it up', () => {
    const m = midnight('2026-05-12');
    expect(roundUpToLocalMidnight(m, TZ)).toBe(m);
    expect(roundUpToLocalMidnight(m + 1, TZ)).toBe(midnight('2026-05-13'));
    expect(roundUpToLocalMidnight(m - 1, TZ)).toBe(m);
  });

  it('falls back to the default zone for an unknown zone', () => {
    expect(roundUpToLocalMidnight(T0, 'Not/AZone')).toBe(roundUpToLocalMidnight(T0, TZ));
  });

  const zones = [
    'UTC',
    'America/New_York',
    'America/Los_Angeles',
    'America/Sao_Paulo',
    'America/Santiago',
    'America/Havana',
    'America/St_Johns',
    'Europe/London',
    'Asia/Kolkata',
    'Asia/Kathmandu',
    'Asia/Tehran',
    'Australia/Lord_Howe',
    'Pacific/Chatham',
    'Pacific/Apia',
    'Pacific/Kiritimati'
  ];

  it('property: the rounded time is a local day start, never before the exact time, within 50 h', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: Date.UTC(1990, 0, 1), max: Date.UTC(2060, 0, 1) }),
        fc.constantFrom(...zones),
        (ms, tz) => {
          const r = roundUpToLocalMidnight(ms, tz);
          expect(r).toBeGreaterThanOrEqual(ms);
          expect(r - ms).toBeLessThan(50 * HOUR);
          expect(localDateKey(r - 1, tz)).toBeLessThan(localDateKey(r, tz));
          expect(roundUpToLocalMidnight(r, tz)).toBe(r);
          if (r > ms) expect(localDateKey(r, tz)).toBeGreaterThan(localDateKey(ms, tz));
        }
      ),
      { numRuns: 300 }
    );
  });
});

const foodArb = fc.constantFrom<Food>('meat', 'milk', 'eggs');
const speciesArb = fc.constantFrom('chicken', 'goat', 'sheep', 'cattle', 'pig', 'duck');
const timeArb = fc.integer({ min: Date.UTC(2020, 0, 1), max: Date.UTC(2030, 0, 1) });

function labelPlugin(speciesId: string, days: number, hours: number): AnimalHealthProductData {
  return {
    pluginId: 'gen',
    displayName: 'Generated',
    activeIngredients: [{ name: 'generatol' }],
    labelUses: [
      { speciesId, class: 'all', withdrawal: { meatDays: days, eggsDays: days, milkHours: hours } }
    ]
  };
}

const entryArb: fc.Arbitrary<WithdrawalEntry> = fc.oneof(
  fc.record({
    kind: fc.constant('vet' as const),
    food: foodArb,
    amount: fc.integer({ min: 0, max: 400 }),
    unit: fc.constantFrom('days' as const, 'hours' as const),
    vetName: fc.constantFrom('Dr. A', '', ' '),
    vetSaysNone: fc.boolean(),
    enteredAtMs: timeArb
  }),
  fc.record({
    kind: fc.constant('label' as const),
    food: foodArb,
    amount: fc.integer({ min: 0, max: 400 }),
    unit: fc.constantFrom('days' as const, 'hours' as const),
    labelNamesSpeciesAndClass: fc.boolean(),
    labelSaysNone: fc.boolean(),
    enteredAtMs: timeArb
  }),
  fc.record({
    kind: fc.constant('course-end' as const),
    endedAtMs: timeArb,
    enteredAtMs: timeArb
  })
);

const uses = fc.constantFrom(...PRODUCTION_USES);

describe('withdrawal properties (Kernel test expectations)', () => {
  it('clearance is never earlier than the plugin label', () => {
    fc.assert(
      fc.property(
        speciesArb,
        foodArb,
        fc.integer({ min: 0, max: 120 }),
        fc.integer({ min: 0, max: 720 }),
        timeArb,
        fc.option(fc.integer({ min: 0, max: 30 * DAY }), { nil: null }),
        fc.array(entryArb, { maxLength: 4 }),
        fc.constantFrom('label', 'extra-label-vet', 'unknown', null) as fc.Arbitrary<
          TreatmentRecord['labelUse']
        >,
        (speciesId, f, days, hours, admin, courseLen, entries, labelUse) => {
          const plugin = labelPlugin(speciesId, days, hours);
          const t = treat({
            speciesId,
            productPluginId: 'gen',
            labelUse,
            administeredAtMs: admin,
            courseEndAtMs: courseLen === null ? null : admin + courseLen,
            entries
          });
          const hold = computeWithdrawalClear(t, () => plugin, { timeZone: TZ }).foods[f];
          if (hold.status !== 'until') return;
          const last = lastDoseAtMs(t) as number;
          const labelMs = f === 'milk' ? hours * HOUR : days * DAY;
          expect(hold.exactClearsAtMs).toBeGreaterThanOrEqual(last + labelMs);
          expect(hold.clearsAtMs).toBeGreaterThanOrEqual(hold.exactClearsAtMs);
          expect(last).toBeGreaterThanOrEqual(admin);
        }
      )
    );
  });

  it('a vet-directed withdrawal (or any added entry) can only lengthen clearance', () => {
    fc.assert(
      fc.property(
        foodArb,
        fc.integer({ min: 0, max: 60 }),
        timeArb,
        fc.array(entryArb, { maxLength: 3 }),
        entryArb,
        (f, days, admin, entries, extra) => {
          const plugin = labelPlugin('goat', days, days * 24);
          const base = treat({
            speciesId: 'goat',
            productPluginId: 'gen',
            administeredAtMs: admin,
            entries
          });
          const before = computeWithdrawalClear(base, () => plugin, { timeZone: TZ }).foods[f];
          const after = computeWithdrawalClear(
            { ...base, entries: appendWithdrawalEntry(entries, extra) },
            () => plugin,
            { timeZone: TZ }
          ).foods[f];
          if (before.status === 'until' && after.status === 'until') {
            expect(after.clearsAtMs).toBeGreaterThanOrEqual(before.clearsAtMs);
          }
          if (before.status === 'until') expect(after.status).toBe('until');
        }
      )
    );
  });

  it('entries appended the way the endpoint saves them can only lengthen a known hold (C-18)', () => {
    const genPlugins = (days: number[]): Record<string, AnimalHealthProductData> =>
      Object.fromEntries(
        days.map((d, i) => [
          `gen-${i}`,
          {
            pluginId: `gen-${i}`,
            displayName: `Generated ${i}`,
            activeIngredients: [{ name: `generatol-${i}` }],
            labelUses: [
              {
                speciesId: 'goat',
                class: 'all',
                withdrawal: { meatDays: d, eggsDays: d, milkHours: d * 24 }
              }
            ]
          }
        ])
      );
    const productEntryArb: fc.Arbitrary<WithdrawalEntry> = fc.record({
      kind: fc.constant('product' as const),
      pluginId: fc.constantFrom('gen-0', 'gen-1', 'gen-2'),
      onLabel: fc.boolean(),
      enteredAtMs: timeArb
    });
    fc.assert(
      fc.property(
        foodArb,
        fc.array(fc.integer({ min: 0, max: 60 }), { minLength: 3, maxLength: 3 }),
        timeArb,
        fc.option(fc.constantFrom('gen-0', 'gen-1', 'gen-2'), { nil: null }),
        fc.array(fc.oneof(entryArb, productEntryArb, productEntryArb), { maxLength: 6 }),
        (f, days, admin, pluginId, sequence) => {
          const plugins = genPlugins(days);
          const lk: PluginLookup = (id) => plugins[id];
          const draft = treat({
            speciesId: 'goat',
            productPluginId: pluginId,
            productName: pluginId ? null : 'Some wormer',
            labelUse: 'unknown',
            administeredAtMs: admin
          });
          let t: TreatmentRecord = {
            ...draft,
            storedClear: computeWithdrawalClear(draft, lk, { timeZone: TZ })
          };
          let before = computeWithdrawalClear(t, lk, { timeZone: TZ }).foods[f];
          for (const e of sequence) {
            if (!checkWithdrawalEntry(e, t, lk, 'owner').ok) continue;
            const entries = t.entries === 'invalid' ? [] : t.entries;
            const verdict = computeWithdrawalClear(
              { ...t, entries: appendWithdrawalEntry(entries, e) },
              lk,
              { timeZone: TZ }
            );
            t = { ...t, entries: appendWithdrawalEntry(entries, { ...e, verdict }) };
            const after = computeWithdrawalClear(t, lk, { timeZone: TZ }).foods[f];
            if (before.status === 'until') {
              expect(after.status).not.toBe('none');
              if (after.status === 'until') {
                expect(after.clearsAtMs).toBeGreaterThanOrEqual(before.clearsAtMs);
              }
            }
            before = after;
          }
        }
      )
    );
  });

  it('a second product pick cannot shorten the hold the first one set (review finding)', () => {
    const lk: PluginLookup = (id) =>
      id === 'long'
        ? {
            pluginId: 'long',
            displayName: 'Long',
            activeIngredients: [{ name: 'longol' }],
            labelUses: [{ speciesId: 'chicken', class: 'all', withdrawal: { eggsDays: 30 } }]
          }
        : id === 'short'
          ? {
              pluginId: 'short',
              displayName: 'Short',
              activeIngredients: [{ name: 'shortol' }],
              labelUses: [{ speciesId: 'chicken', class: 'all', withdrawal: { eggsDays: 1 } }]
            }
          : undefined;
    const draft = treat({ productPluginId: null, productName: 'Some wormer', labelUse: 'unknown' });
    let t: TreatmentRecord = { ...draft, storedClear: computeWithdrawalClear(draft, lk) };
    const append = (e: WithdrawalEntry) => {
      expect(checkWithdrawalEntry(e, t, lk, 'owner').ok).toBe(true);
      const entries = t.entries === 'invalid' ? [] : t.entries;
      const verdict = computeWithdrawalClear(
        { ...t, entries: appendWithdrawalEntry(entries, e) },
        lk,
        { timeZone: TZ }
      );
      t = { ...t, entries: appendWithdrawalEntry(entries, { ...e, verdict }) };
    };
    append({ kind: 'product', pluginId: 'long', onLabel: true, enteredAtMs: T0 + HOUR });
    const first = computeWithdrawalClear(t, lk, { timeZone: TZ }).foods.eggs;
    expect(first.status).toBe('until');
    append({ kind: 'product', pluginId: 'short', onLabel: true, enteredAtMs: T0 + 2 * HOUR });
    const second = computeWithdrawalClear(t, lk, { timeZone: TZ }).foods.eggs;
    expect(second).toMatchObject({ status: 'until', source: 'stored' });
    if (first.status === 'until' && second.status === 'until') {
      expect(second.clearsAtMs).toBe(first.clearsAtMs);
    }
    const v = evaluateFoodUse({
      subject: animal(t.subjectId),
      food: 'eggs',
      use: 'food',
      atMs: T0 + 5 * DAY,
      treatments: [t],
      plugins: lk,
      timeZone: TZ
    });
    expect(v).toMatchObject({ status: 'block', reason: 'WITHDRAWAL_ACTIVE' });
  });

  it('an open course names the missing last dose, not the label or the vet (review finding)', () => {
    const t = treat({ courseOpen: true, entries: [vet('eggs', 40)] });
    const v = evaluateFoodUse({
      subject: animal(t.subjectId),
      food: 'eggs',
      use: 'food',
      atMs: T0 + 60 * DAY,
      treatments: [t],
      plugins: lookup,
      timeZone: TZ
    });
    expect(v).toMatchObject({ status: 'block', reason: 'WITHDRAWAL_UNKNOWN' });
    if (v.status !== 'safe') {
      expect(v.message).toContain('The owner can record when the last dose was given.');
      expect(v.message).not.toContain('from the label or the vet');
      expect(withdrawalNextStep(v.holds)).toBe('last-dose');
    }
    const unreadable = treat({ entries: 'invalid' });
    const u = evaluateFoodUse({
      subject: animal(unreadable.subjectId),
      food: 'eggs',
      use: 'food',
      atMs: T0 + DAY,
      treatments: [unreadable],
      plugins: lookup,
      timeZone: TZ
    });
    if (u.status === 'safe') throw new Error('expected a block');
    expect(u.message).toContain('contact support');
    expect(u.message).not.toContain('The owner can add it');
    expect(withdrawalNextStep(u.holds)).toBe('contact-support');
    const mystery = treat({ productPluginId: null, productName: 'Mystery drench' });
    const mv = evaluateFoodUse({
      subject: animal(mystery.subjectId),
      food: 'eggs',
      use: 'food',
      atMs: T0 + DAY,
      treatments: [mystery],
      plugins: lookup,
      timeZone: TZ
    });
    if (mv.status === 'safe') throw new Error('expected a block');
    expect(mv.message).toContain('The owner can add it from the label or the vet.');
    expect(withdrawalNextStep(mv.holds)).toBe('add-withdrawal');
  });

  it('unknown always blocks food and sale, whatever the food flag or how late', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<Partial<TreatmentRecord>>(
          { productPluginId: null, productName: 'Mystery drench' },
          { productPluginId: 'test-no-layers' },
          { labelUse: 'extra-label-vet' },
          { speciesId: 'pig' },
          { courseOpen: true },
          { entries: 'invalid' },
          { productPluginId: null, productName: null, kind: 'treatment' }
        ),
        fc.array(
          entryArb.filter((e) => e.kind === 'label'),
          { maxLength: 3 }
        ),
        fc.constantFrom('food' as const, 'sale' as const),
        fc.integer({ min: 0, max: 20_000 * DAY }),
        fc.boolean(),
        (overrides, labelEntries, use, after, foodProducing) => {
          const t = treat({
            ...overrides,
            entries:
              overrides.entries ??
              labelEntries.filter((e) => e.kind === 'label' && e.food !== 'eggs')
          });
          const hold = computeWithdrawalClear(t, lookup).foods.eggs;
          fc.pre(hold.status === 'unknown');
          const v = evaluateFoodUse({
            subject: { type: 'animal', id: t.subjectId, memberships: [], foodProducing },
            food: 'eggs',
            use,
            atMs: t.administeredAtMs + after,
            treatments: [t],
            plugins: lookup
          });
          expect(v).toMatchObject({
            status: 'block',
            reason: 'WITHDRAWAL_UNKNOWN',
            resubmitAs: 'discard'
          });
        }
      )
    );
  });

  it('prohibited drugs block forever', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('Baytril', 'metronidazole', 'chloramphenicol', 'vancomycin', 'clenbuterol'),
        foodArb,
        fc.integer({ min: 0, max: 50_000 * DAY }),
        fc.constantFrom('food' as const, 'sale' as const),
        (name, f, after, use) => {
          const t = treat({ productPluginId: null, productName: name, speciesId: 'goat' });
          const v = evaluateFoodUse({
            subject: animal(t.subjectId),
            food: f,
            use,
            atMs: T0 + after,
            treatments: [t],
            plugins: lookup
          });
          expect(v).toMatchObject({ status: 'block', reason: 'PROHIBITED_DRUG' });
        }
      )
    );
  });

  it('discard is always accepted', () => {
    fc.assert(
      fc.property(
        foodArb,
        timeArb,
        fc.array(fc.constantFrom('Baytril', 'Mystery', null), { maxLength: 3 }),
        (f, atMs, names) => {
          const ts = names.map((n) =>
            treat({ productPluginId: n === null ? 'test-dewormer' : null, productName: n })
          );
          const v = evaluateFoodUse({
            subject: animal(),
            food: f,
            use: 'discard',
            atMs,
            treatments: ts,
            plugins: lookup
          });
          expect(v.status).toBe('safe');
        }
      )
    );
  });

  it('changing food_producing never changes, and so never shortens, a hold (C-09)', () => {
    fc.assert(
      fc.property(foodArb, uses, fc.integer({ min: -DAY, max: 40 * DAY }), (f, use, offset) => {
        const ts = [treat(), treat({ productPluginId: null, productName: 'Mystery' })];
        const run = (foodProducing: boolean) =>
          evaluateFoodUse({
            subject: { type: 'animal', id: 'hen1', memberships: [], foodProducing },
            food: f,
            use,
            atMs: T0 + offset,
            treatments: ts,
            plugins: lookup,
            timeZone: TZ
          });
        expect(run(false)).toEqual(run(true));
      })
    );
  });

  it('feed-to-animals and unknown never block; food and sale never merely warn', () => {
    fc.assert(
      fc.property(uses, foodArb, fc.integer({ min: -DAY, max: 40 * DAY }), (use, f, offset) => {
        const v = evaluateFoodUse({
          subject: animal(),
          food: f,
          use,
          atMs: T0 + offset,
          treatments: [treat(), treat({ productPluginId: null, productName: 'X' })],
          plugins: lookup
        });
        if (use === 'feed-to-animals' || use === 'unknown') expect(v.status).not.toBe('block');
        if (use === 'food' || use === 'sale') expect(v.status).not.toBe('warn');
      })
    );
  });

  it('stored verdicts never shorten a hold (C-18)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 400 * DAY }),
        fc.integer({ min: 0, max: 30 }),
        foodArb,
        (storedOffset, days, f) => {
          const plugin = labelPlugin('chicken', days, days * 24);
          const base = treat({ productPluginId: 'gen' });
          const stored = computeWithdrawalClear(base, () => plugin, { timeZone: TZ });
          const s = stored.foods[f];
          if (s.status !== 'until') return;
          const bumped = {
            ...stored,
            foods: {
              ...stored.foods,
              [f]: { ...s, clearsAtMs: T0 + storedOffset, exactClearsAtMs: T0 + storedOffset }
            }
          };
          const shorter = labelPlugin('chicken', 0, 0);
          const hold = computeWithdrawalClear({ ...base, storedClear: bumped }, () => shorter, {
            timeZone: TZ
          }).foods[f];
          expect(hold.status).toBe('until');
          if (hold.status === 'until')
            expect(hold.clearsAtMs).toBeGreaterThanOrEqual(T0 + storedOffset);
        }
      )
    );
  });
});

const groupIds = ['g1', 'g2', 'g3'];

const historyArb = fc
  .array(
    fc.record({ groupId: fc.constantFrom(...groupIds), stayDays: fc.integer({ min: 0, max: 20 }) }),
    { minLength: 1, maxLength: 6 }
  )
  .chain((stays) =>
    fc.integer({ min: -20, max: 20 }).map((startDay) => {
      let cursor = T0 + startDay * DAY;
      return stays.map((s, i) => {
        const from = cursor;
        cursor += s.stayDays * DAY + HOUR;
        return {
          groupId: s.groupId,
          fromMs: i === 0 && startDay < -15 ? null : from,
          toMs: i === stays.length - 1 ? null : cursor
        };
      });
    })
  );

const groupTreatmentsArb = fc.array(
  fc.record({
    groupId: fc.constantFrom(...groupIds),
    dayOffset: fc.integer({ min: -10, max: 40 }),
    kind: fc.constantFrom('timed', 'unknown', 'prohibited')
  }),
  { maxLength: 4 }
);

function buildGroupTreatments(specs: { groupId: string; dayOffset: number; kind: string }[]) {
  return specs.map((s) =>
    treat({
      subjectType: 'group',
      subjectId: s.groupId,
      administeredAtMs: T0 + s.dayOffset * DAY,
      productPluginId: s.kind === 'timed' ? 'test-dewormer' : null,
      productName: s.kind === 'unknown' ? 'Mystery' : s.kind === 'prohibited' ? 'Baytril' : null
    })
  );
}

const ORACLE_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});

/** The first farm-local day start at or after `ms`, found by searching for
 *  the local date to change, independent of the kernel's rounding. */
function oracleDayStartAtOrAfter(ms: number): number {
  const day = (t: number) => ORACLE_DATE.format(new Date(t));
  if (day(ms - 1) !== day(ms)) return ms;
  let lo = ms;
  let hi = ms + 50 * HOUR;
  while (hi - lo > 1) {
    const mid = lo + Math.floor((hi - lo) / 2);
    if (day(mid) === day(ms)) lo = mid;
    else hi = mid;
  }
  return hi;
}

/** Windows written out from the fixtures in `buildGroupTreatments`, not from
 *  the kernel: test-dewormer's chicken label holds meat 14 days and eggs 7
 *  days and has no milk value; an unnamed or unknown product holds every
 *  food with no end; a fluoroquinolone is banned, and reaches animals that
 *  joined by the single dose. */
function oracleReaches(
  spec: { dayOffset: number; kind: string },
  groupId: string,
  memberships: GroupMembership[],
  f: Food,
  atMs: number
): boolean {
  const admin = T0 + spec.dayOffset * DAY;
  if (atMs < admin) return false;
  const labelDays: Partial<Record<Food, number>> = { meat: 14, eggs: 7 };
  let end = Infinity;
  let inclusive = false;
  if (spec.kind === 'prohibited') {
    end = admin;
    inclusive = true;
  } else if (spec.kind === 'timed' && labelDays[f] !== undefined) {
    end = oracleDayStartAtOrAfter(admin + labelDays[f]! * DAY);
    if (atMs >= end) return false;
  }
  return memberships.some((m) => {
    if (m.groupId !== groupId) return false;
    const from = m.fromMs ?? -Infinity;
    const to = m.toMs ?? Infinity;
    const joined = inclusive ? from <= end : from < end;
    return joined && to >= admin;
  });
}

describe('membership properties (C-14, C-15)', () => {
  it('a group treatment reaches exactly the animals whose history overlaps its window', () => {
    fc.assert(
      fc.property(
        historyArb,
        groupTreatmentsArb,
        foodArb,
        fc.integer({ min: -20, max: 80 }),
        (history, specs, f, atDay) => {
          const treatments = buildGroupTreatments(specs);
          const atMs = T0 + atDay * DAY;
          const holds = activeHolds({
            subject: animal('a1', history),
            food: f,
            atMs,
            treatments,
            plugins: lookup,
            timeZone: TZ
          });
          const got = new Set(holds.map((h) => h.treatmentId));
          treatments.forEach((t, i) => {
            expect(got.has(t.id)).toBe(oracleReaches(specs[i], t.subjectId, history, f, atMs));
          });
        }
      )
    );
  });

  it('every member present during a group treatment is blocked while it runs', () => {
    fc.assert(
      fc.property(
        historyArb,
        fc.integer({ min: -10, max: 30 }),
        fc.integer({ min: 0, max: 6 }),
        (history, adminDay, lagDays) => {
          const t = treat({
            subjectType: 'group',
            subjectId: 'g1',
            administeredAtMs: T0 + adminDay * DAY
          });
          const at = t.administeredAtMs + lagDays * DAY;
          const present = history.some(
            (m) =>
              m.groupId === 'g1' &&
              (m.fromMs ?? -Infinity) <= t.administeredAtMs &&
              (m.toMs ?? Infinity) >= t.administeredAtMs
          );
          fc.pre(present);
          const v = evaluateFoodUse({
            subject: animal('a1', history),
            food: 'eggs',
            use: 'food',
            atMs: at,
            treatments: [t],
            plugins: lookup,
            timeZone: TZ
          });
          expect(v.status).toBe('block');
        }
      )
    );
  });

  it('an individual treatment blocks group egg and milk food logs while the animal is a member', () => {
    fc.assert(
      fc.property(
        historyArb,
        fc.constantFrom<Food>('eggs', 'milk'),
        fc.integer({ min: 0, max: 3 }),
        (history, f, lagDays) => {
          const t = treat({
            subjectType: 'animal',
            subjectId: 'a1',
            speciesId: 'goat',
            productPluginId: 'test-dewormer'
          });
          const atMs = T0 + lagDays * DAY;
          const isMember = history.some(
            (m) =>
              m.groupId === 'g1' &&
              (m.fromMs ?? -Infinity) <= atMs &&
              (m.toMs === null || m.toMs > atMs)
          );
          const v = evaluateFoodUse({
            subject: {
              type: 'group',
              id: 'g1',
              members: [{ animalId: 'a1', memberships: history }]
            },
            food: f,
            use: 'food',
            atMs,
            treatments: [t],
            plugins: lookup,
            timeZone: TZ
          });
          const hold = computeWithdrawalClear(t, lookup, { timeZone: TZ }).foods[f];
          const holdActive = hold.status !== 'until' || atMs < hold.clearsAtMs;
          expect(v.status === 'block').toBe(isMember && holdActive);
        }
      )
    );
  });

  it("meat of a group never picks up a member's individual treatment", () => {
    fc.assert(
      fc.property(historyArb, fc.integer({ min: 0, max: 10 }), (history, lagDays) => {
        const t = treat({
          subjectType: 'animal',
          subjectId: 'a1',
          productPluginId: null,
          productName: 'Baytril'
        });
        const v = evaluateFoodUse({
          subject: { type: 'group', id: 'g1', members: [{ animalId: 'a1', memberships: history }] },
          food: 'meat',
          use: 'food',
          atMs: T0 + lagDays * DAY,
          treatments: [t],
          plugins: lookup
        });
        expect(v.status).toBe('safe');
      })
    );
  });
});

describe('on-label exemption is per food (C-11, C-13)', () => {
  const sulfaBeef: AnimalHealthProductData = {
    pluginId: 'sulfa-beef',
    displayName: 'Sulfa Beef',
    activeIngredients: [{ name: 'sulfadimethoxine' }],
    labelUses: [
      {
        speciesId: 'cattle',
        class: 'non-lactating-dairy',
        routes: ['oral'],
        withdrawal: { meatDays: 12 }
      }
    ]
  };
  const lk: PluginLookup = (id) => (id === 'sulfa-beef' ? sulfaBeef : undefined);
  const cow = (entries: WithdrawalEntry[] = []) =>
    treat({
      subjectId: 'bessie',
      speciesId: 'cattle',
      subjectSex: 'female',
      productPluginId: 'sulfa-beef',
      route: 'oral',
      labelUse: 'label',
      entries
    });

  it('a sulfa labelled only for non-lactating cattle stays prohibited for milk', () => {
    const c = computeWithdrawalClear(cow(), lk, { timeZone: TZ });
    expect(c.foods.milk).toMatchObject({ status: 'prohibited', cfr: ['21 CFR 530.41(a)(9)'] });
    expect(c.foods.meat).toMatchObject({ status: 'until', exactClearsAtMs: T0 + 12 * DAY });
  });

  describe('a product entry keeps the label data on file when it was saved (C-35 §2, round 6)', () => {
    const sulfaDairy: AnimalHealthProductData = {
      ...sulfaBeef,
      labelUses: [
        ...sulfaBeef.labelUses,
        {
          speciesId: 'cattle',
          class: 'lactating-dairy',
          routes: ['oral'],
          withdrawal: { milkHours: 60 }
        }
      ]
    };
    const later: PluginLookup = (id) => (id === 'sulfa-beef' ? sulfaDairy : undefined);
    const entry: WithdrawalEntry = {
      kind: 'product',
      pluginId: 'sulfa-beef',
      onLabel: true,
      enteredAtMs: T0 + DAY
    };

    it('a shared label use added later does not lift a prohibited milk hold', () => {
      const t = { ...cow([entry]), snapshotProduct: sulfaBeef };
      expect(computeWithdrawalClear(t, lk, { timeZone: TZ }).foods.milk.status).toBe('prohibited');
      expect(computeWithdrawalClear(t, later, { timeZone: TZ }).foods.milk).toMatchObject({
        status: 'prohibited',
        cfr: ['21 CFR 530.41(a)(9)']
      });
    });

    it('an entry on the same product whose snapshot is the newer data keeps the dose-time prohibition (round 7)', () => {
      const t = {
        ...cow([entry]),
        snapshotProduct: sulfaBeef,
        snapshotProducts: { 'sulfa-beef': sulfaDairy }
      };
      expect(computeWithdrawalClear(t, later, { timeZone: TZ }).foods.milk).toMatchObject({
        status: 'prohibited',
        cfr: ['21 CFR 530.41(a)(9)']
      });
    });

    it('an entry on the same product whose snapshot is shorter keeps the dose-time withdrawal (round 7)', () => {
      const long: AnimalHealthProductData = {
        pluginId: 'wormer',
        displayName: 'Wormer',
        activeIngredients: [{ name: 'testazole' }],
        labelUses: [{ speciesId: 'chicken', class: 'all', withdrawal: { eggsDays: 30 } }]
      };
      const short: AnimalHealthProductData = {
        ...long,
        labelUses: [{ speciesId: 'chicken', class: 'all', withdrawal: { eggsDays: 1 } }]
      };
      const t = treat({
        productPluginId: 'wormer',
        labelUse: 'label',
        entries: [{ kind: 'product', pluginId: 'wormer', onLabel: true, enteredAtMs: T0 + DAY }],
        snapshotProduct: long,
        snapshotProducts: { wormer: short }
      });
      const eggs = computeWithdrawalClear(t, (id) => (id === 'wormer' ? short : undefined), {
        timeZone: TZ
      }).foods.eggs;
      expect(eggs).toMatchObject({ status: 'until', exactClearsAtMs: T0 + 30 * DAY });
    });

    it("the entry's own snapshot floors a product the dose was not saved with", () => {
      const t = {
        ...cow([entry]),
        productPluginId: 'other',
        snapshotProduct: null,
        snapshotProducts: { 'sulfa-beef': sulfaBeef }
      };
      expect(computeWithdrawalClear(t, later, { timeZone: TZ }).foods.milk.status).toBe(
        'prohibited'
      );
    });

    it('an unknown hold stays unknown when a label use for the species arrives later', () => {
      const noHen: AnimalHealthProductData = {
        pluginId: 'wormer',
        displayName: 'Wormer',
        activeIngredients: [{ name: 'testazole' }],
        labelUses: [{ speciesId: 'sheep', class: 'all', withdrawal: { meatDays: 10 } }]
      };
      const withHen: AnimalHealthProductData = {
        ...noHen,
        labelUses: [
          ...noHen.labelUses,
          { speciesId: 'chicken', class: 'all', withdrawal: { meatDays: 1, eggsDays: 1 } }
        ]
      };
      const t = treat({
        productPluginId: 'wormer',
        labelUse: 'label',
        entries: [{ kind: 'product', pluginId: 'wormer', onLabel: true, enteredAtMs: T0 + DAY }],
        snapshotProduct: noHen
      });
      const now = computeWithdrawalClear(t, (id) => (id === 'wormer' ? withHen : undefined), {
        timeZone: TZ
      });
      expect(now.foods.eggs.status).toBe('unknown');
      const plain = computeWithdrawalClear(
        { ...t, snapshotProduct: undefined },
        (id) => (id === 'wormer' ? withHen : undefined),
        { timeZone: TZ }
      );
      expect(plain.foods.eggs.status).toBe('until');
    });
  });

  it("a vet entry cannot clear the milk, since a vet can't direct a prohibited use", () => {
    const t = cow([vet('milk', 2)]);
    const v = evaluateFoodUse({
      subject: animal('bessie'),
      food: 'milk',
      use: 'food',
      atMs: T0 + 5 * DAY,
      treatments: [t],
      plugins: lk,
      timeZone: TZ
    });
    expect(v).toMatchObject({ status: 'block', reason: 'PROHIBITED_DRUG' });
  });

  it('property: without a label use covering the food, a prohibited drug stays prohibited for it, whatever entries exist', () => {
    const CLASSES: LabelClass[] = [
      'all',
      'lactating-dairy',
      'non-lactating-dairy',
      'laying',
      'non-laying',
      'veal-calves'
    ];
    const covers = (c: LabelClass, f: Food) =>
      f === 'meat' ||
      c === 'all' ||
      (f === 'milk' && c === 'lactating-dairy') ||
      (f === 'eggs' && c === 'laying');
    fc.assert(
      fc.property(
        fc.subarray(CLASSES, { minLength: 1 }),
        foodArb,
        fc.array(entryArb, { maxLength: 4 }),
        (classes, f, entries) => {
          const plugin: AnimalHealthProductData = {
            pluginId: 'enro-gen',
            activeIngredients: [{ name: 'enrofloxacin' }],
            labelUses: classes.map((c) => ({
              speciesId: 'cattle',
              class: c,
              routes: ['injection-sc'],
              withdrawal: { meatDays: 5, milkHours: 48, eggsDays: 5 }
            }))
          };
          const t = treat({
            speciesId: 'cattle',
            subjectId: 'c1',
            productPluginId: 'enro-gen',
            route: 'injection-sc',
            labelUse: 'label',
            entries: entries.filter((e) => e.kind !== 'product')
          });
          const hold = computeWithdrawalClear(t, () => plugin, { timeZone: TZ }).foods[f];
          if (classes.some((c) => covers(c, f))) expect(hold.status).not.toBe('prohibited');
          else expect(hold.status).toBe('prohibited');
        }
      )
    );
  });
});

describe('latestDoseReaching (backdated meat declarations)', () => {
  it("finds an animal's own latest dose, including a recorded course end", () => {
    const a = treat({ administeredAtMs: T0, courseEndAtMs: T0 + 3 * DAY });
    const b = treat({ administeredAtMs: T0 + DAY });
    expect(latestDoseReaching(animal(), [a, b])).toMatchObject({
      treatmentId: a.id,
      atMs: T0 + 3 * DAY
    });
  });

  it('counts a group dose only while the animal was a member', () => {
    const g = treat({ subjectType: 'group', subjectId: 'flock', administeredAtMs: T0 });
    expect(
      latestDoseReaching(animal('hen1', [{ groupId: 'flock', fromMs: null, toMs: null }]), [g])
    ).toMatchObject({ atMs: T0 });
    expect(
      latestDoseReaching(animal('hen1', [{ groupId: 'flock', fromMs: T0 + DAY, toMs: null }]), [g])
    ).toBeNull();
  });

  it("never counts a member's own dose for a group's unnamed meat (C-16)", () => {
    const own = treat({ subjectId: 'hen1', administeredAtMs: T0 + 5 * DAY });
    const g = treat({ subjectType: 'group', subjectId: 'flock', administeredAtMs: T0 });
    const flock: FoodSubject = {
      type: 'group',
      id: 'flock',
      members: [{ animalId: 'hen1', memberships: [] }]
    };
    expect(latestDoseReaching(flock, [own, g])).toMatchObject({ atMs: T0 });
  });

  it('ignores a dose deleted as never given, and keeps one deleted as given', () => {
    const never = treat({ administeredAtMs: T0 + DAY, deletion: { dosed: false } });
    const given = treat({ administeredAtMs: T0, deletion: { dosed: true } });
    expect(latestDoseReaching(animal(), [never, given])).toMatchObject({ atMs: T0 });
  });

  it('property: a meat gate evaluated at or after the latest dose sees every hold the dose carries', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 60 }), { minLength: 1, maxLength: 4 }),
        fc.integer({ min: 0, max: 30 }),
        (offsets, after) => {
          const ts = offsets.map((d) =>
            treat({
              productPluginId: null,
              productName: 'Mystery drench',
              administeredAtMs: T0 + d * DAY
            })
          );
          const latest = latestDoseReaching(animal(), ts)!;
          expect(latest.atMs).toBe(T0 + Math.max(...offsets) * DAY);
          const v = evaluateFoodUse({
            subject: animal(),
            food: 'meat',
            use: 'food',
            atMs: latest.atMs + after * DAY,
            treatments: ts,
            plugins: lookup,
            timeZone: TZ
          });
          expect(v.status).toBe('block');
        }
      )
    );
  });
});

describe('entry audit', () => {
  it('keeps the verdict recorded with an entry through later appends', () => {
    const t = treat();
    const verdict = computeWithdrawalClear(t, lookup, { timeZone: TZ });
    const first = { ...vet('eggs', 9), verdict };
    const json = serializeWithdrawalEntries(appendWithdrawalEntry([], first));
    const parsed = parseWithdrawalEntries(json);
    expect(parsed).not.toBe('invalid');
    const again = appendWithdrawalEntry(parsed as WithdrawalEntry[], label('meat', 20));
    const back = parseWithdrawalEntries(serializeWithdrawalEntries(again)) as WithdrawalEntry[];
    expect(back[0].verdict).toEqual(verdict);
    expect(back[1].verdict).toBeUndefined();
  });
});

describe('round 4: withdrawal properties against an independent oracle', () => {
  const ZONES = ['America/New_York', 'UTC', 'Australia/Lord_Howe', 'Asia/Kathmandu'];

  it('a labelled dose blocks food at every instant before the label clear time and not after', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 60 }),
        fc.integer({ min: 1, max: 60 }),
        fc.constantFrom<Food>('meat', 'eggs'),
        fc.integer({ min: Date.UTC(2024, 0, 1), max: Date.UTC(2030, 0, 1) }),
        fc.integer({ min: 0, max: 64 * 24 * 4 }),
        fc.constantFrom(...ZONES),
        (meatDays, eggsDays, food, dosedAt, quarterHours, zone) => {
          const plugins: PluginLookup = (id) =>
            id === 'prop-label'
              ? {
                  pluginId: 'prop-label',
                  displayName: 'Prop Label',
                  activeIngredients: [{ name: 'propazole' }],
                  labelUses: [
                    { speciesId: 'chicken', class: 'all', withdrawal: { meatDays, eggsDays } }
                  ]
                }
              : undefined;
          const t = treat({ productPluginId: 'prop-label', administeredAtMs: dosedAt });
          const days = food === 'meat' ? meatDays : eggsDays;
          const atMs = dosedAt + quarterHours * 15 * 60_000;
          const exact = dosedAt + days * DAY;
          const exactIsMidnight = ymdInZone(exact - 1, zone) !== ymdInZone(exact, zone);
          const blocked =
            atMs < exact || (!exactIsMidnight && ymdInZone(atMs, zone) === ymdInZone(exact, zone));
          for (const use of ['food', 'sale'] as const) {
            const v = evaluateFoodUse({
              subject: { type: 'animal', id: 'hen1', memberships: [] },
              food,
              use,
              atMs,
              treatments: [t],
              plugins,
              timeZone: zone
            });
            expect(v.status).toBe(blocked ? 'block' : 'safe');
          }
        }
      ),
      { numRuns: 300 }
    );
  });

  it('adding text to a treatment never removes a prohibited match (C-13)', () => {
    const pool = [
      'Enrofloxacin in the water',
      'Baytril',
      'Metronidazole 500 mg',
      'metronidazole',
      'Chloramphenicol',
      'Poultry tonic',
      'Vitamin drench',
      'Penicillin G',
      'Phenylbutazone',
      'Nitrofurazone',
      'Ceftiofur',
      'testazole',
      ''
    ];
    const textArb = fc.constantFrom(...pool);
    fc.assert(
      fc.property(
        fc.option(textArb, { nil: null }),
        fc.array(textArb, { maxLength: 3 }),
        fc.array(textArb, { minLength: 1, maxLength: 3 }),
        fc.constantFrom('chicken', 'cattle', 'goat', 'sheep'),
        fc.constantFrom(null, 'female', 'male'),
        fc.constantFrom(null, 'test-dewormer', 'test-enro'),
        (productName, texts, extra, speciesId, sex, pluginId) => {
          const base = treat({
            productName,
            productTexts: texts,
            speciesId,
            subjectSex: sex,
            productPluginId: pluginId,
            kind: 'treatment'
          });
          const more = { ...base, productTexts: [...texts, ...extra] };
          const a = computeWithdrawalClear(base, lookup, { timeZone: TZ });
          const b = computeWithdrawalClear(more, lookup, { timeZone: TZ });
          for (const food of FOODS) {
            const before = a.foods[food];
            if (before.status !== 'prohibited') continue;
            const after = b.foods[food];
            expect(after.status).toBe('prohibited');
            if (after.status === 'prohibited') {
              for (const cfr of before.cfr) expect(after.cfr).toContain(cfr);
            }
          }
        }
      ),
      { numRuns: 300 }
    );
    // 300 fast-check runs: about 0.5 s alone, past 2.5 s in a loaded full run.
  }, 30_000);
});
