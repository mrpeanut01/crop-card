/**
 * The offline bundle `/api/cards/snapshot` returns for the active Owner and
 * Dexie stores per Owner. Plain, JSON-serializable types only: this module is
 * imported by the client and must never pull in server code.
 *
 * Calendar dates (planting, frost, expiry) are `YYYY-MM-DD` strings so they
 * render as the same day in every time zone; moments are epoch ms.
 */

import type { EmergencyContact } from '$lib/farm/emergencyContacts';
import type { AreaKind, BedStyle, BlockKind } from '$lib/farm/areaKinds';

export const FARM_SNAPSHOT_VERSION = 1 as const;

export type SnapshotProvenance = 'plugin' | 'data' | 'ai' | 'manual' | 'fallback';

/** `fields.kind` values. The UI calls these Areas; the table stays `fields`. */
export type SnapshotAreaKind = AreaKind;

export type SnapshotBlockKind = BlockKind;

export type SnapshotBedStyle = BedStyle;

export interface SnapshotArea {
  id: string;
  name: string;
  kind: SnapshotAreaKind;
  acres: number | null;
  widthFt: number | null;
  lengthFt: number | null;
  perimeterFt: number | null;
  /** Where `acres` came from: drawn map geometry, sketch dimensions or a
   *  typed value. Null when there are no acres. */
  acresSource: SnapshotAcresSource | null;
  notes: string | null;
}

export type SnapshotAcresSource = 'geometry' | 'dimensions' | 'typed';

/** Illustrative position inside the parent Area's feet grid. Never a
 *  geometry input (pollination distance, shade, weather centroids). */
export interface SnapshotBlockLayout {
  xFt: number | null;
  yFt: number | null;
  rotationDeg: number | null;
  bedStyle: SnapshotBedStyle | null;
}

export interface SnapshotBlock {
  id: string;
  areaId: string | null;
  name: string;
  blockLabel: string | null;
  kind: SnapshotBlockKind;
  acres: number | null;
  widthFt: number | null;
  lengthFt: number | null;
  layout: SnapshotBlockLayout | null;
}

export type SnapshotPlantingStatus = 'planned' | 'active' | 'harvested';

export interface SnapshotPlanting {
  id: string;
  blockId: string;
  cropPluginId: string;
  varietyDisplayName: string;
  status: SnapshotPlantingStatus;
  plantingDate: string | null;
  harvestedAt: string | null;
  quantityPlanted: number | null;
  quantityUnit: string | null;
  /** Owner-entered spacing overrides the plugin's (`manual` provenance). */
  spacingIn: number | null;
  rowSpacingIn: number | null;
  plantCount: number | null;
  /** How `plantCount` was set; `fallback` means computed without plugin spacing. */
  plantCountProvenance: 'data' | 'manual' | 'fallback' | null;
  sourceProvenance: 'ai' | 'fallback' | 'plugin' | null;
}

export type SnapshotTaskCategory =
  | 'plant'
  | 'till'
  | 'fertilize'
  | 'spray'
  | 'scout'
  | 'companion-check'
  | 'prune'
  | 'harvest'
  | 'hay-cutting'
  | 'other';

export interface SnapshotTask {
  id: string;
  title: string;
  category: SnapshotTaskCategory | null;
  scheduledFor: number;
  cropId: string | null;
  blockId: string | null;
  equipmentId: string | null;
}

export type SnapshotEquipmentType =
  'sprayer' | 'planter' | 'drill' | 'rake' | 'baler' | 'tractor' | 'mower' | 'irrigation' | 'other';

export interface SnapshotEquipmentState {
  calibratedGpa: number | null;
  calibrationDate: number | null;
  lastDeconAt: number | null;
  lastUsedAt: number | null;
  lastChemistryClass: string | null;
  winterizedAt: number | null;
}

export interface SnapshotEquipment {
  id: string;
  type: SnapshotEquipmentType;
  label: string;
  state: SnapshotEquipmentState | null;
  /** Tank size from the equipment spec (`spec.tankGal`). Absent on bundles
   *  saved before Sprint 30F. */
  tankGal?: number | null;
}

