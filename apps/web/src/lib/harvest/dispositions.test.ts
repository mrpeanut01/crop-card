import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  HARVEST_DISPOSITION_KINDS,
  dispositionCreateSchema,
  dispositionPatchSchema,
  toHundredths
} from './apiSchemas';
import { HARVEST_DISPOSITION_KINDS as DB_KINDS } from '$lib/db/schema';
import {
  dispositionDateProblem,
  dispositionLine,
  harvestDayStartMs,
  overQuantityNotice
} from './dispositions';

const NY = 'America/New_York';

describe('disposition schemas (B-27)', () => {
  it('match the table enum', () => {
    expect([...HARVEST_DISPOSITION_KINDS]).toEqual([...DB_KINDS]);
  });

  it('round quantities to hundredths, half up', () => {
    expect(toHundredths(1.005)).toBe(101);
    expect(toHundredths(2.004)).toBe(200);
    expect(toHundredths(0.015)).toBe(2);
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1_000_000_000 }), (h) => {
        expect(toHundredths(h / 100)).toBe(h);
      })
    );
  });

  it('accepts the plan fields and refuses the rest', () => {
    const ok = (v: unknown) => dispositionCreateSchema.safeParse(v).success;
    expect(
      ok({ kind: 'sold', quantity: 3, unit: 'lb', recipient: 'Ann', soldAsOrganic: true })
    ).toBe(true);
    expect(ok({ kind: 'donated', quantity: 3, unit: ' dozen ', recipient: 'Food bank' })).toBe(
      true
    );
    expect(ok({ kind: 'kept', quantity: 3, unit: 'lb', recipient: 'Ann' })).toBe(false);
    expect(ok({ kind: 'discarded', quantity: 3, unit: 'lb', soldAsOrganic: false })).toBe(false);
    expect(ok({ kind: 'sold', quantity: 0.004, unit: 'lb' })).toBe(false);
    expect(ok({ kind: 'sold', quantity: 10_000_001, unit: 'lb' })).toBe(false);
    expect(ok({ kind: 'sold', quantity: 10_000_000, unit: 'lb' })).toBe(true);
    expect(ok({ kind: 'sold', quantity: 1, unit: 'x'.repeat(21) })).toBe(false);
    expect(ok({ kind: 'sold', quantity: 1, unit: 'lb', recipient: 'x'.repeat(121) })).toBe(false);
    expect(ok({ kind: 'given', quantity: 1, unit: 'lb' })).toBe(false);
    expect(dispositionPatchSchema.safeParse({}).success).toBe(false);
    expect(dispositionPatchSchema.safeParse({ ledgerEntryId: null }).success).toBe(true);
  });
});

describe('dispositionDateProblem (B-28)', () => {
  const harvest = Date.UTC(2026, 6, 10, 22, 0);
  const dayStart = harvestDayStartMs(harvest, NY);

  it('starts at the harvest farm-local day', () => {
    expect(new Date(dayStart).toISOString()).toBe('2026-07-10T04:00:00.000Z');
    expect(dispositionDateProblem(dayStart, harvest, NY, harvest + 1)).toBeNull();
    expect(dispositionDateProblem(dayStart - 1, harvest, NY, harvest + 1)?.error).toBe(
      'BEFORE_HARVEST'
    );
  });

  it('allows five minutes of clock slack', () => {
    const now = harvest + 86_400_000;
    expect(dispositionDateProblem(now + 5 * 60_000, harvest, NY, now)).toBeNull();
    expect(dispositionDateProblem(now + 5 * 60_000 + 1, harvest, NY, now)?.error).toBe(
      'IN_THE_FUTURE'
    );
  });
});

describe('overQuantityNotice (B-33)', () => {
  it('compares only the same unit as a parsed harvest quantity', () => {
    expect(overQuantityNotice('40 lb', [{ quantity: 40, unit: 'lb' }], 'lb')).toBeNull();
    expect(overQuantityNotice('40 lb', [{ quantity: 40.01, unit: 'LB ' }], 'lb')).toBe(
      "Where it went adds up to more than this harvest's 40 lb."
    );
    expect(
      overQuantityNotice(
        '40 lb',
        [
          { quantity: 30, unit: 'lb' },
          { quantity: 30, unit: 'kg' }
        ],
        'kg'
      )
    ).toBeNull();
    expect(overQuantityNotice('a big basket', [{ quantity: 99, unit: 'lb' }], 'lb')).toBeNull();
    expect(overQuantityNotice(null, [{ quantity: 99, unit: 'lb' }], 'lb')).toBeNull();
    expect(overQuantityNotice('12', [{ quantity: 99, unit: 'lb' }], 'lb')).toBeNull();
  });
});

describe('dispositionLine', () => {
  it('reads as plain English', () => {
    expect(
      dispositionLine(
        { kind: 'sold', quantity: 4, unit: 'lb', recipient: 'Market', soldAsOrganic: true },
        'Jul 10, 2026'
      )
    ).toBe('Sold 4 lb to Market on Jul 10, 2026, sold as organic');
    expect(
      dispositionLine(
        { kind: 'discarded', quantity: 1.5, unit: 'bu', recipient: null, soldAsOrganic: null },
        'Jul 11, 2026'
      )
    ).toBe('Thrown out 1.50 bu on Jul 11, 2026');
  });
});

describe('the pending list names a queued disposition', () => {
  it('reads as plain English', async () => {
    const { KIND_LABEL, pendingSummary } = await import('$lib/animals/queueRecovery');
    expect(KIND_LABEL['harvest-disposition']).toBe('Where a harvest went');
    expect(
      pendingSummary('harvest-disposition', {
        harvestEventId: 'h1',
        kind: 'donated',
        quantity: 3,
        unit: 'dozen'
      })
    ).toBe('Given away, 3 dozen');
  });
});
