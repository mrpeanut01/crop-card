/** Server side of the disposition endpoints and the /harvest panel. */

import { json } from '@sveltejs/kit';
import { getLedgerEntry } from '$lib/db/ledger';
import {
  evaluateDispositionLock,
  listDispositionsForHarvests,
  type HarvestDisposition
} from '$lib/db/harvestDispositions';
import type { HarvestEvent } from '$lib/db/harvestEvents';
import { formatInstant, type Prefs } from '$lib/prefs';
import { overQuantityNotice, type DispositionView } from '$lib/harvest/dispositions';
import { soldAsOrganicNotice } from '$lib/harvest/organicAtHarvest.server';
import type { AuthenticatedUser } from './auth';

export function problem(status: number, error: string, message: string): Response {
  return json({ error, message }, { status });
}

/** A disposition as a viewer may see it: the ledger link is money and stays
 *  with the owner (F2-1, B-31). Stamps the lock on first read past it. */
export function presentDisposition(
  d: HarvestDisposition,
  role: AuthenticatedUser['role'] | undefined,
  now: number = Date.now()
): DispositionView {
  const owner = role === 'owner';
  const ledger = owner && d.ledgerEntryId ? getLedgerEntry(d.ledgerEntryId) : undefined;
  return {
    id: d.id,
    harvestEventId: d.harvestEventId,
    kind: d.kind,
    quantity: d.quantity,
    unit: d.unit,
    occurredAt: d.occurredAt,
    recipient: d.recipient,
    soldAsOrganic: d.soldAsOrganic,
    ledgerEntryId: owner ? d.ledgerEntryId : null,
    sale: !owner || !d.ledgerEntryId ? null : ledger && !ledger.deletedAt ? 'live' : 'deleted',
    locked: evaluateDispositionLock(d, now) !== undefined,
    createdAt: d.createdAt
  };
}

export function dispositionViewsFor(
  harvestIds: readonly string[],
  role: AuthenticatedUser['role'] | undefined
): Record<string, DispositionView[]> {
  const out: Record<string, DispositionView[]> = {};
  const now = Date.now();
  for (const [id, list] of listDispositionsForHarvests(harvestIds)) {
    out[id] = list.map((d) => presentDisposition(d, role, now));
  }
  return out;
}

/** The two save-time notices (B-32, B-33). Neither blocks the save. */
export function dispositionNotices(
  harvest: HarvestEvent,
  saved: HarvestDisposition,
  prefs: Prefs
): { organicNotice: string | null; quantityNotice: string | null } {
  const fmtDate = (ms: number) => formatInstant(ms, prefs, 'date');
  const organicNotice =
    saved.kind === 'sold' && saved.soldAsOrganic === true
      ? soldAsOrganicNotice(harvest.blockId, harvest.occurredAt, fmtDate, prefs.locale)
      : null;
  const all = listDispositionsForHarvests([harvest.id]).get(harvest.id) ?? [];
  return {
    organicNotice,
    quantityNotice: overQuantityNotice(harvest.quantity, all, saved.unit, prefs.locale)
  };
}
