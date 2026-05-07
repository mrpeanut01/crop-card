import { describe, expect, it } from 'vitest';
import { evaluateSpray } from './evaluate';
import type { SprayContext } from './types';

function baseCtx(): SprayContext {
  return {
    occurredAt: 1_700_000_000_000,
    products: [
      {
        pluginId: 'gly',
        displayName: 'glyphosate',
        activeIngredients: [{ name: 'glyphosate', chemistryClass: 'glyphosate' }]
      }
    ],
    crop: { cropPluginId: 'corn', heightInches: 6 },
    sprayer: { id: 's1' },
    conditions: { windMph: 5, tempF: 70, rainForecastMmNext24h: 0 }
  };
}

describe('evaluateSpray', () => {
  it('returns ok for a clean context', () => {
    const out = evaluateSpray(baseCtx());
    expect(out.ok).toBe(true);
    expect(out.violations).toEqual([]);
    expect(out.requiresDecon).toBe(false);
  });

  it('aggregates violations from multiple rule modules', () => {
    const ctx = baseCtx();
    ctx.products = [
      {
        pluginId: '24d',
        displayName: '2,4-D',
        activeIngredients: [{ name: '2,4-D', chemistryClass: 'synthetic-auxin' }]
      },
      {
        pluginId: 'dual',
        displayName: 'dual',
        activeIngredients: [{ name: 'metolachlor', chemistryClass: 'chloroacetamide' }]
      }
    ];
    ctx.crop = { cropPluginId: 'corn', heightInches: 24 };
    ctx.conditions = { windMph: 50, tempF: 70, rainForecastMmNext24h: 0 };

    const out = evaluateSpray(ctx);
    expect(out.ok).toBe(false);
    const codes = out.violations.map((v) => v.code).sort();
    expect(codes).toContain('CHEMISTRY_INCOMPATIBLE');
    expect(codes).toContain('CROP_STAGE_BLOCK');
    expect(codes).toContain('ENV_WIND');
  });

  it('signals requiresDecon when sprayer chemistry would change', () => {
    const ctx = baseCtx();
    ctx.sprayer = {
      id: 's1',
      lastChemistryClass: 'synthetic-auxin',
      lastSprayedAt: 1
    };
    const out = evaluateSpray(ctx);
    expect(out.requiresDecon).toBe(true);
    expect(out.ok).toBe(false);
  });
});
