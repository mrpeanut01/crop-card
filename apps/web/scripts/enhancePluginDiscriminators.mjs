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
const INSECT_DIR = resolve(REPO_ROOT, 'plugins/insecticides');

const apply = process.argv.includes('--apply');
const quiet = process.argv.includes('--quiet');

function loadCrops() {
  const files = readdirSync(CROPS_DIR).filter((f) => f.endsWith('.json'));
  return files.map((file) => {
    const path = resolve(CROPS_DIR, file);
    return { file, path, plugin: JSON.parse(readFileSync(path, 'utf8')) };
  });
}

function loadInsecticides() {
  const files = readdirSync(INSECT_DIR).filter((f) => f.endsWith('.json'));
  return files.map((file) => {
    const path = resolve(INSECT_DIR, file);
    return { file, path, plugin: JSON.parse(readFileSync(path, 'utf8')) };
  });
}

/**
 * Decide harvestStyle from family + supporting fields. Returns null when
 * the mapping isn't unambiguous (AI gap-fill handles those).
 */
function deriveHarvestStyle(plugin) {
  // Phase 25c.0 #87 — the loader/Zod schema aliases `culinary-herb` →
  // `herb-culinary` at registration time. The on-disk JSON may carry
  // either spelling, so we normalize in the script too.
  const FAMILY_ALIASES = { 'culinary-herb': 'herb-culinary', 'cane-fruit': 'bramble' };
  const fam = FAMILY_ALIASES[plugin.cropFamily] ?? plugin.cropFamily;
  const name = (plugin.displayName ?? plugin.pluginId ?? '').toLowerCase();
  const hasCuring = plugin.postHarvestCuring != null;
  const dtmMin = plugin.daysToMaturity?.min;

  switch (fam) {
    case 'cereal-grain':
      return 'single-cut-grain';
    case 'corn':
      return 'row-grain-pollinated';
    case 'forage':
      // Phase 25c.0 #87 — primary path: hayOperations declared explicitly.
      if (plugin.hayOperations) return 'forage-cutting-cycle';
      // Name-pattern fallback for forage plugins that don't carry
      // hayOperations metadata yet (most pre-#87 plugins). Perennials
      // → multi-cut; annual summer-grazing crops → cover-crop kill.
      if (/clover|timothy|orchard[ -]grass|orchardgrass/.test(name)) {
        return 'forage-cutting-cycle';
      }
      if (/sudangrass|sorghum[ -]sudan|sudan[ -]grass|bmr/.test(name)) {
        return 'cover-crop-termination';
      }
      return null;
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
      // Winter cucurbits stored for months: pumpkin (all variants),
      // acorn squash, butternut, kabocha, hubbard, spaghetti squash,
      // delicata, sweet dumpling, sugar pie. Luffa gourd ripens hard
      // for sponge use and stores like winter squash. Generic "squash"
      // catches the named-variety-only display strings ("Squash Butterkin",
      // "Squash Queensland Blue") — by this point in the switch we've
      // already filtered out summer squash via the regex above.
      if (
        /\b(pumpkin|acorn|butternut|kabocha|hubbard|delicata|spaghetti|sugar pie|sweet dumpling|luffa|squash)\b/.test(
          name
        )
      ) {
        return 'cure-then-store';
      }
      // Cantaloupe / muskmelon / honeydew / charentais / galia / watermelon
      // — picked over 2-3 weeks at full slip. Each fruit is one harvest
      // but the plant produces continuously through the window.
      if (/cantaloupe|muskmelon|honeydew|charentais|galia|\bmelon\b|watermelon/.test(name)) {
        return 'continuous-fruit';
      }
      if (dtmMin != null && dtmMin < 70) return 'continuous-fruit';
      return null;
    case 'solanaceae':
      // Phase 25c.0 #87 solanaceae batch: tubers (potato) are single-event
      // dig-at-maturity; tomato/pepper/eggplant + tomatillo + ground-cherry
      // all bear over weeks → continuous-fruit. ground[ -]cherry covers
      // both display-name ("Ground Cherry") and pluginId ("ground-cherry").
      if (/\bpotato\b/.test(name)) return 'single-event';
      if (/tomato|pepper|eggplant|tomatillo|ground[ -]cherry/.test(name)) {
        return 'continuous-fruit';
      }
      return null;
    case 'leafy-green':
      return 'cut-and-come-again';
    case 'allium':
    case 'root':
      return 'single-event';
    case 'legume':
      // Phase 25c.0 #87 legume batch extension.
      // Single dig at full senescence (peanut).
      if (/\bpeanut\b/.test(name)) return 'single-event';
      // Dry-seed legumes (mature pods, single threshing): cowpea, cherokee,
      // dry/storage beans, lentil, soybean/edamame (harvested at R6 fresh
      // is technically continuous but commodity edamame is single-event
      // since plants come out together), field pea, southern pea.
      if (
        /cowpea|cherokee|black bean|kidney|navy|pinto|dry bean|soybean|edamame|lima|lentil|field pea|southern pea/.test(
          name
        )
      ) {
        return 'dry-seed-legume';
      }
      // Snap / pole / bush / yardlong / snow / sugar — picked over weeks.
      if (
        /snap|green bean|pole|wax bean|string bean|bush bean|yardlong|snow pea|sugar pea/.test(name)
      ) {
        return 'continuous-fruit';
      }
      // Pea-shoots = microgreens → cut-and-come-again.
      if (/microgreens?[ -]pea|pea[ -]shoots?|pea[ -]shoot[ -]microgreens?/.test(name)) {
        return 'cut-and-come-again';
      }
      // Ornamental sweet pea — defer (not edible, harvest model doesn't apply).
      return null;
    case 'apiaceae':
      // Phase 25c.0 #87 apiaceae batch. Two flavors:
      // 1. Root + stem vegetables (single dig at maturity): carrot, parsnip,
      //    celery (cut at base), celeriac (dig).
      if (/parsnip|celery|celeriac|carrot/.test(name)) return 'single-event';
      // 2. Cut-and-come-again herbs: parsley, cilantro, dill, fennel-leaf,
      //    chervil, lovage. Note fennel-bulb is single-event.
      if (/fennel-bulb/.test(name)) return 'single-event';
      if (/parsley|cilantro|dill|fennel|chervil|lovage/.test(name)) return 'cut-and-come-again';
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
      // `collards?` matches both "collard" + "collards"; `mustard[ -]greens`
      // matches both display-name format ("Mustard Greens") and pluginId
      // ("mustard-greens").
      if (
        /\b(kale|collards?|mustard[ -]greens|mizuna|tatsoi|komatsuna|watercress|arugula|microgreens)\b/.test(
          name
        )
      ) {
        return 'cut-and-come-again';
      }
      return null;
    case 'broadleaf-companion':
      // Phase 25c.0 #87 broadleaf-companion batch. This family is the
      // catch-all for non-vegetable companions + cut flowers + grains
      // + medicinals. Name-pattern split:
      // - Cover crops first (so phacelia-cover doesn't match anything else)
      if (/\bcover\b|phacelia/.test(name)) return 'cover-crop-termination';
      // - Microgreens → cut-and-come-again
      if (/microgreens?/.test(name)) return 'cut-and-come-again';
      // - Cut flowers (picked over weeks, cut-and-come-again pattern)
      if (
        /calendula|chamomile|cosmos|dahlia|echinacea|lisianthus|ranunculus|snapdragon|statice|strawflower|zinnia|nasturtium/.test(
          name
        )
      ) {
        return 'cut-and-come-again';
      }
      // - Rhubarb stalks are cut repeatedly through the season
      if (/rhubarb/.test(name)) return 'cut-and-come-again';
      // - Continuous-fruit: okra bears for weeks; pick before pods harden
      if (/okra/.test(name)) return 'continuous-fruit';
      // - Single-cut grains + seed crops + dye plants + medicinals harvested
      //   once at maturity
      if (
        /sunflower|amaranth|quinoa|flax|madder|marshmallow|milk[ -]thistle|valerian|eucalyptus/.test(
          name
        )
      ) {
        return 'single-event';
      }
      return null;
    default:
      return null;
  }
}

