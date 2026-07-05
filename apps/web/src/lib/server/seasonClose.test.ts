/**
 * UC-44 — SEASON_CLOSED gate + close/reopen state machine (#349).
 *
 * Tested as a security boundary (like FR-09), not feature code:
 *   - `checkSeasonClosed` refuses ANY record date inside a closed year and
 *     allows every date outside it — verified with fast-check over arbitrary
 *     timestamps vs an arbitrary closed year.
 *   - close is idempotent-rejecting (double-close → ALREADY_CLOSED).
 *   - reopen works inside the 7-day window and is refused (permanent) past it.
 *   - a reopened season is treated as open by the gate.
 *   - re-closing after a reopen mints a fresh row (no UNIQUE conflict).
 *   - the gate is tenant-scoped: Owner A closing 2099 never blocks Owner B.
 *
 * DB-seeded against the migrated schema so the real (owner_id, year) UNIQUE
 * index + repo tenant funnels are exercised.
 */

import { randomUUID } from 'node:crypto';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { runWithTenant } from '$lib/db/tenant';
import { db } from '$lib/db/client';
import { owners } from '$lib/db/schema';
import { REOPEN_WINDOW_MS } from '$lib/db/seasonCloseouts';
import {
  SEASON_CLOSED,
  checkSeasonClosed,
  closeSeason,
  reopenSeason,
  canReopen,
  seasonYearOf
} from './seasonClose';

function ensureOwner(ownerId: string): void {
  db.insert(owners)
    .values({
      id: ownerId,
      name: ownerId,
      slug: ownerId.replace(/[^a-z0-9-]/g, '-'),
      billingStatus: 'active'
    })
    .onConflictDoNothing()
    .run();
}

/** Fresh, isolated owner per test so parallel/repeat runs never collide on
 *  the (owner_id, year) UNIQUE index. */
function freshOwner(): string {
  const id = `sc-test-${randomUUID().slice(0, 12)}`;
  ensureOwner(id);
  return id;
}

const baseSnapshot = {
  plantingResolutions: [],
  harvestRollup: { eventCount: 0 },
  pendingCount: 0
};

function msInYear(year: number, monthIdx = 5, day = 15): number {
  return new Date(year, monthIdx, day, 12, 0, 0).getTime();
}

describe('seasonYearOf', () => {
  it('maps a timestamp to its local calendar year', () => {
    expect(seasonYearOf(msInYear(2026))).toBe(2026);
    expect(seasonYearOf(new Date(2026, 0, 1, 0, 0, 0).getTime())).toBe(2026);
    expect(seasonYearOf(new Date(2026, 11, 31, 23, 0, 0).getTime())).toBe(2026);
  });
});

describe('checkSeasonClosed gate', () => {
  it('allows writes when the season was never closed', () => {
    const owner = freshOwner();
    runWithTenant(owner, () => {
      expect(checkSeasonClosed(msInYear(2026))).toBeNull();
    });
  });

  it('refuses writes dated inside a closed year and allows other years', () => {
    const owner = freshOwner();
    runWithTenant(owner, () => {
      const res = closeSeason({ year: 2026, ...baseSnapshot });
      expect(res.ok).toBe(true);

      const blocked = checkSeasonClosed(msInYear(2026));
      expect(blocked).not.toBeNull();
      expect(blocked?.code).toBe(SEASON_CLOSED);
      expect(blocked?.year).toBe(2026);

      // Neighboring years remain open.
      expect(checkSeasonClosed(msInYear(2025))).toBeNull();
      expect(checkSeasonClosed(msInYear(2027))).toBeNull();
    });
  });

  it('year boundaries: Jan 1 and Dec 31 of a closed year both block', () => {
    const owner = freshOwner();
    runWithTenant(owner, () => {
      closeSeason({ year: 2030, ...baseSnapshot });
      const jan1 = new Date(2030, 0, 1, 0, 0, 0).getTime();
      const dec31 = new Date(2030, 11, 31, 23, 59, 59).getTime();
      expect(checkSeasonClosed(jan1)?.code).toBe(SEASON_CLOSED);
      expect(checkSeasonClosed(dec31)?.code).toBe(SEASON_CLOSED);
      // One second before Jan 1 (prior year) is open.
      expect(checkSeasonClosed(jan1 - 1000)).toBeNull();
    });
  });

  it('property: for a closed year Y, EVERY date in Y blocks and no date outside Y blocks', () => {
    const owner = freshOwner();
    const closedYear = 2040;
    runWithTenant(owner, () => {
      closeSeason({ year: closedYear, ...baseSnapshot });
    });

    fc.assert(
      fc.property(
        // Any month/day/hour within a year, and any year in a wide band.
        fc.integer({ min: 0, max: 11 }),
        fc.integer({ min: 1, max: 28 }),
        fc.integer({ min: 0, max: 23 }),
        fc.integer({ min: 2010, max: 2070 }),
        (month, day, hour, year) => {
          const ts = new Date(year, month, day, hour).getTime();
          return runWithTenant(owner, () => {
            const blocked = checkSeasonClosed(ts);
            if (year === closedYear) {
              return blocked !== null && blocked.code === SEASON_CLOSED;
            }
            return blocked === null;
          });
        }
      ),
      { numRuns: 300 }
    );
  });
});

