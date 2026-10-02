import { describe, expect, it } from 'vitest';
import {
  TREATMENT_LOG_HEADER,
  toTreatmentLogRow,
  treatmentLogCsv,
  withdrawalCell,
  withdrawalText,
  type TreatmentLogInput
} from './animalTreatmentLog';
import { PACK_PREAMBLE } from './packCsv';

const fmt = { date: (ms: number) => `D${ms}`, clearDate: (ms: number) => `C${ms}` };

function input(over: Partial<TreatmentLogInput> = {}): TreatmentLogInput {
  return {
    administeredAt: 1000,
    courseEndAt: null,
    subject: 'Henrietta',
    species: 'Chicken',
    product: 'Wormer X',
    approvalNumber: null,
    lot: null,
    dose: 2,
    doseUnit: 'mL',
    route: 'oral',
    givenBy: 'owner@test.local',
    vet: null,
    labelUse: 'label',
    foods: ['meat', 'eggs'],
    holds: {
      meat: { status: 'until', clearsAtMs: 5000, exactClearsAtMs: 4999, source: 'label' },
      milk: { status: 'none' },
      eggs: { status: 'unknown', why: 'no-label-data' as never, labelPathOpen: true }
    },
    hasVetEntry: false,
    state: 'live',
    enteredLate: null,
    organicOutcome: null,
    ...over
  };
}

describe('withdrawalCell', () => {
  it('names the date and where it came from', () => {
    expect(
      withdrawalCell(
        'meat',
        { status: 'until', clearsAtMs: 9, exactClearsAtMs: 9, source: 'label' },
        fmt.clearDate,
        false
      )
    ).toEqual({ food: 'meat', clearOn: 'C9', source: 'Product label in the library' });
    expect(
      withdrawalCell(
        'milk',
        { status: 'until', clearsAtMs: 9, exactClearsAtMs: 9, source: 'entry' },
        fmt.clearDate,
        true
      ).source
    ).toBe('Vet or owner entry');
    expect(
      withdrawalCell(
        'milk',
        { status: 'until', clearsAtMs: 9, exactClearsAtMs: 9, source: 'stored' },
        fmt.clearDate,
        false
      ).source
    ).toBe('Saved with the record');
  });

  it('never gives a date when the withdrawal is not known or the drug is banned', () => {
    expect(
      withdrawalCell(
        'eggs',
        { status: 'unknown', why: 'no-label-data' as never, labelPathOpen: true },
        fmt.clearDate,
        false
      )
    ).toEqual({ food: 'eggs', clearOn: null, source: 'Withdrawal not known' });
    const banned = withdrawalCell(
      'meat',
      { status: 'prohibited', cfr: ['21 CFR 530.41(a)(1)'], drugs: ['x'] },
      fmt.clearDate,
      false
    );
    expect(banned.clearOn).toBeNull();
    expect(banned.source).toContain('Never for food');
  });
});

describe('toTreatmentLogRow', () => {
  it('shows only the foods the subject gives, in kernel order', () => {
    const row = toTreatmentLogRow(input(), fmt);
    expect(row.withdrawal.map((w) => w.food)).toEqual(['meat', 'eggs']);
    expect(row.dose).toBe('2 mL');
    expect(row.route).toBe('By mouth');
    expect(row.labelUse).toBe('As the label says');
    expect(row.date).toBe('D1000');
  });

  it('shows no withdrawal for a void', () => {
    const row = toTreatmentLogRow(input({ holds: null, state: 'voided' }), fmt);
    expect(row.withdrawal).toEqual([]);
    expect(withdrawalText(row)).toBe('');
  });

  it('keeps a pet with no foods free of withdrawal columns', () => {
    expect(toTreatmentLogRow(input({ foods: [] }), fmt).withdrawal).toEqual([]);
  });
});

describe('treatmentLogCsv', () => {
  const rows = [
    toTreatmentLogRow(input(), fmt),
    toTreatmentLogRow(input({ subject: 'Flock, "north"', state: 'deleted-still-given' }), fmt)
  ];

  it('B-44: the standalone log is one header row then one row per dose', () => {
    const lines = treatmentLogCsv(rows, { preamble: false }).trimEnd().split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines[0].split(',')).toEqual([...TREATMENT_LOG_HEADER]);
    expect(lines[2]).toContain('"Flock, ""north"""');
    expect(lines[2]).toContain('Deleted, still counted as given');
    expect(lines.join('\n')).not.toContain('not a certification');
  });

  it('B-44: the pack copy starts with the preamble row', () => {
    const lines = treatmentLogCsv(rows, { preamble: true }).trimEnd().split('\r\n');
    expect(lines[0]).toBe(PACK_PREAMBLE);
    expect(lines[1].split(',')[0]).toBe('Date given');
    expect(lines).toHaveLength(4);
  });

  it('fills the withdrawal columns per food and leaves milk blank for a hen', () => {
    const [, row] = treatmentLogCsv(rows.slice(0, 1), { preamble: false }).trimEnd().split('\r\n');
    const cells = row.split(',');
    const header = [...TREATMENT_LOG_HEADER];
    expect(cells[header.indexOf('Meat withdrawal ends')]).toBe('C5000');
    expect(cells[header.indexOf('Milk withdrawal ends')]).toBe('');
    expect(cells[header.indexOf('Eggs withdrawal source')]).toBe('Withdrawal not known');
  });

  it('defuses spreadsheet formulas', () => {
    const csv = treatmentLogCsv([toTreatmentLogRow(input({ product: '=HYPERLINK(1)' }), fmt)], {
      preamble: false
    });
    expect(csv).toContain("'=HYPERLINK(1)");
  });
});
