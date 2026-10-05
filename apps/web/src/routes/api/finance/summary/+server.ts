import { t } from '$lib/i18n';
/** GET /api/finance/summary?year=: season profit per enterprise (F2-12).
 *  Owner only. Derived costs and labour are never part of `cash`. */

import { json, type RequestHandler } from '@sveltejs/kit';
import { requireMoneyReader } from '$lib/finance/access';
import { parseYear } from '$lib/finance/entryRules.server';
import { currentSeasonYear, loadSeasonMoney } from '$lib/finance/profit.server';

export const GET: RequestHandler = async (event) => {
  requireMoneyReader(event);
  const year = parseYear(event.url.searchParams.get('year'), currentSeasonYear());
  if (year === null)
    return json({ error: t(event.locals?.locale, 'api.err.yearFourDigits') }, { status: 400 });
  const money = await loadSeasonMoney(year);
  return json({ year, profit: money.profit });
};
