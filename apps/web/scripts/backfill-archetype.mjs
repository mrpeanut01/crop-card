#!/usr/bin/env node
/**
 * Sprint 6 / Phase 27A (#257) — explicit crop archetype backfill.
 *
 * Reads every /plugins/crops/*.json and adds the explicit `archetype`
 * field (10 canonical values per CLAUDE.md Invariant 8). Mirrors the
 * Phase 25c.0 `enhancePluginDiscriminators.mjs` pattern: dry-run by
 * default, idempotent, writes a CSV audit log under
 * /tmp/cropcard-archetype-backfill.csv so the user can review every
 * derivation decision before committing.
 *
 * Derivation order (matches packages/plugin-validation/src/schemas.ts
 * `resolveArchetype()` exactly — the script and the runtime helper MUST
 * stay in lock-step):
 *
 *   1. plugin.archetype already set → skip (idempotent).
 *   2. plugin.harvestStyle present + has a 1:1 archetype map → use it.
 *   3. plugin.harvestStyle === 'single-event' OR absent → family-keyed
 *      fallback per archetypeForFamilyFallback().
 *
 * Usage:
 *   pnpm backfill:archetype           # dry-run + write audit CSV
 *   pnpm backfill:archetype --apply   # write files + audit CSV
 *   pnpm backfill:archetype --apply --quiet
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../../..');
const CROPS_DIR = resolve(REPO_ROOT, 'plugins/crops');
const AUDIT_CSV = '/tmp/cropcard-archetype-backfill.csv';

const apply = process.argv.includes('--apply');
const quiet = process.argv.includes('--quiet');

// ─── Derivation tables ─────────────────────────────────────────────────
// MUST stay in lock-step with packages/plugin-validation/src/schemas.ts.
// Keep these inline (rather than import) so the script runs without
// transpilation.

const HARVEST_STYLE_TO_ARCHETYPE = {
  'single-cut-grain': 'small-grain.zadoks',
  'row-grain-pollinated': 'row-grain.pollination',
  'dry-seed-legume': 'dry-seed-legume',
  'cure-then-store': 'winter-squash-cure',
  'continuous-fruit': 'continuous-harvest-fruit',
  'cut-and-come-again': 'cut-and-come-again-leafy',
  'cover-crop-termination': 'cover-crop.termination',
  'forage-cutting-cycle': 'forage-cutting-cycle',
  'perennial-vine': 'perennial-vine-quality',
  'tree-fruit-multi-pick': 'tree-fruit-multi-pick',
  'single-event': null
};

function archetypeForFamilyFallback(family) {
  switch (family) {
    case 'leafy-green':
    case 'herb-culinary':
    case 'culinary-herb':
      return 'cut-and-come-again-leafy';
    case 'legume':
      return 'dry-seed-legume';
    case 'solanaceae':
      return 'continuous-harvest-fruit';
    case 'cereal-grain':
      return 'small-grain.zadoks';
    case 'corn':
      return 'row-grain.pollination';
    case 'cucurbit':
    case 'brassica':
    case 'allium':
    case 'alliums':
    case 'root':
    case 'root-crop':
    case 'apiaceae':
    case 'broadleaf-companion':
      return 'winter-squash-cure';
    case 'forage':
      return 'forage-cutting-cycle';
    case 'cover-grass':
    case 'cover-crop-grass':
    case 'cover-legume':
    case 'cover-crop-legume':
      return 'cover-crop.termination';
    case 'stone-fruit':
    case 'small-fruit':
    case 'bramble':
    case 'cane-fruit':
    case 'orchard':
      return 'tree-fruit-multi-pick';
    case 'vine-fruit':
      return 'perennial-vine-quality';
    default:
      return 'winter-squash-cure';
  }
}

function deriveArchetype(plugin) {
  if (plugin.archetype) {
    return { archetype: plugin.archetype, reason: 'already-set' };
  }
  if (plugin.harvestStyle) {
    const mapped = HARVEST_STYLE_TO_ARCHETYPE[plugin.harvestStyle];
    if (mapped) {
      return { archetype: mapped, reason: `harvestStyle:${plugin.harvestStyle}` };
    }
    // harvestStyle === 'single-event' falls through to family fallback.
  }
  const family = plugin.cropFamily ?? '';
  const archetype = archetypeForFamilyFallback(family);
  return {
    archetype,
    reason: plugin.harvestStyle
      ? `single-event+family:${family}`
      : `no-harvestStyle+family:${family}`
  };
}

// ─── Run ───────────────────────────────────────────────────────────────

function loadCrops() {
  const files = readdirSync(CROPS_DIR).filter((f) => f.endsWith('.json'));
  return files.map((file) => {
    const path = resolve(CROPS_DIR, file);
    return { file, path, plugin: JSON.parse(readFileSync(path, 'utf8')) };
  });
}

function main() {
  const crops = loadCrops();
  const auditRows = [['pluginId', 'cropFamily', 'oldHarvestStyle', 'derivedArchetype', 'reason']];
  const reasonCounts = new Map();
  let skippedAlreadySet = 0;
  let wouldWrite = 0;
  let wrote = 0;

  for (const { file, path, plugin } of crops) {
    const { archetype, reason } = deriveArchetype(plugin);
    reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);

    auditRows.push([
      plugin.pluginId ?? file.replace(/\.json$/, ''),
      plugin.cropFamily ?? '',
      plugin.harvestStyle ?? '',
      archetype,
      reason
    ]);

    if (reason === 'already-set') {
      skippedAlreadySet++;
      continue;
    }

    if (!apply) {
      wouldWrite++;
      if (!quiet) {
        console.log(`[dry] ${file}: archetype = ${archetype} (${reason})`);
      }
      continue;
    }

    plugin.archetype = archetype;
    writeFileSync(path, JSON.stringify(plugin, null, 2) + '\n', 'utf8');
    wrote++;
    if (!quiet) {
      console.log(`[apply] ${file}: archetype = ${archetype} (${reason})`);
    }
  }

  // Write audit CSV regardless of --apply so reviewers can diff.
  writeFileSync(
    AUDIT_CSV,
    auditRows.map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n') +
      '\n',
    'utf8'
  );

  console.log('\n─── Sprint 6 archetype backfill summary ───');
  console.log(`Total crop plugins: ${crops.length}`);
  console.log(`Already set (skipped): ${skippedAlreadySet}`);
  console.log(apply ? `Wrote: ${wrote}` : `Would write: ${wouldWrite}`);
  console.log('\nDerivation reasons:');
  for (const [reason, count] of [...reasonCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${count.toString().padStart(4)}  ${reason}`);
  }
  console.log(`\nAudit CSV: ${AUDIT_CSV}`);
  if (!apply) {
    console.log('\nDry-run only. Pass --apply to write files.');
  }
}

main();
