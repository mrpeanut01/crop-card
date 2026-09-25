#!/usr/bin/env node
/**
 * #255 — one-time backfill of `formulation` + `defaultUnit` on input plugins.
 *
 * Evidence rules (never invents chemistry):
 *   formulation — only when exactly one CropLife/EPA formulation code is
 *     printed in the product displayName ("Assail 30SG", "Tilt 3.6 EC",
 *     "Quadris Flowable"), and its physical state does not contradict the
 *     label rate unit. Aliases: E → EC ("Eptam 7E"), W → WP ("90W").
 *   defaultUnit — `deriveDefaultUnit()` from the plugin's own formulation /
 *     fertilizer form / rate unit. Skipped when that evidence is missing or
 *     contradictory; those gaps go on scripts/plugin-metadata-allowlist.json.
 *
 * Edits JSON textually (inserted after the top-level "version" line) so
 * existing formatting is preserved. Idempotent.
 *
 * Usage: pnpm exec tsx scripts/backfill-plugin-metadata.mjs [--dry-run]
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FORMULATION_PHYSICAL_STATE } from '../src/lib/plugins/schemas.ts';
import { deriveDefaultUnit, rateStateOf } from '../src/lib/plugins/inputMetadata.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGINS_DIR = resolve(__dirname, '../../../plugins');
const DIRS = ['herbicides', 'insecticides', 'fungicides', 'fertilizers'];
const DRY_RUN = process.argv.includes('--dry-run');

const ALIASES = { E: 'EC', W: 'WP', Flowable: 'F' };
const CODE_RE =
  /(?:^|[\s(])(?:\d+(?:\.\d+)?%?\s?)?(EC|E|SL|SC|F|L|ME|ES|EW|CS|OD|SE|WDG|WG|DF|SG|WSP|WS|WP|W|SP|Flowable)(?=$|[\s),])/g;

/** Explicit physical-state evidence printed in the plugin itself. */
const STATED_DRY = new Set(['stadia-dry']);
/** Plugins whose own data contradicts itself; left for label review. */
const SKIP_UNIT = new Set(['dithane-rainshield', 'nematode-steinernema-feltiae']);

export function formulationFromName(displayName) {
  const codes = new Set();
  for (const m of displayName.matchAll(CODE_RE)) codes.add(ALIASES[m[1]] ?? m[1]);
  return codes.size === 1 ? [...codes][0] : null;
}

function insertAfterVersion(text, fields) {
  const lines = Object.entries(fields).map(
    ([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`
  );
  const re = /^( {2}"version": .*,)$/m;
  if (!re.test(text)) throw new Error('no top-level "version" line');
  return text.replace(re, `$1\n${lines.join('\n')}`);
}

const stats = { formulation: 0, defaultUnit: 0, skipped: [] };
for (const dir of DIRS) {
  for (const file of readdirSync(resolve(PLUGINS_DIR, dir)).filter((f) => f.endsWith('.json'))) {
    const path = resolve(PLUGINS_DIR, dir, file);
    const text = readFileSync(path, 'utf8');
    const plugin = JSON.parse(text);
    const add = {};

    if (plugin.type !== 'fertilizer' && !plugin.formulation) {
      const code = formulationFromName(plugin.displayName);
      if (code) {
        const rState = rateStateOf(plugin);
        if (rState && rState !== FORMULATION_PHYSICAL_STATE[code]) {
          stats.skipped.push(`${plugin.pluginId}: formulation ${code} contradicts rate unit`);
        } else {
          add.formulation = code;
        }
      }
    }

    if (!plugin.defaultUnit && !SKIP_UNIT.has(plugin.pluginId)) {
      const probe = { ...plugin, ...add };
      let unit = deriveDefaultUnit(probe);
      if (!unit && STATED_DRY.has(plugin.pluginId) && plugin.ratePerAcre?.unit === 'oz')
        unit = 'oz';
      if (unit) add.defaultUnit = unit;
    }

    if (Object.keys(add).length === 0) continue;
    const ordered = {};
    if (add.defaultUnit) ordered.defaultUnit = add.defaultUnit;
    if (add.formulation) ordered.formulation = add.formulation;
    if (ordered.defaultUnit) stats.defaultUnit++;
    if (ordered.formulation) stats.formulation++;
    if (!DRY_RUN) writeFileSync(path, insertAfterVersion(text, ordered), 'utf8');
    else console.log(plugin.pluginId, ordered);
  }
}

console.log(`backfilled formulation on ${stats.formulation}, defaultUnit on ${stats.defaultUnit}`);
for (const s of stats.skipped) console.log(`skipped — ${s}`);
