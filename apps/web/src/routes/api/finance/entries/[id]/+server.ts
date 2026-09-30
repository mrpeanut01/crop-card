/**
 * GET    /api/finance/entries/:id: one entry and its change history.
 * PATCH  /api/finance/entries/:id: change it. No lock (OPS-9).
 * DELETE /api/finance/entries/:id: soft delete; restore brings it back.
 * Owner only (F2-1); never gated by the season close-out (F0-5).
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import {
  entryToInput,
  getLedgerEntry,
  listLedgerChanges,
  LotAlreadyExpensedError,
  softDeleteLedgerEntry,
  updateLedgerEntry
} from '$lib/db/ledger';
import { ledgerEntryPatchSchema } from '$lib/finance/apiSchemas';
import { requireMoneyReader, requireMoneyWriter } from '$lib/finance/access';
import { checkEntry, invalidBody, lotConflict, readBody } from '$lib/finance/entryRules.server';
import { farmNames, presentEntries } from '$lib/finance/profit.server';

export const _requestSchema = ledgerEntryPatchSchema;

const notFound = () => json({ error: 'No such entry.' }, { status: 404 });

export const GET: RequestHandler = async (event) => {
  requireMoneyReader(event);
  const entry = getLedgerEntry(event.params.id!);
  if (!entry) return notFound();
  const [presented] = presentEntries([entry], await farmNames());
  return json({ entry: presented, changes: listLedgerChanges(entry.id) });
};

export const PATCH: RequestHandler = async (event) => {
  const user = requireMoneyWriter(event);
  const current = getLedgerEntry(event.params.id!);
  if (!current) return notFound();
  const read = await readBody(event.request);
  if (!read.ok) return json({ error: 'invalid JSON body' }, { status: 400 });
  const parsed = ledgerEntryPatchSchema.safeParse(read.body);
  if (!parsed.success) return invalidBody(parsed.error);
  const patch = Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined));
  const next = { ...entryToInput(current), ...patch };
  const refused = checkEntry(next);
  if (refused) return refused;
  try {
    const entry = updateLedgerEntry(current.id, next, user.id);
    return entry ? json({ entry }) : notFound();
  } catch (e) {
    if (e instanceof LotAlreadyExpensedError) return lotConflict(e.entryId);
    throw e;
  }
};

export const DELETE: RequestHandler = (event) => {
  const user = requireMoneyWriter(event);
  const entry = softDeleteLedgerEntry(event.params.id!, user.id);
  return entry ? json({ entry }) : notFound();
};
