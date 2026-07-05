import { describe, it, expect } from 'vitest';
import { evaluateHarvestPhi, type AppliedSpray } from './harvestPhi';
import { isWithinPhi } from './timeline';

const DAY_MS = 24 * 60 * 60 * 1000;
const HARVEST = Date.UTC(2026, 6, 1);

describe('#324 — at-harvest PHI check', () => {
  describe('isWithinPhi (shared interval math)', () => {
    it('is false when phiDays <= 0', () => {
      expect(isWithinPhi(HARVEST - 10 * DAY_MS, 0, HARVEST)).toBe(false);
      expect(isWithinPhi(HARVEST - 10 * DAY_MS, -5, HARVEST)).toBe(false);
    });
    it('is true when the harvest lands before the PHI clears', () => {
      // applied 3 days ago, 7-day PHI → clears 4 days from now
      expect(isWithinPhi(HARVEST - 3 * DAY_MS, 7, HARVEST)).toBe(true);
    });
    it('is false once the interval has fully cleared', () => {
      // applied 10 days ago, 7-day PHI → cleared 3 days ago
      expect(isWithinPhi(HARVEST - 10 * DAY_MS, 7, HARVEST)).toBe(false);
    });
    it('is exclusive at the clear boundary (== clearsAt is clear)', () => {
      // applied exactly 7 days ago with 7-day PHI → clears exactly now
      expect(isWithinPhi(HARVEST - 7 * DAY_MS, 7, HARVEST)).toBe(false);
    });
    it('ignores sprays applied after the harvest', () => {
      expect(isWithinPhi(HARVEST + DAY_MS, 7, HARVEST)).toBe(false);
    });
  });

  describe('evaluateHarvestPhi', () => {
    it('returns safe with no sprays', () => {
      const r = evaluateHarvestPhi([], HARVEST);
      expect(r.decision).toBe('safe');
      expect(r.conflicts).toEqual([]);
      expect(r.message).toBeUndefined();
    });

    it('returns safe when all sprays have cleared', () => {
      const sprays: AppliedSpray[] = [
        { productName: 'Roundup', kind: 'herbicide', appliedMs: HARVEST - 30 * DAY_MS, phiDays: 14 }
      ];
      expect(evaluateHarvestPhi(sprays, HARVEST).decision).toBe('safe');
    });

    it('warns when a product is still inside PHI, with days remaining', () => {
      const sprays: AppliedSpray[] = [
        {
          productName: 'Assail 30SG',
          kind: 'insecticide',
          appliedMs: HARVEST - 3 * DAY_MS,
          phiDays: 7
        }
      ];
      const r = evaluateHarvestPhi(sprays, HARVEST);
      expect(r.decision).toBe('warn');
      expect(r.conflicts).toHaveLength(1);
      expect(r.conflicts[0].daysRemaining).toBe(4);
      expect(r.message).toMatch(/Assail 30SG/);
      expect(r.message).toMatch(/pre-harvest interval/i);
    });

    it('accumulates multiple conflicting products and ignores cleared ones', () => {
      const sprays: AppliedSpray[] = [
        { productName: 'A', kind: 'insecticide', appliedMs: HARVEST - 1 * DAY_MS, phiDays: 5 },
        { productName: 'B', kind: 'fungicide', appliedMs: HARVEST - 2 * DAY_MS, phiDays: 10 },
        { productName: 'C', kind: 'herbicide', appliedMs: HARVEST - 40 * DAY_MS, phiDays: 14 }
      ];
      const r = evaluateHarvestPhi(sprays, HARVEST);
      expect(r.decision).toBe('warn');
      expect(r.conflicts.map((c) => c.productName)).toEqual(['A', 'B']);
    });

    it('daysRemaining is at least 1 even on the same-day boundary', () => {
      const sprays: AppliedSpray[] = [
        { productName: 'X', kind: 'fungicide', appliedMs: HARVEST - 6 * DAY_MS, phiDays: 7 }
      ];
      const r = evaluateHarvestPhi(sprays, HARVEST);
      expect(r.conflicts[0].daysRemaining).toBeGreaterThanOrEqual(1);
    });
  });
});