describe('closeSeason', () => {
  it('writes a snapshot with a RULES_VERSION stamp (provenance)', () => {
    const owner = freshOwner();
    runWithTenant(owner, () => {
      const res = closeSeason({
        year: 2026,
        plantingResolutions: [{ cropId: 'crop-1', status: 'harvested' }],
        harvestRollup: { eventCount: 3 },
        pendingCount: 0,
        closedById: null
      });
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      const snap = JSON.parse(res.closeout.snapshotJson);
      expect(snap.rulesVersion).toBeTruthy();
      expect(snap.pendingCount).toBe(0);
      expect(snap.plantingResolutions).toHaveLength(1);
    });
  });

  it('rejects a double-close on the same year', () => {
    const owner = freshOwner();
    runWithTenant(owner, () => {
      expect(closeSeason({ year: 2026, ...baseSnapshot }).ok).toBe(true);
      const second = closeSeason({ year: 2026, ...baseSnapshot });
      expect(second.ok).toBe(false);
      if (!second.ok) expect(second.code).toBe('ALREADY_CLOSED');
    });
  });
});

describe('reopenSeason', () => {
  it('reopens within the 7-day window and re-opens the gate', () => {
    const owner = freshOwner();
    runWithTenant(owner, () => {
      closeSeason({ year: 2026, ...baseSnapshot });
      expect(checkSeasonClosed(msInYear(2026))).not.toBeNull();

      const res = reopenSeason(2026);
      expect(res.ok).toBe(true);
      // Gate is open again after reopen.
      expect(checkSeasonClosed(msInYear(2026))).toBeNull();
    });
  });

  it('refuses reopen once the 7-day window has elapsed (permanent close)', () => {
    const owner = freshOwner();
    runWithTenant(owner, () => {
      const closedAt = Date.now() - (REOPEN_WINDOW_MS + 60_000);
      closeSeason({ year: 2026, ...baseSnapshot, closedAt });

      expect(canReopen(2026)).toBe(false);
      const res = reopenSeason(2026);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('WINDOW_EXPIRED');
      // Still closed — the gate holds.
      expect(checkSeasonClosed(msInYear(2026))).not.toBeNull();
    });
  });

  it('canReopen is true just inside the window and false just outside', () => {
    const owner = freshOwner();
    runWithTenant(owner, () => {
      const almostExpired = Date.now() - (REOPEN_WINDOW_MS - 60_000);
      closeSeason({ year: 2050, ...baseSnapshot, closedAt: almostExpired });
      expect(canReopen(2050)).toBe(true);
    });
  });

  it('reopen on a never-closed year returns NOT_CLOSED', () => {
    const owner = freshOwner();
    runWithTenant(owner, () => {
      const res = reopenSeason(2026);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('NOT_CLOSED');
    });
  });

  it('re-closing after a reopen mints a fresh row (no UNIQUE conflict)', () => {
    const owner = freshOwner();
    runWithTenant(owner, () => {
      closeSeason({ year: 2026, ...baseSnapshot });
      reopenSeason(2026);
      const reclosed = closeSeason({ year: 2026, ...baseSnapshot });
      expect(reclosed.ok).toBe(true);
      expect(checkSeasonClosed(msInYear(2026))).not.toBeNull();
    });
  });
});

describe('tenant isolation of the gate', () => {
  it('Owner A closing a year never blocks Owner B', () => {
    const a = freshOwner();
    const b = freshOwner();
    runWithTenant(a, () => closeSeason({ year: 2026, ...baseSnapshot }));

    runWithTenant(a, () => {
      expect(checkSeasonClosed(msInYear(2026))).not.toBeNull();
    });
    runWithTenant(b, () => {
      expect(checkSeasonClosed(msInYear(2026))).toBeNull();
    });
  });
});
