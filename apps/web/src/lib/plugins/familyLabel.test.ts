import { describe, expect, it } from 'vitest';
import { CROP_FAMILIES } from '$lib/safety/cropFamilyLethality';
import { ARCHETYPES, HARVEST_STYLES } from './schemas';
import { archetypeLabel, cropFamilyLabel, harvestStyleLabel, pluginKindLabel } from './familyLabel';
import { sexLabel, sexOptions } from './species';

describe('cropFamilyLabel', () => {
  it('names every family in English and Spanish', () => {
    for (const f of CROP_FAMILIES) {
      const en = cropFamilyLabel(f);
      const es = cropFamilyLabel(f, 'es');
      expect(en).not.toContain('family.');
      expect(es).not.toContain('family.');
      expect(en.length).toBeGreaterThan(0);
    }
    expect(cropFamilyLabel('solanaceae')).toBe('Tomato family');
    expect(cropFamilyLabel('solanaceae', 'es')).toBe('Familia del tomate');
  });

  it('humanizes an unknown code and labels a missing one', () => {
    expect(cropFamilyLabel('sea-vegetable')).toBe('Sea vegetable');
    expect(cropFamilyLabel(null)).toBe('Unclassified');
    expect(cropFamilyLabel(undefined, 'es')).toBe('Sin clasificar');
    expect(cropFamilyLabel('toString')).toBe('ToString');
  });
});

describe('archetypeLabel and harvestStyleLabel', () => {
  it('names every archetype and harvest style', () => {
    for (const a of ARCHETYPES) {
      expect(archetypeLabel(a)).not.toContain('archetype.');
      expect(archetypeLabel(a, 'es')).not.toContain('archetype.');
    }
    for (const h of HARVEST_STYLES) {
      expect(harvestStyleLabel(h)).not.toContain('pluginui.');
      expect(harvestStyleLabel(h, 'es')).not.toContain('pluginui.');
    }
    expect(archetypeLabel('cut-and-come-again-leafy', 'es')).toBe('Corte y rebrote');
    expect(archetypeLabel(null)).toBe('Not set');
  });
});

describe('pluginKindLabel', () => {
  it('translates known kinds and passes others through', () => {
    expect(pluginKindLabel('crop')).toBe('crop');
    expect(pluginKindLabel('crop', 'es')).toBe('cultivo');
    expect(pluginKindLabel('species', 'es')).toBe('species');
  });
});

describe('species sex words with a locale', () => {
  it('keeps English output unchanged with no locale or en', () => {
    for (const id of ['chicken', 'goat', 'rabbit', 'dog', 'llama']) {
      expect(sexOptions(id, 'en')).toEqual(sexOptions(id));
    }
    expect(sexLabel('goat', 'neutered-male', 'en')).toBe('Wether');
  });

  it('translates per species in Spanish', () => {
    expect(sexLabel('chicken', 'female', 'es')).toBe('Gallina');
    expect(sexLabel('goat', 'female', 'es')).toBe('Cabra');
    expect(sexLabel('rabbit', 'female', 'es')).toBe('Coneja');
    expect(sexLabel('dog', 'spayed-female', 'es')).toBe('Hembra esterilizada');
    expect(sexLabel('chicken', 'spayed-female', 'es')).toBe('Hembra esterilizada');
    expect(sexLabel('cat', 'unknown', 'es')).toBe('No estoy seguro');
  });
});
