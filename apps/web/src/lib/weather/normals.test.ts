import { describe, expect, it } from 'vitest';
import { LOUDOUN_VA, soilTempForDayOfYear } from './normals';

describe('soilTempForDayOfYear', () => {
  it('hits each month anchor on the 15th', () => {
    expect(soilTempForDayOfYear(15)).toBe(LOUDOUN_VA.monthlyMeanF[0]);
    expect(soilTempForDayOfYear(196)).toBe(LOUDOUN_VA.monthlyMeanF[6]);
    expect(soilTempForDayOfYear(349)).toBe(LOUDOUN_VA.monthlyMeanF[11]);
  });

  it('interpolates from mid-December toward mid-January across the new year', () => {
    const dec = LOUDOUN_VA.monthlyMeanF[11];
    const jan = LOUDOUN_VA.monthlyMeanF[0];
    const dec31 = soilTempForDayOfYear(365);
    expect(dec31).toBeLessThan(dec);
    expect(dec31).toBeGreaterThan(jan);
    expect(soilTempForDayOfYear(1)).toBeLessThan(dec31);
  });

  it('is continuous over the year boundary', () => {
    expect(Math.abs(soilTempForDayOfYear(365) - soilTempForDayOfYear(1))).toBeLessThan(0.5);
  });
});
