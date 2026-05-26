// Regression #240: every read or mutate path on the pending queue UI
// MUST filter by the active Owner. Mocked at the module boundary because
// Dexie/IndexedDB needs a browser. The cross-tenant property tested here
// mirrors the server-side `tenant.crossTenant.test.ts` pattern.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PendingSprayRecord } from './dexie';

type Row = PendingSprayRecord;

function row(id: string, ownerId: string, createdAt = 0): Row {
  return {
    id,
    ownerId,
    occurredAt: createdAt,
    payload: { id },
    attempts: 0,
    createdAt
  };
}

let rows: Row[];
let activeOwnerId: string | null = 'owner_a';

vi.mock('./dexie', () => {
  function table() {
    return {
      get: async (id: string) => rows.find((r) => r.id === id),
      delete: async (id: string) => {
        rows = rows.filter((r) => r.id !== id);
      },
      where(field: 'ownerId') {
        return {
          equals: (val: string) => ({
            count: async () => rows.filter((r) => r[field] === val).length,
            sortBy: async (key: keyof Row) =>
              rows
                .filter((r) => r[field] === val)
                .sort((a, b) => (a[key] as number) - (b[key] as number))
          }),
          notEqual: (val: string) => ({
            count: async () => rows.filter((r) => r[field] !== val).length
          })
        };
      },
      orderBy: (key: keyof Row) => ({
        toArray: async () => [...rows].sort((a, b) => (a[key] as number) - (b[key] as number))
      }),
      count: async () => rows.length,
      put: async (r: Row) => {
        rows.push(r);
        return r.id;
      }
    };
  }
  return {
    db: () => ({ pendingSprayRecords: table() })
  };
});

beforeEach(() => {
  rows = [
    row('a1', 'owner_a', 1),
    row('a2', 'owner_a', 2),
    row('b1', 'owner_b', 3),
    row('b2', 'owner_b', 4)
  ];
  // @ts-expect-error — vitest globals
  globalThis.window = {};
  // @ts-expect-error — vitest globals
  globalThis.sessionStorage = {
    getItem: (key: string) =>
      key === 'cropcard.activeOwnerId' ? activeOwnerId : null
  };
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('syncQueue — #240 cross-tenant scoping', () => {
  it('listPendingForActiveOwner only returns active-owner rows', async () => {
    activeOwnerId = 'owner_a';
    const { listPendingForActiveOwner } = await import('./syncQueue');
    const got = await listPendingForActiveOwner();
    expect(got.map((r) => r.id).sort()).toEqual(['a1', 'a2']);
  });

  it('switching active Owner switches the visible list (no leak)', async () => {
    const { listPendingForActiveOwner } = await import('./syncQueue');
    activeOwnerId = 'owner_b';
    const got = await listPendingForActiveOwner();
    expect(got.map((r) => r.id).sort()).toEqual(['b1', 'b2']);
  });

  it('discardPendingForActiveOwner refuses to delete a foreign-owner row', async () => {
    activeOwnerId = 'owner_a';
    const { discardPendingForActiveOwner } = await import('./syncQueue');
    const ok = await discardPendingForActiveOwner('b1');
    expect(ok).toBe(false);
    expect(rows.some((r) => r.id === 'b1')).toBe(true);
  });

  it('discardPendingForActiveOwner deletes when the row belongs to the active Owner', async () => {
    activeOwnerId = 'owner_a';
    const { discardPendingForActiveOwner } = await import('./syncQueue');
    const ok = await discardPendingForActiveOwner('a1');
    expect(ok).toBe(true);
    expect(rows.some((r) => r.id === 'a1')).toBe(false);
  });

  it('no active Owner → list + discard return empty / false', async () => {
    activeOwnerId = null;
    const { listPendingForActiveOwner, discardPendingForActiveOwner } = await import(
      './syncQueue'
    );
    expect(await listPendingForActiveOwner()).toEqual([]);
    expect(await discardPendingForActiveOwner('a1')).toBe(false);
  });
});
