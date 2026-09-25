#!/usr/bin/env node
/**
 * #130 — backfill `pollinator` (bee toxicity + label bloom restriction) on
 * insecticide plugins, keyed off each plugin's own `activeIngredients`.
 *
 * Evidence rules:
 *   - Classes are the EPA acute honey-bee contact-toxicity categories
 *     (highly toxic LD50 < 2 µg/bee; toxic 2–10.99; relatively nontoxic ≥ 11)
 *     plus the label's bloom language for that active-ingredient family.
 *   - A multi-ingredient product takes the WORST toxicity, the STRICTEST
 *     bloom restriction, and the LONGEST residual across its ingredients.
 *   - If ANY ingredient is not in the table, the plugin is left without the
 *     field (the kernel then treats it as `unknown`) and is listed in the
 *     report. Never guess a lower hazard; toxic-vs-highly-toxic ties go to
 *     highly-toxic, and long-residual chemistries get
 *     `prohibited-during-bloom` because dusk spraying does not protect
 *     next-morning foragers.
 *
 * Edits JSON textually (inserted after `pollinatorRisk`, else after the
 * top-level "version" line) so existing formatting is preserved. Re-runnable:
 * an existing single-line `"pollinator"` entry is replaced in place.
 *
 * Plugins with a label-sourced `pollinator` (listed under `pollinator` in
 * scripts/epa-reg-sources.json) are skipped.
 *
 * Usage: node scripts/backfill-pollinator.mjs [--dry-run]
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIR = resolve(__dirname, '../../../plugins/insecticides');
const DRY_RUN = process.argv.includes('--dry-run');

const HT = 'highly-toxic';
const T = 'toxic';
const RN = 'relatively-nontoxic';
const PROHIBITED = 'prohibited-during-bloom';
const DUSK = 'dusk-to-dawn-only';
const NONE = 'none';

/** Reference data: active ingredient (lower-case, matched by prefix) →
 *  [beeToxicity, bloomRestriction, residualToxicityHours?]. */
export const AI_CLASSES = [
  // Neonicotinoids — EPA bee-advisory box: no application during bloom.
  ['imidacloprid', HT, PROHIBITED],
  ['clothianidin', HT, PROHIBITED],
  ['thiamethoxam', HT, PROHIBITED],
  ['dinotefuran', HT, PROHIBITED],
  ['acetamiprid', T, DUSK],
  // Sulfoximine — label bloom prohibitions on bee-attractive crops.
  ['sulfoxaflor', HT, PROHIBITED],
  // Pyrethroids + pyrethrins — "do not apply while bees are actively visiting".
  ['bifenthrin', HT, DUSK],
  ['lambda-cyhalothrin', HT, DUSK],
  ['permethrin', HT, DUSK],
  ['zeta-cypermethrin', HT, DUSK],
  ['esfenvalerate', HT, DUSK],
  ['beta-cyfluthrin', HT, DUSK],
  ['cyfluthrin', HT, DUSK],
  ['pyrethrins', HT, DUSK],
  // Organophosphates / carbamates. Long-residual actives → prohibited.
  ['malathion', HT, DUSK],
  ['chlorpyrifos', HT, PROHIBITED],
  ['acephate', HT, PROHIBITED],
  ['dimethoate', HT, PROHIBITED],
  ['carbaryl', HT, PROHIBITED],
  ['methomyl', HT, DUSK],
  ['oxamyl', HT, DUSK],
  // Other highly toxic contact actives with "not while foraging" language.
  ['abamectin', HT, DUSK],
  ['indoxacarb', HT, DUSK],
  ['cyantraniliprole', HT, DUSK],
  ['tolfenpyrad', HT, DUSK],
  // Spinosyns — toxic until spray residue dries (~3 h).
  ['spinosad', HT, DUSK, 3],
  ['spinosyn', HT, DUSK, 3],
  ['spinetoram', HT, DUSK, 3],
  // Relatively nontoxic to adult bees; no label bloom restriction.
  ['chlorantraniliprole', RN, NONE],
  ['flupyradifurone', RN, NONE],
  ['flonicamid', RN, NONE],
  ['pymetrozine', RN, NONE],
  ['methoxyfenozide', RN, NONE],
  ['tebufenozide', RN, NONE],
  ['buprofezin', RN, NONE],
  ['clofentezine', RN, NONE],
  ['hexythiazox', RN, NONE],
  ['bacillus thuringiensis', RN, NONE],
  ['cydia pomonella granulovirus', RN, NONE],
  ['beauveria bassiana', RN, NONE],
  ['kaolin', RN, NONE],
  ['potassium salts of fatty acids', RN, NONE],
  ['highly refined paraffinic oil', RN, NONE],
  ['paraffinic oil', RN, NONE],
  ['codlemone', RN, NONE],
  ['sulfur', RN, NONE],
  ['iron (ferric) phosphate', RN, NONE],
  ['metaldehyde', RN, NONE],
  ['steinernema feltiae', RN, NONE],
  ['trichogramma', RN, NONE]
];

