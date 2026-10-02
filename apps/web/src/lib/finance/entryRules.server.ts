/** Server checks every ledger write shares: ids belong to this Owner, a bed
 *  sits inside its Area, and the date is not more than a day ahead. */

import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import type { ZodError } from 'zod';
import { db } from '$lib/db/client';
import { blocks } from '$lib/db/schema';
import { withTenant } from '$lib/db/tenant';
import type { LedgerEntryInput } from '$lib/db/ledger';
import {
  assertAnimalSubject,
  assertBlock,
  assertCrop,
  assertField,
  assertHarvestEvent,
  assertStockLot,
  rejectForeignRefs
} from '$lib/server/foreignRefs';
import { MAX_FUTURE_MS, ledgerEntryProblem } from './apiSchemas';
import { t } from '$lib/i18n';

export function invalidBody(err: ZodError): Response {
  return json(
    {
      error: err.issues[0]?.message ?? 'invalid request',
      issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
    },
    { status: 400 }
  );
}

export async function readBody(
  request: Request
): Promise<{ ok: true; body: unknown } | { ok: false }> {
  try {
    return { ok: true, body: await request.json() };
  } catch {
    return { ok: false };
  }
}

export function checkEntry(
  input: LedgerEntryInput,
  now = Date.now(),
  locale?: string | null
): Response | null {
  const problem = ledgerEntryProblem(input);
  if (problem) return json({ error: problem }, { status: 400 });
  if (input.occurredAt > now + MAX_FUTURE_MS) {
    return json({ error: t(locale, 'finance.err.future'), code: 'IN_THE_FUTURE' }, { status: 400 });
  }
  const foreign = rejectForeignRefs(
    assertCrop('cropId', input.cropId),
    assertField('fieldId', input.fieldId),
    assertBlock('blockId', input.blockId),
    assertAnimalSubject('animalId', 'animal', input.animalId),
    assertAnimalSubject('animalGroupId', 'group', input.animalGroupId),
    assertStockLot('stockLotId', input.stockLotId),
    assertHarvestEvent('harvestEventId', input.harvestEventId)
  );
  if (foreign) return foreign;
  if (input.blockId && input.fieldId) {
    const block = db
      .select({ fieldId: blocks.fieldId })
      .from(blocks)
      .where(withTenant(blocks, eq(blocks.id, input.blockId)))
      .get();
    if (block?.fieldId !== input.fieldId) {
      return json({ error: t(locale, 'finance.err.bedArea') }, { status: 400 });
    }
  }
  return null;
}

export function lotConflict(entryId: string, locale?: string | null): Response {
  return json(
    {
      error: t(locale, 'finance.err.lotExpensed'),
      code: 'LOT_ALREADY_EXPENSED',
      entryId
    },
    { status: 409 }
  );
}

export function parseYear(raw: string | null, fallback: number): number | null {
  if (raw === null || raw === '') return fallback;
  if (!/^\d{4}$/.test(raw)) return null;
  const y = Number(raw);
  return y >= 2000 && y <= 2100 ? y : null;
}
