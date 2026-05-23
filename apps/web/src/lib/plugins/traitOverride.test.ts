/**
 * Phase 11 — trait-gated tolerance: end-to-end coverage of the override
 * mechanism that lets engineered or species-native traits exempt specific
 * (herbicide × cultivar) pairs from the kernel's family-kill default.
 *
 * Tests cover:
 *   - Schema acceptance of `traits[]` on crop, `traitGatedSafeFor[]` on herbicide
 *   - Bypass check at registration: passes when crop carries the trait,
 *     fails with a specific reason when it doesn't
 *   - Runtime cropCompatibility kernel: skips family-kill when trait present
 *   - Plain `safeForCropPluginIds` claims still get bypass-rejected when
 *     the chemistry kills the family — trait-gated path is ADDITIVE, not
 *     a backdoor on the existing claim mechanism
 */

import { describe, expect, it } from 'vitest';
import { detectBypass } from './bypassCheck';
import { PluginRegistry, PluginRegistrationError } from './registry';
import { cropPluginSchema, herbicidePluginSchema } from './schemas';
import { checkCropCompatibility } from '$lib/safety/cropCompatibility';
import type { CropStage, HerbicideProduct } from '$lib/safety/types';

const xtendSoy = {
  pluginId: 'soy-xtend',
  type: 'crop' as const,
  displayName: 'Soybean Xtend',
  version: '1.0.0',
  cropFamily: 'legume' as const,
  traits: ['dicamba-tolerant-xtend']
};

const conventionalSoy = {
  pluginId: 'soy-conv',
  type: 'crop' as const,
  displayName: 'Soybean Conventional',
  version: '1.0.0',
  cropFamily: 'legume' as const
};

const engenia = {
  pluginId: 'engenia',
  type: 'herbicide' as const,
  displayName: 'Engenia',
  version: '1.0.0',
  activeIngredients: [{ name: 'dicamba', chemistryClass: 'synthetic-auxin' as const }],
  ratePerAcre: { amount: 12.8, unit: 'fl-oz' as const },
  gpaCalibration: 15,
  traitGatedSafeFor: [
    {
      cropPluginId: 'soy-xtend',
      requiresTraits: ['dicamba-tolerant-xtend']
    }
  ]
};

describe('cropPluginSchema — traits field', () => {
  it('accepts a crop plugin with a traits array', () => {
    expect(cropPluginSchema.safeParse(xtendSoy).success).toBe(true);
  });

  it('rejects an invalid trait (uppercase / whitespace)', () => {
    const bad = { ...xtendSoy, traits: ['UPPERCASE-NOT-ALLOWED'] };
    expect(cropPluginSchema.safeParse(bad).success).toBe(false);
  });

  it('treats omitted traits as no-override (back-compat with v1.0 plugins)', () => {
    const parsed = cropPluginSchema.safeParse(conventionalSoy);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.traits).toBeUndefined();
  });
});

describe('herbicidePluginSchema — traitGatedSafeFor', () => {
  it('accepts a herbicide with one or more trait-gated claims', () => {
    expect(herbicidePluginSchema.safeParse(engenia).success).toBe(true);
  });

  it('rejects a trait-gated claim with empty requiresTraits', () => {
    const bad = {
      ...engenia,
      traitGatedSafeFor: [{ cropPluginId: 'soy-xtend', requiresTraits: [] }]
    };
    expect(herbicidePluginSchema.safeParse(bad).success).toBe(false);
  });
});

