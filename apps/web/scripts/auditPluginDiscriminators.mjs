#!/usr/bin/env node
/**
 * Phase 25c.0 (#87) — plugin discriminator coverage audit.
 *
 * Reads every JSON file under /plugins/ and reports which Phase 25c.0
 * discriminator fields are populated. Output is written to
 * docs/plugin-discriminator-coverage.md as a markdown report.
 *
 * Discriminators audited:
 *   - Crop:        growthStageTable.system, harvestStyle,
 *                  postHarvestCuring (presence), bloomWindow
 *   - Insecticide: scoutingThresholds (presence)
 *   - Fungicide:   activeIngredients[].fracCode (all populated)
 *
 * The audit is purely read-only — it does not modify any plugin files.
 * Run before / after gap-fill PRs to track progress toward the ≥95%
 * coverage gate before Zod fields are promoted to required.
 *
 * Usage:
 *   pnpm audit:plugins
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../../..');
const PLUGINS_DIR = resolve(REPO_ROOT, 'plugins');
const OUT_PATH = resolve(REPO_ROOT, 'docs/plugin-discriminator-coverage.md');

const PLUGIN_TYPES = ['crops', 'insecticides', 'fungicides'];

function loadPlugins(typeDir) {
  const dir = resolve(PLUGINS_DIR, typeDir);
  let files;
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
  const out = [];
  for (const file of files) {
    const path = resolve(dir, file);
    try {
      const plugin = JSON.parse(readFileSync(path, 'utf8'));
      out.push({ file, path, plugin });
    } catch (e) {
      console.warn(`  skipping ${typeDir}/${file}: ${e.message}`);
    }
  }
  return out;
}

function auditCrops(plugins) {
  const total = plugins.length;
  const families = new Map();
  const missing = {
    growthStageTable: [],
    harvestStyle: [],
    bloomWindow: []
  };
  let counts = { growthStageTable: 0, harvestStyle: 0, postHarvestCuring: 0, bloomWindow: 0 };

  for (const { file, plugin } of plugins) {
    const fam = plugin.cropFamily ?? 'unknown';
    if (!families.has(fam)) {
      families.set(fam, {
        total: 0,
        growthStageTable: 0,
        harvestStyle: 0,
        postHarvestCuring: 0,
        bloomWindow: 0
      });
    }
    const f = families.get(fam);
    f.total += 1;

    if (plugin.growthStageTable?.system) {
      counts.growthStageTable += 1;
      f.growthStageTable += 1;
    } else {
      missing.growthStageTable.push({ file, family: fam });
    }
    if (plugin.harvestStyle) {
      counts.harvestStyle += 1;
      f.harvestStyle += 1;
    } else {
      missing.harvestStyle.push({ file, family: fam });
    }
    if (plugin.postHarvestCuring) {
      counts.postHarvestCuring += 1;
      f.postHarvestCuring += 1;
    }
    if (plugin.bloomWindow) {
      counts.bloomWindow += 1;
      f.bloomWindow += 1;
    } else {
      missing.bloomWindow.push({ file, family: fam });
    }
  }

  return { total, counts, families, missing };
}

function auditInsecticides(plugins) {
  const total = plugins.length;
  let withThresholds = 0;
  const missing = [];
  for (const { file, plugin } of plugins) {
    if (Array.isArray(plugin.scoutingThresholds) && plugin.scoutingThresholds.length > 0) {
      withThresholds += 1;
    } else {
      missing.push({ file });
    }
  }
  return { total, withThresholds, missing };
}

function auditFungicides(plugins) {
  const total = plugins.length;
  let withFracCodes = 0;
  const missing = [];
  for (const { file, plugin } of plugins) {
    const ais = plugin.activeIngredients ?? [];
    const allTagged =
      ais.length > 0 &&
      ais.every((ai) => typeof ai.fracCode === 'string' && ai.fracCode.length > 0);
    if (allTagged) withFracCodes += 1;
    else missing.push({ file });
  }
  return { total, withFracCodes, missing };
}

function pct(n, total) {
  if (total === 0) return '0.0%';
  return `${((100 * n) / total).toFixed(1)}%`;
}

function renderReport({ crops, insect, fung, generatedAt }) {
  const lines = [];
  lines.push('# Plugin discriminator coverage (Phase 25c.0)');
  lines.push('');
  lines.push(`Generated: ${generatedAt}`);
  lines.push('');
  lines.push('Tracks coverage of the Phase 25c renderer-dispatch + Phase 25d gate-evaluator');
  lines.push(
    'discriminator fields across the plugin corpus. Per the [#87 plan](https://github.com/mrpeanut01/crop-card/issues/87),'
  );
  lines.push('Zod fields stay **optional** until coverage reaches ≥95%, then they are promoted');
  lines.push('to required so future uploads must declare them. `FallbackHarvestRenderer` becomes');
  lines.push('defensive-only after the promotion.');
  lines.push('');
  lines.push('Regenerate with: `pnpm audit:plugins`');
  lines.push('');

  lines.push('## Summary');
  lines.push('');
  lines.push('| Plugin type | Total | Field | Coverage |');
  lines.push('| --- | ---: | --- | ---: |');
  lines.push(
    `| Crop | ${crops.total} | growthStageTable.system | ${pct(crops.counts.growthStageTable, crops.total)} (${crops.counts.growthStageTable}/${crops.total}) |`
  );
  lines.push(
    `| Crop | ${crops.total} | harvestStyle | ${pct(crops.counts.harvestStyle, crops.total)} (${crops.counts.harvestStyle}/${crops.total}) |`
  );
  lines.push(
    `| Crop | ${crops.total} | postHarvestCuring (presence) | ${pct(crops.counts.postHarvestCuring, crops.total)} (${crops.counts.postHarvestCuring}/${crops.total}) |`
  );
  lines.push(
    `| Crop | ${crops.total} | bloomWindow | ${pct(crops.counts.bloomWindow, crops.total)} (${crops.counts.bloomWindow}/${crops.total}) |`
  );
  lines.push(
    `| Insecticide | ${insect.total} | scoutingThresholds | ${pct(insect.withThresholds, insect.total)} (${insect.withThresholds}/${insect.total}) |`
  );
  lines.push(
    `| Fungicide | ${fung.total} | activeIngredients[].fracCode (all set) | ${pct(fung.withFracCodes, fung.total)} (${fung.withFracCodes}/${fung.total}) |`
  );
  lines.push('');

  lines.push('## Crop coverage by family');
  lines.push('');
  lines.push(
    '| Family | Total | growthStageTable | harvestStyle | postHarvestCuring | bloomWindow |'
  );
  lines.push('| --- | ---: | ---: | ---: | ---: | ---: |');
  const sortedFams = [...crops.families.entries()].sort(([a], [b]) => a.localeCompare(b));
  for (const [fam, f] of sortedFams) {
    lines.push(
      `| ${fam} | ${f.total} | ${pct(f.growthStageTable, f.total)} | ${pct(f.harvestStyle, f.total)} | ${pct(f.postHarvestCuring, f.total)} | ${pct(f.bloomWindow, f.total)} |`
    );
  }
  lines.push('');

  lines.push('## Missing coverage — crop harvestStyle (top 50)');
  lines.push('');
  if (crops.missing.harvestStyle.length === 0) {
    lines.push('_All crop plugins have `harvestStyle` set._ ✓');
  } else {
    for (const m of crops.missing.harvestStyle.slice(0, 50)) {
      lines.push(`- \`${m.file}\` (${m.family})`);
    }
    if (crops.missing.harvestStyle.length > 50) {
      lines.push(`- _…and ${crops.missing.harvestStyle.length - 50} more_`);
    }
  }
  lines.push('');

  lines.push('## Missing coverage — crop bloomWindow (top 50)');
  lines.push('');
  if (crops.missing.bloomWindow.length === 0) {
    lines.push('_All crop plugins have `bloomWindow` set._ ✓');
  } else {
    for (const m of crops.missing.bloomWindow.slice(0, 50)) {
      lines.push(`- \`${m.file}\` (${m.family})`);
    }
    if (crops.missing.bloomWindow.length > 50) {
      lines.push(`- _…and ${crops.missing.bloomWindow.length - 50} more_`);
    }
  }
  lines.push('');

  lines.push('## Missing coverage — insecticide scoutingThresholds');
  lines.push('');
  if (insect.missing.length === 0) {
    lines.push('_All insecticide plugins have `scoutingThresholds`._ ✓');
  } else {
    for (const m of insect.missing.slice(0, 50)) {
      lines.push(`- \`${m.file}\``);
    }
    if (insect.missing.length > 50) {
      lines.push(`- _…and ${insect.missing.length - 50} more_`);
    }
  }
  lines.push('');

  lines.push('## Missing coverage — fungicide fracCode');
  lines.push('');
  if (fung.missing.length === 0) {
    lines.push('_All fungicide plugins have FRAC codes on every active ingredient._ ✓');
  } else {
    for (const m of fung.missing.slice(0, 50)) {
      lines.push(`- \`${m.file}\``);
    }
    if (fung.missing.length > 50) {
      lines.push(`- _…and ${fung.missing.length - 50} more_`);
    }
  }
  lines.push('');

  return lines.join('\n') + '\n';
}

const crops = auditCrops(loadPlugins('crops'));
const insect = auditInsecticides(loadPlugins('insecticides'));
const fung = auditFungicides(loadPlugins('fungicides'));

const report = renderReport({
  crops,
  insect,
  fung,
  generatedAt: new Date().toISOString()
});

writeFileSync(OUT_PATH, report);
console.log(`Wrote ${OUT_PATH}`);
console.log('');
console.log('Summary:');
console.log(`  Crops:        ${crops.total} total`);
console.log(
  `    growthStageTable: ${pct(crops.counts.growthStageTable, crops.total)} (${crops.counts.growthStageTable}/${crops.total})`
);
console.log(
  `    harvestStyle:     ${pct(crops.counts.harvestStyle, crops.total)} (${crops.counts.harvestStyle}/${crops.total})`
);
console.log(
  `    bloomWindow:      ${pct(crops.counts.bloomWindow, crops.total)} (${crops.counts.bloomWindow}/${crops.total})`
);
console.log(`  Insecticides: ${insect.total} total`);
console.log(
  `    scoutingThresholds: ${pct(insect.withThresholds, insect.total)} (${insect.withThresholds}/${insect.total})`
);
console.log(`  Fungicides:   ${fung.total} total`);
console.log(
  `    fracCode coverage:  ${pct(fung.withFracCodes, fung.total)} (${fung.withFracCodes}/${fung.total})`
);
