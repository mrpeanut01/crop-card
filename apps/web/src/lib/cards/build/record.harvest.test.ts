import { describe, expect, it } from 'vitest';
import { parseRecordCardKey } from '../model';
import { buildHarvestRecordCard } from './record';

const prefs = { timeZone: 'America/New_York', units: 'us' as const };
const NOW = Date.parse('2027-09-14T14:00:00Z');
const opts = { prefs, now: NOW };

describe('harvest record card (#749)', () => {
  const input = {
    rowId: 'hv-1',
    occurredAt: Date.parse('2027-07-09T14:00:00Z'),
    blockLabel: 'Orchard row 2',
    cropLabel: 'Redhaven peach',
    quantity: '1800 lb',
    lotNumber: 'PCH-27-1',
    moisturePct: null,
    plantingId: 'pl-9',
    locked: true
  };

  it('shows the harvest date, amount and lot, and links to the planting', () => {
    const card = buildHarvestRecordCard(input, opts);
    expect(card.kind).toBe('harvest');
    expect(parseRecordCardKey(card.key)).toEqual({ recordKind: 'harvest', rowId: 'hv-1' });
    expect(card.title).toBe('Redhaven peach');
    expect(card.facts.map((f) => [f.label, f.value])).toEqual([
      ['Harvested', 'Jul 9, 2027'],
      ['Quantity', '1800 lb'],
      ['Lot', 'PCH-27-1'],
      ['Block', 'Orchard row 2']
    ]);
    expect(card.links?.map((l) => l.href)).toEqual([
      '/records/harvest/hv-1',
      '/cards/planting/pl_pl-9'
    ]);
  });

  it('two picks of one planting print different cards', () => {
    const a = buildHarvestRecordCard(input, opts);
    const b = buildHarvestRecordCard(
      { ...input, rowId: 'hv-2', quantity: '600 lb', lotNumber: 'PCH-27-2' },
      opts
    );
    expect(a.facts).not.toEqual(b.facts);
  });

  it('says when no amount was recorded and has no planting link without a planting', () => {
    const card = buildHarvestRecordCard(
      { ...input, quantity: null, lotNumber: null, moisturePct: 13.5, plantingId: null },
      { ...opts, prefs: { ...prefs, locale: 'es' } }
    );
    expect(card.facts.map((f) => f.value)).toContain('No registrada');
    expect(card.facts.map((f) => f.value)).toContain('13.5%');
    expect(card.links).toHaveLength(1);
  });
});
