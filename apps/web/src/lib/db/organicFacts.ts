/**
 * 33B (B-41, B-45) reads behind the organic facts per block: fertility
 * applications in a window and plantings from a seed lot recorded as
 * treated. Tenant-scoped; the projection lives in
 * `$lib/organic/blockFacts.server`.
 */

import { and, eq, gte, inArray, lte } from 'drizzle-orm';
import { db } from './client';
import {
  crops,
  fertilityApplications,
  seedStarts,
  stockItems,
  stockLots,
  stockMovements
} from './schema';
import { withTenant } from './tenant';

export interface FertilityFactRow {
  id: string;
  blockId: string;
  occurredAt: number;
  source: string;
  stockItemId: string | null;
  stockItemName: string | null;
  stockPluginId: string | null;
}

export function listFertilityApplicationsInWindow(window: {
  fromMs: number;
  toMs: number;
}): FertilityFactRow[] {
  const rows = db
    .select({
      id: fertilityApplications.id,
      blockId: fertilityApplications.blockId,
      occurredAt: fertilityApplications.occurredAt,
      source: fertilityApplications.source,
      stockItemId: fertilityApplications.stockItemId
    })
    .from(fertilityApplications)
    .where(
      withTenant(
        fertilityApplications,
        gte(fertilityApplications.occurredAt, new Date(window.fromMs)),
        lte(fertilityApplications.occurredAt, new Date(window.toMs))
      )
    )
    .all();
  const itemIds = [...new Set(rows.map((r) => r.stockItemId).filter((x): x is string => !!x))];
  const items = new Map(
    (itemIds.length
      ? db
          .select({
            id: stockItems.id,
            pluginId: stockItems.pluginId,
            displayName: stockItems.displayName
          })
          .from(stockItems)
          .where(withTenant(stockItems, inArray(stockItems.id, itemIds)))
          .all()
      : []
    ).map((i) => [i.id, i])
  );
  return rows.map((r) => {
    const item = r.stockItemId ? items.get(r.stockItemId) : undefined;
    return {
      id: r.id,
      blockId: r.blockId,
      occurredAt: r.occurredAt.getTime(),
      source: r.source,
      stockItemId: r.stockItemId ?? null,
      stockItemName: item?.displayName ?? null,
      stockPluginId: item?.pluginId ?? null
    };
  });
}

export interface TreatedSeedPlantingRow {
  blockId: string;
  cropId: string;
  stockLotId: string;
  at: number;
}

/** B-41: a `planting` stock movement with a crop, or a seed start with a
 *  lot, whose lot is recorded as `treated`. */
export function listTreatedSeedPlantings(window: {
  fromMs: number;
  toMs: number;
}): TreatedSeedPlantingRow[] {
  const treatedLots = db
    .select({ id: stockLots.id })
    .from(stockLots)
    .where(withTenant(stockLots, eq(stockLots.seedOrganicStatus, 'treated')))
    .all()
    .map((r) => r.id);
  if (treatedLots.length === 0) return [];
  const moves = db
    .select({
      cropId: stockMovements.cropId,
      stockLotId: stockMovements.stockLotId,
      occurredAt: stockMovements.occurredAt
    })
    .from(stockMovements)
    .where(
      withTenant(
        stockMovements,
        and(
          eq(stockMovements.reason, 'planting'),
          inArray(stockMovements.stockLotId, treatedLots),
          gte(stockMovements.occurredAt, new Date(window.fromMs)),
          lte(stockMovements.occurredAt, new Date(window.toMs))
        )
      )
    )
    .all()
    .filter((m): m is typeof m & { cropId: string } => !!m.cropId)
    .map((m) => ({ cropId: m.cropId, stockLotId: m.stockLotId, at: m.occurredAt.getTime() }));
  const starts = db
    .select({
      cropId: seedStarts.cropId,
      stockLotId: seedStarts.stockLotId,
      sownAt: seedStarts.sownAt
    })
    .from(seedStarts)
    .where(
      withTenant(
        seedStarts,
        and(
          inArray(seedStarts.stockLotId, treatedLots),
          gte(seedStarts.sownAt, new Date(window.fromMs)),
          lte(seedStarts.sownAt, new Date(window.toMs))
        )
      )
    )
    .all()
    .filter((s): s is typeof s & { stockLotId: string } => !!s.stockLotId)
    .map((s) => ({ cropId: s.cropId, stockLotId: s.stockLotId, at: s.sownAt.getTime() }));
  const all = [...moves, ...starts];
  const cropIds = [...new Set(all.map((p) => p.cropId))];
  if (cropIds.length === 0) return [];
  const blockOf = new Map(
    db
      .select({ id: crops.id, blockId: crops.blockId })
      .from(crops)
      .where(withTenant(crops, inArray(crops.id, cropIds)))
      .all()
      .map((c) => [c.id, c.blockId])
  );
  return all
    .filter((p) => blockOf.get(p.cropId))
    .map((p) => ({ ...p, blockId: blockOf.get(p.cropId)! }))
    .sort((a, b) => a.at - b.at);
}
