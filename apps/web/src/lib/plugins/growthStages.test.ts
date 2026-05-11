import { describe, expect, it } from 'vitest';
import {
  cropPluginSchema,
  growthStageTableSchema,
  type CropPlugin
} from './schemas';
import {
  resolveGrowthStageTable,
  resolvePerennialTemplate,
  normalizeZadoksToGrowthStageTable,
  FAMILY_STAGE_TEMPLATES
} from './growthStageTemplates';
import { PluginRegistry, PluginRegistrationError } from './registry';

const baseCorn = {
  pluginId: 'corn-test',
  type: 'crop' as const,
  displayName: 'Test Corn',
  version: '1.3.0',
  cropFamily: 'corn' as const,
  daysToMaturity: { min: 90, max: 100 }
};

describe('growthStageTableSchema', () => {
  it('accepts a well-formed table', () => {
    const result = growthStageTableSchema.safeParse({
      system: 'vr-corn',
      referenceDtmDays: 95,
      stages: [
        { code: 'V2', name: '2-leaf', daysFromPlanting: { min: 14, max: 21 } },
        { code: 'R3', name: 'Milk', daysFromPlanting: { min: 78, max: 88 } }
      ],
      harvestTargets: [{ stageCode: 'R3', label: 'Sweet eating', useCase: 'fresh-eating' }]
    });
    expect(result.success).toBe(true);
  });

  it('rejects a harvest target whose stageCode does not match any stage', () => {
    const result = growthStageTableSchema.safeParse({
      system: 'vr-corn',
      stages: [{ code: 'V2', name: '2-leaf', daysFromPlanting: { min: 14, max: 21 } }],
      harvestTargets: [{ stageCode: 'NOPE', label: 'invalid' }]
    });
    expect(result.success).toBe(false);
  });

  it('rejects stages out of ascending order', () => {
    const result = growthStageTableSchema.safeParse({
      system: 'vr-corn',
      stages: [
        { code: 'R3', name: 'Milk', daysFromPlanting: { min: 78, max: 88 } },
        { code: 'V2', name: '2-leaf', daysFromPlanting: { min: 14, max: 21 } }
      ],
      harvestTargets: [{ stageCode: 'R3', label: 'eat' }]
    });
    expect(result.success).toBe(false);
  });

  it('rejects daysFromPlanting where min > max', () => {
    const result = growthStageTableSchema.safeParse({
      system: 'vr-corn',
      stages: [{ code: 'V2', name: '2-leaf', daysFromPlanting: { min: 30, max: 14 } }],
      harvestTargets: [{ stageCode: 'V2', label: 'x' }]
    });
    expect(result.success).toBe(false);
  });
});

describe('cropPluginSchema with v1.3 fields', () => {
  it('accepts a plugin with growthStageTable + cornType', () => {
    const result = cropPluginSchema.safeParse({
      ...baseCorn,
      cornType: 'sweet',
      growthStageTable: {
        system: 'vr-corn',
        stages: [
          { code: 'R3', name: 'Milk', daysFromPlanting: { min: 65, max: 75 } }
        ],
        harvestTargets: [{ stageCode: 'R3', label: 'Sweet eating' }]
      }
    });
    expect(result.success).toBe(true);
  });

  it('schema-level allows cornType on a non-corn plugin (cross-field check is in registry)', () => {
    const result = cropPluginSchema.safeParse({
      pluginId: 'tomato-test',
      type: 'crop',
      displayName: 'Test Tomato',
      version: '1.3.0',
      cropFamily: 'solanaceae',
      cornType: 'sweet'
    });
    // Schema-level allows; the registry layer enforces cropFamily==='corn'.
    expect(result.success).toBe(true);
  });
});

describe('PluginRegistry cross-field validation', () => {
  it('rejects cornType set on a non-corn plugin', () => {
    const reg = new PluginRegistry();
    expect(() =>
      reg.register({
        pluginId: 'tomato-bad',
        type: 'crop',
        displayName: 'Bad Tomato',
        version: '1.3.0',
        cropFamily: 'solanaceae',
        cornType: 'sweet'
      })
    ).toThrow(PluginRegistrationError);
  });

  it('accepts cornType set on a corn-family plugin', () => {
    const reg = new PluginRegistry();
    expect(() =>
      reg.register({
        ...baseCorn,
        pluginId: 'corn-ok',
        cornType: 'dual-purpose'
      })
    ).not.toThrow();
  });
});

