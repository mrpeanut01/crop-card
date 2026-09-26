import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { hardinessFrom, EARLIEST_OFFSET_DAYS } from '$lib/schedule/scheduleCandidacy';
import { FAMILY_SUCCESSION_DAYS } from '$lib/schedule/succession';
import { loadBedRecipes, validateBedRecipe, BedRecipeRegistry } from './bedRecipes';
import { loadPluginsFromDirectory } from './loader';
import { PluginRegistrationError, PluginRegistry } from './registry';
import type { BedRecipePlugin, CompanionPlugin, CropPlugin } from './schemas';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, '../../../../..');
const PLUGINS_DIR = path.join(REPO_ROOT, 'plugins');

let library: PluginRegistry;
let recipes: BedRecipePlugin[];
let libraryFailures: string[];

const isCrop = (id: string) => library.get(id)?.plugin.type === 'crop';

beforeAll(async () => {
  library = new PluginRegistry();
  const loaded = await loadPluginsFromDirectory(library, PLUGINS_DIR);
  libraryFailures = loaded.failed.map((f) => f.file);
  const result = await loadBedRecipes(PLUGINS_DIR, { isCrop });
  expect(result.failed.map((f) => `${f.file}: ${f.error.message}`)).toEqual([]);
  recipes = result.registry.all();
}, 60_000);

const VALID = {
  pluginId: 'test-recipe',
  type: 'bed-recipe',
  displayName: 'Test',
  version: '1.0.0',
  description: 'A test recipe.',
  bedSize: { widthFt: 4, lengthFt: 8 },
  steps: [
    {
      cropPluginId: 'lettuce-buttercrunch',
      start: { anchor: 'last-spring-frost', offsetDays: -14 }
    },
    {
      cropPluginId: 'bush-bean-provider',
      start: { anchor: 'after-step', afterStep: 0, offsetDays: 0 }
    }
  ]
};

function issuesOf(raw: unknown): { path: string; message: string }[] {
  try {
    validateBedRecipe(raw, { isCrop });
  } catch (e) {
    expect(e).toBeInstanceOf(PluginRegistrationError);
    return (e as PluginRegistrationError).issues;
  }
  return [];
}

describe('shipped bed recipes', () => {
  it('ships the starter set, all valid against the crop library', () => {
    expect(recipes.map((r) => r.pluginId)).toEqual([
      'carrots-then-fall-spinach',
      'garlic-then-summer-squash',
      'radishes-then-tomatoes',
      'salad-succession',
      'spring-greens-beans-fall-brassicas',
      'three-sisters-4x8',
      'tomato-and-basil'
    ]);
  });

  it('keeps recipe files out of the plugin library pass', () => {
    expect(libraryFailures.filter((f) => f.includes('bed-recipes'))).toEqual([]);
    for (const r of recipes) expect(library.get(r.pluginId)).toBeUndefined();
  });

  it('never starts a spring step before the crop can go in', () => {
    for (const recipe of recipes) {
      recipe.steps.forEach((step) => {
        if (step.start.anchor !== 'last-spring-frost' || step.start.offsetDays < -150) return;
        for (const id of [step.cropPluginId, ...step.alternates]) {
          const crop = library.get(id)!.plugin as CropPlugin;
          const hardiness = hardinessFrom(crop.plantingGuide?.soilTempMinF, crop.cropFamily);
          expect(
            step.start.offsetDays,
            `${recipe.pluginId}: ${id} is ${hardiness}`
          ).toBeGreaterThanOrEqual(EARLIEST_OFFSET_DAYS[hardiness]);
        }
      });
    }
  });

  it('takes succession intervals from the family defaults', () => {
    for (const recipe of recipes) {
      for (const step of recipe.steps) {
        if (!step.successions) continue;
        expect(step.successions.intervalDays).toBeUndefined();
        const crop = library.get(step.cropPluginId)!.plugin as CropPlugin;
        expect(FAMILY_SUCCESSION_DAYS[crop.cropFamily]).toBeGreaterThan(0);
      }
    }
  });

  it('three sisters follows the companion plugin offsets', () => {
    const plan = library.get('three-sisters')!.plugin as CompanionPlugin;
    const recipe = recipes.find((r) => r.pluginId === 'three-sisters-4x8')!;
    const cornStart = recipe.steps[0].start.offsetDays;
    for (const step of recipe.steps.slice(1)) {
      const crop = library.get(step.cropPluginId)!.plugin as CropPlugin;
      const member = plan.members!.find((m) => m.family === crop.cropFamily)!;
      expect(step.start.offsetDays - cornStart).toBe(member.plantingOffsetDays);
    }
  });

  it('carries no executable content', () => {
    for (const r of recipes) {
      const text = readFileSync(
        path.join(PLUGINS_DIR, 'bed-recipes', `${r.pluginId}.json`),
        'utf-8'
      );
      expect(text).not.toMatch(/function|=>|<script/i);
    }
  });

  it('publishes a JSON Schema for plugin authors', () => {
    const schema = JSON.parse(
      readFileSync(path.join(REPO_ROOT, 'schemas', 'bed-recipe.schema.json'), 'utf-8')
    );
    expect(schema.$id).toBe('https://cropcard.dev/schemas/bed-recipe.schema.json');
    expect(schema.properties.type.const).toBe('bed-recipe');
    expect(schema.required).toEqual(
      expect.arrayContaining(['pluginId', 'type', 'bedSize', 'steps'])
    );
  });
});

