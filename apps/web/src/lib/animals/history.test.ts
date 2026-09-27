import { describe, expect, it } from 'vitest';
import { buildHistory, type HistoryLocation, type HistoryStatus } from './history';

const loc = (
  id: string,
  fromMs: number,
  extra: Partial<HistoryLocation> = {}
): HistoryLocation => ({
  id,
  fieldId: 'f1',
  fromMs,
  toMs: null,
  fromGroupId: null,
  toGroupId: null,
  ...extra
});

const st = (id: string, at: number, extra: Partial<HistoryStatus> = {}): HistoryStatus => ({
  id,
  status: 'died',
  occurredAt: at,
  reason: null,
  headCountDelta: null,
  locked: false,
  ...extra
});

const base = {
  areaName: (id: string) => (id === 'f1' ? 'Hen house' : 'Pasture'),
  groupName: (id: string) => (id === 'g1' ? 'Layers' : 'Broody hens'),
  canUndo: true
};

describe('buildHistory', () => {
  it('lists moves, status and flag changes newest first', () => {
    const out = buildHistory({
      ...base,
      locations: [loc('a', 100, { toMs: 200 }), loc('b', 200, { fieldId: 'f2' })],
      statusEvents: [st('s', 300, { reason: 'Fox' })],
      flagChanges: [
        { id: 'fl', flag: 'food_producing', newValue: false, reason: 'Pet', changedAt: 150 }
      ]
    });
    expect(out.map((e) => e.text)).toEqual([
      'Died',
      'Moved to Pasture',
      'Marked as not a food animal',
      'Moved to Hen house'
    ]);
    expect(out[0].detail).toBe('Fox');
  });

  it('offers undo only to owners, on the latest plain move and latest unlocked change', () => {
    const input = {
      ...base,
      locations: [loc('a', 100, { toMs: 200 }), loc('b', 200)],
      statusEvents: [st('s1', 50), st('s2', 60)]
    };
    const out = buildHistory(input);
    const undo = Object.fromEntries(out.map((e) => [e.id, e.undo]));
    expect(undo['loc:b']).toBe('/api/animals/locations/b');
    expect(undo['loc:a']).toBeNull();
    expect(undo['st:s2']).toBe('/api/animals/status/s2');
    expect(undo['st:s1']).toBeNull();
    expect(buildHistory({ ...input, canUndo: false }).every((e) => e.undo === null)).toBe(true);
  });

  it('never offers undo on a locked change or a group change', () => {
    const out = buildHistory({
      ...base,
      locations: [loc('m', 100, { toMs: 100, toGroupId: 'g1' })],
      statusEvents: [st('s', 50, { locked: true })]
    });
    expect(out.find((e) => e.id === 'loc:m')).toMatchObject({ text: 'Joined Layers', undo: null });
    expect(out.find((e) => e.id === 'st:s')).toMatchObject({ locked: true, undo: null });
  });

  it('words group counts as numbers left or added', () => {
    const out = buildHistory({
      ...base,
      locations: [loc('split', 10, { fromGroupId: 'g1' })],
      statusEvents: [
        st('a', 20, { status: 'active', headCountDelta: 6 }),
        st('b', 30, { status: 'sold', headCountDelta: -2 })
      ]
    });
    expect(out.map((e) => e.text)).toEqual([
      '2 sold',
      '6 added',
      'Moved to Hen house, out of Layers'
    ]);
    expect(out.find((e) => e.id === 'loc:split')?.undo).toBeNull();
  });
});
