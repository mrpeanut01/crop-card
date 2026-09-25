#!/usr/bin/env node
/**
 * #255 — input-plugin metadata coverage audit.
 *
 * Validates every plugin under /plugins/{herbicides,insecticides,fungicides,
 * fertilizers} against the Zod schema, then reports per-category coverage of
 * `defaultUnit`, `activeIngredients`, `formulation` (fertilizers satisfy the
 * latter two via the required `analysis` + `form`) and, for pesticides,
 * `epaRegistrationNumber` (#381; provenance in scripts/epa-reg-sources.json). Gaps must be listed in
 * scripts/plugin-metadata-allowlist.json with a reason; the same check runs
 * in `pnpm test:unit` (src/lib/plugins/inputMetadata.coverage.test.ts).
 *
 * Also reports (informational, not gated) the #255 follow-up fields:
 * `complianceFlags` and insecticide `scoutingThresholds`.
 *
 * Usage:
 *   pnpm audit:plugin-metadata            # table + CSV
 *   pnpm audit:plugin-metadata --check    # exit 1 on unallowlisted/stale
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { pluginSchema } from '../src/lib/plugins/schemas.ts';
import {
  checkCoverage,
  metadataGaps,
  resolvePluginDefaultUnit,
  METADATA_FIELDS
} from '../src/lib/plugins/inputMetadata.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGINS_DIR = resolve(__dirname, '../../../plugins');
const ALLOWLIST_PATH = resolve(__dirname, 'plugin-metadata-allowlist.json');
const AUDIT_CSV = resolve(tmpdir(), 'cropcard-plugin-metadata-audit.csv');
const CHECK = process.argv.includes('--check');

const CATEGORIES = [
  { dir: 'herbicides', kind: 'herbicide' },
  { dir: 'insecticides', kind: 'insecticide' },
  { dir: 'fungicides', kind: 'fungicide' },
  { dir: 'fertilizers', kind: 'fertilizer' }
];

const invalid = [];
const plugins = [];
for (const { dir } of CATEGORIES) {
  for (const file of readdirSync(resolve(PLUGINS_DIR, dir)).filter((f) => f.endsWith('.json'))) {
    const parsed = pluginSchema.safeParse(
      JSON.parse(readFileSync(resolve(PLUGINS_DIR, dir, file), 'utf8'))
    );
    if (parsed.success) plugins.push({ file, plugin: parsed.data });
    else invalid.push(`${dir}/${file}: ${parsed.error.issues[0]?.message}`);
  }
}

const allowlist = JSON.parse(readFileSync(ALLOWLIST_PATH, 'utf8')).entries;
const allowedReason = new Map(allowlist.map((e) => [`${e.pluginId}::${e.field}`, e.reason]));
const report = checkCoverage(
  plugins.map((p) => p.plugin),
  allowlist
);

const rows = [
  [
    'kind',
    'pluginId',
    'file',
    ...METADATA_FIELDS,
    'resolvedDefaultUnit',
    'unitBasis',
    'complianceFlags',
    'allowlistReasons'
  ]
];
const summary = new Map(
  CATEGORIES.map(({ kind }) => [
    kind,
    {
      total: 0,
      defaultUnit: 0,
      activeIngredients: 0,
      formulation: 0,
      epaRegistrationNumber: 0,
      complianceFlags: 0,
      scouting: 0
    }
  ])
);
for (const { file, plugin } of plugins) {
  const s = summary.get(plugin.type);
  const gaps = metadataGaps(plugin);
  s.total++;
  for (const f of METADATA_FIELDS) if (!gaps.includes(f)) s[f]++;
  if (plugin.complianceFlags) s.complianceFlags++;
  if (plugin.type === 'insecticide' && plugin.scoutingThresholds?.length) s.scouting++;
  const resolved = resolvePluginDefaultUnit(plugin);
  rows.push([
    plugin.type,
    plugin.pluginId,
    file,
    ...METADATA_FIELDS.map((f) => (gaps.includes(f) ? 'MISSING' : 'present')),
    resolved.unit,
    resolved.basis,
    plugin.complianceFlags ? 'present' : 'MISSING',
    gaps
      .map((f) => allowedReason.get(`${plugin.pluginId}::${f}`))
      .filter(Boolean)
      .join(' | ')
  ]);
}

writeFileSync(
  AUDIT_CSV,
  rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n') + '\n',
  'utf8'
);

const pct = (n, t) => (t === 0 ? '  -' : `${((n / t) * 100).toFixed(0).padStart(3)}%`);
const cell = (n, t, w) => `${pct(n, t)} (${n}/${t})`.padEnd(w);
console.log('\n─── #255 input-plugin metadata coverage ───\n');
console.log(
  'kind         | total | defaultUnit     | activeIngredients | formulation     | epaRegNumber    | complianceFlags'
);
console.log(
  '-------------|-------|-----------------|-------------------|-----------------|-----------------|----------------'
);
for (const [kind, s] of summary) {
  console.log(
    `${kind.padEnd(12)} | ${String(s.total).padStart(5)} | ${cell(s.defaultUnit, s.total, 15)} | ${cell(s.activeIngredients, s.total, 17)} | ${cell(s.formulation, s.total, 15)} | ${kind === 'fertilizer' ? 'n/a'.padEnd(15) : cell(s.epaRegistrationNumber, s.total, 15)} | ${cell(s.complianceFlags, s.total, 15)}`
  );
}
const ins = summary.get('insecticide');
console.log(`\ninsecticide scoutingThresholds (informational): ${ins.scouting}/${ins.total}`);
console.log(
  'fertilizer activeIngredients/formulation are satisfied by `analysis` / `form`; fertilizers carry no EPA reg. no.'
);
console.log(
  `\nGaps: ${report.gaps.length} total · ${report.gaps.length - report.unallowlisted.length} allowlisted · ${report.unallowlisted.length} NOT allowlisted · ${report.stale.length} stale allowlist entries`
);
console.log(`Audit CSV: ${AUDIT_CSV}`);

for (const i of invalid) console.error(`INVALID  ${i}`);
for (const g of report.unallowlisted) console.error(`GAP      ${g.pluginId} · ${g.field}`);
for (const e of report.stale)
  console.error(`STALE    ${e.pluginId} · ${e.field} (no longer a gap)`);

if (CHECK && (invalid.length || report.unallowlisted.length || report.stale.length))
  process.exit(1);