/**
 * Decide bloomWindow from family + name pattern. Conservative defaults —
 * pollinator gate only blocks bee-toxic sprays when `beeAttractive: true`,
 * so wind-pollinated + self-pollinated + pre-bolt-harvested crops carry
 * `beeAttractive: false` and the gate skips them regardless of timing.
 *
 * Schema refine: at least one of {continuous, daysFromPlantingMin,
 * monthsOfYear} must be set when bloomWindow is present.
 */
function deriveBloomWindow(plugin) {
  const FAMILY_ALIASES = { 'culinary-herb': 'herb-culinary', 'cane-fruit': 'bramble' };
  const fam = FAMILY_ALIASES[plugin.cropFamily] ?? plugin.cropFamily;
  const name = (plugin.displayName ?? plugin.pluginId ?? '').toLowerCase();
  switch (fam) {
    case 'orchard':
      return { monthsOfYear: [4, 5], beeAttractive: true };
    case 'stone-fruit':
      return { monthsOfYear: [3, 4], beeAttractive: true };
    case 'cucurbit':
      return { continuous: true, beeAttractive: true };
    case 'cover-legume':
      return { continuous: true, beeAttractive: true };
    case 'small-fruit':
      // Strawberry / blueberry / currant / gooseberry — early-spring bee crops.
      return { monthsOfYear: [4, 5], beeAttractive: true };
    case 'bramble':
      // Blackberry / raspberry — spring bloom, primary nectar source for bees.
      return { monthsOfYear: [5, 6], beeAttractive: true };
    case 'vine-fruit':
      // Grape, hops — wind/self pollinated, low bee value.
      return { monthsOfYear: [5, 6], beeAttractive: false };
    case 'corn':
      // Wind-pollinated; tassels shed pollen ~55-75 DAP. Bees visit pollen
      // but corn does not need them and is not bee-toxic-attractive.
      return { daysFromPlantingMin: 55, daysFromPlantingMax: 75, beeAttractive: false };
    case 'cereal-grain':
      // Wind-pollinated (wheat, oats, barley, rye, broomcorn).
      return { monthsOfYear: [5, 6], beeAttractive: false };
    case 'cover-grass':
      // Buckwheat is the bee exception — heavily worked when in bloom.
      if (/buckwheat/.test(name)) {
        return { daysFromPlantingMin: 30, daysFromPlantingMax: 75, beeAttractive: true };
      }
      // Rye / oat / annual ryegrass / triticale covers — wind-pollinated.
      return { monthsOfYear: [5, 6], beeAttractive: false };
    case 'forage':
      // Alfalfa, clover, perennial forage — highly bee-attractive when allowed
      // to flower between cuttings.
      if (/clover|alfalfa|timothy|orchard[ -]grass|orchardgrass/.test(name)) {
        return { continuous: true, beeAttractive: true };
      }
      // Sorghum-sudan + BMR — wind-pollinated summer forage.
      return { monthsOfYear: [7, 8], beeAttractive: false };
    case 'solanaceae':
      // Potato — insect/wind, low bee value; flowers ~50-70 DAP.
      if (/\bpotato\b/.test(name)) {
        return { daysFromPlantingMin: 50, daysFromPlantingMax: 70, beeAttractive: false };
      }
      // Tomato / pepper / eggplant / tomatillo / ground-cherry — self-pollinated.
      if (/tomato|pepper|eggplant|tomatillo|ground[ -]cherry/.test(name)) {
        return { continuous: true, beeAttractive: false };
      }
      return null;
    case 'legume':
      // Peanut — self-pollinated geocarpic flowers.
      if (/\bpeanut\b/.test(name)) {
        return { daysFromPlantingMin: 40, daysFromPlantingMax: 90, beeAttractive: false };
      }
      // Soybean — primarily self-pollinated; some bee visits but flowers
      // don't drive yield. Flag false to avoid over-blocking soy sprays.
      if (/soybean|edamame/.test(name)) {
        return { daysFromPlantingMin: 40, daysFromPlantingMax: 70, beeAttractive: false };
      }
      // Snap / dry beans / cowpea / lentil / field pea / sweet pea —
      // bees do work the flowers; conservative true to drive gate behavior.
      return { daysFromPlantingMin: 35, daysFromPlantingMax: 70, beeAttractive: true };
    case 'leafy-green':
      // Harvested pre-bolt; flowers if allowed ~60 DAP but not the use case.
      return { daysFromPlantingMin: 60, daysFromPlantingMax: 90, beeAttractive: false };
    case 'herb-culinary':
      // Many culinary herbs (basil, thyme, oregano, sage) are highly bee-
      // attractive when allowed to flower. Mid-season bloom.
      return { daysFromPlantingMin: 60, daysFromPlantingMax: 110, beeAttractive: true };
    case 'apiaceae':
      // Root forms (carrot, parsnip, celery) are biennials harvested year 1,
      // never flower in production. Mark non-attractive.
      if (/carrot|parsnip|celery|celeriac/.test(name)) {
        return { monthsOfYear: [6, 7], beeAttractive: false };
      }
      // Umbel herbs (cilantro, dill, parsley, fennel, chervil, lovage) —
      // bee-favorite umbels; allowed to flower for seed + beneficials.
      return { daysFromPlantingMin: 50, daysFromPlantingMax: 90, beeAttractive: true };
    case 'brassica':
      // Cover-crop brassicas allowed to flower carry honeybee + native
      // bee value before kill — tillage radish blooms cream-yellow ~70-90 DAP.
      if (/\b(tillage|cover)\b/.test(name)) {
        return { daysFromPlantingMin: 70, daysFromPlantingMax: 100, beeAttractive: true };
      }
      // Head + leafy brassicas harvested pre-bolt — declare a documenting
      // window but mark non-attractive so the gate skips them.
      return { daysFromPlantingMin: 60, daysFromPlantingMax: 90, beeAttractive: false };
    case 'allium':
      // Most production alliums harvested before flowering (year-1 of biennial).
      // Chives + perennial bunching onions allowed to flower are bee-attractive,
      // but those are the minority — conservative false here, AI-pass override.
      return { monthsOfYear: [6, 7], beeAttractive: false };
    case 'root':
      // Carrot / beet / radish / turnip — harvested year 1 before bolt.
      return { monthsOfYear: [6, 7], beeAttractive: false };
    case 'broadleaf-companion':
      // Cover crops in this family (phacelia in particular) are heavily
      // bee-attractive. Phacelia is the original "bee plant".
      if (/phacelia/.test(name)) {
        return { daysFromPlantingMin: 45, daysFromPlantingMax: 90, beeAttractive: true };
      }
      // Cut-flower / pollinator-attractor companions — declared attractive.
      if (
        /calendula|chamomile|cosmos|dahlia|echinacea|lisianthus|ranunculus|snapdragon|statice|strawflower|zinnia|nasturtium|sunflower/.test(
          name
        )
      ) {
        return { daysFromPlantingMin: 45, daysFromPlantingMax: 120, beeAttractive: true };
      }
      // Buckwheat-style seed crops + medicinals when in bloom.
      if (/amaranth|quinoa|flax|buckwheat|valerian|madder|marshmallow/.test(name)) {
        return { daysFromPlantingMin: 50, daysFromPlantingMax: 100, beeAttractive: true };
      }
      // Okra flowers are bee-magnets (hibiscus relative).
      if (/okra/.test(name)) {
        return { daysFromPlantingMin: 50, daysFromPlantingMax: 110, beeAttractive: true };
      }
      // Rhubarb — perennial; spring flower stalks usually pulled, low gate value.
      if (/rhubarb/.test(name)) {
        return { monthsOfYear: [5, 6], beeAttractive: false };
      }
      // Microgreens — harvested at cotyledon, never flower in field.
      if (/microgreens?/.test(name)) {
        return { daysFromPlantingMin: 60, daysFromPlantingMax: 90, beeAttractive: false };
      }
      // Eucalyptus + milk-thistle + other woody/coarse — moderate bee value.
      if (/eucalyptus|milk[ -]thistle/.test(name)) {
        return { monthsOfYear: [6, 7, 8], beeAttractive: true };
      }
      return null;
    default:
      return null;
  }
}

