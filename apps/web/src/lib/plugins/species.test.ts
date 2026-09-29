import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { animals } from '$lib/db/schema';
import { FIXTURE_PET_SPECIES, FIXTURE_SPECIES } from './dataKinds.fixtures';
import { DataKindRegistry, loadPhase32DataKinds, validateSpecies } from './registryDataKinds';
import type { SpeciesPlugin } from './schemas';
import {
  ANIMAL_SEXES,
  STARTER_SPECIES_IDS,
  foodProducingDefaultFor,
  foodProducingExplanation,
  groupNounFor,
  offersNotForSlaughter,
  sexLabel,
  sexOptions,
  speciesLabel,
  speciesTiles
} from './species';

const REPO_ROOT = path.resolve(__dirname, '../../../../..');
const PLUGINS_DIR = path.join(REPO_ROOT, 'plugins');
const SPECIES_DIR = path.join(PLUGINS_DIR, 'species');

function registryOf(...raw: unknown[]): DataKindRegistry<SpeciesPlugin> {
  const reg = new DataKindRegistry('species plugin', validateSpecies);
  for (const r of raw) reg.register(r);
  return reg;
}

describe('shipped species library', () => {
  let species: DataKindRegistry<SpeciesPlugin>;

  beforeAll(async () => {
    const kinds = await loadPhase32DataKinds(PLUGINS_DIR);
    expect(kinds.failed).toEqual([]);
    species = kinds.species;
  });

  it('ships exactly the ruled starter species, with no Other', () => {
    expect(
      species
        .all()
        .map((s) => s.pluginId)
        .sort()
    ).toEqual([...STARTER_SPECIES_IDS].sort());
  });

  it('names each file after its pluginId', () => {
    const files = readdirSync(SPECIES_DIR).filter((f) => f.endsWith('.json'));
    for (const f of files) {
      const raw = JSON.parse(readFileSync(path.join(SPECIES_DIR, f), 'utf8'));
      expect(`${raw.pluginId}.json`).toBe(f);
    }
  });

  it('marks dogs and cats as not food-producing and every other species as food-producing', () => {
    const notFood = species
      .all()
      .filter((s) => !s.foodProducingDefault)
      .map((s) => s.pluginId)
      .sort();
    expect(notFood).toEqual(['cat', 'dog']);
  });

  it('offers the not-for-slaughter toggle on horses only', () => {
    const withToggle = species
      .all()
      .filter((s) => s.notForSlaughterToggle === true)
      .map((s) => s.pluginId);
    expect(withToggle).toEqual(['horse']);
  });

  it('ships care suggestions with no interval, so none needs a source (D2-09)', () => {
    for (const s of species.all()) {
      for (const c of s.careDefaults ?? []) {
        expect(c.intervalDays, `${s.pluginId}.${c.key}`).toBeUndefined();
        expect(c.note ?? '', `${s.pluginId}.${c.key}`).toMatch(/ask your vet/i);
      }
    }
    expect(species.get('dog')?.careDefaults?.map((c) => c.key)).toEqual([
      'rabies',
      'core-vaccines'
    ]);
  });

  it('uses tile icons that exist in lucide-svelte', () => {
    const iconsDir = path.resolve('node_modules/lucide-svelte/dist/icons');
    for (const s of species.all()) {
      expect(existsSync(path.join(iconsDir, `${s.tile.icon}.svelte`)), s.pluginId).toBe(true);
    }
  });

  it('lists tiles in starter order', () => {
    expect(speciesTiles(species.all()).map((t) => t.id)).toEqual([...STARTER_SPECIES_IDS]);
  });

  it('explains the food flag in one plain line without the word livestock', () => {
    for (const s of species.all()) {
      const line = foodProducingExplanation(s);
      expect(line, s.pluginId).not.toMatch(/livestock/i);
      expect(line, s.pluginId).not.toMatch(/[–—]/);
    }
    expect(foodProducingExplanation(species.get('chicken'))).toBe(
      'Chickens count as food animals because people eat their eggs.'
    );
    expect(foodProducingExplanation(species.get('dog'))).toMatch(/^Dogs are not food animals/);
    expect(foodProducingExplanation(species.get('horse'))).toMatch(/even when kept as pets/);
  });
});

describe('species lookups', () => {
  const reg = registryOf(FIXTURE_SPECIES, FIXTURE_PET_SPECIES);

  it('reads the plugin default', () => {
    expect(foodProducingDefaultFor(reg, FIXTURE_SPECIES.pluginId)).toBe(true);
    expect(foodProducingDefaultFor(reg, FIXTURE_PET_SPECIES.pluginId)).toBe(false);
  });

  it('treats an unknown species as food-producing', () => {
    expect(foodProducingDefaultFor(reg, 'turkey')).toBe(true);
    expect(foodProducingDefaultFor(registryOf(), 'dog')).toBe(true);
    expect(foodProducingExplanation(undefined)).toMatch(/food animal to be safe/);
  });

  it('falls back to neutral words for an unknown species', () => {
    expect(groupNounFor(reg, 'turkey')).toBe('group');
    expect(groupNounFor(reg, FIXTURE_SPECIES.pluginId)).toBe('flock');
    expect(speciesLabel(reg, 'turkey')).toBe('Unknown species');
    expect(offersNotForSlaughter(reg, 'turkey')).toBe(false);
  });

  it('sorts species outside the starter set after it, by name', () => {
    const extra = { ...FIXTURE_PET_SPECIES, pluginId: 'aardvark', displayName: 'Aardvark' };
    const dog = { ...FIXTURE_PET_SPECIES, pluginId: 'dog', displayName: 'Dog' };
    const tiles = speciesTiles([
      validateSpecies(extra),
      validateSpecies(FIXTURE_SPECIES),
      validateSpecies(dog)
    ]);
    expect(tiles.map((t) => t.id)).toEqual(['dog', 'aardvark', FIXTURE_SPECIES.pluginId]);
    expect(tiles[2].label).toBe('Hens');
    expect(tiles[1].label).toBe('Aardvark');
  });
});

describe('sex vocabulary', () => {
  it('mirrors the animals.sex column enum', () => {
    expect([...ANIMAL_SEXES]).toEqual([...animals.sex.enumValues]);
  });

  it('uses species words', () => {
    expect(sexLabel('chicken', 'female')).toBe('Hen');
    expect(sexLabel('horse', 'neutered-male')).toBe('Gelding');
    expect(sexLabel('sheep', 'male')).toBe('Ram');
    expect(sexLabel('dog', 'spayed-female')).toBe('Spayed female');
    expect(sexLabel('turkey', 'male')).toBe('Male');
    expect(sexLabel('goat', 'unknown')).toBe('Not sure');
  });

  it('labels a stored value a species does not offer', () => {
    expect(sexLabel('chicken', 'spayed-female')).toBe('Spayed female');
  });

  it('offers only sensible choices, ending with Not sure', () => {
    expect(sexOptions('chicken').map((o) => o.value)).toEqual([
      'female',
      'male',
      'neutered-male',
      'unknown'
    ]);
    expect(sexOptions('cat').map((o) => o.value)).toEqual([...ANIMAL_SEXES]);
    expect(sexOptions('turkey').map((o) => o.value)).toEqual([...ANIMAL_SEXES]);
    for (const id of [...STARTER_SPECIES_IDS, 'turkey']) {
      const opts = sexOptions(id);
      expect(opts.at(-1)).toEqual({ value: 'unknown', label: 'Not sure' });
      for (const o of opts) expect(o.label, `${id} ${o.value}`).not.toMatch(/[–—]/);
    }
  });
});
