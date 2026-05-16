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
import { zodToJsonSchema } from 'zod-to-json-schema';

import {
  cropPluginSchema,
  herbicidePluginSchema,
  insecticidePluginSchema,
  fungicidePluginSchema,
  fertilizerPluginSchema,
  companionPluginSchema
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
      'Data-only companion-planting definition (goodWith / badWith / member-system). Mirrors apps/web/src/lib/plugins/schemas.ts (companionPluginSchema).'
  }
];

for (const { file, schema, title, description } of TARGETS) {
  const json = zodToJsonSchema(schema, {
    name: undefined,
    $refStrategy: 'none',
    target: 'jsonSchema2019-09',
    definitionPath: 'definitions'
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
