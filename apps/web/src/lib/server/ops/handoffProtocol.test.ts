import { describe, expect, it } from 'vitest';
import {
  STALE_MS,
  acquireDecision,
  frameAlign,
  parseLitestreamMetrics,
  restoreVerdict,
  shouldFence
} from '../../../../scripts/lib/handoffProtocol.mjs';

const NOW = 1_800_000_000_000;

describe('acquireDecision (booting container)', () => {
  it('proceeds when nobody has ever held the database', () => {
    expect(acquireDecision(null, NOW)).toEqual({ action: 'proceed', reason: 'no-holder' });
    expect(acquireDecision({} as never, NOW).reason).toBe('no-holder');
  });

  it('proceeds once the previous writer has released', () => {
    expect(acquireDecision({ nonce: 'a', state: 'released' }, NOW)).toEqual({
      action: 'proceed',
      reason: 'released'
    });
  });

  it('waits for a live writer', () => {
    expect(
      acquireDecision({ nonce: 'a', state: 'serving', heartbeatAt: NOW - 5_000 }, NOW)
    ).toEqual({ action: 'wait', reason: 'serving' });
    expect(
      acquireDecision({ nonce: 'a', state: 'serving', heartbeatAt: NOW - STALE_MS }, NOW).action
    ).toBe('wait');
  });

  it('proceeds past a writer that stopped heartbeating (crash, kill)', () => {
    expect(
      acquireDecision({ nonce: 'a', state: 'serving', heartbeatAt: NOW - STALE_MS - 1 }, NOW)
    ).toEqual({ action: 'proceed', reason: 'stale' });
    expect(acquireDecision({ nonce: 'a', state: 'serving' }, NOW).reason).toBe('stale');
  });
});

describe('shouldFence (serving app)', () => {
  it('fences only for a request from another container', () => {
    expect(shouldFence(null, 'me')).toBe(false);
    expect(shouldFence({ nonce: 'me' }, 'me')).toBe(false);
    expect(shouldFence({ nonce: 'them' }, 'me')).toBe(true);
    expect(shouldFence({ nonce: 5 } as never, 'me')).toBe(false);
  });
});

describe('restoreVerdict (fail closed)', () => {
  const base = {
    dbExists: true,
    replicaHasGenerations: true,
    initialized: true,
    owners: 3,
    migrations: 54,
    quickCheck: 'ok',
    allowEmpty: false
  };

  it('accepts a sane restore', () => {
    expect(restoreVerdict(base)).toMatchObject({ ok: true, fresh: false });
  });

  it('allows an empty database only for a replica that never had data', () => {
    const empty = { ...base, dbExists: false, owners: null, migrations: null, quickCheck: null };
    expect(
      restoreVerdict({ ...empty, replicaHasGenerations: false, initialized: false })
    ).toMatchObject({ ok: true, fresh: true });
    expect(restoreVerdict({ ...empty, replicaHasGenerations: true, initialized: false }).ok).toBe(
      false
    );
    expect(restoreVerdict({ ...empty, replicaHasGenerations: false, initialized: true }).ok).toBe(
      false
    );
  });

  it('honours the explicit override for disaster recovery', () => {
    const empty = { ...base, dbExists: false, owners: null, migrations: null, quickCheck: null };
    expect(restoreVerdict({ ...empty, allowEmpty: true })).toMatchObject({ ok: true, fresh: true });
    expect(restoreVerdict({ ...base, owners: 0, allowEmpty: true }).ok).toBe(true);
  });

  it('refuses a restored database with no owners, no migrations or corruption', () => {
    expect(restoreVerdict({ ...base, owners: 0 }).ok).toBe(false);
    expect(restoreVerdict({ ...base, migrations: 0 }).ok).toBe(false);
    expect(restoreVerdict({ ...base, quickCheck: 'row 3 missing from index' }).ok).toBe(false);
    expect(restoreVerdict({ ...base, quickCheck: 'bad', allowEmpty: true }).ok).toBe(false);
  });
});

describe('Litestream position helpers', () => {
  it('frame-aligns a WAL size like Litestream 0.3', () => {
    expect(frameAlign(0, 4096)).toBe(0);
    expect(frameAlign(31, 4096)).toBe(0);
    expect(frameAlign(32, 4096)).toBe(32);
    expect(frameAlign(32 + 4120, 4096)).toBe(32 + 4120);
    expect(frameAlign(32 + 4120 * 3 + 100, 4096)).toBe(32 + 4120 * 3);
  });

  it('reads one database’s replica position and sync count', () => {
    const text = [
      '# HELP litestream_replica_wal_index The current WAL index',
      'litestream_replica_wal_index{db="/data/marketplace.db",name="abs"} 9',
      'litestream_replica_wal_index{db="/data/cropcard.db",name="abs"} 2',
      'litestream_replica_wal_offset{db="/data/cropcard.db",name="abs"} 8272',
      'litestream_sync_count{db="/data/cropcard.db"} 140',
      'litestream_sync_count{db="/data/marketplace.db"} 7'
    ].join('\n');
    expect(parseLitestreamMetrics(text, '/data/cropcard.db')).toEqual({
      replicaIndex: 2,
      replicaOffset: 8272,
      syncCount: 140
    });
    expect(parseLitestreamMetrics('', '/data/cropcard.db')).toEqual({
      replicaIndex: null,
      replicaOffset: null,
      syncCount: null
    });
  });
});
