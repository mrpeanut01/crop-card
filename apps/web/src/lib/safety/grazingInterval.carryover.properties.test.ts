import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { GrazingRestrictions } from '$lib/plugins/schemas';
import { farmCopyRestrictions, hayOffFarmRestrictedFor } from './grazingInterval';

const RUNS = { numRuns: 500 };
const days = fc.option(fc.integer({ min: 0, max: 3650 }), { nil: undefined });
const flag = fc.option(fc.boolean(), { nil: undefined });

const restrictionsArb: fc.Arbitrary<GrazingRestrictions> = fc
  .record({
    grazeDays: days,
    hayDays: days,
    lactatingDairyGrazeDays: days,
    meatAnimalRemovalBeforeSlaughterDays: days,
    notForPasture: flag,
    manureCarryover: flag,
    manureCarryoverDays: days,
    hayOffFarmRestricted: flag
  })
  .map((r) => {
    const out: GrazingRestrictions = { source: 'label' };
    for (const [k, v] of Object.entries(r)) {
      if (v !== undefined) (out as Record<string, unknown>)[k] = v;
    }
    if (out.manureCarryoverDays !== undefined) out.manureCarryover = true;
    return out;
  });

const pair = fc.tuple(
  fc.option(restrictionsArb, { nil: null }),
  fc.option(restrictionsArb, { nil: null })
);

describe('farmCopyRestrictions: Phase 33C carryover fields (M-19)', () => {
  it('a farm copy can never shorten or fill in manureCarryoverDays', () => {
    fc.assert(
      fc.property(pair, ([base, farm]) => {
        const merged = farmCopyRestrictions(base, farm);
        const was = base?.manureCarryoverDays;
        const now = merged?.manureCarryoverDays;
        if (was === undefined) expect(now).toBeUndefined();
        else {
          expect(now).toBeDefined();
          expect(now!).toBeGreaterThanOrEqual(was);
          if (farm?.manureCarryoverDays !== undefined) {
            expect(now).toBe(Math.max(was, farm.manureCarryoverDays));
          }
        }
      }),
      RUNS
    );
  });

  it('a shared hayOffFarmRestricted is never lost, and a farm copy can turn it on', () => {
    fc.assert(
      fc.property(pair, ([base, farm]) => {
        const merged = farmCopyRestrictions(base, farm);
        if (base?.hayOffFarmRestricted === true) expect(merged?.hayOffFarmRestricted).toBe(true);
        if (base && farm?.hayOffFarmRestricted === true) {
          expect(merged?.hayOffFarmRestricted).toBe(true);
        }
        if (base?.hayOffFarmRestricted !== true && farm?.hayOffFarmRestricted !== true) {
          expect(merged?.hayOffFarmRestricted === true).toBe(false);
        }
        expect(hayOffFarmRestrictedFor(base, farm)).toBe(
          base?.hayOffFarmRestricted === true || farm?.hayOffFarmRestricted === true
        );
      }),
      RUNS
    );
  });

  it('the new fields never change whether a restrictions block exists', () => {
    fc.assert(
      fc.property(pair, ([base, farm]) => {
        const strip = (r: GrazingRestrictions | null): GrazingRestrictions | null => {
          if (!r) return r;
          const { manureCarryoverDays: _d, hayOffFarmRestricted: _h, ...rest } = r;
          return rest;
        };
        const merged = farmCopyRestrictions(base, farm);
        const without = farmCopyRestrictions(strip(base), strip(farm));
        expect(merged === null).toBe(without === null);
        expect(strip(merged)).toEqual(without);
      }),
      RUNS
    );
  });
});

describe('farmCopyRestrictions: examples', () => {
  const base: GrazingRestrictions = {
    source: 'GrazonNext HL label',
    grazeDays: 0,
    manureCarryover: true,
    manureCarryoverDays: 3,
    hayOffFarmRestricted: true
  };

  it('keeps the shared 3 days against a shorter farm value', () => {
    const merged = farmCopyRestrictions(base, {
      source: 'farm',
      manureCarryover: true,
      manureCarryoverDays: 1
    });
    expect(merged?.manureCarryoverDays).toBe(3);
    expect(merged?.hayOffFarmRestricted).toBe(true);
  });

  it('takes a longer farm value', () => {
    const merged = farmCopyRestrictions(base, {
      source: 'farm',
      manureCarryover: true,
      manureCarryoverDays: 10
    });
    expect(merged?.manureCarryoverDays).toBe(10);
  });

  it('does not let a farm copy fill in an absent shared value', () => {
    const merged = farmCopyRestrictions(
      { source: 'label', manureCarryover: true },
      { source: 'farm', manureCarryover: true, manureCarryoverDays: 2 }
    );
    expect(merged?.manureCarryoverDays).toBeUndefined();
  });

  it('a farm-only plugin with just the hay flag gains no restrictions block', () => {
    const farm: GrazingRestrictions = { source: 'farm', hayOffFarmRestricted: true };
    expect(farmCopyRestrictions(null, farm)).toBeNull();
    expect(hayOffFarmRestrictedFor(null, farm)).toBe(true);
  });

  it('a farm-only notForPasture block carries the hay flag', () => {
    const merged = farmCopyRestrictions(null, {
      source: 'farm',
      notForPasture: true,
      hayOffFarmRestricted: true
    });
    expect(merged).toEqual({ source: 'farm', notForPasture: true, hayOffFarmRestricted: true });
  });
});
