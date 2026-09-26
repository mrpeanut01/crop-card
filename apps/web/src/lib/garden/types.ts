/**
 * Garden designer contract (Phase 30E). Spec: docs/design/GARDEN_DESIGNER.md.
 *
 * Client-safe, JSON-serializable types only. Everything measured here lives in
 * one Area's local feet grid, which is illustrative: the `AreaFrame` brand
 * keeps these shapes out of pollination distance, shade and weather code.
 */

import type { BedStyle } from '$lib/farm/areaKinds';
import type { Footprint, PlantCountProvenance, SpacingPattern } from '$lib/farm/footprint';

export type { Footprint, PlantCountProvenance, SpacingPattern };

declare const areaFrameBrand: unique symbol;

/** Marks a value as Area-local designer feet. Only `lib/garden/geometry.ts`
 *  mints it. */
export interface AreaFrame {
  readonly [areaFrameBrand]: 'area-local-ft';
}

export interface PointFt extends AreaFrame {
  x: number;
  y: number;
}

/** Axis-aligned box in Area feet, `x`/`y` at the top-left, `w` across, `l` down. */
export interface RectFt extends AreaFrame {
  x: number;
  y: number;
  w: number;
  l: number;
}

export type Rotation = 0 | 90 | 180 | 270;

export type ProvenanceTag = 'plugin' | 'data' | 'ai' | 'manual' | 'fallback';

export type CanvasSource = 'dimensions' | 'polygon-bbox' | 'default';

/** The drawable Area. `widthFt` runs west to east and `lengthFt` north to
 *  south when `hasNorth` is true (polygon Areas). */
export interface AreaCanvas extends AreaFrame {
  areaId: string;
  name: string;
  widthFt: number;
  lengthFt: number;
  source: CanvasSource;
  hasNorth: boolean;
}

export type DesignerBlockKind = 'bed' | 'container';

/**
 * One `blocks` row drawn on the canvas. `widthFt`/`lengthFt` are the bed's own
 * size before rotation; `rect` is the box it covers on the canvas after
 * rotation (w and l swap at 90 and 270).
 */
export interface BedLayout {
  blockId: string;
  name: string;
  kind: DesignerBlockKind;
  bedStyle: BedStyle | null;
  widthFt: number;
  lengthFt: number;
  rotationDeg: Rotation;
  rect: RectFt;
}

export type BedPresetId =
  'raised-4x8' | 'in-ground-3x10' | 'row-30in' | 'container-5gal' | 'custom';

export interface BedPreset {
  id: BedPresetId;
  label: string;
  kind: DesignerBlockKind;
  bedStyle: BedStyle;
  widthFt: number;
  lengthFt: number;
}

/** The slice of a crop plugin the designer reads. `CropPlugin` and the
 *  offline `SnapshotCropPlugin` both satisfy it. */
export interface GardenCrop {
  pluginId: string;
  displayName: string;
  cropFamily: string;
  archetype?: string;
  daysToMaturity?: { min: number; max: number };
  defaultRowSpacingInches?: number;
  plantingGuide?: {
    rowSpacingIn?: number;
    inRowSpacingIn?: { min: number; max: number };
    soilTempMinF?: number;
  };
}

export type SpacingSource = 'plugin' | 'fallback' | 'manual';

export interface PlantSpacing {
  inRowIn: number;
  rowIn: number;
  pattern: SpacingPattern;
  source: SpacingSource;
}

export interface PlantCountResult {
  count: number;
  rows: number;
  perRow: number;
  provenance: PlantCountProvenance;
}

export type PlantingStatus = 'planned' | 'active' | 'harvested' | 'failed' | 'archived';

/** A planting as the designer sees it. `footprint` is null until it is placed
 *  inside its bed. */
export interface PlacedPlanting {
  cropId: string;
  blockId: string;
  cropPluginId: string;
  varietyDisplayName: string;
  cropFamily: string;
  status: PlantingStatus;
  plantingDateMs: number | null;
  harvestedAtMs: number | null;
  footprint: Footprint | null;
  spacing: PlantSpacing;
  plantCount: number | null;
  plantCountProvenance: PlantCountProvenance | null;
  groupId: string | null;
  groupSystemKind: 'three-sisters' | 'succession' | 'manual' | null;
  groupRole?: 'anchor' | 'companion' | null;
  /** Where a proposed planting came from once saved; null or absent when
   *  it was placed by hand. */
  sourceProvenance?: PlantingSourceProvenance | null;
}

export type PlantingSourceProvenance = 'ai' | 'fallback' | 'plugin';

