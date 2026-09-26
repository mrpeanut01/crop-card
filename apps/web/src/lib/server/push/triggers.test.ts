import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  DECON_GRACE_MS,
  DECON_MAX_AGE_MS,
  HOUR_MS,
  LOCK_WARNING_LEAD_MS,
  LOCK_WINDOW_MS,
  MAX_TICK_GAP_MS,
  PUSH_TICK_CRONS_UTC,
  PUSH_TICK_TIMES_UTC,
  deconDueAlerts,
  lockWindowClosingAlerts,
  selectDueAlerts,
  springCalibrationAlerts,
  type LockableRecordSnapshot,
  type SprayerSnapshot
} from './triggers';

const NOW = new Date(2026, 3, 15, 10, 0).getTime();

function sprayer(over: Partial<SprayerSnapshot> = {}): SprayerSnapshot {
  return { id: 'spr-1', label: 'Hardi 55', calibratedGpa: 20, ...over };
}

function record(over: Partial<LockableRecordSnapshot> = {}): LockableRecordSnapshot {
  return {
    kind: 'spray',
    id: 'rec-1',
    occurredAt: NOW - LOCK_WINDOW_MS + HOUR_MS,
    performedById: 'user-helper',
    ...over
  };
}

describe('deconDueAlerts', () => {
  it('fires for a dirty sprayer past the grace period', () => {
    const lastSprayedAt = NOW - 2 * HOUR_MS;
    const alerts = deconDueAlerts([sprayer({ lastChemistryClass: 'group-4', lastSprayedAt })], NOW);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      kind: 'decon-due',
      subjectId: `spr-1:${lastSprayedAt}`,
      url: '/spray/decon?sprayer=spr-1',
      audience: { kind: 'all' }
    });
  });

  it('is silent when clean, within grace, too old, or decon already done', () => {
    const cases: SprayerSnapshot[] = [
      sprayer({ lastSprayedAt: NOW - 2 * HOUR_MS }),
      sprayer({ lastChemistryClass: 'group-4', lastSprayedAt: NOW - DECON_GRACE_MS + 1 }),
      sprayer({ lastChemistryClass: 'group-4', lastSprayedAt: NOW - DECON_MAX_AGE_MS - 1 }),
      sprayer({
        lastChemistryClass: 'group-4',
        lastSprayedAt: NOW - 3 * HOUR_MS,
        lastDeconAt: NOW - 2 * HOUR_MS
      }),
      sprayer({ lastChemistryClass: 'group-4' })
    ];
    for (const s of cases) expect(deconDueAlerts([s], NOW)).toEqual([]);
  });

  it('a new spray after a decon produces a new subject id', () => {
    const first = deconDueAlerts(
      [sprayer({ lastChemistryClass: 'g', lastSprayedAt: NOW - 5 * HOUR_MS })],
      NOW
    );
    const second = deconDueAlerts(
      [sprayer({ lastChemistryClass: 'g', lastSprayedAt: NOW - 2 * HOUR_MS })],
      NOW
    );
    expect(first[0].subjectId).not.toBe(second[0].subjectId);
  });
});

describe('lockWindowClosingAlerts', () => {
  it('fires inside the 2h lead window, targeting owners + the performer', () => {
    const alerts = lockWindowClosingAlerts(
      [record({ kind: 'insecticide', id: 'ins-9', blockName: 'North' })],
      NOW
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      kind: 'lock-window-closing',
      subjectId: 'insecticide:ins-9',
      url: '/records/insecticide/ins-9',
      audience: { kind: 'owners-and', userIds: ['user-helper'] }
    });
    expect(alerts[0].title).toContain('1h');
    const early = record({ occurredAt: NOW - LOCK_WINDOW_MS + 20 * HOUR_MS });
    expect(lockWindowClosingAlerts([early], NOW)[0].title).toContain('20h');
    expect(alerts[0].body).toContain('North');
  });

  it('property: fires iff 0 < time-to-lock ≤ lead and the row is not locked', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -LOCK_WINDOW_MS, max: 2 * LOCK_WINDOW_MS }),
        fc.boolean(),
        fc.constantFrom('spray' as const, 'insecticide' as const, 'fungicide' as const),
        (age, locked, kind) => {
          const r = record({ kind, occurredAt: NOW - age, lockedAt: locked ? NOW : null });
          const remaining = r.occurredAt + LOCK_WINDOW_MS - NOW;
          const expected = !locked && remaining > 0 && remaining <= LOCK_WARNING_LEAD_MS;
          expect(lockWindowClosingAlerts([r], NOW).length === 1).toBe(expected);
        }
      )
    );
  });
});

