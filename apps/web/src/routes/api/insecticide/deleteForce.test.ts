/**
 * Endpoint-level authz for force-deletes (#308 / #329, invariant 5).
 *
 * Helpers can mutate records, but force-deleting a *locked* record is an
 * owner-only escape hatch — helpers get a 403 before any delete or tombstone
 * write happens. Verified for the insecticide + harvest DELETE handlers.
 *
 * `currentUser` and the repo delete functions are mocked so the test targets
 * the handler's role gate in isolation, with no DB dependency.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

const {
  currentUser,
  deleteInsecticideEvent,
  deleteHarvestEvent,
  getInsecticideEvent,
  getHarvestEvent
} = vi.hoisted(() => ({
  currentUser: vi.fn(),
  deleteInsecticideEvent: vi.fn(() => ({ removed: { insecticide_events: 1 } })),
  deleteHarvestEvent: vi.fn(() => ({ removed: { harvest_events: 1 } })),
  getInsecticideEvent: vi.fn(() => ({ id: 'rec-1' })),
  getHarvestEvent: vi.fn(() => ({ id: 'rec-1' }))
}));

vi.mock('$lib/server/auth', () => ({ currentUser }));
vi.mock('$lib/db/admin', async () => {
  const actual = await vi.importActual<typeof import('$lib/db/admin')>('$lib/db/admin');
  return {
    RecordLockedError: actual.RecordLockedError,
    deleteInsecticideEvent,
    deleteHarvestEvent
  };
});
vi.mock('$lib/db/insecticideEvents', () => ({ getInsecticideEvent }));
vi.mock('$lib/db/harvestEvents', () => ({ getHarvestEvent }));

import { DELETE as DELETE_INSECTICIDE } from './[id]/+server';
import { DELETE as DELETE_HARVEST } from '../harvest/records/[id]/+server';

function makeEvent(role: string | null, force: boolean, id = 'rec-1') {
  const params = new URLSearchParams();
  if (force) params.set('force', 'true');
  return {
    params: { id },
    url: { searchParams: params },
    request: new Request('http://localhost')
  } as never;
}

beforeEach(() => {
  currentUser.mockReset();
  deleteInsecticideEvent.mockClear();
  deleteHarvestEvent.mockClear();
});

describe('force-delete authz (invariant 5)', () => {
  it('helper force-delete of insecticide → 403, no delete attempted', async () => {
    currentUser.mockReturnValue({ id: 'h1', role: 'helper' });
    const res = await DELETE_INSECTICIDE(makeEvent('helper', true));
    expect(res.status).toBe(403);
    expect(deleteInsecticideEvent).not.toHaveBeenCalled();
  });

  it('helper force-delete of harvest → 403, no delete attempted', async () => {
    currentUser.mockReturnValue({ id: 'h1', role: 'helper' });
    const res = await DELETE_HARVEST(makeEvent('helper', true));
    expect(res.status).toBe(403);
    expect(deleteHarvestEvent).not.toHaveBeenCalled();
  });

  it('inspector (read-only) DELETE → 403', async () => {
    currentUser.mockReturnValue({ id: 'd1', role: 'inspector' });
    const res = await DELETE_INSECTICIDE(makeEvent('inspector', false));
    expect(res.status).toBe(403);
    expect(deleteInsecticideEvent).not.toHaveBeenCalled();
  });

  it('owner force-delete of insecticide → delegates to repo with force + deletedBy', async () => {
    currentUser.mockReturnValue({ id: 'o1', role: 'owner' });
    const res = await DELETE_INSECTICIDE(makeEvent('owner', true));
    expect(res.status).toBe(200);
    expect(deleteInsecticideEvent).toHaveBeenCalledWith(
      'rec-1',
      expect.objectContaining({ force: true, deletedBy: 'o1' })
    );
  });

  it('helper non-force delete of insecticide → allowed (delegates to repo)', async () => {
    currentUser.mockReturnValue({ id: 'h1', role: 'helper' });
    const res = await DELETE_INSECTICIDE(makeEvent('helper', false));
    expect(res.status).toBe(200);
    expect(deleteInsecticideEvent).toHaveBeenCalledWith(
      'rec-1',
      expect.objectContaining({ force: false })
    );
  });
});
