import { describe, it, expect } from 'vitest';
import { deriveSeasonWorkflow, withStepRoutes, workflowStepRoute } from './seasonWorkflow';

const APR_2 = Date.UTC(2026, 3, 2);
const APR_8 = Date.UTC(2026, 3, 8);
const APR_14 = Date.UTC(2026, 3, 14);

const fresh = () =>
  deriveSeasonWorkflow({
    seasonSetup: null,
    lastYearSetup: null,
    crops: [],
    inputsTaskCount: 0,
    hasPlanRevision: null
  });
const allocated = (inputsTaskCount: number, hasPlanRevision: boolean) =>
  deriveSeasonWorkflow({
    seasonSetup: { modifiedAt: APR_2 },
    lastYearSetup: null,
    crops: [{ plantingDate: APR_8 }, { plantingDate: APR_14 }],
    inputsTaskCount,
    hasPlanRevision
  });

describe('workflowStepRoute (#120)', () => {
  it('season setup + allocation always open the wizard at that step', () => {
    for (const steps of [fresh(), allocated(3, true)]) {
      expect(workflowStepRoute('season-setup', steps).target).toEqual({
        kind: 'wizard',
        wizardStep: 'season-setup'
      });
      expect(workflowStepRoute('allocation', steps).target).toEqual({
        kind: 'wizard',
        wizardStep: 'allocation'
      });
    }
  });

  it('schedule / inputs / commit are unreachable before allocation runs', () => {
    const steps = fresh();
    for (const id of ['schedule', 'inputs', 'commit']) {
      const r = workflowStepRoute(id, steps);
      expect(r.target).toBeNull();
      expect(r.hint.length).toBeGreaterThan(0);
    }
  });

  it('after allocation: schedule → calendar, inputs pending → wizard, commit pending → disabled', () => {
    const steps = allocated(0, false);
    expect(workflowStepRoute('schedule', steps).target).toEqual({ kind: 'calendar' });
    expect(workflowStepRoute('inputs', steps).target).toEqual({
      kind: 'wizard',
      wizardStep: 'allocation'
    });
    expect(workflowStepRoute('commit', steps).target).toBeNull();
  });

  it('committed plan: inputs → tasks card, commit → provenance', () => {
    const steps = allocated(4, true);
    expect(workflowStepRoute('inputs', steps).target).toEqual({ kind: 'tasks' });
    expect(workflowStepRoute('commit', steps).target).toEqual({ kind: 'provenance' });
  });

  it('unknown ids are inert', () => {
    expect(workflowStepRoute('nope', fresh()).target).toBeNull();
  });

  it('withStepRoutes marks unreachable steps disabled and attaches hints', () => {
    const routed = withStepRoutes(fresh());
    expect(routed.map((s) => s.disabled)).toEqual([false, false, true, true, true]);
    expect(routed.every((s) => typeof s.actionHint === 'string')).toBe(true);
    expect(withStepRoutes(allocated(4, true)).every((s) => !s.disabled)).toBe(true);
  });
});
