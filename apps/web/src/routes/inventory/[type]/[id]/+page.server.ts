/**
 * Sprint 7 / Phase 27C (#257) — unified inventory detail loader.
 *
 * Routes:
 *   /inventory/pesticide/<stockItemId>
 *   /inventory/fertility/<stockItemId>
 *   /inventory/seed/<stockItemId>
 *   /inventory/crop/<pluginId>
 *   /inventory/feed/<stockItemId>
 *   /inventory/animal-health/<stockItemId | animal-health pluginId>
 *
 * /inventory/sprayer/<equipmentId> 308s to /equipment/<id> (#474).
 *
 * For lot-bearing types (pesticide/fertility/seed) `id` is the
 * stock_item.id; the loader also looks up the bound plugin from the
 * registry when `pluginId` is set so kernel-locked fields render with
 * authoritative data. For crops `id` is the pluginId.
 *
 * Returns a discriminated payload the page component dispatches on.
 */

import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import {
  getStockItem,
  listLotsForItem,
  listMovementsForItem,
  type LotWithBalance,
  type StockItem,
  type StockMovement
} from '$lib/db/stock';
import { getDataKinds, getRegistry } from '$lib/server/registry';
import { INVENTORY_TYPES, type InventoryType } from '$lib/inventory/types';
import { resolveArchetype, type AnimalHealthPlugin } from '$lib/plugins/schemas';
import { listAnimals } from '$lib/db/animals';
import { listAnimalGroups } from '$lib/db/animalGroups';
import { canMutate } from '$lib/server/session';
import {
  animalHealthMeta,
  feedMeta,
  isFeedCategory,
  onHandLb,
  type AnimalHealthMeta,
  type FeedMeta
} from '$lib/stock/animalStock';
import { getStockItemWithBalance } from '$lib/db/stock';
import { lotsForRole } from '$lib/finance/redact';

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

export interface FeedSubject {
  type: 'animal' | 'group';
  id: string;
  label: string;
}

export interface FeedDetailPayload {
  type: 'feed';
  item: StockItem;
  lots: LotWithBalance[];
  movements: StockMovement[];
  feed: FeedMeta;
  onHand: number;
  onHandLb: number | null;
  subjects: FeedSubject[];
  canUse: boolean;
  canEdit: boolean;
}

export interface AnimalHealthDetailPayload {
  type: 'animal-health';
  /** Absent when the page shows a library product (Catalog). */
  item?: StockItem;
  lots: LotWithBalance[];
  movements: StockMovement[];
  meta: AnimalHealthMeta;
  plugin?: AnimalHealthPlugin;
  speciesNames: Record<string, string>;
  canEdit: boolean;
}

export type DetailPayload =
  | PesticideDetailPayload
  | FertilityDetailPayload
  | SeedDetailPayload
  | CropDetailPayload
  | FeedDetailPayload
  | AnimalHealthDetailPayload;

function parseType(raw: string): InventoryType {
  if (!(INVENTORY_TYPES as readonly string[]).includes(raw)) {
    throw error(404, `unknown inventory type: ${raw}`);
  }
  return raw as InventoryType;
}

function feedSubjects(): FeedSubject[] {
  const groups = listAnimalGroups().map((g) => ({
    type: 'group' as const,
    id: g.id,
    label: g.name
  }));
  const animals = listAnimals()
    .filter((a) => !a.groupId)
    .map((a) => ({
      type: 'animal' as const,
      id: a.id,
      label: a.name ?? a.tag ?? 'Unnamed animal'
    }));
  return [...groups, ...animals].sort((a, b) => a.label.localeCompare(b.label));
}

async function animalHealthPayload(
  id: string,
  role: string | undefined
): Promise<AnimalHealthDetailPayload> {
  const kinds = await getDataKinds();
  const speciesNames = Object.fromEntries(
    kinds.species.all().map((sp) => [sp.pluginId, sp.displayName])
  );
  const canEdit = role === 'owner';
  const item = getStockItem(id);
  if (item) {
    if (item.category !== 'animal-health') throw error(404, `item ${id} is not animal health`);
    return {
      type: 'animal-health',
      item,
      lots: lotsForRole(listLotsForItem(id), role),
      movements: listMovementsForItem(id, 25),
      meta: animalHealthMeta(item.metadataJson),
      plugin: item.pluginId ? kinds.animalHealth.get(item.pluginId) : undefined,
      speciesNames,
      canEdit
    };
  }
  const plugin = kinds.animalHealth.get(id);
  if (!plugin) throw error(404, `animal-health item not found: ${id}`);
  return {
    type: 'animal-health',
    lots: [],
    movements: [],
    meta: {},
    plugin,
    speciesNames,
    canEdit
  };
}

export const load: PageServerLoad = async ({ params, locals }): Promise<DetailPayload> => {
  if (params.type === 'sprayer') {
    throw redirect(308, `/equipment/${encodeURIComponent(params.id)}`);
  }
  const type = parseType(params.type);
  const id = params.id;

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

  if (type === 'animal-health') return animalHealthPayload(id, locals.user?.role);

  // Lot-bearing types: pesticide / fertility / seed / feed
  const item = getStockItem(id);
  if (!item) throw error(404, `stock item not found: ${id}`);

  // Filter type/category consistency — refuse to render a fertilizer
  // under /inventory/pesticide/[id].
  if (
    type === 'pesticide' &&
    !(
      item.category === 'herbicide' ||
      item.category === 'insecticide' ||
      item.category === 'fungicide'
    )
  ) {
    throw error(404, `item ${id} is not a pesticide`);
  }
  if (type === 'fertility' && item.category !== 'fertilizer') {
    throw error(404, `item ${id} is not a fertility product`);
  }
  if (type === 'seed' && item.category !== 'seed') {
    throw error(404, `item ${id} is not a seed`);
  }
  if (type === 'feed') {
    if (!isFeedCategory(item.category)) throw error(404, `item ${id} is not feed or bedding`);
    const onHand = getStockItemWithBalance(id)?.onHand ?? 0;
    const role = locals.user?.role;
    return {
      type,
      item,
      lots: lotsForRole(listLotsForItem(id), role),
      movements: listMovementsForItem(id, 25),
      feed: feedMeta(item.metadataJson),
      onHand,
      onHandLb: onHandLb(item, onHand),
      subjects: feedSubjects(),
      canUse: !!role && canMutate(role),
      canEdit: role === 'owner'
    };
  }

  const lots = lotsForRole(listLotsForItem(id), locals.user?.role);
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
  return { type: 'seed', item, lots, movements, plugin: plugin as SeedDetailPayload['plugin'] };
};
