/**
 * Writes a text-refresh migration for edited or removed crop seasonal rows
 * (OP-21, docs/design/ORCHARD_CALENDAR.md) from a rows file of
 * `{ templateKey, oldTitle, newTitle, oldBody, newBody, removed? }`.
 *
 * Usage (from apps/web):
 *   pnpm exec tsx scripts/gen-text-refresh-migration.ts \
 *     scripts/seasonal-text-refresh-0087.json drizzle/0087_seasonal_text_refresh.sql m0087
 *
 * Then add the journal entry and snapshot as for any hand-written migration;
 * `migration0087.seasonalText.test.ts` checks the file still matches its rows.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import {
  textRefreshMigrationSql,
  type TextRefreshRow
} from '../src/lib/db/textRefreshMigration.ts';

const [rowsPath, outPath, prefix, abortReason] = process.argv.slice(2);
if (!rowsPath || !outPath || !prefix) {
  console.error(
    'usage: gen-text-refresh-migration.ts <rows.json> <out.sql> <prefix> [abortReason]'
  );
  process.exit(2);
}
const rows = JSON.parse(readFileSync(rowsPath, 'utf8')) as TextRefreshRow[];
writeFileSync(outPath, textRefreshMigrationSql(rows, { prefix, abortReason }));
console.log(`wrote ${outPath} from ${rows.length} rows`);
