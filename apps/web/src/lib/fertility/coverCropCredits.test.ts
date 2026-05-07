import { describe, expect, it } from 'vitest';
import { defaultCoverCredit } from './coverCropCredits';

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
