#!/usr/bin/env node
/**
 * Regenerate /schemas/*.schema.json from the Zod source of truth at
 * apps/web/src/lib/plugins/schemas.ts (Phase 21 B-25, absorbed B-22).
 *
 * The /schemas/ files are author-facing documentation. They are NOT used
 * at runtime — Zod validates at registration time. Keeping them in sync
 * with the Zod definitions lets external plugin authors run their JSON
 * through a generic JSON Schema validator and get the same answer the
 * runtime would give.
 *
 * Usage:
 *   pnpm gen:schemas
 *
 * Outputs (relative to repo root):
 *   schemas/crop.schema.json
 *   schemas/herbicide.schema.json
 *   schemas/insecticide.schema.json
 *   schemas/fungicide.schema.json       (newly generated; previously missing)
 *   schemas/fertilizer.schema.json      (newly generated; previously missing)
 *   schemas/companion.schema.json
 *   schemas/bed-recipe.schema.json      (Phase 30E, plugins/bed-recipes/)
 *   schemas/species.schema.json         (Phase 32A, plugins/species/)
 *   schemas/animal-health.schema.json   (Phase 32A, plugins/animal-health/)
 *   schemas/pest-model.schema.json      (Phase 32A, plugins/pest-models/)
 *   schemas/orchard-calendar.schema.json (ruling OC-8, plugins/orchard-calendars/)
 *
 * Each file is written with a stable `$id` URL and a top-level description
 * pointing back to the Zod source. The schemas are emitted as JSON Schema
 * draft 2020-12 (matches the prior hand-written shape).
 */

import { fileURLToPath } from 'node:url';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// `tsx` is required to load the .ts source. Invoke via the npm script so
// it's available in the path: `pnpm gen:schemas`.
import { z } from 'zod';

import {
  cropPluginSchema,
  herbicidePluginSchema,
  insecticidePluginSchema,
  fungicidePluginSchema,
  fertilizerPluginSchema,
  companionPluginSchema,
  bedRecipePluginSchema,
  speciesPluginSchema,
  animalHealthPluginSchema,
  pestModelPluginSchema,
  orchardCalendarPluginSchema
} from '../src/lib/plugins/schemas.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../../..');
const OUT_DIR = resolve(REPO_ROOT, 'schemas');

mkdirSync(OUT_DIR, { recursive: true });

