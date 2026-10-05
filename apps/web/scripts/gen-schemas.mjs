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
import { PUBLISHED_SCHEMA_TARGETS, renderSchemas } from '../src/lib/plugins/publishedSchemas.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../../..');
const OUT_DIR = resolve(REPO_ROOT, 'schemas');

mkdirSync(OUT_DIR, { recursive: true });
for (const { file, text } of renderSchemas()) {
  writeFileSync(resolve(OUT_DIR, file), text);
  console.log(`  wrote ${file}`);
}
console.log(`\nRegenerated ${PUBLISHED_SCHEMA_TARGETS.length} schemas in ${OUT_DIR}`);
