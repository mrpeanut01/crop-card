import { describe, expect, it } from 'vitest';
import {
  HARVEST_READINESS_BODY,
  calendarEventBody,
  calendarEventTitle,
  harvestTargetLabel
} from './eventTitle';
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
