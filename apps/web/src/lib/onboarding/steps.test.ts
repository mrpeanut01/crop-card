import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  ONBOARDING_STEPS,
  basicsComplete,
  doneCount,
  firstIncomplete,
  nextAfter,
  previousStep,
  resolveStep,
  stepPhase,
  type OnboardingProgress
} from './steps';

const none: OnboardingProgress = {
  farm: false,
  location: false,
  fields: false,
  implements: false,
  season: false,
  plan: false
};
const basics: OnboardingProgress = {
  ...none,
  farm: true,
  location: true,
  fields: true,
  implements: true
};
const all: OnboardingProgress = { ...basics, season: true, plan: true };

const progressArb = fc.record({
  farm: fc.boolean(),
  location: fc.boolean(),
  fields: fc.boolean(),
  implements: fc.boolean(),
  season: fc.boolean(),
  plan: fc.boolean()
});

describe('onboarding steps', () => {
  it('orders farm basics before season planning', () => {
    const phases = ONBOARDING_STEPS.map((s) => s.phase);
    expect(phases.lastIndexOf('basics')).toBeLessThan(phases.indexOf('season'));
    expect(ONBOARDING_STEPS.map((s) => s.id)).toEqual([
      'farm',
      'location',
      'fields',
      'implements',
      'season',
      'plan'
    ]);
  });

  it('only shows the farm step before a farm exists', () => {
    for (const req of ['location', 'fields', 'implements', 'season', 'plan', null, 'nope']) {
      expect(resolveStep(req, none)).toBe('farm');
    }
  });

  it('closes the farm step once the farm exists', () => {
    expect(resolveStep('farm', { ...none, farm: true })).toBe('location');
  });

  it('lets a user jump between basics steps in any order', () => {
    const p = { ...none, farm: true };
    expect(resolveStep('implements', p)).toBe('implements');
    expect(resolveStep('fields', p)).toBe('fields');
  });

  it('locks the season phase until every basics step is done', () => {
    const p = { ...basics, implements: false };
    expect(resolveStep('season', p)).toBe('implements');
    expect(resolveStep('plan', p)).toBe('implements');
    expect(resolveStep('season', basics)).toBe('season');
  });

  it('falls back to the first undone step for a missing or bogus step', () => {
    expect(resolveStep(null, { ...none, farm: true, location: true })).toBe('fields');
    expect(resolveStep('bogus', basics)).toBe('season');
    expect(resolveStep(undefined, all)).toBe('plan');
  });

  it('never resolves to a season step while basics are incomplete', () => {
    fc.assert(
      fc.property(progressArb, fc.constantFrom(...ONBOARDING_STEPS.map((s) => s.id)), (p, req) => {
        const step = resolveStep(req, p);
        if (!basicsComplete(p)) expect(stepPhase(step)).toBe('basics');
        if (p.farm) expect(step).not.toBe('farm');
      })
    );
  });

  it('continues to the next undone step, wrapping to skipped ones', () => {
    const p = { ...none, farm: true };
    expect(nextAfter('location', p)).toBe('fields');
    expect(nextAfter('implements', { ...p, location: true, fields: true })).toBe('season');
    expect(nextAfter('implements', { ...p, location: true })).toBe('fields');
    expect(nextAfter('season', basics)).toBe('plan');
  });

  it('previous never walks back into the farm step', () => {
    expect(previousStep('location')).toBeNull();
    expect(previousStep('fields')).toBe('location');
    expect(previousStep('season')).toBe('implements');
  });

  it('counts done steps', () => {
    expect(doneCount(none)).toBe(0);
    expect(doneCount(basics)).toBe(4);
    expect(firstIncomplete(all)).toBe('plan');
  });
});