describe('resolveGrowthStageTable', () => {
  it('returns the plugin-authored table when present', () => {
    const plug: CropPlugin = {
      ...baseCorn,
      growthStageTable: {
        system: 'vr-corn',
        stages: [{ code: 'R3', name: 'Milk', daysFromPlanting: { min: 78, max: 88 } }],
        harvestTargets: [{ stageCode: 'R3', label: 'Sweet' }]
      }
    };
    const t = resolveGrowthStageTable(plug);
    expect(t?.harvestTargets[0].label).toBe('Sweet');
  });

  it('falls back to the corn family default when no table is authored', () => {
    const t = resolveGrowthStageTable(baseCorn);
    expect(t).not.toBeNull();
    expect(t?.system).toBe('vr-corn');
    // Default corn template carries both R3 and R6 as candidate harvest targets.
    expect(t?.harvestTargets.map((h) => h.stageCode).sort()).toEqual(['R3', 'R6']);
  });

  it('normalizes legacy zadoksStages into the new shape when present', () => {
    const plug: CropPlugin = {
      pluginId: 'wheat-legacy',
      type: 'crop',
      displayName: 'Legacy Wheat',
      version: '1.1.0',
      cropFamily: 'cereal-grain',
      zadoksStages: [
        { stage: 'Z20', name: 'Tillering', daysFromPlanting: { min: 30, max: 60 } },
        { stage: 'Z89', name: 'Ripe', daysFromPlanting: { min: 215, max: 245 } }
      ]
    };
    const t = resolveGrowthStageTable(plug);
    expect(t?.system).toBe('zadoks');
    expect(t?.stages[0].code).toBe('Z20');
    expect(t?.harvestTargets[0].stageCode).toBe('Z89');
  });

  it('returns null for perennial families that use calendar templates', () => {
    const apple: CropPlugin = {
      pluginId: 'apple-test',
      type: 'crop',
      displayName: 'Apple',
      version: '1.0.0',
      cropFamily: 'orchard'
    };
    expect(resolveGrowthStageTable(apple)).toBeNull();
    expect(resolvePerennialTemplate(apple)).not.toBeNull();
  });
});

describe('FAMILY_STAGE_TEMPLATES coverage', () => {
  it('covers every non-perennial CropFamily', () => {
    const perennial = ['orchard', 'stone-fruit', 'small-fruit', 'bramble', 'vine-fruit'];
    for (const [family, table] of Object.entries(FAMILY_STAGE_TEMPLATES)) {
      if (perennial.includes(family)) {
        expect(table).toBeNull();
      } else {
        expect(table).not.toBeNull();
        expect(table?.stages.length).toBeGreaterThan(0);
        expect(table?.harvestTargets.length).toBeGreaterThan(0);
      }
    }
  });

  it('every harvest target stageCode in family defaults exists in stages list', () => {
    for (const [, table] of Object.entries(FAMILY_STAGE_TEMPLATES)) {
      if (!table) continue;
      const codes = new Set(table.stages.map((s) => s.code));
      for (const h of table.harvestTargets) {
        expect(codes.has(h.stageCode)).toBe(true);
      }
    }
  });
});

describe('normalizeZadoksToGrowthStageTable', () => {
  it('returns null for empty input', () => {
    expect(normalizeZadoksToGrowthStageTable(undefined)).toBeNull();
    expect(normalizeZadoksToGrowthStageTable([])).toBeNull();
  });

  it('infers bodyKind from Zadoks numeric range', () => {
    const t = normalizeZadoksToGrowthStageTable([
      { stage: 'Z20', name: 'Tillering', daysFromPlanting: { min: 30, max: 60 } },
      { stage: 'Z65', name: 'Anthesis', daysFromPlanting: { min: 160, max: 190 } },
      { stage: 'Z89', name: 'Ripe', daysFromPlanting: { min: 215, max: 245 } }
    ])!;
    expect(t.stages.find((s) => s.code === 'Z20')?.bodyKind).toBe('vegetative');
    expect(t.stages.find((s) => s.code === 'Z65')?.bodyKind).toBe('ripening');
    expect(t.stages.find((s) => s.code === 'Z89')?.bodyKind).toBe('ripening');
  });

  it('uses the last stage as the harvest target', () => {
    const t = normalizeZadoksToGrowthStageTable([
      { stage: 'Z20', name: 'Tillering', daysFromPlanting: { min: 30, max: 60 } },
      { stage: 'Z89', name: 'Ripe', daysFromPlanting: { min: 215, max: 245 } }
    ])!;
    expect(t.harvestTargets[0].stageCode).toBe('Z89');
    expect(t.harvestTargets[0].useCase).toBe('dry-storage');
  });
});
