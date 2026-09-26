import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { addPlanting, getBlock } from '$lib/db/blocks';
import { requireOwner } from '$lib/server/auth';
import { getRegistry } from '$lib/server/registry';
import {
  IncompatibleUnitError,
  createStockItem,
  decrementForUse,
  getStockItem,
  receiveLot
} from '$lib/db/stock';
import { ALL_STOCK_UNITS, type StockUnit } from '$lib/stock/units';

const stockUnit = z.enum(ALL_STOCK_UNITS as unknown as [StockUnit, ...StockUnit[]]);

const plantingSchema = z.object({
  cropPluginId: z.string().min(1),
  varietyDisplayName: z.string().min(1).max(160).optional(),
  plantingDate: z.number().int().nullable().optional(),
  quantityPlanted: z.number().nonnegative().optional(),
  quantityUnit: z.string().min(1).max(16).optional(),
  /** Phase 14c: when the planting was sourced from a specific seed stock
   *  entry (manual drag-drop on /plan?tab=crops), pass it so we decrement
   *  on-hand FIFO and link the stock movement to the new crop. */
  stockItemId: z.string().min(1).optional(),
  /** Sprint 3 (#212 / CT-PP-004) — wizard-driven commits send `'ai'` or
   *  `'fallback'` so PlantingCard renders the correct source badge.
   *  Manual drag-drop omits this and the column stays NULL. */
  sourceProvenance: z.enum(['ai', 'fallback']).optional(),
  /** Seed bought for this planting when none was on hand. Creates the seed
   *  SKU + a received lot, then the planted amount comes out of it. */
  purchase: z.object({ quantity: z.number().positive(), unit: stockUnit }).optional()
});

export const POST: RequestHandler = async (event) => {
  const user = requireOwner(event);

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
  if (parsed.data.purchase && parsed.data.stockItemId) {
    return json(
      { error: 'send either stockItemId (seed on hand) or purchase (newly bought), not both' },
      { status: 400 }
    );
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
    quantityUnit: parsed.data.quantityUnit,
    sourceProvenance: parsed.data.sourceProvenance
  });

  let stockItemId = parsed.data.stockItemId;
  let purchased: { stockItemId: string } | undefined;
  if (parsed.data.purchase) {
    const item = createStockItem({
      category: 'seed',
      displayName: planting.varietyDisplayName,
      defaultUnit: parsed.data.purchase.unit,
      pluginId: parsed.data.cropPluginId
    });
    receiveLot({
      stockItemId: item.id,
      receivedQuantity: parsed.data.purchase.quantity,
      unit: parsed.data.purchase.unit,
      performedById: user.id
    });
    stockItemId = item.id;
    purchased = { stockItemId: item.id };
  }

  // Decrement seed stock if a stock item + quantity were supplied. FIFO
  // across lots; shortfall does not fail the request — the planting is
  // already persisted.
  let decrement: { fulfilled: number; shortfall: number } | undefined;
  if (
    stockItemId &&
    parsed.data.quantityPlanted !== undefined &&
    parsed.data.quantityPlanted > 0 &&
    parsed.data.quantityUnit
  ) {
    const item = getStockItem(stockItemId);
    const unitOk = (ALL_STOCK_UNITS as ReadonlyArray<string>).includes(parsed.data.quantityUnit);
    if (item && !unitOk) {
      decrement = { fulfilled: 0, shortfall: parsed.data.quantityPlanted };
    } else if (item) {
      try {
        const result = decrementForUse({
          stockItemId,
          amount: parsed.data.quantityPlanted,
          unit: parsed.data.quantityUnit as StockUnit,
          cropId: planting.id,
          reason: 'planting',
          performedById: user.id
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

  return json({ planting, decrement, purchased }, { status: 201 });
};
