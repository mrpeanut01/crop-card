import { describe, expect, it } from 'vitest';
import { SEED_EQUIPMENT_TEMPLATES } from '$lib/server/equipmentTemplates';
import { IMPLEMENT_GROUPS, implementGroup, planImplementCreates } from './implements';

const templates = SEED_EQUIPMENT_TEMPLATES;

describe('implementGroup', () => {
  it('puts every starter template in a known group', () => {
    const ids = new Set(IMPLEMENT_GROUPS.map((g) => g.id));
    for (const t of templates) expect(ids.has(implementGroup(t))).toBe(true);
  });

  it('files tillage tools under tillage and the rest of "other" under more', () => {
    expect(implementGroup({ type: 'other', templateId: 'tiller-pto-rotary-60' })).toBe('tillage');
    expect(implementGroup({ type: 'other', templateId: 'bed-shaper-30in' })).toBe('tillage');
    expect(implementGroup({ type: 'other', templateId: 'manure-spreader-pull' })).toBe('more');
    expect(implementGroup({ type: 'drill', templateId: 'no-till-drill-7ft' })).toBe('planting');
    expect(implementGroup({ type: 'baler', templateId: 'baler-round-4x4' })).toBe('hay');
  });
});

describe('planImplementCreates', () => {
  it('creates a selected template with its exact type, label and spec', () => {
    const { creates, errors } = planImplementCreates(['sprayer-backpack-4gal'], [], templates, []);
    expect(errors).toEqual([]);
    expect(creates).toEqual([
      {
        type: 'sprayer',
        label: '4 gal backpack sprayer (Solo / Birchmeier)',
        spec: { tankGal: 4, pumpType: 'manual diaphragm', templateId: 'sprayer-backpack-4gal' }
      }
    ]);
  });

  it('never copies a template default GPA onto the new sprayer', () => {
    const { creates } = planImplementCreates(['sprayer-25gal-atv'], [], templates, []);
    expect(creates[0].spec).not.toHaveProperty('defaultGpa');
    expect(creates[0].spec).not.toHaveProperty('calibratedGpa');
  });

  it('skips what is already on the farm and duplicate ids', () => {
    const { creates } = planImplementCreates(
      ['tractor-subcompact', 'tractor-subcompact', 'mower-flail-6ft'],
      [],
      templates,
      [{ type: 'tractor', label: 'Subcompact utility tractor (sub-25 hp)' }]
    );
    expect(creates).toHaveLength(1);
    expect(creates[0].type).toBe('mower');
  });

  it('reports unknown template ids instead of creating them', () => {
    const { creates, errors } = planImplementCreates(['made-up'], [], templates, []);
    expect(creates).toEqual([]);
    expect(errors).toHaveLength(1);
  });

  it('accepts custom rows with a valid type and trims blanks', () => {
    const { creates, errors } = planImplementCreates(
      [],
      [
        { type: 'other', label: '  Cultivator with sweeps ' },
        { type: 'other', label: '   ' },
        { type: 'hovercraft', label: 'Nope' },
        { type: 'other', label: 'cultivator with sweeps' }
      ],
      templates,
      []
    );
    expect(creates).toEqual([{ type: 'other', label: 'Cultivator with sweeps' }]);
    expect(errors).toHaveLength(1);
  });
});
