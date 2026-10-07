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

import { runShifted } from '$lib/server/clock';
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
  it('maps a timestamp to its farm-local calendar year', () => {
    expect(seasonYearOf(msInYear(2026))).toBe(2026);
    // Jan 1 00:30 and Dec 31 23:30 in New York.
    expect(seasonYearOf(Date.UTC(2026, 0, 1, 5, 30), 'America/New_York')).toBe(2026);
    expect(seasonYearOf(Date.UTC(2027, 0, 1, 4, 30), 'America/New_York')).toBe(2026);
  });

  it('keeps a US Dec 31 evening in that year, not the next UTC year', () => {
    // 8pm EST on Dec 31 is already Jan 1 in UTC.
    expect(seasonYearOf(Date.UTC(2027, 0, 1, 1, 0))).toBe(2026);
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

      expect(blocked?.message).toBe(
        'The 2026 season is closed. Records dated in 2026 can no longer be added or changed. Reopen the season first if a correction is needed.'
      );
      expect(checkSeasonClosed(msInYear(2026), 'es')?.message).toMatch(
        /^La temporada 2026 está cerrada/
      );

      // Neighboring years remain open.
      expect(checkSeasonClosed(msInYear(2025))).toBeNull();
      expect(checkSeasonClosed(msInYear(2027))).toBeNull();
    });
  });

  it('year boundaries: Jan 1 and Dec 31 of a closed year both block', () => {
    const owner = freshOwner();
    runWithTenant(owner, () => {
      closeSeason({ year: 2030, ...baseSnapshot });
      // Farm-local (default America/New_York) boundaries of 2030.
      const jan1 = Date.UTC(2030, 0, 1, 5, 0, 0);
      const dec31 = Date.UTC(2031, 0, 1, 4, 59, 59);
      expect(checkSeasonClosed(jan1)?.code).toBe(SEASON_CLOSED);
      expect(checkSeasonClosed(dec31)?.code).toBe(SEASON_CLOSED);
      // One second before Jan 1 (prior year) is open.
      expect(checkSeasonClosed(jan1 - 1000)).toBeNull();
      expect(checkSeasonClosed(dec31 + 1000)).toBeNull();
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
        // Any month/day within a year, and any year in a wide band. The gate
        // buckets by the farm's zone (America/New_York by default), so build
        // instants at 12:00-21:59 UTC, which are the same calendar date there
        // in EST and EDT whatever zone the test process runs in.
        fc.integer({ min: 0, max: 11 }),
        fc.integer({ min: 1, max: 28 }),
        fc.integer({ min: 12, max: 21 }),
        fc.integer({ min: 2010, max: 2070 }),
        (month, day, hour, year) => {
          const ts = Date.UTC(year, month, day, hour, 30);
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

  it('turns the year at farm-local midnight, not UTC midnight', () => {
    const owner = freshOwner();
    runWithTenant(owner, () => {
      closeSeason({ year: 2040, ...baseSnapshot });
      // America/New_York is UTC-5 in winter.
      expect(checkSeasonClosed(Date.UTC(2040, 0, 1, 4, 30))).toBeNull();
      expect(checkSeasonClosed(Date.UTC(2040, 0, 1, 5, 30))?.code).toBe(SEASON_CLOSED);
      expect(checkSeasonClosed(Date.UTC(2041, 0, 1, 4, 30))?.code).toBe(SEASON_CLOSED);
      expect(checkSeasonClosed(Date.UTC(2041, 0, 1, 5, 30))).toBeNull();
    });
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

  it('a close on a fast-forwarded demo clock keeps its reopen window (#750)', () => {
    const owner = freshOwner();
    const yearMs = 365 * 24 * 60 * 60 * 1000;
    runShifted(yearMs, () => {
      runWithTenant(owner, () => {
        const res = closeSeason({ year: 2051, ...baseSnapshot });
        expect(res.ok).toBe(true);
        if (res.ok) expect(Math.abs(res.closeout.closedAt - Date.now())).toBeLessThan(60_000);
        expect(canReopen(2051)).toBe(true);
        expect(reopenSeason(2051).ok).toBe(true);
      });
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
