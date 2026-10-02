/** /finance/profit/:year: the Season Profit Card (F2-18), owner only.
 *  `/c/pf_<year>` redirects here. */

import { error } from '@sveltejs/kit';
import { t } from '$lib/i18n';
import { eq } from 'drizzle-orm';
import type { PageServerLoad } from './$types';
import { db } from '$lib/db/client';
import { owners } from '$lib/db/schema';
import { unscopedQueryNote } from '$lib/db/tenant';
import { buildProfitCard } from '$lib/cards/build/profit';
import { requireMoneyReader } from '$lib/finance/access';
import { parseYear } from '$lib/finance/entryRules.server';
import { currentSeasonYear, loadSeasonMoney } from '$lib/finance/profit.server';

function farmName(ownerId: string | null): string | null {
  if (!ownerId) return null;
  unscopedQueryNote('the Profit Card title names the active Owner');
  return (
    db.select({ name: owners.name }).from(owners).where(eq(owners.id, ownerId)).get()?.name ?? null
  );
}

export const load: PageServerLoad = async (event) => {
  const user = requireMoneyReader(event);
  const year = parseYear(event.params.year, currentSeasonYear());
  if (year === null) throw error(404, t(event.locals.locale, 'finance.err.noSeason'));
  const money = await loadSeasonMoney(year);
  const card = buildProfitCard(year, money.profit, {
    asOf: Date.now(),
    farmName: farmName(user.activeOwnerId)
  });
  return {
    year,
    card,
    origin: process.env.ORIGIN?.trim().replace(/\/+$/, '') || null,
    print: event.url.searchParams.get('print') === '1'
  };
};
