import { describe, it, expect } from 'vitest';
import {
  resolveCropAgronomy,
  resolveSeedsPerLb,
  rotationLookbackForFamily,
  familyReferenceSeedsPerAcre,
  isPerennialFamily,
  isCoverCropFamily,
  DEFAULT_EMERGENCE_DAYS,
  DEFAULT_COVER_TERMINATION_LEAD_DAYS
} from './familyDefaults';
import type { CropPlugin } from './schemas';

function crop(
  overrides: Partial<CropPlugin> & { cropFamily: CropPlugin['cropFamily'] }
): CropPlugin {
  return {
    pluginId: 'test-crop',
    type: 'crop',
    displayName: 'Test',
    version: '1.0.0',
    ...overrides
  } as CropPlugin;
}

describe('resolveCropAgronomy', () => {
  it('falls back to family defaults when no plugin agronomy is declared', () => {
    const r = resolveCropAgronomy(crop({ cropFamily: 'brassica' }));
    expect(r.rotationLookbackYears).toBe(3);
    expect(r.lifecycle).toBe('annual');
    expect(r.isPerennial).toBe(false);
    expect(r.emergenceDays).toEqual(DEFAULT_EMERGENCE_DAYS);
    expect(r.source.rotationLookbackYears).toBe('family');
    expect(r.source.lifecycle).toBe('default');
  });

  it('marks perennial families correctly without explicit lifecycle', () => {
    const r = resolveCropAgronomy(crop({ cropFamily: 'orchard' }));
    expect(r.lifecycle).toBe('perennial');
    expect(r.isPerennial).toBe(true);
    expect(r.rotationLookbackYears).toBe(0);
    expect(r.source.lifecycle).toBe('family');
  });

  it('lets plugin agronomy override family defaults', () => {
    const r = resolveCropAgronomy(
      crop({
        cropFamily: 'corn',
        agronomy: { lifecycle: 'biennial', rotationLookbackYears: 2 }
      })
    );
    expect(r.lifecycle).toBe('biennial');
    expect(r.rotationLookbackYears).toBe(2);
    expect(r.source.lifecycle).toBe('plugin');
    expect(r.source.rotationLookbackYears).toBe('plugin');
  });

  it('emergence window prefers plantingGuide.emergenceDays over the global default', () => {
    const r = resolveCropAgronomy(
      crop({
        cropFamily: 'cucurbit',
        plantingGuide: { emergenceDays: { min: 5, max: 10 } }
      })
    );
    expect(r.emergenceDays).toEqual({ min: 5, max: 10 });
    expect(r.source.emergenceDays).toBe('plugin');
  });

  it('cover crops apply termination-lead default but other families do not', () => {
    const cover = resolveCropAgronomy(crop({ cropFamily: 'cover-grass' }));
    expect(cover.isCoverCrop).toBe(true);
    expect(cover.terminationLeadDaysMin).toBe(DEFAULT_COVER_TERMINATION_LEAD_DAYS);

    const cash = resolveCropAgronomy(crop({ cropFamily: 'corn' }));
    expect(cash.isCoverCrop).toBe(false);
    expect(cash.terminationLeadDaysMin).toBe(0);
  });

  it('plugin termination-lead override applies on cover crops', () => {
    const r = resolveCropAgronomy(
      crop({
        cropFamily: 'cover-legume',
        agronomy: { terminationLeadDaysMin: 21 }
      })
    );
    expect(r.terminationLeadDaysMin).toBe(21);
    expect(r.source.terminationLeadDaysMin).toBe('plugin');
  });
});

describe('resolveSeedsPerLb', () => {
  it('returns plugin-direct seedsPerLb when present', () => {
    const r = resolveSeedsPerLb({
      cropFamily: 'corn',
      plantingGuide: { seedsPerLb: 1700 }
    });
    expect(r.seedsPerLb).toBe(1700);
    expect(r.seedsPerLbSource).toBe('plugin-direct');
  });

  it('derives from seedsPerAcre / lbsPerAcre when seedsPerLb absent', () => {
    const r = resolveSeedsPerLb({
      cropFamily: 'corn',
      plantingGuide: { seedsPerAcre: 30000, recommendedLbsPerAcre: 20 }
    });
    expect(r.seedsPerLb).toBe(1500);
    expect(r.seedsPerLbSource).toBe('plugin-derived');
  });

  it('falls back to family default', () => {
    const r = resolveSeedsPerLb({ cropFamily: 'cucurbit' });
    expect(r.seedsPerLb).toBe(3000);
    expect(r.seedsPerLbSource).toBe('family');
  });

  it('returns null + "none" source when neither plugin nor family default applies', () => {
    const r = resolveSeedsPerLb({ cropFamily: 'unknown-family' });
    expect(r.seedsPerLb).toBeNull();
    expect(r.seedsPerLbSource).toBe('none');
  });
});

describe('thin family lookups', () => {
  it('rotationLookbackForFamily defaults to 1 for unknown families', () => {
    expect(rotationLookbackForFamily('brassica')).toBe(3);
    expect(rotationLookbackForFamily('mystery')).toBe(1);
    expect(rotationLookbackForFamily(undefined)).toBe(0);
  });

  it('familyReferenceSeedsPerAcre matches the centralized table', () => {
    expect(familyReferenceSeedsPerAcre('corn')).toBe(30000);
    expect(familyReferenceSeedsPerAcre('mystery')).toBeUndefined();
  });

  it('isPerennialFamily classifies the established perennial set', () => {
    for (const f of ['orchard', 'stone-fruit', 'small-fruit', 'bramble', 'vine-fruit', 'forage']) {
      expect(isPerennialFamily(f)).toBe(true);
    }
    expect(isPerennialFamily('corn')).toBe(false);
    expect(isPerennialFamily('cover-grass')).toBe(false);
  });

  it('isCoverCropFamily covers the cover families', () => {
    expect(isCoverCropFamily('cover-grass')).toBe(true);
    expect(isCoverCropFamily('cover-legume')).toBe(true);
    expect(isCoverCropFamily('corn')).toBe(false);
  });
});
