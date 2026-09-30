/** F2-16: the ledger CSV. Pure; the route supplies names and dates. */

import { categoryLabel } from './categories';

export const LEDGER_CSV_HEADER = [
  'date',
  'kind',
  'category',
  'amount',
  'description',
  'linked to',
  'enterprise',
  'quantity',
  'unit',
  'entered by'
] as const;

export interface LedgerCsvRow {
  date: string;
  kind: 'expense' | 'income';
  category: string | null;
  amountCents: number;
  description: string | null;
  linkedTo: string | null;
  enterprise: string | null;
  quantity: number | null;
  unit: string | null;
  enteredBy: string | null;
}

/** A cell a spreadsheet would read as a formula gets a leading quote. */
export function csvSafe(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function cell(value: string | number | null): string {
  if (value === null) return '';
  const text = csvSafe(String(value));
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function ledgerCsv(rows: readonly LedgerCsvRow[]): string {
  const lines = [LEDGER_CSV_HEADER.join(',')];
  for (const r of rows) {
    lines.push(
      [
        r.date,
        r.kind,
        categoryLabel(r.category),
        (r.amountCents / 100).toFixed(2),
        r.description,
        r.linkedTo,
        r.enterprise,
        r.quantity,
        r.unit,
        r.enteredBy
      ]
        .map(cell)
        .join(',')
    );
  }
  return lines.join('\r\n') + '\r\n';
}
