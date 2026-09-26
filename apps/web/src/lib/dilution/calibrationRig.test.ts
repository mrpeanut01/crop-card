import { describe, expect, it } from 'vitest';
import { calibrationRig } from './calibrationRig';

describe('calibrationRig', () => {
  it('walks hand sprayers and drives boom, ATV and 3-point rigs', () => {
    expect(calibrationRig({ templateId: 'sprayer-backpack-4gal' })).toBe('walk');
    expect(calibrationRig({ templateId: 'sprayer-25gal-atv' })).toBe('drive');
    expect(calibrationRig({ templateId: 'sprayer-50gal-pull' })).toBe('drive');
    expect(calibrationRig({ templateId: 'sprayer-200gal-3pt' })).toBe('drive');
    expect(calibrationRig({ templateId: 'sprayer-airblast-100gal' })).toBe('drive');
  });

  it('falls back to the name, then the tank size', () => {
    expect(calibrationRig({ label: 'Pull 50' })).toBe('drive');
    expect(calibrationRig({ label: 'Solo backpack' })).toBe('walk');
    expect(calibrationRig({ label: 'Old Blue', tankGal: 200 })).toBe('drive');
    expect(calibrationRig({ label: 'Old Blue' })).toBe('walk');
  });
});
