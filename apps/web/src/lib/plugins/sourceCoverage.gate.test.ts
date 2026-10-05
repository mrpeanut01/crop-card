import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadPluginsFromDirectory } from './loader';
import { PluginRegistry } from './registry';
import { cropLookupOf } from './cropLookup';
import { loadPhase32DataKinds, type Phase32DataKinds } from './registryDataKinds';
import type { CropPlugin } from './schemas';
import { PERENNIAL_DAYOFYEAR_TEMPLATES } from './growthStageTemplates';
import {
  animalHealthFactPaths,
  carryoverDaysQuoteGaps,
  checkPastureCoverage,
  checkSources,
  cropFactPaths,
  forageHazardGaps,
  grazingFactPaths,
  missingWithdrawals,
  pestModelFactPaths,
  seasonalTaskWordingProblems,
  stageTemplateWordingProblems,
  sourceEntrySchema,
  treeSizeClassQuoteGaps,
  speciesFactPaths,
  type ForageSourceEntry,
  type PastureAllowlistEntry,
  type PesticidePlugin,
  type SourceMap
} from './sourceCoverage';

const REPO_ROOT = path.resolve(__dirname, '../../../../..');
const PLUGINS_DIR = path.join(REPO_ROOT, 'plugins');
const SCRIPTS = path.join(REPO_ROOT, 'apps/web/scripts');

function readJson<T>(file: string, fallback: T): T {
  const full = path.join(SCRIPTS, file);
  return existsSync(full) ? (JSON.parse(readFileSync(full, 'utf8')) as T) : fallback;
}

const animalHealthSources = readJson<{ entries: SourceMap }>('animal-health-sources.json', {
  entries: {}
}).entries;
const pestModelSources = readJson<{ entries: SourceMap }>('pest-model-sources.json', {
  entries: {}
}).entries;
const grazing = readJson<{ entries: SourceMap; pastureAllowlist: PastureAllowlistEntry[] }>(
  'grazing-sources.json',
  { entries: {}, pastureAllowlist: [] }
);
// Species facts (32B): foodProducingDefault and every care intervalDays.
const speciesSources = readJson<{ entries: SourceMap }>('species-sources.json', {
  entries: {}
}).entries;
const cropSources = readJson<SourceMap>('crop-data-sources.json', {});
// Phase 33C (M-13): the plan's forage-hazard-sources.json is this file.
const forageSources = readJson<{ entries: Record<string, ForageSourceEntry> }>(
  'forage-toxicity-sources.json',
  { entries: {} }
).entries;

let library: PluginRegistry;
let kinds: Phase32DataKinds;

beforeAll(async () => {
  library = new PluginRegistry();
  await loadPluginsFromDirectory(library, PLUGINS_DIR);
  kinds = await loadPhase32DataKinds(PLUGINS_DIR, { crops: cropLookupOf(library) });
});

const isSpecies = (id: string) => kinds.species.has(id);

describe('Phase 32 data plugins load cleanly', () => {
  it('every species, animal-health, pest-model and orchard calendar file registers', () => {
    expect(kinds.failed.map((f) => `${path.basename(f.file)}: ${f.error.message}`)).toEqual([]);
  });
});

