/**
 * POST /api/stock/movements — owner-only manual adjustment to an existing lot.
 *
 * Use cases: spill, end-of-season audit reconciliation, reverse a mistaken
 * spray-event decrement. Use a positive `delta` to add stock, negative to
 * subtract. The reason determines the audit-trail label.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { IncompatibleUnitError, recordMovement, type MovementReason } from '$lib/db/stock';
import { ALL_STOCK_UNITS, type StockUnit } from '$lib/stock/units';
import { requireOwner } from '$lib/server/auth';

const REASONS: MovementReason[] = ['adjustment', 'spill', 'expiry'];

const schema = z.object({
  stockLotId: z.string().min(1),
  delta: z.number(),
  unit: z.enum(ALL_STOCK_UNITS as unknown as [StockUnit, ...StockUnit[]]),
  reason: z.enum(REASONS as [MovementReason, ...MovementReason[]]),
  notes: z.string().max(500).optional()
});

export const POST: RequestHandler = async (event) => {
  const user = requireOwner(event);
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
    const movement = recordMovement({ ...parsed.data, performedById: user.id });
    return json({ movement }, { status: 201 });
  } catch (e) {
    if (e instanceof IncompatibleUnitError) {
      return json({ error: e.message }, { status: 400 });
    }
    if (e instanceof Error && /unknown lot/i.test(e.message)) {
      return json({ error: e.message }, { status: 404 });
    }
    throw e;
  }
};
