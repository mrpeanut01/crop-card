import { t } from '$lib/i18n';
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
    return entry
      ? json({ entry })
      : json({ error: t(event.locals?.locale, 'api.err.noSuchEntry') }, { status: 404 });
  } catch (e) {
    if (e instanceof LotAlreadyExpensedError) return lotConflict(e.entryId, event.locals.locale);
    throw e;
  }
};
