import { describe, expect, it } from 'vitest';
import { sampleSnapshot } from '$lib/cards/build/fixtures';
import { buildAreaCard } from '$lib/cards/build/area';
import { demoWatererFixture, DEMO_WATERER_AREA } from '$lib/db/demo/watererFixture';
import { storedScheduleSchema } from './apiSchemas';
import { expandRuns } from './schedule';
import { watererLinesFor, type SnapshotWaterer } from './snapshot';
import { scheduleSummary, startText } from './summary';

const drip: SnapshotWaterer = {
  equipmentId: 'eq-1',
  label: 'Drip timer',
  schedule: { days: [5, 1, 3], start: '06:00', minutes: 20, method: 'drip', inchesPerRun: null },
  targets: [{ fieldId: 'f_hay', blockId: null }]
};

describe('waterer words', () => {
  it('reads "Mon, Wed, Fri 6:00 for 20 min", Monday first', () => {
    expect(scheduleSummary(drip.schedule)).toBe('Mon, Wed, Fri 6:00 for 20 min');
    expect(scheduleSummary({ ...drip.schedule, days: [0, 1, 2, 3, 4, 5, 6] })).toBe(
      'Every day 6:00 for 20 min'
    );
    expect(scheduleSummary(drip.schedule, 'es')).toMatch(/ a las 6:00 durante 20 min$/);
    expect(startText('18:30')).toBe('18:30');
  });

  it('lists only the waterers on the Area, with the amount when typed', () => {
    expect(watererLinesFor([drip], 'f_hay')).toEqual(['Drip timer: Mon, Wed, Fri 6:00 for 20 min']);
    expect(
      watererLinesFor([{ ...drip, schedule: { ...drip.schedule, inchesPerRun: 0.4 } }], 'f_hay')
    ).toEqual(['Drip timer: Mon, Wed, Fri 6:00 for 20 min, 0.4 in a run']);
    expect(watererLinesFor([drip], 'elsewhere')).toEqual([]);
    expect(watererLinesFor(undefined, 'f_hay')).toEqual([]);
  });
});

describe('the offline Area Card', () => {
  it('says "Drip timer: Mon, Wed, Fri 6:00 for 20 min" from the snapshot', () => {
    const card = buildAreaCard(sampleSnapshot({ waterers: [drip] }), 'f_hay');
    expect(card?.facts).toContainEqual({
      label: 'Timers',
      value: 'Drip timer: Mon, Wed, Fri 6:00 for 20 min',
      provenance: 'manual'
    });
  });

  it('adds nothing for a bundle without waterers', () => {
    const card = buildAreaCard(sampleSnapshot(), 'f_hay');
    expect(card?.facts.some((f) => f.label === 'Timers')).toBe(false);
  });
});

describe('demo waterer fixture', () => {
  it('is a valid drip timer on the herb garden with its latest run skipped', () => {
    const now = Date.parse('2026-07-15T14:20:00Z');
    const f = demoWatererFixture(now);
    expect(storedScheduleSchema.safeParse(f.equipment.spec.schedule).success).toBe(true);
    expect(f.targets).toEqual([{ areaName: DEMO_WATERER_AREA, bedName: null }]);
    const runs = expandRuns(f.equipment.spec.schedule, {
      fromMs: now - 168 * 3_600_000,
      toMs: now,
      timeZone: 'America/New_York'
    });
    expect(f.skips).toEqual([
      { scheduledAt: runs[runs.length - 1], reason: 'turned-off-for-rain' }
    ]);
  });
});