const TOX_RANK = { [RN]: 0, [T]: 1, [HT]: 2 };
const RESTRICTION_RANK = { [NONE]: 0, [DUSK]: 1, [PROHIBITED]: 2 };

export function classify(name) {
  const n = name.toLowerCase().trim();
  const hit = AI_CLASSES.find(([ai]) => n === ai || n.startsWith(`${ai} `));
  return hit ?? null;
}

export function pollinatorFor(activeIngredients) {
  let tox = RN;
  let restriction = NONE;
  let residual;
  const unmapped = [];
  for (const ai of activeIngredients) {
    const hit = classify(ai.name);
    if (!hit) {
      unmapped.push(ai.name);
      continue;
    }
    const [, t, r, h] = hit;
    if (TOX_RANK[t] > TOX_RANK[tox]) tox = t;
    if (RESTRICTION_RANK[r] > RESTRICTION_RANK[restriction]) restriction = r;
    if (h !== undefined) residual = Math.max(residual ?? 0, h);
  }
  if (unmapped.length > 0) return { pollinator: null, unmapped };
  const pollinator = { beeToxicity: tox, bloomRestriction: restriction };
  if (residual !== undefined) pollinator.residualToxicityHours = residual;
  return { pollinator, unmapped };
}

function upsert(text, value) {
  const line = `  "pollinator": ${JSON.stringify(value)},`;
  const existing = /^ {2}"pollinator": \{.*\},?$/m;
  if (existing.test(text)) {
    return text.replace(existing, (m) => (m.endsWith(',') ? line : line.slice(0, -1)));
  }
  const afterRisk = /^( {2}"pollinatorRisk": .*,)$/m;
  if (afterRisk.test(text)) return text.replace(afterRisk, `$1\n${line}`);
  const afterVersion = /^( {2}"version": .*,)$/m;
  if (!afterVersion.test(text)) throw new Error('no top-level "version" line');
  return text.replace(afterVersion, `$1\n${line}`);
}

/** Plugins whose `pollinator` was read from the label (provenance in
 *  epa-reg-sources.json → `pollinator`). The table never overwrites them. */
function labelSourced() {
  const sources = JSON.parse(readFileSync(resolve(__dirname, 'epa-reg-sources.json'), 'utf8'));
  return new Set(Object.keys(sources.pollinator ?? {}));
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const counts = {};
  const skipped = [];
  const fromLabel = labelSourced();
  for (const file of readdirSync(DIR).filter((f) => f.endsWith('.json'))) {
    const path = resolve(DIR, file);
    const text = readFileSync(path, 'utf8');
    const plugin = JSON.parse(text);
    if (fromLabel.has(plugin.pluginId)) continue;
    const { pollinator, unmapped } = pollinatorFor(plugin.activeIngredients ?? []);
    if (!pollinator) {
      skipped.push(`${plugin.pluginId}: ${unmapped.join(', ')}`);
      continue;
    }
    const key = `${pollinator.beeToxicity} / ${pollinator.bloomRestriction}`;
    counts[key] = (counts[key] ?? 0) + 1;
    if (!DRY_RUN) writeFileSync(path, upsert(text, pollinator), 'utf8');
  }
  console.log(JSON.stringify({ counts, skipped }, null, 2));
}