describe('springCalibrationAlerts', () => {
  const winterized = new Date(2025, 10, 20).getTime();

  it('fires in spring for a winterized, uncalibrated sprayer — once per year', () => {
    const alerts = springCalibrationAlerts(
      [sprayer({ calibratedGpa: null, winterizedAt: winterized })],
      NOW
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      kind: 'spring-calibration',
      subjectId: 'spr-1:2026',
      url: '/calibrate'
    });
  });

  it('is silent before March, after recalibration, or when winterized this year', () => {
    const feb = new Date(2026, 1, 20).getTime();
    expect(
      springCalibrationAlerts([sprayer({ calibratedGpa: null, winterizedAt: winterized })], feb)
    ).toEqual([]);
    expect(springCalibrationAlerts([sprayer({ winterizedAt: winterized })], NOW)).toEqual([]);
    expect(
      springCalibrationAlerts(
        [sprayer({ calibratedGpa: null, winterizedAt: new Date(2026, 2, 1).getTime() })],
        NOW
      )
    ).toEqual([]);
    expect(springCalibrationAlerts([sprayer({ calibratedGpa: null })], NOW)).toEqual([]);
  });
});

describe('selectDueAlerts', () => {
  it('combines every trigger family', () => {
    const alerts = selectDueAlerts({
      sprayers: [
        sprayer({ lastChemistryClass: 'g', lastSprayedAt: NOW - 2 * HOUR_MS }),
        sprayer({ id: 'spr-2', calibratedGpa: null, winterizedAt: new Date(2025, 10, 1).getTime() })
      ],
      records: [record()],
      now: NOW
    });
    expect(alerts.map((a) => a.kind).sort()).toEqual([
      'decon-due',
      'lock-window-closing',
      'spring-calibration'
    ]);
  });
});

describe('twice-daily tick cadence', () => {
  function ticksBetween(fromMs: number, toMs: number): number[] {
    const out: number[] = [];
    const day = new Date(fromMs);
    day.setUTCHours(0, 0, 0, 0);
    for (let d = day.getTime(); d <= toMs; d += 24 * HOUR_MS) {
      for (const m of PUSH_TICK_TIMES_UTC) {
        const t = d + m * 60_000;
        if (t > fromMs && t <= toMs) out.push(t);
      }
    }
    return out;
  }
  const YEAR_MINUTES = 365 * 24 * 60;
  const BASE = Date.UTC(2026, 0, 1);

  it('the cron and the declared maximum gap agree', () => {
    expect(PUSH_TICK_CRONS_UTC).toEqual(['0 10 * * *', '30 20 * * *']);
    const mins = [...PUSH_TICK_TIMES_UTC].sort((a, b) => a - b);
    const gaps = mins.map((m, i) => (mins[(i + 1) % mins.length] - m + 1440) % 1440 || 1440);
    expect(Math.max(...gaps) * 60_000).toBe(MAX_TICK_GAP_MS);
    expect(LOCK_WARNING_LEAD_MS).toBeGreaterThan(MAX_TICK_GAP_MS);
  });

  it('property: every unlocked record is warned about by some tick before it locks', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: YEAR_MINUTES }), (minute) => {
        const r = record({ occurredAt: BASE + minute * 60_000, lockedAt: null });
        const ticks = ticksBetween(r.occurredAt, r.occurredAt + LOCK_WINDOW_MS - 1);
        expect(ticks.some((t) => lockWindowClosingAlerts([r], t).length === 1)).toBe(true);
      })
    );
  });

  it('property: every dirty sprayer gets a decon-due alert within grace + one gap', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: YEAR_MINUTES }), (minute) => {
        const lastSprayedAt = BASE + minute * 60_000;
        const s = sprayer({ lastChemistryClass: 'group-4', lastSprayedAt });
        const ticks = ticksBetween(lastSprayedAt, lastSprayedAt + DECON_GRACE_MS + MAX_TICK_GAP_MS);
        expect(ticks.some((t) => deconDueAlerts([s], t).length === 1)).toBe(true);
      })
    );
  });
});
