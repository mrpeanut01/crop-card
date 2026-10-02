import { describe, expect, it } from 'vitest';
import { pendingForWho, pendingSchedules, serverTemplateKeys } from './pendingSchedules';

const row = (rowId: string, key: string, scheduledFor: number, rejected = false) => ({
  rowId,
  title: `Task ${rowId}`,
  scheduledFor,
  pluginTemplateKey: key,
  rejected
});

describe('pendingSchedules (SO-07, SO-08)', () => {
  it('leaves out rejected rows and keys the server already holds', () => {
    const rows = [
      row('a', 'derived:x:1', 3),
      row('b', 'derived:x:2', 2, true),
      row('c', 'derived:x:3', 1)
    ];
    const out = pendingSchedules(rows, new Set(['derived:x:3']));
    expect(out.map((r) => r.rowId)).toEqual(['a']);
  });

  it('shows one card per suggestion, soonest first', () => {
    const rows = [row('a', 'k1', 5), row('b', 'k1', 4), row('c', 'k2', 1)];
    expect(pendingSchedules(rows, new Set()).map((r) => r.rowId)).toEqual(['c', 'a']);
  });

  it('a row the server just saved disappears without a doubled card', () => {
    const rows = [row('a', 'k1', 1)];
    const before = pendingSchedules(rows, serverTemplateKeys([]));
    const after = pendingSchedules(rows, serverTemplateKeys([{ pluginTemplateKey: 'k1' }]));
    expect(before).toHaveLength(1);
    expect(after).toHaveLength(0);
  });
});

describe('serverTemplateKeys', () => {
  it('collects task keys and the extra list, skipping empty keys', () => {
    const keys = serverTemplateKeys(
      [{ pluginTemplateKey: 'a' }, { pluginTemplateKey: null }, {}],
      ['b']
    );
    expect([...keys].sort()).toEqual(['a', 'b']);
  });
});

describe('pendingForWho', () => {
  it('shows under Everyone and counts as hidden under Mine', () => {
    const p = [row('a', 'k1', 1), row('b', 'k2', 2)];
    expect(pendingForWho(p, 'all')).toEqual({ shown: p, hiddenCount: 0 });
    expect(pendingForWho(p, 'mine')).toEqual({ shown: [], hiddenCount: 2 });
  });
});