/**
 * Per-pest default scouting thresholds — sourced from US Northeast / Mid-
 * Atlantic Extension IPM guides (Penn State, UMD, UVM, Cornell). Conservative
 * action thresholds; the kernel uses these to gate sprays when scout data
 * shows pest counts below the threshold.
 *
 * Backfilled into insecticide plugin `scoutingThresholds[]` when the plugin's
 * `targetPests` array contains the matching pest name. Plugins for products
 * without a recognized pest in `targetPests` are skipped (AI gap-fill follow).
 *
 * Pest matching is case-insensitive substring match against the keys here.
 */
const PEST_THRESHOLD_DEFAULTS = {
  aphid: { metric: 'count-per-leaf', threshold: 50, warnAt: 30 },
  whitefly: { metric: 'count-per-leaf', threshold: 5, warnAt: 3 },
  thrips: { metric: 'count-per-leaf', threshold: 4, warnAt: 2 },
  'spider mite': { metric: 'count-per-leaf', threshold: 10, warnAt: 5 },
  mite: { metric: 'count-per-leaf', threshold: 10, warnAt: 5 },
  leafhopper: { metric: 'count-per-leaf', threshold: 1 },
  leafminer: { metric: 'count-per-leaf', threshold: 5, warnAt: 3 },
  'pear psylla': { metric: 'count-per-leaf', threshold: 3 },
  'colorado potato beetle': { metric: 'count-per-plant', threshold: 2, warnAt: 1 },
  'mexican bean beetle': { metric: 'count-per-plant', threshold: 1.5 },
  'flea beetle': { metric: 'pct-defoliation', threshold: 20, warnAt: 10 },
  'cucumber beetle': { metric: 'count-per-plant', threshold: 1 },
  'japanese beetle': { metric: 'count-per-plant', threshold: 5 },
  'asparagus beetle': { metric: 'pct-infested-plants', threshold: 10 },
  'squash bug': { metric: 'eggs-per-plant', threshold: 1 },
  'tarnished plant bug': { metric: 'count-per-plant', threshold: 2 },
  'stink bug': { metric: 'count-per-plant', threshold: 1 },
  'harlequin bug': { metric: 'count-per-plant', threshold: 2 },
  'corn earworm': { metric: 'count-per-trap-per-week', threshold: 10 },
  'european corn borer': { metric: 'count-per-trap-per-week', threshold: 7 },
  'tomato fruitworm': { metric: 'count-per-trap-per-week', threshold: 10 },
  'tomato hornworm': { metric: 'count-per-plant', threshold: 1 },
  'cabbage looper': { metric: 'count-per-plant', threshold: 0.5 },
  'imported cabbageworm': { metric: 'count-per-plant', threshold: 0.5 },
  'diamondback moth': { metric: 'count-per-plant', threshold: 0.3 },
  'spotted wing drosophila': { metric: 'count-per-trap-per-week', threshold: 3 },
  swd: { metric: 'count-per-trap-per-week', threshold: 3 },
  'codling moth': { metric: 'count-per-trap-per-week', threshold: 5 },
  'apple maggot': { metric: 'count-per-trap-per-week', threshold: 5 },
  'plum curculio': { metric: 'pct-infested-plants', threshold: 2 },
  'spotted lanternfly': { metric: 'count-per-plant', threshold: 10 },
  'squash vine borer': { metric: 'count-per-trap-per-week', threshold: 1 },
  'cabbage maggot': { metric: 'pct-infested-plants', threshold: 5 },
  'onion maggot': { metric: 'pct-infested-plants', threshold: 5 },
  'seedcorn maggot': { metric: 'pct-infested-plants', threshold: 5 },
  // Generic lepidopteran categories — used by Bt-family + IGR products that
  // target multiple species. Conservative shared threshold per plant.
  armyworm: { metric: 'count-per-plant', threshold: 1 },
  leafroller: { metric: 'count-per-plant', threshold: 2 },
  looper: { metric: 'count-per-plant', threshold: 0.5 },
  'lepidopteran larvae': { metric: 'count-per-plant', threshold: 1 }
};

