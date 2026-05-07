import { describe, expect, it } from 'vitest';
import { evaluateScout } from './scout';

describe('evaluateScout', () => {
  it('returns SKIP with zero spots and asks the user to re-walk', () => {
    const r = evaluateScout({ spots: [] });
    expect(r.decision).toBe('SKIP');
    expect(r.reason).toMatch(/re-walk/i);
  });

  it('returns SPRAY when average meets the 3/10 sq ft threshold', () => {
    const r = evaluateScout({ spots: [{ weedsPer10SqFt: 4 }, { weedsPer10SqFt: 3 }, { weedsPer10SqFt: 2 }] });
    expect(r.decision).toBe('SPRAY');
    expect(r.averagePer10SqFt).toBeCloseTo(3, 5);
  });

  it('returns SKIP when below threshold and no oversized weeds', () => {
    const r = evaluateScout({ spots: [{ weedsPer10SqFt: 1 }, { weedsPer10SqFt: 0 }, { weedsPer10SqFt: 2 }] });
    expect(r.decision).toBe('SKIP');
  });

  it('returns SPRAY when any weed exceeds the height trigger even if below density', () => {
    const r = evaluateScout({
      spots: [{ weedsPer10SqFt: 1 }, { weedsPer10SqFt: 1 }],
      maxWeedHeightInches: 3
    });
    expect(r.decision).toBe('SPRAY');
    expect(r.reason).toMatch(/3"/);
  });

  it('clamps negative spot counts to zero', () => {
    const r = evaluateScout({ spots: [{ weedsPer10SqFt: -1 }, { weedsPer10SqFt: 4 }] });
    expect(r.averagePer10SqFt).toBeCloseTo(2, 5);
  });
});
