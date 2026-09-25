import { describe, expect, it } from 'vitest';
import {
  checkCoverage,
  deriveDefaultUnit,
  metadataGaps,
  resolvePluginDefaultUnit,
  withResolvedDefaultUnit,
  type InputPlugin
} from './inputMetadata';
import { pluginSchema } from './schemas';

function herbicide(extra: Record<string, unknown> = {}): InputPlugin {
  return pluginSchema.parse({
    pluginId: 'h',
    type: 'herbicide',
    displayName: 'H',
    version: '1.0.0',
    activeIngredients: [{ name: 'x', chemistryClass: 'glyphosate' }],
    ratePerAcre: { amount: 1, unit: 'fl-oz' },
    ...extra
  }) as InputPlugin;
}

function fertilizer(extra: Record<string, unknown> = {}): InputPlugin {
  return pluginSchema.parse({
    pluginId: 'f',
    type: 'fertilizer',
    displayName: 'F',
    version: '1.0.0',
    analysis: { n: 10, p: 10, k: 10 },
    form: 'granular',
    ...extra
  }) as InputPlugin;
}

describe('schema', () => {
  it('accepts defaultUnit + formulation on pesticides and defaultUnit on fertilizers', () => {
    const h = herbicide({ defaultUnit: 'gal', formulation: 'SL' });
    expect(h.defaultUnit).toBe('gal');
    expect(h.type !== 'fertilizer' && h.formulation).toBe('SL');
    expect(fertilizer({ defaultUnit: 'lb' }).defaultUnit).toBe('lb');
  });

  it('rejects unknown formulation codes and units', () => {
    expect(() => herbicide({ formulation: 'XYZ' })).toThrow();
    expect(() => herbicide({ defaultUnit: 'bushel' })).toThrow();
  });
});

describe('resolvePluginDefaultUnit', () => {
  it('prefers the authored unit', () => {
    expect(resolvePluginDefaultUnit(herbicide({ defaultUnit: 'qt' }))).toEqual({
      unit: 'qt',
      basis: 'plugin'
    });
  });

  it('derives liquid → fl-oz from formulation or liquid rate units', () => {
    expect(resolvePluginDefaultUnit(herbicide({ formulation: 'EC' })).unit).toBe('fl-oz');
    for (const unit of ['fl-oz', 'pt', 'qt'])
      expect(deriveDefaultUnit(herbicide({ ratePerAcre: { amount: 1, unit } }))).toBe('fl-oz');
  });

  it('derives dry → lb, or oz when the label rate is in oz', () => {
    expect(deriveDefaultUnit(herbicide({ ratePerAcre: { amount: 1, unit: 'lb' } }))).toBe('lb');
    expect(
      deriveDefaultUnit(herbicide({ formulation: 'WDG', ratePerAcre: { amount: 1, unit: 'lb' } }))
    ).toBe('lb');
    expect(
      deriveDefaultUnit(herbicide({ formulation: 'SG', ratePerAcre: { amount: 1, unit: 'oz' } }))
    ).toBe('oz');
  });

  it('treats a bare oz rate as ambiguous and falls back to the category default', () => {
    const p = herbicide({ ratePerAcre: { amount: 1, unit: 'oz' } });
    expect(deriveDefaultUnit(p)).toBeNull();
    expect(resolvePluginDefaultUnit(p)).toEqual({ unit: 'fl-oz', basis: 'fallback' });
  });

  it('refuses to derive when formulation contradicts the rate unit', () => {
    expect(
      deriveDefaultUnit(herbicide({ formulation: 'DF', ratePerAcre: { amount: 1, unit: 'pt' } }))
    ).toBeNull();
  });

  it('insecticides without a rate fall back to fl-oz', () => {
    const p = pluginSchema.parse({
      pluginId: 'i',
      type: 'insecticide',
      displayName: 'I',
      version: '1.0.0',
      activeIngredients: [{ name: 'x' }],
      reEntryIntervalHours: 4
    }) as InputPlugin;
    expect(resolvePluginDefaultUnit(p)).toEqual({ unit: 'fl-oz', basis: 'fallback' });
  });

  it('fertilizers: liquid form → gal, dry forms → lb, conflict → lb fallback', () => {
    expect(deriveDefaultUnit(fertilizer({ form: 'liquid' }))).toBe('gal');
    expect(deriveDefaultUnit(fertilizer({ form: 'soluble' }))).toBe('lb');
    expect(deriveDefaultUnit(fertilizer({ form: 'meal' }))).toBe('lb');
    const conflict = fertilizer({
      form: 'liquid',
      applicationRange: { min: 1, max: 2, unit: 'lb-per-acre' }
    });
    expect(deriveDefaultUnit(conflict)).toBeNull();
    expect(resolvePluginDefaultUnit(conflict)).toEqual({ unit: 'lb', basis: 'fallback' });
  });
});

describe('withResolvedDefaultUnit (catalog-pick loader fallback)', () => {
  it('stamps a derived unit without mutating the registry record', () => {
    const p = herbicide({ ratePerAcre: { amount: 1, unit: 'lb' } });
    const out = withResolvedDefaultUnit(p);
    expect(out).not.toBe(p);
    expect((out as InputPlugin).defaultUnit).toBe('lb');
    expect(p.defaultUnit).toBeUndefined();
  });

  it('leaves authored units, ambiguous plugins, and non-input plugins untouched', () => {
    const authored = herbicide({ defaultUnit: 'gal' });
    expect(withResolvedDefaultUnit(authored)).toBe(authored);
    const ambiguous = herbicide({ ratePerAcre: { amount: 1, unit: 'oz' } });
    expect(withResolvedDefaultUnit(ambiguous)).toBe(ambiguous);
    const companion = { type: 'companion', pluginId: 'c' };
    expect(withResolvedDefaultUnit(companion)).toBe(companion);
  });
});

describe('metadataGaps + checkCoverage', () => {
  it('reports pesticide gaps; fertilizer analysis/form satisfy the chemistry fields', () => {
    expect(metadataGaps(herbicide())).toEqual(['defaultUnit', 'formulation']);
    expect(metadataGaps(herbicide({ defaultUnit: 'fl-oz', formulation: 'SL' }))).toEqual([]);
    expect(metadataGaps(fertilizer())).toEqual(['defaultUnit']);
  });

  it('flags unallowlisted gaps and stale allowlist entries', () => {
    const report = checkCoverage(
      [herbicide(), fertilizer({ defaultUnit: 'lb' })],
      [
        { pluginId: 'h', field: 'formulation', reason: 'r' },
        { pluginId: 'f', field: 'defaultUnit', reason: 'r' }
      ]
    );
    expect(report.unallowlisted).toEqual([{ pluginId: 'h', field: 'defaultUnit' }]);
    expect(report.stale.map((e) => e.pluginId)).toEqual(['f']);
  });
});
