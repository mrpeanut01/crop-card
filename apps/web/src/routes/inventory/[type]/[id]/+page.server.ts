/**
 * Sprint 7 / Phase 27C (#257) — unified inventory detail loader.
 *
 * Routes:
 *   /inventory/pesticide/<stockItemId>
 *   /inventory/fertility/<stockItemId>
 *   /inventory/seed/<stockItemId>
 *   /inventory/crop/<pluginId>
 *   /inventory/sprayer/<equipmentId>
 *
 * For lot-bearing types (pesticide/fertility/seed) `id` is the
 * stock_item.id; the loader also looks up the bound plugin from the
 * registry when `pluginId` is set so kernel-locked fields render with
 * authoritative data. For crops `id` is the pluginId. For sprayers
 * `id` is the equipment.id.
 *
 * Returns a discriminated payload the page component dispatches on.
 */

import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import {
  getStockItem,
  listLotsForItem,
  listMovementsForItem,
  type LotWithBalance,
  type StockItem,
  type StockMovement
} from '$lib/db/stock';
import { getEquipment, type EquipmentWithState } from '$lib/db/equipment';
import { getRegistry } from '$lib/server/registry';
import { INVENTORY_TYPES, type InventoryType } from '$lib/inventory/types';
import { resolveArchetype } from '$lib/plugins/schemas';

export interface PesticideDetailPayload {
  type: 'pesticide';
  item: StockItem;
  lots: LotWithBalance[];
  movements: StockMovement[];
  plugin?: Record<string, unknown> & {
    pluginId: string;
    displayName: string;
    epaRegistrationNumber?: string;
    reEntryIntervalHours?: number;
    preHarvestIntervalDays?: number;
    activeIngredients?: Array<{ name: string; chemistryClass?: string }>;
    ratePerAcre?: { amount: number; unit: string };
  };
}

export interface FertilityDetailPayload {
  type: 'fertility';
  item: StockItem;
  lots: LotWithBalance[];
  movements: StockMovement[];
  plugin?: Record<string, unknown> & {
    pluginId: string;
    displayName: string;
    analysis?: { n: number; p: number; k: number };
    organic?: boolean;
    applicationRange?: { amount: number; unit: string };
  };
}

export interface SeedDetailPayload {
  type: 'seed';
  item: StockItem;
  lots: LotWithBalance[];
  movements: StockMovement[];
  plugin?: Record<string, unknown> & {
    pluginId: string;
    displayName: string;
    cropFamily?: string;
    daysToMaturity?: { min: number; max: number };
    archetype?: string;
  };
}

export interface CropDetailPayload {
  type: 'crop';
  plugin: Record<string, unknown> & {
    pluginId: string;
    displayName: string;
    cropFamily?: string;
    daysToMaturity?: { min: number; max: number };
    archetype?: string;
    harvestStyle?: string;
    growthStages?: unknown[];
    seasonalTasks?: unknown[];
  };
  /** Output of `resolveArchetype()` so the detail can render the
   *  authoritative archetype even when the plugin file hasn't been
   *  backfilled yet (pre-Sprint-6 plugins, marketplace uploads, etc.). */
  resolvedArchetype: string;
  hash: string;
}

export interface SprayerDetailPayload {
  type: 'sprayer';
  equipment: EquipmentWithState;
}

export type DetailPayload =
  | PesticideDetailPayload
  | FertilityDetailPayload
  | SeedDetailPayload
  | CropDetailPayload
  | SprayerDetailPayload;

function parseType(raw: string): InventoryType {
  if (!(INVENTORY_TYPES as readonly string[]).includes(raw)) {
    throw error(404, `unknown inventory type: ${raw}`);
  }
  return raw as InventoryType;
}

export const load: PageServerLoad = async ({ params }): Promise<DetailPayload> => {
  const type = parseType(params.type);
  const id = params.id;

  if (type === 'sprayer') {
    const equipment = getEquipment(id);
    if (!equipment || equipment.type !== 'sprayer') {
      throw error(404, `sprayer not found: ${id}`);
    }
    return { type: 'sprayer', equipment };
  }

  if (type === 'crop') {
    const registry = await getRegistry();
    const rec = registry.get(id);
    if (!rec || (rec.plugin as { type?: string }).type !== 'crop') {
      throw error(404, `crop plugin not found: ${id}`);
    }
    const p = rec.plugin as CropDetailPayload['plugin'];
    return {
      type: 'crop',
      plugin: p,
      resolvedArchetype: resolveArchetype({
        archetype: p.archetype as never,
        harvestStyle: p.harvestStyle as never,
        cropFamily: p.cropFamily
      }),
      hash: rec.hash
    };
  }

  // Lot-bearing types: pesticide / fertility / seed
  const item = getStockItem(id);
  if (!item) throw error(404, `stock item not found: ${id}`);

  // Filter type/category consistency — refuse to render a fertilizer
  // under /inventory/pesticide/[id].
  if (
    type === 'pesticide' &&
    !(item.category === 'herbicide' || item.category === 'insecticide' || item.category === 'fungicide')
  ) {
    throw error(404, `item ${id} is not a pesticide`);
  }
  if (type === 'fertility' && item.category !== 'fertilizer') {
    throw error(404, `item ${id} is not a fertility product`);
  }
  if (type === 'seed' && item.category !== 'seed') {
    throw error(404, `item ${id} is not a seed`);
  }

  const lots = listLotsForItem(id);
  const movements = listMovementsForItem(id, 25);

  let plugin: Record<string, unknown> | undefined;
  if (item.pluginId) {
    const registry = await getRegistry();
    const rec = registry.get(item.pluginId);
    plugin = rec?.plugin as Record<string, unknown> | undefined;
  }

  if (type === 'pesticide') {
    return { type, item, lots, movements, plugin: plugin as PesticideDetailPayload['plugin'] };
  }
  if (type === 'fertility') {
    return { type, item, lots, movements, plugin: plugin as FertilityDetailPayload['plugin'] };
  }
  return { type, item, lots, movements, plugin: plugin as SeedDetailPayload['plugin'] };
};
