/**
 * POST /api/stock/:id/set-quantity — owner-only manual on-hand override.
 *
 * Use case: end-of-season physical count, audit reconciliation. Posts a
 * single adjustment movement against the most-recently-received lot (or
 * creates a fresh lot if none exists yet).
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { getStockItem, setOnHandQuantity } from '$lib/db/stock';
import { requireOwner } from '$lib/server/auth';

const schema = z.object({
  quantity: z.number().nonnegative(),
  notes: z.string().max(500).optional()
});

export const POST: RequestHandler = async (event) => {
  const user = requireOwner(event);
  if (!event.params.id || !getStockItem(event.params.id)) {
    return json({ error: 'unknown stock item' }, { status: 404 });
  }
  let body: unknown;
  try {
    body = await event.request.json();
  } catch {
    return json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return json({ error: 'invalid request', issues: parsed.error.issues }, { status: 400 });
  }
  try {
    const result = setOnHandQuantity({
      stockItemId: event.params.id,
      targetQuantity: parsed.data.quantity,
      notes: parsed.data.notes,
      performedById: user.id
    });
    return json({ result }, { status: 200 });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
};
