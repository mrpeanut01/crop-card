import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { capacityState, effectiveGroupFoodProducing, groupTotal } from './counts';

describe('groupTotal', () => {
  it('adds active named members to the unnamed head count', () => {
    expect(
      groupTotal({ headCount: 20 }, [
        { status: 'active' },
        { status: 'active' },
        { status: 'died' },
        { status: 'archived' }
      ])
    ).toBe(22);
    expect(groupTotal({ headCount: null }, [])).toBe(0);
  });

  it('never double counts when a named animal changes status', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 500 }),
        fc.array(fc.constantFrom('active', 'sold', 'died', 'culled', 'rehomed', 'archived')),
        (headCount, statuses) => {
          const members = statuses.map((status) => ({ status }));
          const total = groupTotal({ headCount }, members);
          expect(total).toBe(headCount + statuses.filter((s) => s === 'active').length);
        }
      )
    );
  });
});

describe('effectiveGroupFoodProducing', () => {
  it('is true when the group or any active member is food-producing', () => {
    expect(effectiveGroupFoodProducing({ foodProducing: true }, [])).toBe(true);
    expect(
      effectiveGroupFoodProducing({ foodProducing: false }, [
        { status: 'active', foodProducing: true }
      ])
    ).toBe(true);
    expect(
      effectiveGroupFoodProducing({ foodProducing: false }, [
        { status: 'died', foodProducing: true },
        { status: 'active', foodProducing: false }
      ])
    ).toBe(false);
  });
});

describe('capacityState', () => {
  it('reports over capacity without blocking', () => {
    expect(capacityState(24, 26)).toEqual({ capacity: 24, count: 26, over: true });
    expect(capacityState(24, 24)).toEqual({ capacity: 24, count: 24, over: false });
    expect(capacityState(undefined, 3)).toBeNull();
    expect(capacityState(0, 3)).toBeNull();
  });
});
