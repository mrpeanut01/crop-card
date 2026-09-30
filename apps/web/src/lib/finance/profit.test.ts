import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  NOT_TIED_LABEL,
  STOCK_LOST_LABEL,
  resolveEnterprise,
  seasonProfit,
  type ProfitLedgerRow,
  type SeasonProfitInput,
  type StockUseRow
} from './profit';

const plantingPlugin = { p1: 'tomato', p2: 'tomato', p3: 'lettuce' };
const labels = {
  crop: { tomato: 'Tomatoes', lettuce: 'Lettuce' },
  group: { g1: 'Laying hens' },
  animal: { a1: 'Daisy' },
  area: { f1: 'North garden' }
};
const base: Omit<SeasonProfitInput, 'entries' | 'stockUses' | 'timeRows'> = {
  labourRateCentsPerHour: null,
  plantingPlugin,
  labels,
  animalGroups: { a2: [{ groupId: 'g1', fromMs: 1000, toMs: 5000 }] }
};

function entry(p: Partial<ProfitLedgerRow>): ProfitLedgerRow {
  return {
    id: Math.random().toString(36),
    kind: 'expense',
    occurredAt: 2000,
    amountCents: 100,
    ...p
  };
}

describe('resolveEnterprise (F2-6)', () => {
  it('groups every planting of one crop plugin together', () => {
    expect(resolveEnterprise({ cropId: 'p1' }, 0, base)?.key).toBe('crop:tomato');
    expect(resolveEnterprise({ cropId: 'p2' }, 0, base)).toEqual({
      key: 'crop:tomato',
      kind: 'crop',
      label: 'Tomatoes'
    });
  });

  it('puts an animal in the group it was in on that date, else itself', () => {
    expect(resolveEnterprise({ animalId: 'a2' }, 2000, base)?.key).toBe('group:g1');
    expect(resolveEnterprise({ animalId: 'a2' }, 6000, base)?.key).toBe('animal:a2');
    expect(resolveEnterprise({ animalId: 'a1' }, 2000, base)?.label).toBe('Daisy');
  });

  it('uses the tag only without a crop or animal link, case and space folded', () => {
    expect(resolveEnterprise({ enterprise: '  Farm  Stand ' }, 0, base)).toEqual({
      key: 'tag:farm stand',
      kind: 'tag',
      label: 'Farm Stand'
    });
    expect(resolveEnterprise({ cropId: 'p3', enterprise: 'x' }, 0, base)?.key).toBe('crop:lettuce');
    expect(resolveEnterprise({ fieldId: 'f1', enterprise: 'x' }, 0, base)?.key).toBe('tag:x');
  });

  it('falls back to the Area, then to nothing', () => {
    expect(resolveEnterprise({ fieldId: 'f1' }, 0, base)?.label).toBe('North garden');
    expect(resolveEnterprise({}, 0, base)).toBeNull();
    expect(resolveEnterprise(null, 0, base)).toBeNull();
    expect(resolveEnterprise({ cropId: 'gone' }, 0, base)).toBeNull();
  });
});

