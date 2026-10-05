/** The /harvest "Export YTD" CSV. Pure; every cell is quoted and a cell a
 *  spreadsheet would read as a formula gets a leading quote (`csvSafe`). */

import { csvSafe } from '$lib/finance/csv';

export const HARVEST_YTD_CSV_HEADER = ['Date', 'Block', 'Crop plugin', 'Quantity', 'Lot #'];

export function harvestYtdCsv(rows: readonly (readonly string[])[]): string {
  return [HARVEST_YTD_CSV_HEADER, ...rows]
    .map((r) => r.map((c) => `"${csvSafe(String(c)).replace(/"/g, '""')}"`).join(','))
    .join('\n');
}
