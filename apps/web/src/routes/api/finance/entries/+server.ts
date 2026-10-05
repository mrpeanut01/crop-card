import { t } from '$lib/i18n';
/**
 * GET  /api/finance/entries?year=&state=live|deleted: the season's ledger.
 * POST /api/finance/entries: add an expense or income.
 * Owner only (F2-1); never gated by the season close-out (F0-5).
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { insertLedgerEntry, listLedgerEntries, LotAlreadyExpensedError } from '$lib/db/ledger';
import { db } from '$lib/db/client';
import { linkNewSaleToDisposition } from '$lib/db/harvestDispositions';
import { ledgerEntryCreateSchema } from '$lib/finance/apiSchemas';
import { requireMoneyReader, requireMoneyWriter } from '$lib/finance/access';
import {
  checkEntry,
  invalidBody,
  lotConflict,
  parseYear,
  readBody
} from '$lib/finance/entryRules.server';
import {
  currentSeasonYear,
  farmNames,
  presentEntries,
  seasonBounds
} from '$lib/finance/profit.server';

export const _requestSchema = ledgerEntryCreateSchema;

export const GET: RequestHandler = async (event) => {
  requireMoneyReader(event);
  const year = parseYear(event.url.searchParams.get('year'), currentSeasonYear());
  if (year === null)
    return json({ error: t(event.locals?.locale, 'api.err.yearFourDigits') }, { status: 400 });
  const stateParam = event.url.searchParams.get('state') ?? 'live';
  if (stateParam !== 'live' && stateParam !== 'deleted') {
    return json({ error: t(event.locals?.locale, 'api.err.stateLiveDeleted') }, { status: 400 });
  }
  const { fromMs, toMs } = seasonBounds(year);
  const entries = listLedgerEntries({ fromMs, toMs, state: stateParam });
  return json({ year, entries: presentEntries(entries, await farmNames()) });
};

export const POST: RequestHandler = async (event) => {
  const user = requireMoneyWriter(event);
  const read = await readBody(event.request);
  if (!read.ok)
    return json({ error: t(event.locals?.locale, 'stockui.api.invalidJson') }, { status: 400 });
  const parsed = ledgerEntryCreateSchema.safeParse(read.body);
  if (!parsed.success) return invalidBody(parsed.error);
  const refused = checkEntry(parsed.data, Date.now(), event.locals.locale);
  if (refused) return refused;
  const { dispositionId, ...input } = parsed.data;
  try {
    const { entry, dispositionLinked } = db.transaction(() => {
      const entry = insertLedgerEntry(input, user.id);
      const dispositionLinked =
        !!dispositionId &&
        !!input.harvestEventId &&
        linkNewSaleToDisposition(dispositionId, input.harvestEventId, entry.id);
      return { entry, dispositionLinked };
    });
    return json({ entry, dispositionLinked }, { status: 201 });
  } catch (e) {
    if (e instanceof LotAlreadyExpensedError) return lotConflict(e.entryId, event.locals.locale);
    throw e;
  }
};
