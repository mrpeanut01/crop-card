/** Pure disposition rules shared by the endpoints and the panel (B-28,
 *  B-33). Client-safe. */

import { parseHarvestQuantity } from '$lib/finance/harvestSale';
import { zonedDayStartMs } from '$lib/exports/dateRange';
import { ymdInZone } from '$lib/prefs';
import { DISPOSITION_KIND_LABEL, type HarvestDispositionKind } from './apiSchemas';

export const DISPOSITION_FUTURE_SLACK_MS = 5 * 60 * 1000;

export interface DispositionView {
  id: string;
  harvestEventId: string;
  kind: HarvestDispositionKind;
  quantity: number;
  unit: string;
  occurredAt: number;
  recipient: string | null;
  soldAsOrganic: boolean | null;
  /** Owners only; null for everyone else (F2-1). */
  ledgerEntryId: string | null;
  /** Owners only: whether the linked sale is still in the ledger. */
  sale: 'live' | 'deleted' | null;
  locked: boolean;
  createdAt: number;
}

export type DispositionDateProblem =
  { error: 'BEFORE_HARVEST'; message: string } | { error: 'IN_THE_FUTURE'; message: string };

/** The start of the harvest's farm-local day, the earliest a disposition
 *  can be dated. */
export function harvestDayStartMs(harvestMs: number, timeZone: string): number {
  const [y, m, d] = ymdInZone(harvestMs, timeZone).split('-').map(Number);
  return zonedDayStartMs(y, m, d, timeZone);
}

/** B-28: from the start of the harvest's farm-local day to now plus five
 *  minutes. */
export function dispositionDateProblem(
  occurredAt: number,
  harvestMs: number,
  timeZone: string,
  now: number
): DispositionDateProblem | null {
  if (occurredAt < harvestDayStartMs(harvestMs, timeZone)) {
    return {
      error: 'BEFORE_HARVEST',
      message: 'That date is before this harvest. Pick the day it went, on or after the harvest.'
    };
  }
  if (occurredAt > now + DISPOSITION_FUTURE_SLACK_MS) {
    return {
      error: 'IN_THE_FUTURE',
      message: 'That date is in the future. Pick today or earlier.'
    };
  }
  return null;
}

function sameUnit(a: string | null | undefined, b: string | null | undefined): boolean {
  return !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** B-33: a notice when the dispositions in one unit add up to more than the
 *  harvest's own quantity in that unit. Only when the harvest quantity
 *  parses with that unit; null otherwise. */
export function overQuantityNotice(
  harvestQuantity: string | null | undefined,
  dispositions: ReadonlyArray<{ quantity: number; unit: string }>,
  unit: string
): string | null {
  const parsed = parseHarvestQuantity(harvestQuantity);
  if (!parsed || !sameUnit(parsed.unit, unit)) return null;
  const hundredths = dispositions
    .filter((d) => sameUnit(d.unit, unit))
    .reduce((sum, d) => sum + Math.round(d.quantity * 100), 0);
  if (hundredths <= Math.round(parsed.quantity * 100)) return null;
  return `Where it went adds up to more than this harvest's ${harvestQuantity!.trim()}.`;
}

/** One line per disposition, for the record card and the panel list. */
export function dispositionLine(
  d: Pick<DispositionView, 'kind' | 'quantity' | 'unit' | 'recipient' | 'soldAsOrganic'>,
  dateText: string
): string {
  const qty = `${Number.isInteger(d.quantity) ? d.quantity : d.quantity.toFixed(2)} ${d.unit}`;
  const to = d.recipient ? ` to ${d.recipient}` : '';
  const organic =
    d.kind === 'sold' && d.soldAsOrganic === true
      ? ', sold as organic'
      : d.kind === 'sold' && d.soldAsOrganic === false
        ? ', not sold as organic'
        : '';
  return `${DISPOSITION_KIND_LABEL[d.kind]} ${qty}${to} on ${dateText}${organic}`;
}