describe('bypass check at registration', () => {
  it('passes when the crop carries every required trait', () => {
    const reg = new PluginRegistry();
    reg.register(xtendSoy);
    expect(() => reg.register(engenia)).not.toThrow();
  });

  it('rejects when the crop is missing a required trait', () => {
    const reg = new PluginRegistry();
    reg.register(conventionalSoy);
    const bad = {
      ...engenia,
      traitGatedSafeFor: [{ cropPluginId: 'soy-conv', requiresTraits: ['dicamba-tolerant-xtend'] }]
    };
    expect(() => reg.register(bad)).toThrow(PluginRegistrationError);
  });

  it('still rejects plain safeForCropPluginIds claims that violate the kill matrix', () => {
    const reg = new PluginRegistry();
    reg.register(conventionalSoy);
    const bad = {
      ...engenia,
      traitGatedSafeFor: undefined,
      labelClaims: { safeForCropPluginIds: ['soy-conv'] }
    };
    expect(() => reg.register(bad)).toThrow(PluginRegistrationError);
  });

  it('flags trait-gated claims when the resolver returns no traits for the cropId', () => {
    // The resolver returning [] is treated as "we know this crop and it
    // declares no traits" — i.e., the claim is invalid. To skip the check
    // entirely (provisional acceptance during installation ordering), the
    // caller must omit cropTraits so the resolver returns undefined for
    // the cropId.
    expect(detectBypass(engenia, { cropTraits: () => [] })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          cropPluginId: 'soy-xtend',
          reason: expect.stringContaining('requires')
        })
      ])
    );
  });
});

describe('runtime cropCompatibility — trait override', () => {
  const xtendStage: CropStage = {
    cropPluginId: 'soy-xtend',
    cropFamily: 'legume',
    traits: ['dicamba-tolerant-xtend']
  };
  const conventionalStage: CropStage = {
    cropPluginId: 'soy-conv',
    cropFamily: 'legume'
  };
  const engeniaProduct: HerbicideProduct = {
    pluginId: 'engenia',
    displayName: 'Engenia',
    activeIngredients: [{ name: 'dicamba', chemistryClass: 'synthetic-auxin' }],
    traitGatedSafeFor: [{ cropPluginId: 'soy-xtend', requiresTraits: ['dicamba-tolerant-xtend'] }]
  };

  it('passes engenia over Xtend-traited soybean (legume family-kill skipped)', () => {
    const violations = checkCropCompatibility([engeniaProduct], xtendStage);
    expect(violations).toEqual([]);
  });

  it('blocks engenia over conventional soybean (no trait → family-kill applies)', () => {
    const violations = checkCropCompatibility([engeniaProduct], conventionalStage);
    expect(violations).toHaveLength(1);
    expect(violations[0].code).toBe('CROP_INCOMPATIBLE');
  });

  it('only overrides the specific (product, crop) pair, not other crops in the block', () => {
    const peas: CropStage = {
      cropPluginId: 'pea-conv',
      cropFamily: 'legume'
    };
    // Block has Xtend soy AS PRIMARY + conventional peas co-planted.
    const violations = checkCropCompatibility([engeniaProduct], xtendStage, [peas]);
    expect(violations).toHaveLength(1);
    const affected = violations[0].detail?.crops as Array<{ cropPluginId: string }>;
    expect(affected).toEqual([
      expect.objectContaining({ cropPluginId: 'pea-conv' })
    ]);
  });

  it('requires every listed trait, not just one', () => {
    const partialStage: CropStage = {
      cropPluginId: 'soy-xtend',
      cropFamily: 'legume',
      traits: ['glyphosate-tolerant-rr2'] // wrong trait
    };
    const violations = checkCropCompatibility([engeniaProduct], partialStage);
    expect(violations).toHaveLength(1);
  });

  it('does not affect products without traitGatedSafeFor', () => {
    const plainAuxin: HerbicideProduct = {
      pluginId: 'plain',
      displayName: 'Plain 2,4-D',
      activeIngredients: [{ name: '2,4-D', chemistryClass: 'synthetic-auxin' }]
    };
    // Even on Xtend soybean, plain 2,4-D should still be blocked because
    // it doesn't claim trait gating.
    const violations = checkCropCompatibility([plainAuxin], xtendStage);
    expect(violations).toHaveLength(1);
  });
});
