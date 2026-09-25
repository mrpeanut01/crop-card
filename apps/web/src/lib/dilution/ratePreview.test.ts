import { describe, expect, it } from 'vitest';
import { herbicideRatePreview } from './ratePreview';

const rate = { amount: 32, unit: 'oz' };

describe('herbicideRatePreview (#218)', () => {
  it('uses the active sprayer calibrated GPA, not the plugin reference', () => {
    const p = herbicideRatePreview(rate, { calibratedGpa: 22 });
    expect(p).toEqual({ kind: 'calibrated', label: '32 oz/A @ 22 GPA', gpa: 22 });
    expect(p.label).not.toContain('15 GPA');
  });

  it('reports uncalibrated instead of inventing a GPA', () => {
    const p = herbicideRatePreview(rate, { calibratedGpa: null });
    expect(p.kind).toBe('uncalibrated');
    expect(p.label).toBe('32 oz/A · sprayer uncalibrated');
    expect(p.label).not.toMatch(/GPA/);
  });

  it('treats non-positive or non-finite GPA as uncalibrated', () => {
    for (const g of [0, -3, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(herbicideRatePreview(rate, { calibratedGpa: g }).kind).toBe('uncalibrated');
    }
  });

  it('prompts for a sprayer when none is selected', () => {
    expect(herbicideRatePreview(rate, undefined).kind).toBe('no-sprayer');
    expect(herbicideRatePreview(rate, null).label).toBe('32 oz/A · pick a sprayer for GPA');
  });
});
