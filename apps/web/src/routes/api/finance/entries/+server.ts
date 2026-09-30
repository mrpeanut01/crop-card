/**
 * GET  /api/finance/entries?year=&state=live|deleted: the season's ledger.
 * POST /api/finance/entries: add an expense or income.
 * Owner only (F2-1); never gated by the season close-out (F0-5).
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { insertLedgerEntry, listLedgerEntries, LotAlreadyExpensedError } from '$lib/db/ledger';
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
  if (year === null) return json({ error: 'year must be a four-digit year' }, { status: 400 });
  const stateParam = event.url.searchParams.get('state') ?? 'live';
  if (stateParam !== 'live' && stateParam !== 'deleted') {
    return json({ error: 'state must be live or deleted' }, { status: 400 });
  }
  const { fromMs, toMs } = seasonBounds(year);
  const entries = listLedgerEntries({ fromMs, toMs, state: stateParam });
  return json({ year, entries: presentEntries(entries, await farmNames()) });
};

export const POST: RequestHandler = async (event) => {
  const user = requireMoneyWriter(event);
  const read = await readBody(event.request);
  if (!read.ok) return json({ error: 'invalid JSON body' }, { status: 400 });
  const parsed = ledgerEntryCreateSchema.safeParse(read.body);
  if (!parsed.success) return invalidBody(parsed.error);
  const refused = checkEntry(parsed.data);
  if (refused) return refused;
  try {
    const entry = insertLedgerEntry(parsed.data, user.id);
    return json({ entry }, { status: 201 });
  } catch (e) {
    if (e instanceof LotAlreadyExpensedError) return lotConflict(e.entryId);
    throw e;
  }
};