const TARGETS = [
  {
    file: 'crop.schema.json',
    schema: cropPluginSchema,
    title: 'CropCard Crop Plugin',
    description:
      'Data-only crop variety definition. Cannot override Safety Kernel rules. Mirrors apps/web/src/lib/plugins/schemas.ts (cropPluginSchema) — the Zod schema is the runtime source of truth; this file is documentation for plugin authors.'
  },
  {
    file: 'herbicide.schema.json',
    schema: herbicidePluginSchema,
    title: 'CropCard Herbicide Plugin',
    description:
      'Data-only herbicide definition. Mirrors apps/web/src/lib/plugins/schemas.ts (herbicidePluginSchema). complianceFlags (Phase 21) drives the philosophy filter on the Inputs Plan step.'
  },
  {
    file: 'insecticide.schema.json',
    schema: insecticidePluginSchema,
    title: 'CropCard Insecticide Plugin',
    description:
      'Data-only insecticide definition. Mirrors apps/web/src/lib/plugins/schemas.ts (insecticidePluginSchema).'
  },
  {
    file: 'fungicide.schema.json',
    schema: fungicidePluginSchema,
    title: 'CropCard Fungicide Plugin',
    description:
      'Data-only fungicide definition. Mirrors apps/web/src/lib/plugins/schemas.ts (fungicidePluginSchema). New in Phase 9; first published in Phase 21.'
  },
  {
    file: 'fertilizer.schema.json',
    schema: fertilizerPluginSchema,
    title: 'CropCard Fertilizer Plugin',
    description:
      'Data-only fertilizer definition. Mirrors apps/web/src/lib/plugins/schemas.ts (fertilizerPluginSchema). The existing `organic` boolean is the source of truth for organic-source amendments; complianceFlags (Phase 21) adds the NOP / OMRI distinction.'
  },
  {
    file: 'companion.schema.json',
    schema: companionPluginSchema,
    title: 'CropCard Companion Plugin',
    description:
      'Data-only companion-planting definition (goodWith / badWith / two-sided keepApart / member-system). Mirrors apps/web/src/lib/plugins/schemas.ts (companionPluginSchema).'
  },
  {
    file: 'bed-recipe.schema.json',
    schema: bedRecipePluginSchema,
    title: 'CropCard Bed Recipe Plugin',
    description:
      'Data-only garden bed recipe: a timed sequence of crops that fills one bed, anchored to the last spring frost, the first fall frost or the end of an earlier step. Every cropPluginId and alternate must name a registered crop plugin. Loaded from plugins/bed-recipes/. Mirrors packages/plugin-validation/src/schemas.ts (bedRecipePluginSchema).'
  },
  {
    file: 'species.schema.json',
    schema: speciesPluginSchema,
    title: 'CropCard Species Plugin',
    description:
      'Data-only animal species definition: names, group noun, product types, the default food-producing flag and care cadence defaults. foodProducingDefault and every care intervalDays need a quoted source in apps/web/scripts/species-sources.json. Loaded from plugins/species/. Mirrors packages/plugin-validation/src/schemas.ts (speciesPluginSchema).'
  },
  {
    file: 'animal-health.schema.json',
    schema: animalHealthPluginSchema,
    title: 'CropCard Animal-Health Plugin',
    description:
      'Data-only animal-health product (dewormer, antibiotic, vaccine) with its label uses and withdrawal times per species and class. Every labelUses speciesId must name a species plugin, and every withdrawal value needs a quoted source in apps/web/scripts/animal-health-sources.json. A missing withdrawal is unknown, and the safety kernel blocks food use on unknown. The kernel, not the plugin, owns the prohibited-drug list. Loaded from plugins/animal-health/. Mirrors packages/plugin-validation/src/schemas.ts (animalHealthPluginSchema).'
  },
  {
    file: 'pest-model.schema.json',
    schema: pestModelPluginSchema,
    title: 'CropCard Pest-Model Plugin',
    description:
      'Data-only degree-day pest model. method names one of the degree-day methods the app implements and never carries a formula; stage advice is about scouting or covering, never spraying. Every number needs a quoted source in apps/web/scripts/pest-model-sources.json. Loaded from plugins/pest-models/. Mirrors packages/plugin-validation/src/schemas.ts (pestModelPluginSchema).'
  },
  {
    file: 'orchard-calendar.schema.json',
    schema: orchardCalendarPluginSchema,
    title: 'CropCard Orchard Calendar Plugin',
    description:
      'Data-only tree fruit calendar for one guide edition: stages, how to recognise each one and windows with disease, pest or weather targets. No product, product class, brand, rate, PHI or REI (ruling OC-2); the runtime copy guard also refuses spray, safe and recommended wording. Windows at pink, bloom or petal fall must be pollinator sensitive. Every hostCropPluginIds entry must name a registered crop plugin in hostCropFamilies, the edition must be the current or previous year, and every sourceKey needs a quoted source in apps/web/scripts/orchard-calendar-sources.json (a gddEstimate needs two agreeing sources). Loaded from plugins/orchard-calendars/. Mirrors packages/plugin-validation/src/schemas.ts (orchardCalendarPluginSchema).'
  }
];

for (const { file, schema, title, description } of TARGETS) {
  // io: 'input' documents what a plugin author writes (defaulted fields are
  // optional). The override closes non-catchall objects the way Zod's default
  // strip behaviour treats unknown keys, matching the prior generator output.
  const { $schema: _generatedDialect, ...json } = z.toJSONSchema(schema, {
    target: 'draft-2020-12',
    io: 'input',
    reused: 'inline',
    unrepresentable: 'any',
    override: (ctx) => {
      const def = ctx.zodSchema._zod.def;
      if (def.type === 'object' && def.catchall === undefined) {
        ctx.jsonSchema.additionalProperties = false;
      }
    }
  });
  // Override the auto-generated header with our stable metadata so the
  // file is reproducible across runs (no name/version drift).
  const enriched = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: `https://cropcard.dev/schemas/${file}`,
    title,
    description,
    ...json
  };
  const outPath = resolve(OUT_DIR, file);
  writeFileSync(outPath, JSON.stringify(enriched, null, 2) + '\n');
  console.log(`  wrote ${file}`);
}

console.log(`\nRegenerated ${TARGETS.length} schemas in ${OUT_DIR}`);
