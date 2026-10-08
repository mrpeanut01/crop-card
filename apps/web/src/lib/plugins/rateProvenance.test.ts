import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  FALLBACK_RATE_LINE,
  herbicideRateProvenance,
  isFallbackRate,
  recordedRateProvenance
} from './rateProvenance';
import { computeDilution } from '$lib/dilution/calculator';
import { applyProductChoice } from '$lib/plan/inputsChoice';
import { sprayDetail } from '$lib/records/recordDetail';
import type { HerbicidePlugin } from './schemas';
import type { InputsPlanApplication } from '$lib/plan/inputsPlan';

const rate = { amount: 1, unit: 'pt' as const };

describe('herbicide rate provenance (#737 swarm 2026-10-07)', () => {
  it('is a label rate only when the plugin marks it label', () => {
    expect(
      herbicideRateProvenance({ type: 'herbicide', ratePerAcre: rate, rateProvenance: 'label' })
    ).toBe('plugin');
    expect(
      herbicideRateProvenance({ type: 'herbicide', ratePerAcre: rate, rateProvenance: 'fallback' })
    ).toBe('fallback');
    expect(herbicideRateProvenance({ type: 'herbicide', ratePerAcre: rate })).toBe('fallback');
    expect(herbicideRateProvenance({ type: 'herbicide' })).toBeNull();
    expect(herbicideRateProvenance({ type: 'fungicide', ratePerAcre: rate })).toBeNull();
    expect(herbicideRateProvenance(null)).toBeNull();
  });

  it('reads any herbicide rate not marked label as fallback', () => {
    fc.assert(
      fc.property(
        fc.anything().filter((v) => v !== 'label'),
        fc.double({ min: 0.001, max: 1000, noNaN: true }),
        (prov, amount) => {
          const p = {
            type: 'herbicide',
            ratePerAcre: { amount, unit: 'pt' },
            rateProvenance: prov
          };
          expect(isFallbackRate(p)).toBe(true);
        }
      )
    );
  });

  it('reads a stored record rate as label only when it was saved as plugin', () => {
    fc.assert(
      fc.property(fc.anything(), (v) => {
        expect(recordedRateProvenance(v)).toBe(v === 'plugin' ? 'plugin' : 'fallback');
      })
    );
  });

  it('tags dilution lines with the rate provenance', () => {
    const base = {
      pluginId: 'h',
      type: 'herbicide',
      displayName: 'H',
      ratePerAcre: rate,
      gpaCalibration: 15
    } as unknown as HerbicidePlugin;
    expect(computeDilution({ herbicide: base, tankSizeGallons: 15 }).rateProvenance).toBe(
      'fallback'
    );
    expect(
      computeDilution({
        herbicide: { ...base, rateProvenance: 'label' },
        tankSizeGallons: 15
      }).rateProvenance
    ).toBe('plugin');
    expect(
      computeDilution({ herbicide: base, tankSizeGallons: 15, customRatePerAcre: rate })
        .rateProvenance
    ).toBe('manual');
  });

  it('carries the option provenance onto a picked application', () => {
    const app = {
      id: 'a',
      productPluginId: null,
      options: [
        {
          pluginId: 'h',
          displayName: 'H',
          rateAmount: 1,
          rateUnit: 'pt',
          rateProvenance: 'fallback',
          totalAmount: 1,
          onHand: 0,
          stock: 'none'
        }
      ]
    } as unknown as InputsPlanApplication;
    expect(applyProductChoice(app, 'h')?.rateProvenance).toBe('fallback');
  });

  it('says so on the full record for a typical herbicide rate', () => {
    const prefs = { units: 'us', locale: 'en', timeZone: 'America/New_York' } as const;
    const view = sprayDetail(
      {
        blockLabel: 'B',
        blockAcres: 2,
        sprayerLabel: null,
        products: [
          { pluginId: 'h', name: 'H', rate: { amount: 1, unit: 'pt' }, rateFallback: true },
          { pluginId: 'l', name: 'L', rate: { amount: 1, unit: 'pt' } }
        ],
        conditions: null
      },
      prefs as never
    );
    expect(view.rows.find((r) => r.label === 'H')?.value).toContain(FALLBACK_RATE_LINE);
    expect(view.rows.find((r) => r.label === 'L')?.value).not.toContain(FALLBACK_RATE_LINE);
  });
});
