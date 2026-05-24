#!/usr/bin/env node
/**
 * Phase 25c.0 (#87) — deterministic plugin discriminator backfill.
 *
 * Reads every JSON file under /plugins/crops/ and adds Phase 25c.0
 * discriminator fields where the mapping is **unambiguous** from existing
 * fields (cropFamily, daysToMaturity, postHarvestCuring presence, etc.).
 *
 * Coverage target for this pass: 60-70% of crop plugins (per #87 plan).
 * The remaining 30-40% are handled by AI-assisted family-batched gap-fill
 * PRs that follow this pass.
 *
 * Safe by construction:
 *   - NEVER overwrites an existing value (only fills when field absent).
 *   - Default mode is dry-run; pass `--apply` to actually write files.
 *   - Conservative bloomWindow defaults — only set for high-confidence
 *     families (orchard, stone-fruit, cucurbit, cover-legume). AI pass
 *     handles solanaceae (self-pollinated nuance) + leafy/brassica.
 *
 * Usage:
 *   pnpm enhance:plugins           # dry-run, prints proposed changes
 *   pnpm enhance:plugins --apply   # writes files
 *   pnpm enhance:plugins --apply --quiet  # writes without per-file output
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../../..');
const CROPS_DIR = resolve(REPO_ROOT, 'plugins/crops');

const apply = process.argv.includes('--apply');
const quiet = process.argv.includes('--quiet');

function loadCrops() {
  const files = readdirSync(CROPS_DIR).filter((f) => f.endsWith('.json'));
  return files.map((file) => {
    const path = resolve(CROPS_DIR, file);
    return { file, path, plugin: JSON.parse(readFileSync(path, 'utf8')) };
  });
}

/**
 * Decide harvestStyle from family + supporting fields. Returns null when
 * the mapping isn't unambiguous (AI gap-fill handles those).
 */
function deriveHarvestStyle(plugin) {
  const fam = plugin.cropFamily;
  const name = (plugin.displayName ?? plugin.pluginId ?? '').toLowerCase();
  const hasCuring = plugin.postHarvestCuring != null;
  const dtmMin = plugin.daysToMaturity?.min;

  switch (fam) {
    case 'cereal-grain':
      return 'single-cut-grain';
    case 'corn':
      return 'row-grain-pollinated';
    case 'forage':
      return plugin.hayOperations ? 'forage-cutting-cycle' : null;
    case 'cover-grass':
    case 'cover-legume':
      return 'cover-crop-termination';
    case 'orchard':
      return 'tree-fruit-multi-pick';
    case 'stone-fruit':
      return 'tree-fruit-multi-pick';
    case 'vine-fruit':
    case 'small-fruit':
    case 'bramble':
      // Defensive — guard against the cucurbit/vine-fruit mis-classification
      // pattern (e.g., watermelon historically tagged vine-fruit). If the
      // displayName matches an annual cucurbit, skip auto-tagging and let
      // a human pass fix the family. The melon test catches "melon",
      // "watermelon", "cantaloupe", "honeydew", "muskmelon".
      if (/\b(melon|cantaloupe|honeydew|muskmelon)\b/.test(name)) return null;
      return 'perennial-vine';
    case 'cucurbit':
      if (hasCuring) return 'cure-then-store';
      // Summer squash / cucumber / zucchini bloom + bear continuously.
      if (/zucchini|summer squash|yellow squash|pattypan|cucumber/.test(name)) {
        return 'continuous-fruit';
      }
      if (dtmMin != null && dtmMin < 70) return 'continuous-fruit';
      return null;
    case 'solanaceae':
      if (/tomato|pepper|eggplant/.test(name)) return 'continuous-fruit';
      return null;
    case 'leafy-green':
      return 'cut-and-come-again';
    case 'allium':
    case 'root':
      return 'single-event';
    case 'legume':
      if (/cowpea|cherokee|black bean|kidney|navy|pinto|dry bean|soybean|lima/.test(name)) {
        return 'dry-seed-legume';
      }
      if (/snap|green bean|pole bean|wax bean|string bean/.test(name)) {
        return 'continuous-fruit';
      }
      return null;
    case 'herb-culinary':
      return 'cut-and-come-again';
    case 'brassica':
      // Phase 25c.0 #87 brassicas batch: name-pattern split. Order
      // matters — cover-crop check first so `tillage-radish-driller`
      // doesn't get mis-tagged by the `radish` rule below.
      if (/\b(tillage|cover)\b/.test(name)) return 'cover-crop-termination';
      // Heads / roots (single dig at maturity): cabbage, broccoli,
      // cauliflower, brussels-sprouts, kohlrabi, napa-cabbage, turnip,
      // radish, woad.
      if (
        /\b(cabbage|broccoli|cauliflower|brussels|kohlrabi|napa|turnip|radish|woad)\b/.test(name)
      ) {
        return 'single-event';
      }
      // Cut-and-come-again leafy brassicas: kale, collards, mustard-greens,
      // mizuna, tatsoi, sea-kale, komatsuna, watercress, arugula, microgreens.
      if (
        /\b(kale|collard|mustard-greens|mizuna|tatsoi|komatsuna|watercress|arugula|microgreens)\b/.test(
          name
        )
      ) {
        return 'cut-and-come-again';
      }
      return null;
    case 'apiaceae':
    case 'broadleaf-companion':
      // Ambiguous within family — defer to AI gap-fill.
      return null;
    default:
      return null;
  }
}

