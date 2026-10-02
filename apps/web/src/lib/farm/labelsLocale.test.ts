import { describe, expect, it } from 'vitest';
import {
  AREA_KINDS,
  AREA_KIND_LABELS,
  BED_STYLES,
  BED_STYLE_LABELS,
  BLOCK_KINDS,
  BLOCK_KIND_LABELS,
  areaKindLabel,
  bedStyleLabel,
  blockKindLabel
} from './areaKinds';
import {
  AREA_KIND_HINT,
  AREA_KIND_NOUN,
  AREA_KIND_PLURAL,
  AREA_NAME_PLACEHOLDER,
  SHADE_KINDS,
  SHADE_KIND_LABELS,
  areaKindHint,
  areaKindNoun,
  areaKindPlural,
  areaNamePlaceholder,
  shadeKindLabel
} from './kindStyle';
import {
  MAP_FEATURE_KINDS,
  MAP_FEATURE_LABELS,
  WATER_SOURCE_LABELS,
  WATER_SOURCE_TYPES,
  mapFeatureLabel,
  waterSourceLabel
} from './mapFeatures';
import { PROTECTION_KINDS, PROTECTION_LABEL, protectionLabel } from '$lib/climate/protection';
import { suggestCapacity } from './coopCapacity';
import { capacityLabel } from './housedAnimals';

describe('locale-aware labels', () => {
  it('match the English tables with no locale', () => {
    for (const k of AREA_KINDS) {
      expect(areaKindLabel(k)).toBe(AREA_KIND_LABELS[k]);
      expect(areaKindPlural(k)).toBe(AREA_KIND_PLURAL[k]);
      expect(areaKindHint(k)).toBe(AREA_KIND_HINT[k]);
      expect(areaKindNoun(k)).toBe(AREA_KIND_NOUN[k]);
      expect(areaNamePlaceholder(k)).toBe(AREA_NAME_PLACEHOLDER[k]);
    }
    for (const k of BLOCK_KINDS) expect(blockKindLabel(k)).toBe(BLOCK_KIND_LABELS[k]);
    for (const k of BED_STYLES) expect(bedStyleLabel(k)).toBe(BED_STYLE_LABELS[k]);
    for (const k of SHADE_KINDS) expect(shadeKindLabel(k)).toBe(SHADE_KIND_LABELS[k]);
    for (const k of MAP_FEATURE_KINDS) expect(mapFeatureLabel(k)).toBe(MAP_FEATURE_LABELS[k]);
    for (const k of WATER_SOURCE_TYPES) expect(waterSourceLabel(k)).toBe(WATER_SOURCE_LABELS[k]);
    for (const k of PROTECTION_KINDS) expect(protectionLabel(k)).toBe(PROTECTION_LABEL[k]);
  });

  it('read Spanish when asked', () => {
    expect(areaKindLabel('garden', 'es')).toBe('Huerto');
    expect(mapFeatureLabel('gate', 'es')).toBe('Portón');
    expect(capacityLabel({ count: 3, capacity: 2, over: true }, 'es')).toBe(
      'Por encima de la capacidad (3 de 2)'
    );
    const r = suggestCapacity({ option: null, space: null, areaSqFt: null }, 'es');
    expect(r.ok ? '' : r.reason).toBe('Elige el tipo de animal para ver un número sugerido.');
  });
});
