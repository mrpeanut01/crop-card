/**
 * Registry passes for the Phase 32 data-only kinds: species, animal-health
 * products and pest models. Like bed recipes, each lives in its own folder
 * under plugins/, is parsed with its own strict schema and never joins the
 * library `pluginSchema`. Animal-health label uses must name a registered
 * species plugin.
 *
 * Server-only (node:fs).
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { z } from 'zod';
import { collectJsonFiles } from './loader';
import { PluginRegistrationError } from './registry';
import {
  animalHealthPluginSchema,
  pestModelPluginSchema,
  speciesPluginSchema,
  type AnimalHealthPlugin,
  type PestModelPlugin,
  type SpeciesPlugin
} from './schemas';

export const SPECIES_DIR = 'species';
export const ANIMAL_HEALTH_DIR = 'animal-health';
export const PEST_MODELS_DIR = 'pest-models';

type Issue = { path: string; message: string };

function parseOrThrow<T>(schema: z.ZodType<T>, raw: unknown, label: string): T {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new PluginRegistrationError(
      `${label} failed schema validation`,
      parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
    );
  }
  return parsed.data;
}

export interface SpeciesLookup {
  isSpecies(pluginId: string): boolean;
}

export function validateSpecies(raw: unknown): SpeciesPlugin {
  return parseOrThrow(speciesPluginSchema, raw, 'species plugin');
}

export function validateAnimalHealth(raw: unknown, species: SpeciesLookup): AnimalHealthPlugin {
  const plugin = parseOrThrow(animalHealthPluginSchema, raw, 'animal-health plugin');
  const issues: Issue[] = plugin.labelUses
    .map((u, i) => ({ u, i }))
    .filter(({ u }) => !species.isSpecies(u.speciesId))
    .map(({ u, i }) => ({
      path: `labelUses.${i}.speciesId`,
      message: `${u.speciesId} is not a registered species plugin`
    }));
  if (issues.length > 0) {
    throw new PluginRegistrationError('animal-health plugin names an unknown species', issues);
  }
  return plugin;
}

export function validatePestModel(raw: unknown): PestModelPlugin {
  return parseOrThrow(pestModelPluginSchema, raw, 'pest model');
}

export class DataKindRegistry<T extends { pluginId: string }> {
  private readonly byId = new Map<string, T>();

  constructor(
    readonly kind: string,
    private readonly validate: (raw: unknown) => T
  ) {}

  register(raw: unknown): T {
    const plugin = this.validate(raw);
    if (this.byId.has(plugin.pluginId)) {
      throw new PluginRegistrationError(`duplicate ${this.kind}`, [
        { path: 'pluginId', message: `${plugin.pluginId} is already registered` }
      ]);
    }
    this.byId.set(plugin.pluginId, plugin);
    return plugin;
  }

  get(pluginId: string): T | undefined {
    return this.byId.get(pluginId);
  }

  has(pluginId: string): boolean {
    return this.byId.has(pluginId);
  }

  all(): T[] {
    return [...this.byId.values()].sort((a, b) => a.pluginId.localeCompare(b.pluginId));
  }
}

export interface DataKindFailure {
  file: string;
  error: Error;
}

async function loadInto<T extends { pluginId: string }>(
  registry: DataKindRegistry<T>,
  dir: string,
  failed: DataKindFailure[]
): Promise<void> {
  for (const file of await collectJsonFiles(dir)) {
    try {
      registry.register(JSON.parse(await readFile(file, 'utf-8')));
    } catch (error) {
      failed.push({ file, error: error instanceof Error ? error : new Error(String(error)) });
    }
  }
}

export interface Phase32DataKinds {
  species: DataKindRegistry<SpeciesPlugin>;
  animalHealth: DataKindRegistry<AnimalHealthPlugin>;
  pestModels: DataKindRegistry<PestModelPlugin>;
  failed: DataKindFailure[];
}

/** Loads species first, so animal-health label uses can be checked against
 *  them. Missing folders yield empty registries. */
export async function loadPhase32DataKinds(pluginsRoot: string): Promise<Phase32DataKinds> {
  const failed: DataKindFailure[] = [];
  const species = new DataKindRegistry('species plugin', validateSpecies);
  await loadInto(species, path.join(pluginsRoot, SPECIES_DIR), failed);
  const animalHealth = new DataKindRegistry('animal-health plugin', (raw) =>
    validateAnimalHealth(raw, { isSpecies: (id) => species.has(id) })
  );
  await loadInto(animalHealth, path.join(pluginsRoot, ANIMAL_HEALTH_DIR), failed);
  const pestModels = new DataKindRegistry('pest model', validatePestModel);
  await loadInto(pestModels, path.join(pluginsRoot, PEST_MODELS_DIR), failed);
  return { species, animalHealth, pestModels, failed };
}
