// @vitest-environment node
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DAY_MS, type GrazingApplication } from '$lib/safety/grazingInterval';
import type { GrazingRestrictions } from '$lib/plugins/schemas';
import { cutShortensHolds } from './areaGrazing';

const TZ = 'America/New_York';
const NOW = Date.UTC(2026, 8, 27, 16);

function app(
  appliedAtMs: number,
  restrictions: GrazingRestrictions | null = null
): GrazingApplication {
  return {
    ref: `spray:${appliedAtMs}`,
    source: 'spray',
    blockId: 'b1',
    appliedAtMs,
    productPluginId: 'weedkill',
    productName: 'Weedkill',
    restrictions,
    activeIngredients: []
  };
}

function cut(input: {
  fromMs: number;
  toMs?: number | null;
  cutAtMs: number;
  applications: GrazingApplication[];
}) {
  return cutShortensHolds({
    stay: { fieldId: 'f1', fromMs: input.fromMs, toMs: input.toMs ?? null },
    cutAtMs: input.cutAtMs,
    applications: input.applications,
    attestations: [],
    registryMaxIntervalDays: 0,
    timeZone: TZ,
    nowMs: NOW
  });
}

const remover: GrazingRestrictions = {
  source: 'test label',
  grazeDays: 0,
  hayDays: 0,
  meatAnimalRemovalBeforeSlaughterDays: 3
};

describe('cutShortensHolds', () => {
  it('refuses a cut that ends a running pre-slaughter removal sooner', () => {
    const applications = [app(NOW - 30 * DAY_MS, remover)];
    expect(cut({ fromMs: NOW - 10 * DAY_MS, cutAtMs: NOW - 5 * DAY_MS, applications })).toBe(true);
    expect(cut({ fromMs: NOW - 10 * DAY_MS, cutAtMs: NOW - 1000, applications })).toBe(false);
    expect(
      cut({
        fromMs: NOW - 20 * DAY_MS,
        toMs: NOW - 10 * DAY_MS,
        cutAtMs: NOW - 12 * DAY_MS,
        applications
      })
    ).toBe(false);
  });

  it('keeps a stored floor in the comparison', () => {
    const application = app(NOW - 10 * DAY_MS, {
      source: 'test label',
      grazeDays: 5,
      hayDays: 5,
      lactatingDairyGrazeDays: 5,
      meatAnimalRemovalBeforeSlaughterDays: 0
    });
    const floor = [
      {
        ref: application.ref,
        productPluginId: 'weedkill',
        food: 'eggs' as const,
        lactating: true,
        exposedAtMs: NOW - 2 * 3_600_000,
        clearsAtMs: NOW + 20 * DAY_MS
      }
    ];
    const withFloor = (floored: boolean) =>
      cutShortensHolds({
        stay: {
          fieldId: 'f1',
          fromMs: NOW - 2 * 3_600_000,
          toMs: null,
          ...(floored ? { floor } : {})
        },
        cutAtMs: NOW - 3 * 3_600_000,
        applications: [application],
        attestations: [],
        registryMaxIntervalDays: 0,
        timeZone: TZ,
        nowMs: NOW
      });
    expect(withFloor(true)).toBe(true);
    expect(withFloor(false)).toBe(false);
  });

  it('property: never refuses a cut at the request moment or with nothing sprayed', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 200 }),
        fc.integer({ min: 0, max: 4_999 }),
        fc.array(fc.integer({ min: 0, max: 300 }), { maxLength: 4 }),
        (arrivedDaysAgo, msAgo, sprays) => {
          const applications = sprays.map((d) => app(NOW - d * DAY_MS));
          const fromMs = NOW - arrivedDaysAgo * DAY_MS;
          expect(cut({ fromMs, cutAtMs: NOW - msAgo, applications })).toBe(false);
          expect(cut({ fromMs, cutAtMs: fromMs + 1, applications: [] })).toBe(false);
        }
      )
    );
  });

  it('property: always refuses cutting away an unsourced spray made while they were there', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 300 }),
        fc.double({ min: 0.01, max: 0.99, noNaN: true }),
        fc.double({ min: 0.01, max: 0.99, noNaN: true }),
        (arrivedDaysAgo, sprayAt, cutAt) => {
          const fromMs = NOW - arrivedDaysAgo * DAY_MS;
          const cutAtMs = Math.round(fromMs + cutAt * (NOW - DAY_MS - fromMs));
          const appliedAtMs = Math.round(cutAtMs + sprayAt * (NOW - DAY_MS - cutAtMs)) + 1;
          expect(cut({ fromMs, cutAtMs, applications: [app(appliedAtMs)] })).toBe(true);
        }
      )
    );
  });
});