describe('seasonProfit', () => {
  it('never counts a linked lot purchase as an enterprise cost', () => {
    const out = seasonProfit({
      ...base,
      entries: [entry({ amountCents: 5000, stockLotId: 'lot1', cropId: 'p1' })],
      stockUses: [{ occurredAt: 2000, units: 2, unitCostCents: 500, link: { cropId: 'p1' } }],
      timeRows: []
    });
    expect(out.cash).toEqual({ incomeCents: 0, expenseCents: 5000, netCents: -5000 });
    expect(out.lotPurchaseCents).toBe(5000);
    const tomatoes = out.enterprises.find((e) => e.key === 'crop:tomato')!;
    expect(tomatoes.directExpenseCents).toBe(0);
    expect(tomatoes.inputCostCents).toBe(1000);
    expect(tomatoes.netCents).toBe(-1000);
  });

  it('counts a use with no lot cost as unknown, never zero', () => {
    const out = seasonProfit({
      ...base,
      entries: [],
      stockUses: [
        { occurredAt: 2000, units: 3, unitCostCents: null, link: { cropId: 'p3' } },
        { occurredAt: 2000, units: 1, unitCostCents: 250, link: { cropId: 'p3' } }
      ],
      timeRows: []
    });
    const lettuce = out.enterprises[0];
    expect(lettuce.inputCostUnknownCount).toBe(1);
    expect(lettuce.inputCostCents).toBe(250);
  });

  it('keeps lost stock on its own farm line and flags Area-level inputs', () => {
    const out = seasonProfit({
      ...base,
      entries: [],
      stockUses: [
        { occurredAt: 2000, units: 1, unitCostCents: 100, link: null, lost: true },
        {
          occurredAt: 2000,
          units: 1,
          unitCostCents: 300,
          link: { fieldId: 'f1' },
          notTiedToPlanting: true
        }
      ],
      timeRows: []
    });
    expect(out.enterprises.map((e) => e.label)).toEqual(['North garden', STOCK_LOST_LABEL]);
    expect(out.enterprises[0].includesAreaInputs).toBe(true);
  });

  it('costs labour at the one rate, and never for animals', () => {
    const out = seasonProfit({
      ...base,
      labourRateCentsPerHour: 1500,
      entries: [
        entry({ kind: 'income', amountCents: 9000, cropId: 'p1' }),
        entry({ animalGroupId: 'g1' })
      ],
      stockUses: [],
      timeRows: [
        { minutes: 90, cropId: 'p1' },
        { minutes: 30, cropId: null }
      ]
    });
    const tomatoes = out.enterprises.find((e) => e.kind === 'crop')!;
    expect(tomatoes.labourMinutes).toBe(90);
    expect(tomatoes.labourCents).toBe(2250);
    expect(tomatoes.netAfterLabourCents).toBe(9000 - 2250);
    const hens = out.enterprises.find((e) => e.kind === 'group')!;
    expect(hens.labourNotCounted).toBe(true);
    expect(hens.labourCents).toBeNull();
    expect(out.unallocated.labourMinutes).toBe(30);
    expect(out.unallocated.labourCents).toBe(750);
  });

  it('shows no labour cost without a rate', () => {
    const out = seasonProfit({
      ...base,
      entries: [],
      stockUses: [],
      timeRows: [{ minutes: 60, cropId: 'p1' }]
    });
    expect(out.enterprises[0].labourMinutes).toBe(60);
    expect(out.enterprises[0].labourCents).toBeNull();
    expect(out.enterprises[0].netAfterLabourCents).toBeNull();
  });

  it('skips deleted entries', () => {
    const out = seasonProfit({
      ...base,
      entries: [entry({ amountCents: 700, deletedAt: 5 })],
      stockUses: [],
      timeRows: []
    });
    expect(out.cash.expenseCents).toBe(0);
    expect(out.enterprises).toEqual([]);
  });

  it('labels money tied to nothing', () => {
    expect(NOT_TIED_LABEL).toBe('Not tied to anything');
  });
});

const idArb = fc.constantFrom('p1', 'p2', 'p3', 'gone', null);
const linkArb = fc.record({
  cropId: idArb,
  fieldId: fc.constantFrom('f1', 'f2', null),
  animalId: fc.constantFrom('a1', 'a2', null),
  animalGroupId: fc.constantFrom('g1', null),
  enterprise: fc.constantFrom('Farm stand', ' farm STAND', '', null)
});
const entryArb: fc.Arbitrary<ProfitLedgerRow> = fc
  .tuple(
    fc.constantFrom('expense' as const, 'income' as const),
    fc.integer({ min: 1, max: 1_000_000_000 }),
    fc.integer({ min: 0, max: 10_000 }),
    fc.option(fc.constantFrom('lot1', 'lot2'), { nil: null }),
    fc.option(fc.constant(1), { nil: null }),
    linkArb,
    fc.uuid()
  )
  .map(([kind, amountCents, occurredAt, stockLotId, deletedAt, link, id]) => ({
    id,
    kind,
    amountCents,
    occurredAt,
    stockLotId: kind === 'expense' ? stockLotId : null,
    deletedAt,
    ...link
  }));
