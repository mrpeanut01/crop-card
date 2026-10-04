import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FIXTURE_ORCHARD_CALENDAR } from './orchardCalendar.fixtures';
import {
  ORCHARD_WINDOW_PURPOSES,
  orchardCalendarPluginSchema,
  orchardCopyProblems
} from './schemas';

const REPO_ROOT = path.resolve(__dirname, '../../../../..');

type Fixture = typeof FIXTURE_ORCHARD_CALENDAR;

function clone(): Fixture {
  return structuredClone(FIXTURE_ORCHARD_CALENDAR);
}

function issues(raw: unknown): string[] {
  const parsed = orchardCalendarPluginSchema.safeParse(raw);
  return parsed.success ? [] : parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
}

describe('orchard calendar schema', () => {
  it('accepts the fixture', () => {
    expect(issues(FIXTURE_ORCHARD_CALENDAR)).toEqual([]);
  });

  it('has no product, class, rate or brand field anywhere (OC-2)', () => {
    for (const key of ['productClasses', 'products', 'rate', 'brand', 'phiDays', 'reiHours']) {
      expect(issues({ ...clone(), [key]: [] }).length).toBeGreaterThan(0);
      const c = clone();
      (c.stages[1].windows[0] as Record<string, unknown>)[key] = ['x'];
      expect(issues(c).length).toBeGreaterThan(0);
      const s = clone();
      (s.stages[1] as Record<string, unknown>)[key] = ['x'];
      expect(issues(s).length).toBeGreaterThan(0);
    }
  });

  it('limits purposes to targets and timing, with no spray purpose', () => {
    expect(ORCHARD_WINDOW_PURPOSES).not.toContain('spray');
    for (const purpose of ['spray', 'fungicide', 'cover-spray', '']) {
      const c = clone();
      (c.stages[1].windows[0] as { purpose: string }).purpose = purpose;
      expect(issues(c).length).toBeGreaterThan(0);
    }
  });

  it('only accepts disease, pest and weather targets', () => {
    const c = clone();
    c.stages[1].windows[0].targets = [{ id: 'x', kind: 'product' }];
    expect(issues(c).length).toBeGreaterThan(0);
  });

  it('needs pollinatorSensitive at pink, bloom and petal fall', () => {
    const bloom = clone();
    bloom.stages[2].windows[0].pollinatorSensitive = false;
    expect(issues(bloom).join()).toMatch(/pollinator sensitive/);

    for (const [field, value] of [
      ['stageId', 'fixture-pink'],
      ['stageName', 'Test fixture petal fall'],
      ['windowId', 'fixture-petal-fall-check'],
      ['note', 'Test fixture: check at bloom.']
    ] as const) {
      const c = clone();
      const stage = c.stages[0];
      if (field === 'stageId') stage.id = value;
      if (field === 'stageName') stage.name = value;
      if (field === 'windowId') stage.windows[0].id = value;
      if (field === 'note') stage.windows[0].note = value;
      expect(issues(c).join(), field).toMatch(/pollinator sensitive/);
      stage.windows[0].pollinatorSensitive = true;
      expect(issues(c), field).toEqual([]);
    }
  });

  it('checks the edition format', () => {
    for (const edition of ['26', '2026-2027', 'v2026', '']) {
      expect(issues({ ...clone(), edition }).length).toBeGreaterThan(0);
    }
  });

  it('only hosts orchard and stone fruit families and needs host crop ids', () => {
    expect(issues({ ...clone(), hostCropFamilies: ['small-fruit'] }).length).toBeGreaterThan(0);
    expect(issues({ ...clone(), hostCropFamilies: ['vine-fruit'] }).length).toBeGreaterThan(0);
    expect(issues({ ...clone(), hostCropFamilies: [] }).length).toBeGreaterThan(0);
    expect(issues({ ...clone(), hostCropPluginIds: [] }).length).toBeGreaterThan(0);
    expect(issues({ ...clone(), hostCropFamilies: ['orchard', 'stone-fruit'] })).toEqual([]);
  });

  it('refuses duplicate stage ids, orders, window ids and host ids', () => {
    const ids = clone();
    ids.stages[1].id = ids.stages[0].id;
    expect(issues(ids).join()).toMatch(/stage ids must be unique/);
    const orders = clone();
    orders.stages[1].order = 0;
    expect(issues(orders).join()).toMatch(/stage orders must be unique/);
    const windows = clone();
    windows.stages[1].windows[0].id = windows.stages[0].windows[0].id;
    expect(issues(windows).join()).toMatch(/window ids must be unique/);
    const hosts = clone();
    hosts.hostCropPluginIds = ['test-fixture-apple', 'test-fixture-apple'];
    expect(issues(hosts).join()).toMatch(/host crop ids must be unique/);
  });

  it('needs a source key on every description and window', () => {
    const c = clone();
    c.stages[0].windows[0].sourceKeys = [];
    expect(issues(c).length).toBeGreaterThan(0);
    const d = clone();
    (d.stages[0].recognise as { sourceKey?: string }).sourceKey = undefined;
    expect(issues(d).length).toBeGreaterThan(0);
  });

  it('checks the degree-day estimate', () => {
    const base = clone().stages[1].recognise.gddEstimate;
    const bad = [
      { ...base, gddFrom: 200, gddTo: 100 },
      { ...base, biofix: { kind: 'calendar-date' } },
      { ...base, biofix: { kind: 'january-1', date: '03-01' } },
      { ...base, biofix: { kind: 'first-bloom' } },
      { ...base, formula: '(tmax+tmin)/2-43' }
    ];
    for (const gddEstimate of bad) {
      const c = clone();
      (c.stages[1].recognise as Record<string, unknown>).gddEstimate = gddEstimate;
      expect(issues(c).length, JSON.stringify(gddEstimate)).toBeGreaterThan(0);
    }
  });
});

