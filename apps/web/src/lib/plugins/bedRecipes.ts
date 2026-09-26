/**
 * Bed recipe registry pass (Phase 30E). Recipes live in plugins/bed-recipes/
 * and are data only, like every plugin: each file is parsed with
 * `bedRecipePluginSchema`, then every crop it names (primary and alternates)
 * must be a registered crop plugin. The library loader skips this folder so
 * `pluginSchema` never sees a recipe.
 *
 * Server-only (node:fs).
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { collectJsonFiles } from './loader';
import { PluginRegistrationError } from './registry';
import { bedRecipePluginSchema, type BedRecipePlugin } from './schemas';

export const BED_RECIPES_DIR = 'bed-recipes';

export interface CropLookup {
  /** True when `pluginId` is a registered crop plugin. */
  isCrop(pluginId: string): boolean;
}

export function validateBedRecipe(raw: unknown, crops: CropLookup): BedRecipePlugin {
  const parsed = bedRecipePluginSchema.safeParse(raw);
  if (!parsed.success) {
    throw new PluginRegistrationError(
      'bed recipe failed schema validation',
      parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
    );
  }
  const issues: { path: string; message: string }[] = [];
  parsed.data.steps.forEach((step, i) => {
    [step.cropPluginId, ...step.alternates].forEach((id, j) => {
      if (!crops.isCrop(id)) {
        issues.push({
          path: j === 0 ? `steps.${i}.cropPluginId` : `steps.${i}.alternates.${j - 1}`,
          message: `${id} is not a registered crop plugin`
        });
      }
    });
  });
  if (issues.length > 0) {
    throw new PluginRegistrationError('bed recipe names an unknown crop', issues);
  }
  return parsed.data;
}

export class BedRecipeRegistry {
  private readonly byId = new Map<string, BedRecipePlugin>();

  constructor(private readonly crops: CropLookup) {}

  register(raw: unknown): BedRecipePlugin {
    const recipe = validateBedRecipe(raw, this.crops);
    if (this.byId.has(recipe.pluginId)) {
      throw new PluginRegistrationError('duplicate bed recipe', [
        { path: 'pluginId', message: `${recipe.pluginId} is already registered` }
      ]);
    }
    this.byId.set(recipe.pluginId, recipe);
    return recipe;
  }

  get(pluginId: string): BedRecipePlugin | undefined {
    return this.byId.get(pluginId);
  }

  all(): BedRecipePlugin[] {
    return [...this.byId.values()].sort((a, b) => a.pluginId.localeCompare(b.pluginId));
  }
}

export interface BedRecipeLoadResult {
  registry: BedRecipeRegistry;
  failed: { file: string; error: Error }[];
}

/** Loads `<pluginsRoot>/bed-recipes/**.json`. A missing folder yields an
 *  empty registry. */
export async function loadBedRecipes(
  pluginsRoot: string,
  crops: CropLookup
): Promise<BedRecipeLoadResult> {
  const registry = new BedRecipeRegistry(crops);
  const failed: BedRecipeLoadResult['failed'] = [];
  for (const file of await collectJsonFiles(path.join(pluginsRoot, BED_RECIPES_DIR))) {
    try {
      registry.register(JSON.parse(await readFile(file, 'utf-8')));
    } catch (error) {
      failed.push({ file, error: error instanceof Error ? error : new Error(String(error)) });
    }
  }
  return { registry, failed };
}
