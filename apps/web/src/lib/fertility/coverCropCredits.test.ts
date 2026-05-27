import { describe, expect, it } from 'vitest';
import { defaultCoverCredit, nCreditForIntent } from './coverCropCredits';

describe('defaultCoverCredit', () => {
  it('returns N-fixing legumes with non-zero N', () => {
    const cc = defaultCoverCredit('crimson-clover-cover');
    expect(cc).toBeDefined();
    expect(cc!.nLbPerAcre).toBeGreaterThan(0);
  });

  it('returns grass covers with low or zero N (only residue credit)', () => {
    const oats = defaultCoverCredit('oats-cover-spring');
    expect(oats).toBeDefined();
    expect(oats!.nLbPerAcre).toBeLessThan(30);
  });

  it('returns undefined for an unknown plugin id', () => {
    expect(defaultCoverCredit('not-a-real-cover-crop')).toBeUndefined();
  });

  it('always provides a rationale string when defined', () => {
    const cc = defaultCoverCredit('austrian-winter-pea-cover');
    expect(cc).toBeDefined();
    expect(cc!.rationale.length).toBeGreaterThan(0);
  });
});

describe('nCreditForIntent (#228)', () => {
  it('vetch-clover returns 65 lb-N/ac', () => {
    expect(nCreditForIntent('vetch-clover')).toBe(65);
  });
  it('fall-cereal returns 0 (non-legume, no fixation)', () => {
    expect(nCreditForIntent('fall-cereal')).toBe(0);
  });
  it('other returns 0 (conservative when unknown)', () => {
    expect(nCreditForIntent('other')).toBe(0);
  });
  it('none returns 0', () => {
    expect(nCreditForIntent('none')).toBe(0);
  });
});
