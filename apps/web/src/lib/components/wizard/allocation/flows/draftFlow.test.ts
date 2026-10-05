import { describe, expect, it } from 'vitest';
import { resumeStepFor } from './draftFlow';

describe('resumeStepFor', () => {
  it('re-opens a draft saved after Blocks on Blocks, since the plan is in memory only', () => {
    for (const s of ['review', 'schedule', 'inputs', 'commit']) {
      expect(resumeStepFor(s)).toBe('blocks');
    }
  });

  it('keeps the steps that can mount cold', () => {
    expect(resumeStepFor('seeds')).toBe('seeds');
    expect(resumeStepFor('blocks')).toBe('blocks');
    expect(resumeStepFor('plan-state')).toBe('plan-state');
  });

  it('never resumes onto Season Setup or an unknown step', () => {
    expect(resumeStepFor('season-setup')).toBeNull();
    expect(resumeStepFor('nope')).toBeNull();
  });
});
