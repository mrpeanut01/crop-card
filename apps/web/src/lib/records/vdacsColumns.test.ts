import { describe, expect, it } from 'vitest';
import { areaTreatedLine, conditionsText, perAcre, totalAppliedLine } from './vdacsColumns';

describe('VDACS audit columns', () => {
  it('shows rates per acre', () => {
    expect(perAcre({ amount: 16, unit: 'fl-oz' })).toBe('16 fl-oz/A');
    expect(perAcre({ amount: 2, unit: 'lb/A' })).toBe('2 lb/A');
    expect(perAcre(undefined)).toBe('');
  });

  it('gives the area treated and the total applied from the block size', () => {
    expect(areaTreatedLine(2.5)).toBe('2.5 ac');
    expect(areaTreatedLine(0)).toBe('Not on file');
    expect(totalAppliedLine([{ name: '2,4-D', rate: { amount: 16, unit: 'fl-oz' } }], 2.5)).toBe(
      '2,4-D: 40 fl-oz'
    );
    expect(totalAppliedLine([{ name: '2,4-D', rate: { amount: 16, unit: 'fl-oz' } }], null)).toBe(
      '—'
    );
  });

  it('says when the conditions were untouched defaults', () => {
    expect(conditionsText('5mph / 70°F / 0mm', 'default')).toBe(
      '5mph / 70°F / 0mm (defaults, not measured)'
    );
    expect(conditionsText('12mph / 81°F / 0mm', 'measured')).toBe('12mph / 81°F / 0mm');
  });
});
