import { describe, expect, it } from 'vitest';
import { coveredMeatIds, coveredRecordsHref } from './animalRecords';

describe('coveredRecordsHref (G3-03, G3-09)', () => {
  it('opens the log page when a log is covered, else the animal or group page', () => {
    expect(coveredRecordsHref('animal', 'a 1', { logs: true })).toBe('/animals/a%201/log');
    expect(coveredRecordsHref('group', 'g1', { logs: true })).toBe('/animals/g1/log');
    expect(coveredRecordsHref('animal', 'a1', { logs: false })).toBe('/animals/a1');
    expect(coveredRecordsHref('group', 'g1', { logs: false })).toBe('/animals/groups/g1');
  });
});

describe('coveredMeatIds (G3-03)', () => {
  it('marks the status changes whose meat the ledger covers', () => {
    const ledger = new Set(['meat:s1', 'log:s2', 'meat:other']);
    expect([...coveredMeatIds([{ id: 's1' }, { id: 's2' }], ledger)]).toEqual(['s1']);
  });
});