describe('Phase 32A source coverage gate', () => {
  it('every animal-health withdrawal value is sourced', () => {
    const items = kinds.animalHealth
      .all()
      .map((p) => ({ pluginId: p.pluginId, paths: animalHealthFactPaths(p) }));
    expect(
      checkSources(items, animalHealthSources),
      'add a quote to apps/web/scripts/animal-health-sources.json, or leave the value out'
    ).toEqual([]);
  });

  it('every food species on an animal-health label has a withdrawal', () => {
    const isFood = (id: string) => kinds.species.get(id)?.foodProducingDefault;
    const gaps = kinds.animalHealth
      .all()
      .flatMap((p) => missingWithdrawals(p, isFood).map((path) => `${p.pluginId}: ${path}`));
    expect(gaps, 'a product ships only once every labelled food species is sourced').toEqual([]);
  });

  it('every pest-model number is sourced', () => {
    const items = kinds.pestModels
      .all()
      .map((p) => ({ pluginId: p.pluginId, paths: pestModelFactPaths(p) }));
    expect(checkSources(items, pestModelSources)).toEqual([]);
  });

  it('every species food flag and care interval is sourced', () => {
    const items = kinds.species
      .all()
      .map((p) => ({ pluginId: p.pluginId, paths: speciesFactPaths(p) }));
    expect(checkSources(items, speciesSources)).toEqual([]);
  });

  it('every grazingRestrictions value is sourced and names real species', () => {
    const pesticides = pesticidesOf(library);
    const withBlock = pesticides.filter((p) => p.grazingRestrictions !== undefined);
    const items = withBlock.map((p) => ({
      pluginId: p.pluginId,
      paths: grazingFactPaths(p.grazingRestrictions!)
    }));
    expect(checkSources(items, grazing.entries)).toEqual([]);
    const unknown = withBlock.flatMap((p) =>
      (p.grazingRestrictions!.speciesExceptions ?? [])
        .filter((e) => !isSpecies(e.speciesId))
        .map((e) => `${p.pluginId}: ${e.speciesId}`)
    );
    expect(unknown).toEqual([]);
  });

  it('every grazingRestrictions block records all four intervals (C-24, 0 = none stated)', () => {
    const fields = [
      'grazeDays',
      'hayDays',
      'lactatingDairyGrazeDays',
      'meatAnimalRemovalBeforeSlaughterDays'
    ] as const;
    const missing = pesticidesOf(library)
      .filter((p) => p.grazingRestrictions && p.grazingRestrictions.notForPasture !== true)
      .flatMap((p) =>
        fields
          .filter((f) => p.grazingRestrictions![f] === undefined)
          .map((f) => `${p.pluginId}: ${f}`)
      );
    expect(missing, 'record 0 with a quote when the label states no interval').toEqual([]);
  });

  it('every pasture-labelled pesticide has grazingRestrictions or an allowlist reason', () => {
    const report = checkPastureCoverage(
      pesticidesOf(library),
      (id) => library.cropFamilyOf(id),
      grazing.pastureAllowlist
    );
    expect(
      report.unallowlisted,
      'add grazingRestrictions from the label, or list the plugin in grazing-sources.json pastureAllowlist with a reason'
    ).toEqual([]);
    expect(report.stale, 'remove allowlist entries for products that are now covered').toEqual([]);
    const ids = grazing.pastureAllowlist.map((e) => e.pluginId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of grazing.pastureAllowlist) {
      expect(e.reason.trim().length, e.pluginId).toBeGreaterThan(10);
    }
  });

  it('every new crop seed-start number and animal toxicity entry is sourced', () => {
    const crops = library.crops();
    const items = crops.map((c: CropPlugin) => ({ pluginId: c.pluginId, paths: cropFactPaths(c) }));
    expect(checkSources(items, cropSources)).toEqual([]);
    const unknown = crops.flatMap((c) =>
      (c.animalToxicity ?? [])
        .flatMap((t) => t.speciesIds)
        .filter((id) => !isSpecies(id))
        .map((id) => `${c.pluginId}: ${id}`)
    );
    expect(unknown).toEqual([]);
  });

  it('every tree size class quote states its spacing and bearing age', () => {
    const crops = library.crops();
    expect(treeSizeClassQuoteGaps(crops, cropSources)).toEqual([]);
    expect(crops.filter((c) => c.treeSizeClasses).length).toBeGreaterThan(0);
  });

  it('every entry in the Phase 32 source files is a complete quote', () => {
    const bad: string[] = [];
    for (const [file, map] of [
      ['animal-health-sources.json', animalHealthSources],
      ['pest-model-sources.json', pestModelSources],
      ['grazing-sources.json', grazing.entries],
      ['species-sources.json', speciesSources]
    ] as const) {
      for (const [pluginId, facts] of Object.entries(map)) {
        for (const [fact, entry] of Object.entries(facts)) {
          if (!sourceEntrySchema.safeParse(entry).success) bad.push(`${file} ${pluginId} ${fact}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('Phase 33C plugin data gate', () => {
  it('every manureCarryoverDays quote states the number of days (M-17)', () => {
    expect(carryoverDaysQuoteGaps(pesticidesOf(library), grazing.entries)).toEqual([]);
  });

  it('ships exactly the ruled carryover days and hay flags (M-15, M-16)', () => {
    const days = Object.fromEntries(
      pesticidesOf(library)
        .filter((p) => p.grazingRestrictions?.manureCarryoverDays !== undefined)
        .map((p) => [p.pluginId, p.grazingRestrictions!.manureCarryoverDays])
    );
    expect(days).toEqual({
      'grazonnext-hl': 3,
      'duracor-aminopyralid-florpyrauxifen': 3,
      'chaparral-aminopyralid-metsulfuron': 3,
      crossbow: 3,
      stinger: 7
    });
    const hay = pesticidesOf(library)
      .filter((p) => p.grazingRestrictions?.hayOffFarmRestricted === true)
      .map((p) => p.pluginId)
      .sort();
    expect(hay).toEqual([
      'chaparral-aminopyralid-metsulfuron',
      'duracor-aminopyralid-florpyrauxifen',
      'grazonnext-hl'
    ]);
  });

  it('every forage hazard and trigger is sourced, and research and data agree (M-21 to M-23)', () => {
    expect(forageSources, 'forage-toxicity-sources.json must load').not.toEqual({});
    expect(forageHazardGaps(library.crops(), forageSources)).toEqual([]);
  });
});

describe('OC-1 crop seasonal tasks carry no spray advice', () => {
  it('no crop plugin has a spray seasonal row or pesticide wording in one', () => {
    expect(
      seasonalTaskWordingProblems(library.crops()),
      'seasonal and orchard tasks may not name sprays or pesticides (docs/design/ORCHARD_CALENDAR.md OC-1)'
    ).toEqual([]);
  });

  it('no perennial fruit growth-stage hint names a spray or pesticide', () => {
    expect(Object.keys(PERENNIAL_DAYOFYEAR_TEMPLATES)).toContain('vine-fruit');
    expect(
      stageTemplateWordingProblems(PERENNIAL_DAYOFYEAR_TEMPLATES),
      'stage hints may not name sprays or pesticides (docs/design/ORCHARD_CALENDAR.md OC-1)'
    ).toEqual([]);
  });

  it('still checks the rows the orchard and berry plugins keep', () => {
    const rows = library
      .crops()
      .flatMap((c) => [...(c.seasonalTasks ?? []), ...(c.orchardSeasonalTasks ?? [])]);
    expect(rows.length).toBeGreaterThan(10);
  });
});

function pesticidesOf(registry: PluginRegistry): PesticidePlugin[] {
  return registry
    .all()
    .map((r) => r.plugin)
    .filter(
      (p): p is PesticidePlugin =>
        p.type === 'herbicide' || p.type === 'insecticide' || p.type === 'fungicide'
    );
}
