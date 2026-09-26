import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import { eq } from 'drizzle-orm';
import { db } from './client';
import { clientRecordReceipts } from './schema';
import { runWithTenant, withTenant } from './tenant';
import {
  STALE_CLAIM_MS,
  claimClientRecord,
  completeClientRecord,
  releaseClientRecord
} from './clientRecords';

const hooks = vi.hoisted(() => ({ beforeUpdate: null as null | (() => void) }));

vi.mock('./client', async (importOriginal) => {
  const real = await importOriginal<typeof import('./client')>();
  const db = new Proxy(real.db, {
    get(target, prop) {
      if (prop === 'update' && hooks.beforeUpdate) {
        const run = hooks.beforeUpdate;
        hooks.beforeUpdate = null;
        run();
      }
      return Reflect.get(target, prop);
    }
  });
  return { ...real, db };
});

const ENDPOINT = '/api/spray/record';
const T0 = 1_700_000_000_000;

function newOwner(): string {
  return `client-records-${randomUUID()}`;
}

function receipt(ownerId: string, clientRecordId: string) {
  return runWithTenant(ownerId, () =>
    db
      .select()
      .from(clientRecordReceipts)
      .where(
        withTenant(clientRecordReceipts, eq(clientRecordReceipts.clientRecordId, clientRecordId))
      )
      .get()
  );
}

afterEach(() => {
  hooks.beforeUpdate = null;
});

describe('claimClientRecord', () => {
  it('claims a fresh id and stores a pending receipt for the active Owner', () => {
    const owner = newOwner();
    const id = randomUUID();
    expect(runWithTenant(owner, () => claimClientRecord(id, ENDPOINT, T0))).toBe('claimed');
    expect(receipt(owner, id)).toMatchObject({
      ownerId: owner,
      clientRecordId: id,
      endpoint: ENDPOINT,
      status: 'pending',
      updatedAt: new Date(T0)
    });
  });

  it('answers done after completion, however much later the repeat arrives', () => {
    const owner = newOwner();
    const id = randomUUID();
    runWithTenant(owner, () => {
      claimClientRecord(id, ENDPOINT, T0);
      completeClientRecord(id, T0 + 5);
      expect(claimClientRecord(id, ENDPOINT, T0 + 10)).toBe('done');
      expect(claimClientRecord(id, ENDPOINT, T0 + 10 * STALE_CLAIM_MS)).toBe('done');
    });
    expect(receipt(owner, id)?.status).toBe('done');
  });

  it('answers pending while a fresh claim is held', () => {
    const owner = newOwner();
    const id = randomUUID();
    runWithTenant(owner, () => {
      expect(claimClientRecord(id, ENDPOINT, T0)).toBe('claimed');
      expect(claimClientRecord(id, ENDPOINT, T0)).toBe('pending');
      expect(claimClientRecord(id, ENDPOINT, T0 + STALE_CLAIM_MS - 1)).toBe('pending');
    });
    expect(receipt(owner, id)?.updatedAt).toEqual(new Date(T0));
  });

  it('lets a stale claim be retaken once, bumping updated_at', () => {
    const owner = newOwner();
    const id = randomUUID();
    const later = T0 + STALE_CLAIM_MS;
    runWithTenant(owner, () => {
      claimClientRecord(id, ENDPOINT, T0);
      expect(claimClientRecord(id, ENDPOINT, later)).toBe('claimed');
      expect(claimClientRecord(id, ENDPOINT, later)).toBe('pending');
      expect(claimClientRecord(id, ENDPOINT, later + 1_000)).toBe('pending');
    });
    expect(receipt(owner, id)).toMatchObject({ status: 'pending', updatedAt: new Date(later) });
  });

  it('two retakers that both read the same stale row cannot both win', () => {
    const owner = newOwner();
    const id = randomUUID();
    const later = T0 + 2 * STALE_CLAIM_MS;
    runWithTenant(owner, () => claimClientRecord(id, ENDPOINT, T0));

    let rival: string | undefined;
    hooks.beforeUpdate = () => {
      rival = claimClientRecord(id, ENDPOINT, later + 1);
    };

    const first = runWithTenant(owner, () => claimClientRecord(id, ENDPOINT, later));
    expect(rival).toBe('claimed');
    expect(first).toBe('pending');
    expect(receipt(owner, id)?.updatedAt).toEqual(new Date(later + 1));
  });

  it('release frees the id so a retry can claim it', () => {
    const owner = newOwner();
    const id = randomUUID();
    runWithTenant(owner, () => {
      claimClientRecord(id, ENDPOINT, T0);
      releaseClientRecord(id);
      expect(claimClientRecord(id, ENDPOINT, T0 + 1)).toBe('claimed');
    });
  });

  it('keeps the same client id independent per Owner', () => {
    const a = newOwner();
    const b = newOwner();
    const id = randomUUID();
    runWithTenant(a, () => {
      claimClientRecord(id, ENDPOINT, T0);
      completeClientRecord(id, T0);
    });
    expect(runWithTenant(b, () => claimClientRecord(id, ENDPOINT, T0))).toBe('claimed');
    runWithTenant(b, () => releaseClientRecord(id));
    expect(receipt(a, id)?.status).toBe('done');
    expect(receipt(b, id)).toBeUndefined();
    runWithTenant(b, () => completeClientRecord(id, T0));
    expect(receipt(b, id)).toBeUndefined();
    expect(runWithTenant(a, () => claimClientRecord(id, ENDPOINT, T0))).toBe('done');
  });

  it('property: any interleaving of repeats yields at most one done receipt and never re-claims after done', () => {
    type Step = { kind: 'claim' | 'complete' | 'release'; dt: number };
    const step = fc.record({
      kind: fc.constantFrom<'claim' | 'complete' | 'release'>('claim', 'complete', 'release'),
      dt: fc.integer({ min: 0, max: 2 * STALE_CLAIM_MS })
    });
    fc.assert(
      fc.property(fc.array(step, { minLength: 1, maxLength: 25 }), (steps: Step[]) => {
        const owner = newOwner();
        const id = randomUUID();
        let now = T0;
        let completed = false;
        runWithTenant(owner, () => {
          for (const s of steps) {
            now += s.dt;
            if (s.kind === 'claim') {
              const result = claimClientRecord(id, ENDPOINT, now);
              if (completed) expect(result).toBe('done');
            } else if (s.kind === 'complete') {
              const had = receipt(owner, id);
              completeClientRecord(id, now);
              if (had) completed = true;
            } else if (!completed) {
              releaseClientRecord(id);
            }
          }
        });
      }),
      { numRuns: 60 }
    );
  });
});
