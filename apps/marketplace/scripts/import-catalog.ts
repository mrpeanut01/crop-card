/**
 * CLI bulk-import. Walks <rootDir>/{crops,herbicides,...}/*.json and
 * persists each through the marketplace scan pipeline.
 *
 * Usage:
 *   pnpm -F @cropcard/marketplace import-catalog <rootDir>
 *
 * Env:
 *   DATABASE_URL       — defaults to file:/data/marketplace.db
 *   CLAMAV_HOST/PORT   — if unset and CLAMAV_SCAN_MODE != 'skip',
 *                        every file fails 'scanner_unavailable'. For
 *                        local seeding without clamd running, set
 *                        CLAMAV_SCAN_MODE=skip (logs a warning per call).
 *
 * Exit codes:
 *   0 — no rejections
 *   1 — at least one file rejected or scanner unavailable
 *   2 — usage error
 */

import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  ensureSeedImportCredential,
  importCatalog,
  type ImportReport
} from '../src/lib/server/import/catalog';

const REPORT_OUT = resolve(process.cwd(), '.import-report.json');

async function main(): Promise<number> {
  const rootArg = process.argv[2];
  if (!rootArg) {
    console.error('usage: import-catalog <rootDir>');
    console.error('       walks <rootDir>/{crops,herbicides,insecticides,fungicides,fertilizers,companions}/*.json');
    return 2;
  }
  const root = resolve(rootArg);

  const cred = ensureSeedImportCredential();
  console.log(`[import] credential=${cred.id} (${cred.label}, ${cred.trustLevel})`);
  console.log(`[import] walking ${root}`);

  const report: ImportReport = await importCatalog({
    rootDir: root,
    credentialId: cred.id
  });

  await writeFile(REPORT_OUT, JSON.stringify(report, null, 2), 'utf-8');

  const summary = [
    `[import] done in ${(report.finishedAt - report.startedAt) / 1000}s:`,
    `  imported    : ${report.imported}`,
    `  deduped     : ${report.deduped}`,
    `  quarantined : ${report.quarantined}`,
    `  rejected    : ${report.rejected}`,
    `  scanner-unavailable : ${report.scannerUnavailable}`,
    `  read errors : ${report.readErrors}`,
    `  total files : ${report.perFile.length}`,
    `[import] report → ${REPORT_OUT}`
  ].join('\n');
  console.log(summary);

  if (report.rejected > 0 || report.scannerUnavailable > 0 || report.readErrors > 0) {
    console.error('[import] non-zero failure count; see report for details');
    return 1;
  }
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('[import] fatal', err);
    process.exit(1);
  });
