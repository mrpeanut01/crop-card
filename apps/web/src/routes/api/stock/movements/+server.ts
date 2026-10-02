/**
 * POST /api/stock/movements — owner-only manual adjustment to an existing lot.
 *
 * Use cases: spill, end-of-season audit reconciliation, reverse a mistaken
 * spray-event decrement. Use a positive `delta` to add stock, negative to
 * subtract. The reason determines the audit-trail label.
 */

import { t } from '$lib/i18n';
import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import {
  IncompatibleUnitError,
  LotStatusError,
  recordMovement,
  type MovementReason
} from '$lib/db/stock';
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
    return json({ error: t(event.locals?.locale, 'stockui.api.invalidJson') }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return json(
      { error: t(event.locals?.locale, 'stockui.api.invalidRequest'), issues: parsed.error.issues },
      { status: 400 }
    );
  }
  try {
    const movement = recordMovement({ ...parsed.data, performedById: user.id });
    return json({ movement }, { status: 201 });
  } catch (e) {
    if (e instanceof LotStatusError) {
      return json({ error: e.message }, { status: 409 });
    }
    if (e instanceof IncompatibleUnitError) {
      return json({ error: e.message }, { status: 400 });
    }
    if (e instanceof Error && /unknown lot/i.test(e.message)) {
      return json({ error: e.message }, { status: 404 });
    }
    throw e;
  }
};