export type SnapshotStockCategory =
  'herbicide' | 'insecticide' | 'fungicide' | 'fertilizer' | 'seed' | 'adjuvant' | 'fuel' | 'part';

export interface SnapshotStockItem {
  id: string;
  pluginId: string | null;
  category: SnapshotStockCategory;
  displayName: string;
  unit: string;
  onHand: number;
  reorderThreshold: number | null;
  earliestExpiry: string | null;
}

export interface SnapshotMinMax {
  min: number;
  max: number;
}

/** The subset of a crop plugin the Planting, Area and Care Guide cards read. */
export interface SnapshotCropPlugin {
  pluginId: string;
  displayName: string;
  version: string;
  cropFamily: string;
  archetype?: string;
  daysToMaturity?: SnapshotMinMax;
  defaultRowSpacingInches?: number;
  preHarvestIntervalDays?: number;
  plantingGuide?: {
    rowSpacingIn?: number;
    inRowSpacingIn?: SnapshotMinMax;
    seedDepthIn?: SnapshotMinMax;
    soilTempMinF?: number;
  };
  harvestIndicators?: string[];
  notes?: string;
}

/** Month-day strings (`MM-DD`). `cautious` holds the 90%-sure dates, which
 *  are NOAA's P10 columns for both spring and fall. */
export interface SnapshotFrostDates {
  lastSpring: string | null;
  firstFall: string | null;
  hardLastSpring: string | null;
  hardFirstFall: string | null;
  cautious: { lastSpring: string | null; firstFall: string | null } | null;
  frostFree: boolean;
  provenance: 'data' | 'manual' | 'fallback';
  stationName: string | null;
  distanceMi: number | null;
}

export type SnapshotSprayProductType = 'herbicide' | 'insecticide' | 'fungicide';

export type SnapshotRateUnit = 'oz' | 'fl-oz' | 'lb' | 'pt' | 'qt';

/** The label facts a Spray Card reads for one stocked pesticide. Rates are
 *  the plugin's; the card scales them only through `lib/dilution`. */
export interface SnapshotSprayProduct {
  pluginId: string;
  type: SnapshotSprayProductType;
  displayName: string;
  version: string;
  epaRegistrationNumber: string | null;
  ratePerAcre: { amount: number; unit: SnapshotRateUnit } | null;
  gpaCalibration: number | null;
  reEntryIntervalHours: number | null;
  preHarvestIntervalDays: number | null;
  targets: string[];
  /** Sprayer load classes the kernel's cross-contamination gate compares:
   *  HRAC classes for herbicides, `insecticide-load` / `fungicide-load`
   *  otherwise. */
  loadClasses: string[];
  /** The kernel's `buildTankMixSteps` for this product (herbicides only). */
  mixSteps: string[];
  rainfastHours: number | null;
  pollinator: { beeToxicity: string; bloomRestriction: string } | null;
}

export interface FarmSnapshot {
  version: typeof FARM_SNAPSHOT_VERSION;
  ownerId: string;
  farmName: string | null;
  generatedAt: number;
  rulesVersion: string;
  /** Server-provided `ORIGIN` for printed QR links; never the Host header. */
  origin: string | null;
  areas: SnapshotArea[];
  blocks: SnapshotBlock[];
  plantings: SnapshotPlanting[];
  tasks: SnapshotTask[];
  equipment: SnapshotEquipment[];
  stock: SnapshotStockItem[];
  cropPlugins: Record<string, SnapshotCropPlugin>;
  frost: SnapshotFrostDates | null;
  /** Stocked pesticides keyed by plugin id. Absent on bundles saved before
   *  Sprint 30F. */
  sprayProducts?: Record<string, SnapshotSprayProduct>;
  /** The owner's saved emergency contacts for the Farm Map Card. Absent on
   *  bundles saved before Sprint 30H. */
  emergencyContacts?: EmergencyContact[];
}
