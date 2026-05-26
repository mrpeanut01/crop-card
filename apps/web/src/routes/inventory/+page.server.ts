/**
 * Sprint 7 / Phase 27B+C (#257) — unified inventory loader.
 *
 * Replaces three drifted shells (/stock, /settings/plugins,
 * /settings/sprayers) with ONE canonical surface per CLAUDE.md
 * Invariant 8. The active inventory `type` lives in the URL search
 * param (`?type=pesticide|fertility|seed|crop|sprayer`); the loader
 * returns:
 *
 *   - `counts`     — per-type row counts for the 5-chip type-swap badge
 *   - `mode`       — 'stock' | 'catalog' (toggle; sprayer + crop have
 *                    only 'stock' or only 'catalog' respectively)
 *   - `rows`       — type-specific row shape consumed by `A_InventoryList`
 *
 * The old routes (/stock, /settings/plugins, /settings/sprayers) stay
 * live in parallel for diff comparison until the Sprint 9 cutover.
 */

import type { PageServerLoad } from './$types';
import { listStockItems, type StockCategory, type StockItemWithBalance } from '$lib/db/stock';
import { listEquipment } from '$lib/db/equipment';
import { getRegistry } from '$lib/server/registry';
import {
  INVENTORY_TYPES,
  type InventoryType
} from '$lib/inventory/types';

/** Row shape consumed by `A_InventoryList`. Per-type columns are
 *  selected at render time via the `kind` discriminator. */
export type InventoryRow =
  | (StockRow & { kind: 'stock' })
  | (CatalogRow & { kind: 'catalog' })
  | (SprayerRow & { kind: 'sprayer' });

export interface StockRow {
  id: string;
  displayName: string;
  shortName?: string;
  category: StockCategory;
  /** True onHand count summed across lots; 0 when no lots received. */
  onHand: number;
  defaultUnit: string;
  lotCount: number;
  reorderThreshold?: number;
  isLow: boolean;
  earliestExpiry?: number;
  pluginId?: string;
}

export interface CatalogRow {
  pluginId: string;
  displayName: string;
  pluginType: 'crop' | 'herbicide' | 'insecticide' | 'fungicide' | 'fertilizer';
  /** Source-of-truth field — version + archetype + cropFamily exposed
   *  on the catalog table. Per-type renderers pull what they need. */
  archetype?: string;
  cropFamily?: string;
  daysToMaturity?: { min: number; max: number };
  version?: string;
  hash: string;
}

export interface SprayerRow {
  id: string;
  label: string;
  nozzleType?: string;
  tankGal?: number;
  measuredGpa?: number;
  lastCalibratedAt?: number;
  lastChemistryClass?: string;
  lastDeconAt?: number;
  /** Decon required when last product is restricted-use AND no decon
   *  recorded since. Computed here so the list table renders without
   *  re-running the safety-kernel query. */
  deconRequired: boolean;
}

const TYPE_TO_STOCK_CATEGORIES: Record<InventoryType, StockCategory[] | null> = {
  pesticide: ['herbicide', 'insecticide', 'fungicide'],
  fertility: ['fertilizer'],
  seed: ['seed'],
  crop: null,
  sprayer: null
};

const TYPE_TO_PLUGIN_TYPES: Record<InventoryType, ReadonlyArray<CatalogRow['pluginType']> | null> = {
  pesticide: ['herbicide', 'insecticide', 'fungicide'],
  fertility: ['fertilizer'],
  seed: ['crop'],
  crop: ['crop'],
  sprayer: null
};

function parseType(raw: string | null): InventoryType {
  if (raw && (INVENTORY_TYPES as readonly string[]).includes(raw)) {
    return raw as InventoryType;
  }
  return 'pesticide';
}

function parseMode(raw: string | null, type: InventoryType): 'stock' | 'catalog' {
  if (type === 'crop') return 'catalog';
  if (type === 'sprayer') return 'stock';
  return raw === 'catalog' ? 'catalog' : 'stock';
}

