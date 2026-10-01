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

  it('offers the owner void on the latest status change only, even once locked (32G G4)', () => {
    const out = buildHistory({
      ...base,
      canVoid: true,
      locations: [],
      statusEvents: [
        st('old', 100, { voidableUntilMs: 9 }),
        st('new', 200, { locked: true, voidableUntilMs: 5000 })
      ]
    });
    const latest = out.find((e) => e.id === 'st:new');
    const older = out.find((e) => e.id === 'st:old');
    expect(latest).toMatchObject({
      voidUrl: '/api/animals/status/new/void',
      voidableUntilMs: 5000,
      undo: null
    });
    expect(older?.voidUrl).toBeUndefined();
    const helper = buildHistory({
      ...base,
      canUndo: false,
      locations: [],
      statusEvents: [st('new', 200, { voidableUntilMs: 5000 })]
    });
    expect(helper[0].voidUrl).toBeUndefined();
  });
});

describe('buildHistory meat inside a hold (G3-03)', () => {
  it('marks only the status changes the page loader marked', () => {
    const out = buildHistory({
      ...base,
      locations: [],
      statusEvents: [st('s1', 50, { status: 'sold-for-meat', inHold: true }), st('s2', 60)]
    });
    const marks = Object.fromEntries(out.map((e) => [e.id, e.inHold ?? false]));
    expect(marks).toEqual({ 'st:s1': true, 'st:s2': false });
  });
});

describe('buildHistory late marker (G2-01)', () => {
  const DAY = 86_400_000;
  it('shows "Saved N days after its date" on a status change saved late', () => {
    const out = buildHistory({
      ...base,
      locations: [],
      statusEvents: [
        st('late', 10 * DAY, { recordedLate: true, createdAt: 13 * DAY + 5 }),
        st('ontime', 20 * DAY, { recordedLate: false, createdAt: 20 * DAY + 60_000 })
      ]
    });
    const late = Object.fromEntries(out.map((e) => [e.id, e.late]));
    expect(late['st:late']).toBe('Saved 3 days after its date');
    expect(late['st:ontime']).toBeUndefined();
  });

  it('falls back to "Saved late" when the save time is unknown', () => {
    const out = buildHistory({
      ...base,
      locations: [],
      statusEvents: [st('x', 100, { recordedLate: true })]
    });
    expect(out[0].late).toBe('Saved late');
  });
});
