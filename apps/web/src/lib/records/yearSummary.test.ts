/**
 * UC-46 — Year-end summary aggregate tests.
 *
 * Exercises the pure fold (`computeYearSummary`) + its helpers with fixture
 * rows. No DB — the orchestrator's tenant-scoped reads are covered by the
 * cross-tenant hardening test in `exports.crossTenant.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import type { Archetype } from '$lib/plugins/schemas';
import {
  computeInputCosts,
  computeScoutFunnel,
  computeYearSummary,
  parseMoisturePct,
  type ComputeYearSummaryInput,
  type SprayApplicationRow
} from './yearSummary';

const YEAR = 2026;

function baseInput(over: Partial<ComputeYearSummaryInput> = {}): ComputeYearSummaryInput {
  return {
    year: YEAR,
    ownerId: 'owner-1',
    generatedAtMs: Date.UTC(2026, 6, 1),
    philosophy: 'conventional',
    applications: [],
    harvests: [],
    scoutObservations: [],
    movements: [],
    sprayers: [],
    acresForBlock: () => 0,
    archetypeForPlugin: () => 'winter-squash-cure',
    productAllowed: () => undefined,
    ...over
  };
}

describe('parseMoisturePct', () => {
  it('extracts a moisture=<n>% tag from quantity', () => {
    expect(
      parseMoisturePct({ cropPluginId: 'x', occurredAtMs: 0, quantity: 'bu=40; moisture=15.5%' })
    ).toBe(15.5);
  });
  it('extracts from lotNumber when quantity has none', () => {
    expect(
      parseMoisturePct({ cropPluginId: 'x', occurredAtMs: 0, lotNumber: 'LOT-1 moisture 13%' })
    ).toBe(13);
  });
  it('returns null with no tag', () => {
    expect(parseMoisturePct({ cropPluginId: 'x', occurredAtMs: 0, quantity: '40 bu' })).toBeNull();
  });
  it('rejects out-of-range readings', () => {
    expect(
      parseMoisturePct({ cropPluginId: 'x', occurredAtMs: 0, quantity: 'moisture=150%' })
    ).toBeNull();
  });
});

describe('computeYearSummary — application totals + acreage', () => {
  it('tallies applications by kind + treated blocks', () => {
    const apps: SprayApplicationRow[] = [
      {
        kind: 'herbicide',
        blockId: 'b1',
        occurredAtMs: Date.UTC(2026, 3, 1),
        products: [{ productId: 'gly', displayName: 'Glyphosate', classes: ['EPSP-9'] }]
      },
      {
        kind: 'insecticide',
        blockId: 'b1',
        occurredAtMs: Date.UTC(2026, 4, 1),
        products: [{ productId: 'bt', displayName: 'Bt', classes: ['11A'] }]
      },
      {
        kind: 'fungicide',
        blockId: 'b2',
        occurredAtMs: Date.UTC(2026, 5, 1),
        products: [{ productId: 'cu', displayName: 'Copper', classes: ['M01'] }]
      }
    ];
    const out = computeYearSummary(
      baseInput({ applications: apps, acresForBlock: (b) => (b === 'b1' ? 2 : 5) })
    );
    expect(out.totals.sprayApplications).toBe(1);
    expect(out.totals.insecticideApplications).toBe(1);
    expect(out.totals.fungicideApplications).toBe(1);
    expect(out.totals.totalApplications).toBe(3);
    expect(out.totals.blocksTreated).toBe(2);
  });

  it('sums treated-acre passes per product and per class (a block sprayed twice counts twice)', () => {
    const apps: SprayApplicationRow[] = [
      {
        kind: 'herbicide',
        blockId: 'b1',
        occurredAtMs: 1,
        products: [{ productId: 'gly', displayName: 'Gly', classes: ['EPSP-9'] }]
      },
      {
        kind: 'herbicide',
        blockId: 'b1',
        occurredAtMs: 2,
        products: [{ productId: 'gly', displayName: 'Gly', classes: ['EPSP-9'] }]
      }
    ];
    const out = computeYearSummary(baseInput({ applications: apps, acresForBlock: () => 3 }));
    expect(out.productAcreage).toHaveLength(1);
    expect(out.productAcreage[0].acresTreated).toBe(6);
    expect(out.productAcreage[0].applicationCount).toBe(2);
    expect(out.chemistryClassAcreage[0].acresTreated).toBe(6);
  });

  it('de-dupes a repeated class within a single application', () => {
    const apps: SprayApplicationRow[] = [
      {
        kind: 'insecticide',
        blockId: 'b1',
        occurredAtMs: 1,
        products: [
          { productId: 'a', displayName: 'A', classes: ['3A'] },
          { productId: 'b', displayName: 'B', classes: ['3A'] }
        ]
      }
    ];
    const out = computeYearSummary(baseInput({ applications: apps, acresForBlock: () => 4 }));
    // Two products → two product rows, but the shared class counts the
    // application once (acres = 4, not 8).
    expect(out.productAcreage).toHaveLength(2);
    const cls = out.chemistryClassAcreage.find((c) => c.className === '3A');
    expect(cls?.applicationCount).toBe(1);
    expect(cls?.acresTreated).toBe(4);
  });
});

describe('computeYearSummary — philosophy roll-up', () => {
  const apps: SprayApplicationRow[] = [
    {
      kind: 'herbicide',
      blockId: 'b',
      occurredAtMs: 1,
      products: [{ productId: 'allowed', displayName: 'A', classes: [] }]
    },
    {
      kind: 'herbicide',
      blockId: 'b',
      occurredAtMs: 2,
      products: [{ productId: 'denied', displayName: 'D', classes: [] }]
    },
    {
      kind: 'herbicide',
      blockId: 'b',
      occurredAtMs: 3,
      products: [{ productId: 'unknown', displayName: 'U', classes: [] }]
    }
  ];

  it('classifies compliant / non-compliant / unknown', () => {
    const out = computeYearSummary(
      baseInput({
        applications: apps,
        philosophy: 'certified-organic',
        productAllowed: (id) => (id === 'allowed' ? true : id === 'denied' ? false : undefined)
      })
    );
    expect(out.philosophy.compliantApplications).toBe(1);
    expect(out.philosophy.nonCompliantApplications).toBe(1);
    expect(out.philosophy.unknownApplications).toBe(1);
    expect(out.philosophy.philosophy).toBe('certified-organic');
  });

  it('a mixed tank-mix with one disallowed product is non-compliant', () => {
    const mix: SprayApplicationRow[] = [
      {
        kind: 'herbicide',
        blockId: 'b',
        occurredAtMs: 1,
        products: [
          { productId: 'ok', displayName: 'ok', classes: [] },
          { productId: 'bad', displayName: 'bad', classes: [] }
        ]
      }
    ];
    const out = computeYearSummary(
      baseInput({
        applications: mix,
        productAllowed: (id) => id === 'ok'
      })
    );
    expect(out.philosophy.nonCompliantApplications).toBe(1);
    expect(out.philosophy.compliantApplications).toBe(0);
  });
});

describe('computeYearSummary — harvest by archetype + moisture', () => {
  it('buckets by archetype and computes moisture min/mean/max', () => {
    const archetypeMap: Record<string, Archetype> = {
      wheat: 'small-grain.zadoks',
      squash: 'winter-squash-cure'
    };
    const out = computeYearSummary(
      baseInput({
        harvests: [
          { cropPluginId: 'wheat', occurredAtMs: 1, quantity: 'moisture=12%' },
          { cropPluginId: 'wheat', occurredAtMs: 2, quantity: 'moisture=14%' },
          { cropPluginId: 'wheat', occurredAtMs: 3, quantity: 'no reading' },
          { cropPluginId: 'squash', occurredAtMs: 4, quantity: 'moisture=70%' }
        ],
        archetypeForPlugin: (id) => archetypeMap[id] ?? 'winter-squash-cure'
      })
    );
    expect(out.totals.harvestEvents).toBe(4);
    const wheat = out.harvestByArchetype.find((h) => h.archetype === 'small-grain.zadoks');
    expect(wheat?.eventCount).toBe(3);
    expect(wheat?.cropCount).toBe(1);
    expect(wheat?.moisture.sampleCount).toBe(2);
    expect(wheat?.moisture.min).toBe(12);
    expect(wheat?.moisture.max).toBe(14);
    expect(wheat?.moisture.mean).toBe(13);
  });

  it('reports null moisture stats when no readings are present', () => {
    const out = computeYearSummary(
      baseInput({
        harvests: [{ cropPluginId: 'x', occurredAtMs: 1, quantity: '40 lb' }],
        archetypeForPlugin: () => 'continuous-harvest-fruit'
      })
    );
    const bucket = out.harvestByArchetype[0];
    expect(bucket.moisture.sampleCount).toBe(0);
    expect(bucket.moisture.mean).toBeNull();
  });
});

describe('computeInputCosts', () => {
  it('prices consumption (negative deltas) by lot cost per unit, per category', () => {
    const { lines, totalCents } = computeInputCosts([
      // 2 units consumed at 500¢/unit = 1000¢
      {
        category: 'herbicide',
        deltaHundredths: -200,
        lotCostCentsPerUnit: 500,
        reason: 'spray-event'
      },
      // 1 unit consumed at 300¢/unit = 300¢
      {
        category: 'herbicide',
        deltaHundredths: -100,
        lotCostCentsPerUnit: 300,
        reason: 'spray-event'
      },
      // fertilizer 5 units at 100¢ = 500¢
      {
        category: 'fertilizer',
        deltaHundredths: -500,
        lotCostCentsPerUnit: 100,
        reason: 'fertility-application'
      },
      // receipts + unknown cost are ignored
      { category: 'herbicide', deltaHundredths: 400, lotCostCentsPerUnit: 500, reason: 'receipt' },
      { category: 'seed', deltaHundredths: -100, lotCostCentsPerUnit: null, reason: 'planting' }
    ]);
    const herb = lines.find((l) => l.category === 'herbicide');
    expect(herb?.costCents).toBe(1300);
    expect(lines.find((l) => l.category === 'fertilizer')?.costCents).toBe(500);
    expect(lines.find((l) => l.category === 'seed')).toBeUndefined();
    expect(totalCents).toBe(1800);
    // Sorted descending by cost.
    expect(lines[0].category).toBe('herbicide');
  });
});

describe('computeScoutFunnel', () => {
  it('counts threshold-triggered applications and sprays avoided', () => {
    const apps: SprayApplicationRow[] = [
      // Fired on an at-threshold observation.
      {
        kind: 'insecticide',
        blockId: 'b1',
        occurredAtMs: Date.UTC(2026, 5, 5),
        products: [],
        observation: { value: 10, threshold: 8 }
      }
    ];
    const funnel = computeScoutFunnel(apps, [
      // b1 observation that saw a follow-up spray within 14d → not avoided.
      { blockId: 'b1', occurredAtMs: Date.UTC(2026, 5, 1), value: 9 },
      // b2 observation with no follow-up application → avoided.
      { blockId: 'b2', occurredAtMs: Date.UTC(2026, 5, 1), value: 3 }
    ]);
    expect(funnel.thresholdTriggeredApplications).toBe(1);
    expect(funnel.scoutObservations).toBe(2);
    expect(funnel.spraysAvoided).toBe(1);
  });

  it('an observation whose follow-up spray falls outside the window counts as avoided', () => {
    const apps: SprayApplicationRow[] = [
      {
        kind: 'herbicide',
        blockId: 'b1',
        occurredAtMs: Date.UTC(2026, 6, 1),
        products: []
      }
    ];
    const funnel = computeScoutFunnel(apps, [
      { blockId: 'b1', occurredAtMs: Date.UTC(2026, 5, 1), value: 3 }
    ]);
    expect(funnel.spraysAvoided).toBe(1);
  });
});

describe('computeYearSummary — compliance stats', () => {
  it('counts calibrated sprayers + this-year calibration/decon events', () => {
    const out = computeYearSummary(
      baseInput({
        sprayers: [
          {
            calibratedGpa: 15,
            calibrationDateMs: Date.UTC(2026, 2, 1),
            lastDeconAtMs: Date.UTC(2026, 3, 1)
          },
          { calibratedGpa: 12, calibrationDateMs: Date.UTC(2025, 2, 1) },
          { calibratedGpa: null }
        ]
      })
    );
    expect(out.compliance.sprayerCount).toBe(3);
    expect(out.compliance.calibratedSprayerCount).toBe(2);
    expect(out.compliance.calibratedThisYear).toBe(1);
    expect(out.compliance.deconEventsThisYear).toBe(1);
  });
});
