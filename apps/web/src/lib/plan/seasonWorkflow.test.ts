import { describe, it, expect } from 'vitest';
import { deriveSeasonWorkflow } from './seasonWorkflow';

const APR_2 = Date.UTC(2026, 3, 2);
const APR_8 = Date.UTC(2026, 3, 8);
const APR_14 = Date.UTC(2026, 3, 14);

describe('deriveSeasonWorkflow', () => {
  it('pending state for a fresh season with no setup, no crops, no tasks', () => {
    const steps = deriveSeasonWorkflow({
      seasonSetup: null,
      lastYearSetup: null,
      crops: [],
      inputsTaskCount: 0,
      hasPlanRevision: null
    });
    expect(steps).toHaveLength(5);
    expect(steps.every((s) => s.state === 'pending')).toBe(true);
  });

  it('season-setup done when present + last-year hint when only last year exists', () => {
    const stepsFresh = deriveSeasonWorkflow({
      seasonSetup: { modifiedAt: APR_2 },
      lastYearSetup: null,
      crops: [],
      inputsTaskCount: 0,
      hasPlanRevision: null
    });
    expect(stepsFresh[0].state).toBe('done');
    expect(stepsFresh[0].when).toBe('Apr 2');

    const stepsCarry = deriveSeasonWorkflow({
      seasonSetup: null,
      lastYearSetup: { year: 2025 },
      crops: [],
      inputsTaskCount: 0,
      hasPlanRevision: null
    });
    expect(stepsCarry[0].state).toBe('pending');
    expect(stepsCarry[0].note).toContain('Carry forward');
  });

  it('season-setup goes stale when frost dates update post-setup', () => {
    const steps = deriveSeasonWorkflow({
      seasonSetup: { modifiedAt: APR_2 },
      lastYearSetup: null,
      crops: [],
      inputsTaskCount: 0,
      hasPlanRevision: null,
      frostDatesModifiedAt: APR_8
    });
    expect(steps[0].state).toBe('stale');
  });

  it('allocation done when crops exist', () => {
    const steps = deriveSeasonWorkflow({
      seasonSetup: { modifiedAt: APR_2 },
      lastYearSetup: null,
      crops: [{ plantingDate: null }, { plantingDate: null }, { plantingDate: null }],
      inputsTaskCount: 0,
      hasPlanRevision: null
    });
    expect(steps[1].state).toBe('done');
    expect(steps[1].when).toContain('3 plantings');
  });

  it('schedule in-progress when only some crops have plantingDate', () => {
    const steps = deriveSeasonWorkflow({
      seasonSetup: { modifiedAt: APR_2 },
      lastYearSetup: null,
      crops: [{ plantingDate: APR_14 }, { plantingDate: null }],
      inputsTaskCount: 0,
      hasPlanRevision: null
    });
    expect(steps[2].state).toBe('in-progress');
    expect(steps[2].when).toBe('1/2');
  });

  it('schedule done when all crops have plantingDate', () => {
    const steps = deriveSeasonWorkflow({
      seasonSetup: { modifiedAt: APR_2 },
      lastYearSetup: null,
      crops: [{ plantingDate: APR_14 }, { plantingDate: APR_14 }],
      inputsTaskCount: 0,
      hasPlanRevision: null
    });
    expect(steps[2].state).toBe('done');
  });

  it('inputs done when at least one inputs task exists', () => {
    const steps = deriveSeasonWorkflow({
      seasonSetup: { modifiedAt: APR_2 },
      lastYearSetup: null,
      crops: [{ plantingDate: APR_14 }],
      inputsTaskCount: 5,
      hasPlanRevision: null
    });
    expect(steps[3].state).toBe('done');
    expect(steps[3].when).toBe('5 tasks');
  });

  it('commit auto-done when all four priors are done AND hasPlanRevision is null (proxy)', () => {
    const steps = deriveSeasonWorkflow({
      seasonSetup: { modifiedAt: APR_2 },
      lastYearSetup: null,
      crops: [{ plantingDate: APR_14 }],
      inputsTaskCount: 1,
      hasPlanRevision: null
    });
    expect(steps[4].state).toBe('done');
  });

  it('commit done when hasPlanRevision is true even if some priors are pending', () => {
    const steps = deriveSeasonWorkflow({
      seasonSetup: { modifiedAt: APR_2 },
      lastYearSetup: null,
      crops: [{ plantingDate: APR_14 }],
      inputsTaskCount: 0, // inputs pending
      hasPlanRevision: true
    });
    expect(steps[4].state).toBe('done');
  });

  it('commit pending when hasPlanRevision is explicitly false', () => {
    const steps = deriveSeasonWorkflow({
      seasonSetup: { modifiedAt: APR_2 },
      lastYearSetup: null,
      crops: [{ plantingDate: APR_14 }],
      inputsTaskCount: 1,
      hasPlanRevision: false
    });
    expect(steps[4].state).toBe('pending');
  });
});
