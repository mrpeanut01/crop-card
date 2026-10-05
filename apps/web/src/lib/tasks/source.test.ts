import { describe, expect, it } from 'vitest';
import { taskSourceLabel } from './source';

describe('taskSourceLabel', () => {
  it('names the source instead of showing the template key', () => {
    expect(taskSourceLabel('crop:tomato:pre:stake')).toBe('Crop plan');
    expect(taskSourceLabel('equipment:boom:post:rinse')).toBe('Equipment');
    expect(taskSourceLabel('seedstart:c1:sow')).toBe('Seed start');
    expect(taskSourceLabel('care:p1:2026-10-01')).toBe('Care plan');
    expect(taskSourceLabel('companion-check:g1:c1')).toBe('Companion check');
    expect(taskSourceLabel('derived:frost:b1:1')).toBe('Suggestion');
    expect(taskSourceLabel('something-else')).toBe('Plan template');
    expect(taskSourceLabel(null)).toBe('Manual');
  });

  it('follows the locale', () => {
    expect(taskSourceLabel('crop:tomato:plant', 'es')).toBe('Plan del cultivo');
    expect(taskSourceLabel(undefined, 'es')).toBe('Manual');
  });
});
