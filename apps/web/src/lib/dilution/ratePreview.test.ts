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

describe('herbicideRatePreview metric display', () => {
  const metric = { units: 'metric' as const };

  it('keeps the label rate first and adds metric equivalents for metric users', () => {
    const p = herbicideRatePreview({ amount: 22, unit: 'fl-oz' }, { calibratedGpa: 15 }, metric);
    expect(p).toEqual({
      kind: 'calibrated',
      label: '22 fl-oz/A (1,608 mL/ha) @ 15 GPA (140 L/ha)',
      gpa: 15
    });
  });

  it('converts pints, pounds and dry ounces per acre', () => {
    expect(herbicideRatePreview({ amount: 1, unit: 'pt' }, null, metric).label).toBe(
      '1 pt/A (1,169 mL/ha) · pick a sprayer for GPA'
    );
    expect(herbicideRatePreview({ amount: 2, unit: 'lb' }, null, metric).label).toBe(
      '2 lb/A (2 kg/ha) · pick a sprayer for GPA'
    );
    expect(herbicideRatePreview(rate, { calibratedGpa: null }, metric).label).toBe(
      '32 oz/A (2,242 g/ha) · sprayer uncalibrated'
    );
  });

  it('leaves unknown units label-only', () => {
    expect(herbicideRatePreview({ amount: 3, unit: 'bags' }, null, metric).label).toBe(
      '3 bags/A · pick a sprayer for GPA'
    );
  });

  it('US output is unchanged', () => {
    expect(
      herbicideRatePreview({ amount: 22, unit: 'fl-oz' }, { calibratedGpa: 15 }, { units: 'us' })
        .label
    ).toBe('22 fl-oz/A @ 15 GPA');
  });
});
