import { describe, expect, it } from 'vitest';
import { createEquipment } from './equipment';
import { loadEquipmentContext, matchEquipmentTemplate } from './tasks';
import { runWithTenant } from './tenant';
import { SEED_EQUIPMENT_TEMPLATES } from '$lib/server/equipmentTemplates';

const OWNER = 'owner_home_farm';
const pull50 = SEED_EQUIPMENT_TEMPLATES.find((t) => t.templateId === 'sprayer-50gal-pull')!;

describe('matchEquipmentTemplate', () => {
  it('matches on spec.templateId even after the implement is renamed', () => {
    const t = matchEquipmentTemplate({
      type: 'sprayer',
      label: 'Old Blue',
      specJson: JSON.stringify({ templateId: pull50.templateId })
    });
    expect(t?.templateId).toBe('sprayer-50gal-pull');
  });

  it('prefers the template id over a label that names a different template', () => {
    const t = matchEquipmentTemplate({
      type: 'sprayer',
      label: '4 gal backpack sprayer (Solo / Birchmeier)',
      specJson: JSON.stringify({ templateId: pull50.templateId })
    });
    expect(t?.templateId).toBe('sprayer-50gal-pull');
  });

  it('falls back to exact type + label for rows without a template id', () => {
    const t = matchEquipmentTemplate({ type: 'sprayer', label: pull50.label, specJson: null });
    expect(t?.templateId).toBe('sprayer-50gal-pull');
  });

  it('falls back to type + label when the template id is unknown', () => {
    const t = matchEquipmentTemplate({
      type: 'sprayer',
      label: pull50.label,
      specJson: JSON.stringify({ templateId: 'retired-template' })
    });
    expect(t?.templateId).toBe('sprayer-50gal-pull');
  });

  it('ignores a template id whose type does not match the row', () => {
    const t = matchEquipmentTemplate({
      type: 'mower',
      label: 'Renamed',
      specJson: JSON.stringify({ templateId: pull50.templateId })
    });
    expect(t).toBeUndefined();
  });

  it('survives malformed or unrelated spec JSON', () => {
    expect(
      matchEquipmentTemplate({ type: 'sprayer', label: 'x', specJson: '{nope' })
    ).toBeUndefined();
    expect(
      matchEquipmentTemplate({ type: 'sprayer', label: 'x', specJson: '["templateId"]' })
    ).toBeUndefined();
    expect(
      matchEquipmentTemplate({ type: 'sprayer', label: 'x', specJson: '{"templateId":42}' })
    ).toBeUndefined();
  });

  it('returns nothing for a custom implement', () => {
    expect(
      matchEquipmentTemplate({ type: 'sprayer', label: 'Homemade rig', specJson: '{"gal":30}' })
    ).toBeUndefined();
  });
});

describe('loadEquipmentContext', () => {
  it('finds the template for a renamed sprayer created from a starter template', () =>
    runWithTenant(OWNER, () => {
      const row = createEquipment({
        type: 'sprayer',
        label: 'North field rig',
        spec: { templateId: pull50.templateId }
      });
      const ctx = loadEquipmentContext(row.id);
      expect(ctx.template?.templateId).toBe('sprayer-50gal-pull');
      expect(ctx.template?.preTasks?.length).toBeGreaterThan(0);
    }));

  it('returns an empty context for an unknown id', () =>
    runWithTenant(OWNER, () => {
      expect(loadEquipmentContext('does-not-exist')).toEqual({});
    }));
});
