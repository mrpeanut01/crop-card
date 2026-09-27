import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadPluginsFromDirectory } from './loader';
import { PluginRegistry } from './registry';
import { loadPhase32DataKinds, type Phase32DataKinds } from './registryDataKinds';
import type { CropPlugin } from './schemas';
import {
  animalHealthFactPaths,
  checkPastureCoverage,
  checkSources,
  cropFactPaths,
  grazingFactPaths,
  missingWithdrawals,
  pestModelFactPaths,
  sourceEntrySchema,
  speciesFactPaths,
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
// 32B adds species-sources.json; until then any species number is unsourced.
const speciesSources = readJson<{ entries: SourceMap }>('species-sources.json', {
  entries: {}
}).entries;
const cropSources = readJson<SourceMap>('crop-data-sources.json', {});

let library: PluginRegistry;
let kinds: Phase32DataKinds;

beforeAll(async () => {
  library = new PluginRegistry();
  await loadPluginsFromDirectory(library, PLUGINS_DIR);
  kinds = await loadPhase32DataKinds(PLUGINS_DIR);
});

const isSpecies = (id: string) => kinds.species.has(id);

describe('Phase 32 data plugins load cleanly', () => {
  it('every species, animal-health and pest-model file registers', () => {
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

function pesticidesOf(registry: PluginRegistry): PesticidePlugin[] {
  return registry
    .all()
    .map((r) => r.plugin)
    .filter(
      (p): p is PesticidePlugin =>
        p.type === 'herbicide' || p.type === 'insecticide' || p.type === 'fungicide'
    );
}
