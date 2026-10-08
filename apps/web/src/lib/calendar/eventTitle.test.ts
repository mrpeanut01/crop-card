import { describe, expect, it } from 'vitest';
import {
  HARVEST_READINESS_BODY,
  calendarEventBody,
  calendarEventTitle,
  harvestTargetLabel,
  stageNameLabel
} from './eventTitle';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { STAGE_NAME_KEYS } from './stageNames';
import {
  FAMILY_STAGE_TEMPLATES,
  PERENNIAL_DAYOFYEAR_TEMPLATES
} from '$lib/plugins/growthStageTemplates';
import { speciesGroupTitle } from '$lib/i18n/speciesName';

const harvest = {
  title: 'Harvest target — Dry-storage harvest: Corn (Field)',
  cropPluginId: 'corn',
  varietyDisplayName: 'Corn (Field)',
  detail: { label: 'Dry-storage harvest' }
};

describe('calendarEventTitle', () => {
  it('leaves English titles alone', () => {
    expect(calendarEventTitle(harvest, null)).toBe(harvest.title);
    expect(calendarEventTitle(harvest, 'en')).toBe(harvest.title);
  });

  it('rebuilds a harvest target title in Spanish', () => {
    const es = calendarEventTitle(harvest, 'es');
    expect(es).toContain('Cosecha para almacenamiento en seco');
    expect(es).not.toContain('Corn (Field)');
  });

  it('keeps an owner-typed variety name', () => {
    const e = {
      title: 'Plant Bloody Butcher',
      cropPluginId: 'tomato',
      varietyDisplayName: 'Bloody Butcher'
    };
    expect(calendarEventTitle(e, 'es')).toBe('Sembrar Bloody Butcher');
  });

  it('leaves plugin-written harvest labels as written', () => {
    expect(harvestTargetLabel('Something custom', 'es')).toBe('Something custom');
  });
});

describe('speciesGroupTitle', () => {
  const chicken = {
    pluginId: 'chicken',
    displayName: 'Chicken',
    label: 'Chickens',
    groupNoun: 'flock'
  };
  it('is "Chicken flock" in English and Spanish word order in Spanish', () => {
    expect(speciesGroupTitle(chicken, null)).toBe('Chicken flock');
    expect(speciesGroupTitle(chicken, 'es')).toBe('Bandada de gallinas');
  });
  it('keeps a renamed farm copy as written', () => {
    expect(speciesGroupTitle({ ...chicken, displayName: 'Hen' }, 'es')).toBe('Bandada de gallinas');
    expect(speciesGroupTitle({ ...chicken, groupNoun: 'coop' }, 'es')).toBe('Coop de gallinas');
  });
});

describe('calendarEventBody', () => {
  it('translates only the engine harvest line', () => {
    const e = { body: HARVEST_READINESS_BODY };
    expect(calendarEventBody(e)).toBe(HARVEST_READINESS_BODY);
    expect(calendarEventBody(e, 'en')).toBe(HARVEST_READINESS_BODY);
    expect(calendarEventBody(e, 'es')).toMatch(/^Antes de cosechar/);
    const spray = {
      body: 'Window for Mesotrione + Stadia. Verify decon if sprayer last ran auxin.'
    };
    expect(calendarEventBody(spray, 'es')).toBe(spray.body);
    expect(calendarEventBody({}, 'es')).toBeUndefined();
  });
});

describe('growth stage titles (#665)', () => {
  const stageEvent = (title: string, code: string, name: string) => ({
    title,
    cropPluginId: 'tomato',
    varietyDisplayName: 'Tomato',
    detail: { stageCode: code, stageName: name }
  });

  it('translates a built-in stage name and keeps its code', () => {
    const e = stageEvent('BBCH-89 — Fully ripe', 'BBCH-89', 'Fully ripe');
    expect(calendarEventTitle(e, 'en')).toBe('BBCH-89 — Fully ripe');
    expect(calendarEventTitle(e, 'es')).toBe('BBCH-89 — Madurez completa');
  });

  it('drops a word code that would repeat the name in English', () => {
    const e = stageEvent('terminate — Termination window', 'terminate', 'Termination window');
    expect(calendarEventTitle(e, 'es')).toBe('Ventana de terminación');
    expect(calendarEventTitle(stageEvent('Bolting', 'bolt', 'Bolting'), 'es')).toBe(
      'Espigado prematuro'
    );
  });

  it('leaves a plugin-written stage name as written', () => {
    const e = stageEvent('X1 — Purple haze', 'X1', 'Purple haze');
    expect(calendarEventTitle(e, 'es')).toBe('X1 — Purple haze');
    expect(stageNameLabel('Purple haze', 'es')).toBe('Purple haze');
  });

  it('has a translation for every built-in and shipped plugin stage name', () => {
    const names = new Set<string>();
    const collect = (stages: readonly { name: string }[] | undefined) =>
      stages?.forEach((s) => names.add(s.name));
    for (const table of Object.values(FAMILY_STAGE_TEMPLATES)) collect(table?.stages);
    for (const tpl of Object.values(PERENNIAL_DAYOFYEAR_TEMPLATES)) collect(tpl?.stages);
    const dir = path.resolve(__dirname, '../../../../../plugins/crops');
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
      const plugin = JSON.parse(readFileSync(path.join(dir, file), 'utf8'));
      collect(plugin.growthStageTable?.stages);
      collect(plugin.zadoksStages);
    }
    expect(names.size).toBeGreaterThan(40);
    expect([...names].filter((n) => !STAGE_NAME_KEYS[n])).toEqual([]);
    for (const n of names) expect(stageNameLabel(n, 'es')).not.toBe(n);
  });
});