/**
 * Build scoutingThresholds[] for an insecticide plugin by matching each
 * `targetPests[]` entry against the defaults table. Returns null when no
 * pest matches (plugin skipped — AI gap-fill handles those).
 */
function deriveScoutingThresholds(plugin) {
  if (!Array.isArray(plugin.targetPests) || plugin.targetPests.length === 0) return null;
  const matches = [];
  const seen = new Set();
  for (const rawPest of plugin.targetPests) {
    const pestKey = String(rawPest).toLowerCase().trim();
    if (seen.has(pestKey)) continue;
    seen.add(pestKey);
    let hit = PEST_THRESHOLD_DEFAULTS[pestKey];
    if (!hit) {
      // Substring match — e.g., "green peach aphid" matches "aphid", "two-
      // spotted spider mite" matches "spider mite".
      for (const [key, val] of Object.entries(PEST_THRESHOLD_DEFAULTS)) {
        if (pestKey.includes(key)) {
          hit = val;
          break;
        }
      }
    }
    if (hit) matches.push({ pest: rawPest, ...hit });
  }
  return matches.length > 0 ? matches : null;
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
const summary = { harvestStyle: 0, bloomWindow: 0, scoutingThresholds: 0 };

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

for (const { file, path, plugin } of loadInsecticides()) {
  const changes = {};

  if (plugin.scoutingThresholds == null) {
    const derived = deriveScoutingThresholds(plugin);
    if (derived) changes.scoutingThresholds = derived;
  }

  if (Object.keys(changes).length === 0) continue;

  touched += 1;
  if ('scoutingThresholds' in changes) summary.scoutingThresholds += 1;
  changedFiles.push({ file: `insecticides/${file}`, changes });

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
console.log(
  `${apply ? 'Applied' : 'Would apply'} changes to ${touched} plugin${touched === 1 ? '' : 's'}:`
);
console.log(`  harvestStyle:        ${summary.harvestStyle} plugins`);
console.log(`  bloomWindow:         ${summary.bloomWindow} plugins`);
console.log(`  scoutingThresholds:  ${summary.scoutingThresholds} plugins`);
console.log('');
if (!apply) {
  console.log('Dry run only. Pass --apply to write changes.');
}
