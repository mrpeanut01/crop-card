/**
 * F-C / HCD Guide §4 — plugin schema v1.1 additive validation.
 *
 * Verifies that v1.1 fields (cropOperationModel, hayOperations,
 * zadoksStages, moistureGates) are accepted and that v1.0 plugins remain
 * valid without those fields.
 */

import { describe, expect, it } from 'vitest';
import { cropPluginSchema } from './schemas';

describe('cropPluginSchema v1.1 additive fields', () => {
  it('accepts a v1.0 minimal crop plugin with the now-required harvestStyle + bloomWindow (Phase 25c.0 #87/#99)', () => {
    const v10 = {
      pluginId: 'corn',
      type: 'crop' as const,
      displayName: 'Corn',
      version: '1.0.0',
      cropFamily: 'corn' as const,
      harvestStyle: 'row-grain-pollinated' as const,
      bloomWindow: { daysFromPlantingMin: 55, daysFromPlantingMax: 75, beeAttractive: false }
    };
    const parsed = cropPluginSchema.safeParse(v10);
    expect(parsed.success).toBe(true);
  });

  it('rejects a pre-25c.0 plugin missing the now-required harvestStyle (#99)', () => {
    const pre25c0 = {
      pluginId: 'corn',
      type: 'crop' as const,
      displayName: 'Corn',
      version: '1.0.0',
      cropFamily: 'corn' as const
    };
    const parsed = cropPluginSchema.safeParse(pre25c0);
    expect(parsed.success).toBe(false);
  });

  it('accepts a hay plugin with hayOperations + cropOperationModel', () => {
    const alfalfa = {
      pluginId: 'hay-alfalfa',
      type: 'crop' as const,
      displayName: 'Alfalfa (Hay)',
      version: '1.1.0',
      cropFamily: 'forage' as const,
      harvestStyle: 'forage-cutting-cycle' as const,
      bloomWindow: { continuous: true, beeAttractive: true } as const,
      cropOperationModel: 'perennial-multi-cut' as const,
      hayOperations: {
        steps: ['mow', 'ted', 'rake', 'bale', 'store'] as const,
        cuttingsPerSeason: { min: 2, max: 4 },
        cutIntervalDays: { min: 28, max: 35 },
        mowTrigger: 'late-bud-to-10%-bloom',
        weatherWindowDays: 3,
        baleMoistureGate: {
          'small-square': {
            optimumPercent: { min: 13, max: 20 },
            warnAbovePct: 18,
            dangerAbovePct: 22,
            warnBelowPct: 14,
            dangerBelowPct: 12
          },
          'large-round': {
            optimumPercent: { min: 15, max: 18 },
            dangerAbovePct: 22
          }
        },
        storageTempWatchF: { warn: 120, danger: 150 }
      }
    };
    const parsed = cropPluginSchema.safeParse(alfalfa);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.hayOperations?.weatherWindowDays).toBe(3);
      expect(parsed.data.hayOperations?.baleMoistureGate?.['small-square']?.dangerAbovePct).toBe(
        22
      );
    }
  });

  it('accepts a small-grain plugin with zadoksStages + moistureGates', () => {
    const barley = {
      pluginId: 'barley-spring-malt',
      type: 'crop' as const,
      displayName: 'Spring Malt Barley',
      version: '1.1.0',
      cropFamily: 'cereal-grain' as const,
      harvestStyle: 'single-cut-grain' as const,
      bloomWindow: { monthsOfYear: [5, 6], beeAttractive: false } as const,
      cropOperationModel: 'single-event' as const,
      zadoksStages: [
        { stage: 'Z00-Z09', name: 'Germination', daysFromPlanting: { min: 0, max: 10 } },
        { stage: 'Z10-Z19', name: 'Tillering', daysFromPlanting: { min: 10, max: 25 } },
        { stage: 'Z83-Z89', name: 'Dough', daysFromPlanting: { min: 68, max: 80 } }
      ],
      moistureGates: [
        {
          operation: 'harvest' as const,
          thresholds: {
            optimumPercent: { min: 12, max: 14 },
            dangerAbovePct: 16,
            warnAbovePct: 14
          }
        }
      ]
    };
    const parsed = cropPluginSchema.safeParse(barley);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.zadoksStages?.[0].stage).toBe('Z00-Z09');
      expect(parsed.data.moistureGates?.[0].thresholds.dangerAbovePct).toBe(16);
    }
  });

  it('rejects an invalid Zadoks stage label', () => {
    const bad = {
      pluginId: 'wheat-bad',
      type: 'crop' as const,
      displayName: 'Bad Wheat',
      version: '1.1.0',
      cropFamily: 'cereal-grain' as const,
      zadoksStages: [{ stage: 'badstage', name: 'x', daysFromPlanting: { min: 0, max: 10 } }]
    };
    const parsed = cropPluginSchema.safeParse(bad);
    expect(parsed.success).toBe(false);
  });

  it('rejects min > max in min-max bounded fields', () => {
    const bad = {
      pluginId: 'hay-bad',
      type: 'crop' as const,
      displayName: 'Bad Hay',
      version: '1.1.0',
      cropFamily: 'forage' as const,
      hayOperations: {
        cutIntervalDays: { min: 50, max: 30 }
      }
    };
    const parsed = cropPluginSchema.safeParse(bad);
    expect(parsed.success).toBe(false);
  });
});
