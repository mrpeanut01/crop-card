/**
 * POST /api/stock/:id/set-quantity — owner-only manual on-hand override.
 *
 * Use case: end-of-season physical count, audit reconciliation. Posts a
 * single adjustment movement against the most-recently-received lot (or
 * creates a fresh lot if none exists yet). An optional `base.onHand` is the
 * quantity the device showed; when on hand has moved to a third value since,
 * nothing is saved and the answer is 409 `EDIT_CONFLICT`.
 */

import { t } from '$lib/i18n';
import { json, type RequestHandler } from '@sveltejs/kit';
import { getStockItem, onHandQuantity, setOnHandQuantity } from '$lib/db/stock';
import { requireOwner } from '$lib/server/auth';
import { setQuantitySchema } from '$lib/stock/apiSchemas';
import { fromHundredths, toHundredths } from '$lib/stock/units';
import { editConflictResponse, runCheckedEdit, stockEditValues } from '$lib/server/editConflict';

export const _requestSchema = setQuantitySchema;

class SetQuantityFailed extends Error {}

export const POST: RequestHandler = async (event) => {
  const user = requireOwner(event);
  const id = event.params.id;
  if (!id || !getStockItem(id)) {
    return json({ error: t(event.locals?.locale, 'stockui.api.unknownItem') }, { status: 404 });
  }
  let body: unknown;
  try {
    body = await event.request.json();
  } catch {
    return json({ error: t(event.locals?.locale, 'stockui.api.invalidJson') }, { status: 400 });
  }
  const parsed = setQuantitySchema.safeParse(body);
  if (!parsed.success) {
    return json(
      { error: t(event.locals?.locale, 'stockui.api.invalidRequest'), issues: parsed.error.issues },
      { status: 400 }
    );
  }
  const baseOnHand = parsed.data.base?.onHand;
  try {
    const out = runCheckedEdit(event, {
      target: 'stock',
      id,
      action: 'set-quantity',
      base:
        baseOnHand === undefined
          ? undefined
          : { onHand: baseOnHand === null ? null : fromHundredths(toHundredths(baseOnHand)) },
      mine: { onHand: parsed.data.quantity },
      locale: event.locals?.locale,
      read: () => (getStockItem(id) ? onHandQuantity(id) : undefined),
      values: stockEditValues,
      write: () => {
        try {
          return setOnHandQuantity({
            stockItemId: id,
            targetQuantity: parsed.data.quantity,
            notes: parsed.data.notes,
            performedById: user.id
          });
        } catch (e) {
          throw new SetQuantityFailed(e instanceof Error ? e.message : String(e));
        }
      }
    });
    if (!out.ok) {
      if (out.status === 409) return editConflictResponse(out.body);
      return json({ error: t(event.locals?.locale, 'stockui.api.unknownItem') }, { status: 404 });
    }
    return json({ result: out.value }, { status: 200 });
  } catch (e) {
    if (e instanceof SetQuantityFailed) return json({ error: e.message }, { status: 400 });
    throw e;
  }
};
