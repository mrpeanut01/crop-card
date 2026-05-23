#!/usr/bin/env node
/**
 * Phase 21 (B-25) deferred data backfill — populate the v1.1 schema
 * additions on existing on-disk plugin JSON files.
 *
 *   1. Crop plugins: assign `purpose` on each sprayWindows[] entry using a
 *      chemistryClass × anchor heuristic. Existing `purpose` values are
 *      preserved.
 *   2. Input plugins (herbicide / insecticide / fungicide / fertilizer):
 *      populate `complianceFlags` when the displayName/pluginId/chemistry
 *      lets us classify confidently. Existing `complianceFlags` are
 *      preserved (we only fill missing fields, never overwrite).
 *   3. Stamp `pluginSchemaVersion: '1.1'` on every touched file.
 *
 * Idempotent: re-running the script is a no-op once everything that can
 * be inferred has been inferred. Use `--dry-run` to print proposed
 * changes without writing.
 */

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pluginsRoot = path.resolve(here, '..', '..', '..', 'plugins');
const dryRun = process.argv.includes('--dry-run');

const stats = {
  filesScanned: 0,
  filesChanged: 0,
  sprayWindowsTagged: 0,
  inputComplianceTagged: 0,
  schemaVersionStamped: 0
};

const chemistryToPurpose = (chemistryClass, anchor, offsetDaysMin) => {
  switch (chemistryClass) {
    case 'glyphosate':
    case 'glufosinate':
      if (anchor === 'planting' && offsetDaysMin <= 3) return 'burndown';
      return 'post-emergent';
    case 'photosystem-i-diquat':
      return 'burndown';
    case 'synthetic-auxin':
    case 'accase-inhibitor':
    case 'sulfonylurea':
    case 'als-imidazolinone':
    case 'hppd-inhibitor':
      return 'post-emergent';
    case 'chloroacetamide':
    case 'microtubule-inhibitor':
    case 'ppo-inhibitor':
    case 'photosystem-ii-triazine':
    case 'vlcfa-pyroxasulfone':
    case 'clomazone':
      return 'pre-emergent';
    default:
      return null;
  }
};

const omriHints = [
  /\bcopper\b/i,
  /\bsulfur\b/i,
  /\bkocide\b/i,
  /\bchamp\b/i,
  /\bbordeaux\b/i,
  /\bkumulus\b/i,
  /\bkelp\b/i,
  /\bfish[- ]?emulsion\b/i,
  /\bblood meal\b/i,
  /\bbone meal\b/i,
  /\bfeather meal\b/i,
  /\balfalfa pellets\b/i,
  /\bag[- ]?lime\b/i,
  /\bdolomitic lime\b/i,
  /\bgypsum\b/i,
  /\bgreensand\b/i,
  /\brock phosphate\b/i,
  /\bcomposted\b/i,
  /\bcompost\b/i
];

const syntheticFertHints = [
  /\burea\b/i,
  /\buan\b/i,
  /\bmap\b/i,
  /\bdap\b/i,
  /\bsop\b/i,
  /\bk-mag\b/i,
  /\bpotash\b/i,
  /\bmop\b/i
];

function classifyInput(plugin) {
  const displayName = String(plugin.displayName ?? '');
  const pluginId = String(plugin.pluginId ?? '');
  const text = `${displayName} ${pluginId}`;
  const flags = {};

  if (omriHints.some((rx) => rx.test(text))) {
    flags.omriListed = true;
    flags.nonGmoCompliant = true;
    flags.transitioningAllowed = true;
  } else if (syntheticFertHints.some((rx) => rx.test(text))) {
    flags.omriListed = false;
    flags.nonGmoCompliant = true;
    flags.certifiedOrganicAllowed = false;
    flags.transitioningAllowed = false;
  } else if (plugin.type === 'herbicide' || plugin.type === 'insecticide') {
    flags.omriListed = false;
    flags.certifiedOrganicAllowed = false;
    flags.nonGmoCompliant = true;
    flags.transitioningAllowed = false;
  } else if (plugin.type === 'fungicide') {
    return {};
  }
  return flags;
}

function backfillCrop(plugin) {
  if (!Array.isArray(plugin.sprayWindows)) return false;
  let touched = false;
  for (const window of plugin.sprayWindows) {
    if (window.purpose) continue;
    const purpose = chemistryToPurpose(
      window.chemistryClass,
      window.anchor,
      Number(window.offsetDaysMin ?? 0)
    );
    if (purpose) {
      window.purpose = purpose;
      touched = true;
      stats.sprayWindowsTagged++;
    }
  }
  return touched;
}

function backfillInput(plugin) {
  const inferred = classifyInput(plugin);
  if (Object.keys(inferred).length === 0) return false;
  const existing = plugin.complianceFlags ?? {};
  const merged = { ...inferred, ...existing };
  if (JSON.stringify(merged) === JSON.stringify(existing)) return false;
  plugin.complianceFlags = merged;
  stats.inputComplianceTagged++;
  return true;
}

const KINDS = ['crops', 'herbicides', 'insecticides', 'fungicides', 'fertilizers', 'companions'];

for (const subdir of KINDS) {
  const dir = path.join(pluginsRoot, subdir);
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    continue;
  }
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const file = path.join(dir, name);
    let plugin;
    try {
      plugin = JSON.parse(readFileSync(file, 'utf-8'));
    } catch (e) {
      console.warn(`skip unparseable ${file}: ${e.message}`);
      continue;
    }
    stats.filesScanned++;

    let touched = false;
    if (plugin.type === 'crop') {
      touched = backfillCrop(plugin) || touched;
    } else if (
      plugin.type === 'herbicide' ||
      plugin.type === 'insecticide' ||
      plugin.type === 'fungicide' ||
      plugin.type === 'fertilizer'
    ) {
      touched = backfillInput(plugin) || touched;
    }

    if (touched && plugin.pluginSchemaVersion !== '1.1') {
      plugin.pluginSchemaVersion = '1.1';
      stats.schemaVersionStamped++;
    }

    if (touched && !dryRun) {
      writeFileSync(file, JSON.stringify(plugin, null, 2) + '\n', 'utf-8');
    }
    if (touched) stats.filesChanged++;
  }
}

console.log(JSON.stringify({ ...stats, dryRun, pluginsRoot }, null, 2));