/**
 * Decide bloomWindow from family. Conservative — only the four families
 * where the bloom timing + bee-attractiveness are unambiguous family-wide.
 */
function deriveBloomWindow(plugin) {
  const name = (plugin.displayName ?? plugin.pluginId ?? '').toLowerCase();
  switch (plugin.cropFamily) {
    case 'orchard':
      return { monthsOfYear: [4, 5], beeAttractive: true };
    case 'stone-fruit':
      return { monthsOfYear: [3, 4], beeAttractive: true };
    case 'cucurbit':
      return { continuous: true, beeAttractive: true };
    case 'cover-legume':
      return { continuous: true, beeAttractive: true };
    case 'brassica':
      // Cover-crop brassicas allowed to flower carry honeybee + native
      // bee value before kill — flag them as bee-attractive with a wide
      // mid-season window. Tillage radish in particular blooms cream-
      // yellow ~70-90 DAP if not terminated.
      if (/\b(tillage|cover)\b/.test(name)) {
        return { daysFromPlantingMin: 70, daysFromPlantingMax: 100, beeAttractive: true };
      }
      // Head + leafy brassicas typically harvested before bolt — no
      // bloom window declared, AI gap-fill can revisit for biennials.
      return null;
    default:
      return null;
  }
}

/**
 * Derive growthStageTable.system from family when the mapping is
 * unambiguous. The full stages[] + harvestTargets[] table can't be
 * derived deterministically (those are per-variety knowledge); the AI
 * gap-fill pass populates them. This pass only sets the system enum so
 * the family-default template at `growthStageTemplates.ts` resolves.
 */
function deriveGrowthStageSystem(plugin) {
  // growthStageTable already validates as a structured object; we can't
  // partially set it without breaking the schema. Leave system backfill
  // to the AI pass, which populates the full object.
  return null;
}

let touched = 0;
const changedFiles = [];
const summary = { harvestStyle: 0, bloomWindow: 0 };

for (const { file, path, plugin } of loadCrops()) {
  const changes = {};

  if (plugin.harvestStyle == null) {
    const derived = deriveHarvestStyle(plugin);
    if (derived) changes.harvestStyle = derived;
  }

  if (plugin.bloomWindow == null) {
    const derived = deriveBloomWindow(plugin);
    if (derived) changes.bloomWindow = derived;
  }

  if (Object.keys(changes).length === 0) continue;

  touched += 1;
  if ('harvestStyle' in changes) summary.harvestStyle += 1;
  if ('bloomWindow' in changes) summary.bloomWindow += 1;
  changedFiles.push({ file, changes });

  if (apply) {
    const enriched = { ...plugin, ...changes };
    writeFileSync(path, JSON.stringify(enriched, null, 2) + '\n');
  }
}

if (!quiet) {
  for (const { file, changes } of changedFiles) {
    const parts = Object.entries(changes).map(([k, v]) =>
      typeof v === 'object' ? `${k}=${JSON.stringify(v)}` : `${k}=${v}`
    );
    console.log(`  ${file}: ${parts.join(', ')}`);
  }
}

console.log('');
console.log(`${apply ? 'Applied' : 'Would apply'} changes to ${touched} crop plugin${touched === 1 ? '' : 's'}:`);
console.log(`  harvestStyle:  ${summary.harvestStyle} plugins`);
console.log(`  bloomWindow:   ${summary.bloomWindow} plugins`);
console.log('');
if (!apply) {
  console.log('Dry run only. Pass --apply to write changes.');
}
