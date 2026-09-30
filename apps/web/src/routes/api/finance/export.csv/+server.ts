/** GET /api/finance/export.csv?year=: the season's live entries as CSV
 *  (F2-16). Owner only. Derived costs and labour are not rows. */

import { json, type RequestHandler } from '@sveltejs/kit';
import { requireMoneyReader } from '$lib/finance/access';
import { ledgerCsv } from '$lib/finance/csv';
import { parseYear } from '$lib/finance/entryRules.server';
import {
  currentSeasonYear,
  farmNames,
  presentEntries,
  seasonBounds
} from '$lib/finance/profit.server';
import { listLedgerEntries } from '$lib/db/ledger';
import { farmTimeZone } from '$lib/db/userProfile';
import { ymdInZone } from '$lib/prefs';

export const GET: RequestHandler = async (event) => {
  requireMoneyReader(event);
  const year = parseYear(event.url.searchParams.get('year'), currentSeasonYear());
  if (year === null) return json({ error: 'year must be a four-digit year' }, { status: 400 });
  const { fromMs, toMs } = seasonBounds(year);
  const tz = farmTimeZone();
  const entries = presentEntries(
    listLedgerEntries({ fromMs, toMs, state: 'live' }).reverse(),
    await farmNames()
  );
  const csv = ledgerCsv(
    entries.map((e) => ({
      date: ymdInZone(e.occurredAt, tz),
      kind: e.kind,
      category: e.category,
      amountCents: e.amountCents,
      description: e.description,
      linkedTo: e.linkedTo,
      enterprise: e.enterpriseLabel,
      quantity: e.quantity,
      unit: e.unit,
      enteredBy: e.enteredBy
    }))
  );
  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="cropcard-money-${year}.csv"`,
      'cache-control': 'no-store'
    }
  });
};
