import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  DECON_GRACE_MS,
  DECON_MAX_AGE_MS,
  HOUR_MS,
  LOCK_WARNING_LEAD_MS,
  LOCK_WINDOW_MS,
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