describe('validateBedRecipe', () => {
  it('accepts a valid recipe and fills defaults', () => {
    const r = validateBedRecipe(VALID, { isCrop });
    expect(r.steps[0].section).toEqual({ x: 0, y: 0, w: 1, l: 1 });
    expect(r.steps[0].alternates).toEqual([]);
  });

  it('rejects a crop that is not in the library', () => {
    const bad = structuredClone(VALID);
    bad.steps[1].cropPluginId = 'moon-melon';
    expect(issuesOf(bad)).toEqual([
      { path: 'steps.1.cropPluginId', message: 'moon-melon is not a registered crop plugin' }
    ]);
  });

  it('rejects an alternate that is not a crop', () => {
    const bad = structuredClone(VALID) as typeof VALID & {
      steps: Array<{ alternates?: string[] }>;
    };
    bad.steps[0].alternates = ['lettuce-red-sails', 'three-sisters'];
    expect(issuesOf(bad).map((i) => i.path)).toEqual(['steps.0.alternates.1']);
  });

  it.each([
    [
      'an after-step pointing forward',
      { start: { anchor: 'after-step', afterStep: 1, offsetDays: 0 } }
    ],
    [
      'afterStep on a frost anchor',
      { start: { anchor: 'last-spring-frost', afterStep: 0, offsetDays: 0 } }
    ],
    ['a section past the bed edge', { section: { x: 0.5, y: 0, w: 0.75, l: 1 } }],
    ['an unknown step key', { onApply: 'run()' }],
    ['an offset beyond six months', { start: { anchor: 'first-fall-frost', offsetDays: -200 } }]
  ])('rejects %s', (_label, patch) => {
    const bad = structuredClone(VALID) as { steps: Record<string, unknown>[] };
    bad.steps[1] = { ...bad.steps[1], ...patch };
    expect(issuesOf(bad).length).toBeGreaterThan(0);
  });

  it('rejects a frost-free range with min above max', () => {
    expect(issuesOf({ ...VALID, frostFreeDays: { min: 200, max: 100 } }).length).toBeGreaterThan(0);
  });

  it('refuses a duplicate recipe id in one registry', () => {
    const reg = new BedRecipeRegistry({ isCrop });
    reg.register(VALID);
    expect(() => reg.register(VALID)).toThrow(PluginRegistrationError);
  });
});

describe('loadBedRecipes', () => {
  it('reports bad files and loads the rest', async () => {
    const tmp = await mkdtemp(path.join(tmpdir(), 'cropcard-recipes-'));
    try {
      await mkdir(path.join(tmp, 'bed-recipes'));
      await writeFile(path.join(tmp, 'bed-recipes', 'ok.json'), JSON.stringify(VALID));
      await writeFile(path.join(tmp, 'bed-recipes', 'bad.json'), '{ not json');
      const { registry, failed } = await loadBedRecipes(tmp, { isCrop });
      expect(registry.all().map((r) => r.pluginId)).toEqual(['test-recipe']);
      expect(failed).toHaveLength(1);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('yields an empty registry when the folder is missing', async () => {
    const { registry, failed } = await loadBedRecipes(path.join(tmpdir(), 'nope-nope'), { isCrop });
    expect(registry.all()).toEqual([]);
    expect(failed).toEqual([]);
  });
});
