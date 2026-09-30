/** POST /api/finance/entries/:id/restore: bring back a deleted entry.
 *  Owner only (F2-1); never gated by the season close-out (F0-5). */

import { json, type RequestHandler } from '@sveltejs/kit';
import { LotAlreadyExpensedError, restoreLedgerEntry } from '$lib/db/ledger';
import { requireMoneyWriter } from '$lib/finance/access';
import { lotConflict } from '$lib/finance/entryRules.server';

export const POST: RequestHandler = (event) => {
  const user = requireMoneyWriter(event);
  try {
    const entry = restoreLedgerEntry(event.params.id!, user.id);
    return entry ? json({ entry }) : json({ error: 'No such entry.' }, { status: 404 });
  } catch (e) {
    if (e instanceof LotAlreadyExpensedError) return lotConflict(e.entryId);
    throw e;
  }
};