/** When a planting holds its spot: planting date to harvest end, then the
 *  bed turnover buffer shared with `scheduleCandidacy`. */
export interface OccupancyInterval {
  cropId: string;
  blockId: string;
  startMs: number;
  harvestStartMs: number;
  harvestEndMs: number;
  endMs: number;
  footprint: Footprint | null;
  /** True when a recorded harvest date ended it rather than the estimate. */
  actual: boolean;
}

export interface BedOccupancyOnDate {
  blockId: string;
  dateMs: number;
  occupants: OccupancyInterval[];
  /** Share of the bed's square inches not covered by an occupant, 0 to 1. A
   *  placed-but-unsized occupant counts as covering the whole bed. */
  freeFraction: number;
  /** Empty on `dateMs`: when the last occupant before it ended, or null when
   *  nothing held the bed earlier in the range. */
  openSinceMs: number | null;
  /** Occupied on `dateMs`: first day on or after it with no occupant, or null
   *  when the bed stays full to the end of the range. */
  nextOpenMs: number | null;
}

export interface ScrubRange {
  startMs: number;
  endMs: number;
  todayMs: number;
}

export interface SuccessionSowing {
  index: number;
  plantingDateMs: number;
  footprint: Footprint | null;
  plantCount: number | null;
  /** Why this sowing has no spot on its date; null when it fits. */
  conflict: string | null;
}

export interface SuccessionProposal {
  anchorCropId: string;
  blockId: string;
  intervalDays: number;
  intervalSource: 'family' | 'manual';
  sowings: SuccessionSowing[];
  reason: string;
}

export interface BedHistoryEntry {
  cropId: string;
  cropPluginId: string;
  varietyDisplayName: string;
  cropFamily: string;
  archetype: string;
  status: PlantingStatus;
  plantingDateMs: number | null;
  harvestedAtMs: number | null;
  seasonYear: number;
}

export type RotationSeverity = 'ok' | 'suggest' | 'warn';

export interface RotationWarning {
  blockId: string;
  family: string;
  severity: Exclude<RotationSeverity, 'ok'>;
  lastSeasonYear: number;
  lookbackYears: number;
  message: string;
}

export type CompanionRelation = 'good-neighbor' | 'keep-apart';

export interface CompanionHint {
  relation: CompanionRelation;
  companionPluginId: string;
  a: { blockId: string; cropId: string; cropPluginId: string };
  b: { blockId: string; cropId: string; cropPluginId: string };
  sameBed: boolean;
  /** Good neighbours: the plugin's `benefit` line. Keep apart: the
   *  `keepApart` entry's reason (or `benefit` for a `badWith` pair). */
  benefit: string | null;
}

/** One planting a recipe, the deterministic fill or Claude proposes. */
export interface ProposedPlanting {
  key: string;
  blockId: string;
  cropPluginId: string;
  varietyDisplayName: string;
  plantingDateMs: number;
  footprint: Footprint;
  spacing: PlantSpacing;
  plantCount: number;
  provenance: Extract<ProvenanceTag, 'plugin' | 'ai' | 'fallback'>;
  note: string | null;
  /** Earlier proposal in the same sequence this one follows in time. */
  followsKey: string | null;
}

export interface RecipeApplication {
  recipePluginId: string;
  blockId: string;
  plantings: ProposedPlanting[];
  /** Steps that were skipped, with the reason (unknown crop, too short a
   *  season, no room on that date). */
  skipped: Array<{ stepIndex: number; reason: string }>;
  warnings: string[];
}

/** Everything the designer page renders, built from the server loader or
 *  from the offline snapshot. */
export interface GardenDesign {
  canvas: AreaCanvas;
  beds: BedLayout[];
  plantings: PlacedPlanting[];
  crops: Record<string, GardenCrop>;
  frost: { lastSpringFrostMs: number; firstFallFrostMs: number; provenance: ProvenanceTag };
  seasonYear: number;
  asOf: number;
  readOnly: boolean;
  readOnlyReason: 'role' | 'offline' | null;
  /** Beds with no stored position, laid out by `freeSpot` and drawn dashed
   *  until their first move saves one. */
  unplacedBedIds?: string[];
  /** Read-only context shapes (trees, fences, buildings) from `shade_sources`
   *  attached to this Area. */
  landmarks?: DesignLandmark[];
}

/** A shade source drawn for context. `rect` is null when it has no map
 *  geometry to place it inside the Area. */
export interface DesignLandmark {
  id: string;
  name: string;
  kind: string;
  rect: RectFt | null;
}
