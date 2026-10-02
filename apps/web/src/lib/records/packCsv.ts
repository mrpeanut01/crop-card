/** CSV cells and the certifier pack preamble (33B, B-44). Pure. */

import { csvSafe } from '$lib/finance/csv';

export const PACK_PREAMBLE = 'Prepared from records kept in CropCard. This is not a certification.';

export const LOG_FOOTER = 'Prepared from records kept in CropCard.';

export type CsvValue = string | number | boolean | null | undefined;

export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return '';
  const text = csvSafe(typeof value === 'boolean' ? (value ? 'yes' : 'no') : String(value));
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csvLine(values: readonly CsvValue[]): string {
  return values.map(csvCell).join(',');
}

/** One CSV file: an optional one-cell preamble row, the header, the rows.
 *  CRLF line ends so spreadsheets on every platform read it the same. */
export function csvDocument(
  header: readonly string[],
  rows: readonly (readonly CsvValue[])[],
  opts: { preamble: boolean }
): string {
  const lines: string[] = [];
  if (opts.preamble) lines.push(csvLine([PACK_PREAMBLE]));
  lines.push(csvLine(header));
  for (const r of rows) lines.push(csvLine(r));
  return `${lines.join('\r\n')}\r\n`;
}
