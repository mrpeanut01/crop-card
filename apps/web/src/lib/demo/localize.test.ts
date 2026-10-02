import { describe, expect, it } from 'vitest';
import { demoLocalizer } from './localize';
import { buildDemoTimeline } from './timeline';
import { DEMO_AREAS, DEMO_BEDS, DEMO_CROPS, DEMO_EQUIPMENT } from './catalog';

const TEXT_FIELDS = /^(title|body|notes|text|description|trayLabel|enterprise)$/;

function timelineStrings(): Set<string> {
  const out = new Set<string>();
  const walk = (v: unknown, key: string) => {
    if (typeof v === 'string') {
      if (TEXT_FIELDS.test(key)) out.add(v);
      return;
    }
    if (Array.isArray(v)) v.forEach((x) => walk(x, key));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, k);
  };
  for (const month of [0, 3, 5, 7, 9, 11]) {
    walk(buildDemoTimeline(Date.UTC(2027, month, 12, 15)), '');
  }
  return out;
}

describe('demoLocalizer', () => {
  it('returns English unchanged with no locale or English', () => {
    for (const locale of [undefined, null, 'en']) {
      const L = demoLocalizer(locale);
      expect(L('Kitchen Garden')).toBe('Kitchen Garden');
      expect(L('Plant Provider bush bean in Bed 4')).toBe('Plant Provider bush bean in Bed 4');
      expect(L(null)).toBeNull();
      expect(L(undefined)).toBeUndefined();
    }
  });

  it('translates names, templated titles and their parts into Spanish', () => {
    const L = demoLocalizer('es');
    expect(L('Kitchen Garden')).toBe('Huerto familiar');
    expect(L('Bed 4')).toBe('Cama 4');
    expect(L('Plant Provider bush bean in Bed 4')).toBe(
      'Sembrar Frijol de mata Provider en Cama 4'
    );
    expect(L('Spray Captan 80 WDG on the apple row')).toBe(
      'Aplicar Captan 80 WDG en la hilera de manzanos'
    );
    expect(L('Cut hay: 2nd cutting')).toBe('Cortar heno: 2.º corte');
    expect(L('Target: fire blight.')).toBe('Objetivo: tizón de fuego.');
    expect(L('Something a visitor typed')).toBe('Something a visitor typed');
  });

  it('has Spanish for every text the demo timeline writes', () => {
    const L = demoLocalizer('es');
    const missing = [...timelineStrings()].filter((s) => L(s) === s);
    expect(missing).toEqual([]);
  });

  it('has Spanish for every Area, bed, equipment note and variety', () => {
    const L = demoLocalizer('es');
    const names = [
      ...DEMO_AREAS.flatMap((a) => [a.name, a.notes ?? null]),
      ...DEMO_BEDS.map((b) => b.name),
      ...DEMO_EQUIPMENT.map((e) => e.notes ?? null),
      ...DEMO_CROPS.map((c) => c.variety).filter((v) => v !== 'Cherokee Purple')
    ].filter((s): s is string => !!s);
    expect(names.filter((s) => L(s) === s)).toEqual([]);
  });
});