function stockRowsFor(type: InventoryType, items: StockItemWithBalance[]): StockRow[] {
  const cats = TYPE_TO_STOCK_CATEGORIES[type];
  if (!cats) return [];
  const set = new Set(cats);
  return items
    .filter((i) => set.has(i.category))
    .map((i) => ({
      id: i.id,
      displayName: i.displayName,
      shortName: i.shortName,
      category: i.category,
      onHand: i.onHand,
      defaultUnit: i.defaultUnit,
      lotCount: i.lotCount,
      reorderThreshold: i.reorderThreshold,
      isLow: i.isLow,
      earliestExpiry: i.earliestExpiry,
      pluginId: i.pluginId
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

async function catalogRowsFor(type: InventoryType): Promise<CatalogRow[]> {
  const allowed = TYPE_TO_PLUGIN_TYPES[type];
  if (!allowed) return [];
  const registry = await getRegistry();
  const allowedSet = new Set<string>(allowed);
  const out: CatalogRow[] = [];
  for (const rec of registry.all()) {
    const p = rec.plugin as {
      type?: string;
      pluginId: string;
      displayName: string;
      version?: string;
      archetype?: string;
      cropFamily?: string;
      daysToMaturity?: { min: number; max: number };
    };
    if (!p.type || !allowedSet.has(p.type)) continue;
    out.push({
      pluginId: p.pluginId,
      displayName: p.displayName,
      pluginType: p.type as CatalogRow['pluginType'],
      archetype: p.archetype,
      cropFamily: p.cropFamily,
      daysToMaturity: p.daysToMaturity,
      version: p.version,
      hash: rec.hash
    });
  }
  return out.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

function sprayerRows(): SprayerRow[] {
  return listEquipment({ type: 'sprayer' }).map((eq) => {
    const spec = (eq.spec ?? {}) as { tankGal?: number; nozzle?: string };
    const lastUsed = eq.state.lastUsedAt;
    const lastDecon = eq.state.lastDeconAt;
    const deconRequired = !!(lastUsed && (!lastDecon || lastDecon < lastUsed));
    return {
      id: eq.id,
      label: eq.label,
      nozzleType: spec.nozzle,
      tankGal: spec.tankGal,
      measuredGpa: eq.state.calibratedGpa,
      lastCalibratedAt: eq.state.calibrationDate,
      lastChemistryClass: eq.state.lastChemistryClass,
      lastDeconAt: lastDecon,
      deconRequired
    };
  });
}

async function buildCounts(items: StockItemWithBalance[]): Promise<Record<InventoryType, number>> {
  const counts = {
    pesticide: 0,
    fertility: 0,
    seed: 0,
    crop: 0,
    sprayer: 0
  } as Record<InventoryType, number>;

  for (const i of items) {
    if (i.category === 'herbicide' || i.category === 'insecticide' || i.category === 'fungicide') {
      counts.pesticide++;
    } else if (i.category === 'fertilizer') {
      counts.fertility++;
    } else if (i.category === 'seed') {
      counts.seed++;
    }
  }

  const registry = await getRegistry();
  for (const rec of registry.all()) {
    const t = (rec.plugin as { type?: string }).type;
    if (t === 'crop') counts.crop++;
  }

  counts.sprayer = listEquipment({ type: 'sprayer' }).length;
  return counts;
}

export const load: PageServerLoad = async ({ url }) => {
  const type = parseType(url.searchParams.get('type'));
  const mode = parseMode(url.searchParams.get('mode'), type);

  const items = listStockItems();
  const counts = await buildCounts(items);

  let rows: InventoryRow[];
  if (type === 'sprayer') {
    rows = sprayerRows().map((r) => ({ ...r, kind: 'sprayer' as const }));
  } else if (mode === 'catalog' || type === 'crop') {
    rows = (await catalogRowsFor(type)).map((r) => ({ ...r, kind: 'catalog' as const }));
  } else {
    rows = stockRowsFor(type, items).map((r) => ({ ...r, kind: 'stock' as const }));
  }

  return {
    type,
    mode,
    counts,
    rows
  };
};