describe('orchard calendar copy guard', () => {
  const refused = [
    'Use 2 qt of oil.',
    'Mix 1.5 lb in the tank.',
    'Add 3 fl oz.',
    'A 1% solution.',
    'Use 8 oz per acre.',
    'Ten pounds per acre.',
    '400 gal/A dilute.',
    '2 pt/A.',
    '50 ml in water.',
    'Respect the PHI.',
    'Mind the REI.',
    'It is safe for bees.',
    'Recommended at this stage.',
    'Spray now.',
    'Cover sprays continue.',
    'Time a fungicide.',
    'Apply before rain.',
    'Use copper at green tip.',
    'Dormant oil at half-inch green.',
    'Captan for scab.',
    'Streptomycin at bloom.',
    'Apogee for shoot growth.',
    'Myclobutanil this week.',
    'Use 2 litros.',
    'Aplicar 2 onzas por acre.',
    'Pulverizar antes de la lluvia.',
    'Es seguro para las abejas.',
    'Recomendado en esta etapa.',
    'Respete el plazo de seguridad.',
    'Use cobre en punta verde.',
    'Un fungicida ahora.',
    'Rociar con azufre.'
  ];

  it.each(refused)('refuses %s', (text) => {
    expect(orchardCopyProblems(text).length).toBeGreaterThan(0);
  });

  const allowed = [
    'Buds swell and show silver tips.',
    'Half-inch green: about 1/2 inch of leaf shows.',
    'Remove mummies and prune out cankers.',
    'Watch for long wet periods above 50 F.',
    'Check the label.',
    'Gala apples drop near harvest.',
    'Thin to 1 fruit per cluster on 2 Gala trees.',
    'Las yemas se hinchan y muestran puntas plateadas.',
    'Revise la etiqueta.',
    'Quite las frutas momificadas.'
  ];

  it.each(allowed)('allows %s', (text) => {
    expect(orchardCopyProblems(text)).toEqual([]);
  });

  it('guards stage names, descriptions and window notes through the schema', () => {
    const name = clone();
    name.stages[0].name = 'Spray stage';
    expect(issues(name).join()).toMatch(/orchard calendar text may not carry/);
    const desc = clone();
    desc.stages[0].recognise.description = 'Recommended timing.';
    expect(issues(desc).join()).toMatch(/orchard calendar text may not carry/);
    const note = clone();
    note.stages[0].windows[0].note = 'Use 1 lb per acre.';
    expect(issues(note).join()).toMatch(/orchard calendar text may not carry/);
  });
});

describe('published orchard calendar JSON Schema', () => {
  const schema = JSON.parse(
    readFileSync(path.join(REPO_ROOT, 'schemas', 'orchard-calendar.schema.json'), 'utf-8')
  );

  it('is closed, names its kind and has no product field', () => {
    expect(schema.$id).toBe('https://cropcard.dev/schemas/orchard-calendar.schema.json');
    expect(schema.properties.type.const).toBe('orchard-calendar');
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(
      expect.arrayContaining([
        'pluginId',
        'type',
        'version',
        'edition',
        'hostCropFamilies',
        'hostCropPluginIds',
        'stages'
      ])
    );
    expect(JSON.stringify(schema)).not.toMatch(/productClasses|"rate"|"brand"/);
  });
});
