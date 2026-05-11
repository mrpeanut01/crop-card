import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { addPlanting, getBlock } from '$lib/db/blocks';
import { requireOwner } from '$lib/server/auth';
import { getRegistry } from '$lib/server/registry';
import { IncompatibleUnitError, decrementForUse, getStockItem } from '$lib/db/stock';
import type { StockUnit } from '$lib/stock/units';

const plantingSchema = z.object({
  cropPluginId: z.string().min(1),
  varietyDisplayName: z.string().min(1).max(160).optional(),
  plantingDate: z.number().int().nullable().optional(),
  quantityPlanted: z.number().nonnegative().optional(),
  quantityUnit: z.string().min(1).max(16).optional(),
  /** Phase 14c: when the planting was sourced from a specific seed stock
   *  entry (manual drag-drop on /plan?tab=crops), pass it so we decrement
   *  on-hand FIFO and link the stock movement to the new crop. */
  stockItemId: z.string().min(1).optional()
});

export const POST: RequestHandler = async (event) => {
  requireOwner(event);

  const blockId = event.params.id;
  if (!blockId || !getBlock(blockId)) {
    return json({ error: 'unknown block' }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await event.request.json();
  } catch {
    return json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const parsed = plantingSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: 'invalid request', issues: parsed.error.issues }, { status: 400 });
  }

  const registry = await getRegistry();
  const plugin = registry.get(parsed.data.cropPluginId);
  if (!plugin || plugin.plugin.type !== 'crop') {
    return json({ error: 'unknown crop plugin' }, { status: 404 });
  }

  const planting = addPlanting({
    blockId,
    cropPluginId: parsed.data.cropPluginId,
    varietyDisplayName: parsed.data.varietyDisplayName ?? plugin.plugin.displayName,
    plantingDate: parsed.data.plantingDate ?? null,
    quantityPlanted: parsed.data.quantityPlanted,
    quantityUnit: parsed.data.quantityUnit
  });

  // Decrement seed stock if a stock item + quantity were supplied (manual
  // drag-drop flow on /plan?tab=crops). FIFO across lots; shortfall does not
  // fail the request — the planting is already persisted.
  let decrement: { fulfilled: number; shortfall: number } | undefined;
  if (
    parsed.data.stockItemId &&
    parsed.data.quantityPlanted !== undefined &&
    parsed.data.quantityPlanted > 0 &&
    parsed.data.quantityUnit
  ) {
    const item = getStockItem(parsed.data.stockItemId);
    if (item) {
      try {
        const result = decrementForUse({
          stockItemId: parsed.data.stockItemId,
          amount: parsed.data.quantityPlanted,
          unit: parsed.data.quantityUnit as StockUnit,
          cropId: planting.id,
          reason: 'planting'
        });
        decrement = { fulfilled: result.fulfilled, shortfall: result.shortfall };
      } catch (err) {
        if (err instanceof IncompatibleUnitError) {
          decrement = { fulfilled: 0, shortfall: parsed.data.quantityPlanted };
        } else {
          throw err;
        }
      }
    }
  }

  return json({ planting, decrement }, { status: 201 });
};
