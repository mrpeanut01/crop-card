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

function claimToken(id: string, now: number): number {
  const result = claimClientRecord(id, ENDPOINT, now);
  if (result.status !== 'claimed') throw new Error(`expected a claim, got ${result.status}`);
  return result.token;
}

describe('claimClientRecord', () => {
  it('claims a fresh id and stores a pending receipt for the active Owner', () => {
    const owner = newOwner();
    const id = randomUUID();
    expect(runWithTenant(owner, () => claimClientRecord(id, ENDPOINT, T0))).toEqual({
      status: 'claimed',
      token: T0
    });
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
      const token = claimToken(id, T0);
      expect(completeClientRecord(id, token, T0 + 5)).toBe(true);
      expect(claimClientRecord(id, ENDPOINT, T0 + 10)).toEqual({ status: 'done' });
      expect(claimClientRecord(id, ENDPOINT, T0 + 10 * STALE_CLAIM_MS)).toEqual({
        status: 'done'
      });
    });
    expect(receipt(owner, id)?.status).toBe('done');
  });

  it('answers pending while a fresh claim is held', () => {
    const owner = newOwner();
    const id = randomUUID();
    runWithTenant(owner, () => {
      expect(claimClientRecord(id, ENDPOINT, T0).status).toBe('claimed');
      expect(claimClientRecord(id, ENDPOINT, T0)).toEqual({ status: 'pending' });
      expect(claimClientRecord(id, ENDPOINT, T0 + STALE_CLAIM_MS - 1)).toEqual({
        status: 'pending'
      });
    });
    expect(receipt(owner, id)?.updatedAt).toEqual(new Date(T0));
  });

  it('lets a stale claim be retaken once, bumping updated_at and the token', () => {
    const owner = newOwner();
    const id = randomUUID();
    const later = T0 + STALE_CLAIM_MS;
    runWithTenant(owner, () => {
      claimClientRecord(id, ENDPOINT, T0);
      expect(claimClientRecord(id, ENDPOINT, later)).toEqual({ status: 'claimed', token: later });
      expect(claimClientRecord(id, ENDPOINT, later).status).toBe('pending');
      expect(claimClientRecord(id, ENDPOINT, later + 1_000).status).toBe('pending');
    });
    expect(receipt(owner, id)).toMatchObject({ status: 'pending', updatedAt: new Date(later) });
  });

  it('two retakers that both read the same stale row cannot both win', () => {
    const owner = newOwner();
    const id = randomUUID();
    const later = T0 + 2 * STALE_CLAIM_MS;
    runWithTenant(owner, () => claimClientRecord(id, ENDPOINT, T0));

    let rival: ReturnType<typeof claimClientRecord> | undefined;
    hooks.beforeUpdate = () => {
      rival = claimClientRecord(id, ENDPOINT, later + 1);
    };

    const first = runWithTenant(owner, () => claimClientRecord(id, ENDPOINT, later));
    expect(rival).toEqual({ status: 'claimed', token: later + 1 });
    expect(first).toEqual({ status: 'pending' });
    expect(receipt(owner, id)?.updatedAt).toEqual(new Date(later + 1));
  });

  it('release frees the id so a retry can claim it', () => {
    const owner = newOwner();
    const id = randomUUID();
    runWithTenant(owner, () => {
      const token = claimToken(id, T0);
      expect(releaseClientRecord(id, token)).toBe(true);
      expect(claimClientRecord(id, ENDPOINT, T0 + 1)).toEqual({
        status: 'claimed',
        token: T0 + 1
      });
    });
  });

  it('an original that fails after a stale takeover leaves the new holder claim in place', () => {
    const owner = newOwner();
    const id = randomUUID();
    const later = T0 + STALE_CLAIM_MS + 5;
    runWithTenant(owner, () => {
      const original = claimToken(id, T0);
      const holder = claimToken(id, later);
      expect(releaseClientRecord(id, original)).toBe(false);
      expect(receipt(owner, id)).toMatchObject({ status: 'pending', updatedAt: new Date(later) });
      expect(claimClientRecord(id, ENDPOINT, later + 1)).toEqual({ status: 'pending' });
      expect(completeClientRecord(id, holder, later + 2)).toBe(true);
      expect(claimClientRecord(id, ENDPOINT, later + 3)).toEqual({ status: 'done' });
    });
  });

  it('an original that completes after a stale takeover does not overwrite the new holder claim', () => {
    const owner = newOwner();
    const id = randomUUID();
    const later = T0 + STALE_CLAIM_MS;
    runWithTenant(owner, () => {
      const original = claimToken(id, T0);
      const holder = claimToken(id, later);
      expect(completeClientRecord(id, original, later + 1)).toBe(false);
      expect(receipt(owner, id)).toMatchObject({ status: 'pending', updatedAt: new Date(later) });
      expect(releaseClientRecord(id, holder)).toBe(true);
      expect(receipt(owner, id)).toBeUndefined();
    });
  });

  it('a spent token cannot release or complete a receipt that is already done', () => {
    const owner = newOwner();
    const id = randomUUID();
    runWithTenant(owner, () => {
      const token = claimToken(id, T0);
      expect(completeClientRecord(id, token, T0 + 1)).toBe(true);
      expect(completeClientRecord(id, token, T0 + 2)).toBe(false);
      expect(releaseClientRecord(id, token)).toBe(false);
      expect(releaseClientRecord(id, T0 + 1)).toBe(false);
    });
    expect(receipt(owner, id)).toMatchObject({ status: 'done', updatedAt: new Date(T0 + 1) });
  });

  it('keeps the same client id independent per Owner', () => {
    const a = newOwner();
    const b = newOwner();
    const id = randomUUID();
    runWithTenant(a, () => {
      completeClientRecord(id, claimToken(id, T0), T0);
    });
    expect(runWithTenant(b, () => claimClientRecord(id, ENDPOINT, T0))).toEqual({
      status: 'claimed',
      token: T0
    });
    expect(runWithTenant(b, () => releaseClientRecord(id, T0))).toBe(true);
    expect(receipt(a, id)?.status).toBe('done');
    expect(receipt(b, id)).toBeUndefined();
    expect(runWithTenant(b, () => completeClientRecord(id, T0, T0))).toBe(false);
    expect(receipt(b, id)).toBeUndefined();
    expect(runWithTenant(a, () => claimClientRecord(id, ENDPOINT, T0))).toEqual({
      status: 'done'
    });
  });

  it('property: only the current holder token moves a receipt, and nothing re-claims after done', () => {
    type Step = { kind: 'claim' | 'complete' | 'release'; dt: number; pick: number };
    const step = fc.record({
      kind: fc.constantFrom<'claim' | 'complete' | 'release'>('claim', 'complete', 'release'),
      dt: fc.integer({ min: 0, max: 2 * STALE_CLAIM_MS }),
      pick: fc.nat()
    });
    fc.assert(
      fc.property(fc.array(step, { minLength: 1, maxLength: 25 }), (steps: Step[]) => {
        const owner = newOwner();
        const id = randomUUID();
        let now = T0;
        let completed = false;
        const tokens: number[] = [];
        runWithTenant(owner, () => {
          for (const s of steps) {
            now += s.dt;
            if (s.kind === 'claim') {
              const result = claimClientRecord(id, ENDPOINT, now);
              if (completed) expect(result).toEqual({ status: 'done' });
              if (result.status === 'claimed') tokens.push(result.token);
              continue;
            }
            if (tokens.length === 0) continue;
            const token = tokens[s.pick % tokens.length];
            const before = receipt(owner, id);
            const held = before?.status === 'pending' && before.updatedAt.getTime() === token;
            const applied =
              s.kind === 'complete'
                ? completeClientRecord(id, token, now)
                : releaseClientRecord(id, token);
            expect(applied).toBe(held);
            if (!held) expect(receipt(owner, id)).toEqual(before);
            if (applied && s.kind === 'complete') completed = true;
          }
        });
      }),
      { numRuns: 80 }
    );
  });
});
