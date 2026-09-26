import { describe, expect, it } from 'vitest';
import { AREA_KINDS, CROP_AREA_KINDS, OTHER_AREA_KINDS } from './areaKinds';
import {
  ADD_GROUPS,
  AREA_KIND_HINT,
  AREA_KIND_NOUN,
  AREA_KIND_PLURAL,
  AREA_KIND_STYLE,
  AREA_NAME_PLACEHOLDER,
  SHADE_KINDS,
  kindCounts,
  kindStyle,
  shadeStyle
} from './kindStyle';
import type { ShadeSourceKind } from '$lib/db/shadeSources';

const HEX = /^#[0-9a-f]{6}$/i;

describe('kind styles', () => {
  it('gives every Area kind a hex color, a legend name and copy', () => {
    for (const k of AREA_KINDS) {
      expect(AREA_KIND_STYLE[k].color).toMatch(HEX);
      expect(AREA_KIND_STYLE[k].colorName.length).toBeGreaterThan(2);
      expect(AREA_KIND_NOUN[k]).toMatch(/^an? /);
      expect(AREA_KIND_PLURAL[k]).toBeTruthy();
      expect(AREA_KIND_HINT[k]).toBeTruthy();
      expect(AREA_NAME_PLACEHOLDER[k]).toMatch(/^e\.g\. /);
    }
  });

  it('keeps each kind visually distinct', () => {
    const colors = AREA_KINDS.map((k) => AREA_KIND_STYLE[k].color.toLowerCase());
    expect(new Set(colors).size).toBe(colors.length);
  });

  it('follows the Almanac mapping for the main crop kinds', () => {
    expect(AREA_KIND_STYLE.field.color).toBe('#2c5237');
    expect(AREA_KIND_STYLE.pasture.color).toBe('#b8893c');
    expect(AREA_KIND_STYLE.greenhouse.color).toBe('#6f8fa8');
  });

  it('never uses "{kind} area" wording in copy', () => {
    for (const k of AREA_KINDS) {
      expect(AREA_KIND_NOUN[k]).not.toMatch(/ area$/i);
      expect(AREA_KIND_HINT[k]).not.toMatch(/ area\b/i);
    }
  });

  it('falls back to the field style for unknown or missing kinds', () => {
    expect(kindStyle(null)).toBe(AREA_KIND_STYLE.field);
    expect(kindStyle(undefined)).toBe(AREA_KIND_STYLE.field);
  });

  it('boundary is an outline only', () => {
    expect(AREA_KIND_STYLE.boundary.fillOpacity).toBe(0);
    expect(AREA_KIND_STYLE.boundary.dashArray).toBeTruthy();
  });
});

describe('Add drawer groups', () => {
  it('lists crop areas, other areas and shade in LiteFarm order', () => {
    expect(ADD_GROUPS.map((g) => g.title)).toEqual([
      'Crop areas',
      'Other areas',
      'Shade & structures'
    ]);
    expect(ADD_GROUPS[0].items.map((i) => i.kind)).toEqual([...CROP_AREA_KINDS]);
    expect(ADD_GROUPS[1].items.map((i) => i.kind)).toEqual([...OTHER_AREA_KINDS]);
    expect(ADD_GROUPS[2].items.map((i) => i.kind)).toEqual([...SHADE_KINDS]);
  });

  it('offers every shade kind the shade-source API accepts', () => {
    const apiKinds: ShadeSourceKind[] = [
      'tree-row',
      'tree-grove',
      'tree-single',
      'hedge',
      'building',
      'fence',
      'structure',
      'other'
    ];
    const ours: readonly ShadeSourceKind[] = SHADE_KINDS;
    expect([...ours].sort()).toEqual([...apiKinds].sort());
  });

  it('colors structures apart from plants', () => {
    expect(shadeStyle('building')).not.toEqual(shadeStyle('tree-row'));
    expect(shadeStyle('fence')).toEqual(shadeStyle('structure'));
  });
});

describe('kindCounts', () => {
  it('counts every kind, zero included', () => {
    const counts = kindCounts([{ kind: 'garden' }, { kind: 'garden' }, { kind: 'barn' }]);
    expect(counts.get('garden')).toBe(2);
    expect(counts.get('barn')).toBe(1);
    expect(counts.get('field')).toBe(0);
    expect(counts.size).toBe(AREA_KINDS.length);
  });
});
