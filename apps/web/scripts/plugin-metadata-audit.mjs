#!/usr/bin/env node
/**
 * Sprint 6 / #255 — chemical-plugin metadata coverage audit.
 *
 * Walks every plugin under /plugins/{herbicides,insecticides,fungicides,fertilizers}
 * and reports per-category coverage of the three fields Phase 27D's Edit
 * form will require: `defaultUnit`, `activeIngredients`, `formulation`.
 *
 * Read-only by design — emits a CSV at /tmp/cropcard-plugin-metadata-audit.csv
 * + a per-category summary on stdout. The remediation is plugin-author
 * work (re-issue the AI ingest with stronger prompts) and lands in a
 * follow-up sprint; this script is the audit gate that closes #255.
 *
 * Usage:
 *   pnpm audit:plugin-metadata
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../../..');
const AUDIT_CSV = '/tmp/cropcard-plugin-metadata-audit.csv';

const CATEGORIES = [
  { dir: 'herbicides', kind: 'herbicide' },
  { dir: 'insecticides', kind: 'insecticide' },
  { dir: 'fungicides', kind: 'fungicide' },
  { dir: 'fertilizers', kind: 'fertilizer' }
];

const FIELDS = ['defaultUnit', 'activeIngredients', 'formulation'];

function loadPlugins(dir) {
  const fullDir = resolve(REPO_ROOT, 'plugins', dir);
  try {
    return readdirSync(fullDir)
      .filter((f) => f.endsWith('.json'))
      .map((file) => ({
        file,
        plugin: JSON.parse(readFileSync(resolve(fullDir, file), 'utf8'))
      }));
  } catch {
    return [];
  }
}

function fieldPresent(plugin, field) {
  const v = plugin[field];
  if (v === undefined || v === null) return false;
  if (Array.isArray(v) && v.length === 0) return false;
  if (typeof v === 'string' && v.trim() === '') return false;
  return true;
}

function main() {
  const auditRows = [['kind', 'pluginId', 'file', ...FIELDS]];
  const summary = new Map();

  for (const { dir, kind } of CATEGORIES) {
    const plugins = loadPlugins(dir);
    const counts = { total: plugins.length, present: {} };
    for (const field of FIELDS) counts.present[field] = 0;

    for (const { file, plugin } of plugins) {
      const row = [kind, plugin.pluginId ?? file.replace(/\.json$/, ''), file];
      for (const field of FIELDS) {
        const present = fieldPresent(plugin, field);
        if (present) counts.present[field]++;
        row.push(present ? 'present' : 'MISSING');
      }
      auditRows.push(row);
    }
    summary.set(kind, counts);
  }

  writeFileSync(
    AUDIT_CSV,
    auditRows.map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n') +
      '\n',
    'utf8'
  );

  console.log('\n─── #255 plugin metadata coverage audit ───\n');
  console.log('kind         | total | defaultUnit | activeIngredients | formulation');
  console.log('-------------|-------|-------------|-------------------|------------');
  let totalRowsCount = 0;
  for (const [kind, c] of summary) {
    const pct = (n) => (c.total === 0 ? '  -' : ((n / c.total) * 100).toFixed(0).padStart(3) + '%');
    const cell = (n) => `${pct(n)} (${n}/${c.total})`.padEnd(11);
    console.log(
      `${kind.padEnd(12)} | ${String(c.total).padStart(5)} | ${cell(c.present.defaultUnit)} | ${cell(c.present.activeIngredients).padEnd(17)} | ${cell(c.present.formulation)}`
    );
    totalRowsCount += c.total;
  }
  console.log(`\nTotal chemical plugins audited: ${totalRowsCount}`);
  console.log(`Audit CSV: ${AUDIT_CSV}`);
}

main();
