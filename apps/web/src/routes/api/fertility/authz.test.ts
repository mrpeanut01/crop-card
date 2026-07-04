/**
 * Authz gate tests for the fertility mutation family + sprayer decon.
 *
 * Regression coverage for #318 / #311 / #313: helpers can READ inventory
 * but every fertility/decon MUTATION must gate at the API layer to `owner`
 * (Invariant 8). We drive the real `requireOwner` gate by mocking only the
 * session layer (`readSession`) and stubbing the DB repos so the handlers
 * never touch SQLite.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SessionPayload, SessionRole } from '$lib/server/session';

let currentRole: SessionRole = 'owner';

vi.mock('$lib/server/session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/server/session')>();
  return {
    ...actual,
    readSession: (): SessionPayload => ({
      userId: 'user-test',
      email: 'test@example.com',
      isSuperadmin: false,
      activeOwnerId: 'owner-test',
      activeRole: currentRole,
      impersonating: false,
      exp: Date.now() + 60_000
    })
  };
});

vi.mock('$lib/db/fertility', () => ({
  insertSoilTest: (v: unknown) => ({ id: 'st-1', ...(v as object) }),
  listSoilTestsForBlock: () => [],
  insertFertilityApplication: (v: unknown) => ({ id: 'fa-1', ...(v as object) }),
  listFertilityApplicationsForBlock: () => [],
  insertFertilityCredit: (v: unknown) => ({ id: 'fc-1', ...(v as object) }),
  listFertilityCreditsForBlock: () => []
}));

vi.mock('$lib/db/admin', () => ({
  deleteFertilityApplication: () => ({ ok: true }),
  deleteFertilityCredit: () => ({ ok: true }),
  deleteSoilTest: () => ({ ok: true })
}));

vi.mock('$lib/db/users', () => ({
  ensureSystemUser: async () => ({ id: 'sys-user' })
}));

vi.mock('$lib/fertility/coverCropCredits', () => ({
  defaultCoverCredit: () => undefined
}));

vi.mock('$lib/server/sprayers', () => ({
  getSprayer: (id: string) => (id === 'spr-1' ? { id: 'spr-1' } : undefined),
  recordDecon: (id: string, at: number) => ({ id, lastDeconAt: at })
}));

import { POST as soilTestPost } from './soil-tests/+server';
import { DELETE as soilTestDelete } from './soil-tests/[id]/+server';
import { POST as applicationPost } from './applications/+server';
import { DELETE as applicationDelete } from './applications/[id]/+server';
import { POST as creditPost } from './credits/+server';
import { DELETE as creditDelete } from './credits/[id]/+server';
import { POST as deconPost } from '../sprayers/[id]/decon/+server';

/** Build a minimal RequestEvent-like object; cookies are unused because
 *  `readSession` is mocked, but the shape must exist for the handler. */
function makeEvent(opts: { body?: unknown; params?: Record<string, string> } = {}) {
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cookies: { get: () => undefined } as any,
    params: opts.params ?? {},
    request: {
      json: async () => opts.body ?? {}
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

/** Invoke a handler and normalize the outcome to an HTTP status, whether the
 *  handler returns a Response or throws a SvelteKit `error(...)`. */
async function statusOf(fn: () => unknown | Promise<unknown>): Promise<number> {
  try {
    const res = (await fn()) as Response;
    return res.status;
  } catch (e) {
    const httpish = e as { status?: number };
    if (typeof httpish?.status === 'number') return httpish.status;
    throw e;
  }
}

const VALID = {
  soilTest: { blockId: 'b1' },
  application: { blockId: 'b1', source: 'urea', ratePerAcre: 100, rateUnit: 'lb' },
  credit: { blockId: 'b1', appliesToYear: 2026, source: 'hairy vetch' }
};

describe('fertility + decon mutation authz gate', () => {
  beforeEach(() => {
    currentRole = 'owner';
  });

  describe('helper is rejected with 403', () => {
    beforeEach(() => {
      currentRole = 'helper';
    });

    it('POST /api/fertility/soil-tests', async () => {
      expect(await statusOf(() => soilTestPost(makeEvent({ body: VALID.soilTest })))).toBe(403);
    });
    it('DELETE /api/fertility/soil-tests/:id', async () => {
      expect(await statusOf(() => soilTestDelete(makeEvent({ params: { id: 'st-1' } })))).toBe(403);
    });
    it('POST /api/fertility/applications', async () => {
      expect(await statusOf(() => applicationPost(makeEvent({ body: VALID.application })))).toBe(
        403
      );
    });
    it('DELETE /api/fertility/applications/:id', async () => {
      expect(await statusOf(() => applicationDelete(makeEvent({ params: { id: 'fa-1' } })))).toBe(
        403
      );
    });
    it('POST /api/fertility/credits', async () => {
      expect(await statusOf(() => creditPost(makeEvent({ body: VALID.credit })))).toBe(403);
    });
    it('DELETE /api/fertility/credits/:id', async () => {
      expect(await statusOf(() => creditDelete(makeEvent({ params: { id: 'fc-1' } })))).toBe(403);
    });
    it('POST /api/sprayers/:id/decon', async () => {
      expect(await statusOf(() => deconPost(makeEvent({ params: { id: 'spr-1' } })))).toBe(403);
    });
  });

  describe('owner is allowed through the gate (2xx)', () => {
    beforeEach(() => {
      currentRole = 'owner';
    });

    it('POST /api/fertility/soil-tests → 201', async () => {
      expect(await statusOf(() => soilTestPost(makeEvent({ body: VALID.soilTest })))).toBe(201);
    });
    it('DELETE /api/fertility/soil-tests/:id → 200', async () => {
      expect(await statusOf(() => soilTestDelete(makeEvent({ params: { id: 'st-1' } })))).toBe(200);
    });
    it('POST /api/fertility/applications → 201', async () => {
      expect(await statusOf(() => applicationPost(makeEvent({ body: VALID.application })))).toBe(
        201
      );
    });
    it('DELETE /api/fertility/applications/:id → 200', async () => {
      expect(await statusOf(() => applicationDelete(makeEvent({ params: { id: 'fa-1' } })))).toBe(
        200
      );
    });
    it('POST /api/fertility/credits → 201', async () => {
      expect(await statusOf(() => creditPost(makeEvent({ body: VALID.credit })))).toBe(201);
    });
    it('DELETE /api/fertility/credits/:id → 200', async () => {
      expect(await statusOf(() => creditDelete(makeEvent({ params: { id: 'fc-1' } })))).toBe(200);
    });
    it('POST /api/sprayers/:id/decon → 200', async () => {
      expect(await statusOf(() => deconPost(makeEvent({ params: { id: 'spr-1' } })))).toBe(200);
    });
  });
});
