/**
 * Willow Run's drip timer on the herb garden (Phase 37E, C-10, R-15). Pure
 * data for the seeder, which the integrator wires in: it creates the
 * equipment, links it to the Area by name and saves the skip. The inches per
 * run is the demo owner's typed figure (`manual`), not plant data.
 */

import { DEMO_TIME_ZONE } from '$lib/demo/time';
import { expandRuns } from '$lib/irrigation/schedule';
import type { StoredSchedule } from '$lib/irrigation/apiSchemas';

const WINDOW_MS = 168 * 3_600_000;

export interface DemoWatererFixture {
  equipment: {
    type: 'irrigation';
    label: string;
    spec: { templateId: string; method: 'drip'; schedule: StoredSchedule };
  };
  /** Areas (and beds, by name) the timer waters; a null bed is the whole Area. */
  targets: Array<{ areaName: string; bedName: string | null }>;
  /** Runs the demo owner turned off for the rain. */
  skips: Array<{ scheduledAt: number; reason: 'turned-off-for-rain' }>;
}

export const DEMO_WATERER_AREA = 'Herb garden';

export function demoWatererFixture(
  now: number,
  timeZone: string = DEMO_TIME_ZONE
): DemoWatererFixture {
  const schedule: StoredSchedule = {
    days: [1, 3, 5],
    start: '06:00',
    minutes: 20,
    method: 'drip',
    inchesPerRun: 0.4,
    gallonsPerMinute: null,
    activeFrom: now - 4 * WINDOW_MS
  };
  const past = expandRuns(schedule, { fromMs: now - WINDOW_MS, toMs: now, timeZone });
  const latest = past[past.length - 1];
  return {
    equipment: {
      type: 'irrigation',
      label: 'Drip timer',
      spec: { templateId: 'irrigation-drip-timer', method: 'drip', schedule }
    },
    targets: [{ areaName: DEMO_WATERER_AREA, bedName: null }],
    skips: latest !== undefined ? [{ scheduledAt: latest, reason: 'turned-off-for-rain' }] : []
  };
}
