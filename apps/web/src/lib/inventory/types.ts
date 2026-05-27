/**
 * Sprint 6 / Phase 27A (#257) — Unified Inventory type contract.
 *
 * Source-of-truth: docs/design/almanac/INVENTORY_UNIFICATION.md (data
 * model section). The five-type taxonomy (pesticide · fertility · seed ·
 * crop · sprayer) collapses three drifted shells (/stock,
 * /settings/plugins, /settings/sprayers) into one canonical List → Detail
 * → Edit/Add chrome per Invariant 8.
 *
 * This module is types only — no runtime imports, no DB access. Phase
 * 27B (list screens) and 27C (detail screens) consume these as the
 * cross-type contract; per-type loaders / repos under
 * `apps/web/src/lib/db/` materialize the runtime data. Phase 27D wires
 * the Edit/Add form against `A_InventoryEditForm`'s field map.
 *
 * Naming convention: every shared shape prefixed `Inv` (`InvField`,
 * `InvSection`, `InvKVP`, `InvTypeChip`) for unambiguous grep. Per-type
 * shapes use `Pesticide` / `Fertility` / `Seed` / `CropPlugin` /
 * `Sprayer` `Attrs` suffix to mirror the design doc.
 */

import type { Archetype } from '$lib/plugins/schemas';

export type InventoryType = 'pesticide' | 'fertility' | 'seed' | 'crop' | 'sprayer';

export type LotUnit = 'fl oz' | 'gal' | 'lb' | 'oz' | 'g' | 'yd³' | 'plants';

export interface InventoryItemBase {
  id: string;
  type: InventoryType;
  name: string;
  manufacturer?: string;
  /** NULL until a stock entry is matched to a catalog plugin. */
  pluginId?: string;
  pluginVersion?: string;
  /** Tenant scoping via Invariant 6 (Phase 18a). Required for every
   *  inventory row; the repo layer enforces via `tenantWhere`. */
  tenantId: string;
  createdAt: number;
  updatedAt: number;
}

/** Per-lot row. Only emitted for the three lot-bearing types
 *  (pesticide / fertility / seed). Crop catalog rows + sprayer rows
 *  carry no lot. */
export interface InventoryLot {
  id: string;
  itemId: string;
  lotNumber: string;
  quantity: number;
  unit: LotUnit;
  expires?: number;
  reorderAt?: number;
  location?: string;
  receivedFrom?: string;
  receivedAt?: number;
  pricePerUnit?: number;
  receiptRef?: string;
  tenantId: string;
}

export interface PesticideAttrs {
  /** KERNEL-LOCKED — read from the bound plugin; UI renders read-only. */
  epaRegNo: string;
  signalWord: 'Caution' | 'Warning' | 'Danger';
  /** Free-form HRAC / FRAC / IRAC label, e.g. "FRAC 3 + 9". */
  moaGroup: string;
  activeIngredients: Array<{ name: string; pct: number }>;
  restrictedUse: boolean;
  reiHours: number;
  /** Crop-pluginId → PHI days. */
  phiByCrop: Record<string, number>;
  /** Free-shape rate matrix; bound to the plugin's `applicationRange`. */
  rateRangeByCrop: Array<Record<string, unknown>>;
  /** Plugin-id list — incompat surface from the safety kernel. */
  tankMixIncompatible: string[];
}

export interface FertilityAttrs {
  /** NPK as % w/w; tuple form mirrors the label nameplate `N-P2O5-K2O`. */
  npk: [number, number, number];
  secondaries?: { s?: number; ca?: number; mg?: number };
  form: 'Granular' | 'Liquid' | 'Pellet' | 'Bulk / compost';
  /** Free-form density, e.g. "49 lb/ft³" or "9.2 lb/gal". */
  density?: string;
  omri: boolean;
  recommendedRate?: string;
}

export interface SeedAttrs {
  variety: string;
  latinName?: string;
  type: 'Heirloom · OP' | 'OP' | 'Hybrid F1' | 'Companion · F1';
  daysToMaturity?: [number, number];
  germPct: number;
  germTestDate: number;
  /** "self" or a lab name. */
  germTestBy: string;
  treated: {
    on: boolean;
    kind?: 'fungicide' | 'insecticide' | 'both';
    /** When `on` is true, links to the treating pesticide plugin so the
     *  safety kernel can re-key seed handling against PPE / REI. */
    pluginId?: string;
  };
  omri: boolean;
}

export interface CropPluginAttrs {
  /** Phase 27A explicit archetype (Invariant 8). 10 canonical values
   *  shared with `Archetype` in plugin-validation. */
  archetype: Archetype;
  renderer: string;
  rulesVersion: string;
  varieties: Array<Record<string, unknown>>;
  stages: string[];
  pests: Array<Record<string, unknown>>;
  diseases: Array<Record<string, unknown>>;
  source: 'core' | 'marketplace' | 'draft';
}

export interface SprayerAttrs {
  tankGal: number;
  nozzleType: string;
  nozzleCount: number;
  boomWidthFt?: number;
  lastCalibratedAt: number;
  measuredGpa: number;
  lastProductCycled?: string;
  rupCleared: boolean;
}

/** Discriminated union for the five inventory types — gives Phase 27B/C
 *  a single source-of-truth for type-aware switch arms. */
export type InventoryItem =
  | (InventoryItemBase & { type: 'pesticide'; attrs: PesticideAttrs })
  | (InventoryItemBase & { type: 'fertility'; attrs: FertilityAttrs })
  | (InventoryItemBase & { type: 'seed'; attrs: SeedAttrs })
  | (InventoryItemBase & { type: 'crop'; attrs: CropPluginAttrs })
  | (InventoryItemBase & { type: 'sprayer'; attrs: SprayerAttrs });

/** Chip taxonomy for InvField. Drives the small badge that signals a
 *  field's authoring source / lock state. */
export type FieldChipKind = 'required' | 'from-plugin' | 'kernel-locked';

/** Phase 27 design surface: every inventory-bearing surface routes
 *  through this list. Useful for the 5-chip type-swap row. */
export const INVENTORY_TYPES: readonly InventoryType[] = [
  'pesticide',
  'fertility',
  'seed',
  'crop',
  'sprayer'
] as const;

export const INVENTORY_TYPE_LABELS: Record<InventoryType, string> = {
  pesticide: 'Pesticides',
  fertility: 'Fertility',
  seed: 'Seeds',
  crop: 'Crops',
  sprayer: 'Sprayers'
};

export const STOCK_CATEGORY_TO_INVENTORY_TYPE: Record<string, InventoryType> = {
  herbicide: 'pesticide',
  insecticide: 'pesticide',
  fungicide: 'pesticide',
  fertilizer: 'fertility',
  seed: 'seed'
};
