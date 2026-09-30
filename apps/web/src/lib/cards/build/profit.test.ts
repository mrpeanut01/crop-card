import { describe, expect, it } from 'vitest';
import { seasonProfit } from '$lib/finance/profit';
import { RECORD_ONLY_CARD_KINDS, parseCardKey } from '../model';
import { buildProfitCard } from './profit';

const profit = seasonProfit({
  entries: [
    { id: 'a', kind: 'income', occurredAt: 1, amountCents: 50000, cropId: 'p1' },
    { id: 'b', kind: 'expense', occurredAt: 1, amountCents: 1250, cropId: 'p1' },
    { id: 'c', kind: 'expense', occurredAt: 1, amountCents: 999, enterprise: 'Farm stand' },
    { id: 'd', kind: 'expense', occurredAt: 1, amountCents: 4000, stockLotId: 'l1' },
    { id: 'e', kind: 'income', occurredAt: 1, amountCents: 100 }
  ],
  stockUses: [
    { occurredAt: 1, units: 1, unitCostCents: null, link: { cropId: 'p1' } },
    { occurredAt: 1, units: 2, unitCostCents: 300, link: { cropId: 'p1' } }
  ],
  timeRows: [{ minutes: 150, cropId: 'p1' }],
  labourRateCentsPerHour: 1500,
  plantingPlugin: { p1: 'tomato' },
  labels: { crop: { tomato: 'Tomatoes' } }
});

describe('buildProfitCard (F2-18)', () => {
  const card = buildProfitCard(2026, profit, { asOf: 5, farmName: 'Hill Farm' });

  it('is a record-only profit card keyed by year', () => {
    expect(card.kind).toBe('profit');
    expect(card.key).toBe('pf_2026');
    expect(parseCardKey(card.key)).toEqual({ kind: 'profit', id: '2026' });
    expect(RECORD_ONLY_CARD_KINDS).toContain('profit');
    expect(card.href).toBe('/finance/profit/2026');
  });

  it('shows cash totals and one block per enterprise', () => {
    expect(card.facts.slice(0, 3).map((f) => f.value)).toEqual(['$501.00', '$62.49', '$438.51']);
    const tomatoes = card.sections.find((s) => s.title === 'Tomatoes')!;
    expect(tomatoes.items).toContain('Inputs used: $6.00, plus 1 use with unknown cost');
    expect(tomatoes.items).toContain('Net, not counting 1 use with unknown cost: $481.50');
    expect(tomatoes.items).toContain(
      'Labour: 2.5 h, $37.50. Labour, an estimate at $15.00 an hour'
    );
    expect(card.sections.map((s) => s.title)).toContain('Farm stand');
    expect(card.sections.map((s) => s.title)).toContain('Not tied to anything');
  });

  it('never reads an unknown cost as $0 or a missing rate as $0', () => {
    const noRate = buildProfitCard(2026, { ...profit, labourRateCentsPerHour: null }, { asOf: 5 });
    expect(noRate.facts.find((f) => f.label === 'Labour rate')?.value).toBe('Labour rate not set');
    const text = JSON.stringify(
      buildProfitCard(
        2026,
        seasonProfit({
          entries: [],
          stockUses: [{ occurredAt: 1, units: 1, unitCostCents: null, link: { cropId: 'p1' } }],
          timeRows: [],
          labourRateCentsPerHour: null,
          plantingPlugin: { p1: 'tomato' }
        }),
        { asOf: 5 }
      )
    );
    expect(text).toContain('Cost unknown (1 use)');
    expect(text).not.toContain('Inputs used: $0.00');
  });
});