const useArb: fc.Arbitrary<StockUseRow> = fc.record({
  occurredAt: fc.integer({ min: 0, max: 10_000 }),
  units: fc.double({ min: 0.01, max: 1000, noNaN: true }),
  unitCostCents: fc.option(fc.double({ min: 0, max: 10_000, noNaN: true }), { nil: null }),
  link: fc.option(linkArb, { nil: null }),
  lost: fc.boolean(),
  notTiedToPlanting: fc.boolean()
});
const timeArb = fc.record({
  minutes: fc.integer({ min: 1, max: 720 }),
  cropId: idArb
});

describe('seasonProfit properties (F2-12)', () => {
  const inputArb = fc.record({
    entries: fc.array(entryArb, { maxLength: 30 }),
    stockUses: fc.array(useArb, { maxLength: 30 }),
    timeRows: fc.array(timeArb, { maxLength: 10 }),
    labourRateCentsPerHour: fc.option(fc.integer({ min: 1, max: 100_000 }), { nil: null })
  });

  it('cash reconciles with the entries, and derived cost never enters cash', () => {
    fc.assert(
      fc.property(inputArb, (partial) => {
        const out = seasonProfit({ ...base, ...partial });
        const live = partial.entries.filter((e) => !e.deletedAt);
        const income = live
          .filter((e) => e.kind === 'income')
          .reduce((s, e) => s + e.amountCents, 0);
        const expense = live
          .filter((e) => e.kind === 'expense')
          .reduce((s, e) => s + e.amountCents, 0);
        expect(out.cash).toEqual({
          incomeCents: income,
          expenseCents: expense,
          netCents: income - expense
        });

        const entIncome = out.enterprises.reduce((s, e) => s + e.incomeCents, 0);
        expect(entIncome + out.unallocated.incomeCents).toBe(out.cash.incomeCents);
        const entDirect = out.enterprises.reduce((s, e) => s + e.directExpenseCents, 0);
        expect(entDirect + out.unallocated.directExpenseCents + out.lotPurchaseCents).toBe(
          out.cash.expenseCents
        );
      })
    );
  });

  it('a lot purchase is never counted twice', () => {
    fc.assert(
      fc.property(inputArb, (partial) => {
        const out = seasonProfit({ ...base, ...partial });
        const linked = partial.entries
          .filter((e) => !e.deletedAt && e.kind === 'expense' && e.stockLotId)
          .reduce((s, e) => s + e.amountCents, 0);
        expect(out.lotPurchaseCents).toBe(linked);
        const withoutLinked = seasonProfit({
          ...base,
          ...partial,
          entries: partial.entries.filter((e) => !(e.kind === 'expense' && e.stockLotId))
        });
        expect(out.enterprises.map((e) => [e.key, e.directExpenseCents])).toEqual(
          withoutLinked.enterprises.map((e) => [e.key, e.directExpenseCents])
        );
      })
    );
  });

  it('an unknown cost is never counted as zero', () => {
    fc.assert(
      fc.property(inputArb, (partial) => {
        const out = seasonProfit({ ...base, ...partial });
        const unknown = partial.stockUses.filter((u) => u.unitCostCents === null).length;
        const counted =
          out.enterprises.reduce((s, e) => s + e.inputCostUnknownCount, 0) +
          out.unallocated.inputCostUnknownCount;
        expect(counted).toBe(unknown);
        const known = partial.stockUses
          .filter((u) => u.unitCostCents !== null)
          .reduce((s, u) => s + Math.round(u.units * u.unitCostCents!), 0);
        const summed =
          out.enterprises.reduce((s, e) => s + e.inputCostCents, 0) +
          out.unallocated.inputCostCents;
        expect(summed).toBe(known);
      })
    );
  });

  it('labour minutes are all accounted for and are never cash', () => {
    fc.assert(
      fc.property(inputArb, (partial) => {
        const out = seasonProfit({ ...base, ...partial });
        const minutes = partial.timeRows.reduce((s, t) => s + t.minutes, 0);
        const counted =
          out.enterprises.reduce((s, e) => s + e.labourMinutes, 0) + out.unallocated.labourMinutes;
        expect(counted).toBe(minutes);
        const noLabour = seasonProfit({ ...base, ...partial, timeRows: [] });
        expect(noLabour.cash).toEqual(out.cash);
      })
    );
  });
});
