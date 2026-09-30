/**
 * /finance: the owner's money for one season (Phase 32F, F2). Owner only;
 * helpers, custom operators and inspectors get 403 (F2-1). Impersonation
 * reads and never writes.
 */

import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { listLedgerEntries } from '$lib/db/ledger';
import { requireMoneyReader } from '$lib/finance/access';
import { parseYear } from '$lib/finance/entryRules.server';
import {
  currentSeasonYear,
  loadSeasonMoney,
  presentEntries,
  readLabourRate
} from '$lib/finance/profit.server';
import { farmTimeZone } from '$lib/db/userProfile';

export const load: PageServerLoad = async (event) => {
  const user = requireMoneyReader(event);
  const thisYear = currentSeasonYear();
  const year = parseYear(event.url.searchParams.get('year'), thisYear);
  if (year === null) throw error(400, 'year must be a four-digit year');
  const showDeleted = event.url.searchParams.get('show') === 'deleted';

  const money = await loadSeasonMoney(year);
  const rows = showDeleted
    ? listLedgerEntries({ fromMs: money.fromMs, toMs: money.toMs, state: 'deleted' })
    : money.entries;

  const years = [...new Set([thisYear + 1, thisYear, thisYear - 1, thisYear - 2, year])].sort(
    (a, b) => b - a
  );

  return {
    year,
    years,
    showDeleted,
    entries: presentEntries(rows, money.names),
    profit: money.profit,
    labourRateCents: readLabourRate(),
    canWrite: !user.impersonating,
    timeZone: farmTimeZone()
  };
};
